import SwiftUI
import UniformTypeIdentifiers

struct Inspector: View {
    @EnvironmentObject var store: Store
    let run: Run
    var tab: String { store.rightTab }

    var body: some View {
        VStack(spacing: 0) {
            RightHeader()
            HLine()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if tab == "Record" { record } else { report }
                }.padding(.horizontal, 12).padding(.vertical, 12).frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .background(Theme.pane)
    }

    @ViewBuilder var record: some View {
        section("Goal") { body(run.goal) }
        section("Constraints") { bullets(run.constraints, empty: "none stated") }
        section("Follow-ups") {
            if run.followups.isEmpty { muted("None") }
            ForEach(run.followups, id: \.self) { f in attributed(f.source.replacingOccurrences(of: "-", with: " ").capitalized, Theme.dim, f.text) }
        }
        section("Decisions") {
            if run.decisions.isEmpty { muted("None yet") }
            // one label per author, their notes as a list beneath it (headings in a notes file are not decisions)
            let authors = run.decisions.reduce(into: [String]()) { if !$0.contains($1.by) { $0.append($1.by) } }
            ForEach(authors, id: \.self) { by in
                let parts = by.components(separatedBy: "/")
                VStack(alignment: .leading, spacing: 5) {
                    Text(([store.agent(parts.first)?.label ?? parts.first?.capitalized ?? ""] + parts.dropFirst()).joined(separator: " · "))
                        .font(.system(size: 10.5, weight: .medium)).foregroundStyle(Theme.agent(parts.first))
                    bullets(run.decisions.filter { $0.by == by && !$0.text.hasPrefix("#") }.map(\.text), empty: "None")
                }
            }
        }
        section("Who did what") {
            ForEach(run.tasks) { t in
                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        StatusDot(status: t.status)
                        Text(t.title).font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.text).lineLimit(2)
                    }
                    let a = t.effective
                    Text("\(store.agent(a.agent)?.label ?? "?") · \((a.model ?? "").isEmpty ? "default model" : a.model!)\(t.difficulty.map { " · \($0)" } ?? "")\(t.override != nil ? " · your choice" : "")")
                        .font(.system(size: 11)).foregroundStyle(Theme.agent(a.agent)).padding(.leading, 13)
                    if !t.changedFiles.isEmpty { fileList(t.changedFiles).padding(.leading, 13) }
                }
            }
        }
    }

    @ViewBuilder var report: some View {
        if let r = run.report {
            if let a = r.answer, !a.isEmpty { section("Answer") { body(a) } }
            section("Completed") { bullets(r.completed, empty: "Nothing", color: Theme.green) }
            section("Needs attention") { bullets(r.attention, empty: "Nothing", color: Theme.amber) }
            section("Checks") {
                if r.checks.isEmpty { muted("No checks were configured or detected.") }
                ForEach(r.checks, id: \.self) { c in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 5) {
                            Image(systemName: c.ok ? "checkmark.circle.fill" : "xmark.circle.fill").foregroundStyle(c.ok ? Theme.green : Theme.red)
                            Text(c.command).font(.system(size: 12)).foregroundStyle(Theme.text)
                            Chip(text: c.where)
                        }
                        if !c.ok { Text(String(c.output.suffix(600))).font(.system(size: 10, design: .monospaced)).foregroundStyle(Theme.dim).textSelection(.enabled) }
                    }
                }
            }
            section("Reviewed by") { body(r.reviewedBy ?? "-") }
            if !r.changedFiles.isEmpty { section("Changed files (\(r.changedFiles.count))") { fileList(r.changedFiles) } }
        } else if let e = run.error {
            section("Problem") { body(e) }
        } else {
            muted("The report appears once every subtask has finished and the review is in.")
        }
    }

    func section<C: View>(_ title: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.dim)
            content()
        }
    }
    func body(_ s: String) -> some View { Prose(text: s) }
    func muted(_ s: String) -> some View { Text(s).font(.system(size: 12)).foregroundStyle(Theme.dim) }
    /// A short label (who said it) above the text it belongs to.
    func attributed(_ label: String, _ color: Color, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.system(size: 10.5, weight: .medium)).foregroundStyle(color)
            Prose(text: text)
        }
    }
    /// File paths, one per line, with the folder dimmed so the file name stands out.
    func fileList(_ files: [String]) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            ForEach(files, id: \.self) { f in
                let name = (f as NSString).lastPathComponent
                let dir = String(f.dropLast(name.count))
                (Text(dir).foregroundColor(Theme.dim) + Text(name).foregroundColor(Theme.text))
                    .font(.system(size: 11.5)).lineLimit(1).truncationMode(.head).textSelection(.enabled)
            }
        }
    }
    @ViewBuilder func bullets(_ items: [String], empty: String, color: Color = Theme.dim) -> some View {
        if items.isEmpty { muted(empty) }
        ForEach(items, id: \.self) { i in
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Circle().fill(color).frame(width: 5, height: 5).offset(y: -1.5)
                Prose(text: i)
            }
        }
    }
}

