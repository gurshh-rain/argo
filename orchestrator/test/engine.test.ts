import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

process.env.ARGO_MOCK = '1'
process.env.ARGO_HOME = mkdtempSync(join(tmpdir(), 'vo-home-'))
process.env.MOCK_DELAY = '400'
const engine = await import('../src/engine.ts')
const { runs, attention } = await import('../src/store.ts')
const { loadConfig } = await import('../src/config.ts')
const { CATALOG, agents } = await import('../src/agents.ts')
// only the scripted agent, so tests never spend real tokens
CATALOG.splice(0, CATALOG.length, ...CATALOG.filter((a) => a.id === 'mock'))
agents(true)

function repo() {
  const d = mkdtempSync(join(tmpdir(), 'vo-proj-'))
  const git = (...a: string[]) => execFileSync('git', a, { cwd: d })
  git('init', '-q', '-b', 'main')
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init')
  return d
}
const until = async (fn: () => boolean, ms = 20000) => {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 50))
  }
}

test('plans, waits for approval, honours an override, runs in parallel, merges, verifies', async () => {
  const project = repo()
  const run = await engine.startRun(project, 'make three files')
  await until(() => run.status === 'awaiting_approval')
  assert.deepEqual(run.tasks.map((t) => t.id), ['t1', 't2', 't3'])
  engine.override(run, 't2', { reasoning: 'high' })
  engine.approve(run)
  await until(() => run.tasks.filter((t) => t.status === 'running' && t.worktree).length === 2)
  assert.equal(run.tasks[2].status, 'pending', 't3 waits for its dependencies')
  assert.notEqual(run.tasks[0].worktree, run.tasks[1].worktree, 'parallel tasks are isolated')
  await until(() => run.status === 'done')
  assert.equal(run.tasks[1].ranWith!.reasoning, 'high')
  assert.ok(!existsSync(join(project, 'a.txt')), "the user's checkout is untouched until they apply")
  assert.ok(run.decisions.length >= 3, 'agent notes became shared decisions')
  const memory = readFileSync(join(project, '.argo', 'MEMORY.md'), 'utf8')
  assert.match(memory, /make three files/)
  assert.match(memory, /manual override/)
  assert.deepEqual(run.report!.changedFiles.sort(), ['a.txt', 'b.txt', 'c.txt'])
  await engine.applyRun(run)
  assert.ok(existsSync(join(project, 'c.txt')))
})

test('a follow-up becomes a new subtask on a finished run', async () => {
  const project = repo()
  const run = await engine.startRun(project, 'make three files', { autoApprove: true })
  await until(() => run.status === 'done')
  const r = engine.instruct(run, 'also MOCK_WRITE d.txt', 'phone-voice')
  assert.equal(r.action, 'queued')
  await until(() => run.status === 'done')
  assert.ok(run.report!.changedFiles.includes('d.txt'))
  assert.equal(run.followups[0].source, 'phone-voice')
})

test('a failing agent raises attention and a spoken instruction retries it', async () => {
  const project = repo()
  const run = await engine.startRun(project, 'make three files')
  await until(() => run.status === 'awaiting_approval')
  run.tasks[0].description += ' MOCK_FAIL'
  engine.approve(run)
  await until(() => run.status === 'needs_attention')
  const a = attention.find((x) => x.runId === run.id && x.kind === 'error')
  assert.ok(a && a.taskId === 't1')
  assert.equal(run.tasks[2].status, 'pending')
  assert.equal(engine.instruct(run, 'try again please', 'phone-call').action, 'retried')
  await until(() => run.status === 'done')
  assert.ok(runs.has(run.id) && loadConfig().projects.includes(project))
})
