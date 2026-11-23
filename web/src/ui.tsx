import { useEffect, useState } from 'react'
import type { SVGProps } from 'react'

const paths = {
  mic: <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  play: <path d="m9 5 11 7-11 7Z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  volume: <path d="m11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />,
  branch: <><circle cx="6" cy="5" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="19" r="3" /><path d="M6 8v8m12-7a9 9 0 0 1-9 9" /></>,
  layers: <path d="m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5" />,
  shield: <><path d="m12 3 9 4v5c0 5-9 10-9 10S3 17 3 12V7Z" /><path d="m8 12 3 3 5-6" /></>,
  phone: <><rect x="6" y="2" width="12" height="20" rx="3" /><path d="M10 18h4" /></>,
  monitor: <><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M12 17v4m-4 0h8" /></>,
  terminal: <><rect x="2" y="3" width="20" height="18" rx="3" /><path d="m6 8 4 4-4 4m7 0h5" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m8 10 4 4 4-4" />,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 6a8 8 0 0 1 13 2M5 16a8 8 0 0 0 13 2" /></>,
  code: <path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  activity: <path d="M2 12h4l3-8 6 16 3-8h4" />,
  swap: <path d="M3 7h17l-4-4m5 14H4l4 4M20 7l-4 4M4 17l4-4" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  spark: <path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
  moon: <path d="M20 14A8.5 8.5 0 0 1 10 4a8.5 8.5 0 1 0 10 10Z" />,
} as const

export type IconName = keyof typeof paths

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>
}

export function Brand() {
  return <span className="brand"><span className="brand-symbol" aria-hidden="true"><img src="/media/argo.png" alt="" width="1728" height="2304" /></span><span>argo</span></span>
}

export function ThemeToggle() {
  // Use the same initial markup on the server and client, then restore the preference.
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  useEffect(() => {
    let saved: 'dark' | 'light' = 'dark'
    try { if (localStorage.getItem('argo-theme') === 'light') saved = 'light' } catch { /* Storage is optional. */ }
    setTheme(saved)
    applyTheme(saved)
  }, [])

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    applyTheme(next)
    try { localStorage.setItem('argo-theme', next) } catch { /* The toggle still works without storage. */ }
  }

  return <button type="button" className="theme-toggle icon-button" onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}><Icon name={theme === 'dark' ? 'sun' : 'moon'} width="18" height="18" /></button>
}

function applyTheme(theme: 'dark' | 'light') {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#111214' : '#fcfcfc')
}

