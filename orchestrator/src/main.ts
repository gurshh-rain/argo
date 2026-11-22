import { boot } from './engine.ts'
import { serve } from './server.ts'
import { agents } from './agents.ts'
import { homedir } from 'node:os'
import { join } from 'node:path'

// However this process was started, look where coding CLIs are normally installed.
const have = (process.env.PATH || '').split(':')
for (const d of [join(homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.npm-global/bin'), join(homedir(), '.bun/bin')])
  if (!have.includes(d)) have.push(d)
process.env.PATH = have.join(':')

boot()
for (const a of agents()) console.log(`${a.installed ? '✓' : '✗'} ${a.label}${a.version ? ' ' + a.version : ' (not installed)'}`)
const server = serve()
server.on('error', (err: NodeJS.ErrnoException) => {
  console.error(err.code === 'EADDRINUSE' ? 'Another Argo orchestrator is already running.' : err.message)
  process.exit(err.code === 'EADDRINUSE' ? 3 : 1)
})
