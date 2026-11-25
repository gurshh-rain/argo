import SwiftUI
import AppKit
import SwiftTerm

/// One live terminal. Every terminal is a member of the team: a Claude, Devin, Codex or Gemini session, or a plain shell.
struct Member: Identifiable, Hashable {
    let id = UUID()
    let name: String
    let kind: String        // claude | codex | devin | gemini | ollama | shell
    let cwd: String
    /// The workspace this terminal belongs to: the project folder, or "" when there is none.
    let workspace: String
    /// The Argo worktree it works in (its name, e.g. "wt-1"), or nil for the project checkout itself.
    var worktree: String? = nil
}

/// A saved arrangement of terminals: either one terminal (`kind`) or a split of further templates.
struct LayoutTemplate: Codable, Equatable {
    var kind: String?
    var horizontal: Bool?
    var items: [LayoutTemplate]?
    var weights: [Double]?

    var count: Int { kind != nil ? 1 : (items ?? []).reduce(0) { $0 + $1.count } }

    /// The default layout, kept per Mac. Stored as JSON text.
    static let key = "defaultLayout"
    static var saved: LayoutTemplate? {
        get { UserDefaults.standard.string(forKey: key).flatMap { try? JSONDecoder().decode(LayoutTemplate.self, from: Data($0.utf8)) } }
        set {
            if let t = newValue, let d = try? JSONEncoder().encode(t) { UserDefaults.standard.set(String(decoding: d, as: UTF8.self), forKey: key) }
            else { UserDefaults.standard.removeObject(forKey: key) }
        }
    }
}

/// How the terminals are arranged: a tree of side-by-side and stacked splits, as in cmux.
indirect enum Layout: Equatable {
    case leaf(UUID)
    case split(horizontal: Bool, [Layout])

    /// Puts `new` next to `target`, to its right (horizontal) or below it.
    func inserting(_ new: UUID, beside target: UUID, horizontal: Bool) -> Layout {
        switch self {
        case .leaf(let id):
            return id == target ? .split(horizontal: horizontal, [self, .leaf(new)]) : self
        case .split(let h, let kids):
            // splitting along the axis the parent already uses just adds a sibling
            if h == horizontal, let i = kids.firstIndex(of: .leaf(target)) {
                var k = kids
                k.insert(.leaf(new), at: i + 1)
                return .split(horizontal: h, k)
            }
            return .split(horizontal: h, kids.map { $0.inserting(new, beside: target, horizontal: horizontal) })
        }
    }
    func removing(_ id: UUID) -> Layout? {
        switch self {
        case .leaf(let l): return l == id ? nil : self
        case .split(let h, let kids):
            let k = kids.compactMap { $0.removing(id) }
            return k.isEmpty ? nil : (k.count == 1 ? k[0] : .split(horizontal: h, k))
        }
    }
}

/// Owns the terminal views so a session survives while the user switches tabs.
@MainActor
final class TeamHub: ObservableObject {
    /// The latest message each terminal received from another, and the recent conversation.
    @Published var inbox: [UUID: Mail] = [:]
    @Published var log: [Mail] = []
    private var appearanceWatch: NSKeyValueObservation?

    /// Terminal colors follow the app's appearance (Settings → Appearance, or the system's when set to System).
    static func style(_ v: LocalProcessTerminalView) {
        let dark = NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        v.nativeBackgroundColor = dark ? NSColor(srgbRed: 0x1e / 255.0, green: 0x1e / 255.0, blue: 0x1e / 255.0, alpha: 1) : NSColor(srgbRed: 0xf7 / 255.0, green: 0xf7 / 255.0, blue: 0xf7 / 255.0, alpha: 1)
        v.nativeForegroundColor = NSColor(white: dark ? 0.92 : 0.12, alpha: 1)
        v.caretColor = dark ? .white : .black
        v.needsDisplay = true
    }
    func restyleTerminals() { for v in views.values { Self.style(v) }; restyleEditors() }
    /// Restyle the terminals whenever the effective appearance changes, including a system switch while set to System.
    func watchAppearance() {
        guard appearanceWatch == nil else { return }
        appearanceWatch = NSApp.observe(\.effectiveAppearance) { [weak self] _, _ in
            DispatchQueue.main.async { self?.restyleTerminals() }
        }
    }

