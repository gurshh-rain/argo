import { boot } from './engine.ts'
import { serve } from './server.ts'
import { agents } from './agents.ts'

boot()
for (const a of agents()) console.log(`${a.installed ? '✓' : '✗'} ${a.label}${a.version ? ' ' + a.version : ' (not installed)'}`)
const server = serve()
server.on('error', (err: NodeJS.ErrnoException) => {
  console.error(err.code === 'EADDRINUSE' ? 'Another Argo orchestrator is already running.' : err.message)
  process.exit(err.code === 'EADDRINUSE' ? 3 : 1)
})
