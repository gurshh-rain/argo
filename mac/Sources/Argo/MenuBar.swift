import SwiftUI
import AppKit

/// Keyboard commands in the macOS menu bar, laid out like cmux: workspaces, panes, and jumping to what needs you.
struct ArgoCommands: Commands {
    @ObservedObject var store: Store
    @ObservedObject var hub: TeamHub

    private var workspaces: [String] { store.workspaceList(terminals: hub.members.map(\.workspace)) }
    private var panes: [UUID] { hub.paneIDs(in: store.project) }
    /// The focused pane when it is a file open in the editor.
    private var focusedDoc: Doc? { hub.docs.first { $0.id == hub.focused && $0.workspace == store.project } }
    private var focusedMember: Member? { hub.members.first { $0.id == hub.focused && $0.workspace == store.project } }

    private func split(horizontal: Bool) {
        hub.add(kind: focusedMember?.kind ?? "shell", project: store.project, beside: focusedMember?.id ?? focusedDoc?.id, horizontal: horizontal)
    }
    /// Pick files to open in editor panes in this workspace.
    private func openFile() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.directoryURL = URL(fileURLWithPath: store.folder.isEmpty ? NSHomeDirectory() : store.folder)
        panel.prompt = "Open"
        guard panel.runModal() == .OK else { return }
        for url in panel.urls.prefix(8) { hub.open(file: url.path, in: store.project) }
    }
    private func movePane(_ by: Int) {
        guard !panes.isEmpty else { return }
        let i = panes.firstIndex { $0 == hub.focused } ?? -1
        hub.focus(panes[(i + by + panes.count) % panes.count])
    }

    var body: some Commands {
        // File: new workspace instead of new window; close the pane instead of the window
        CommandGroup(replacing: .newItem) {
            Button("New Workspace") { store.newWorkspace() }.keyboardShortcut("n")
            Button("Open Folder…") { store.chooseProject() }.keyboardShortcut("o")
            Button("Open File…") { openFile() }.keyboardShortcut("o", modifiers: [.command, .shift])
        }
        CommandGroup(replacing: .saveItem) {
            Button("Save") { hub.saveFocused() }.keyboardShortcut("s").disabled(focusedDoc == nil)
            Button("Close Pane") { if let d = focusedDoc { hub.closeDoc(d.id) } else if let m = focusedMember { hub.close(m.id) } }
                .keyboardShortcut("w").disabled(focusedMember == nil && focusedDoc == nil)
            Button("Close Workspace") { store.forget(workspace: store.project) }
                .keyboardShortcut("w", modifiers: [.command, .shift]).disabled(store.project.isEmpty)
        }
        // Team: add members, split panes
        CommandMenu("Team") {
            Button("New Terminal") { hub.add(kind: "shell", project: store.project) }.keyboardShortcut("t")
            ForEach(Array(TeamHub.kinds.enumerated()), id: \.offset) { i, k in
                Button("New \(k.label) Member") { hub.add(kind: k.id, project: store.project) }
                    .keyboardShortcut(KeyEquivalent(Character("\(i + 1)")), modifiers: [.command, .shift])
            }
            Divider()
            Button("Split Right") { split(horizontal: true) }.keyboardShortcut("d")
            Button("Split Down") { split(horizontal: false) }.keyboardShortcut("d", modifiers: [.command, .shift])
            Divider()
            Button("Next Pane") { movePane(1) }.keyboardShortcut("]", modifiers: [.command, .option])
            Button("Previous Pane") { movePane(-1) }.keyboardShortcut("[", modifiers: [.command, .option])
            Divider()
            Button("Jump to Unread") { jumpToUnread() }.keyboardShortcut("u", modifiers: [.command, .shift])
        }
        // Workspaces: step and jump by number
        CommandMenu("Workspace") {
            Button("Next Workspace") { store.step(1, in: workspaces) }.keyboardShortcut("]", modifiers: [.command, .shift])
            Button("Previous Workspace") { store.step(-1, in: workspaces) }.keyboardShortcut("[", modifiers: [.command, .shift])
            Divider()
            ForEach(1...9, id: \.self) { n in
                Button("Workspace \(n)") { if workspaces.indices.contains(n - 1) { store.select(workspace: workspaces[n - 1]) } }
                    .keyboardShortcut(KeyEquivalent(Character("\(n)")))
                    .disabled(!workspaces.indices.contains(n - 1))
            }
            Divider()
            Button("Toggle Files Panel") { store.filesHidden.toggle() }.keyboardShortcut("b", modifiers: [.command, .option])
        }
    }

    /// Focus the pane that rang its bell, else the run that needs attention.
    private func jumpToUnread() {
        if let id = hub.ringing.first, let m = hub.members.first(where: { $0.id == id }) {
            store.select(workspace: m.workspace)
            hub.focus(id)
        } else { store.jumpToAttention() }
    }
}

/// The Argo icon in the macOS menu bar: what needs you, jump to any workspace or terminal, add a member.
struct MenuBarContent: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var hub: TeamHub
    @Environment(\.openWindow) var openWindow

    /// The Argo star (made from web/public/media/argo.png), as a template so it follows the menu bar's color.
    static let logo: NSImage? = {
        guard let img = NSImage(named: "MenuBarIcon") else { return nil }
        img.isTemplate = true
        img.size = NSSize(width: img.size.width * 18 / max(img.size.height, 1), height: 18)
        return img
    }()

    static func needsCount(_ store: Store, _ hub: TeamHub) -> Int {
        (store.state?.runs ?? []).reduce(0) { $0 + store.attention(for: $1.id).count } + hub.ringing.count
    }

    private func show() {
        NSApp.activate(ignoringOtherApps: true)
        if let w = NSApp.windows.first(where: { $0.canBecomeMain }) { w.makeKeyAndOrderFront(nil) } else { openWindow(id: "main") }
    }

    var body: some View {
        let needs = Self.needsCount(store, hub)
        Button("Show Argo") { show() }
        if needs > 0 {
            Button("\(needs) need\(needs == 1 ? "s" : "") you — jump to it") {
                show()
                if let id = hub.ringing.first, let m = hub.members.first(where: { $0.id == id }) { store.select(workspace: m.workspace); hub.focus(id) }
                else { store.jumpToAttention() }
            }
        }
        Divider()
        ForEach(store.workspaceList(terminals: hub.members.map(\.workspace)), id: \.self) { ws in
            let members = hub.members(in: ws)
            Menu(store.name(of: ws)) {
                Button("Open workspace") { show(); store.select(workspace: ws) }
                if !members.isEmpty { Divider() }
                ForEach(members) { m in
                    Button("\(m.name)\(hub.ringing.contains(m.id) ? "  🔔" : "")\(hub.exited.contains(m.id) ? "  (exited)" : "")") {
                        show(); store.select(workspace: ws); hub.focus(m.id)
                    }
                }
            }
        }
        Button("New Workspace") { show(); store.newWorkspace() }
        Divider()
        Menu("Add Member") {
            ForEach(TeamHub.kinds, id: \.id) { k in
                Button(k.label) { show(); hub.add(kind: k.id, project: store.project) }
                    .disabled(k.bin != nil && !(store.agent(k.id)?.installed ?? true))
            }
        }
        Divider()
        Button("Quit Argo") { NSApp.terminate(nil) }.keyboardShortcut("q")
    }
}