    @Published var members: [Member] = []
    /// Files open in editor panes, and their editors. See Editor.swift.
    @Published var docs: [Doc] = []
    var editors: [UUID: EditorController] = [:]
    /// Files with edits that are not saved, files that changed on disk under such edits, and files that are gone.
    @Published var unsaved = Set<UUID>()
    @Published var stale = Set<UUID>()
    @Published var missing = Set<UUID>()
    /// How the hub asks the user to confirm something, and tells them something went wrong.
    var ask: ((Store.Confirm) -> Void)?
    var tell: ((String) -> Void)?
    @Published var focused: UUID?
    /// Workspaces that have already been given their first terminal.
    var opened = Set<String>()
    /// One split tree per workspace.
    @Published var layouts: [String: Layout] = [:]

    /// Which coding CLI is running in each terminal right now (also when the user typed `claude` into a shell).
    @Published var cli: [UUID: String] = [:]

    func hasCLI(in ws: String) -> Bool { members(in: ws).contains { cli[$0.id] != nil && !exited.contains($0.id) } }

    /// Looks at the processes under each terminal's shell.
    func detectCLIs() async {
        var found: [UUID: String] = [:]
        let shells = members.filter { $0.kind == "shell" && !exited.contains($0.id) }
        for m in members where m.kind != "shell" && !exited.contains(m.id) { found[m.id] = m.kind }
        if !shells.isEmpty {
            let pids = shells.compactMap { m in views[m.id].map { (m.id, $0.process.shellPid) } }
            let table = await Task.detached { () -> [(Int32, Int32, String)] in
                Self.ps(["-axo", "pid=,ppid=,comm="]).split(separator: "\n").compactMap { line in
                    let f = line.split(separator: " ", maxSplits: 2, omittingEmptySubsequences: true)
                    guard f.count == 3, let pid = Int32(f[0]), let ppid = Int32(f[1]) else { return nil }
                    return (pid, ppid, (String(f[2]) as NSString).lastPathComponent)
                }
            }.value
            // CLIs written in JavaScript (Gemini CLI, npm installs of the others) show up as node; their command line says which
            var scripts: [UUID: [Int32]] = [:]
            for (id, shell) in pids {
                var frontier = [shell], seen = Set<Int32>()
                while let p = frontier.popLast(), found[id] == nil {
                    guard seen.insert(p).inserted else { continue }
                    for row in table where row.1 == p {
                        if Self.agentBins.contains(row.2) { found[id] = row.2; break }
                        if ["node", "bun", "deno"].contains(row.2) { scripts[id, default: []].append(row.0) }
                        frontier.append(row.0)
                    }
                }
            }
            let pending = scripts.filter { found[$0.key] == nil }
            if !pending.isEmpty {
                let list = pending.values.flatMap { $0 }.map(String.init).joined(separator: ",")
                let rows = await Task.detached { Self.ps(["-o", "pid=,args=", "-p", list]) }.value
                var args: [Int32: String] = [:]
                for line in rows.split(separator: "\n") {
                    let f = line.split(separator: " ", maxSplits: 1, omittingEmptySubsequences: true)
                    if f.count == 2, let pid = Int32(f[0]) { args[pid] = String(f[1]).lowercased() }
                }
                for (id, ps) in pending {
                    found[id] = ps.lazy.compactMap { pid in args[pid].flatMap { cmd in Self.agentBins.first { cmd.range(of: "[/@]\($0)(-cli|-code)?([/.\\s]|$)", options: .regularExpression) != nil } } }.first
                }
            }
        }
        if found != cli { cli = found }
    }

    /// The coding CLIs Argo can hand subtasks to in a terminal, by executable name.
    nonisolated static let agentBins = ["claude", "devin", "codex", "gemini"]

    nonisolated static func ps(_ args: [String]) -> String {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/ps")
        p.arguments = args
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = FileHandle.nullDevice
        guard (try? p.run()) != nil else { return "" }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        return String(decoding: data, as: UTF8.self)
    }

