// Scripted stand-in for a coding CLI, used by the test suite (ARGO_MOCK=1).
import { writeFileSync, appendFileSync } from 'node:fs'
let prompt = ''
for await (const c of process.stdin) prompt += c
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
if (prompt.includes('Return ONLY a JSON object') && prompt.includes('"tasks"')) {
  console.log(JSON.stringify({
    constraints: ['keep it small'],
    tasks: [
      { id: 't1', title: 'Write a', description: 'MOCK_WRITE a.txt', dependsOn: [], agent: 'mock', model: 'mock-1', reasoning: 'low', why: 'independent' },
      { id: 't2', title: 'Write b', description: 'MOCK_WRITE b.txt', dependsOn: [], agent: 'mock', model: 'mock-1', reasoning: 'low', why: 'independent' },
      { id: 't3', title: 'Combine', description: 'MOCK_WRITE c.txt', dependsOn: ['t1', 't2'], agent: 'mock', model: 'mock-1', reasoning: 'low', why: 'needs both' },
    ],
  }))
} else if (prompt.includes('"complete"')) {
  console.log(JSON.stringify({ complete: ['everything'], attention: [] }))
} else {
  console.log('working')
  await sleep(Number(process.env.MOCK_DELAY || 300))
  if (prompt.includes('MOCK_FAIL') && !prompt.includes('try again')) { console.error('boom'); process.exit(1) }
  for (const m of prompt.matchAll(/MOCK_WRITE (\S+)/g)) writeFileSync(m[1], `written by mock at ${process.cwd()}\n`)
  const notes = prompt.match(/append one bullet per decision to (\S+)/)?.[1]
  if (notes) appendFileSync(notes, `- mock decided something in ${process.cwd().split('/').pop()}\n`)
  console.log('done: wrote files')
}
