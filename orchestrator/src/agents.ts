import { spawn, execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentId, Assignment, Difficulty } from './types.ts'

const WIN = process.platform === 'win32'
// cmd.exe quoting: wrap in double quotes when needed and double any inner quote
export const winQuote = (a: string) => (/^[\w.:\\/=-]+$/.test(a) ? a : `"${a.replace(/"/g, '""')}"`)

export interface AgentSpec {
  id: AgentId
  label: string
  bin: string
  strengths: string
  speed: 'fast' | 'medium' | 'slow'
  cost: 'low' | 'medium' | 'high'
  models: { id: string; note: string }[]
  // which model each difficulty level gets
  tiers: Record<Difficulty, string>
  reasoning: boolean
  installed?: boolean
  version?: string
  // why a connector that is present cannot be used yet, in words for the user
  note?: string
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
    tiers: { easy: 'haiku', medium: 'sonnet', hard: 'opus' },
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
    // Codex keeps its configured model; difficulty changes its reasoning effort instead
    tiers: { easy: '', medium: '', hard: '' },
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
      { id: 'swe-2-max', note: 'strongest, slowest, free' },
      { id: 'adaptive', note: 'picks a model per step' },
    ],
    tiers: { easy: 'swe-2-flash-medium', medium: 'swe-2-high', hard: 'swe-2-max' },
    reasoning: false,
  },
  {
    // Open models served by Ollama, on this machine or in Ollama's cloud (names ending in "-cloud").
    // Ollama serves models, it is not an agent, so Claude Code runs as the harness (file edits, commands,
    // search) pointed at the Ollama server instead of Anthropic. This is what `ollama launch claude` does.
    id: 'ollama',
    label: 'Ollama',
    bin: 'ollama',
    strengths: 'open models run locally (private, free) or in Ollama cloud; quality depends on the model. Choose it when the user asks for Ollama, a local or open model, or names one of its models',
    speed: 'medium',
    cost: 'low',
    models: [], // filled in from the Ollama server
    tiers: { easy: '', medium: '', hard: '' },
    reasoning: false,
  },
]
if (process.env.ARGO_MOCK)
  CATALOG.push({ id: 'mock', label: 'Mock', bin: 'node', strengths: 'testing the orchestrator', speed: 'fast', cost: 'low', models: [{ id: 'mock-1', note: 'scripted' }, { id: 'mock-2', note: 'scripted, stronger' }], tiers: { easy: 'mock-1', medium: 'mock-1', hard: 'mock-2' }, reasoning: false })

export const TIERS: Record<string, Record<Difficulty, string>> = Object.fromEntries(CATALOG.map((a) => [a.id, a.tiers]))

// Where the Ollama server is. OLLAMA_HOST may be "host:port" without a scheme, as Ollama itself accepts.
export function ollamaHost(): string {
  const h = (process.env.OLLAMA_HOST || '127.0.0.1:11434').replace(/\/+$/, '')
  return /^https?:\/\//.test(h) ? h : `http://${h.replace(/^0\.0\.0\.0/, '127.0.0.1')}`
}

// Turn the server's model list into picker entries and difficulty tiers: the smallest model does the
// easy work, the largest the hard work. Sizes come from names like "7.6B" or "32.7B".
export function ollamaModels(tags: any): Pick<AgentSpec, 'models' | 'tiers'> {
  const size = (m: any) => parseFloat(m?.details?.parameter_size) * (/M$/i.test(m?.details?.parameter_size || '') ? 0.001 : 1) || 0
  const list: any[] = (Array.isArray(tags?.models) ? tags.models : []).filter((m: any) => m?.name && !/embed/i.test(m.name))
  const sorted = [...list].sort((a, b) => size(a) - size(b))
  const at = (f: number) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * f + 0.5))]?.name ?? ''
  return {
    models: sorted.map((m) => ({ id: m.name, note: [m.remote_host ? 'Ollama cloud' : 'local', m.details?.parameter_size].filter(Boolean).join(', ') })),
    tiers: { easy: at(0), medium: at(0.5), hard: at(1) },
  }
}

