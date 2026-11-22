import { spawn, execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentId, Assignment } from './types.ts'

export interface AgentSpec {
  id: AgentId
  label: string
  bin: string
  strengths: string
  speed: 'fast' | 'medium' | 'slow'
  cost: 'low' | 'medium' | 'high'
  models: { id: string; note: string }[]
  reasoning: boolean
  installed?: boolean
  version?: string
}

export const CATALOG: AgentSpec[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    bin: 'claude',
    strengths: 'architecture, ambiguous or cross-cutting changes, multi-file refactors, careful review, writing docs',
    speed: 'medium',
    cost: 'high',
    models: [
      { id: 'opus', note: 'deepest reasoning, slowest, most expensive' },
      { id: 'sonnet', note: 'balanced default' },
      { id: 'haiku', note: 'fast and cheap, good for mechanical edits' },
    ],
    reasoning: true,
  },
  {
    id: 'codex',
    label: 'Codex',
    bin: 'codex',
    strengths: 'well-specified implementation, algorithms, tests, bug fixes, terse mechanical edits',
    speed: 'fast',
    cost: 'medium',
    models: [{ id: '', note: 'the model configured in the Codex CLI' }],
    reasoning: true,
  },
  {
    id: 'devin',
    label: 'Devin',
    bin: 'devin',
    strengths: 'self-contained implementation tasks, tests, scripts, running and fixing commands',
    speed: 'fast',
    cost: 'low',
    models: [
      { id: 'swe-2-flash-medium', note: 'fastest, free' },
      { id: 'swe-2-high', note: 'stronger, free' },
      { id: 'adaptive', note: 'picks a model per step' },
    ],
    reasoning: false,
  },
]
if (process.env.ARGO_MOCK)
  CATALOG.push({ id: 'mock', label: 'Mock', bin: 'node', strengths: 'testing the orchestrator', speed: 'fast', cost: 'low', models: [{ id: 'mock-1', note: 'scripted' }], reasoning: false })

