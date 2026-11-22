import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { Assignment, Attention, CheckResult, Run, Task } from './types.ts'
import { loadConfig, WORKSPACES } from './config.ts'
import { runs, attention, save, emit, ensureProject, loadProject, renderMemory, ingestNotes, appendLog, assignment, dir, flush } from './store.ts'
import { runAgent, spec, installed } from './agents.ts'
import * as g from './git.ts'
import { lead, planPrompt, extractJson, tasksFromPlan, route, routeFollowup, reviewPrompt, defaultModel, harder, classify } from './planner.ts'

const aborts = new Map<string, AbortController>()
const key = (run: Run, taskId: string) => `${run.id}/${taskId}`
const label = (a: Assignment) => `${spec(a.agent)?.label || a.agent}${a.model ? ' · ' + a.model : ''}`

function raise(run: Run, kind: Attention['kind'], message: string, taskId?: string) {
  const a: Attention = { id: Math.random().toString(36).slice(2, 10), at: Date.now(), runId: run.id, taskId, kind, message, resolved: false }
  attention.push(a)
  emit('attention', run.id, taskId, a)
  save(run)
}
const resolve = (run: Run, taskId?: string) => {
  for (const a of attention) if (a.runId === run.id && (!taskId || a.taskId === taskId)) a.resolved = true
}
const log = (run: Run, line: string) => appendLog(run, 'orchestrator', line)

// Where the orchestrator's own agents (planner, reviewer) run: the integration worktree, or the plain folder.
const base = (run: Run) => (run.isolated ? g.mainTree(run.id) : run.project)

// Files touched since a moment in time, for folders that are not under git.
function touchedSince(root: string, since: number, at = root, out: string[] = []): string[] {
  for (const name of readdirSync(at)) {
    if (['.argo', '.git', 'node_modules'].includes(name) || out.length >= 200) continue
    const p = join(at, name)
    const st = statSync(p, { throwIfNoEntry: false })
    if (!st) continue
    if (st.isDirectory()) touchedSince(root, since, p, out)
    else if (st.mtimeMs >= since) out.push(relative(root, p))
  }
  return out
}

// `project` may be empty (research or a question: a scratch folder is used) or a folder that is not a git repo.
export async function startRun(project: string, goal: string, opts: { constraints?: string[]; autoApprove?: boolean } = {}): Promise<Run> {
  if (!goal.trim()) throw new Error('Empty task')
  const planner = lead()
  const id = 'r' + Date.now().toString(36)
  const scratch = !project
  if (scratch) mkdirSync((project = join(WORKSPACES, id)), { recursive: true })
  if (!existsSync(project)) throw new Error(`No such directory: ${project}`)
  const isolated = !scratch && (await g.git(project, 'rev-parse', '--show-toplevel')).ok
  const { baseCommit, baseBranch, dirty } = isolated ? await g.initRun(project, id) : { baseCommit: '', baseBranch: '', dirty: 0 }
  ensureProject(project, !scratch)
  const run: Run = {
    id, project, goal: goal.trim(), constraints: opts.constraints || [], status: 'planning', createdAt: Date.now(), isolated,
    baseBranch, baseCommit, branch: isolated ? g.mainBranch(id) : '', planner, tasks: [], decisions: [], followups: [],
  }
  if (!isolated && !scratch) run.decisions.push({ at: Date.now(), by: 'orchestrator', text: 'This folder is not a git repository, so agents work in it directly and share it; their edits are not isolated from each other and there is nothing to merge or undo.' })
  if (dirty) run.decisions.push({ at: Date.now(), by: 'orchestrator', text: `The user's checkout has ${dirty} uncommitted change(s) that agents cannot see; work is based on commit ${baseCommit.slice(0, 8)}.` })
  runs.set(id, run)
  save(run)
  plan(run, opts.autoApprove ?? loadConfig().settings.autoApprove).catch((err) => fail(run, err))
  return run
}

