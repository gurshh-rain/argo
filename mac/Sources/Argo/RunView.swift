import SwiftUI

struct Inspector: View {
    @EnvironmentObject var store: Store
    let run: Run
    var tab: String { store.rightTab }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 4) {
                RightTabs()
                Spacer()
                Button { store.filesHidden = true } label: { Image(systemName: "sidebar.right") }
                    .buttonStyle(.plain).font(.system(size: 12)).foregroundStyle(Theme.dim).help("Hide panel")
            }
            .padding(.horizontal, 8).frame(height: 30)
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

/// Files always; Record and Report when a run is showing.
struct RightTabs: View {
    @EnvironmentObject var store: Store
    var body: some View {
        ForEach(store.run == nil ? ["Files"] : ["Files", "Record", "Report"], id: \.self) { t in
            let on = store.rightTab == t || (store.run == nil && t == "Files")
            Button { store.rightTab = t } label: {
                Text(t).fixedSize()
                    .font(.system(size: 11.5, weight: .medium)).foregroundStyle(on ? Theme.text : Theme.dim)
                    .padding(.horizontal, 8).padding(.vertical, 3)
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
    @StateObject private var voice = VoiceInput()
    var followup: Bool { !forceNew && store.run != nil && !["cancelled", "failed", "planning"].contains(store.run!.status) }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                if store.run != nil {
                    Picker("", selection: $forceNew) {
                        Text("Follow-up").tag(false)
                        Text("New task").tag(true)
                    }.pickerStyle(.segmented).fixedSize().labelsHidden().disabled(voice.busy)
                }
                Text("❯").font(.system(size: 13, weight: .bold, design: .monospaced)).foregroundStyle(Theme.ring)
                TextField(followup ? "Tell the agents what to do next…" : (store.folder.isEmpty ? "Ask anything or describe a task. No project needed…" : "Describe one high-level task for \((store.folder as NSString).lastPathComponent)…"), text: $text, axis: .vertical)
                    .textFieldStyle(.plain).font(.system(size: 13, design: .monospaced)).foregroundStyle(Theme.text).lineLimit(1...4)
                    .onSubmit(send)
                Button {
                    voice.toggle(daemon: store.daemon, configured: store.state?.integrations.elevenlabs == true) { transcript in
                        text += (text.isEmpty || text.last?.isWhitespace == true ? "" : " ") + transcript
                    }
                } label: {
                    if voice.phase == .permission || voice.phase == .transcribing {
                        ProgressView().controlSize(.small).frame(width: 20, height: 20)
                    } else {
                        Image(systemName: voice.phase == .recording ? "stop.circle.fill" : "mic.fill").font(.system(size: 18))
                    }
                }
                .buttonStyle(.plain).foregroundStyle(voice.phase == .recording ? Color.red : Theme.ring)
                .disabled(voice.phase == .permission || voice.phase == .transcribing)
                .help(voice.phase == .recording ? "Stop recording and transcribe" : "Dictate with ElevenLabs")
                .accessibilityLabel(voice.phase == .recording ? "Stop voice recording" : "Start voice input")
                Button(action: send) { Image(systemName: "arrow.up.circle.fill").font(.system(size: 20)) }
                    .buttonStyle(.plain).foregroundStyle(text.trimmingCharacters(in: .whitespaces).isEmpty ? Theme.dim : Theme.ring)
                    .disabled(voice.busy || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            if voice.busy {
                HStack {
                    Text(voice.phase == .recording ? "Recording, up to two minutes. Click stop to transcribe." : voice.phase == .permission ? "Waiting for microphone permission…" : "Transcribing with ElevenLabs…")
                    Button("Cancel") { voice.cancel() }.buttonStyle(.plain)
                }.font(.caption).foregroundStyle(Theme.dim)
            }
            if let error = voice.error { Text(error).font(.caption).foregroundStyle(Theme.amber).textSelection(.enabled) }
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(Theme.bg)
        .overlay(alignment: .top) { HLine() }
        .onDisappear { voice.cancel() }
        .onChange(of: store.project) { _, _ in voice.cancel() }
        .onChange(of: store.selectedRun) { _, _ in voice.cancel() }
    }

    func send() {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !voice.busy, !t.isEmpty else { return }
        if followup { store.instruct(t) } else { store.newRun(t, terminals: hub.hasCLI(in: store.project)); forceNew = false }
        text = ""
    }
}