/// The top row of the right-hand panel, the same in every tab: the tabs on the left, hide on the right.
/// Nothing else lives here, so the row always fits the panel however many tabs a run adds.
struct RightHeader: View {
    @EnvironmentObject var store: Store
    var body: some View {
        HStack(spacing: 2) {
            RightTabs()
            Spacer(minLength: 0)
            Button { store.filesHidden = true } label: { Image(systemName: "sidebar.right") }
                .buttonStyle(IconButton()).font(.system(size: 12)).foregroundStyle(Theme.dim).help("Hide panel")
        }
        .padding(.horizontal, 8).frame(maxWidth: .infinity, alignment: .leading).frame(height: 30).clipped()
    }
}

/// Files and Usage always; Record and Report when a run is showing.
struct RightTabs: View {
    @EnvironmentObject var store: Store
    var body: some View {
        ForEach(store.run == nil ? ["Files", "Usage"] : ["Files", "Record", "Report", "Usage"], id: \.self) { t in
            let on = store.rightTab == t || (store.run == nil && t == "Files" && store.rightTab != "Usage")
            Button { store.rightTab = t } label: {
                Text(t).fixedSize()
                    .font(.system(size: 11.5, weight: .medium)).foregroundStyle(on ? Theme.text : Theme.dim)
                    .padding(.horizontal, 7).padding(.vertical, 3)
                    .background(on ? Theme.chip : .clear, in: RoundedRectangle(cornerRadius: 5))
            }.buttonStyle(.plain)
        }
    }
}

