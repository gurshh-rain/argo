import SwiftUI
import AppKit
import CryptoKit

/// In-app updates. Each GitHub release carries the disk image and a `latest.json` manifest; the manifest
/// holds an Ed25519 signature over the image, made with a private key that never leaves the release
/// machine. The public half is compiled in below, so an image that was not signed by us is refused
/// before anything is installed. (The approach follows github.com/matthewhamilton3141/isle.)
enum UpdaterConfig {
    /// GitHub resolves releases/latest/download/<name> to that file in the newest release.
    static let releaseManifest = URL(string: "https://github.com/gurshh-rain/argo/releases/latest/download/latest.json")!
    /// ARGO_UPDATE_MANIFEST points a test build at another manifest. Whatever it names must still carry a
    /// valid signature from the release key, so this cannot be used to install something unsigned.
    static var manifestURL: URL { ProcessInfo.processInfo.environment["ARGO_UPDATE_MANIFEST"].flatMap(URL.init(string:)) ?? releaseManifest }
    /// Public half of the release signing key (mac/argo-sign.swift keygen).
    static let publicKeyBase64 = "yX667KtbwoXFB9RJbCy5zMvNJlRnsU7+sMJNQ8fs3vg="
}

struct UpdateManifest: Decodable {
    let version: String
    let notes: String?
    /// Direct download URL of the signed disk image.
    let url: URL
    /// Base64 Ed25519 signature over the image's bytes.
    let signature: String
}

struct UpdateError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

@MainActor
final class Updater: ObservableObject {
    static let shared = Updater()

    enum Phase: Equatable {
        case idle, checking, upToDate
        case available(version: String, notes: String?)
        case downloading(pct: Int)
        case installing
        case failed(String)
    }
    @Published private(set) var phase: Phase = .idle
    private var pending: UpdateManifest?

    var installed: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0" }
    var busy: Bool {
        switch phase {
        case .checking, .downloading, .installing: return true
        default: return false
        }
    }
    var availableVersion: String? {
        if case .available(let v, _) = phase { return v }
        return nil
    }

    /// `silent` is the check at launch: no error is shown if GitHub cannot be reached.
    func check(silent: Bool = false) async {
        guard !busy else { return }
        phase = .checking
        pending = nil
        do {
            var req = URLRequest(url: UpdaterConfig.manifestURL)
            req.cachePolicy = .reloadIgnoringLocalCacheData
            req.timeoutInterval = 15
            let (data, response) = try await URLSession.shared.data(for: req)
            let code = (response as? HTTPURLResponse)?.statusCode ?? 200
            guard code == 200 else { throw UpdateError(code == 404 ? "The latest release has no update manifest yet." : "GitHub answered \(code). Try again later.") }
            let manifest = try JSONDecoder().decode(UpdateManifest.self, from: data)
            if Self.isNewer(manifest.version, than: installed) {
                pending = manifest
                phase = .available(version: manifest.version, notes: manifest.notes)
                // ARGO_UPDATE_AUTOINSTALL installs without a click (for the end-to-end update test)
                if ProcessInfo.processInfo.environment["ARGO_UPDATE_AUTOINSTALL"] != nil { start() }
            } else {
                phase = .upToDate
            }
        } catch {
            phase = silent ? .idle : .failed("Couldn't check for updates: \(error.localizedDescription)")
        }
    }

    /// Asks first when agents are working, because installing quits the app and closes its terminals.
    func install(store: Store) {
        let active = store.state?.runs.filter(\.isActive).count ?? 0
        guard active > 0 else { return start() }
        store.confirm = Store.Confirm(
            title: "Install the update now?",
            message: "\(active) run\(active == 1 ? " is" : "s are") in progress. Installing quits Argo, which closes its terminals and interrupts work handed to them.",
            button: "Install and relaunch"
        ) { self.start() }
    }

    private func start() {
        guard let manifest = pending, !busy else { return }
        Task {
            do {
                phase = .downloading(pct: 0)
                let dmg = try await Downloader { [weak self] fraction in
                    Task { @MainActor in
                        guard let self, case .downloading = self.phase else { return }
                        self.phase = .downloading(pct: Int((fraction * 100).rounded()))
                    }
                }.download(manifest.url)
                try Self.verify(dmg, signature: manifest.signature)
                phase = .installing
                let app = try await Task.detached { try Installer.unpack(dmg) }.value
                try Installer.replaceAndRelaunch(with: app)
            } catch {
                phase = .failed("The update could not be installed: \(error.localizedDescription)")
            }
        }
    }

    nonisolated static func verify(_ file: URL, signature: String, publicKey: String = UpdaterConfig.publicKeyBase64) throws {
        guard let keyData = Data(base64Encoded: publicKey), let sig = Data(base64Encoded: signature),
              let key = try? Curve25519.Signing.PublicKey(rawRepresentation: keyData) else {
            throw UpdateError("Update signing isn't configured for this build.")
        }
        guard key.isValidSignature(sig, for: try Data(contentsOf: file)) else {
            throw UpdateError("The download's signature did not match, so it was not installed.")
        }
    }

    /// Numeric comparison of dotted versions: 0.1.10 is newer than 0.1.9.
    nonisolated static func isNewer(_ a: String, than b: String) -> Bool {
        let parse = { (s: String) in s.trimmingCharacters(in: CharacterSet(charactersIn: "vV ")).split(separator: ".").map { Int($0) ?? 0 } }
        let x = parse(a), y = parse(b)
        for i in 0..<max(x.count, y.count) {
            let l = i < x.count ? x[i] : 0, r = i < y.count ? y[i] : 0
            if l != r { return l > r }
        }
        return false
    }
}

