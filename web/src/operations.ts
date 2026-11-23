import { HttpError } from 'wasp/server'
import type { GetDashboard, StartTask, SendFollowup, ApproveRun } from 'wasp/server/operations'
import { daemon } from './daemon'

export type TaskView = { id: string; title: string; status: string; agent: string; model: string; reasoning: string; overridden: boolean; error?: string }
export type RunView = { id: string; goal: string; project: string; status: string; tasks: TaskView[]; attention: string[]; report?: { completed: string[]; attention: string[] } }
export type Dashboard = { runs: RunView[]; summary: string; error?: string }

export const getDashboard: GetDashboard<void, Dashboard> = async () => {
  let s: any
  try {
    s = await daemon('GET', 'state')
  } catch (e: any) {
    return { runs: [], summary: '', error: e.message }
  }
  const label = (id: string) => s.agents.find((a: any) => a.id === id)?.label || id
  return {
    summary: s.summary,
    runs: s.runs.slice(0, 8).map((r: any) => ({
      id: r.id,
      goal: r.goal,
      project: r.project.split('/').pop(),
      status: r.status,
      attention: s.attention.filter((a: any) => a.runId === r.id && a.kind !== 'completed').map((a: any) => a.spoken),
      report: r.report && { completed: r.report.completed, attention: r.report.attention },
      tasks: r.tasks.map((t: any) => {
        const a = t.ranWith || { ...t.auto, ...t.override }
        return { id: t.id, title: t.title, status: t.status, agent: label(a.agent), model: a.model || 'cli default', reasoning: a.reasoning, overridden: !!t.override, error: t.error }
      }),
    })),
  }
}

const clean = (s: unknown) => {
  const t = String(s ?? '').trim()
  if (!t) throw new HttpError(400, 'Nothing to send.')
  if (t.length > 4000) throw new HttpError(400, 'That is too long.')
  return t
}

export const startTask: StartTask<{ transcript: string }, { runId: string }> = async ({ transcript }, context) => {
  const goal = clean(transcript)
  const run = await daemon('POST', 'runs', { goal })
  await context.entities.VoiceCommand.create({ data: { kind: 'task', transcript: goal, runId: run.id } })
  return { runId: run.id }
}

export const sendFollowup: SendFollowup<{ runId: string; transcript: string }, { action: string }> = async ({ runId, transcript }, context) => {
  const text = clean(transcript)
  const out = await daemon('POST', `runs/${encodeURIComponent(runId)}/instruct`, { text, source: 'phone' })
  await context.entities.VoiceCommand.create({ data: { kind: 'followup', transcript: text, runId } })
  return { action: out.action }
}

export const approveRun: ApproveRun<{ runId: string }, void> = async ({ runId }) => {
  await daemon('POST', `runs/${encodeURIComponent(runId)}/approve`)
}
