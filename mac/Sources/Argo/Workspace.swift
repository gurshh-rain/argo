import SwiftUI

/// The main area: the workspace's terminals on top, and below them the agents of the run that is
/// working in this workspace, so you watch them alongside your own shells.
struct WorkspaceView: View {
    @EnvironmentObject var hub: TeamHub
    @EnvironmentObject var store: Store

    var body: some View {
        let ws = store.project
        let terminals = hub.members(in: ws)
        let runs = store.runs(in: ws)
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "folder.fill").font(.system(size: 12)).foregroundStyle(Theme.dim)
                Text(ws.isEmpty ? "~" : store.name(of: ws)).font(.system(size: 13, weight: .bold)).foregroundStyle(Theme.text)
                Text("\(terminals.count) terminal\(terminals.count == 1 ? "" : "s")")
                    .font(.system(size: 10.5, design: .monospaced)).foregroundStyle(Theme.dim)
                Spacer()
                AddMemberMenu()
                if store.filesHidden {
                    Button { store.filesHidden = false } label: { Image(systemName: "sidebar.right") }
                        .buttonStyle(.plain).font(.system(size: 12)).foregroundStyle(Theme.dim).help("Show panel")
                }
            }
            .padding(.leading, store.sidebarHidden ? 110 : 10).padding(.trailing, 10).frame(height: 30).background(Theme.bg)
            HLine()
            if !runs.isEmpty {
                RunStrip(runs: runs)
                HLine()
            }
            if let run = store.run { WaitingBanner(run: run) }
            // Everything below is one resizable stack: the terminals, then the run's own panes.
            // Subtasks handed to a terminal are watched there, so they get no pane of their own.
            let panes: [TaskItem] = (store.run?.tasks ?? []).filter { !$0.inTerminal && !store.closedPanes.contains("\(store.selectedRun ?? "")/\($0.id)") }
            let showOrch = store.run != nil && !store.closedPanes.contains("\(store.selectedRun ?? "")/orchestrator")
            let hasTerminals = hub.layouts[ws] != nil && !terminals.isEmpty
            let keys = (hasTerminals ? ["terminals:\(ws)"] : []) + panes.map { "pane:\(ws):\($0.id)" } + (showOrch ? ["pane:\(ws):orchestrator"] : [])
            if keys.isEmpty {
                VStack(spacing: 8) {
                    Text("No terminals open").font(.system(size: 18, weight: .semibold)).foregroundStyle(Theme.text)
                    Text("Open a terminal and start Claude, Devin or Codex in it. Tasks you type below are handed to those terminals, so you watch the agents work right there.")
                        .font(.system(size: 12.5)).foregroundStyle(Theme.dim).multilineTextAlignment(.center).frame(maxWidth: 480)
                    AddMemberMenu().padding(.top, 6)
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                SplitStack(horizontal: false, keys: keys) { i in
                    if hasTerminals && i == 0, let l = hub.layouts[ws] {
                        LayoutView(node: l)
                    } else if let run = store.run {
                        let j = i - (hasTerminals ? 1 : 0)
                        if j < panes.count { TaskPane(run: run, task: panes[j]) } else { OrchestratorPane(run: run) }
                    }
                }
            }
        }
        .onAppear { openFirstTerminal() }
        .onChange(of: store.project) { openFirstTerminal() }
        .onChange(of: store.state == nil) { openFirstTerminal() }
    }

    /// Each workspace starts with one shell to split from. Only once, so closing it does not bring it back.
    func openFirstTerminal() {
        let ws = store.project
        guard store.state != nil, ProcessInfo.processInfo.environment["ARGO_DEMO_TEAM"] == nil,
              !hub.opened.contains(ws), hub.members(in: ws).isEmpty else { return }
        hub.opened.insert(ws)
        hub.add(kind: "shell", project: ws)
    }
}