function fail(run: Run, err: unknown) {
  run.status = 'failed'
  run.error = err instanceof Error ? err.message : String(err)
  log(run, `run failed: ${run.error}`)
  raise(run, 'error', run.error)
}

async function plan(run: Run, autoApprove: boolean) {
  const p = run.planner!
  log(run, `Planning with ${label(p)} (reasoning: ${p.reasoning})`)
  const ac = new AbortController()
  aborts.set(key(run, 'plan'), ac)
  const res = await runAgent({ ...p, cwd: base(run), prompt: planPrompt(run), readOnly: true, signal: ac.signal, onLine: (l) => log(run, l) })
  aborts.delete(key(run, 'plan'))
  if (run.status === 'cancelled') return
  const parsed = extractJson(res.text)
  let tasks = tasksFromPlan(parsed, run)
  if (!tasks.length) {
    if (!res.ok) throw new Error(`Planner (${label(p)}) failed: ${res.error || 'no output'}`)
    log(run, 'Planner did not return a usable plan; running the request as a single task.')
    tasks = [{ id: 't1', title: run.goal.slice(0, 60), description: run.goal, dependsOn: [], kind: 'work', status: 'pending', ...route({ agent: p.agent, difficulty: classify(run.goal), why: 'Single-task fallback.' }), changedFiles: [] }]
  }
  for (const c of Array.isArray(parsed?.constraints) ? parsed.constraints : []) if (!run.constraints.includes(String(c))) run.constraints.push(String(c))
  run.tasks = [...tasks, ...run.tasks]
  for (const t of tasks) log(run, `  ${t.id} ${t.title} [${t.difficulty}] → ${label(t.auto)} [${t.auto.reasoning}]${t.dependsOn.length ? ' after ' + t.dependsOn.join(',') : ''} — ${t.auto.why}`)
  run.status = autoApprove ? 'running' : 'awaiting_approval'
  save(run)
  if (autoApprove) tick(run)
}

export function approve(run: Run) {
  if (run.status !== 'awaiting_approval') throw new Error(`Run is ${run.status}, not awaiting approval`)
  run.status = 'running'
  save(run)
  tick(run)
}

// Manual override of the orchestrator's choice for one subtask. Allowed until that subtask starts (or again after it fails).
export function override(run: Run, taskId: string, o: Partial<Assignment> | null) {
  const t = task(run, taskId)
  if (!['pending', 'failed', 'needs_attention'].includes(t.status)) throw new Error(`${taskId} is already ${t.status}`)
  if (!o) delete t.override
  else {
    if (o.agent && !installed().some((a) => a.id === o.agent)) throw new Error(`${o.agent} is not installed`)
    const agent = o.agent || t.override?.agent || t.auto.agent
    t.override = { ...t.override, ...o }
    // a model belongs to one CLI; switching CLI without naming a model falls back to that CLI's default
    if (o.agent && o.model === undefined) t.override.model = defaultModel(agent)
  }
  save(run)
  return t
}

const task = (run: Run, id: string) => {
  const t = run.tasks.find((x) => x.id === id)
  if (!t) throw new Error(`No subtask ${id} in run ${run.id}`)
  return t
}

function tick(run: Run) {
  if (run.status !== 'running') return
  const max = loadConfig().settings.maxParallel
  const active = () => run.tasks.filter((t) => t.status === 'running' || t.status === 'merging').length
  const ready = run.tasks.filter((t) => t.status === 'pending' && t.dependsOn.every((d) => run.tasks.find((x) => x.id === d)?.status === 'done'))
  for (const t of ready) {
    if (active() >= max) break
    t.status = 'running' // claim synchronously so parallel ticks cannot double-start it
    execTask(run, t).catch((err) => {
      t.status = 'failed'
      t.error = err.message
      raise(run, 'error', err.message, t.id)
    }).finally(() => tick(run))
  }
  if (active() > 0) return
  if (run.tasks.every((t) => t.status === 'done')) verify(run).catch((err) => fail(run, err))
  else if (!run.tasks.some((t) => t.status === 'pending' && t.dependsOn.every((d) => run.tasks.find((x) => x.id === d)?.status === 'done'))) {
    run.status = 'needs_attention'
    save(run)
  }
}

