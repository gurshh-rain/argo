import type { Attention, Run } from './types.ts'
import { runs, attention, assignment } from './store.ts'
import { spec } from './agents.ts'

const who = (run: Run, taskId?: string) => {
  const t = run.tasks.find((x) => x.id === taskId)
  if (!t) return 'The orchestrator'
  const a = assignment(t)
  return `${spec(a.agent)?.label || a.agent}${a.model ? ' on ' + a.model : ''}`
}

export function describe(a: Attention): string {
  const run = runs.get(a.runId)
  if (!run) return a.message
  const t = run.tasks.find((x) => x.id === a.taskId)
  const subject = t ? `${who(run, t.id)}, working on "${t.title}",` : 'Your run'
  switch (a.kind) {
    case 'error': return `${subject} hit an error: ${a.message}`
    case 'permission': return `${subject} needs your permission: ${a.message}`
    case 'stuck': return `${subject} looks stuck: ${a.message}`
    case 'conflict': return `${subject} produced changes that conflict with another agent's work: ${a.message}`
    case 'completed': return `Your run "${run.goal.slice(0, 80)}" finished. ${a.message}`
  }
}

// Short plain-language status of the current run.
export function summary(runId?: string): string {
  const all = [...runs.values()].sort((a, b) => b.createdAt - a.createdAt)
  const run = runId ? runs.get(runId) : all.find((r) => !['done', 'cancelled'].includes(r.status)) || all[0]
  if (!run) return 'Nothing is running. Give me a task to get started.'
  const done = run.tasks.filter((t) => t.status === 'done')
  const running = run.tasks.filter((t) => t.status === 'running' || t.status === 'merging')
  const open = attention.filter((a) => a.runId === run.id && !a.resolved && a.kind !== 'completed')
  const parts = [`The run "${run.goal.slice(0, 90)}" is ${run.status.replace('_', ' ')}.`]
  if (run.status === 'planning') parts.push('The plan is still being drawn up.')
  if (run.tasks.length) parts.push(`${done.length} of ${run.tasks.length} subtasks are done.`)
  for (const t of running) parts.push(`${who(run, t.id)} is working on ${t.title}.`)
  if (run.status === 'awaiting_approval') parts.push('The plan is waiting for your approval.')
  if (run.status === 'verifying') parts.push('Checks and review are running.')
  if (run.report) {
    const failed = run.report.checks.filter((c) => !c.ok).length
    if (run.report.checks.length) parts.push(failed ? `${failed} of ${run.report.checks.length} checks failed.` : 'All checks passed.')
    if (run.report.attention.length) parts.push(`${run.report.attention.length} item${run.report.attention.length > 1 ? 's' : ''} still need attention: ${run.report.attention.slice(0, 2).join('; ')}.`)
  }
  for (const a of open.slice(0, 2)) parts.push(describe(a))
  return parts.join(' ')
}