/// Subtasks that are waiting for a terminal running their CLI, with the two ways to unblock them.
struct WaitingBanner: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var hub: TeamHub
    let run: Run
    var body: some View {
        let waiting = run.tasks.filter { $0.delegate?.state == "waiting" }
        ForEach(waiting) { t in
            let label = store.agent(t.effective.agent)?.label ?? "a CLI"
            HStack(spacing: 8) {
                Image(systemName: "hourglass").foregroundStyle(Theme.ring)
                Text("\(t.id): \(t.title)").font(.system(size: 11.5, weight: .medium)).foregroundStyle(Theme.text).lineLimit(1)
                Text("is waiting for a free terminal running \(label). Start it in a shell, or:").font(.system(size: 11.5)).foregroundStyle(Theme.dim).lineLimit(1)
                Spacer()
                Button("Open \(label) terminal") { hub.add(kind: t.effective.agent ?? "shell", project: store.project) }
                Button("Run in background") { store.background(run: run.id, task: t.id) }
            }
            .controlSize(.small).padding(.horizontal, 10).frame(height: 30).background(Theme.rowSelected)
            HLine()
        }
    }
}

/// The runs of this workspace as a tab row. Click one to watch its agents; right-click to delete it.
struct RunStrip: View {
    @EnvironmentObject var store: Store
    let runs: [Run]

    var body: some View {
        HStack(spacing: 0) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 0) {
                    ForEach(runs) { run in
                        let on = store.selectedRun == run.id
                        let needs = store.attention(for: run.id).count
                        Button { if on { store.hideRunPanes() } else { store.show(run: run.id) } } label: {
                            HStack(spacing: 6) {
                                StatusDot(status: run.status)
                                Text(run.goal).font(.system(size: 12)).foregroundStyle(on ? Theme.text : Theme.dim).lineLimit(1).frame(maxWidth: 220, alignment: .leading).fixedSize()
                                if needs > 0 {
                                    Text("\(needs)").font(.system(size: 9, weight: .bold)).foregroundStyle(.white).frame(width: 14, height: 14).background(Theme.ring, in: Circle())
                                }
                            }
                            .padding(.horizontal, 10).frame(height: 28)
                            .overlay(alignment: .top) { Rectangle().fill(on ? Theme.ring : Color.clear).frame(height: 2) }
                            .overlay(alignment: .trailing) { VLine() }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .help(on ? "Click to hide this run's agents" : run.goal)
                        .contextMenu {
                            Button(on ? "Hide agents" : "Show agents") { if on { store.hideRunPanes() } else { store.show(run: run.id) } }
                            if store.closedPanes.contains(where: { $0.hasPrefix(run.id + "/") }) {
                                Button("Show all panes") { store.closedPanes = store.closedPanes.filter { !$0.hasPrefix(run.id + "/") } }
                            }
                            Button("Delete run…", role: .destructive) { store.askDeleteRun(run) }
                        }
                    }
                }
            }
            Spacer(minLength: 8)
            if let run = store.run {
                HStack(spacing: 8) {
                    Text(run.hasRepo ? "\(run.status.pretty) · \(run.branch)" : "\(run.status.pretty) · no repo")
                        .font(.system(size: 10.5, design: .monospaced)).foregroundStyle(Theme.dim).lineLimit(1)
                    if run.status == "awaiting_approval" {
                        Button("Approve & run") { store.runAction("approve") }.buttonStyle(.borderedProminent).keyboardShortcut(.return, modifiers: .command)
                            .help("Click any agent label below to override it first")
                    }
                    if run.hasRepo, ["done", "needs_attention"].contains(run.status), run.report != nil {
                        Button(run.applied == true ? "Applied" : "Merge into \(run.baseBranch)") { store.runAction("apply") }.disabled(run.applied == true)
                    }
                    if run.isActive || run.status == "awaiting_approval" { Button("Cancel") { store.runAction("cancel") } }
                }
                .controlSize(.small).padding(.trailing, 8)
            }
        }
        .frame(height: 28).background(Theme.bg)
    }
}