    /// Gives each subtask that is waiting for a terminal to a free one running the right CLI, and types the assignment into it.
    func dispatch(store: Store) async {
        await detectCLIs()
        await deliverMail()
        watchFiles()
        guard let runs = store.state?.runs else { return }
        for run in runs where run.isActive {
            let ws = store.workspace(of: run)
            // a terminal is busy while a subtask it was given has not reported back
            let busy = Set(store.runs(in: ws).flatMap(\.tasks).filter { $0.delegate?.state == "sent" }.compactMap(\.terminal))
            var taken = busy
            // a subtask whose terminal has gone away is offered to another terminal
            for t in run.tasks where t.delegate?.state == "sent" {
                if !members(in: ws).contains(where: { $0.name == t.terminal && !exited.contains($0.id) }) {
                    let _: Ignored? = try? await store.daemon.request("POST", "runs/\(run.id)/tasks/\(t.id)/requeue")
                }
            }
            for t in run.tasks where t.delegate?.state == "waiting" {
                let a = t.effective
                guard let m = members(in: ws).first(where: { cli[$0.id] == a.agent && !taken.contains($0.name) && !exited.contains($0.id) }),
                      let v = views[m.id] else { continue }
                taken.insert(m.name)
                struct Claim: Decodable { let line: String }
                guard let c: Claim = try? await store.daemon.request("POST", "runs/\(run.id)/tasks/\(t.id)/claim", body: ["terminal": m.name]) else { continue }
                // Claude Code can switch model mid-session, so the difficulty-based model applies in a terminal too
                if a.agent == "claude", let model = a.model, !model.isEmpty {
                    v.send(txt: "/model \(model)")
                    try? await Task.sleep(nanoseconds: 300_000_000)
                    v.send(txt: "\r")
                    try? await Task.sleep(nanoseconds: 1_200_000_000)
                }
                v.send(txt: c.line)
                try? await Task.sleep(nanoseconds: 400_000_000)
                v.send(txt: "\r")
            }
        }
    }

    /// The visible text of every terminal (for headless checks).
    func dumpText() -> String {
        members.map { m in "===== \(m.name) [\(cli[m.id] ?? "-")]\n" + (views[m.id].map { String(decoding: $0.getTerminal().getBufferAsData(), as: UTF8.self) } ?? "") }.joined(separator: "\n")
            + docs.map { d in "\n===== file \(d.path)\(unsaved.contains(d.id) ? " [unsaved]" : "")\(stale.contains(d.id) ? " [changed on disk]" : "")\(missing.contains(d.id) ? " [deleted]" : "")\(focused == d.id ? " [focused]" : "")" }.joined()
    }

    func members(in ws: String) -> [Member] { members.filter { $0.workspace == ws } }
    func closeAll(in ws: String) { for m in members(in: ws) { close(m.id) }; for d in docs(in: ws) { closeDoc(d.id, force: true) } }
    @Published var ringing = Set<UUID>()
    @Published var exited = Set<UUID>()
    private var views: [UUID: LocalProcessTerminalView] = [:]
    private var delegates: [UUID: TermDelegate] = [:]

    static let kinds: [(id: String, label: String, bin: String?)] = [
        ("claude", "Claude", "claude"), ("devin", "Devin", "devin"), ("codex", "Codex", "codex"), ("gemini", "Gemini", "gemini"), ("ollama", "Ollama", "ollama"), ("shell", "Shell", nil),
    ]

