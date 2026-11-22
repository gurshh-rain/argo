import { execFile } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
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
export async function concludeMerge(runId: string, taskId: string, title: string) {
  const cwd = mainTree(runId)
  await must(cwd, 'add', '-u')
  const markers = await git(cwd, 'diff', '--cached', '--check')
  if (/conflict marker/.test(markers.out)) return false
  return (await git(cwd, ...ident, 'commit', '-q', '-m', `Merge ${taskId}: ${title} (conflicts resolved)`)).ok
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
