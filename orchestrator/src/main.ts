import { boot } from './engine.ts'
import { serve } from './server.ts'
import { agents } from './agents.ts'
import { homedir } from 'node:os'
import { join } from 'node:path'

// However this process was started, look where coding CLIs are normally installed.
const win = process.platform === 'win32'
const sep = win ? ';' : ':'
const have = (process.env.PATH || '').split(sep)
const usual = win
  ? [join(homedir(), '.local', 'bin'), join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'npm'), join(homedir(), '.bun', 'bin'), join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama')]
  : [join(homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.npm-global/bin'), join(homedir(), '.bun/bin')]
for (const d of usual)
  if (!have.includes(d)) have.push(d)
process.env.PATH = have.join(sep)

// One bad run must not take the orchestrator (and every other run) down with it.
process.on('uncaughtException', (err) => console.error(new Date().toISOString(), 'uncaught exception:', err))
process.on('unhandledRejection', (err) => console.error(new Date().toISOString(), 'unhandled rejection:', err))

boot()
console.log(new Date().toISOString(), 'starting')
for (const a of agents()) console.log(`${a.installed ? '✓' : '✗'} ${a.label}${a.version ? ' ' + a.version : ' (not installed)'}${a.note ? ' — ' + a.note : ''}${a.id === 'ollama' && a.installed ? ` (${a.models.length} model${a.models.length === 1 ? '' : 's'})` : ''}`)
const server = serve()
server.on('error', (err: NodeJS.ErrnoException) => {
  console.error(err.code === 'EADDRINUSE' ? 'Another Argo orchestrator is already running.' : err.message)
  process.exit(err.code === 'EADDRINUSE' ? 3 : 1)
})
