import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, appendFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { Run, Attention } from './types.ts'
import { loadConfig, saveConfig } from './config.ts'

// Project-scoped persistent record. Everything lives in <project>/.argo/:
//   state.json  machine-readable runs (goal, constraints, decisions, task status, changed files)
//   MEMORY.md   the same record rendered for agents to read at any time
//   notes/      agents append decisions here; the orchestrator folds them into the record
//   logs/       per-task agent output

export const runs = new Map<string, Run>()
export const attention: Attention[] = []
type Listener = (event: { type: string; runId?: string; taskId?: string; data?: unknown }) => void
const listeners = new Set<Listener>()

export const subscribe = (fn: Listener) => (listeners.add(fn), () => listeners.delete(fn))
export const emit = (type: string, runId?: string, taskId?: string, data?: unknown) => {
  for (const fn of listeners) fn({ type, runId, taskId, data })
}

export const dir = (project: string, ...p: string[]) => join(project, '.argo', ...p)

export function ensureProject(project: string) {
  for (const d of ['', 'notes', 'logs']) mkdirSync(dir(project, d), { recursive: true })
  // keep the record out of the user's commits without touching their .gitignore
  const exclude = join(project, '.git', 'info', 'exclude')
  if (existsSync(join(project, '.git', 'info'))) {
    const cur = existsSync(exclude) ? readFileSync(exclude, 'utf8') : ''
    if (!cur.includes('.argo/')) appendFileSync(exclude, '\n.argo/\n')
  }
  const cfg = loadConfig()
  if (!cfg.projects.includes(project)) {
    cfg.projects.unshift(project)
    saveConfig()
  }
}

export function loadProject(project: string) {
  const f = dir(project, 'state.json')
  if (!existsSync(f)) return
  const data = JSON.parse(readFileSync(f, 'utf8')) as { runs: Run[]; attention?: Attention[] }
  for (const r of data.runs) {
    // anything in flight when the daemon stopped cannot still be running
    if (['planning', 'running', 'verifying'].includes(r.status)) {
      r.status = 'needs_attention'
      r.error = 'Orchestrator restarted while this run was in progress.'
      for (const t of r.tasks) if (t.status === 'running' || t.status === 'merging') (t.status = 'failed'), (t.error = 'Interrupted by restart')
    }
    runs.set(r.id, r)
  }
  for (const a of data.attention || []) if (!attention.find((x) => x.id === a.id)) attention.push(a)
}

const pending = new Set<string>()
export function save(run: Run) {
  emit('run', run.id)
  if (pending.has(run.project)) return
  pending.add(run.project)
  setTimeout(() => {
    pending.delete(run.project)
    flush(run.project)
  }, 150)
}

export function flush(project: string) {
  const mine = [...runs.values()].filter((r) => r.project === project)
  const tmp = dir(project, 'state.json.tmp')
  writeFileSync(tmp, JSON.stringify({ runs: mine, attention: attention.filter((a) => runs.get(a.runId)?.project === project) }, null, 2))
  renameSync(tmp, dir(project, 'state.json'))
  const active = mine.sort((a, b) => b.createdAt - a.createdAt)[0]
  if (active) writeFileSync(dir(project, 'MEMORY.md'), renderMemory(active))
}

export function assignment(t: Run['tasks'][number]) {
  return t.ranWith || { agent: t.override?.agent || t.auto.agent, model: t.override?.model ?? t.auto.model, reasoning: t.override?.reasoning || t.auto.reasoning }
}

export function renderMemory(run: Run): string {
  const lines = [
    `# Argo shared record — run ${run.id}`,
    '',
    'Every agent on this run reads this file. It is rewritten by the orchestrator; do not edit it.',
    '',
    '## Goal',
    run.goal,
    '',
    '## Constraints',
    ...(run.constraints.length ? run.constraints.map((c) => `- ${c}`) : ['- (none stated)']),
    '',
    '## Follow-up instructions from the user',
    ...(run.followups.length ? run.followups.map((f) => `- [${f.source}] ${f.text}`) : ['- (none)']),
    '',
    '## Decisions',
    ...(run.decisions.length ? run.decisions.map((d) => `- (${d.by}) ${d.text}`) : ['- (none yet)']),
    '',
    '## Tasks',
  ]
  for (const t of run.tasks) {
    const a = assignment(t)
    lines.push(
      `### ${t.id} — ${t.title} [${t.status}]`,
      `- agent: ${a.agent} · model: ${a.model || 'cli default'} · reasoning: ${a.reasoning}${t.override ? ' (manual override)' : ''}`,
      `- depends on: ${t.dependsOn.join(', ') || 'nothing'}`,
      `- branch: ${t.branch || '-'}`,
    )
    if (t.changedFiles.length) lines.push(`- changed files: ${t.changedFiles.join(', ')}`)
    if (t.summary) lines.push(`- result: ${t.summary.replace(/\s+/g, ' ').slice(0, 600)}`)
    if (t.error) lines.push(`- problem: ${t.error.slice(0, 300)}`)
    lines.push('')
  }
  return lines.join('\n')
}

// Fold agent-written notes into the decision log.
export function ingestNotes(run: Run) {
  const d = dir(run.project, 'notes')
  if (!existsSync(d)) return
  for (const f of readdirSync(d)) {
    if (!f.startsWith(run.id + '-') || !f.endsWith('.md')) continue
    const taskId = f.slice(run.id.length + 1, -3)
    const task = run.tasks.find((t) => t.id === taskId)
    const by = task ? `${assignment(task).agent}/${taskId}` : taskId
    for (const raw of readFileSync(join(d, f), 'utf8').split('\n')) {
      const text = raw.replace(/^[-*\s]+/, '').trim()
      if (text && !run.decisions.some((x) => x.text === text)) run.decisions.push({ at: Date.now(), by, text })
    }
  }
}

export function appendLog(run: Run, taskId: string, line: string) {
  appendFileSync(dir(run.project, 'logs', `${run.id}-${taskId}.log`), line + '\n')
  emit('log', run.id, taskId, line)
}

export function readLog(run: Run, taskId: string, tail = 400): string[] {
  const f = dir(run.project, 'logs', `${run.id}-${taskId}.log`)
  if (!existsSync(f)) return []
  const lines = readFileSync(f, 'utf8').split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines.slice(-tail)
}
