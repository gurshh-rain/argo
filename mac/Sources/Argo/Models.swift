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
    let status: String
    let auto: Assignment
    let override: Assignment?
    let ranWith: Assignment?
    let branch: String?
    let summary: String?
    let changedFiles: [String]
    let error: String?
    let startedAt: Double?
    let finishedAt: Double?
    let costUsd: Double?

    var effective: Assignment {
        ranWith ?? Assignment(agent: override?.agent ?? auto.agent, model: override?.model ?? auto.model, reasoning: override?.reasoning ?? auto.reasoning)
    }
    var canOverride: Bool { ["pending", "failed", "needs_attention"].contains(status) }
}

struct Decision: Codable, Hashable { let at: Double; let by: String; let text: String }
struct Followup: Codable, Hashable { let at: Double; let source: String; let text: String }
struct CheckResult: Codable, Hashable { let command: String; let ok: Bool; let output: String; let `where`: String }

struct Report: Codable, Hashable {
    let completed: [String]
    let attention: [String]
    let checks: [CheckResult]
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
    let baseBranch: String
    let branch: String
    let planner: Assignment?
    let tasks: [TaskItem]
    let decisions: [Decision]
    let followups: [Followup]
    let report: Report?
    let applied: Bool?
    let error: String?

    var projectName: String { (project as NSString).lastPathComponent }
    var isActive: Bool { ["planning", "running", "verifying"].contains(status) }
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
    var callOnAttention: Bool
    var phoneNumber: String
    var publicUrl: String
}

struct Integrations: Codable, Equatable { let elevenlabs: Bool; let phoneCalls: Bool; let maritime: Bool }

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
