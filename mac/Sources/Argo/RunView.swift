import SwiftUI

struct RunView: View {
    @EnvironmentObject var store: Store
    let run: Run
    @State private var inspector = "Record"

    var body: some View {
        VStack(spacing: 0) {
            header
            HLine()
            HStack(spacing: 0) {
                PaneGrid(run: run)
                VLine()
                Inspector(run: run, tab: $inspector).frame(width: 300)
            }
        }
    }

    var header: some View {
        HStack(spacing: 8) {
            Image(systemName: "folder.fill").font(.system(size: 12)).foregroundStyle(Theme.dim)
            Text(run.projectName).font(.system(size: 13, weight: .bold)).foregroundStyle(Theme.text)
            StatusDot(status: run.status)
            Text(run.hasRepo ? "\(run.status.pretty) · \(run.branch)" : "\(run.status.pretty) · no repo").font(.system(size: 11, design: .monospaced)).foregroundStyle(Theme.dim).lineLimit(1)
            Spacer()
            if run.status == "awaiting_approval" {
                Text("Review the plan. Click any agent label to override it.").font(.system(size: 11)).foregroundStyle(Theme.amber)
                Button("Approve & run") { store.runAction("approve") }.buttonStyle(.borderedProminent).keyboardShortcut(.return, modifiers: .command)
            }
            if run.hasRepo, ["done", "needs_attention"].contains(run.status), run.report != nil {
                Button(run.applied == true ? "Applied" : "Merge into \(run.baseBranch)") { store.runAction("apply") }.disabled(run.applied == true)
            }
            if run.isActive || run.status == "awaiting_approval" { Button("Cancel") { store.runAction("cancel") } }
        }
        .controlSize(.small).padding(.leading, store.sidebarHidden ? 110 : 10).padding(.trailing, 10).frame(height: 30)
        .background(Theme.bg)
    }
}