    /// Opens a terminal. It splits off `beside` (default: the focused pane), to the right or below.
    /// `in`: a worktree to work in instead of the project checkout; defaults to the worktree of the pane it splits from.
    @discardableResult
    func add(kind: String, project: String, beside: UUID? = nil, horizontal: Bool = true, in tree: WorktreeInfo? = nil) -> UUID {
        let folder = WS.folder(project)
        let from = beside.flatMap { id in members.first { $0.id == id } }
        let worktree = tree?.name ?? from?.worktree
        let cwd = tree?.path ?? (from?.worktree != nil ? from!.cwd : (folder.isEmpty ? NSHomeDirectory() : folder))
        // the shared record and roster live in the project, so every worktree's agents read the same ones
        let home = folder.isEmpty ? cwd : folder
        let n = (members.filter { $0.kind == kind && $0.workspace == project }.map { Int($0.name.split(separator: " ").last ?? "") ?? 0 }.max() ?? 0) + 1
        let label = Self.kinds.first { $0.id == kind }?.label ?? kind
        let m = Member(name: "\(label) \(n)", kind: kind, cwd: cwd, workspace: project, worktree: worktree)
        members.append(m)
        // split off the chosen pane, else the focused one if it is in this workspace, else the last one here
        let mine = members(in: project).dropLast().map(\.id) + docs(in: project).map(\.id)
        let target = beside ?? (focused.flatMap { mine.contains($0) ? $0 : nil }) ?? mine.last
        if let target, let l = layouts[project] { layouts[project] = l.inserting(m.id, beside: target, horizontal: horizontal) }
        else { layouts[project] = .leaf(m.id) }
        focused = m.id
        writeRoster(project: home)
        let v = LocalProcessTerminalView(frame: NSRect(x: 0, y: 0, width: 600, height: 400))
        let d = TermDelegate(hub: self, id: m.id)
        v.processDelegate = d
        delegates[m.id] = d
        v.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
        Self.style(v)
        views[m.id] = v
        let argo = (home as NSString).appendingPathComponent(".argo")
        var env = Terminal.getEnvironmentVariables(termName: "xterm-256color", trueColor: true)
        env += ["ARGO_MEMBER=\(m.name)", "ARGO_TEAM_FILE=\(argo)/team.md", "ARGO_RECORD=\(argo)/MEMORY.md"]
        if let worktree { env.append("ARGO_WORKTREE=\(worktree)") }
        env += mailEnvironment(for: m)
        writeMailRoster(project)
        let place = worktree.map { " You work in your own git worktree (branch argo/wt/\($0)), so other agents cannot see or overwrite your edits until they are merged. It tracks the remote branch: run `git pull` before you start and before you finish, so you build on what teammates have pushed." } ?? ""
        let intro = "You are \(m.name), one member of a team of coding agents working in this repo at the same time.\(place) Read \(argo)/team.md for the roster and \(argo)/MEMORY.md for the shared record. Coordinate through those files; write decisions as notes in \(argo)/notes/. Stay within your own task and do not overwrite files another member is editing."
        let bin = Self.kinds.first { $0.id == kind }?.bin
        // A login+interactive shell so PATH matches the user's Terminal (~/.local/bin etc.).
        // Ollama has no agent of its own: its launcher starts Claude Code on a model you pick from its menu
        let cmd = kind == "ollama" ? "exec ollama launch claude" : bin.map { "exec \($0) \(kind == "devin" ? "--" : "") '\((intro + MailRoom.briefing).replacingOccurrences(of: "'", with: "'\\''"))'" } ?? "exec /bin/zsh -l"
        v.startProcess(executable: "/bin/zsh", args: ["-l", "-i", "-c", cmd], environment: env, execName: nil, currentDirectory: cwd)
        return m.id
    }

    // MARK: Default layout

    /// The arrangement of this workspace's terminals (what each one runs, how they are split, and the
    /// pane sizes), in a form that can be saved and rebuilt later.
    func template(of ws: String, sizes: SplitSizes) -> LayoutTemplate? {
        func capture(_ node: Layout) -> LayoutTemplate? {
            switch node {
            case .leaf(let id):
                return members.first { $0.id == id }.map { LayoutTemplate(kind: $0.kind) }
            case .split(let horizontal, let kids):
                let live = kids.filter { capture($0) != nil }
                return LayoutTemplate(horizontal: horizontal, items: live.compactMap(capture), weights: live.map { Double(sizes.weight[$0.key] ?? 1) })
            }
        }
        return layouts[ws].flatMap(capture)
    }

    /// Opens the terminals a template describes in a workspace, split and sized the same way.
    /// `usable` says whether a CLI is installed; one that is not becomes a plain shell.
    func apply(_ template: LayoutTemplate, to ws: String, sizes: SplitSizes, usable: (String) -> Bool) {
        func build(_ t: LayoutTemplate) -> Layout? {
            if let kind = t.kind {
                let known = Self.kinds.contains { $0.id == kind }
                return .leaf(add(kind: known && (kind == "shell" || usable(kind)) ? kind : "shell", project: ws))
            }
            let kids = (t.items ?? []).compactMap(build)
            guard !kids.isEmpty else { return nil }
            for (i, k) in kids.enumerated() { sizes.weight[k.key] = CGFloat(i < (t.weights?.count ?? 0) ? max(0.05, t.weights![i]) : 1) }
            return kids.count == 1 ? kids[0] : .split(horizontal: t.horizontal ?? true, kids)
        }
        // add() places each terminal as it goes; the tree built here replaces that with the saved arrangement
        if let tree = build(template) { layouts[ws] = tree }
        focused = members(in: ws).first?.id
    }

    func view(_ id: UUID) -> LocalProcessTerminalView? { views[id] }

