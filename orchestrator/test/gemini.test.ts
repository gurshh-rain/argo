import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.ARGO_HOME = mkdtempSync(join(tmpdir(), 'vo-home-'))
const { runAgent } = await import('../src/agents.ts')
const { pick } = await import('../src/planner.ts')

// A stand-in `gemini` that records how it was called and prints the stream-json events Gemini CLI 0.71 emits.
const bin = mkdtempSync(join(tmpdir(), 'vo-gemini-'))
const calls = join(bin, 'calls.json')
writeFileSync(join(bin, 'gemini'), `#!/usr/bin/env node
let stdin = ''
process.stdin.on('data', (c) => (stdin += c))
process.stdin.on('end', () => {
require('node:fs').writeFileSync(${JSON.stringify(calls)}, JSON.stringify({ args: process.argv.slice(2), stdin, trust: process.env.GEMINI_CLI_TRUST_WORKSPACE }))
const ev = (e) => console.log(JSON.stringify({ timestamp: '2026-11-25T00:00:00Z', ...e }))
ev({ type: 'init', session_id: 'sess-1', model: 'gemini-2.5-flash' })
ev({ type: 'message', role: 'user', content: stdin })
ev({ type: 'message', role: 'assistant', content: 'Reading the ', delta: true })
ev({ type: 'message', role: 'assistant', content: 'code.', delta: true })
ev({ type: 'tool_use', tool_name: 'read_file', tool_id: 'a', parameters: { absolute_path: '/x/a.ts' } })
ev({ type: 'tool_result', tool_id: 'a', status: 'success', output: 'ok' })
ev({ type: 'tool_use', tool_name: 'run_shell_command', tool_id: 'b', parameters: { command: 'npm test' } })
ev({ type: 'tool_result', tool_id: 'b', status: 'error', error: { type: 'policy_violation', message: 'Tool execution for "Shell" requires user confirmation, which is not supported in non-interactive mode.' } })
ev({ type: 'message', role: 'assistant', content: 'Done: wrote a.ts.', delta: true })
ev({ type: 'result', status: 'success', stats: { total_tokens: 150, input_tokens: 120, output_tokens: 30, cached: 0, input: 120, duration_ms: 900, tool_calls: 2, models: {} } })
})
`)
chmodSync(join(bin, 'gemini'), 0o755)
process.env.PATH = bin + ':' + process.env.PATH

test('Gemini CLI runs headless and its stream becomes log lines, an answer, tokens and denials', async () => {
  const lines: string[] = []
  const res = await runAgent({ agent: 'gemini', model: 'flash', reasoning: 'medium', cwd: bin, prompt: 'do the thing', addDirs: ['/tmp/notes'], onLine: (l) => lines.push(l) })
  assert.equal(res.ok, true)
  assert.equal(res.text, 'Done: wrote a.ts.', 'the last assistant message is the answer')
  assert.equal(res.sessionId, 'sess-1')
  assert.deepEqual([res.tokensIn, res.tokensOut, res.costUsd], [120, 30, undefined])
  assert.deepEqual(res.denials, ['run_shell_command(npm test)'], 'a refused command is a permission block')
  assert.deepEqual(lines.filter((l) => !l.startsWith('  ⎿')), ['Reading the code.', '⏺ read_file(/x/a.ts)', '⏺ run_shell_command(npm test)', 'Done: wrote a.ts.'])

  const call = JSON.parse(readFileSync(calls, 'utf8'))
  assert.equal(call.stdin, 'do the thing', 'the prompt goes in on stdin')
  assert.equal(call.trust, 'true')
  const flag = (f: string) => call.args[call.args.indexOf(f) + 1]
  assert.equal(flag('--output-format'), 'stream-json')
  assert.equal(flag('--approval-mode'), 'auto_edit')
  assert.equal(flag('-m'), 'flash')
  assert.equal(flag('--include-directories'), '/tmp/notes')
})

test('read-only Gemini cannot edit, and an approved retry may run anything', async () => {
  await runAgent({ agent: 'gemini', model: '', reasoning: 'low', cwd: bin, prompt: 'plan', readOnly: true, onLine: () => {} })
  let args: string[] = JSON.parse(readFileSync(calls, 'utf8')).args
  assert.equal(args[args.indexOf('--approval-mode') + 1], 'default')
  assert.ok(!args.includes('-m'), 'no model given leaves Gemini CLI on its own default')
  await runAgent({ agent: 'gemini', model: 'pro', reasoning: 'high', cwd: bin, prompt: 'go', escalate: true, resume: 'sess-1', onLine: () => {} })
  args = JSON.parse(readFileSync(calls, 'utf8')).args
  assert.equal(args[args.indexOf('--approval-mode') + 1], 'yolo')
  assert.equal(args[args.indexOf('-r') + 1], 'sess-1')
})

test('difficulty picks the Gemini model', () => {
  assert.deepEqual(['easy', 'medium', 'hard'].map((d) => pick('gemini', d as any)), [
    { agent: 'gemini', model: 'flash-lite', reasoning: 'low' },
    { agent: 'gemini', model: 'flash', reasoning: 'medium' },
    { agent: 'gemini', model: 'pro', reasoning: 'high' },
  ])
})
