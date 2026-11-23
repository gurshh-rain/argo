import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomInt, timingSafeEqual } from 'node:crypto'
import { resolve as resolvePath, join } from 'node:path'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { loadConfig, saveConfig, integrations } from './config.ts'
import { runs, attention, subscribe, readLog, save } from './store.ts'
import { agents } from './agents.ts'
import * as engine from './engine.ts'
import * as g from './git.ts'
import { summary, describe } from './status.ts'
import type { Run, Settings } from './types.ts'

// Identifies this exact orchestrator code. The Mac app hashes its bundled copy the same way and replaces
// an orchestrator left running from an older build (which would answer "Not found" to newer features).
const srcDir = import.meta.dirname
export const BUILD = (() => {
  const h = createHash('sha256')
  for (const f of readdirSync(srcDir).filter((f) => f.endsWith('.ts')).sort()) h.update(readFileSync(join(srcDir, f)))
  return h.digest('hex').slice(0, 12)
})()

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function body(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > 30 << 20) throw new HttpError(413, 'Body too large')
    chunks.push(c)
  }
  if (!chunks.length) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString()) } catch { throw new HttpError(400, 'Invalid JSON') }
}

const run = (id: string): Run => {
  const r = runs.get(id)
  if (!r) throw new HttpError(404, `No run ${id}`)
  return r
}

// One-time pairing code shown in the Mac app; a phone account must present it before it can control anything.
let pair = { code: '', expires: 0, fails: 0 }
function pairCode() {
  if (Date.now() > pair.expires || pair.fails >= 5) pair = { code: String(randomInt(100000, 1000000)), expires: Date.now() + 10 * 60_000, fails: 0 }
  return pair
}

function state() {
  const cfg = loadConfig()
  return {
    agents: agents(),
    settings: cfg.settings,
    integrations: integrations(),
    projects: cfg.projects,
    runs: [...runs.values()].sort((a, b) => b.createdAt - a.createdAt),
    attention: attention.filter((a) => !a.resolved).map((a) => ({ ...a, spoken: describe(a) })),
    summary: summary(),
  }
}

function updateSettings(patch: Partial<Settings>) {
  const s = loadConfig().settings
  const ids = ['auto', ...agents().map((a) => a.id)]
  if (patch.defaultAgent !== undefined) {
    if (!ids.includes(patch.defaultAgent)) throw new HttpError(400, 'Unknown agent')
    s.defaultAgent = patch.defaultAgent
  }
  if (patch.reasoning !== undefined) {
    if (!['low', 'medium', 'high'].includes(patch.reasoning)) throw new HttpError(400, 'Unknown reasoning level')
    s.reasoning = patch.reasoning
  }
  if (patch.models) for (const [k, v] of Object.entries(patch.models)) if (ids.includes(k)) s.models[k] = String(v)
  if (patch.autoApprove !== undefined) s.autoApprove = !!patch.autoApprove
  if (patch.maxParallel !== undefined) s.maxParallel = Math.max(1, Math.min(8, Number(patch.maxParallel) || 3))
  if (patch.checks !== undefined) s.checks = (patch.checks as string[]).map(String).filter(Boolean)
  if (patch.publicUrl !== undefined) s.publicUrl = String(patch.publicUrl).trim().replace(/\/$/, '')
  saveConfig()
  return s
}

