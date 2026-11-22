import SwiftUI

struct Sidebar: View {
    @EnvironmentObject var store: Store
    @Binding var sheet: Sheet?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            SidebarToolbar().padding(.leading, 78)
            WorkspaceTab().padding(.horizontal, 6).padding(.bottom, 4)

            ScrollView {
                LazyVStack(spacing: 4) {
                    TeamSection()
                    Text("RUNS").font(.system(size: 9.5, weight: .semibold)).kerning(0.6).foregroundStyle(Theme.dim)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 10).padding(.leading, 4)
                    ForEach(store.state?.runs ?? []) { run in RunTab(run: run) }
                }.padding(.horizontal, 6)
            }
            VStack(alignment: .leading, spacing: 6) {
                ForEach(store.state?.agents ?? []) { a in
                    HStack(spacing: 6) {
                        Circle().fill(a.installed == true ? Theme.agent(a.id) : Theme.dim.opacity(0.4)).frame(width: 6, height: 6)
                        Text(a.label).foregroundStyle(a.installed == true ? Theme.text : Theme.dim)
                        Spacer()
                        Text(a.installed == true ? "ready" : "not installed").foregroundStyle(Theme.dim)
                    }.font(.system(size: 10.5))
                }
                HStack {
                    Button { sheet = .settings } label: { Image(systemName: "gearshape") }.help("Settings")
                    Button { sheet = .mobile } label: {
                        Text("Phone").font(.system(size: 10.5, weight: .semibold)).padding(.horizontal, 8).padding(.vertical, 2)
                            .overlay(Capsule().stroke(Theme.dim.opacity(0.6), lineWidth: 1))
                    }
                    Spacer()
                }
                .buttonStyle(.plain).font(.system(size: 11)).foregroundStyle(Theme.dim).padding(.top, 4)
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
        HStack(spacing: 13) {
            Button { withAnimation(.easeOut(duration: 0.15)) { store.sidebarHidden.toggle() } } label: { Image(systemName: "sidebar.left") }
                .help("Hide or show the sidebar").keyboardShortcut("b", modifiers: .command)
            Button(action: store.jumpToAttention) {
                Image(systemName: waiting > 0 ? "bell.badge" : "bell").foregroundStyle(waiting > 0 ? Theme.ring : Theme.dim)
            }.help(waiting > 0 ? "\(waiting) agent\(waiting == 1 ? "" : "s") waiting for you" : "No notifications")
            Menu {
                ForEach(TeamHub.kinds, id: \.id) { k in
                    Button("New \(k.label) terminal") { hub.add(kind: k.id, project: store.project); store.showTeam = true }
                        .disabled(k.bin != nil && !(store.agent(k.id)?.installed ?? true))
                }
                Divider()
                Button("Open project…", action: store.chooseProject)
                Button("No project (research)", action: store.clearProject).disabled(store.project.isEmpty)
            } label: { Image(systemName: "plus") }
            .menuStyle(.borderlessButton).fixedSize().help("New terminal or project")
            Button { store.step(-1) } label: { Image(systemName: "arrow.left") }.help("Previous")
            Button { store.step(1) } label: { Image(systemName: "arrow.right") }.help("Next")
            Spacer(minLength: 0)
        }
        .buttonStyle(.plain).font(.system(size: 12.5)).foregroundStyle(Theme.dim).tint(Theme.dim).frame(height: 30)
    }
}

/// The workspace: the project and its terminals. Selected is solid blue, like cmux's vertical tab.
struct WorkspaceTab: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var hub: TeamHub
    var body: some View {
        let on = store.showTeam
        let path = store.project.isEmpty ? "~" : store.project.replacingOccurrences(of: NSHomeDirectory(), with: "~")
        Button { store.showTeam = true } label: {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 7) {
                    Image(systemName: "pin.fill").font(.system(size: 9)).rotationEffect(.degrees(45))
                    Text(store.project.isEmpty ? "No project" : (store.project as NSString).lastPathComponent).font(.system(size: 13, weight: .bold)).lineLimit(1)
                    Spacer(minLength: 0)
                    if !hub.ringing.isEmpty { Image(systemName: "bell.fill").font(.system(size: 9)) }
                }
                Text(hub.members.isEmpty ? path : "\(path) · \(hub.members.count) terminal\(hub.members.count == 1 ? "" : "s")")
                    .font(.system(size: 10.5, design: .monospaced)).opacity(0.85).lineLimit(1).truncationMode(.head)
            }
            .foregroundStyle(on ? Color.white : Theme.text)
            .padding(.horizontal, 10).padding(.vertical, 8).frame(maxWidth: .infinity, alignment: .leading)
            .background(on ? Theme.selected : Color.clear, in: RoundedRectangle(cornerRadius: 6))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain).help(store.project)
    }
}

