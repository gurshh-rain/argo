import type { AgentId, Assignment, Difficulty, Reasoning, Run, Task } from './types.ts'
import { installed, spec, TIERS } from './agents.ts'
import { loadConfig } from './config.ts'
import { trackRecord } from './usage.ts'

const LEVELS: Difficulty[] = ['easy', 'medium', 'hard']
const EFFORT: Record<Difficulty, Reasoning> = { easy: 'low', medium: 'medium', hard: 'high' }

// The model and reasoning level a difficulty maps to for one agent.
// A model the user pinned for that CLI in Settings always wins over the tier.
export function pick(agent: AgentId, difficulty: Difficulty): Assignment {
  const pinned = loadConfig().settings.models[agent]
  // Ollama's tiers come from whatever models its server has right now
  const live = agent === 'ollama' ? spec('ollama')?.tiers : undefined
  const tiers = live ?? TIERS[agent]
  return { agent, model: pinned !== undefined ? pinned : (tiers?.[difficulty] ?? ''), reasoning: EFFORT[difficulty] }
}

// Difficulty of an instruction that did not go through the planner (follow-ups), judged from its wording.
export function classify(text: string): Difficulty {
  const t = text.toLowerCase()
  const hard = /\b(architect\w*|redesign|refactor\w*|migrat\w*|concurren\w*|race condition|deadlock|security|vulnerab\w*|auth\w*|performance|optimi[sz]\w*|investigat\w*|root cause|debug\w*|algorithm\w*|across the (code ?base|repo)|rewrite)\b/
  const easy = /\b(typo|rename|comment\w*|readme|docs?|document\w*|format\w*|lint|bump|changelog|wording|copy|log message|whitespace|delete the|remove the)\b/
  if (hard.test(t)) return 'hard'
  if (easy.test(t) && t.length < 240) return 'easy'
  return t.length > 600 ? 'hard' : 'medium'
}

export function defaultModel(agent: AgentId): string {
  const s = loadConfig().settings
  if (s.models[agent] !== undefined) return s.models[agent]
  if (agent === 'ollama') return spec('ollama')?.tiers.medium ?? ''
  return { claude: 'sonnet', codex: '', devin: 'swe-2-high', gemini: '', mock: 'mock-1' }[agent]
}

// Who plans and reviews: the user's default CLI, otherwise the strongest reasoner installed.
export function lead(): Assignment {
  const s = loadConfig().settings
  const have = installed().map((a) => a.id)
  if (!have.length) throw new Error('No coding CLI found on PATH. Install Claude Code, Codex, Devin or Gemini CLI, or start Ollama.')
  const agent = s.defaultAgent !== 'auto' && have.includes(s.defaultAgent) ? s.defaultAgent : (['claude', 'codex', 'devin', 'gemini', 'ollama', 'mock'] as AgentId[]).find((a) => have.includes(a))!
  return { agent, model: defaultModel(agent), reasoning: s.reasoning }
}

export function planPrompt(run: Run): string {
  const s = loadConfig().settings
  const roster = installed()
    .map((a) => `- "${a.id}" (${a.label}): good at ${a.strengths}. speed=${a.speed}, cost=${a.cost}. models: ${a.models.map((m) => `"${m.id}" (${m.note})`).join('; ')}`)
    .join('\n')
  const routing =
    s.defaultAgent === 'auto'
      ? `Assign each subtask to the agent that fits it best, weighing the agent's strengths, speed and cost. When more than one agent is available and the work allows it, spread subtasks across agents.`
      : `The user has pinned every subtask to "${s.defaultAgent}"; set "agent" to that.`
  const history = trackRecord(run.project)
  const where = run.isolated
    ? 'on one repository (the current directory). Inspect the repository as needed, but do not modify anything.'
    : 'on a request that is not tied to a git repository: research, analysis, writing, or work in a plain folder (the current directory). The agents can read files, run commands and search the web.'
  return `You are the planner for Argo, which coordinates a team of coding CLIs ${where}

## Request
${run.goal}
${run.constraints.length ? '\n## Constraints given by the user\n' + run.constraints.map((c) => `- ${c}`).join('\n') : ''}

## Available agents
${roster}
${history ? `
## Track record in this project
How earlier subtasks here went. Prefer agents and models that succeed here at a reasonable cost; a low success rate is a reason to pick a different agent or a harder difficulty, but a handful of attempts is weak evidence.
${history}
` : ''}
## What to produce
Break the request into the smallest set of subtasks (1-6) that can each be done by one agent in one sitting. ${run.isolated ? 'Each runs in its own git worktree and is merged afterwards, so:' : 'They all share one working folder and one shared record, so:'}
- subtasks with no dependency between them run IN PARALLEL: ${run.isolated ? 'give them disjoint files so merges are clean, and state the exact file paths, function names and interfaces each must use so parallel work fits together' : 'give each a distinct question or angle so they do not duplicate each other, and if they write files give them different file names'};${run.isolated ? '' : '\n- when several subtasks gather findings, end with ONE subtask that depends on them and writes the final answer for the user from what they found;'}
- a subtask that needs another's output must list it in dependsOn;
- do not create a separate "review" or "verify" subtask: the orchestrator runs checks and a review itself.
${routing}

Rate each subtask's difficulty honestly; the orchestrator picks the model from it (easy = cheapest and fastest model, hard = the strongest and most expensive), so over-rating wastes money and under-rating produces bad work:
- "easy": mechanical or fully specified; a few lines or a single obvious file; docs, renames, config, boilerplate, simple tests.
- "medium": ordinary feature or bug-fix work in a few files with some design choices.
- "hard": needs real reasoning: architecture, subtle bugs, concurrency, security, performance, tricky algorithms, or changes that cut across much of the codebase.

Return ONLY a JSON object, no prose, in this shape:
{"constraints": ["constraints you inferred from the request or repo conventions"],
 "tasks": [{"id": "t1", "title": "short title", "description": "complete, self-contained instructions", "dependsOn": [], "agent": "<agent id>", "difficulty": "easy|medium|hard", "why": "one sentence on why this agent and this difficulty"}]}
Only when the user named a specific model, add "model": "<that model id>" to the subtasks that should use it.`
}

