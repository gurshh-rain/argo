import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

process.env.ARGO_MOCK = '1'
process.env.ARGO_HOME = mkdtempSync(join(tmpdir(), 'vo-home-'))
process.env.MOCK_DELAY = '100'
const engine = await import('../src/engine.ts')
const g = await import('../src/git.ts')
const { CATALOG, agents } = await import('../src/agents.ts')
CATALOG.splice(0, CATALOG.length, ...CATALOG.filter((a) => a.id === 'mock'))
agents(true)

const sh = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd }).toString().trim()
// a shared remote, your clone, and your teammate's clone
function team() {
  const remote = mkdtempSync(join(tmpdir(), 'vo-remote-'))
  sh(remote, 'init', '-q', '--bare', '-b', 'main')
  const seed = mkdtempSync(join(tmpdir(), 'vo-seed-'))
  sh(seed, 'clone', '-q', remote, '.')
  writeFileSync(join(seed, 'README.md'), 'hi\n')
  sh(seed, 'add', '.'), sh(seed, 'commit', '-q', '-m', 'init'), sh(seed, 'push', '-q', 'origin', 'HEAD:main')
  const me = mkdtempSync(join(tmpdir(), 'vo-me-'))
  sh(me, 'clone', '-q', remote, '.')
  const push = (file: string, text = 'x\n') => {
    writeFileSync(join(seed, file), text)
    sh(seed, 'add', '.'), sh(seed, 'commit', '-q', '-m', `add ${file}`), sh(seed, 'push', '-q', 'origin', 'HEAD:main')
  }
  return { me, push }
}
const until = async (fn: () => boolean, ms = 20000) => {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 50))
  }
}

test('a new worktree starts from what your teammate just pushed, and "pull latest" brings in later pushes', async () => {
  const { me, push } = team()
  push('teammate.txt')
  const wt = await g.addWorktree(me, 'api')
  assert.equal(wt.branch, 'argo/wt/api')
  assert.equal(wt.upstream, 'origin/main')
  assert.equal(wt.pulled, 1)
  assert.ok(existsSync(join(wt.path, 'teammate.txt')), 'the worktree has the pushed commit')
  assert.ok(!existsSync(join(me, 'teammate.txt')), 'your own checkout is untouched')
  const second = await g.addWorktree(me)
  assert.equal(second.name, 'wt-1')
  assert.notEqual(second.path, wt.path, 'each worktree is its own folder')

  writeFileSync(join(wt.path, 'mine.txt'), 'work in progress\n') // an agent's uncommitted edit
  push('later.txt')
  assert.equal((await g.listWorktrees(me)).find((w) => w.name === 'api')!.behind, 0, 'listing does not fetch')
  const synced = await g.syncWorktree(me, wt.path)
  assert.equal(synced.pulled, 1)
  assert.equal(synced.behind, 0)
  assert.ok(existsSync(join(wt.path, 'later.txt')))
  assert.equal(readFileSync(join(wt.path, 'mine.txt'), 'utf8'), 'work in progress\n', 'uncommitted work survives the pull')

  await assert.rejects(g.deleteWorktree(me, wt.path), /uncommitted/)
  const gone = await g.deleteWorktree(me, second.path)
  assert.equal(gone.keptBranch, undefined)
  assert.deepEqual((await g.listWorktrees(me)).map((w) => w.name), ['api'])
})

test('a run pulls what was pushed before it plans, and again before it merges into your branch', async () => {
  const { me, push } = team()
  push('teammate.txt')
  const run = await engine.startRun(me, 'make three files', { autoApprove: true })
  await until(() => run.status === 'done')
  assert.ok(run.decisions.some((d) => /Pulled 1 new commit/.test(d.text)))
  assert.ok(existsSync(join(g.mainTree(run.id), 'teammate.txt')))
  assert.deepEqual(run.report!.changedFiles.sort(), ['a.txt', 'b.txt', 'c.txt'], "the teammate's file is not counted as the run's work")
  push('late.txt')
  const out = await engine.applyRun(run)
  assert.match(out, /1 new commit/)
  assert.ok(existsSync(join(me, 'late.txt')) && existsSync(join(me, 'c.txt')))
})
