import type { Assignment, Run, UsageCall } from './types.ts'
import type { RunResult } from './agents.ts'
import { runs } from './store.ts'

// Record one agent invocation on the run. Cancelled calls are not counted: they say nothing about the agent.
export function record(run: Run, role: UsageCall['role'], a: Assignment, res: RunResult, startedAt: number, extra: { taskId?: string; terminal?: boolean; ok?: boolean } = {}) {
  if (res.error === 'cancelled') return
  // Local Ollama models cost nothing; Claude Code (Ollama's harness) still prices them as if they were
  // Anthropic models, so its figure is dropped. Ollama cloud models are billed by Ollama, which reports no price.
  const costUsd = a.agent === 'ollama' ? (a.model.endsWith('-cloud') ? undefined : 0) : res.costUsd
  const call: UsageCall = {
    at: startedAt, ms: Date.now() - startedAt, role, agent: a.agent, model: a.model,
    ok: extra.ok ?? res.ok, costUsd, tokensIn: res.tokensIn, tokensOut: res.tokensOut,
  }
  if (extra.taskId) call.taskId = extra.taskId
  if (extra.terminal) call.terminal = true
  ;(run.usage ??= []).push(call)
}

// Every subtask attempt in a project: recorded calls, plus the finished subtasks of runs saved before calls
// were recorded (one attempt each, with whatever cost the subtask kept).
export function attempts(project: string): UsageCall[] {
  const out: UsageCall[] = []
  for (const r of runs.values()) {
    if (r.project !== project) continue
    if (r.usage) out.push(...r.usage.filter((c) => c.role === 'task'))
    else for (const t of r.tasks) {
      if (!t.ranWith || !['done', 'failed', 'needs_attention'].includes(t.status)) continue
      out.push({ at: t.startedAt || r.createdAt, ms: (t.finishedAt || 0) - (t.startedAt || 0), role: 'task', taskId: t.id, agent: t.ranWith.agent, model: t.ranWith.model, ok: t.status === 'done', costUsd: t.costUsd })
    }
  }
  return out
}

// The planner's view of how each agent and model has done in this project, so routing improves with use.
export function trackRecord(project: string): string {
  const groups = new Map<string, UsageCall[]>()
  for (const c of attempts(project)) {
    const k = `${c.agent}${c.model ? ` "${c.model}"` : ''}`
    groups.set(k, [...(groups.get(k) || []), c])
  }
  if (!groups.size) return ''
  const lines = [...groups].sort((a, b) => b[1].length - a[1].length).slice(0, 12).map(([k, cs]) => {
    const ok = cs.filter((c) => c.ok).length
    const priced = cs.filter((c) => c.costUsd !== undefined)
    const cost = priced.length ? `, about $${(priced.reduce((s, c) => s + c.costUsd!, 0) / priced.length).toFixed(2)} per attempt` : ''
    const mins = cs.filter((c) => c.ms > 0)
    const time = mins.length ? `, ${Math.max(1, Math.round(mins.reduce((s, c) => s + c.ms, 0) / mins.length / 60000))} min typical` : ''
    return `- ${k}: ${cs.length} subtask attempt${cs.length === 1 ? '' : 's'}, ${Math.round((ok / cs.length) * 100)}% succeeded${cost}${time}`
  })
  return lines.join('\n')
}
