import SwiftUI
import AppKit
import UserNotifications

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        Self.snapshotIfAsked()
        if Bundle.main.bundleIdentifier != nil {
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
        }
    }
    /// `Argo --snapshot out.png` renders the window to a file and quits (used to check the UI headlessly).
    static func snapshotIfAsked() {
        let args = CommandLine.arguments
        guard let i = args.firstIndex(of: "--snapshot"), args.count > i + 1 else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
            if let v = NSApp.windows.first(where: { $0.contentView != nil && $0.frame.width > 600 })?.contentView,
               let rep = v.bitmapImageRepForCachingDisplay(in: v.bounds) {
                v.cacheDisplay(in: v.bounds, to: rep)
                try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: args[i + 1]))
            }
            NSApp.terminate(nil)
        }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

@main
struct ArgoApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @StateObject private var store = Store()
    @StateObject private var hub = TeamHub()

    var body: some Scene {
        WindowGroup("Argo") {
            RootView().environmentObject(store).environmentObject(hub)
                .frame(minWidth: 1100, minHeight: 680)
                .preferredColorScheme(.dark).tint(Theme.ring)
                .onAppear {
                    store.start()
                    // `ARGO_DEMO_TEAM=1` opens a few terminals at launch (for headless UI checks).
                    if ProcessInfo.processInfo.environment["ARGO_DEMO_TEAM"] != nil {
                        for k in ["claude", "devin", "shell"] { hub.add(kind: k, project: store.project, horizontal: k != "shell") }
                        store.showTeam = true
                    } else if hub.members.isEmpty {
                        // one terminal is always there to start from; split it to add agents
                        hub.add(kind: "shell", project: store.project)
                    }
                }
        }
        .commands {
            CommandMenu("Team") {
                ForEach(Array(TeamHub.kinds.enumerated()), id: \.offset) { i, k in
                    Button("New \(k.label) terminal") { hub.add(kind: k.id, project: store.project); store.showTeam = true }
                        .keyboardShortcut(KeyEquivalent(Character("\(i + 1)")), modifiers: [.command, .shift])
                }
            }
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1440, height: 900)
    }
}

struct RootView: View {
    @EnvironmentObject var store: Store
    @State private var sheet: Sheet?

    var body: some View {
        HStack(spacing: 0) {
            if !store.sidebarHidden {
                Sidebar(sheet: $sheet)
                VLine()
            }
            VStack(spacing: 0) {
                if let e = store.startupError {
                    message("Orchestrator unavailable", e)
                } else if store.showTeam {
                    TeamView()
                } else if let run = store.run {
                    RunView(run: run)
                } else {
                    message("Give your agents one task", "Argo plans it, splits it across \(store.installedAgents.map(\.label).joined(separator: ", ")), runs independent parts in parallel in isolated worktrees, then merges, checks and reports.")
                }
                Composer()
            }
            .background(Theme.bg)
            if store.showTeam && !store.filesHidden && store.startupError == nil {
                VLine()
                FilesPanel().frame(width: 300)
            }
        }
        .overlay(alignment: .topLeading) {
            if store.sidebarHidden { SidebarToolbar().frame(width: 30, alignment: .leading).clipped().padding(.leading, 78) }
        }
        .ignoresSafeArea()
        .sheet(item: $sheet) { s in
            Group { if s == .settings { SettingsSheet() } else { MobileSheet() } }.environmentObject(store)
        }
        .alert("Argo", isPresented: Binding(get: { store.banner != nil }, set: { if !$0 { store.banner = nil } })) {
            Button("OK") { store.banner = nil }
        } message: { Text(store.banner ?? "") }
    }

    func message(_ title: String, _ detail: String) -> some View {
        VStack(spacing: 8) {
            Text(title).font(.system(size: 18, weight: .semibold)).foregroundStyle(Theme.text)
            Text(detail).font(.system(size: 12.5)).foregroundStyle(Theme.dim).multilineTextAlignment(.center).frame(maxWidth: 520)
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
