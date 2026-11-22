export type AgentId = 'claude' | 'codex' | 'devin' | 'mock'
export type Reasoning = 'low' | 'medium' | 'high'
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
  status: TaskStatus
  // what the orchestrator chose, and why
  auto: Assignment & { why: string }
  // manual override, if the user set one
  override?: Partial<Assignment>
  // what actually ran
  ranWith?: Assignment
  branch?: string
  worktree?: string
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
  baseBranch: string
  baseCommit: string
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
  callOnAttention: boolean
  phoneNumber: string
  publicUrl: string
}