    func close(_ id: UUID) {
        views[id]?.terminate()
        views[id] = nil; delegates[id] = nil
        let ws = members.first { $0.id == id }?.workspace ?? ""
        members.removeAll { $0.id == id }
        layouts[ws] = layouts[ws]?.removing(id)
        ringing.remove(id); exited.remove(id); inbox[id] = nil
        writeMailRoster(ws)
        if focused == id { focused = paneIDs(in: ws).last ?? members.last?.id }
        if !ws.isEmpty { writeRoster(project: ws) }
    }

    func focus(_ id: UUID) {
        focused = id
        ringing.remove(id)
        inbox[id] = nil
        if let v = views[id] { v.window?.makeFirstResponder(v) }
        editors[id]?.focus()
    }

    /// Lists the team so each agent can see who else is working alongside it.
    private func writeRoster(project: String) {
        // only real project folders get a roster; a workspace without a folder runs in the home folder
        guard project != NSHomeDirectory() else { return }
        let dir = (project as NSString).appendingPathComponent(".argo")
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        var s = "# Argo team\n\nTerminals currently open in this project. Each is a separate agent working in parallel.\n\n"
        for m in members where m.workspace == project { s += "- \(m.name) (\(m.kind))\(m.worktree.map { ", worktree \($0) at \(m.cwd)" } ?? ", main checkout")\n" }
        try? s.write(toFile: (dir as NSString).appendingPathComponent("team.md"), atomically: true, encoding: .utf8)
    }

    fileprivate func bell(_ id: UUID) { if focused != id { ringing.insert(id) } }
    fileprivate func ended(_ id: UUID) { exited.insert(id) }
}

final class TermDelegate: NSObject, LocalProcessTerminalViewDelegate {
    weak var hub: TeamHub?
    let id: UUID
    init(hub: TeamHub, id: UUID) { self.hub = hub; self.id = id }
    func sizeChanged(source: LocalProcessTerminalView, newCols: Int, newRows: Int) {}
    func setTerminalTitle(source: LocalProcessTerminalView, title: String) {}
    func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}
    func processTerminated(source: TerminalView, exitCode: Int32?) {
        Task { @MainActor in hub?.ended(id) }
    }
}

struct TerminalHost: NSViewRepresentable {
    let view: LocalProcessTerminalView
    func makeNSView(context: Context) -> NSView {
        let c = NSView()
        attach(c)
        return c
    }
    func updateNSView(_ c: NSView, context: Context) { attach(c) }
    private func attach(_ c: NSView) {
        guard view.superview !== c else { return }
        view.removeFromSuperview()
        view.frame = c.bounds
        view.autoresizingMask = [.width, .height]
        c.addSubview(view)
    }
}

struct TerminalPane: View {
    @EnvironmentObject var hub: TeamHub
    @EnvironmentObject var store: Store
    let member: Member
    var body: some View {
        let focused = hub.focused == member.id
        PaneFrame(ring: hub.ringing.contains(member.id), active: focused) {
            Image(systemName: "apple.terminal").font(.system(size: 11)).foregroundStyle(Theme.text)
            Text(member.name).font(.system(size: 12)).foregroundStyle(Theme.text)
            if let wt = member.worktree {
                let info = store.worktrees.first { $0.name == wt }
                Chip(text: "⑂ \(wt)\(info.map { $0.behind > 0 ? " · \($0.behind) behind" : "" } ?? "")", color: (info?.behind ?? 0) > 0 ? Theme.ring : Theme.dim)
                    .help(info.map { $0.behind > 0 ? "\($0.behind) new commit(s) were pushed to \($0.upstream ?? "the remote"). Pull latest from the worktree menu." : "Up to date with \($0.upstream ?? "its base")" } ?? member.cwd)
            }
            if hub.exited.contains(member.id) { Chip(text: "exited") }
            MailChip(member: member)
            if let job = store.runs(in: member.workspace).flatMap(\.tasks).first(where: { $0.terminal == member.name && $0.delegate?.state == "sent" }) {
                StatusDot(status: "running")
                Text("\(job.id): \(job.title)").font(.system(size: 11)).foregroundStyle(Theme.ring).lineLimit(1)
            } else if let c = hub.cli[member.id], member.kind == "shell" {
                Chip(text: c)
            }
            Button { hub.close(member.id) } label: { Image(systemName: "xmark").font(.system(size: 9, weight: .semibold)) }
                .buttonStyle(IconButton()).foregroundStyle(Theme.dim).help("Close this terminal")
        } trailing: {
            Circle().fill(hub.exited.contains(member.id) ? Theme.dim : Theme.agent(member.kind)).frame(width: 7, height: 7)
            // cmux's pane buttons: new terminal (pick an agent), split right, split down
            Menu {
                ForEach(TeamHub.kinds, id: \.id) { k in
                    Button("New \(k.label) terminal") { hub.add(kind: k.id, project: member.workspace, beside: member.id) }
                        .disabled(k.bin != nil && !(store.agent(k.id)?.installed ?? true))
                }
            } label: { Image(systemName: "apple.terminal") }
            .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().help("New terminal beside this one")
            Button { hub.add(kind: "shell", project: member.workspace, beside: member.id, horizontal: true) } label: { Image(systemName: "square.split.2x1") }
                .help("Split right: open a terminal beside this one")
            Button { hub.add(kind: "shell", project: member.workspace, beside: member.id, horizontal: false) } label: { Image(systemName: "square.split.1x2") }
                .help("Split down: open a terminal below this one")
        } content: {
            if let v = hub.view(member.id) { TerminalHost(view: v).padding(4).background(Theme.pane) }
        }
        .buttonStyle(IconButton()).font(.system(size: 12)).foregroundStyle(Theme.dim).tint(Theme.dim)
        .contentShape(Rectangle())
        .simultaneousGesture(TapGesture().onEnded { hub.focus(member.id) })
    }
}

