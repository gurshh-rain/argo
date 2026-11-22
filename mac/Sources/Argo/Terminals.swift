import SwiftUI
import AppKit
import SwiftTerm

/// One live terminal. Every terminal is a member of the team: a Claude, Devin or Codex session, or a plain shell.
struct Member: Identifiable, Hashable {
    let id = UUID()
    let name: String
    let kind: String        // claude | codex | devin | shell
    let cwd: String
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
    @Published var layout: Layout?
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
        let n = members.filter { $0.kind == kind }.count + 1
        let label = Self.kinds.first { $0.id == kind }?.label ?? kind
        let m = Member(name: "\(label) \(n)", kind: kind, cwd: cwd)
        members.append(m)
        if let target = beside ?? focused, let l = layout { layout = l.inserting(m.id, beside: target, horizontal: horizontal) }
        else { layout = .leaf(m.id) }
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
        members.removeAll { $0.id == id }
        layout = layout?.removing(id)
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
            Button { hub.close(member.id) } label: { Image(systemName: "xmark").font(.system(size: 9, weight: .semibold)) }
                .buttonStyle(.plain).foregroundStyle(Theme.dim).help("Remove from the team")
        } trailing: {
            Circle().fill(hub.exited.contains(member.id) ? Theme.dim : Theme.agent(member.kind)).frame(width: 7, height: 7)
            // cmux's pane buttons: new terminal (pick an agent), split right, split down
            Menu {
                ForEach(TeamHub.kinds, id: \.id) { k in
                    Button("New \(k.label) terminal") { hub.add(kind: k.id, project: member.cwd, beside: member.id) }
                        .disabled(k.bin != nil && !(store.agent(k.id)?.installed ?? true))
                }
            } label: { Image(systemName: "apple.terminal") }
            .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().help("New terminal beside this one")
            Button { hub.add(kind: "shell", project: member.cwd, beside: member.id, horizontal: true) } label: { Image(systemName: "square.split.2x1") }
                .help("Split right: open a terminal beside this one")
            Button { hub.add(kind: "shell", project: member.cwd, beside: member.id, horizontal: false) } label: { Image(systemName: "square.split.1x2") }
                .help("Split down: open a terminal below this one")
        } content: {
            if let v = hub.view(member.id) { TerminalHost(view: v).padding(4).background(Theme.pane) }
        }
        .buttonStyle(.plain).font(.system(size: 12)).foregroundStyle(Theme.dim).tint(Theme.dim)
        .contentShape(Rectangle())
        .simultaneousGesture(TapGesture().onEnded { hub.focus(member.id) })
    }
}

struct TeamView: View {
    @EnvironmentObject var hub: TeamHub
    @EnvironmentObject var store: Store
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "folder.fill").font(.system(size: 12)).foregroundStyle(Theme.dim)
                Text(store.project.isEmpty ? "~" : (store.project as NSString).lastPathComponent).font(.system(size: 13, weight: .bold)).foregroundStyle(Theme.text)
                Text("\(hub.members.count) terminal\(hub.members.count == 1 ? "" : "s")")
                    .font(.system(size: 10.5, design: .monospaced)).foregroundStyle(Theme.dim)
                Spacer()
                AddMemberMenu()
                if store.filesHidden {
                    Button { store.filesHidden = false } label: { Image(systemName: "sidebar.right") }
                        .buttonStyle(.plain).font(.system(size: 12)).foregroundStyle(Theme.dim).help("Show files")
                }
            }
            .padding(.leading, store.sidebarHidden ? 110 : 10).padding(.trailing, 10).frame(height: 30).background(Theme.bg)
            HLine()
            if hub.members.isEmpty {
                VStack(spacing: 8) {
                    Text("No terminals open").font(.system(size: 18, weight: .semibold)).foregroundStyle(Theme.text)
                    Text("Open a terminal, then split it to run Claude, Devin or Codex side by side in your project. They share the record in .argo/.")
                        .font(.system(size: 12.5)).foregroundStyle(Theme.dim).multilineTextAlignment(.center).frame(maxWidth: 480)
                    AddMemberMenu().padding(.top, 6)
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                if let l = hub.layout { LayoutView(node: l) }
            }
        }
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
            let stack = horizontal ? AnyLayout(HStackLayout(spacing: 0)) : AnyLayout(VStackLayout(spacing: 0))
            stack {
                ForEach(Array(kids.enumerated()), id: \.offset) { i, k in
                    if i > 0 { if horizontal { VLine() } else { HLine() } }
                    LayoutView(node: k)
                }
            }
        }
    }
}

struct AddMemberMenu: View {
    @EnvironmentObject var hub: TeamHub
    @EnvironmentObject var store: Store
    var body: some View {
        Menu {
            ForEach(TeamHub.kinds, id: \.id) { k in
                Button(k.label) { hub.add(kind: k.id, project: store.project); store.showTeam = true }
                    .disabled(k.bin != nil && !(store.agent(k.id)?.installed ?? true))
            }
        } label: { Label("Add member", systemImage: "plus") }
        .menuStyle(.borderlessButton).fixedSize().tint(Theme.dim)
    }
}
