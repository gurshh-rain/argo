export type AgentId = 'claude' | 'codex' | 'devin' | 'mock'
export type Reasoning = 'low' | 'medium' | 'high'
export type Difficulty = 'easy' | 'medium' | 'hard'
export type TaskStatus = 'pending' | 'running' | 'merging' | 'done' | 'failed' | 'needs_attention' | 'cancelled'
export type RunStatus = 'planning' | 'awaiting_approval' | 'running' | 'verifying' | 'done' | 'needs_attention' | 'failed' | 'cancelled'

export interface Assignment {
  agent: AgentId
  model: string
  reasoning: Reasoning
}

export interface Task {
  id: string
  title: string
  description: string
  dependsOn: string[]
  kind: 'work' | 'followup' | 'review'
  // how hard the orchestrator judged this subtask; it decides the model tier and reasoning level
  difficulty: Difficulty
  status: TaskStatus
  // what the orchestrator chose, and why
  auto: Assignment & { why: string }
  // manual override, if the user set one
  override?: Partial<Assignment>
  // what actually ran
  ranWith?: Assignment
  branch?: string
  worktree?: string
  // Set while the subtask is handed to an interactive terminal in the Mac app instead of a background process.
  delegate?: { state: 'waiting' | 'sent'; promptFile: string; resultFile: string }
  // the terminal that did (or is doing) this subtask
  terminal?: string
  // the user asked for this subtask to run in the background rather than wait for a terminal
  headless?: boolean
  sessionId?: string
  summary?: string
  changedFiles: string[]
  error?: string
  startedAt?: number
  finishedAt?: number
  costUsd?: number
}

export interface Decision {
  at: number
  by: string
  text: string
}

export interface CheckResult {
  command: string
  ok: boolean
  output: string
  where: 'local' | 'maritime'
}

export interface Report {
  completed: string[]
  attention: string[]
  checks: CheckResult[]
  // for runs without a repo: the full text produced by the final subtask(s)
  answer?: string
  reviewedBy?: string
  branch: string
  changedFiles: string[]
}

export interface Attention {
  id: string
  at: number
  runId: string
  taskId?: string
  kind: 'error' | 'permission' | 'stuck' | 'completed' | 'conflict'
  message: string
  resolved: boolean
  called?: boolean
}

export interface Run {
  id: string
  project: string
  goal: string
  constraints: string[]
  status: RunStatus
  createdAt: number
  // true when the project is a git repo: each subtask gets its own worktree and is merged.
  // false for research or a plain folder: agents share one working folder, nothing is branched or merged.
  isolated: boolean
  // subtasks that other subtasks depend on are handed to the user's open terminals
  terminals?: boolean
  baseBranch: string
  baseCommit: string
  // set once newer remote commits were merged in mid-run: diffs start here so a teammate's work is not counted as ours
  diffBase?: string
  branch: string
  planner?: Assignment
  tasks: Task[]
  decisions: Decision[]
  followups: { at: number; source: string; text: string }[]
  report?: Report
  applied?: boolean
  error?: string
}

export interface Settings {
  defaultAgent: AgentId | 'auto'
  models: Record<string, string>
  reasoning: Reasoning
  autoApprove: boolean
  maxParallel: number
  checks: string[]
  publicUrl: string
}