function workPrompt(run: Run, t: Task, a: Assignment, extra?: string) {
  const notes = dir(run.project, 'notes', `${run.id}-${t.id}.md`)
  return `You are ${spec(a.agent)?.label}, one member of a team of coding agents coordinated by Argo. Other agents are working on sibling subtasks right now.

## Shared record (live copy, re-read it any time: ${dir(run.project, 'MEMORY.md')})
${renderMemory(run)}

## Your subtask: ${t.id} — ${t.title}
${t.description}
${extra ? `\n## New instruction from the user\n${extra}\n` : ''}
${loadConfig().settings.callOnAttention ? `## Ask the developer by phone
When you need the developer's answer to continue, read the call-user skill at ${JSON.stringify(join(import.meta.dirname, 'skills', 'call-user', 'SKILL.md'))}.
Run the existing phone script described there and use its transcript as the answer in this task. The skill's temporary files and configured phone backend may live outside this worktree; keep project edits inside your assigned scope.
` : ''}
## Rules
${run.isolated
    ? `- Keep project source edits inside the current directory. It is your own git worktree (branch ${t.branch}), already containing the merged work of the subtasks you depend on. The phone skill may use its existing backend and private temporary files without changing backend code or credentials.
- Stay within your subtask's files so your changes merge cleanly with the others.
- Do not commit, push, or switch branches. The orchestrator commits and merges your work when you finish.
- If you make a decision another agent must know about (an interface, a file name, a convention), append one bullet per decision to ${notes}
- End with a short summary: what you did, what you left undone, and anything that needs the human.`
    : `- There is no git repository here. The current directory is a working folder shared with the other agents; do not overwrite files they are writing, and only create files if your subtask calls for them.
- You may read files, run commands and search the web as your subtask requires. Say where each important claim comes from.
- Record each key finding or decision the other agents need: append one bullet per finding to ${notes}
- The subtasks you depend on have finished; their full outputs are at the "full output" paths in the shared record. Read them rather than redoing their work.
- Your final message is your deliverable: give the complete result of your subtask, then note anything you could not establish.`}`
}

async function execTask(run: Run, t: Task, extra?: { instruction?: string; escalate?: boolean }) {
  const a: Assignment = { agent: t.override?.agent || t.auto.agent, model: t.override?.model ?? t.auto.model, reasoning: t.override?.reasoning || t.auto.reasoning }
  t.status = 'running'
  t.ranWith = a
  t.error = undefined
  t.startedAt = Date.now()
  t.finishedAt = undefined
  if (run.isolated) {
    t.branch = g.taskBranch(run.id, t.id)
    t.worktree = await g.addTaskTree(run.project, run.id, t.id)
  } else t.worktree = run.project
  save(run)
  flush(run.project)
  const out = (l: string) => appendLog(run, t.id, l)
  out(`── ${label(a)} · reasoning ${a.reasoning}${t.override ? ' · manual override' : ''} ${t.branch ? ' · ' + t.branch : ''}`)
  const ac = new AbortController()
  aborts.set(key(run, t.id), ac)
  const phoneQuestions = loadConfig().settings.callOnAttention
  const phoneBackend = process.env.ARGO_PHONE_DEMO_DIR || '/Users/gz/Documents/codevisor-call-demo'
  const res = await runAgent({
    ...a, cwd: t.worktree, prompt: workPrompt(run, t, a, extra?.instruction), escalate: extra?.escalate,
    resume: extra?.instruction && a.agent === 'claude' ? t.sessionId : undefined,
    addDirs: [dir(run.project, 'notes'), ...(phoneQuestions && existsSync(phoneBackend) ? [phoneBackend] : [])],
    phoneQuestions, signal: ac.signal, onLine: out,
    stuckMs: 240_000, onStuck: () => raise(run, 'stuck', 'No output for four minutes.', t.id),
  })
  aborts.delete(key(run, t.id))
  t.finishedAt = Date.now()
  t.sessionId = res.sessionId || t.sessionId
  t.costUsd = (t.costUsd || 0) + (res.costUsd || 0)
  t.summary = res.text.slice(-1500)
  if (res.text) writeFileSync(dir(run.project, 'results', `${run.id}-${t.id}.md`), res.text + '\n')
  ingestNotes(run)
  if ((t.status as string) === 'cancelled' || run.status === 'cancelled') return save(run)
  if (!res.ok) {
    t.status = 'failed'
    t.error = res.error || 'Agent exited without a result'
    out(`✗ ${t.error}`)
    return raise(run, 'error', t.error, t.id)
  }
  if (run.isolated) {
    await g.commitAll(t.worktree, `${t.id}: ${t.title}\n\nAgent: ${label(a)} (reasoning ${a.reasoning})`)
    t.changedFiles = await g.changedFiles(run.project, g.mainBranch(run.id), t.branch!)
  } else t.changedFiles = touchedSince(run.project, t.startedAt!)
  if (res.denials.length) {
    t.status = 'needs_attention'
    t.error = `Blocked from running: ${[...new Set(res.denials)].slice(0, 3).join(', ')}`
    out(`⚠ ${t.error}`)
    return raise(run, 'permission', t.error + '. Say "approve" to let it proceed, or give other instructions.', t.id)
  }
  if (!run.isolated) {
    t.status = 'done'
    resolve(run, t.id)
    out(`✓ finished${t.changedFiles.length ? ' — wrote ' + t.changedFiles.join(', ') : ''}`)
    return save(run)
  }
  t.status = 'merging'
  save(run)
  await g.serial(run.id, () => integrate(run, t, a, out))
}

async function integrate(run: Run, t: Task, a: Assignment, out: (l: string) => void) {
  const m = await g.merge(run.id, t.id, t.title)
  if (!m.ok) {
    out(`Merge conflict in ${m.conflicts.join(', ')}; asking ${label(a)} to resolve it`)
    const res = await runAgent({
      ...a, cwd: g.mainTree(run.id), onLine: out,
      prompt: `A git merge of subtask "${t.title}" into the integration branch stopped with conflicts in: ${m.conflicts.join(', ')}.\nResolve every conflict marker in those files so that BOTH sides' intent is preserved. Do not run git commit or git merge; just edit the files.\n\nContext:\n${renderMemory(run)}`,
    })
    if (!res.ok || !(await g.concludeMerge(run.id, t.id, t.title))) {
      await g.abortMerge(run.id)
      t.status = 'needs_attention'
      t.error = `Merge conflict in ${m.conflicts.join(', ')}`
      return raise(run, 'conflict', t.error, t.id)
    }
  }
  await g.removeTree(run.project, t.worktree!)
  t.status = 'done'
  resolve(run, t.id)
  out(`✓ merged into ${run.branch}${t.changedFiles.length ? ' — ' + t.changedFiles.join(', ') : ' (no file changes)'}`)
  save(run)
}

