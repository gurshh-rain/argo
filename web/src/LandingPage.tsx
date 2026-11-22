import { Link } from 'react-router'
import './app.css'

const features = [
  ['One task in', 'Say or type one high-level request. Argo plans it, splits it into subtasks and works out which depend on which.'],
  ['The right agent for each part', 'Claude Code, Codex and Devin each get the work that suits them, by strength, reasoning needed, speed and cost.'],
  ['A worktree for every subtask', 'Independent subtasks run at once, each in its own git worktree, sharing one project record of goals and decisions.'],
  ['Override anything', 'Click any agent label to change the agent, model or reasoning level for a single subtask.'],
  ['They call you', 'When an agent is blocked, fails or finishes, your phone rings. Tell it what to do and it reaches the right agent.'],
  ['Nothing lands until you say so', 'Work merges into an integration branch, gets checked and reviewed by a different agent, and waits for your merge.'],
]

const where = [
  ['Mac', 'Native SwiftUI app with a tab per run, split agent panes and notification rings.'],
  ['Phone', 'Speak a task, confirm the transcript, hear a spoken status. Works from any browser.'],
  ['Local daemon', 'A zero-dependency Node orchestrator on your machine. Your code never leaves it.'],
]

export function LandingPage() {
  return (
    <div className="lp">
      <nav className="lp-nav">
        <span className="lp-brand">Argo</span>
        <Link to="/app" className="lp-btn sm">Open console</Link>
      </nav>

      <header className="lp-hero">
        <h1>The voice-controlled home<br />for your coding agents.</h1>
        <p>Run Claude Code, Codex and Devin side by side, each in its own worktree, on your Mac. Check in or redirect them by speaking from your phone.</p>
        <Link to="/app" className="lp-btn">Open console</Link>
        <pre className="lp-term">{`❯ add rate limiting to the API and document it
  t1 limiter middleware     → Codex · high          running
  t2 config + env docs      → Claude Code · haiku   running
  t3 integration tests      → Claude Code · sonnet  waits for t1
  ☎ calling you: Codex needs permission to run the migration`}</pre>
      </header>

      <section className="lp-section">
        <h2>Everything you need to run a crew of agents.</h2>
        <div className="lp-bento">
          {features.map(([t, d]) => (
            <div key={t} className="lp-card">
              <h3>{t}</h3>
              <p>{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-section">
        <h2>Runs wherever you work.</h2>
        <div className="lp-where">
          {where.map(([t, d]) => (
            <div key={t} className="lp-card tall">
              <h3>{t}</h3>
              <p>{d}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="lp-foot">
        <span>The perfect home for your agents.</span>
        <span>Built with Wasp, ElevenLabs and Twilio.</span>
      </footer>
    </div>
  )
}
