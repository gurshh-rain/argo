import Foundation

struct ModelInfo: Codable, Hashable { let id: String; let note: String }

struct AgentSpec: Codable, Identifiable, Hashable {
    let id: String
    let label: String
    let strengths: String
    let speed: String
    let cost: String
    let models: [ModelInfo]
    let reasoning: Bool
    let installed: Bool?
    let version: String?
    /// Why a connector that is present cannot be used yet.
    let note: String?
}

struct Assignment: Codable, Hashable {
    var agent: String?
    var model: String?
    var reasoning: String?
    var why: String?
}

struct TaskItem: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let description: String
    let dependsOn: [String]
    let kind: String
    let difficulty: String?
    let status: String
    let auto: Assignment
    let override: Assignment?
    let ranWith: Assignment?
    let branch: String?
    let delegate: Delegate?
    let terminal: String?
    let summary: String?
    let changedFiles: [String]
    let error: String?
    let startedAt: Double?
    let finishedAt: Double?
    let costUsd: Double?

    var effective: Assignment {
        ranWith ?? Assignment(agent: override?.agent ?? auto.agent, model: override?.model ?? auto.model, reasoning: override?.reasoning ?? auto.reasoning)
    }
    /// Handed to one of the user's terminals rather than shown as its own pane.
    var inTerminal: Bool { delegate != nil || (terminal != nil && status == "done") }
    var canOverride: Bool { ["pending", "failed", "needs_attention"].contains(status) }
}

struct Delegate: Codable, Hashable { let state: String }

struct Decision: Codable, Hashable { let at: Double; let by: String; let text: String }
struct Followup: Codable, Hashable { let at: Double; let source: String; let text: String }
struct CheckResult: Codable, Hashable { let command: String; let ok: Bool; let output: String; let `where`: String }

struct Report: Codable, Hashable {
    let completed: [String]
    let attention: [String]
    let checks: [CheckResult]
    let answer: String?
    let reviewedBy: String?
    let branch: String
    let changedFiles: [String]
}

struct Run: Codable, Identifiable, Hashable {
    let id: String
    let project: String
    let goal: String
    let constraints: [String]
    let status: String
    let createdAt: Double
    let isolated: Bool?
    let baseBranch: String
    let branch: String
    let planner: Assignment?
    let tasks: [TaskItem]
    let decisions: [Decision]
    let followups: [Followup]
    let report: Report?
    /// Every agent call in the run (planning, subtasks, merges, review). Absent on runs saved before it was recorded.
    let usage: [UsageCall]?
    let applied: Bool?
    let error: String?

    var hasRepo: Bool { isolated != false }
    var isResearch: Bool { project.contains("/.argo/workspaces/") }
    var projectName: String { isResearch ? "research" : (project as NSString).lastPathComponent }
    var isActive: Bool { ["planning", "running", "verifying"].contains(status) }
}

/// One agent invocation: who ran, what for, whether it worked, and what the CLI said it cost.
struct UsageCall: Codable, Hashable {
    let at: Double
    let ms: Double
    let role: String
    let taskId: String?
    let agent: String
    let model: String
    let ok: Bool
    let costUsd: Double?
    let tokensIn: Double?
    let tokensOut: Double?
    let terminal: Bool?
}

struct AttentionItem: Codable, Identifiable, Hashable {
    let id: String
    let at: Double
    let runId: String
    let taskId: String?
    let kind: String
    let message: String
    let spoken: String?
    let called: Bool?
}

struct Settings: Codable, Equatable {
    var defaultAgent: String
    var models: [String: String]
    var reasoning: String
    var autoApprove: Bool
    var maxParallel: Int
    var checks: [String]
    var publicUrl: String
}

struct Integrations: Codable, Equatable { let maritime: Bool }

struct AppState: Codable {
    let agents: [AgentSpec]
    let settings: Settings
    let integrations: Integrations
    let projects: [String]
    let runs: [Run]
    let attention: [AttentionItem]
    let summary: String
}

struct PairCode: Codable { let code: String; let expires: Double }
struct APIError: Codable { let error: String }

/// A worktree opened with the worktree button: its own folder and branch argo/wt/<name>, tracking the remote.
struct WorktreeInfo: Decodable, Identifiable, Hashable {
    let name: String
    let path: String
    let branch: String
    let upstream: String?
    let behind: Int
    let ahead: Int
    let dirty: Int
    let head: String
    /// Set by create and pull: how many new remote commits it took in, and anything worth telling the user.
    let pulled: Int?
    let note: String?
    var id: String { path }
}