function detectChecks(cwd: string): string[] {
  const configured = loadConfig().settings.checks
  if (configured.length) return configured
  const has = (f: string) => existsSync(join(cwd, f))
  const out: string[] = []
  if (has('package.json')) {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
    const needsInstall = (pkg.dependencies || pkg.devDependencies) && !has('node_modules')
    for (const s of ['typecheck', 'lint', 'test'])
      if (pkg.scripts?.[s] && !/no test specified/.test(pkg.scripts[s])) out.push(s === 'test' ? 'npm test' : `npm run ${s}`)
    if (out.length && needsInstall) out.unshift('npm install --no-audit --no-fund')
  }
  if (has('pyproject.toml') || has('pytest.ini') || has('tests')) if (has('tests') || has('test')) out.push('python3 -m pytest -q')
  if (has('Cargo.toml')) out.push('cargo test')
  if (has('go.mod')) out.push('go test ./...')
  if (has('Package.swift')) out.push('swift build')
  return out
}

async function verify(run: Run) {
  run.status = 'verifying'
  save(run)
  const cwd = base(run)
  const checks: CheckResult[] = []
  // checks only make sense for code in a repo; a research run has nothing to build or test
  for (const command of run.isolated ? detectChecks(cwd) : []) {
    log(run, `check: ${command}`)
    const r = await g.sh('/bin/sh', ['-c', command], cwd, 600_000)
    checks.push({ command, ok: r.ok, output: r.out.slice(-3000), where: 'local' })
    log(run, `  ${r.ok ? '✓ passed' : '✗ failed'}`)
  }
  // generated files (node_modules etc.) must not land on the branch
  if (run.isolated) await g.git(cwd, 'checkout', '--', '.')
  const files = run.isolated ? await g.changedFiles(run.project, run.baseCommit, run.branch) : [...new Set(run.tasks.flatMap((t) => t.changedFiles))]
  const stat = run.isolated ? (await g.git(run.project, 'diff', '--stat', `${run.baseCommit}...${run.branch}`)).out : files.join('\n')
  // Review with a different agent than the one that did most of the work, when there is one.
  const counts = new Map<string, number>()
  for (const t of run.tasks) counts.set(assignment(t).agent, (counts.get(assignment(t).agent) || 0) + 1)
  const busiest = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]
  const other = installed().find((a) => a.id !== busiest && counts.has(a.id)) || installed().find((a) => a.id !== busiest)
  const reviewer: Assignment = other ? { agent: other.id, model: defaultModel(other.id), reasoning: loadConfig().settings.reasoning } : lead()
  log(run, `Review by ${label(reviewer)}`)
  const ac = new AbortController()
  aborts.set(key(run, 'review'), ac)
  const res = await runAgent({
    ...reviewer, cwd, readOnly: true, signal: ac.signal, onLine: (l) => log(run, l),
    prompt: reviewPrompt(run, stat, checks.map((c) => `- \`${c.command}\`: ${c.ok ? 'passed' : 'FAILED\n' + c.output.slice(-800)}`).join('\n')),
  })
  aborts.delete(key(run, 'review'))
  if ((run.status as string) === 'cancelled') return
  if (run.isolated) await g.git(cwd, 'checkout', '--', '.')
  // without a repo the deliverable is text: the output of the subtask(s) nothing else depends on
  const finals = run.tasks.filter((t) => t.status === 'done' && !run.tasks.some((x) => x.dependsOn.includes(t.id)))
  const answer = run.isolated ? undefined : finals.map((t) => {
    const f = dir(run.project, 'results', `${run.id}-${t.id}.md`)
    return (finals.length > 1 ? `## ${t.title}\n` : '') + (existsSync(f) ? readFileSync(f, 'utf8') : t.summary || '')
  }).join('\n\n').slice(0, 30000)
  const verdict = extractJson(res.text)
  const attn: string[] = Array.isArray(verdict?.attention) ? verdict.attention.map(String) : []
  for (const c of checks) if (!c.ok) attn.unshift(`Check failed: ${c.command}`)
  if (!verdict) attn.push(`The reviewer (${label(reviewer)}) did not return a verdict${res.error ? ': ' + res.error : ''}; the merged work is unreviewed.`)
  run.report = {
    completed: Array.isArray(verdict?.complete) ? verdict.complete.map(String) : run.tasks.map((t) => `${t.title} (${label(assignment(t))})`),
    attention: attn, checks, answer, reviewedBy: label(reviewer), branch: run.branch, changedFiles: files,
  }
  run.status = attn.length ? 'needs_attention' : 'done'
  raise(run, 'completed', attn.length ? `${attn.length} item(s) need your attention: ${attn[0]}` : run.isolated ? `All ${run.tasks.length} subtasks are merged and checks passed.` : `All ${run.tasks.length} subtasks finished and the answer is ready.`)
  save(run)
}

