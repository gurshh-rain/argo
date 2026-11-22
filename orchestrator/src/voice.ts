import type { Attention, Run } from './types.ts'
import { loadConfig, secret, integrations } from './config.ts'
import { runs, attention, assignment } from './store.ts'
import { spec } from './agents.ts'

const API = 'https://api.elevenlabs.io'
const key = () => secret('ELEVENLABS_API_KEY')

async function check(res: Response) {
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res
}

export async function transcribe(audio: Buffer, mime: string): Promise<string> {
  if (!key()) throw new Error('ELEVENLABS_API_KEY is not set')
  const form = new FormData()
  form.set('model_id', secret('ELEVENLABS_STT_MODEL') || 'scribe_v1')
  form.set('file', new Blob([audio], { type: mime }), 'speech.' + (mime.includes('mp4') ? 'mp4' : 'webm'))
  const res = await check(await fetch(`${API}/v1/speech-to-text`, { method: 'POST', headers: { 'xi-api-key': key() }, body: form }))
  return ((await res.json()) as { text: string }).text.trim()
}

export async function speak(text: string): Promise<Buffer> {
  if (!key()) throw new Error('ELEVENLABS_API_KEY is not set')
  const voice = secret('ELEVENLABS_VOICE_ID') || '21m00Tcm4TlvDq8ikWAM'
  const res = await check(
    await fetch(`${API}/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': key(), 'content-type': 'application/json' },
      body: JSON.stringify({ text, model_id: secret('ELEVENLABS_TTS_MODEL') || 'eleven_flash_v2_5' }),
    }),
  )
  return Buffer.from(await res.arrayBuffer())
}

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

// Short status meant to be read aloud.
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

// Ring the developer through ElevenLabs Agents + Twilio and explain what happened.
export async function call(a: Attention): Promise<string> {
  const s = loadConfig().settings
  if (!integrations().phoneCalls) throw new Error('Phone calls need ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID and ELEVENLABS_PHONE_NUMBER_ID')
  if (!s.phoneNumber) throw new Error('No phone number set in Settings')
  const res = await check(
    await fetch(`${API}/v1/convai/twilio/outbound-call`, {
      method: 'POST',
      headers: { 'xi-api-key': key(), 'content-type': 'application/json' },
      body: JSON.stringify({
        agent_id: secret('ELEVENLABS_AGENT_ID'),
        agent_phone_number_id: secret('ELEVENLABS_PHONE_NUMBER_ID'),
        to_number: s.phoneNumber,
        conversation_initiation_client_data: {
          dynamic_variables: { event_message: describe(a), run_id: a.runId, task_id: a.taskId || '', status_summary: summary(a.runId) },
        },
      }),
    }),
  )
  const body = (await res.json()) as { success: boolean; message: string; callSid?: string }
  if (!body.success) throw new Error(body.message)
  return body.callSid || 'started'
}
