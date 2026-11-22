import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runAgent } from '../src/agents.ts'

test('Codex phone permission is scoped to writable phone tasks', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'argo-phone-test-'))
  const bin = join(root, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'codex'), `#!${process.execPath}
const fs = require('node:fs')
let stdin = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => stdin += chunk)
process.stdin.on('end', () => {
  fs.writeFileSync('capture.json', JSON.stringify({ args: process.argv.slice(2), stdin }))
  console.log(JSON.stringify({ type: 'turn.completed' }))
})
`, { mode: 0o700 })
  const previousPath = process.env.PATH
  process.env.PATH = bin
  t.after(() => {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    rmSync(root, { recursive: true, force: true })
  })

  for (const scenario of [
    { name: 'enabled', phoneQuestions: true, readOnly: false, sandbox: 'workspace-write', network: true },
    { name: 'disabled', phoneQuestions: false, readOnly: false, sandbox: 'workspace-write', network: false },
    { name: 'read only', phoneQuestions: true, readOnly: true, sandbox: 'read-only', network: false },
  ]) await t.test(scenario.name, async () => {
    const cwd = join(root, scenario.name)
    mkdirSync(cwd)
    const notes = join(cwd, 'notes')
    const backend = join(root, 'phone backend')
    const addDirs = scenario.phoneQuestions ? [notes, backend] : [notes]
    const prompt = 'Synthetic question context: 中文, $literal, and `literal`.'
    const result = await runAgent({
      agent: 'codex', model: '', reasoning: 'medium', cwd, prompt, addDirs,
      phoneQuestions: scenario.phoneQuestions, readOnly: scenario.readOnly, onLine() {},
    })
    assert.equal(result.ok, true, result.error)
    const capture = JSON.parse(readFileSync(join(cwd, 'capture.json'), 'utf8'))
    const outputIndex = capture.args.indexOf('-o') + 1
    assert.ok(outputIndex > 0)
    t.after(() => rmSync(dirname(capture.args[outputIndex]), { recursive: true, force: true }))
    assert.equal(capture.stdin, prompt)
    assert.equal(capture.args[capture.args.indexOf('-s') + 1], scenario.sandbox)
    assert.equal(capture.args.includes('sandbox_workspace_write.network_access=true'), scenario.network)
    const writableDirs = capture.args.flatMap((arg: string, index: number) => arg === '--add-dir' ? [capture.args[index + 1]] : [])
    assert.deepEqual(writableDirs, addDirs)
  })
})