export function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  for (const candidate of [fenced?.[1], text]) {
    if (!candidate) continue
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start < 0 || end <= start) continue
    try { return JSON.parse(candidate.slice(start, end + 1)) } catch {}
  }
  return undefined
}

const model = (a: Assignment) => (a.model ? a.model : 'its configured model')

// Turn the planner's agent + difficulty into a concrete assignment, applying the user's defaults.
export function route(want: { agent?: string; difficulty?: string; why?: string; model?: string }): { auto: Task['auto']; difficulty: Difficulty } {
  const s = loadConfig().settings
  const have = installed()
  const difficulty = LEVELS.includes(want.difficulty as Difficulty) ? (want.difficulty as Difficulty) : 'medium'
  let agent = have.find((x) => x.id === want.agent)?.id
  let why = want.why || 'Chosen by the orchestrator.'
  if (s.defaultAgent !== 'auto' && have.some((a) => a.id === s.defaultAgent)) (agent = s.defaultAgent), (why = `Your default CLI. ${want.why || ''}`.trim())
  else if (!agent) (agent = lead().agent), (why = `${want.agent || 'No agent'} is not available here; using ${spec(agent)!.label}.`)
  const a = pick(agent, difficulty)
  // a model the user named outright beats the difficulty tier (this is how one Ollama model is asked for)
  const named = want.model && spec(agent)?.models.some((m) => m.id === want.model)
  if (named) return { difficulty, auto: { ...a, model: want.model!, why: `${why} You named the model ${want.model}.` } }
  return { difficulty, auto: { ...a, why: `${why} Rated ${difficulty}, so ${model(a)} at ${a.reasoning} reasoning.` } }
}

export function tasksFromPlan(plan: any, run: Run): Task[] {
  const raw: any[] = Array.isArray(plan?.tasks) ? plan.tasks.slice(0, 8) : []
  const ids = new Set(raw.map((t) => String(t.id)))
  return raw.map((t, i) => ({
    id: String(t.id || `t${i + 1}`),
    title: String(t.title || `Subtask ${i + 1}`).slice(0, 80),
    description: String(t.description || t.title || run.goal),
    dependsOn: (Array.isArray(t.dependsOn) ? t.dependsOn.map(String) : []).filter((d: string) => ids.has(d) && d !== String(t.id)),
    kind: 'work' as const,
    status: 'pending' as const,
    ...route(t),
    changedFiles: [],
  }))
}

// Follow-ups skip the planner: honour an agent named in the instruction, and judge difficulty from the wording.
export function routeFollowup(text: string): { auto: Task['auto']; difficulty: Difficulty } {
  // an exact model name ("use gemma4:31b-cloud") picks that model's connector
  const byModel = installed().flatMap((a) => a.models.filter((m) => m.id.length > 3 && text.toLowerCase().includes(m.id.toLowerCase())).map((m) => ({ a, m })))[0]
  const named = byModel?.a || installed().find((a) => new RegExp(`\\b(${a.id}|${a.label})\\b`, 'i').test(text))
  return route({ agent: named?.id || lead().agent, model: byModel?.m.id, difficulty: classify(text), why: named ? `You asked for ${named.label}.` : 'Follow-up routed to the lead agent.' })
}

// After a failure, step the subtask up one difficulty level so the retry gets a stronger model.
export function harder(t: Task): boolean {
  const i = LEVELS.indexOf(t.difficulty)
  if (i < 0 || i >= LEVELS.length - 1) return false
  const from = t.auto.model
  t.difficulty = LEVELS[i + 1]
  const a = pick(t.auto.agent, t.difficulty)
  t.auto = { ...a, why: `Failed at ${LEVELS[i]}${from ? ' on ' + from : ''}; escalated to ${t.difficulty}, so ${model(a)} at ${a.reasoning} reasoning.` }
  return true
}

export function reviewPrompt(run: Run, diffStat: string, checks: string): string {
  return `You are the reviewer for a Argo run. Several coding agents worked in parallel and ${run.isolated ? `their work has been merged into the current directory (branch ${run.branch})` : 'their outputs are summarised below (full outputs are in .argo/results/ under the current directory)'}. Review it against the request${run.isolated ? ' by reading the changed files' : ', checking that the final answer is supported by what the subtasks found'}. Do not modify anything, and do not re-run the checks: the orchestrator already ran them and the results are below.

## Request
${run.goal}
${run.followups.length ? '\n## Follow-up instructions\n' + run.followups.map((f) => `- ${f.text}`).join('\n') : ''}

## Subtasks and what each agent reported
${run.tasks.map((t) => `- ${t.id} ${t.title} [${t.status}]: ${(t.summary || t.error || '').replace(/\s+/g, ' ').slice(0, 500)}`).join('\n')}

## Files changed${run.isolated ? ' since ' + run.baseCommit.slice(0, 8) : ''}
${diffStat || '(none)'}

## Check results
${checks || '(no checks were configured or detected)'}

Return ONLY a JSON object: {"complete": ["what is verifiably done, one item per line"], "attention": ["anything missing, broken, risky or left for the human; empty if nothing"]}`
}