private final class Downloader: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    private let progress: (Double) -> Void
    private var continuation: CheckedContinuation<URL, Error>?
    init(progress: @escaping (Double) -> Void) { self.progress = progress }

    func download(_ url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { c in
            continuation = c
            let session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
            session.downloadTask(with: url).resume()
            session.finishTasksAndInvalidate()
        }
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        if totalBytesExpectedToWrite > 0 { progress(Double(totalBytesWritten) / Double(totalBytesExpectedToWrite)) }
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        let code = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 200
        let dest = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".dmg")
        do {
            guard code == 200 else { throw UpdateError("The download failed (HTTP \(code)).") }
            try FileManager.default.moveItem(at: location, to: dest)
            continuation?.resume(returning: dest)
        } catch { continuation?.resume(throwing: error) }
        continuation = nil
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error { continuation?.resume(throwing: error); continuation = nil }
    }
}

enum Installer {
    @discardableResult static func run(_ tool: String, _ args: [String]) throws -> Int32 {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: tool)
        p.arguments = args
        try p.run()
        p.waitUntilExit()
        return p.terminationStatus
    }

    /// Mounts the image, copies the app out to a staging folder, and unmounts.
    static func unpack(_ dmg: URL) throws -> URL {
        let tmp = FileManager.default.temporaryDirectory
        let mount = tmp.appendingPathComponent("argo-dmg-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: mount, withIntermediateDirectories: true)
        guard try run("/usr/bin/hdiutil", ["attach", dmg.path, "-nobrowse", "-readonly", "-mountpoint", mount.path, "-quiet"]) == 0 else {
            throw UpdateError("Could not open the downloaded disk image.")
        }
        defer { _ = try? run("/usr/bin/hdiutil", ["detach", mount.path, "-quiet"]) }
        guard let app = try FileManager.default.contentsOfDirectory(at: mount, includingPropertiesForKeys: nil).first(where: { $0.pathExtension == "app" }) else {
            throw UpdateError("The download didn't contain the app.")
        }
        let staged = tmp.appendingPathComponent("argo-update-" + UUID().uuidString, isDirectory: true).appendingPathComponent(app.lastPathComponent)
        try FileManager.default.createDirectory(at: staged.deletingLastPathComponent(), withIntermediateDirectories: true)
        guard try run("/usr/bin/ditto", [app.path, staged.path]) == 0 else { throw UpdateError("Could not copy the update.") }
        return staged
    }

    /// A small helper waits for this process to exit, swaps the app in place, and opens the new one.
    /// The old copy is only removed once the new one is in position, so a failed copy leaves Argo installed.
    @MainActor static func replaceAndRelaunch(with newApp: URL) throws {
        let dest = Bundle.main.bundleURL
        guard dest.pathExtension == "app" else { throw UpdateError("This copy of Argo is not running from an app bundle.") }
        guard FileManager.default.isWritableFile(atPath: dest.deletingLastPathComponent().path) else {
            throw UpdateError("Argo can't write to \(dest.deletingLastPathComponent().path). Move Argo to Applications and try again.")
        }
        let pid = ProcessInfo.processInfo.processIdentifier
        let old = dest.path + ".old-\(pid)"
        let script = """
        #!/bin/sh
        while /bin/kill -0 \(pid) 2>/dev/null; do /bin/sleep 0.2; done
        /bin/mv "\(dest.path)" "\(old)" || exit 1
        if /usr/bin/ditto "\(newApp.path)" "\(dest.path)"; then
          /bin/rm -rf "\(old)"
          /usr/bin/xattr -dr com.apple.quarantine "\(dest.path)" 2>/dev/null
        else
          /bin/rm -rf "\(dest.path)"
          /bin/mv "\(old)" "\(dest.path)"
        fi
        /usr/bin/open "\(dest.path)"
        """
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("argo-relaunch-\(pid).sh")
        try script.write(to: file, atomically: true, encoding: .utf8)
        let helper = Process()
        helper.executableURL = URL(fileURLWithPath: "/bin/sh")
        helper.arguments = [file.path]
        try helper.run() // not waited for: it waits on us
        // An open sheet (Settings, where "Install update" lives) makes macOS refuse a normal quit, which
        // left the helper waiting forever. Close sheets first, and if the app is still alive a moment
        // later, exit outright: everything worth saving is already on disk.
        for w in NSApp.windows { if let sheet = w.attachedSheet { w.endSheet(sheet) } }
        NSApp.terminate(nil)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { exit(0) }
    }
}

/// Shown at the bottom of the sidebar when a newer version exists: one click downloads and installs it.
struct UpdatePill: View {
    @EnvironmentObject var store: Store
    @ObservedObject var updater = Updater.shared
    var body: some View {
        switch updater.phase {
        case .available(let v, _):
            Button { updater.install(store: store) } label: { Label("Update to \(v)", systemImage: "arrow.down.circle.fill").frame(maxWidth: .infinity) }
                .buttonStyle(ArgoButton(kind: .primary)).help("Downloads and installs the new version here, then reopens Argo")
        case .downloading(let pct):
            HStack(spacing: 8) {
                ProgressView(value: Double(pct), total: 100)
                Text("\(pct)%").font(.system(size: 10.5)).foregroundStyle(Theme.dim).monospacedDigit()
            }
        case .installing:
            Text("Installing update…").font(.system(size: 11)).foregroundStyle(Theme.dim)
        case .failed(let m):
            Text(m).font(.system(size: 10.5)).foregroundStyle(Theme.amber).lineLimit(3).help(m)
        default:
            EmptyView()
        }
    }
}
