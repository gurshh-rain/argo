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
  assert.deepEqual(run.tasks.map((t) => [t.difficulty, t.auto.model, t.auto.reasoning]), [['easy', 'mock-1', 'low'], ['medium', 'mock-1', 'medium'], ['hard', 'mock-2', 'high']], 'difficulty picks the model tier and reasoning')
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
  assert.equal(run.tasks[0].difficulty, 'medium', 'a failed subtask is escalated one level for the retry')
  await until(() => run.status === 'done')
  assert.ok(runs.has(run.id) && loadConfig().projects.includes(project))
})

test('difficulty maps to each CLI\'s model tiers, and follow-ups are judged by wording', async () => {
  const { pick, classify } = await import('../src/planner.ts')
  assert.deepEqual(['easy', 'medium', 'hard'].map((d) => pick('claude', d as any).model), ['haiku', 'sonnet', 'opus'])
  assert.deepEqual(['easy', 'medium', 'hard'].map((d) => pick('devin', d as any).model), ['swe-2-flash-medium', 'swe-2-high', 'swe-2-max'])
  assert.deepEqual(pick('codex', 'hard'), { agent: 'codex', model: '', reasoning: 'high' })
  assert.equal(classify('fix the typo in the README'), 'easy')
  assert.equal(classify('add a --json flag to the export command'), 'medium')
  assert.equal(classify('find the root cause of the race condition in the job queue'), 'hard')
  loadConfig().settings.models.claude = 'sonnet'
  assert.equal(pick('claude', 'hard').model, 'sonnet', 'a model pinned in Settings wins')
  delete loadConfig().settings.models.claude
})

test('a run needs no repo: research runs share a scratch folder and report an answer', async () => {
  const run = await engine.startRun('', 'compare three things', { autoApprove: true })
  assert.equal(run.isolated, false)
  await until(() => run.status === 'done')
  assert.ok(run.tasks.every((t) => t.status === 'done' && !t.branch && t.worktree === run.project))
  assert.match(run.report!.answer!, /done: wrote files/)
  assert.deepEqual(run.report!.checks, [])
  assert.ok(!loadConfig().projects.includes(run.project), 'scratch folders are not offered as projects')
  await assert.rejects(engine.applyRun(run), /nothing to merge/)

  const plain = mkdtempSync(join(tmpdir(), 'vo-plain-'))
  const inPlace = await engine.startRun(plain, 'make three files', { autoApprove: true })
  await until(() => inPlace.status === 'done')
  assert.ok(existsSync(join(plain, 'c.txt')), 'a folder that is not a repo is worked in directly')
  assert.deepEqual(inPlace.report!.changedFiles.sort(), ['a.txt', 'b.txt', 'c.txt'])
})
