import SwiftUI
import AppKit
import UserNotifications

@MainActor
final class Store: ObservableObject {
    @Published var state: AppState?
    @Published var logs: [String: [String]] = [:]
    @Published var selectedRun: String?
    @Published var project: String = UserDefaults.standard.string(forKey: "project") ?? ""
    @Published var filesHidden = false
    @Published var sidebarHidden = false
    /// Right-hand panel: Files, or the selected run's Record / Report.
    @Published var rightTab = "Files"
    @Published var confirm: Confirm?
    /// Run panes the user closed, as "<run>/<pane>".
    @Published var closedPanes = Set<String>()
    /// Folders the user has opened. "" is the no-project workspace (research).
    @Published var workspaces: [String] = UserDefaults.standard.stringArray(forKey: "workspaces") ?? []
    private var userClearedProject = false
    private var hiddenRuns = Set<String>()
    private var reported = Set<String>()

    struct Confirm: Identifiable {
        let id = UUID()
        let title: String
        let message: String
        let button: String
        let action: () -> Void
    }

    /// A run belongs to the folder it works in; runs without a project share the "" workspace.
    func workspace(of run: Run) -> String { run.isResearch ? "" : run.project }
    func runs(in ws: String) -> [Run] { (state?.runs ?? []).filter { workspace(of: $0) == ws } }
    func name(of ws: String) -> String { ws.isEmpty ? "No project" : (ws as NSString).lastPathComponent }

    /// Every workspace worth showing: opened folders, the current one, and any with runs or terminals.
    func workspaceList(terminals: [String]) -> [String] {
        var out: [String] = []
        for w in workspaces + [project] + (state?.runs ?? []).map(workspace(of:)) + terminals where !out.contains(w) { out.append(w) }
        return out
    }

    func select(workspace ws: String) {
        project = ws
        userClearedProject = ws.isEmpty
        UserDefaults.standard.set(ws, forKey: "project")
        remember(ws)
        selectedRun = runs(in: ws).first { !hiddenRuns.contains($0.id) }?.id
        if selectedRun == nil { rightTab = "Files" }
    }
    private func remember(_ ws: String) {
        guard !ws.isEmpty, !workspaces.contains(ws) else { return }
        workspaces.append(ws)
        UserDefaults.standard.set(workspaces, forKey: "workspaces")
    }

    /// Back / forward through the workspaces.
    func step(_ by: Int, in list: [String]) {
        guard let i = list.firstIndex(of: project), list.indices.contains(i + by) else { return }
        select(workspace: list[i + by])
    }
    func show(run id: String) {
        hiddenRuns.remove(id)
        selectedRun = id
    }
    /// Closes the run's panes without deleting it; it stays in the run strip.
    func hideRunPanes() {
        if let id = selectedRun { hiddenRuns.insert(id) }
        selectedRun = nil
        rightTab = "Files"
    }

    func askDeleteRun(_ run: Run) {
        let unmerged = run.hasRepo && run.applied != true && run.tasks.contains { !$0.changedFiles.isEmpty }
        confirm = Confirm(
            title: "Delete this run?",
            message: "“\(run.goal.prefix(80))” and its record, logs and worktrees will be removed."
                + (run.isActive ? " It is still running and will be cancelled." : "")
                + (unmerged ? " Its work has not been merged; the branch \(run.branch) is kept so nothing is lost." : ""),
            button: "Delete run"
        ) { self.deleteRuns([run]) }
    }
    func deleteRuns(_ list: [Run]) {
        act {
            for r in list {
                let _: Ignored = try await self.daemon.request("DELETE", "runs/\(r.id)")
                if self.selectedRun == r.id { self.selectedRun = nil; self.rightTab = "Files" }
            }
        }
    }
    /// Removes a workspace from Argo: its terminals are closed by the caller, its runs deleted. The folder itself is untouched.
    func forget(workspace ws: String) {
        deleteRuns(runs(in: ws))
        workspaces.removeAll { $0 == ws }
        UserDefaults.standard.set(workspaces, forKey: "workspaces")
        if project == ws { select(workspace: workspaces.first ?? "") }
    }

    /// The bell jumps to the most recent run that needs attention.
    func jumpToAttention() {
        guard let a = state?.attention.last(where: { $0.kind != "completed" }) ?? state?.attention.last else { return }
        if let r = state?.runs.first(where: { $0.id == a.runId }) { select(workspace: workspace(of: r)) }
        show(run: a.runId)
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
            if project.isEmpty, !userClearedProject, workspaces.isEmpty, let p = s.projects.first { project = p }
            remember(project)
            // show the newest run of this workspace unless the user closed its panes
            let mine = runs(in: project)
            if !mine.contains(where: { $0.id == selectedRun }) { selectedRun = mine.first { !hiddenRuns.contains($0.id) }?.id }
            // when a run's report arrives, bring it up once
            if let r = run, r.report != nil, !reported.contains(r.id) {
                if primed { rightTab = "Report"; filesHidden = false }
                reported.insert(r.id)
            }
            for r in s.runs where r.report != nil && r.id != selectedRun && !primed { reported.insert(r.id) }
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
            select(workspace: url.path)
        }
    }

    func clearProject() { select(workspace: "") }

    func background(run: String, task: String) {
        act { let _: Ignored = try await self.daemon.request("POST", "runs/\(run)/tasks/\(task)/background") }
    }

    /// `terminals`: hand the subtasks other subtasks build on to the CLIs open in this workspace's terminals.
    func newRun(_ goal: String, terminals: Bool = false) {
        act {
            // no project chosen: a research run in a scratch folder, no repo needed
            let r: Run = try await self.daemon.request("POST", "runs", body: ["project": self.project, "goal": goal, "terminals": terminals])
            self.show(run: r.id)
            self.rightTab = "Record"
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
