import { useState } from 'react'
import { Link } from 'react-router'
import { ProductMedia } from './ProductMedia'
import { landingMedia } from './landingMedia'
import { Brand, Icon, ThemeToggle } from './ui'
import type { IconName } from './ui'
import './app.css'

const repository = 'https://github.com/gurshh-rain/yc-hacky'
// Direct link to the DMG attached to the latest GitHub release. The file name is what mac/package.sh
// produces (Argo-<version>-<arch>.dmg); update it when you publish a new version.
const dmgUrl = `${repository}/releases/latest/download/Argo-0.1.2-arm64.dmg`

type Feature = { icon: IconName; title: string; description: string; span: string; shot: string; alt: string; focus?: string }
const features: Feature[] = [
  { icon: 'layers', title: 'A worktree for every task.', description: 'Independent agents work in parallel, each in its own git worktree. Your main checkout stays out of the crossfire.', span: 'cv-span-4', shot: '/media/app/workspaces.jpg', alt: 'Argo sidebar with workspaces, and the Worktree and Add member controls', focus: 'left top' },
  { icon: 'swap', title: 'The right agent for the job.', description: 'Let Argo route the work, or pick the agent, model and reasoning level yourself.', span: 'cv-span-2', shot: '/media/app/agent.jpg', alt: 'A subtask pane labelled Claude Code, haiku, low reasoning, chosen automatically', focus: 'right top' },
  { icon: 'shield', title: 'Your code. Your final say.', description: 'Changes merge into an integration branch, pass checks and an independent review, then wait for you.', span: 'cv-span-2', shot: '/media/app/report.jpg', alt: 'The orchestrator report listing what is complete and what needs attention', focus: 'left top' },
  { icon: 'terminal', title: 'Steer it as it runs.', description: 'Send a follow-up to a running task, or start a new one, from the same composer.', span: 'cv-span-2', shot: '/media/app/composer.jpg', alt: 'The task composer', focus: 'left bottom' },
  { icon: 'activity', title: 'Know when they need you.', description: 'A blocked agent, a failure or a finished run raises a notification ring and a macOS notification.', span: 'cv-span-2', shot: '/media/app/status.jpg', alt: 'Agent status for Claude Code, Codex and Devin', focus: 'left center' },
]

function MacIcon() {
  return <svg width="17" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.1 12.3c0-2 1.6-3 1.7-3.1-1-1.4-2.5-1.6-3-1.6-1.3-.1-2.5.8-3.2.8-.6 0-1.6-.8-2.7-.8-1.4 0-2.7.8-3.4 2-1.4 2.5-.4 6.2 1 8.2.6 1 1.4 2 2.4 2 1 0 1.4-.6 2.7-.6 1.3 0 1.6.6 2.7.6s1.7-1 2.4-2c.8-1.1 1.1-2.2 1.1-2.3-.1 0-2.1-.8-2.1-3.2ZM15 6.3c.5-.7.9-1.6.8-2.5-.8 0-1.8.6-2.4 1.2-.5.6-1 1.5-.9 2.4.9.1 1.9-.5 2.5-1.1Z" /></svg>
}

function GitHubIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.1c-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.34.96.1-.74.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" /></svg>
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(command); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* Clipboard is optional. */ }
  }
  return <div className="cv-code"><code>{command}</code><button type="button" onClick={copy} aria-label="Copy command"><Icon name={copied ? 'check' : 'code'} width="15" height="15" /></button></div>
}

export function LandingPage() {
  return (
    <div className="cv">
      <a className="skip-link" href="#main">Skip to content</a>
      <div className="cv-column">
        <header className="cv-header">
          <Link to="/" aria-label="Argo home"><Brand /></Link>
          <nav aria-label="Main navigation">
            <a href={repository} target="_blank" rel="noreferrer" className="cv-icon-link" aria-label="Argo on GitHub"><GitHubIcon /></a>
            <ThemeToggle />
            <a href={dmgUrl} className="cv-pill">Download</a>
          </nav>
        </header>

        <main id="main">
          <section className="cv-hero cv-section">
            <h1>Your coding crew.<br />Right at home on Mac.</h1>
            <p>Run Claude Code, Codex and Devin side by side, each in its own worktree, on your Mac, and check in from anywhere.</p>
            <div className="cv-hero-actions"><a href={dmgUrl} className="cv-pill cv-pill-lg">Download for Mac</a></div>
            <div className="cv-film" id="film"><ProductMedia media={landingMedia.hero} /></div>
          </section>

          <section className="cv-section" id="features" aria-labelledby="features-title">
            <p className="cv-eyebrow">Features</p>
            <h2 id="features-title">Everything you need to run a crew of agents.</h2>
            <div className="cv-grid">
              {features.map((f) => (
                <article key={f.title} className={`cv-card ${f.span}`}>
                  <span className="cv-card-icon"><Icon name={f.icon} width="22" height="22" /></span>
                  <h3>{f.title}</h3>
                  <p>{f.description}</p>
                  <div className="cv-shot"><img src={f.shot} alt={f.alt} loading="lazy" decoding="async" style={{ objectPosition: f.focus }} /></div>
                </article>
              ))}
            </div>
          </section>

          <section className="cv-section" id="app" aria-labelledby="app-title">
            <p className="cv-eyebrow">The app</p>
            <h2 id="app-title">Your whole crew, in one window.</h2>
            <div className="cv-window cv-window-section">
              <div className="cv-window-bar" aria-hidden="true"><span /><span /><span /></div>
              <img src="/media/app/app.jpg" alt="Argo on Mac: workspaces in the sidebar, an agent's subtask output, and the orchestrator's report" width="1600" height="1263" />
            </div>
          </section>

          <section className="cv-section" id="download" aria-labelledby="download-title">
            <h2 id="download-title">Runs wherever you work.</h2>
            <div className="cv-grid cv-where">
              <article className="cv-card cv-span-3">
                <h3>Mac</h3>
                <p>Native SwiftUI app with a tab per run, split agent panes and notification rings.</p>
                <a href={dmgUrl} className="cv-pill cv-pill-block"><MacIcon />Download the DMG</a>
              </article>
              <article className="cv-card cv-span-3">
                <h3>From source</h3>
                <p>Needs macOS 14, Node 24 and one coding agent CLI.</p>
                <CopyCommand command="mac/build.sh" />
              </article>
            </div>
          </section>
        </main>

        <footer className="cv-footer">
          <div className="cv-footer-top">
            <div><Brand /><p>A home for your coding crew.</p></div>
            <div><h4>Product</h4><a href="#features">Features</a><a href="#film">Product film</a><a href={dmgUrl}>Download for Mac</a></div>
            <div><h4>Resources</h4><a href={repository} target="_blank" rel="noreferrer">GitHub</a><a href={`${repository}#run-it`} target="_blank" rel="noreferrer">Setup guide</a><a href="https://wasp.sh/" target="_blank" rel="noreferrer">Built with Wasp</a></div>
          </div>
          <p className="cv-legal">© 2026 Argo</p>
        </footer>
      </div>
    </div>
  )
}
