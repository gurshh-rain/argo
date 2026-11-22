import Foundation

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

    func healthy() async -> Bool {
        guard let url = URL(string: "http://127.0.0.1:\(port)/health") else { return false }
        var req = URLRequest(url: url)
        req.timeoutInterval = 1
        return ((try? await URLSession.shared.data(for: req))?.1 as? HTTPURLResponse)?.statusCode == 200
    }

    /// Returns nil when the orchestrator is reachable, otherwise a message for the user.
    func ensureRunning() async -> String? {
        _ = readConfig()
        if await healthy() { return nil }
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
        FileManager.default.createFile(atPath: log.path, contents: nil)
        if let h = try? FileHandle(forWritingTo: log) {
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
