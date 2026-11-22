import type { AgentId, Assignment, Reasoning, Run, Task } from './types.ts'
import { installed, spec } from './agents.ts'
import { loadConfig } from './config.ts'

const REASONING: Reasoning[] = ['low', 'medium', 'high']

export function defaultModel(agent: AgentId): string {
  const s = loadConfig().settings
  if (s.models[agent] !== undefined) return s.models[agent]
  return { claude: 'sonnet', codex: '', devin: 'swe-2-high', mock: 'mock-1' }[agent]
}

// Who plans and reviews: the user's default CLI, otherwise the strongest reasoner installed.
export function lead(): Assignment {
  const s = loadConfig().settings
  const have = installed().map((a) => a.id)
  if (!have.length) throw new Error('No coding CLI found on PATH. Install Claude Code, Codex or Devin.')
  const agent = s.defaultAgent !== 'auto' && have.includes(s.defaultAgent) ? s.defaultAgent : (['claude', 'codex', 'devin', 'mock'] as AgentId[]).find((a) => have.includes(a))!
  return { agent, model: defaultModel(agent), reasoning: s.reasoning }
}

export function planPrompt(run: Run): string {
  const s = loadConfig().settings
  const roster = installed()
    .map((a) => `- "${a.id}" (${a.label}): good at ${a.strengths}. speed=${a.speed}, cost=${a.cost}. models: ${a.models.map((m) => `"${m.id}" (${m.note})`).join('; ')}`)
    .join('\n')
  const routing =
    s.defaultAgent === 'auto'
      ? `Assign each subtask to the agent and model that fits it best, weighing the agent's strengths, how much reasoning the subtask needs, speed and cost. Prefer cheap, fast models for mechanical work and reserve expensive ones for hard reasoning. When more than one agent is available and the work allows it, spread subtasks across agents.`
      : `The user has pinned every subtask to "${s.defaultAgent}"; still fill in agent/model/reasoning, they will be normalised.`
  return `You are the planner for Argo, which coordinates a team of coding CLIs on one repository (the current directory). Inspect the repository as needed, but do not modify anything.

## Request
${run.goal}
${run.constraints.length ? '\n## Constraints given by the user\n' + run.constraints.map((c) => `- ${c}`).join('\n') : ''}

## Available agents
${roster}

## What to produce
Break the request into the smallest set of subtasks (1-6) that can each be done by one agent in one sitting. Each runs in its own git worktree and is merged afterwards, so:
- subtasks with no dependency between them run IN PARALLEL: give them disjoint files so merges are clean, and state the exact file paths, function names and interfaces each must use so parallel work fits together;
- a subtask that needs another's output must list it in dependsOn;
- do not create a separate "review" or "verify" subtask: the orchestrator runs checks and a review itself.
${routing}

Return ONLY a JSON object, no prose, in this shape:
{"constraints": ["constraints you inferred from the request or repo conventions"],
 "tasks": [{"id": "t1", "title": "short title", "description": "complete, self-contained instructions", "dependsOn": [], "agent": "<agent id>", "model": "<model id>", "reasoning": "low|medium|high", "why": "one sentence on why this agent and model"}]}`
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

// Apply the user's defaults and sanity-check whatever the planner chose.
export function route(want: Partial<Assignment> & { why?: string }): Task['auto'] {
  const s = loadConfig().settings
  const have = installed()
  if (s.defaultAgent !== 'auto' && have.some((a) => a.id === s.defaultAgent))
    return { agent: s.defaultAgent, model: defaultModel(s.defaultAgent), reasoning: s.reasoning, why: 'Your default CLI and model.' }
  const a = have.find((x) => x.id === want.agent)
  if (!a) {
    const l = lead()
    return { ...l, why: `${want.agent || 'No agent'} is not available here; using ${spec(l.agent)!.label}.` }
  }
  const model = a.models.some((m) => m.id === want.model) ? want.model! : defaultModel(a.id)
  const reasoning = REASONING.includes(want.reasoning!) ? want.reasoning! : s.reasoning
  return { agent: a.id, model, reasoning, why: want.why || 'Chosen by the orchestrator.' }
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
    auto: route(t),
    changedFiles: [],
  }))
}

// Follow-ups skip the planner: honour an agent named in the instruction, else the default.
export function routeFollowup(text: string): Task['auto'] {
  const named = installed().find((a) => new RegExp(`\\b(${a.id}|${a.label})\\b`, 'i').test(text))
  if (named) return { agent: named.id, model: defaultModel(named.id), reasoning: loadConfig().settings.reasoning, why: `You asked for ${named.label}.` }
  return route({ ...lead(), why: 'Follow-up routed to the lead agent.' })
}

export function reviewPrompt(run: Run, diffStat: string, checks: string): string {
  return `You are the reviewer for a Argo run. Several coding agents worked in parallel and their work has been merged into the current directory (branch ${run.branch}). Review it against the request by reading the changed files. Do not modify anything, and do not re-run the checks: the orchestrator already ran them and the results are below.

## Request
${run.goal}
${run.followups.length ? '\n## Follow-up instructions\n' + run.followups.map((f) => `- ${f.text}`).join('\n') : ''}

## Subtasks and what each agent reported
${run.tasks.map((t) => `- ${t.id} ${t.title} [${t.status}]: ${(t.summary || t.error || '').replace(/\s+/g, ' ').slice(0, 500)}`).join('\n')}

## Files changed since ${run.baseCommit.slice(0, 8)}
${diffStat || '(none)'}

## Check results
${checks || '(no checks were configured or detected)'}

Return ONLY a JSON object: {"complete": ["what is verifiably done, one item per line"], "attention": ["anything missing, broken, risky or left for the human; empty if nothing"]}`
}
