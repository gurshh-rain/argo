import SwiftUI
import AppKit
import SwiftTerm

/// One live terminal. Every terminal is a member of the team: a Claude, Devin or Codex session, or a plain shell.
struct Member: Identifiable, Hashable {
    let id = UUID()
    let name: String
    let kind: String        // claude | codex | devin | shell
    let cwd: String
    /// The workspace this terminal belongs to: the project folder, or "" when there is none.
    let workspace: String
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
    @Published var members: [Member] = []
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
                let p = Process()
                p.executableURL = URL(fileURLWithPath: "/bin/ps")
                p.arguments = ["-axo", "pid=,ppid=,comm="]
                let pipe = Pipe()
                p.standardOutput = pipe
                guard (try? p.run()) != nil else { return [] }
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                return String(decoding: data, as: UTF8.self).split(separator: "\n").compactMap { line in
                    let f = line.split(separator: " ", maxSplits: 2, omittingEmptySubsequences: true)
                    guard f.count == 3, let pid = Int32(f[0]), let ppid = Int32(f[1]) else { return nil }
                    return (pid, ppid, (String(f[2]) as NSString).lastPathComponent)
                }
            }.value
            for (id, shell) in pids {
                var frontier = [shell], seen = Set<Int32>()
                while let p = frontier.popLast(), found[id] == nil {
                    guard seen.insert(p).inserted else { continue }
                    for row in table where row.1 == p {
                        if ["claude", "devin", "codex"].contains(row.2) { found[id] = row.2; break }
                        frontier.append(row.0)
                    }
                }
            }
        }
        if found != cli { cli = found }
    }

    /// Gives each subtask that is waiting for a terminal to a free one running the right CLI, and types the assignment into it.
    func dispatch(store: Store) async {
        await detectCLIs()
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
    }

    func members(in ws: String) -> [Member] { members.filter { $0.workspace == ws } }
    func closeAll(in ws: String) { for m in members(in: ws) { close(m.id) } }
    @Published var ringing = Set<UUID>()
    @Published var exited = Set<UUID>()
    private var views: [UUID: LocalProcessTerminalView] = [:]
    private var delegates: [UUID: TermDelegate] = [:]

    static let kinds: [(id: String, label: String, bin: String?)] = [
        ("claude", "Claude", "claude"), ("devin", "Devin", "devin"), ("codex", "Codex", "codex"), ("shell", "Shell", nil),
    ]

    /// Opens a terminal. It splits off `beside` (default: the focused pane), to the right or below.
    func add(kind: String, project: String, beside: UUID? = nil, horizontal: Bool = true) {
        let cwd = project.isEmpty ? NSHomeDirectory() : project
        let n = (members.filter { $0.kind == kind && $0.workspace == project }.map { Int($0.name.split(separator: " ").last ?? "") ?? 0 }.max() ?? 0) + 1
        let label = Self.kinds.first { $0.id == kind }?.label ?? kind
        let m = Member(name: "\(label) \(n)", kind: kind, cwd: cwd, workspace: project)
        members.append(m)
        // split off the chosen pane, else the focused one if it is in this workspace, else the last one here
        let mine = members(in: project).dropLast().map(\.id)
        let target = beside ?? (focused.flatMap { mine.contains($0) ? $0 : nil }) ?? mine.last
        if let target, let l = layouts[project] { layouts[project] = l.inserting(m.id, beside: target, horizontal: horizontal) }
        else { layouts[project] = .leaf(m.id) }
        focused = m.id
        writeRoster(project: cwd)
        let v = LocalProcessTerminalView(frame: NSRect(x: 0, y: 0, width: 600, height: 400))
        let d = TermDelegate(hub: self, id: m.id)
        v.processDelegate = d
        delegates[m.id] = d
        v.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
        v.nativeBackgroundColor = NSColor(srgbRed: 0x1e / 255.0, green: 0x1e / 255.0, blue: 0x1e / 255.0, alpha: 1)
        v.nativeForegroundColor = NSColor(white: 0.92, alpha: 1)
        v.caretColor = .white
        views[m.id] = v
        let rosterPath = (cwd as NSString).appendingPathComponent(".argo/team.md")
        var env = Terminal.getEnvironmentVariables(termName: "xterm-256color", trueColor: true)
        env += ["ARGO_MEMBER=\(m.name)", "ARGO_TEAM_FILE=\(rosterPath)", "ARGO_RECORD=\((cwd as NSString).appendingPathComponent(".argo/MEMORY.md"))"]
        let intro = "You are \(m.name), one member of a team of coding agents working in this repo at the same time. Read .argo/team.md for the roster and .argo/MEMORY.md for the shared record. Coordinate through those files; write decisions as notes in .argo/notes/. Stay within your own task and do not overwrite files another member is editing."
        let bin = Self.kinds.first { $0.id == kind }?.bin
        // A login+interactive shell so PATH matches the user's Terminal (~/.local/bin etc.).
        let cmd = bin.map { "exec \($0) \(kind == "devin" ? "--" : "") '\(intro.replacingOccurrences(of: "'", with: "'\\''"))'" } ?? "exec /bin/zsh -l"
        v.startProcess(executable: "/bin/zsh", args: ["-l", "-i", "-c", cmd], environment: env, execName: nil, currentDirectory: cwd)
    }

    func view(_ id: UUID) -> LocalProcessTerminalView? { views[id] }

    func close(_ id: UUID) {
        views[id]?.terminate()
        views[id] = nil; delegates[id] = nil
        let ws = members.first { $0.id == id }?.workspace ?? ""
        members.removeAll { $0.id == id }
        layouts[ws] = layouts[ws]?.removing(id)
        ringing.remove(id); exited.remove(id)
        if focused == id { focused = members.last?.id }
        if let p = members.first?.cwd { writeRoster(project: p) }
    }

    func focus(_ id: UUID) {
        focused = id
        ringing.remove(id)
        if let v = views[id] { v.window?.makeFirstResponder(v) }
    }

    /// Lists the team so each agent can see who else is working alongside it.
    private func writeRoster(project: String) {
        let dir = (project as NSString).appendingPathComponent(".argo")
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        var s = "# Argo team\n\nTerminals currently open in this project. Each is a separate agent working in parallel.\n\n"
        for m in members where m.cwd == project { s += "- \(m.name) (\(m.kind))\n" }
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
            if hub.exited.contains(member.id) { Chip(text: "exited") }
            if let job = store.runs(in: member.workspace).flatMap(\.tasks).first(where: { $0.terminal == member.name && $0.delegate?.state == "sent" }) {
                StatusDot(status: "running")
                Text("\(job.id): \(job.title)").font(.system(size: 11)).foregroundStyle(Theme.ring).lineLimit(1)
            } else if let c = hub.cli[member.id], member.kind == "shell" {
                Chip(text: c)
            }
            Button { hub.close(member.id) } label: { Image(systemName: "xmark").font(.system(size: 9, weight: .semibold)) }
                .buttonStyle(.plain).foregroundStyle(Theme.dim).help("Remove from the team")
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
        .buttonStyle(.plain).font(.system(size: 12)).foregroundStyle(Theme.dim).tint(Theme.dim)
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