// A follow-up from the Mac app, the phone, or a phone call.
export function instruct(run: Run, text: string, source: string): { action: string; taskId?: string } {
  text = text.trim()
  if (!text) throw new Error('Empty instruction')
  run.followups.push({ at: Date.now(), source, text })
  log(run, `Follow-up (${source}): ${text}`)
  const blocked = [...attention].reverse().find((a) => a.runId === run.id && !a.resolved && a.taskId && ['failed', 'needs_attention'].includes(task(run, a.taskId).status))
  if (blocked) {
    const t = task(run, blocked.taskId!)
    resolve(run, t.id)
    if (/^\s*(stop|cancel|skip|abandon)\b/i.test(text) && text.split(/\s+/).length <= 4) {
      t.status = 'cancelled'
      save(run)
      tick(run)
      return { action: 'cancelled', taskId: t.id }
    }
    const escalate = blocked.kind === 'permission' && /\b(approve|approved|allow|permit|go ahead|yes|proceed)\b/i.test(text)
    retry(run, t.id, text, escalate)
    return { action: escalate ? 'approved' : 'retried', taskId: t.id }
  }
  const n = run.tasks.filter((t) => t.kind === 'followup').length + 1
  const t: Task = {
    id: `f${n}`, title: text.slice(0, 60), description: text, kind: 'followup', status: 'pending', ...routeFollowup(text), changedFiles: [],
    dependsOn: run.tasks.filter((x) => !['failed', 'cancelled'].includes(x.status)).map((x) => x.id),
  }
  run.tasks.push(t)
  if (['done', 'needs_attention', 'failed'].includes(run.status) && run.tasks.length) {
    run.status = 'running'
    run.report = undefined
  }
  save(run)
  tick(run)
  return { action: 'queued', taskId: t.id }
}

