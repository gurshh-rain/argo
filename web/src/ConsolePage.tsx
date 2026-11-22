import { useRef, useState } from 'react'
import { useQuery, getDashboard, startTask, sendFollowup, approveRun, transcribeAudio, speakStatus } from 'wasp/client/operations'
import { record, say, type Recorder } from './voice'
import { Link } from 'react-router'
import './app.css'

const pretty = (s: string) => s.replace(/_/g, ' ')

export function ConsolePage() {
  const { data, error, refetch } = useQuery(getDashboard, undefined, { refetchInterval: 2000 })
  const [transcript, setTranscript] = useState<string | null>(null)
  const [listening, setListening] = useState(false)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const recorder = useRef<Recorder | null>(null)

  const guard = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label)
    setNotice('')
    try {
      await fn()
      await refetch()
    } catch (e: any) {
      setNotice(e?.message || 'Something went wrong.')
    } finally {
      setBusy('')
    }
  }

  if (error) return <main className="console"><p className="notice">{error.message}</p></main>
  if (!data) return <main className="console"><p className="dim">Connecting…</p></main>

  const current = data.runs.find((r) => !['cancelled', 'failed'].includes(r.status))

  const toggleMic = () =>
    guard(listening ? 'transcribing' : '', async () => {
      if (!listening) {
        recorder.current = await record(data.elevenlabs)
        setListening(true)
        return
      }
      setListening(false)
      const out = await recorder.current!.stop()
      const text = out.text ?? (await transcribeAudio({ audio: out.audio!, mime: out.mime! })).text
      if (!text) throw new Error("I didn't catch anything. Try again.")
      setTranscript(text)
    })

  const submit = (kind: 'task' | 'followup') =>
    guard(kind, async () => {
      if (kind === 'task') await startTask({ transcript: transcript! })
      else {
        const r = await sendFollowup({ runId: current!.id, transcript: transcript! })
        setNotice(r.action === 'queued' ? 'Follow-up queued as a new subtask.' : `Blocked subtask ${r.action}.`)
      }
      setTranscript(null)
    })

  return (
    <main className="console">
      <nav>
        <span className="brand">Argo</span>
        <Link to="/" className="link">Home</Link>
      </nav>

      {data.error && <p className="notice">{data.error}</p>}
      {notice && <p className="notice">{notice}</p>}

      <section className="mic">
        <button className={`micbtn ${listening ? 'on' : ''}`} onClick={toggleMic} disabled={!!busy} aria-label={listening ? 'Stop recording' : 'Start recording'}>
          {busy === 'transcribing' ? '…' : listening ? '■' : '🎙'}
        </button>
        <p className="dim">{listening ? 'Listening. Tap to stop.' : busy === 'transcribing' ? 'Transcribing…' : 'Tap and speak a task or a follow-up.'}</p>
        <button className="btn ghost" disabled={!!busy} onClick={() => guard('status', async () => say(await speakStatus({ runId: current?.id })))}>
          {busy === 'status' ? 'Preparing…' : '🔊 Speak status'}
        </button>
        <p className="dim tiny">{data.elevenlabs ? 'Voice by ElevenLabs' : 'ElevenLabs key not set on the Mac: using this phone’s built-in speech.'}</p>
      </section>

      {transcript !== null && (
        <section className="card confirm">
          <h4>Check the transcript before sending</h4>
          <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={4} />
          <div className="row">
            {current && <button className="btn" disabled={!!busy || !transcript.trim()} onClick={() => submit('followup')}>Send as follow-up</button>}
            <button className={current ? 'btn ghost' : 'btn'} disabled={!!busy || !transcript.trim()} onClick={() => submit('task')}>Start new task</button>
            <button className="link" onClick={() => setTranscript(null)}>Discard</button>
          </div>
          {current && <p className="dim tiny">Follow-up goes to: {current.goal.slice(0, 80)}</p>}
        </section>
      )}
      {transcript === null && (
        <button className="link center" onClick={() => setTranscript('')}>or type instead</button>
      )}

      {data.runs.length === 0 && <p className="dim center">No runs yet. Speak a task to start one.</p>}
      {data.runs.map((r) => (
        <section key={r.id} className={`card ${r.attention.length ? 'ring' : ''}`}>
          <div className="row between">
            <span className={`pill s-${r.status}`}>{pretty(r.status)}</span>
            <span className="dim tiny">{r.project}</span>
          </div>
          <h4>{r.goal}</h4>
          {r.attention.map((a, i) => <p key={i} className="attn">{a}</p>)}
          {r.status === 'awaiting_approval' && (
            <button className="btn" disabled={!!busy} onClick={() => guard('approve', () => approveRun({ runId: r.id }))}>Approve plan &amp; run</button>
          )}
          <ul className="tasks">
            {r.tasks.map((t) => (
              <li key={t.id}>
                <span className={`dot s-${t.status}`} />
                <div>
                  <div>{t.title}</div>
                  <div className="who">
                    {t.agent} · {t.model} · {t.reasoning}
                    {t.overridden && <em> · override</em>} · {pretty(t.status)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {r.report && (
            <div className="report">
              {r.report.completed.map((c, i) => <p key={i} className="ok">✓ {c}</p>)}
              {r.report.attention.map((c, i) => <p key={i} className="attn">! {c}</p>)}
            </div>
          )}
        </section>
      ))}
    </main>
  )
}