let detected: AgentSpec[] | undefined
export function agents(refresh = false): AgentSpec[] {
  if (detected && !refresh) return detected
  detected = CATALOG.map((a) => {
    try {
      const version = execFileSync(a.bin, ['--version'], { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n')[0]
      return { ...a, installed: true, version }
    } catch {
      return { ...a, installed: false }
    }
  })
  return detected
}
export const installed = () => agents().filter((a) => a.installed)
export const spec = (id: string) => agents().find((a) => a.id === id)

export interface RunOpts extends Assignment {
  cwd: string
  prompt: string
  readOnly?: boolean
  escalate?: boolean
  resume?: string
  addDirs?: string[]
  onLine: (line: string) => void
  signal?: AbortSignal
  stuckMs?: number
  onStuck?: () => void
}

export interface RunResult {
  ok: boolean
  text: string
  sessionId?: string
  costUsd?: number
  denials: string[]
  error?: string
}

function command(o: RunOpts, tmp: string): { bin: string; args: string[]; stdin?: string } {
  switch (o.agent) {
    case 'claude': {
      const args = ['-p', '--output-format', 'stream-json', '--verbose']
      if (o.model) args.push('--model', o.model)
      args.push('--effort', o.reasoning)
      if (o.readOnly) args.push('--disallowedTools', 'Edit', 'Write', 'NotebookEdit')
      else args.push('--permission-mode', o.escalate ? 'bypassPermissions' : 'auto')
      for (const d of o.addDirs || []) args.push('--add-dir', d)
      if (o.resume) args.push('--resume', o.resume)
      return { bin: 'claude', args, stdin: o.prompt }
    }
    case 'codex': {
      const args = ['exec', '--json', '--skip-git-repo-check', '-C', o.cwd, '-o', join(tmp, 'last.txt')]
      args.push('-s', o.readOnly ? 'read-only' : 'workspace-write')
      if (o.model) args.push('-m', o.model)
      args.push('-c', `model_reasoning_effort="${o.reasoning}"`)
      for (const d of o.addDirs || []) args.push('--add-dir', d)
      args.push('-')
      return { bin: 'codex', args, stdin: o.prompt }
    }
    case 'devin': {
      const f = join(tmp, 'prompt.md')
      writeFileSync(f, o.prompt)
      const args = ['-p', '--prompt-file', f, '--permission-mode', o.readOnly ? 'auto' : o.escalate ? 'dangerous' : 'smart']
      if (o.model) args.push('--model', o.model)
      return { bin: 'devin', args }
    }
    case 'mock':
      return { bin: process.execPath, args: [join(import.meta.dirname, 'mock-agent.ts')], stdin: o.prompt }
  }
}

const short = (s: unknown, n = 160) => String(typeof s === 'string' ? s : JSON.stringify(s) ?? '').replace(/\s+/g, ' ').slice(0, n)

// Turn each CLI's event stream into readable terminal-style lines.
function parser(agent: AgentId, out: RunResult, emit: (l: string) => void) {
  if (agent === 'claude')
    return (line: string) => {
      let e: any
      try { e = JSON.parse(line) } catch { return emit(line) }
      if (e.type === 'system' && e.subtype === 'init') out.sessionId = e.session_id
      else if (e.type === 'assistant')
        for (const c of e.message?.content || []) {
          if (c.type === 'text' && c.text.trim()) emit(c.text.trim())
          if (c.type === 'tool_use') emit(`⏺ ${c.name}(${short(c.input?.command ?? c.input?.file_path ?? c.input?.pattern ?? c.input)})`)
        }
      else if (e.type === 'user')
        for (const c of e.message?.content || []) if (c.type === 'tool_result' && c.is_error) emit(`  ⎿ error: ${short(c.content, 240)}`)
      if (e.type === 'result') {
        out.text = e.result || out.text
        out.costUsd = e.total_cost_usd
        out.ok = !e.is_error
        if (e.is_error) out.error = short(e.result || e.subtype, 400)
        for (const d of e.permission_denials || []) out.denials.push(`${d.tool_name}(${short(d.tool_input?.command ?? d.tool_input?.file_path ?? d.tool_input, 70)})`)
      }
    }
  if (agent === 'codex')
    return (line: string) => {
      let e: any
      try { e = JSON.parse(line) } catch { return emit(line) }
      const it = e.item
      if (e.type === 'thread.started') out.sessionId = e.thread_id
      else if (e.type === 'item.started' && it?.type === 'command_execution') emit(`$ ${short(it.command, 240)}`)
      else if (e.type === 'item.completed' && it) {
        if (it.type === 'agent_message') (out.text = it.text), emit(it.text)
        else if (it.type === 'reasoning') emit(`· ${short(it.text, 240)}`)
        else if (it.type === 'command_execution' && it.exit_code) emit(`  ⎿ exit ${it.exit_code}: ${short(it.aggregated_output, 240)}`)
        else if (it.type === 'file_change') for (const c of it.changes || []) emit(`✎ ${c.kind} ${c.path}`)
      } else if (e.type === 'turn.failed' || e.type === 'error') {
        out.ok = false
        out.error = short(e.error?.message || e.message, 400)
        emit(`error: ${out.error}`)
      } else if (e.type === 'turn.completed') out.ok = out.error === undefined
    }
  return (line: string) => {
    emit(line)
    if (line.trim()) out.text = (out.text + '\n' + line).slice(-4000)
  }
}

export function runAgent(o: RunOpts): Promise<RunResult> {
  const tmp = mkdtempSync(join(tmpdir(), 'argo-'))
  const { bin, args, stdin } = command(o, tmp)
  const out: RunResult = { ok: false, text: '', denials: [] }
  const structured = o.agent === 'claude' || o.agent === 'codex'
  const parse = parser(o.agent, out, o.onLine)
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(bin, args, { cwd: o.cwd, env: { ...process.env, NO_COLOR: '1' }, signal: o.signal })
    } catch (err) {
      return resolve({ ...out, error: String(err) })
    }
    let last = Date.now()
    let warned = false
    const watchdog = setInterval(() => {
      if (!warned && o.stuckMs && Date.now() - last > o.stuckMs) (warned = true), o.onStuck?.()
    }, 5000)
    let buf = ''
    let stderr = ''
    child.stdout.on('data', (d) => {
      last = Date.now()
      warned = false
      buf += d
      const lines = buf.split('\n')
      buf = lines.pop()!
      for (const l of lines) if (l.trim() || !structured) parse(l)
    })
    child.stderr.on('data', (d) => ((last = Date.now()), (stderr = (stderr + d).slice(-2000))))
    child.on('error', (err) => {
      clearInterval(watchdog)
      resolve({ ...out, ok: false, error: o.signal?.aborted ? 'cancelled' : `${bin}: ${err.message}` })
    })
    child.on('close', (code) => {
      clearInterval(watchdog)
      if (buf.trim()) parse(buf)
      const lastFile = join(tmp, 'last.txt')
      if (existsSync(lastFile)) out.text = readFileSync(lastFile, 'utf8') || out.text
      if (!structured) out.ok = code === 0
      if (code !== 0) (out.ok = false), (out.error ||= short(stderr.trim() || `${bin} exited with code ${code}`, 400))
      out.text = out.text.trim()
      resolve(out)
    })
    if (stdin !== undefined) child.stdin.end(stdin)
    else child.stdin.end()
  })
}
