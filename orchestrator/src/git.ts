import { execFile } from 'node:child_process'
import { existsSync, rmSync, realpathSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { WORKTREES } from './config.ts'

export function sh(cmd: string, args: string[], cwd: string, timeout = 120_000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) =>
    execFile(cmd, args, { cwd, timeout, maxBuffer: 16 << 20 }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: (stdout + (stderr ? '\n' + stderr : '')).trim() }),
    ),
  )
}
const ident = ['-c', 'user.name=Argo', '-c', 'user.email=argo@localhost']
export const git = (cwd: string, ...args: string[]) => sh('git', args, cwd)
async function must(cwd: string, ...args: string[]) {
  const r = await git(cwd, ...args)
  if (!r.ok) throw new Error(`git ${args.join(' ')}: ${r.out}`)
  return r.out
}

export const mainBranch = (runId: string) => `argo/${runId}/main`
export const taskBranch = (runId: string, taskId: string) => `argo/${runId}/${taskId}`
export const mainTree = (runId: string) => join(WORKTREES, runId, 'main')
export const taskTree = (runId: string, taskId: string) => join(WORKTREES, runId, taskId)

// Each run gets an integration branch in its own worktree, so the user's checkout is never touched.
export async function initRun(project: string, runId: string) {
  if (!(await git(project, 'rev-parse', '--git-dir')).ok) throw new Error(`${project} is not a git repository. Run \`git init\` there first.`)
  if (!(await git(project, 'rev-parse', 'HEAD')).ok) await must(project, ...ident, 'commit', '--allow-empty', '-m', 'Initial commit')
  const baseCommit = await must(project, 'rev-parse', 'HEAD')
  const baseBranch = (await git(project, 'rev-parse', '--abbrev-ref', 'HEAD')).out
  const dirty = (await git(project, 'status', '--porcelain')).out.split('\n').filter((l) => l && !l.includes('.argo')).length
  await must(project, 'worktree', 'add', '-b', mainBranch(runId), mainTree(runId), baseCommit)
  return { baseCommit, baseBranch, dirty }
}

// Each task edits in its own worktree, branched from the integration branch as it stands
// when the task starts (so it already contains its dependencies' merged work).
export async function addTaskTree(project: string, runId: string, taskId: string) {
  const path = taskTree(runId, taskId)
  if (existsSync(path)) return path
  const exists = (await git(project, 'rev-parse', '--verify', taskBranch(runId, taskId))).ok
  await must(project, 'worktree', 'add', ...(exists ? [path, taskBranch(runId, taskId)] : ['-b', taskBranch(runId, taskId), path, mainBranch(runId)]))
  return path
}

export async function commitAll(cwd: string, message: string) {
  await must(cwd, 'add', '-A')
  if (!(await git(cwd, 'diff', '--cached', '--quiet')).ok) await must(cwd, ...ident, 'commit', '-q', '-m', message)
}

export async function changedFiles(project: string, from: string, to: string) {
  return (await git(project, 'diff', '--name-only', `${from}...${to}`)).out.split('\n').filter(Boolean)
}

const locks = new Map<string, Promise<unknown>>()
export function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const next = (locks.get(key) || Promise.resolve()).then(fn, fn)
  locks.set(key, next.catch(() => {}))
  return next
}

// Merge a finished task into the integration branch. Returns conflicted files if it cannot.
export async function merge(runId: string, taskId: string, title: string): Promise<{ ok: boolean; conflicts: string[] }> {
  const cwd = mainTree(runId)
  const r = await git(cwd, ...ident, 'merge', '--no-ff', '-m', `Merge ${taskId}: ${title}`, taskBranch(runId, taskId))
  if (r.ok) return { ok: true, conflicts: [] }
  const conflicts = (await git(cwd, 'diff', '--name-only', '--diff-filter=U')).out.split('\n').filter(Boolean)
  return { ok: false, conflicts }
}
export const abortMerge = (runId: string) => git(mainTree(runId), 'merge', '--abort')
export const concludeMerge = (runId: string, taskId: string, title: string) => commitMerge(mainTree(runId), `Merge ${taskId}: ${title} (conflicts resolved)`)
// Finish a merge whose conflicts an agent has resolved. False if conflict markers are left.
export async function commitMerge(cwd: string, message: string) {
  await must(cwd, 'add', '-u')
  const markers = await git(cwd, 'diff', '--cached', '--check')
  if (/conflict marker/.test(markers.out)) return false
  return (await git(cwd, ...ident, 'commit', '-q', '-m', message)).ok
}

