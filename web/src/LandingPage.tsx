import { Link } from 'react-router'
import { ProductMedia } from './ProductMedia'
import { landingMedia } from './landingMedia'
import { Brand, Icon, ThemeToggle } from './ui'
import type { IconName } from './ui'
import './app.css'

const repository = 'https://github.com/gurshh-rain/yc-hacky'
const features: { icon: IconName; title: string; description: string }[] = [
  { icon: 'layers', title: 'A worktree for every task.', description: 'Independent agents work in parallel, each in its own git worktree. Your main checkout stays out of the crossfire.' },
  { icon: 'swap', title: 'The right agent for the job.', description: 'Let Argo route the work, or choose the agent, model, and reasoning level yourself. Every assignment is yours to change.' },
  { icon: 'shield', title: 'Your code. Your final say.', description: 'Changes come together in an integration branch, pass through checks and an independent review, then wait for your merge.' },
]

function MacIcon() {
  return <svg width="17" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.1 12.3c0-2 1.6-3 1.7-3.1-1-1.4-2.5-1.6-3-1.6-1.3-.1-2.5.8-3.2.8-.6 0-1.6-.8-2.7-.8-1.4 0-2.7.8-3.4 2-1.4 2.5-.4 6.2 1 8.2.6 1 1.4 2 2.4 2 1 0 1.4-.6 2.7-.6 1.3 0 1.6.6 2.7.6s1.7-1 2.4-2c.8-1.1 1.1-2.2 1.1-2.3-.1 0-2.1-.8-2.1-3.2ZM15 6.3c.5-.7.9-1.6.8-2.5-.8 0-1.8.6-2.4 1.2-.5.6-1 1.5-.9 2.4.9.1 1.9-.5 2.5-1.1Z" /></svg>
}

export function LandingPage() {
  return (
    <div className="landing">
      <a className="skip-link" href="#main">Skip to content</a>
      <nav className="site-nav section-shell" aria-label="Main navigation">
        <Link to="/" aria-label="Argo home"><Brand /></Link>
        <div className="nav-links"><a href="#features">Features</a><a href="#film">Product film</a><a href={repository} target="_blank" rel="noreferrer">GitHub</a></div>
        <div className="nav-actions"><ThemeToggle /><a href="#download" className="button button-primary button-small">Get Argo for Mac</a></div>
      </nav>

      <main id="main">
        <header className="hero section-shell">
          <h1>Your coding crew.<br /><span>Right at home on Mac.</span></h1>
          <p>Claude Code, Codex, and Devin. Working together.<br className="desktop-break" /> Plan, build, and review in one native workspace.</p>
          <div className="hero-actions"><a href={repository} className="button button-primary" target="_blank" rel="noreferrer"><MacIcon />Get Argo for Mac</a><a href="#film" className="button button-secondary"><Icon name="play" width="15" height="15" />See it in action</a></div>
          <span className="hero-requirements">macOS 14 or later · Available from source on GitHub</span>
        </header>

        <section className="hero-media section-shell" id="film" aria-label="Argo product film">
          <ProductMedia media={landingMedia.hero} caption="One task. The right agents. Everything coming together." />
        </section>

        <section className="workflow section-shell" id="features" aria-labelledby="features-title">
          <div className="section-intro"><div><span className="eyebrow">BUILT FOR THE WAY YOU BUILD</span><h2 id="features-title">A whole crew.<br />A single place to work.</h2></div><p>Keep your agents, context, and changes<br />together. Keep your focus on the idea.</p></div>
          <div className="workflow-grid">{features.map((item) => <article key={item.title}><span className="feature-icon"><Icon name={item.icon} width="25" height="25" /></span><h3>{item.title}</h3><p>{item.description}</p></article>)}</div>
        </section>

        <section className="download-section section-shell" id="download" aria-labelledby="download-title">
          <div className="download-card"><span className="download-app-icon"><span className="brand-symbol" aria-hidden="true"><img src="/argo.png" alt="" width="1728" height="2304" /></span></span><span className="eyebrow">YOUR NEXT WORKSPACE</span><h2 id="download-title">Make room for your crew.</h2><p>A native Mac app for the agents you already use.</p><a href={repository} className="button button-primary" target="_blank" rel="noreferrer"><MacIcon />Get Argo for Mac</a><span className="download-source-note">Build from source · macOS 14 or later</span><details className="build-instructions"><summary>Building from source?</summary><p>Clone the repository, install Node.js 24 or later, and have at least one coding agent CLI installed. From the repository root, run:</p><code>mac/build.sh</code><p>Then open <code>mac/build/Argo.app</code>.</p><a href={`${repository}#run-it`} target="_blank" rel="noreferrer">Read the setup instructions on GitHub</a></details></div>
        </section>
      </main>

      <footer className="site-footer section-shell"><div><Link to="/" aria-label="Argo home"><Brand /></Link><span>A home for your coding crew.</span></div><div><a href="#features">Features</a><a href="#film">Product film</a><a href={repository} target="_blank" rel="noreferrer">GitHub</a><a href="https://wasp.sh/" target="_blank" rel="noreferrer">Built with Wasp</a></div></footer>
    </div>
  )
}
