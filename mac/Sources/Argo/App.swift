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
        let delay = Double(ProcessInfo.processInfo.environment["ARGO_SNAPSHOT_DELAY"] ?? "") ?? 5
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            if let v = NSApp.windows.first(where: { $0.contentView != nil && $0.frame.width > 600 })?.contentView,
               let rep = v.bitmapImageRepForCachingDisplay(in: v.bounds) {
                v.cacheDisplay(in: v.bounds, to: rep)
                try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: args[i + 1]))
            }
            if let dump = AppDelegate.dump { try? dump().write(toFile: args[i + 1] + ".txt", atomically: true, encoding: .utf8) }
            NSApp.terminate(nil)
        }
    }
    static var dump: (() -> String)?
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}

@main
struct ArgoApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @StateObject private var store = Store()
    @StateObject private var hub = TeamHub()
    @StateObject private var sizes = SplitSizes()
    @AppStorage(Appearance.key) private var appearance = Appearance.dark.rawValue

    var body: some Scene {
        WindowGroup("Argo", id: "main") {
            RootView().environmentObject(store).environmentObject(hub).environmentObject(sizes)
                .task {
                    // hand waiting subtasks to the user's terminals
                    while !Task.isCancelled {
                        await hub.dispatch(store: store)
                        try? await Task.sleep(nanoseconds: 1_500_000_000)
                    }
                }
                .frame(minWidth: 1100, minHeight: 680)
                .tint(Theme.ring)
                .onChange(of: appearance, initial: true) { _, v in
                    (Appearance(rawValue: v) ?? .dark).apply()
                    hub.restyleTerminals()
                }
                .onAppear {
                    store.start()
                    // look for a newer release at launch, then every six hours while open
                    Task {
                        while !Task.isCancelled {
                            await Updater.shared.check(silent: true)
                            try? await Task.sleep(nanoseconds: 6 * 3600 * 1_000_000_000)
                        }
                    }
                    hub.watchAppearance()
                    AppDelegate.dump = { [hub] in hub.dumpText() }
                    // `ARGO_TAB=Report` opens that right-hand tab shortly after launch (for headless UI checks).
                    if let tab = ProcessInfo.processInfo.environment["ARGO_TAB"] {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { store.rightTab = tab }
                    }
                    // `ARGO_DEMO_TEAM=1` opens a few terminals at launch (for headless UI checks).
                    if ProcessInfo.processInfo.environment["ARGO_DEMO_TEAM"] != nil {
                        for k in ["claude", "devin", "shell"] { hub.add(kind: k, project: store.project, horizontal: k != "shell") }
                    }
                }
        }
        .commands { ArgoCommands(store: store, hub: hub) }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1440, height: 900)

        // the Argo icon in the menu bar; terminals keep running when the window is closed
        MenuBarExtra {
            MenuBarContent().environmentObject(store).environmentObject(hub)
        } label: {
            if MenuBarContent.needsCount(store, hub) > 0 {
                Image(systemName: "bell.badge.fill")
            } else if let logo = MenuBarContent.logo {
                Image(nsImage: logo)
            } else {
                Image(systemName: "sparkle")
            }
        }
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
                } else {
                    WorkspaceView()
                }
                Composer()
            }
            .background(Theme.bg)
            if !store.filesHidden && store.startupError == nil {
                VLine()
                Group {
                    if let run = store.run, store.rightTab != "Files" { Inspector(run: run) } else { FilesPanel() }
                }.frame(width: 300)
            }
        }
        .overlay(alignment: .topLeading) {
            if store.sidebarHidden { SidebarToolbar().frame(width: 30, alignment: .leading).clipped().padding(.leading, 78) }
        }
        .ignoresSafeArea()
        // `ARGO_SHEET=settings` opens that sheet at launch (for headless checks of what a sheet blocks)
        .onAppear { if let name = ProcessInfo.processInfo.environment["ARGO_SHEET"] { sheet = Sheet(rawValue: name) } }
        .sheet(item: $sheet) { s in
            Group { if s == .settings { SettingsSheet() } else { MobileSheet() } }.environmentObject(store)
        }
        .alert(store.confirm?.title ?? "", isPresented: Binding(get: { store.confirm != nil }, set: { if !$0 { store.confirm = nil } }), presenting: store.confirm) { c in
            Button(c.button, role: .destructive) { c.action() }
            Button("Cancel", role: .cancel) {}
        } message: { c in Text(c.message) }
        .alert("Rename workspace", isPresented: Binding(get: { store.renaming != nil }, set: { if !$0 { store.renaming = nil } })) {
            RenameField()
        }
        .alert("Workspace description", isPresented: Binding(get: { store.describing != nil }, set: { if !$0 { store.describing = nil } })) {
            DescribeField()
        } message: { Text("A short note shown on the workspace's tab.") }
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

/// Text field and buttons for the rename alert.
struct RenameField: View {
    @EnvironmentObject var store: Store
    @State private var name = ""
    var body: some View {
        TextField("Name", text: $name).onAppear { name = store.renaming.map(store.name(of:)) ?? "" }
        Button("Rename") { if let ws = store.renaming { store.rename(ws, to: name) } }
        Button("Cancel", role: .cancel) {}
    }
}

/// Text field and buttons for the description alert.
struct DescribeField: View {
    @EnvironmentObject var store: Store
    @State private var text = ""
    var body: some View {
        TextField("What this workspace is for", text: $text).onAppear { text = store.describing.flatMap { store.descriptions[$0] } ?? "" }
        Button("Save") { if let ws = store.describing { store.describe(ws, text) } }
        Button("Cancel", role: .cancel) {}
    }
}