struct Inspector: View {
    @EnvironmentObject var store: Store
    let run: Run
    @Binding var tab: String

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 4) {
                ForEach(["Record", "Report"], id: \.self) { t in
                    Button { tab = t } label: {
                        Label(t, systemImage: t == "Record" ? "folder" : "checklist")
                            .font(.system(size: 11.5, weight: .medium)).foregroundStyle(tab == t ? Theme.text : Theme.dim)
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(tab == t ? Theme.chip : .clear, in: RoundedRectangle(cornerRadius: 5))
                    }.buttonStyle(.plain)
                }
                Spacer()
            }
            .padding(.horizontal, 8).frame(height: 28)
            HLine()
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if tab == "Record" { record } else { report }
                }.padding(10).frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .background(Theme.pane)
    }

    @ViewBuilder var record: some View {
        section("Goal") { body(run.goal) }
        section("Constraints") { bullets(run.constraints, empty: "none stated") }
        section("Follow-ups") { bullets(run.followups.map { "[\($0.source)] \($0.text)" }, empty: "none") }
        section("Decisions") {
            if run.decisions.isEmpty { body("none yet").opacity(0.6) }
            ForEach(run.decisions, id: \.self) { d in
                VStack(alignment: .leading, spacing: 1) {
                    Text(d.by).font(.system(size: 9.5, design: .monospaced)).foregroundStyle(Theme.agent(d.by.components(separatedBy: "/").first))
                    body(d.text)
                }
            }
        }
        section("Who did what") {
            ForEach(run.tasks) { t in
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 5) {
                        StatusDot(status: t.status)
                        Text("\(t.id) \(t.title)").font(.system(size: 11, weight: .medium)).foregroundStyle(Theme.text).lineLimit(1)
                    }
                    let a = t.effective
                    Text("\(store.agent(a.agent)?.label ?? "?") · \((a.model ?? "").isEmpty ? "cli default" : a.model!) · \(a.reasoning ?? "")\(t.difficulty.map { " · \($0)" } ?? "")\(t.override != nil ? " · override" : "")")
                        .font(.system(size: 10, design: .monospaced)).foregroundStyle(Theme.agent(a.agent))
                    if !t.changedFiles.isEmpty {
                        Text(t.changedFiles.joined(separator: "\n")).font(.system(size: 10, design: .monospaced)).foregroundStyle(Theme.dim)
                    }
                }
            }
        }
    }

    @ViewBuilder var report: some View {
        if let r = run.report {
            if let a = r.answer, !a.isEmpty { section("Answer") { body(a) } }
            section("Completed") { bullets(r.completed, empty: "nothing", color: Theme.green) }
            section("Needs attention") { bullets(r.attention, empty: "nothing", color: Theme.amber) }
            section("Checks") {
                if r.checks.isEmpty { body("No checks were configured or detected.").opacity(0.6) }
                ForEach(r.checks, id: \.self) { c in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 5) {
                            Image(systemName: c.ok ? "checkmark.circle.fill" : "xmark.circle.fill").foregroundStyle(c.ok ? Theme.green : Theme.red)
                            Text(c.command).font(Theme.mono).foregroundStyle(Theme.text)
                            Chip(text: c.where)
                        }
                        if !c.ok { Text(String(c.output.suffix(600))).font(.system(size: 10, design: .monospaced)).foregroundStyle(Theme.dim).textSelection(.enabled) }
                    }
                }
            }
            section("Reviewed by") { body(r.reviewedBy ?? "-") }
            section("Changed files (\(r.changedFiles.count))") {
                Text(r.changedFiles.joined(separator: "\n")).font(.system(size: 10.5, design: .monospaced)).foregroundStyle(Theme.dim).textSelection(.enabled)
            }
        } else if let e = run.error {
            section("Problem") { body(e) }
        } else {
            body("The report appears once every subtask is merged, checks have run and the review is in.").opacity(0.6)
        }
    }

    func section<C: View>(_ title: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title.uppercased()).font(.system(size: 9.5, weight: .semibold)).kerning(0.6).foregroundStyle(Theme.dim)
            content()
        }
    }
    func body(_ s: String) -> some View {
        Text(s).font(.system(size: 11.5)).foregroundStyle(Theme.text).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
    }
    @ViewBuilder func bullets(_ items: [String], empty: String, color: Color = Theme.dim) -> some View {
        if items.isEmpty { body(empty).opacity(0.6) }
        ForEach(items, id: \.self) { i in
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Circle().fill(color).frame(width: 4, height: 4).offset(y: -2)
                body(i)
            }
        }
    }
}

struct Composer: View {
    @EnvironmentObject var store: Store
    @State private var text = ""
    @State private var forceNew = false
    var followup: Bool { !forceNew && !store.showTeam && store.run != nil && !["cancelled", "failed", "planning"].contains(store.run!.status) }

    var body: some View {
        HStack(spacing: 8) {
            if store.run != nil && !store.showTeam {
                Picker("", selection: $forceNew) {
                    Text("Follow-up").tag(false)
                    Text("New task").tag(true)
                }.pickerStyle(.segmented).fixedSize().labelsHidden()
            }
            Text("❯").font(.system(size: 13, weight: .bold, design: .monospaced)).foregroundStyle(Theme.ring)
            TextField(followup ? "Tell the agents what to do next…" : (store.project.isEmpty ? "Ask anything or describe a task. No project needed…" : "Describe one high-level task for \((store.project as NSString).lastPathComponent)…"), text: $text, axis: .vertical)
                .textFieldStyle(.plain).font(.system(size: 13, design: .monospaced)).foregroundStyle(Theme.text).lineLimit(1...4)
                .onSubmit(send)
            Button(action: send) { Image(systemName: "arrow.up.circle.fill").font(.system(size: 20)) }
                .buttonStyle(.plain).foregroundStyle(text.trimmingCharacters(in: .whitespaces).isEmpty ? Theme.dim : Theme.ring)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(Theme.bg)
        .overlay(alignment: .top) { HLine() }
    }

    func send() {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        if followup { store.instruct(t) } else { store.newRun(t); forceNew = false }
        text = ""
    }
}
