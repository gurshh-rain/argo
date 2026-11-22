import { useState } from 'react'
import { useQuery, getDashboard, startTask, sendFollowup, approveRun } from 'wasp/client/operations'
import { Link } from 'react-router'
import { Brand, Icon, ThemeToggle } from './ui'
import './app.css'

const pretty = (s: string) => s.replace(/_/g, ' ')

export function ConsolePage() {
  const { data, error, refetch, isFetching } = useQuery(getDashboard, undefined, { refetchInterval: 2000 })
  const [transcript, setTranscript] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')

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

  const current = data?.runs.find((r) => !['cancelled', 'failed'].includes(r.status))
  const connected = !!data && !data.error && !error
  const unavailable = error?.message || data?.error
  const canSend = connected && !busy && !!transcript?.trim()

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
    <div className="console-page">
      <a className="skip-link" href="#console-main">Skip to workspace</a>
      <nav className="console-nav section-shell" aria-label="Console navigation"><div><Link to="/" aria-label="Argo home"><Brand /></Link><span className="console-breadcrumb">Console</span></div><div className="nav-actions"><ThemeToggle /><Link to="/" className="console-home">Back to home</Link></div></nav>
      <main className="console section-shell" id="console-main">
        <header className="console-heading"><div><span className="eyebrow">YOUR WORKSPACE</span><h1>A little direction. A lot of progress.</h1><p>Start a task, check on your crew, or tell them what’s next.</p></div><span className={`connection-state ${connected ? 'is-connected' : ''}`} role="status"><i />{connected ? 'Connected to your Mac' : unavailable ? 'Mac unavailable' : 'Connecting to your Mac'}</span></header>

        {unavailable && <div className="notice" role="alert"><div><strong>Your workspace is out of reach.</strong>{unavailable}</div><button type="button" onClick={() => void refetch()} disabled={isFetching}>Retry</button></div>}
        {notice && <div className="notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Dismiss notice"><Icon name="close" width="16" height="16" /></button></div>}

        <div className="console-grid">
          <section className="composer" aria-labelledby="composer-title">
            <h2 id="composer-title">What are we building?</h2><p>Describe a new task or give your crew a little direction.</p>
            <label htmlFor="task-transcript">{transcript !== null ? 'Review your request' : 'Your task'}</label>
            <textarea id="task-transcript" value={transcript ?? ''} onChange={(e) => setTranscript(e.target.value)} rows={4} maxLength={4000} disabled={!!busy} placeholder="Add rate limiting to the API and document it…" />
            <div className="composer-actions">
              {current && <button type="button" className="button button-primary" disabled={!canSend} onClick={() => submit('followup')}>{busy === 'followup' ? 'Sending follow-up…' : 'Send as follow-up'}</button>}
              <button type="button" className={`button ${current ? 'button-secondary' : 'button-primary'}`} disabled={!canSend} onClick={() => submit('task')}>{busy === 'task' ? 'Starting your task…' : 'Start a new task'}</button>
              {transcript !== null && <button type="button" className="composer-discard" disabled={!!busy} onClick={() => setTranscript(null)}>Clear request</button>}
            </div>
            {current && <p className="composer-context">Following up on: {current.goal.slice(0, 100)}</p>}
          </section>

          <section aria-labelledby="runs-title">
            <div className="runs-heading"><div><h2 id="runs-title">Recent runs</h2>{data && <span className="run-count">{data.runs.length}</span>}</div><button type="button" className="icon-button" onClick={() => void refetch()} disabled={isFetching} aria-label="Refresh runs"><Icon name="refresh" width="17" height="17" /></button></div>
            {!data && !error && <div className="loading-runs" role="status"><Icon name="refresh" className="spin" width="24" height="24" /><p>Finding your workspace…</p></div>}
            {((data && data.runs.length === 0) || (!data && error)) && <div className="empty-runs"><span className="empty-icon"><Icon name="layers" width="28" height="28" /></span><h3>{unavailable ? 'Your crew is on your Mac.' : 'A fresh start. A ready crew.'}</h3><p>{unavailable ? 'Open Argo on your Mac to connect your workspace and see your runs here.' : 'Give Argo one task. Your plan, agents, and progress will come together here.'}</p><Link to="/#features">Explore Argo for Mac</Link></div>}
            <div className="run-list">{data?.runs.map((r) => (
              <article key={r.id} className={`run-card ${r.attention.length ? 'needs-attention' : ''}`}>
                <div className="run-card-top"><span className={`pill s-${r.status}`}>{pretty(r.status)}</span><span className="run-project"><Icon name="branch" width="13" height="13" />{r.project}</span></div>
                <h3>{r.goal}</h3>
                {r.attention.map((a, i) => <p key={i} className="attn">{a}</p>)}
                {r.status === 'awaiting_approval' && <button type="button" className="button button-primary" disabled={!!busy || !connected} onClick={() => guard('approve', () => approveRun({ runId: r.id }))}>{busy === 'approve' ? 'Approving plan…' : 'Approve plan & run'}</button>}
                <ul className="tasks">{r.tasks.map((t) => <li key={t.id}><span className={`dot s-${t.status}`} /><div className="task-text"><div className="task-title">{t.title}</div><div className="task-meta">{t.agent} · {t.model} · {t.reasoning}{t.overridden && <em> · override</em>}</div>{t.error && <p className="attn">{t.error}</p>}</div><span className={`task-status s-${t.status}`}>{pretty(t.status)}</span></li>)}</ul>
                {r.report && <div className="report">{r.report.completed.map((c, i) => <p key={i} className="ok"><Icon name="check" width="16" height="16" />{c}</p>)}{r.report.attention.map((c, i) => <p key={i} className="attn">{c}</p>)}</div>}
              </article>
            ))}</div>
          </section>
        </div>
        <p className="console-footer">Your agents on your Mac. Your workspace wherever you are.</p>
      </main>
    </div>
  )
}