function detectOllama(a: AgentSpec, haveClaude: boolean): AgentSpec {
  let version: string
  try {
    version = execFileSync(a.bin, ['--version'], { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'], shell: WIN }).trim().split('\n')[0].replace(/^ollama version is /, '')
  } catch {
    return { ...a, installed: false }
  }
  let tags: any
  try {
    tags = JSON.parse(execFileSync('curl', ['-s', '-m', '3', `${ollamaHost()}/api/tags`], { encoding: 'utf8', timeout: 5000 }))
  } catch {
    return { ...a, installed: false, version, note: `Ollama is installed but its server is not answering at ${ollamaHost()}. Open the Ollama app or run \`ollama serve\`.` }
  }
  const found = ollamaModels(tags)
  if (!found.models.length) return { ...a, installed: false, version, note: 'Ollama has no models yet. Pull one, for example `ollama pull qwen3-coder`, or sign in for cloud models.' }
  if (!haveClaude) return { ...a, ...found, installed: false, version, note: 'Ollama models need Claude Code installed to act as the agent that edits files and runs commands.' }
  return { ...a, ...found, installed: true, version }
}

let detected: AgentSpec[] | undefined
let ollamaChecked = 0
export function agents(refresh = false): AgentSpec[] {
  if (detected && !refresh) {
    // models are pulled and removed while we run, so look again now and then, without blocking
    if (Date.now() - ollamaChecked > 30_000) {
      ollamaChecked = Date.now()
      const i = detected.findIndex((a) => a.id === 'ollama')
      if (i >= 0 && detected[i].version)
        fetch(`${ollamaHost()}/api/tags`, { signal: AbortSignal.timeout(3000) })
          .then((r) => r.json())
          .then((tags) => {
            const found = ollamaModels(tags)
            const haveClaude = !!detected!.find((a) => a.id === 'claude')?.installed
            if (found.models.length && haveClaude) detected![i] = { ...detected![i], ...found, installed: true, note: undefined }
          })
          .catch(() => {})
    }
    return detected
  }
  ollamaChecked = Date.now()
  detected = CATALOG.filter((a) => a.id !== 'ollama').map((a) => {
    try {
      const version = execFileSync(a.bin, ['--version'], { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'], shell: WIN }).trim().split('\n')[0]
      return { ...a, installed: true, version }
    } catch {
      return { ...a, installed: false }
    }
  })
  const ollama = CATALOG.find((a) => a.id === 'ollama')
  if (ollama) {
    const at = detected.findIndex((a) => a.id === 'mock')
    detected.splice(at < 0 ? detected.length : at, 0, detectOllama(ollama, !!detected.find((a) => a.id === 'claude')?.installed))
  }
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
  tokensIn?: number
  tokensOut?: number
  denials: string[]
  error?: string
}

function command(o: RunOpts, tmp: string): { bin: string; args: string[]; stdin?: string; env?: Record<string, string> } {
  switch (o.agent) {
    case 'ollama': {
      // Claude Code as the harness, talking to Ollama's Anthropic-compatible endpoint
      const args = ['-p', '--output-format', 'stream-json', '--verbose', '--model', o.model]
      if (o.readOnly) args.push('--disallowedTools', 'Edit', 'Write', 'NotebookEdit')
      else args.push('--permission-mode', o.escalate ? 'bypassPermissions' : 'acceptEdits')
      for (const d of o.addDirs || []) args.push('--add-dir', d)
      return { bin: 'claude', args, stdin: o.prompt, env: { ANTHROPIC_BASE_URL: ollamaHost(), ANTHROPIC_AUTH_TOKEN: 'ollama', ANTHROPIC_API_KEY: '' } }
    }
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
  if (agent === 'claude' || agent === 'ollama')
    return (line: string) => {
      let e: any
      // with Ollama behind it, Claude Code prints notices about its own sign-in and model list; they are noise here
      try { e = JSON.parse(line) } catch { return agent === 'ollama' && /claude\.ai connectors|unrecognized_model/.test(line) ? undefined : emit(line) }
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
        const u = e.usage
        if (u) {
          out.tokensIn = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
          out.tokensOut = u.output_tokens || 0
        }
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
      } else if (e.type === 'turn.completed') {
        out.ok = out.error === undefined
        // Codex reports tokens per turn but no price
        if (e.usage) {
          out.tokensIn = (out.tokensIn || 0) + (e.usage.input_tokens || 0)
          out.tokensOut = (out.tokensOut || 0) + (e.usage.output_tokens || 0)
        }
      }
    }
  return (line: string) => {
    emit(line)
    if (line.trim()) out.text = (out.text + '\n' + line).slice(-4000)
  }
}

export function runAgent(o: RunOpts): Promise<RunResult> {
  const tmp = mkdtempSync(join(tmpdir(), 'argo-'))
  const { bin, args, stdin, env } = command(o, tmp)
  const out: RunResult = { ok: false, text: '', denials: [] }
  const structured = o.agent === 'claude' || o.agent === 'codex' || o.agent === 'ollama'
  const parse = parser(o.agent, out, o.onLine)
  return new Promise((resolve) => {
    let child
    try {
      // on Windows the CLIs are .cmd shims, which only start through a shell; arguments are quoted for it
      child = WIN
        ? spawn([bin, ...args].map(winQuote).join(' '), { cwd: o.cwd, env: { ...process.env, NO_COLOR: '1', ...env }, shell: true, windowsHide: true })
        : spawn(bin, args, { cwd: o.cwd, env: { ...process.env, NO_COLOR: '1', ...env }, signal: o.signal })
    } catch (err) {
      return resolve({ ...out, error: String(err) })
    }
    // Windows: killing the shell would leave the CLI it started running, so a cancel takes down the whole tree
    if (WIN) {
      const pid = child.pid
      const stop = () => pid && spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {})
      if (o.signal?.aborted) stop()
      else o.signal?.addEventListener('abort', stop, { once: true })
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
      if (WIN && o.signal?.aborted) return resolve({ ...out, ok: false, error: 'cancelled' })
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
