import SwiftUI
import CoreImage.CIFilterBuiltins

enum Sheet: String, Identifiable { case settings, mobile; var id: String { rawValue } }

struct SettingsSheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) var dismiss
    @State private var s: Settings?
    @State private var checks = ""
    @AppStorage(Appearance.key) private var appearance = Appearance.dark.rawValue
    @StateObject private var updater = Updater()

    @ViewBuilder var updateStatus: some View {
        switch updater.status {
        case .idle: Text("Checks the latest release on GitHub.").foregroundStyle(.secondary)
        case .checking: Text("Checking…").foregroundStyle(.secondary)
        case .upToDate(let v): Text("You're up to date (\(v)).").foregroundStyle(.secondary)
        case .available(let v, _): Text("Version \(v) is available.").foregroundStyle(Theme.ring)
        case .failed(let m): Text(m).foregroundStyle(Theme.amber).textSelection(.enabled)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Settings").font(.title3.bold())
            if let binding = Binding($s) {
                Form {
                    Section("Appearance") {
                        Picker("Theme", selection: $appearance) {
                            ForEach(Appearance.allCases) { Text($0.label).tag($0.rawValue) }
                        }.pickerStyle(.segmented)
                    }
                    Section("Updates") {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Argo \(updater.installed)")
                                updateStatus.font(.caption)
                            }
                            Spacer()
                            if case .available(_, let url) = updater.status {
                                Button("Download") { NSWorkspace.shared.open(url) }.buttonStyle(ArgoButton(kind: .primary))
                            }
                            Button("Check for Updates") { updater.check() }.buttonStyle(ArgoButton())
                                .disabled(updater.status == .checking)
                        }
                    }
                    Section("Model controls") {
                    Picker("Default CLI", selection: binding.defaultAgent) {
                        Text("Auto — the orchestrator picks per subtask").tag("auto")
                        ForEach(store.installedAgents) { Text($0.label).tag($0.id) }
                    }
                    ForEach(store.installedAgents) { a in
                        Picker("\(a.label) model", selection: Binding(get: { binding.wrappedValue.models[a.id] ?? "__default" }, set: { binding.wrappedValue.models[a.id] = $0 == "__default" ? nil : $0 })) {
                            Text("Orchestrator default").tag("__default")
                            ForEach(a.models, id: \.self) { Text($0.id.isEmpty ? "cli default" : "\($0.id) — \($0.note)").tag($0.id) }
                        }
                    }
                    Picker("Reasoning level", selection: binding.reasoning) {
                        ForEach(["low", "medium", "high"], id: \.self) { Text($0).tag($0) }
                    }
                    Stepper("Parallel agents: \(binding.wrappedValue.maxParallel)", value: binding.maxParallel, in: 1...8)
                    Toggle("Run plans without waiting for my approval", isOn: binding.autoApprove)
                    TextField("Checks (one command per line; empty = detect)", text: $checks, axis: .vertical).lineLimit(2...4)
                    }
                }.formStyle(.grouped).scrollContentBackground(.hidden)
            }
            HStack {
                Text("Reasoning applies to Claude Code and Codex; Devin encodes it in the model name.").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Cancel") { dismiss() }.buttonStyle(ArgoButton(large: true))
                Button("Save") {
                    guard let s else { return }
                    var models: [String: String] = [:]
                    for a in store.installedAgents { if let m = s.models[a.id] { models[a.id] = m } }
                    store.saveSettings(["defaultAgent": s.defaultAgent, "models": models, "reasoning": s.reasoning, "maxParallel": s.maxParallel, "autoApprove": s.autoApprove,
                                        "checks": checks.split(separator: "\n").map(String.init)])
                    dismiss()
                }.buttonStyle(ArgoButton(kind: .primary, large: true))
            }
        }
        .padding(20).frame(width: 580, height: 680)
        .onAppear { s = store.state?.settings; checks = s?.checks.joined(separator: "\n") ?? "" }
    }
}

struct MobileSheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) var dismiss
    @State private var url = ""

    var body: some View {
        VStack(spacing: 14) {
            Text("Control from your phone").font(.title3.bold())
            Text("Open the Argo web app on your phone, sign in, and enter this one-time code. Until a phone account is paired it cannot see or control anything.")
                .font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
            if let img = qr(url), !url.isEmpty {
                Image(nsImage: img).interpolation(.none).resizable().frame(width: 170, height: 170).padding(8).background(.white, in: RoundedRectangle(cornerRadius: 8))
            }
            HStack {
                TextField("Public HTTPS address of the web app (from web/tunnel.sh)", text: $url).textFieldStyle(.roundedBorder)
                Button("Save") { store.saveSettings(["publicUrl": url]) }.buttonStyle(ArgoButton())
            }
            if let p = store.pair {
                Text(p.code).font(.system(size: 40, weight: .bold)).monospacedDigit().kerning(6).textSelection(.enabled)
                Text("Pairing code · single use · expires \(Date(timeIntervalSince1970: p.expires / 1000).formatted(date: .omitted, time: .shortened))").font(.caption).foregroundStyle(.secondary)
            }
            HStack {
                Button("New code") { store.loadPair() }.buttonStyle(ArgoButton(large: true))
                Spacer()
                Button("Done") { dismiss() }.buttonStyle(ArgoButton(kind: .primary, large: true)).keyboardShortcut(.defaultAction)
            }
        }
        .padding(22).frame(width: 440)
        .onAppear { url = store.state?.settings.publicUrl ?? ""; store.loadPair() }
    }

    func qr(_ s: String) -> NSImage? {
        let f = CIFilter.qrCodeGenerator()
        f.message = Data(s.utf8)
        guard let out = f.outputImage?.transformed(by: CGAffineTransform(scaleX: 8, y: 8)) else { return nil }
        let rep = NSCIImageRep(ciImage: out)
        let img = NSImage(size: rep.size)
        img.addRepresentation(rep)
        return img
    }
}
