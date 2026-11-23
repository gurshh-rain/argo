import SwiftUI

struct LogView: View {
    let lines: [String]
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 1) {
                    ForEach(Array(lines.enumerated()), id: \.offset) { i, l in
                        Text(l.isEmpty ? " " : l).font(Theme.mono).foregroundStyle(color(l))
                            .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).id(i)
                    }
                    Color.clear.frame(height: 1).id("end")
                }.padding(8)
            }
            .onChange(of: lines.count) { proxy.scrollTo("end", anchor: .bottom) }
            .onAppear { proxy.scrollTo("end", anchor: .bottom) }
        }
    }
    func color(_ l: String) -> Color {
        if l.hasPrefix("✓") { return Theme.green }
        if l.hasPrefix("✗") || l.contains("error:") { return Theme.red }
        if l.hasPrefix("⚠") || l.hasPrefix("Follow-up") { return Theme.amber }
        if l.hasPrefix("⏺") || l.hasPrefix("$ ") || l.hasPrefix("✎") { return Theme.ring }
        if l.hasPrefix("──") || l.hasPrefix("  ⎿") || l.hasPrefix("· ") { return Theme.dim }
        return Theme.text
    }
}

/// A cmux-style pane: flat surface, a tab strip on top (active tab carries a blue top line), hairline borders.
struct PaneFrame<Tab: View, Trailing: View, Content: View>: View {
    var ring = false
    var active = false
    @ViewBuilder var tab: Tab
    @ViewBuilder var trailing: Trailing
    @ViewBuilder var content: Content
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                HStack(spacing: 6) { tab }
                    .padding(.horizontal, 10).frame(height: 28).frame(minWidth: 90)
                    .overlay(alignment: .top) { Rectangle().fill(active || ring ? Theme.ring : Color.clear).frame(height: 2) }
                    .overlay(alignment: .trailing) { VLine() }
                Spacer(minLength: 6)
                HStack(spacing: 6) { trailing }.fixedSize().padding(.trailing, 8).layoutPriority(1)
            }
            .frame(height: 28)
            HLine()
            content.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Theme.pane)
        .overlay(Rectangle().strokeBorder(ring ? Theme.ring : Color.clear, lineWidth: 2))
    }
}

/// Shows which agent and model own a subtask, and lets the user override the orchestrator's choice.
struct AssignmentMenu: View {
    @EnvironmentObject var store: Store
    let task: TaskItem
    var body: some View {
        let a = task.effective
        let spec = store.agent(a.agent)
        let model = (a.model ?? "").isEmpty ? "cli default" : a.model!
        let label = (Text(spec?.label ?? a.agent ?? "?").foregroundColor(Theme.agent(a.agent))
            + Text(" · \(model)").foregroundColor(Theme.text)
            + Text(spec?.reasoning == true ? " · \(a.reasoning ?? "")" : "").foregroundColor(Theme.dim))
            .font(.system(size: 10.5, weight: .medium))
        let chip = Chip(text: task.override == nil ? "auto" : "override", color: task.override == nil ? Theme.dim : Theme.amber)

        if task.canOverride {
            Menu {
                Section("Agent") {
                    ForEach(store.installedAgents) { ag in
                        Button { store.overrideTask(task.id, agent: ag.id) } label: { check(ag.label, a.agent == ag.id) }
                    }
                }
                if let spec {
                    Section("Model") {
                        ForEach(spec.models, id: \.self) { m in
                            Button { store.overrideTask(task.id, model: m.id) } label: { check("\(m.id.isEmpty ? "cli default" : m.id) — \(m.note)", a.model == m.id) }
                        }
                    }
                    if spec.reasoning {
                        Section("Reasoning") {
                            ForEach(["low", "medium", "high"], id: \.self) { r in
                                Button { store.overrideTask(task.id, reasoning: r) } label: { check(r, a.reasoning == r) }
                            }
                        }
                    }
                }
                if task.override != nil {
                    Divider()
                    Button("Use the orchestrator's choice") { store.overrideTask(task.id, clear: true) }
                }
            } label: { label }
            .menuStyle(.borderlessButton).fixedSize()
            .help("Click to override. Orchestrator's reason: \(task.auto.why ?? "")")
            if let d = task.difficulty { Chip(text: d, color: d == "hard" ? Theme.text : Theme.dim).help("Difficulty, which decides the model") }
            chip
        } else {
            label.help(task.auto.why ?? "")
            if let d = task.difficulty { Chip(text: d, color: d == "hard" ? Theme.text : Theme.dim).help("Difficulty, which decides the model") }
            chip
        }
    }
    @ViewBuilder func check(_ title: String, _ on: Bool) -> some View {
        if on { Label(title, systemImage: "checkmark") } else { Text(title) }
    }
}