struct RunTab: View {
    @EnvironmentObject var store: Store
    let run: Run
    var selected: Bool { store.selectedRun == run.id }
    var needs: [AttentionItem] { store.attention(for: run.id) }
    var body: some View {
        let done = run.tasks.filter { $0.status == "done" }.count
        let on = selected && !store.showTeam
        Button { store.selectedRun = run.id; store.showTeam = false } label: {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    if on { Image(systemName: "pin.fill").font(.system(size: 9)).rotationEffect(.degrees(45)).foregroundStyle(.white) } else { StatusDot(status: run.status) }
                    Text(run.goal).font(.system(size: 12.5, weight: .bold)).foregroundStyle(on ? .white : Theme.text).lineLimit(1)
                    Spacer(minLength: 0)
                    if !needs.isEmpty {
                        Text("\(needs.count)").font(.system(size: 9, weight: .bold)).foregroundStyle(on ? Theme.selected : .white)
                            .frame(width: 15, height: 15).background(on ? Color.white : Theme.ring, in: Circle())
                    }
                }
                if run.hasRepo {
                HStack(spacing: 4) {
                    Image(systemName: "arrow.triangle.branch").font(.system(size: 8))
                    Text(run.branch).lineLimit(1).truncationMode(.middle)
                }.font(.system(size: 10, design: .monospaced)).foregroundStyle(on ? Color.white.opacity(0.85) : Theme.dim)
                }
                Text(needs.first?.message ?? "\(run.projectName) · \(run.status.pretty)\(run.tasks.isEmpty ? "" : " · \(done)/\(run.tasks.count)")")
                    .font(.system(size: 10)).foregroundStyle(on ? Color.white.opacity(0.85) : needs.isEmpty ? Theme.dim : Theme.ring).lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
            .padding(.horizontal, 10).padding(.vertical, 8).frame(maxWidth: .infinity, alignment: .leading)
            .background(on ? Theme.selected : Color.clear, in: RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(needs.isEmpty || on ? Color.clear : Theme.ring, lineWidth: 1.5))
            .contentShape(Rectangle())
        }.buttonStyle(.plain)
    }
}

struct TeamSection: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var hub: TeamHub
    var body: some View {
        VStack(spacing: 2) {
            ForEach(hub.members) { m in
                Button { store.showTeam = true; hub.focus(m.id) } label: {
                    let on = store.showTeam && hub.focused == m.id
                    HStack(spacing: 6) {
                        Circle().fill(Theme.agent(m.kind)).frame(width: 7, height: 7)
                        Text(m.name).font(.system(size: 12.5, weight: on ? .bold : .medium)).foregroundStyle(on ? .white : Theme.text)
                        Spacer()
                        if hub.ringing.contains(m.id) { Image(systemName: "bell.fill").font(.system(size: 9)).foregroundStyle(Theme.ring) }
                        if hub.exited.contains(m.id) { Text("exited").font(.system(size: 9.5)).foregroundStyle(Theme.dim) }
                    }
                    .padding(.leading, 22).padding(.trailing, 10).padding(.vertical, 5)
                    .background(on ? Theme.rowSelected : .clear, in: RoundedRectangle(cornerRadius: 6))
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(hub.ringing.contains(m.id) ? Theme.ring : .clear, lineWidth: 1.5))
                    .contentShape(Rectangle())
                }.buttonStyle(.plain)
            }
        }
    }
}