/// Renders the split tree: panes share space equally, separated by hairlines.
struct LayoutView: View {
    @EnvironmentObject var hub: TeamHub
    let node: Layout
    var body: some View {
        switch node {
        case .leaf(let id):
            if let m = hub.members.first(where: { $0.id == id }) { TerminalPane(member: m) }
            else if let d = hub.docs.first(where: { $0.id == id }) { EditorPane(doc: d) }
        case .split(let horizontal, let kids):
            SplitStack(horizontal: horizontal, keys: kids.map(\.key)) { i in LayoutView(node: kids[i]) }
        }
    }
}

extension Layout {
    /// Stable identity for remembering pane sizes: a terminal's id, or a split's first terminal.
    var key: String {
        switch self {
        case .leaf(let id): return id.uuidString
        case .split(let h, let kids): return (h ? "h:" : "v:") + (kids.first?.key ?? "")
        }
    }
}

struct AddMemberMenu: View {
    @EnvironmentObject var hub: TeamHub
    @EnvironmentObject var store: Store
    var body: some View {
        Menu {
            ForEach(TeamHub.kinds, id: \.id) { k in
                Button(k.label) { hub.add(kind: k.id, project: store.project) }
                    .disabled(k.bin != nil && !(store.agent(k.id)?.installed ?? true))
            }
        } label: { Label("Add member", systemImage: "plus") }
        .menuStyle(.borderlessButton).fixedSize().tint(Theme.dim)
    }
}

/// Save the current arrangement of terminals as the default for new workspaces and the next launch.
struct LayoutMenu: View {
    @EnvironmentObject var hub: TeamHub
    @EnvironmentObject var store: Store
    @EnvironmentObject var sizes: SplitSizes
    @AppStorage(LayoutTemplate.key) private var stored = ""
    var body: some View {
        let ws = store.project
        let open = hub.members(in: ws).count
        let saved = stored.isEmpty ? nil : LayoutTemplate.saved
        Menu {
            Button("Save this layout as default") {
                LayoutTemplate.saved = hub.template(of: ws, sizes: sizes)
                store.banner = "Saved. New workspaces, and Argo the next time it opens, start with these \(open) terminal\(open == 1 ? "" : "s") arranged like this."
            }.disabled(open == 0)
            if let saved {
                Button("Open the default layout here (\(saved.count) terminal\(saved.count == 1 ? "" : "s"))") {
                    hub.apply(saved, to: ws, sizes: sizes) { store.agent($0)?.installed ?? false }
                }.disabled(open > 0)
                Divider()
                Button("Clear the default layout") { LayoutTemplate.saved = nil }
            }
        } label: { Label("Layout", systemImage: "rectangle.split.2x2") }
        .menuStyle(.borderlessButton).fixedSize().tint(Theme.dim)
        .help(saved == nil ? "Save how the terminals are arranged as the default" : "Default layout: \(saved!.count) terminal\(saved!.count == 1 ? "" : "s")")
    }
}