struct TaskPane: View {
    @EnvironmentObject var store: Store
    let run: Run
    let task: TaskItem
    var body: some View {
        let needs = store.attention(for: run.id, task: task.id)
        PaneFrame(ring: !needs.isEmpty, active: ["running", "merging"].contains(task.status)) {
            Image(systemName: "apple.terminal").font(.system(size: 11)).foregroundStyle(Theme.text)
            Text("\(task.id): \(task.title)").font(.system(size: 12)).foregroundStyle(Theme.text).lineLimit(1)
            StatusDot(status: task.status)
        } trailing: {
            AssignmentMenu(task: task)
            ClosePane(key: "\(run.id)/\(task.id)")
        } content: {
            VStack(spacing: 0) {
                let lines = store.logs[task.id] ?? []
                if lines.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(task.description).font(.system(size: 12)).foregroundStyle(Theme.dim)
                        if !task.dependsOn.isEmpty { Text("waits for \(task.dependsOn.joined(separator: ", "))").font(.system(size: 12)).foregroundStyle(Theme.amber) }
                        Text("why: \(task.auto.why ?? "")").font(.system(size: 12)).foregroundStyle(Theme.dim.opacity(0.7))
                    }.padding(8).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                } else {
                    LogView(lines: lines)
                }
                if let a = needs.first {
                    HStack(spacing: 8) {
                        Image(systemName: "bell.badge.fill").foregroundStyle(Theme.ring)
                        Text(a.message).font(.system(size: 11)).foregroundStyle(Theme.text).lineLimit(2)
                        Spacer()
                        if a.kind == "permission" { Button("Approve") { store.instruct("approve") }.buttonStyle(ArgoButton(kind: .primary)) }
                        Button("Retry") { store.retry(task.id) }
                        Button("Dismiss") { store.dismiss(a) }
                    }
                    .buttonStyle(ArgoButton()).padding(.horizontal, 8).padding(.vertical, 6).background(Theme.rowSelected)
                } else if task.status == "failed" {
                    HStack {
                        Text(task.error ?? "failed").font(.system(size: 11)).foregroundStyle(Theme.red).lineLimit(2)
                        Spacer()
                        Button("Retry") { store.retry(task.id) }.buttonStyle(ArgoButton())
                    }.padding(6).background(Theme.red.opacity(0.1))
                }
            }
        }
    }
}

struct ClosePane: View {
    @EnvironmentObject var store: Store
    let key: String
    var body: some View {
        Button { store.closedPanes.insert(key); store.openPanes.remove(key) } label: { Image(systemName: "xmark").font(.system(size: 9, weight: .semibold)) }
            .buttonStyle(IconButton()).foregroundStyle(Theme.dim).help("Close this pane")
    }
}

struct OrchestratorPane: View {
    @EnvironmentObject var store: Store
    let run: Run
    var body: some View {
        PaneFrame {
            Image(systemName: "apple.terminal").font(.system(size: 11)).foregroundStyle(Theme.text)
            Text("orchestrator").font(.system(size: 12)).foregroundStyle(Theme.text)
        } trailing: {
            if let p = run.planner {
                Text("planned by \(store.agent(p.agent)?.label ?? "?") · \(p.model ?? "")").font(.system(size: 10.5)).foregroundStyle(Theme.dim)
            }
            ClosePane(key: "\(run.id)/orchestrator")
        } content: {
            LogView(lines: (store.logs["orchestrator"] ?? []).filter { !$0.hasPrefix("{") })
        }
    }
}
