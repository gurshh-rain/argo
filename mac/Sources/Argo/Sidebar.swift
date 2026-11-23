import SwiftUI

struct Sidebar: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var hub: TeamHub
    @Binding var sheet: Sheet?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            SidebarToolbar().padding(.leading, 78)
            ScrollView {
                LazyVStack(spacing: 4) {
                    ForEach(store.workspaceList(terminals: hub.members.map(\.workspace)), id: \.self) { ws in
                        WorkspaceTab(ws: ws)
                    }
                    Button(action: store.newWorkspace) {
                        Label("New workspace", systemImage: "plus").font(.system(size: 11.5)).foregroundStyle(Theme.dim)
                            .padding(.horizontal, 10).padding(.vertical, 7).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain).help("Add another workspace. Use the + menu to open a folder as one.")
                }.padding(.horizontal, 6)
            }
            VStack(alignment: .leading, spacing: 6) {
                ForEach(store.state?.agents ?? []) { a in
                    HStack(spacing: 6) {
                        Circle().fill(a.installed == true ? Theme.agent(a.id) : Theme.dim.opacity(0.4)).frame(width: 6, height: 6)
                        Text(a.label).foregroundStyle(a.installed == true ? Theme.text : Theme.dim)
                        Spacer()
                        Text(a.installed == true ? (a.id == "ollama" ? "\(a.models.count) model\(a.models.count == 1 ? "" : "s")" : "ready") : a.note != nil ? "needs setup" : "not installed")
                            .foregroundStyle(Theme.dim)
                    }
                    .font(.system(size: 10.5))
                    .help(a.note ?? (a.id == "ollama" && a.installed == true ? a.models.map { "\($0.id) (\($0.note))" }.joined(separator: "\n") : a.version ?? ""))
                }
                HStack {
                    Button { sheet = .settings } label: { Label("Settings", systemImage: "gearshape") }
                    Button { sheet = .mobile } label: { Label("Phone", systemImage: "iphone") }
                    Spacer()
                }
                .buttonStyle(ArgoButton()).padding(.top, 4)
            }.padding(10)
        }
        .frame(width: 248)
        .background(Theme.sidebar)
    }
}

/// The row of controls beside the traffic lights, as in cmux: sidebar, notifications, new, back, forward.
struct SidebarToolbar: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var hub: TeamHub
    var body: some View {
        let waiting = store.state?.attention.filter { $0.kind != "completed" }.count ?? 0
        let list = store.workspaceList(terminals: hub.members.map(\.workspace))
        HStack(spacing: 5) {
            Button { withAnimation(.easeOut(duration: 0.15)) { store.sidebarHidden.toggle() } } label: { Image(systemName: "sidebar.left") }
                .help("Hide or show the sidebar").keyboardShortcut("b", modifiers: .command)
            Button(action: store.jumpToAttention) {
                Image(systemName: waiting > 0 ? "bell.badge" : "bell").foregroundStyle(waiting > 0 ? Theme.ring : Theme.dim)
            }.help(waiting > 0 ? "\(waiting) agent\(waiting == 1 ? "" : "s") waiting for you" : "No notifications")
            Menu {
                Button("New workspace", action: store.newWorkspace)
                Button("Open folder as workspace…", action: store.chooseProject)
                Divider()
                ForEach(TeamHub.kinds, id: \.id) { k in
                    Button("New \(k.label) terminal") { hub.add(kind: k.id, project: store.project) }
                        .disabled(k.bin != nil && !(store.agent(k.id)?.installed ?? true))
                }
            } label: { Image(systemName: "plus") }
            .menuStyle(.borderlessButton).fixedSize().help("New workspace or terminal")
            Button { store.step(-1, in: list) } label: { Image(systemName: "arrow.left") }.help("Previous workspace")
            Button { store.step(1, in: list) } label: { Image(systemName: "arrow.right") }.help("Next workspace")
            Spacer(minLength: 0)
        }
        .buttonStyle(IconButton()).font(.system(size: 12.5)).foregroundStyle(Theme.dim).tint(Theme.dim).frame(height: 30)
    }
}

/// One workspace: a folder with its terminals and the runs started in it. Selected is solid blue, like cmux's vertical tab.
struct WorkspaceTab: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var hub: TeamHub
    let ws: String
    var body: some View {
        let on = store.project == ws
        let runs = store.runs(in: ws)
        let terminals = hub.members(in: ws)
        let needs = runs.flatMap { store.attention(for: $0.id) }
        let active = runs.filter(\.isActive).count
        let ringing = terminals.contains { hub.ringing.contains($0.id) }
        let path = WS.folder(ws).isEmpty ? "no folder" : ws.replacingOccurrences(of: NSHomeDirectory(), with: "~")
        let counts = [terminals.isEmpty ? nil : "\(terminals.count) terminal\(terminals.count == 1 ? "" : "s")",
                      active > 0 ? "\(active) running" : nil].compactMap { $0 }.joined(separator: " · ")
        Button { store.select(workspace: ws) } label: {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 7) {
                    Image(systemName: "pin.fill").font(.system(size: 9)).rotationEffect(.degrees(45)).opacity(on ? 1 : 0.5)
                    Text(store.name(of: ws)).font(.system(size: 13, weight: .bold)).lineLimit(1)
                    Spacer(minLength: 0)
                    if active > 0 { StatusDot(status: "running") }
                    if !needs.isEmpty || ringing {
                        Text("\(max(needs.count, 1))").font(.system(size: 9, weight: .bold)).foregroundStyle(on ? Theme.selected : .white)
                            .frame(width: 15, height: 15).background(on ? Color.white : Theme.ring, in: Circle())
                    }
                }
                if let d = store.descriptions[ws] {
                    Text(d).font(.system(size: 11.5)).opacity(0.95).lineLimit(3).multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(needs.first?.message ?? (counts.isEmpty ? path : "\(path) · \(counts)"))
                    .font(.system(size: 10.5)).opacity(0.85).lineLimit(needs.isEmpty ? 1 : 2).truncationMode(.head)
                    .multilineTextAlignment(.leading)
            }
            .foregroundStyle(on ? Color.white : Theme.text)
            .padding(.horizontal, 10).padding(.vertical, 8).frame(maxWidth: .infinity, alignment: .leading)
            .background(on ? Theme.selected : Color.clear, in: RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke((!needs.isEmpty || ringing) && !on ? Theme.ring : Color.clear, lineWidth: 1.5))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain).help(WS.folder(ws).isEmpty ? "A workspace without a folder: terminals start in your home folder" : ws)
        .contextMenu {
            Button("Rename…") { store.renaming = ws }
            Button(store.descriptions[ws] == nil ? "Add description…" : "Edit description…") { store.describing = ws }
            if store.descriptions[ws] != nil { Button("Remove description") { store.describe(ws, "") } }
            if !WS.folder(ws).isEmpty { Button("Reveal in Finder") { NSWorkspace.shared.open(URL(fileURLWithPath: ws)) } }
            Button("Delete workspace…", role: .destructive) {
                let n = runs.count, t = terminals.count
                store.confirm = Store.Confirm(
                    title: "Delete the workspace “\(store.name(of: ws))”?",
                    message: "This closes its \(t) terminal\(t == 1 ? "" : "s") and deletes its \(n) run\(n == 1 ? "" : "s") with their records."
                        + (WS.folder(ws).isEmpty ? "" : " The folder and its files are not touched; branches with unmerged work are kept."),
                    button: "Delete workspace"
                ) {
                    hub.closeAll(in: ws)
                    store.forget(workspace: ws)
                }
            }
        }
    }
}