async function route(req: IncomingMessage, res: ServerResponse, url: URL): Promise<unknown> {
  const p = url.pathname.split('/').filter(Boolean).slice(1) // drop "api"
  const m = req.method
  const at = (...shape: (string | null)[]) => p.length === shape.length && shape.every((s, i) => s === null || s === p[i])

  if (m === 'GET' && at('state')) return state()
  if (m === 'POST' && at('quit')) {
    setTimeout(() => process.exit(0), 100)
    return { ok: true }
  }
  if (m === 'GET' && at('summary')) return { text: summary(url.searchParams.get('run') || undefined) }
  if (m === 'PUT' && at('settings')) return updateSettings(await body(req))
  if (m === 'GET' && at('pair')) return { code: pairCode().code, expires: pair.expires }
  if (m === 'POST' && at('pair', 'verify')) {
    const { code } = await body(req)
    const cur = pairCode()
    if (String(code) !== cur.code) {
      cur.fails++
      throw new HttpError(403, 'Wrong or expired pairing code')
    }
    pair.expires = 0 // single use
    return { ok: true }
  }
  if (m === 'GET' && at('events')) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    res.write(': connected\n\n')
    const off = subscribe((e) => res.write(`data: ${JSON.stringify(e)}\n\n`))
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000)
    req.on('close', () => (off(), clearInterval(ping)))
    return res
  }
  if (m === 'POST' && at('runs')) {
    const b = await body(req)
    // no project means a research run in a scratch folder; the phone falls back to the most recent project
    const chosen = b.project ?? (b.research ? '' : loadConfig().projects[0] || '')
    const project = chosen ? resolvePath(String(chosen)) : ''
    return engine.startRun(project, String(b.goal || ''), { constraints: b.constraints, autoApprove: b.autoApprove, terminals: !!b.terminals })
  }
  if (p[0] === 'runs' && p[1]) {
    const r = run(p[1])
    if (m === 'GET' && at('runs', null)) return r
    if (m === 'DELETE' && at('runs', null)) return engine.deleteRun(r)
    if (m === 'GET' && at('runs', null, 'logs')) {
      const tail = Number(url.searchParams.get('tail')) || 300
      return Object.fromEntries(['orchestrator', ...r.tasks.map((t) => t.id)].map((id) => [id, readLog(r, id, tail)]))
    }
    if (m === 'POST' && at('runs', null, 'approve')) return engine.approve(r), r
    if (m === 'POST' && at('runs', null, 'cancel')) return engine.cancel(r), r
    if (m === 'POST' && at('runs', null, 'apply')) return { output: await engine.applyRun(r) }
    if (m === 'POST' && at('runs', null, 'instruct')) {
      const b = await body(req)
      return engine.instruct(r, String(b.text || ''), String(b.source || 'mac'))
    }
    if (m === 'PATCH' && at('runs', null, 'tasks', null)) {
      const b = await body(req)
      return engine.override(r, p[3], b.clear ? null : { agent: b.agent, model: b.model, reasoning: b.reasoning })
    }
    if (m === 'POST' && at('runs', null, 'tasks', null, 'claim')) return engine.claim(r, p[3], String((await body(req)).terminal || 'terminal'))
    if (m === 'POST' && at('runs', null, 'tasks', null, 'requeue')) return engine.requeue(r, p[3]), r
    if (m === 'POST' && at('runs', null, 'tasks', null, 'background')) return engine.runInBackground(r, p[3]), r
    if (m === 'POST' && at('runs', null, 'tasks', null, 'retry')) return engine.retry(r, p[3], (await body(req)).instruction), r
  }
  // Worktrees you open yourself: each starts from the newest remote code and gets its own branch.
  if (at('worktrees') || at('worktrees', null)) {
    const b = m === 'GET' ? {} : await body(req)
    const project = resolvePath(String(b.project || url.searchParams.get('project') || ''))
    if (!project || project === '/') throw new HttpError(400, 'Choose a project first')
    if (m === 'GET' && at('worktrees')) {
      const up = url.searchParams.get('fetch') && (await g.upstreamOf(project))
      if (up) await g.fetchRemote(project, up)
      return g.listWorktrees(project)
    }
    if (m === 'POST' && at('worktrees')) return g.addWorktree(project, String(b.name || ''))
    if (m === 'POST' && at('worktrees', 'pull')) return g.syncWorktree(project, String(b.path || ''))
    if (m === 'POST' && at('worktrees', 'remove')) return g.deleteWorktree(project, String(b.path || ''), !!b.force)
  }
  if (m === 'POST' && at('attention', null, 'resolve')) {
    const a = attention.find((x) => x.id === p[1])
    if (!a) throw new HttpError(404, 'No such notification')
    a.resolved = true
    const r = runs.get(a.runId)
    if (r) save(r)
    return { ok: true }
  }
  throw new HttpError(404, 'Not found')
}

export function serve() {
  const cfg = loadConfig()
  const expected = Buffer.from(cfg.token)
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost')
    try {
      if (url.pathname === '/health') return res.end(`ok ${BUILD}`)
      const given = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, ''))
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new HttpError(401, 'Unauthorized')
      const out = await route(req, res, url)
      if (out === res) return
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(out ?? { ok: true }))
    } catch (err: any) {
      res.writeHead(err.status || 400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: err.message || String(err) }))
    }
  })
  // loopback only: the phone reaches this through the authenticated web app, never directly
  server.listen(cfg.port, '127.0.0.1', () => console.log(`Argo orchestrator on http://127.0.0.1:${cfg.port}`))
  return server
}
