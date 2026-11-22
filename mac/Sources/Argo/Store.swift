import SwiftUI
import AppKit
import UserNotifications

@MainActor
final class Store: ObservableObject {
    @Published var state: AppState?
    @Published var logs: [String: [String]] = [:]
    @Published var selectedRun: String?
    @Published var project: String = UserDefaults.standard.string(forKey: "project") ?? ""
    @Published var showTeam = true
    @Published var filesHidden = false
    private var userClearedProject = false
    @Published var sidebarHidden = false

    /// Back / forward in the sidebar: the workspace first, then each run.
    func step(_ by: Int) {
        let ids = state?.runs.map(\.id) ?? []
        let cur = showTeam ? 0 : (ids.firstIndex(of: selectedRun ?? "").map { $0 + 1 } ?? 0)
        let next = max(0, min(ids.count, cur + by))
        showTeam = next == 0
        if next > 0 { selectedRun = ids[next - 1] }
    }
    /// The bell jumps to the most recent run that needs attention.
    func jumpToAttention() {
        guard let a = state?.attention.last(where: { $0.kind != "completed" }) ?? state?.attention.last else { return }
        selectedRun = a.runId
        showTeam = false
    }
    @Published var banner: String?
    @Published var startupError: String?
    @Published var pair: PairCode?

    let daemon = Daemon()
    private var seenAttention = Set<String>()
    private var primed = false

    var run: Run? { state?.runs.first { $0.id == selectedRun } }
    var installedAgents: [AgentSpec] { state?.agents.filter { $0.installed == true } ?? [] }
    func agent(_ id: String?) -> AgentSpec? { state?.agents.first { $0.id == id } }
    func attention(for run: String, task: String? = nil) -> [AttentionItem] {
        (state?.attention ?? []).filter { $0.runId == run && $0.kind != "completed" && (task == nil || $0.taskId == task) }
    }

    func start() {
        Task {
            startupError = await daemon.ensureRunning()
            while !Task.isCancelled {
                await refresh()
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }
        }
    }

    func refresh() async {
        do {
            let s: AppState = try await daemon.request("GET", "state")
            if s.runs != state?.runs || s.attention != state?.attention || s.settings != state?.settings || state == nil { state = s }
            startupError = nil
            if selectedRun == nil || !s.runs.contains(where: { $0.id == selectedRun }) { selectedRun = s.runs.first?.id }
            if project.isEmpty, !userClearedProject, let p = s.projects.first { project = p }
            for a in s.attention where !seenAttention.contains(a.id) {
                seenAttention.insert(a.id)
                if primed { notify(a) }
            }
            primed = true
            if let id = selectedRun {
                let l: [String: [String]] = try await daemon.request("GET", "runs/\(id)/logs?tail=400")
                if l != logs { logs = l }
            }
        } catch {
            if state != nil || startupError == nil { startupError = await daemon.ensureRunning() }
        }
    }

    private func notify(_ a: AttentionItem) {
        let c = UNMutableNotificationContent()
        c.title = a.kind == "completed" ? "Run finished" : "An agent needs you"
        c.body = a.spoken ?? a.message
        c.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: a.id, content: c, trigger: nil))
    }

    private func act(_ work: @escaping () async throws -> Void) {
        Task {
            do { try await work(); await refresh() } catch { banner = error.localizedDescription }
        }
    }

    func chooseProject() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.prompt = "Use project"
        if panel.runModal() == .OK, let url = panel.url {
            project = url.path
            UserDefaults.standard.set(project, forKey: "project")
        }
    }

    func clearProject() {
        project = ""
        userClearedProject = true
        UserDefaults.standard.removeObject(forKey: "project")
    }

    func newRun(_ goal: String) {
        act {
            // no project chosen: a research run in a scratch folder, no repo needed
            let r: Run = try await self.daemon.request("POST", "runs", body: ["project": self.project, "goal": goal])
            self.selectedRun = r.id
            self.showTeam = false
        }
    }
    func instruct(_ text: String) {
        guard let id = selectedRun else { return }
        act { let _: Ignored = try await self.daemon.request("POST", "runs/\(id)/instruct", body: ["text": text, "source": "mac"]) }
    }
    func runAction(_ action: String) {
        guard let id = selectedRun else { return }
        act { let _: Ignored = try await self.daemon.request("POST", "runs/\(id)/\(action)") }
    }
    func overrideTask(_ task: String, agent: String? = nil, model: String? = nil, reasoning: String? = nil, clear: Bool = false) {
        guard let id = selectedRun else { return }
        var body: [String: Any] = [:]
        if clear { body["clear"] = true }
        if let agent { body["agent"] = agent }
        if let model { body["model"] = model }
        if let reasoning { body["reasoning"] = reasoning }
        act { let _: Ignored = try await self.daemon.request("PATCH", "runs/\(id)/tasks/\(task)", body: body) }
    }
    func retry(_ task: String) {
        guard let id = selectedRun else { return }
        act { let _: Ignored = try await self.daemon.request("POST", "runs/\(id)/tasks/\(task)/retry", body: [:]) }
    }
    func dismiss(_ a: AttentionItem) {
        act { let _: Ignored = try await self.daemon.request("POST", "attention/\(a.id)/resolve") }
    }
    func callMe(_ a: AttentionItem) {
        act { let _: Ignored = try await self.daemon.request("POST", "attention/\(a.id)/call") }
    }
    func saveSettings(_ patch: [String: Any]) {
        act { let _: Ignored = try await self.daemon.request("PUT", "settings", body: patch) }
    }
    func loadPair() {
        act { self.pair = try await self.daemon.request("GET", "pair") }
    }
}