export async function removeTree(project: string, path: string) {
  await git(project, 'worktree', 'remove', '--force', path)
  if (existsSync(path)) rmSync(path, { recursive: true, force: true })
}

// Bring the integration branch into the user's checkout. Refuses if their tree is dirty.
export async function apply(project: string, runId: string) {
  const dirty = (await git(project, 'status', '--porcelain', '--untracked-files=no')).out
  if (dirty) throw new Error('Your working tree has uncommitted changes. Commit or stash them, then apply again.')
  return must(project, ...ident, 'merge', '--no-ff', '-m', `Argo run ${runId}`, mainBranch(runId))
}

// ---- Staying current with the remote ----
// A teammate may have pushed since the user last pulled. These fetch and merge the remote branch into
// Argo's own worktrees, never into the user's checkout.

const count = async (cwd: string, range: string) => Number((await git(cwd, 'rev-list', '--count', range)).out) || 0
const conflicted = async (cwd: string) => (await git(cwd, 'diff', '--name-only', '--diff-filter=U')).out.split('\n').filter(Boolean)

// The remote branch `branch` tracks, e.g. "origin/main"; undefined when it tracks nothing.
export async function upstreamOf(cwd: string, branch = 'HEAD') {
  const r = await git(cwd, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', `${branch}@{upstream}`)
  return r.ok && r.out ? r.out : undefined
}

// Fetch the remote that `upstream` lives on. Never prompts for credentials; offline is not an error.
export function fetchRemote(cwd: string, upstream: string): Promise<{ ok: boolean; out: string }> {
  return new Promise(async (done) => {
    const remotes = (await git(cwd, 'remote')).out.split('\n').filter(Boolean)
    const remote = remotes.filter((r) => upstream.startsWith(r + '/')).sort((a, b) => b.length - a.length)[0]
    if (!remote) return done({ ok: true, out: '' }) // a local branch as upstream: nothing to fetch
    execFile('git', ['fetch', '--quiet', remote], { cwd, timeout: 30_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' } }, (err, _o, e) =>
      done({ ok: !err, out: String(e || err?.message || '').trim() }))
  })
}

export interface Pulled { upstream?: string; pulled: number; conflicts: string[]; fetchError?: string; error?: string }

// Fetch, then merge `upstream` into the branch checked out at `cwd`. With conflicts the merge is left
// open (so an agent can resolve it) unless `abortOnConflict`. Uncommitted work is stashed around the merge.
export async function pullLatest(cwd: string, upstream: string, abortOnConflict = false): Promise<Pulled> {
  const f = await fetchRemote(cwd, upstream)
  const out: Pulled = { upstream, pulled: await count(cwd, `HEAD..${upstream}`), conflicts: [], fetchError: f.ok ? undefined : f.out || 'fetch failed' }
  if (!out.pulled) return out
  const r = await git(cwd, ...ident, 'merge', '--autostash', '--no-edit', '-m', `Merge latest ${upstream}`, upstream)
  if (r.ok) return out
  out.conflicts = await conflicted(cwd)
  if (!out.conflicts.length) out.error = r.out // e.g. local changes in the way
  if (abortOnConflict || !out.conflicts.length) await git(cwd, 'merge', '--abort')
  return out
}

// ---- Worktrees you open yourself (the "New worktree" button) ----
// Each one is its own branch argo/wt/<name> in its own folder, so an agent there never sees another
// agent's edits. It starts from the newest code: the remote branch if you have no unpushed commits,
// otherwise your branch with the remote merged in. It tracks that remote branch, so `git pull` and
// "behind" counts work inside it.

export interface Worktree { name: string; path: string; branch: string; upstream?: string; behind: number; ahead: number; dirty: number; head: string }
const WT_PREFIX = 'argo/wt/'
export const manualRoot = (project: string) => join(WORKTREES, 'wt', basename(resolve(project)))

async function describeTree(path: string, branch: string): Promise<Worktree> {
  const upstream = await upstreamOf(path)
  return {
    name: branch.slice(WT_PREFIX.length), path, branch, upstream,
    behind: upstream ? await count(path, `HEAD..${upstream}`) : 0,
    ahead: upstream ? await count(path, `${upstream}..HEAD`) : 0,
    dirty: (await git(path, 'status', '--porcelain')).out.split('\n').filter((l) => l && !l.includes('.argo')).length,
    head: (await git(path, 'rev-parse', '--short', 'HEAD')).out,
  }
}

export async function listWorktrees(project: string): Promise<Worktree[]> {
  const out: Worktree[] = []
  let path = ''
  for (const line of (await git(project, 'worktree', 'list', '--porcelain')).out.split('\n')) {
    if (line.startsWith('worktree ')) path = line.slice(9)
    const b = line.match(/^branch refs\/heads\/(.+)$/)?.[1]
    if (b?.startsWith(WT_PREFIX) && existsSync(path)) out.push(await describeTree(path, b))
  }
  return out
}

export async function addWorktree(project: string, wanted = ''): Promise<Worktree & { pulled: number; note?: string }> {
  if (!(await git(project, 'rev-parse', '--git-dir')).ok) throw new Error(`${project} is not a git repository`)
  if (!(await git(project, 'rev-parse', 'HEAD')).ok) await must(project, ...ident, 'commit', '--allow-empty', '-m', 'Initial commit')
  const taken = new Set((await git(project, 'for-each-ref', '--format=%(refname:short)', `refs/heads/${WT_PREFIX}`)).out.split('\n'))
  let name = wanted.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 40)
  if (!name) for (let i = 1; ; i++) if (!taken.has(WT_PREFIX + (name = `wt-${i}`))) break
  if (taken.has(WT_PREFIX + name)) throw new Error(`A worktree named ${name} already exists`)
  const branch = WT_PREFIX + name
  const path = join(manualRoot(project), name)
  const upstream = await upstreamOf(project)
  let note: string | undefined
  if (upstream) {
    const f = await fetchRemote(project, upstream)
    if (!f.ok) note = `Could not reach the remote (${f.out.split('\n')[0]}); started from the last fetched ${upstream}.`
  }
  const unpushed = upstream ? await count(project, `${upstream}..HEAD`) : 0
  const behind = upstream ? await count(project, `HEAD..${upstream}`) : 0
  await must(project, 'worktree', 'add', '-b', branch, path, upstream && !unpushed ? upstream : 'HEAD')
  if (upstream) await git(path, 'branch', `--set-upstream-to=${upstream}`)
  if (upstream && unpushed && behind) {
    const p = await pullLatest(path, upstream, true)
    if (p.conflicts.length) note = `Your ${unpushed} unpushed commit(s) conflict with ${upstream} in ${p.conflicts.join(', ')}; this worktree starts from your branch without the remote's ${behind} new commit(s).`
  }
  return { ...(await describeTree(path, branch)), pulled: behind, note }
}

async function ownTree(project: string, path: string) {
  const real = (p: string) => (existsSync(p) ? realpathSync(p) : resolve(p))
  const t = (await listWorktrees(project)).find((w) => real(w.path) === real(path))
  if (!t) throw new Error(`${path} is not an Argo worktree of ${project}`)
  return t
}

// "Pull latest": merge whatever was pushed into the worktree, keeping the agent's uncommitted work.
export async function syncWorktree(project: string, path: string) {
  const t = await ownTree(project, path)
  if (!t.upstream) throw new Error(`${t.name} does not track a remote branch, so there is nothing to pull`)
  const p = await pullLatest(t.path, t.upstream, true)
  if (p.conflicts.length) throw new Error(`New commits on ${t.upstream} conflict with ${t.name} in ${p.conflicts.join(', ')}. Nothing was changed; ask the agent there to commit and merge ${t.upstream} itself.`)
  if (p.error) throw new Error(p.error)
  return { ...(await describeTree(t.path, t.branch)), pulled: p.pulled, fetchError: p.fetchError }
}

// Removes the folder. The branch is deleted only if it holds nothing that is not already upstream.
export async function deleteWorktree(project: string, path: string, force = false) {
  const t = await ownTree(project, path)
  if (t.dirty && !force) throw new Error(`${t.name} has ${t.dirty} uncommitted change(s). Commit them, or remove it anyway.`)
  await removeTree(project, t.path)
  const keep = t.ahead > 0 || !t.upstream
  if (!keep) await git(project, 'branch', '-D', t.branch)
  return { keptBranch: keep ? t.branch : undefined }
}
