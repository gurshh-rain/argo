import Foundation
import CryptoKit

/// Finds or starts the local orchestrator and talks to it over loopback HTTP.
final class Daemon {
    static let home = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".argo")
    private var process: Process?
    private(set) var token = ""
    private(set) var port = 4317

    struct Config: Codable { let token: String; let port: Int }

    func readConfig() -> Bool {
        guard let data = try? Data(contentsOf: Self.home.appendingPathComponent("config.json")),
              let cfg = try? JSONDecoder().decode(Config.self, from: data) else { return false }
        token = cfg.token
        port = cfg.port
        return true
    }

    var orchestratorDir: URL? {
        let candidates = [
            ProcessInfo.processInfo.environment["ARGO_ORCHESTRATOR"].map { URL(fileURLWithPath: $0) },
            Bundle.main.resourceURL?.appendingPathComponent("orchestrator"),
            UserDefaults.standard.string(forKey: "orchestratorDir").map { URL(fileURLWithPath: $0) },
        ]
        return candidates.compactMap { $0 }.first { FileManager.default.fileExists(atPath: $0.appendingPathComponent("src/main.ts").path) }
    }

    func healthy() async -> Bool { await health() != nil }

    /// The running orchestrator's build id ("" from builds that predate it), or nil when none is reachable.
    func health() async -> String? {
        guard let url = URL(string: "http://127.0.0.1:\(port)/health") else { return nil }
        var req = URLRequest(url: url)
        req.timeoutInterval = 1
        guard let (data, res) = try? await URLSession.shared.data(for: req), (res as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        let text = String(decoding: data, as: UTF8.self)
        return text.hasPrefix("ok ") ? String(text.dropFirst(3)) : ""
    }

    /// Hash of the bundled orchestrator code, computed exactly as the orchestrator computes its own.
    var bundledBuild: String? {
        guard let src = orchestratorDir?.appendingPathComponent("src"),
              let files = try? FileManager.default.contentsOfDirectory(atPath: src.path) else { return nil }
        var h = SHA256()
        for f in files.filter({ $0.hasSuffix(".ts") }).sorted() {
            guard let d = FileManager.default.contents(atPath: src.appendingPathComponent(f).path) else { return nil }
            h.update(data: d)
        }
        return String(h.finalize().map { String(format: "%02x", $0) }.joined().prefix(12))
    }

    /// Stops an orchestrator left running from an older build, so this app starts its own code.
    private func replaceStale() async {
        if let _: Ignored = try? await request("POST", "quit") {} else {
            // builds before /api/quit: stop whatever Argo orchestrator holds the port
            let lsof = Process()
            lsof.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
            lsof.arguments = ["-ti", "tcp:\(port)", "-sTCP:LISTEN"]
            let pipe = Pipe()
            lsof.standardOutput = pipe
            try? lsof.run()
            lsof.waitUntilExit()
            for pid in String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self).split(separator: "\n").compactMap({ Int32($0) }) {
                let ps = Process()
                ps.executableURL = URL(fileURLWithPath: "/bin/ps")
                ps.arguments = ["-o", "command=", "-p", "\(pid)"]
                let out = Pipe()
                ps.standardOutput = out
                try? ps.run()
                ps.waitUntilExit()
                if String(decoding: out.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self).contains("src/main.ts") { kill(pid, SIGTERM) }
            }
        }
        for _ in 0..<20 where await healthy() { try? await Task.sleep(nanoseconds: 250_000_000) }
    }

    /// Returns nil when the orchestrator is reachable, otherwise a message for the user.
    func ensureRunning() async -> String? {
        _ = readConfig()
        if let running = await health() {
            guard let mine = bundledBuild, running != mine else { return nil }
            await replaceStale()
        }
        guard let dir = orchestratorDir else { return "Orchestrator files not found. Rebuild the app with mac/build.sh." }
        let p = Process()
        // A login + interactive shell, so node and the coding CLIs resolve exactly as they do in the user's
        // terminal. Launched from Finder the app has a bare PATH, and ~/.local/bin is usually added in .zshrc.
        p.executableURL = URL(fileURLWithPath: "/bin/zsh")
        p.arguments = ["-l", "-i", "-c", "exec node src/main.ts"]
        p.standardInput = FileHandle.nullDevice
        p.currentDirectoryURL = dir
        let log = Self.home.appendingPathComponent("orchestrator.log")
        try? FileManager.default.createDirectory(at: Self.home, withIntermediateDirectories: true)
        // append, so the reason for an earlier exit is still there to read
        if !FileManager.default.fileExists(atPath: log.path) { FileManager.default.createFile(atPath: log.path, contents: nil) }
        if let h = try? FileHandle(forWritingTo: log) {
            _ = try? h.seekToEnd()
            p.standardOutput = h
            p.standardError = h
        }
        do { try p.run() } catch { return "Could not start the orchestrator: \(error.localizedDescription)" }
        process = p
        for _ in 0..<40 {
            try? await Task.sleep(nanoseconds: 250_000_000)
            if readConfig(), await healthy() { return nil }
            if !p.isRunning { break }
        }
        let tail = (try? String(contentsOf: log, encoding: .utf8))?.suffix(300) ?? ""
        return "The orchestrator did not start. Node 24+ must be on your PATH.\n\(tail)"
    }

    func stop() { process?.terminate() }

    func request<T: Decodable>(_ method: String, _ path: String, body: [String: Any]? = nil) async throws -> T {
        var req = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/api/\(path)")!)
        req.httpMethod = method
        req.timeoutInterval = 30
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body { req.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let (data, res) = try await URLSession.shared.data(for: req)
        if let http = res as? HTTPURLResponse, http.statusCode >= 400 {
            let msg = (try? JSONDecoder().decode(APIError.self, from: data))?.error ?? "HTTP \(http.statusCode)"
            throw NSError(domain: "Argo", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: msg])
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}

struct Ignored: Decodable { init(from decoder: Decoder) throws {} }
