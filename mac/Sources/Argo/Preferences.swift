import SwiftUI
import AppKit

/// Settings → Appearance. Stored per Mac in UserDefaults; applied app-wide through NSApp.appearance,
/// so SwiftUI views, Theme's adaptive colors and the terminals all follow it.
enum Appearance: String, CaseIterable, Identifiable {
    case system, light, dark
    var id: String { rawValue }
    var label: String { rawValue.capitalized }
    static let key = "appearance"
    static var current: Appearance { Appearance(rawValue: UserDefaults.standard.string(forKey: key) ?? "") ?? .dark }

    func apply() {
        switch self {
        case .system: NSApp.appearance = nil
        case .light: NSApp.appearance = NSAppearance(named: .aqua)
        case .dark: NSApp.appearance = NSAppearance(named: .darkAqua)
        }
    }
}

/// Settings → Updates: compares this build's version with the latest GitHub release.
@MainActor
final class Updater: ObservableObject {
    static let repository = "gurshh-rain/yc-hacky"

    enum Status: Equatable {
        case idle, checking, upToDate(String)
        case available(version: String, download: URL)
        case failed(String)
    }
    @Published var status: Status = .idle

    var installed: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0" }

    private struct Release: Decodable {
        let tag_name: String
        let html_url: String
        let draft: Bool
        let prerelease: Bool
        let assets: [Asset]
        struct Asset: Decodable { let name: String; let browser_download_url: String }
    }

    func check() {
        guard status != .checking else { return }
        status = .checking
        Task {
            do {
                var req = URLRequest(url: URL(string: "https://api.github.com/repos/\(Self.repository)/releases/latest")!)
                req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
                req.setValue("Argo/\(installed)", forHTTPHeaderField: "User-Agent")
                req.timeoutInterval = 15
                let (data, response) = try await URLSession.shared.data(for: req)
                let code = (response as? HTTPURLResponse)?.statusCode ?? 0
                if code == 404 { status = .failed("No published release found on GitHub (the repository may be private).") ; return }
                guard code == 200 else { status = .failed("GitHub answered \(code). Try again later."); return }
                let r = try JSONDecoder().decode(Release.self, from: data)
                let latest = r.tag_name.hasPrefix("v") ? String(r.tag_name.dropFirst()) : r.tag_name
                guard Self.isNewer(latest, than: installed) else { status = .upToDate(installed); return }
                // Prefer the DMG built for this Mac's architecture, then any DMG, then the release page.
                let arch = Self.arch
                let dmgs = r.assets.filter { $0.name.hasSuffix(".dmg") }
                let pick = dmgs.first { $0.name.contains(arch) } ?? dmgs.first
                status = .available(version: latest, download: URL(string: pick?.browser_download_url ?? r.html_url)!)
            } catch {
                status = .failed("Couldn't check for updates: \(error.localizedDescription)")
            }
        }
    }

    /// Numeric comparison of dotted versions: 0.1.10 is newer than 0.1.9.
    nonisolated static func isNewer(_ a: String, than b: String) -> Bool {
        let x = a.split(separator: ".").map { Int($0) ?? 0 }, y = b.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0..<max(x.count, y.count) {
            let l = i < x.count ? x[i] : 0, r = i < y.count ? y[i] : 0
            if l != r { return l > r }
        }
        return false
    }

    nonisolated static var arch: String {
        #if arch(arm64)
        return "arm64"
        #else
        return "x86_64"
        #endif
    }
}
