import { timingSafeEqual } from 'node:crypto'
import type { VoiceStatusHook, VoiceInstructHook } from 'wasp/server/api'
import { daemon } from './daemon'

// These are called by the ElevenLabs agent while it is on the phone with the developer.
// They are disabled unless ARGO_HOOK_SECRET is set, and require it on every call.
function authorised(req: { headers: Record<string, any> }): boolean {
  const secret = process.env.ARGO_HOOK_SECRET || ''
  const given = String(req.headers['x-argo-secret'] || '')
  return secret.length >= 16 && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret))
}

export const voiceStatusHook: VoiceStatusHook = async (req, res) => {
  if (!authorised(req)) return res.status(401).json({ error: 'unauthorised' })
  try {
    const runId = typeof req.body?.run_id === 'string' && req.body.run_id ? req.body.run_id : undefined
    const { text } = await daemon('GET', `summary${runId ? `?run=${encodeURIComponent(runId)}` : ''}`)
    res.json({ summary: text })
  } catch (e: any) {
    res.status(502).json({ error: e.message })
  }
}

export const voiceInstructHook: VoiceInstructHook = async (req, res) => {
  if (!authorised(req)) return res.status(401).json({ error: 'unauthorised' })
  try {
    const text = String(req.body?.instruction || '').trim()
    if (!text) return res.status(400).json({ error: 'instruction is required' })
    let runId = String(req.body?.run_id || '')
    if (!runId) {
      const s = await daemon('GET', 'state')
      runId = s.runs[0]?.id
      if (!runId) {
        const run = await daemon('POST', 'runs', { goal: text })
        return res.json({ result: `Started a new run: ${run.goal}` })
      }
    }
    const out = await daemon('POST', `runs/${encodeURIComponent(runId)}/instruct`, { text, source: 'phone-call' })
    res.json({ result: out.action === 'queued' ? 'The instruction was queued as a new subtask.' : `The blocked subtask was ${out.action}.` })
  } catch (e: any) {
    res.status(502).json({ error: e.message })
  }
}