export function retry(run: Run, taskId: string, instruction = 'Try again and fix whatever went wrong.', escalate = false) {
  const t = task(run, taskId)
  if (!['failed', 'needs_attention', 'cancelled'].includes(t.status)) throw new Error(`${taskId} is ${t.status}`)
  // a subtask that failed outright gets a stronger model next time, unless the user chose the model themselves
  if (t.status === 'failed' && !escalate && !t.override && harder(t)) log(run, `  ${t.id} ${t.auto.why}`)
  resolve(run, t.id)
  if (run.status !== 'awaiting_approval') run.status = 'running'
  run.report = undefined
  t.status = 'running'
  execTask(run, t, { instruction, escalate }).catch((err) => {
    t.status = 'failed'
    t.error = err.message
    raise(run, 'error', err.message, t.id)
  }).finally(() => tick(run))
}

export function cancel(run: Run) {
  run.status = 'cancelled'
  for (const [k, ac] of aborts) if (k.startsWith(run.id + '/')) ac.abort()
  for (const t of run.tasks) if (['pending', 'running', 'merging'].includes(t.status)) t.status = 'cancelled'
  resolve(run)
  save(run)
}

export async function applyRun(run: Run) {
  if (!run.isolated) throw new Error('This run has no git repository, so there is nothing to merge. Its files are in ' + run.project)
  const out = await g.apply(run.project, run.id)
  run.applied = true
  save(run)
  return out
}

export function boot() {
  for (const p of loadConfig().projects) if (existsSync(p)) loadProject(p)
  for (const d of readdirSync(WORKSPACES)) loadProject(join(WORKSPACES, d))
}
