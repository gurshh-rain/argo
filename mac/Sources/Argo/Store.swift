import SwiftUI
import AppKit
import UserNotifications

/// A workspace is identified by a key: a folder path, or "ws:<id>" (and the legacy "") for one with no folder.
enum WS {
    static func folder(_ key: String) -> String { key.isEmpty || key.hasPrefix("ws:") ? "" : key }
}

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
    /// Names the user gave to workspaces (folder workspaces default to the folder's name).
    @Published var names: [String: String] = (UserDefaults.standard.dictionary(forKey: "workspaceNames") as? [String: String]) ?? [:]
    @Published var renaming: String?
    /// Which workspace each run was started from. Runs without a folder would otherwise be indistinguishable.
    private var owner: [String: String] = (UserDefaults.standard.dictionary(forKey: "runOwners") as? [String: String]) ?? [:]
    /// The folder of the selected workspace, or "" when it has none.
    var folder: String { WS.folder(project) }

    func workspace(of run: Run) -> String {
        if let o = owner[run.id], workspaces.contains(o) || o == project { return o }
        return run.isResearch ? "" : run.project
    }
    /// A fresh, empty workspace with no folder: terminals start in your home folder and tasks need no repo.
    func newWorkspace() {
        let n = (workspaces.filter { $0.hasPrefix("ws:") }.count) + 1
        let key = "ws:" + UUID().uuidString.prefix(8)
        names[key] = "Workspace \(n)"
        UserDefaults.standard.set(names, forKey: "workspaceNames")
        select(workspace: key)
    }
    func rename(_ ws: String, to name: String) {
        let n = name.trimmingCharacters(in: .whitespaces)
        names[ws] = n.isEmpty ? nil : n
        UserDefaults.standard.set(names, forKey: "workspaceNames")
    }
    func runs(in ws: String) -> [Run] { (state?.runs ?? []).filter { workspace(of: $0) == ws } }
    func name(of ws: String) -> String { names[ws] ?? (WS.folder(ws).isEmpty ? "No project" : (ws as NSString).lastPathComponent) }

    /// Every workspace worth showing: opened folders, the current one, and any with runs or terminals.
    func workspaceList(terminals: [String]) -> [String] {
        var out: [String] = []
        for w in workspaces + [project] + (state?.runs ?? []).map(workspace(of:)) + terminals where !out.contains(w) { out.append(w) }
        return out
    }

    func select(workspace ws: String) {
        project = ws
        userClearedProject = WS.folder(ws).isEmpty
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
        names[ws] = nil
        UserDefaults.standard.set(names, forKey: "workspaceNames")
        if project == ws { select(workspace: workspaces.first ?? "") }
    }

    /// The bell jumps to the most recent run that needs attention.
    func jumpToAttention() {
        guard let a = state?.attention.last(where: { $0.kind != "completed" }) ?? state?.attention.last else { return }
        if let r = state?.runs.first(where: { $0.id == a.runId }) { select(workspace: workspace(of: r)) }
        show(run: a.runId)
    }
    @Published var banner: String?
    /// Worktrees of the current project opened with the worktree button (not the ones runs make).
    @Published var worktrees: [WorktreeInfo] = []
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
        panel.prompt = "Open as workspace"
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
            let r: Run = try await self.daemon.request("POST", "runs", body: ["project": self.folder, "goal": goal, "terminals": terminals])
            self.owner[r.id] = self.project
            UserDefaults.standard.set(self.owner, forKey: "runOwners")
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
    private func worktreeBody(_ extra: [String: Any] = [:]) -> [String: Any] { extra.merging(["project": project]) { a, _ in a } }

    /// `fetch`: ask the remote first, so "behind" shows what teammates have pushed since.
    func loadWorktrees(fetch: Bool = false) async {
        guard !project.isEmpty else { worktrees = []; return }
        let q = project.addingPercentEncoding(withAllowedCharacters: CharacterSet(charactersIn: "/-._~").union(.alphanumerics)) ?? ""
        let list: [WorktreeInfo]? = try? await daemon.request("GET", "worktrees?project=\(q)\(fetch ? "&fetch=1" : "")")
        if let list, list != worktrees { worktrees = list }
    }
    /// Creates a worktree from the latest remote code and, given a kind, opens that agent in it.
    func newWorktree(open kind: String?, hub: TeamHub) {
        act {
            let w: WorktreeInfo = try await self.daemon.request("POST", "worktrees", body: self.worktreeBody())
            if let kind { hub.add(kind: kind, project: self.project, in: w) }
            if let note = w.note { self.banner = note }
            await self.loadWorktrees()
        }
    }
    func pullLatest(_ w: WorktreeInfo) {
        act {
            let r: WorktreeInfo = try await self.daemon.request("POST", "worktrees/pull", body: self.worktreeBody(["path": w.path]))
            self.banner = (r.pulled ?? 0) == 0 ? "\(w.name) already has everything on \(w.upstream ?? "the remote")." : "Pulled \(r.pulled!) new commit(s) from \(w.upstream ?? "the remote") into \(w.name)."
            await self.loadWorktrees()
        }
    }
    func removeWorktree(_ w: WorktreeInfo, hub: TeamHub, force: Bool = false) {
        act {
            struct Gone: Decodable { let keptBranch: String? }
            let g: Gone = try await self.daemon.request("POST", "worktrees/remove", body: self.worktreeBody(["path": w.path, "force": force]))
            for m in hub.members(in: self.project) where m.worktree == w.name { hub.close(m.id) }
            if let b = g.keptBranch { self.banner = "Removed \(w.name). Its branch \(b) has commits that are not on the remote, so it was kept." }
            await self.loadWorktrees()
        }
    }

    func loadPair() {
        act { self.pair = try await self.daemon.request("GET", "pair") }
    }
}