struct Composer: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var hub: TeamHub
    @State private var text = ""
    @State private var forceNew = false
    /// Files picked with the paperclip or dropped on the composer; sent along with the next message.
    @State private var attachments: [URL] = []
    @State private var dropping = false
    var followup: Bool { !forceNew && store.run != nil && !["cancelled", "failed", "planning"].contains(store.run!.status) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // The plan is approved here, next to where it was asked for.
            if let run = store.run, run.status == "awaiting_approval" {
                HStack(spacing: 10) {
                    Image(systemName: "checklist").foregroundStyle(Theme.ring)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Plan ready: \(run.tasks.count) subtask\(run.tasks.count == 1 ? "" : "s")").font(.system(size: 12.5, weight: .semibold)).foregroundStyle(Theme.text)
                        Text("Each subtask and its agent is listed above. Click one to open it and change its agent.").font(.system(size: 11.5)).foregroundStyle(Theme.dim)
                    }
                    Spacer()
                    Button("Cancel") { store.runAction("cancel") }.buttonStyle(ArgoButton(large: true))
                    Button { store.runAction("approve") } label: { Label("Approve & run", systemImage: "play.fill") }
                        .buttonStyle(ArgoButton(kind: .primary, large: true)).keyboardShortcut(.return, modifiers: .command).help("⌘↩")
                }
                .padding(10).background(Theme.rowSelected, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            }
            if !attachments.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(attachments, id: \.self) { url in
                            HStack(spacing: 5) {
                                Image(systemName: url.hasDirectoryPath ? "folder" : "doc").font(.system(size: 10.5))
                                Text(url.lastPathComponent).font(.system(size: 11.5)).lineLimit(1).truncationMode(.middle).frame(maxWidth: 180)
                                Button { attachments.removeAll { $0 == url } } label: { Image(systemName: "xmark").font(.system(size: 8.5, weight: .bold)) }
                                    .buttonStyle(.plain).help("Remove")
                            }
                            .foregroundStyle(Theme.text).padding(.horizontal, 8).padding(.vertical, 4)
                            .background(Theme.chip, in: RoundedRectangle(cornerRadius: 6))
                            .help(url.path)
                        }
                    }
                }
            }
            HStack(spacing: 8) {
                if store.run != nil {
                    Segmented(selection: $forceNew, options: [
                        .init(value: false, label: "Follow-up", icon: "arrowshape.turn.up.right"),
                        .init(value: true, label: "New task", icon: "plus"),
                    ])
                    .fixedSize()
                    .help(forceNew ? "Starts a separate run" : "Adds to the run that is showing")
                }
                Text("❯").font(.system(size: 13, weight: .bold)).foregroundStyle(Theme.ring)
                TextField(followup ? "Tell the agents what to do next…" : (store.folder.isEmpty ? "Ask anything or describe a task. No project needed…" : "Describe one high-level task for \((store.folder as NSString).lastPathComponent)…"), text: $text, axis: .vertical)
                    .textFieldStyle(.plain).font(.system(size: 13)).foregroundStyle(Theme.text).lineLimit(1...4)
                    .onSubmit(send)
                Button(action: pickFiles) {
                    Image(systemName: "paperclip").font(.system(size: 13, weight: .medium)).frame(width: 26, height: 26)
                }
                    .buttonStyle(IconButton()).foregroundStyle(attachments.isEmpty ? Theme.dim : Theme.ring)
                    .help("Attach files (or drop them here)")
                Button(action: send) {
                    Image(systemName: "arrow.up").font(.system(size: 12, weight: .bold)).foregroundStyle(.white)
                        .frame(width: 26, height: 26)
                        .background(empty ? Theme.chip : Theme.ring, in: Circle())
                }
                    .buttonStyle(.plain).help("Send (↩)")
                    .disabled(empty)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(Theme.bg)
        .overlay(alignment: .top) { HLine() }
        .overlay { if dropping { RoundedRectangle(cornerRadius: 8).stroke(Theme.ring, lineWidth: 2).padding(3) } }
        .onDrop(of: [.fileURL], isTargeted: $dropping) { providers in
            for p in providers {
                _ = p.loadObject(ofClass: URL.self) { url, _ in
                    guard let url, url.isFileURL else { return }
                    DispatchQueue.main.async { if !attachments.contains(url) { attachments.append(url) } }
                }
            }
            return true
        }
    }

    var empty: Bool { text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && attachments.isEmpty }

    func pickFiles() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = true
        panel.canChooseFiles = true
        panel.prompt = "Attach"
        guard panel.runModal() == .OK else { return }
        for url in panel.urls where !attachments.contains(url) { attachments.append(url) }
    }

    /// Copies the attachments into ~/.argo/attachments/<batch>/ (which every agent may read, and which survives
    /// the originals being moved) and returns the lines that tell the agents where they are.
    func attach() -> String {
        guard !attachments.isEmpty else { return "" }
        let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "")
        let batch = Daemon.home.appendingPathComponent("attachments").appendingPathComponent("\(stamp)-\(UUID().uuidString.prefix(6))")
        try? FileManager.default.createDirectory(at: batch, withIntermediateDirectories: true)
        var lines: [String] = []
        for url in attachments {
            let dest = batch.appendingPathComponent(url.lastPathComponent)
            do { try FileManager.default.copyItem(at: url, to: dest); lines.append("- \(dest.path)") }
            catch { lines.append("- \(url.path) (could not be copied: \(error.localizedDescription))") }
        }
        attachments = []
        return "\n\nAttached files (read them as part of this task):\n" + lines.joined(separator: "\n")
    }

    func send() {
        var t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !empty else { return }
        if t.isEmpty { t = "Look at the attached files." }
        t += attach()
        if followup { store.instruct(t) } else { store.newRun(t, terminals: hub.hasCLI(in: store.project)); forceNew = false }
        text = ""
    }
}
