import SwiftUI
import AppKit
import SwiftTerm

/// Terminals that talk to each other. Every Argo terminal has `argo-msg` on hand:
///
///     argo-msg "Devin 1" "the API is ready"      one member
///     argo-msg --all "main is broken, hold off"  everyone else in the workspace
///     argo-msg --list                            who is here
///
/// The command drops a small file in ~/.argo/mail; the app picks it up and puts the message in the
/// recipient's terminal. If an agent CLI is running there it is typed in as a prompt, so the agent reads
/// and acts on it. In a plain shell it is only displayed, never typed, so it can't run as a command.
struct Mail: Identifiable, Equatable {
    let id = UUID()
    let from: String
    let to: String
    let text: String
    let at = Date()
}

enum MailRoom {
    static let dir = Daemon.home.appendingPathComponent("mail")
    static let tool = Daemon.home.appendingPathComponent("bin/argo-msg")

    /// One roster file per workspace: the names a terminal there may write to.
    static func roster(_ ws: String) -> URL {
        let safe = String(ws.map { $0.isLetter || $0.isNumber ? $0 : "_" }.suffix(80))
        return dir.appendingPathComponent("roster-\(safe.isEmpty ? "none" : safe).txt")
    }

    static func install() {
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: tool.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? script.write(to: tool, atomically: true, encoding: .utf8)
        try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: tool.path)
    }

    static let script = """
    #!/bin/sh
    # argo-msg: send a message to another terminal in this Argo workspace.
    if [ -z "$ARGO_MAIL" ] || [ -z "$ARGO_MEMBER" ]; then
      echo "argo-msg only works inside a terminal opened by Argo." >&2; exit 1
    fi
    others() { grep -vx "$ARGO_MEMBER" "$ARGO_ROSTER" 2>/dev/null; }
    usage() {
      echo "You are $ARGO_MEMBER. Other terminals in this workspace:"
      others | sed 's/^/  /'
      echo 'usage: argo-msg "<name>" "<message>"    argo-msg --all "<message>"    argo-msg --list'
    }
    case "$1" in ""|-h|--help|-l|--list) usage; exit 0;; esac
    to="$1"; shift; text="$*"
    if [ -z "$text" ]; then usage >&2; exit 1; fi
    if [ "$to" != "--all" ] && ! others | grep -qix "$to"; then
      echo "No other terminal named \\"$to\\" in this workspace. Names:" >&2; others | sed 's/^/  /' >&2; exit 1
    fi
    f="$ARGO_MAIL/$(date +%s)-$$-$RANDOM"
    printf 'workspace=%s\\nfrom=%s\\nto=%s\\n\\n%s\\n' "$ARGO_WORKSPACE" "$ARGO_MEMBER" "$to" "$text" > "$f.tmp" && mv "$f.tmp" "$f.msg"
    if [ "$to" = "--all" ]; then echo "Sent to everyone else."; else echo "Sent to $to."; fi
    """

    /// What an agent is told about messaging when its terminal starts.
    static var briefing: String {
        " To tell another member something directly, run \(tool.path) \"<their name>\" \"<message>\" (\(tool.path) --list shows the names). Messages from other members arrive in your prompt as [Message from <name>]; act on them or reply the same way."
    }
}

extension TeamHub {
    func mailEnvironment(for m: Member) -> [String] {
        ["ARGO_WORKSPACE=\(m.workspace)", "ARGO_MAIL=\(MailRoom.dir.path)", "ARGO_ROSTER=\(MailRoom.roster(m.workspace).path)", "ARGO_MSG=\(MailRoom.tool.path)"]
    }

    func writeMailRoster(_ ws: String) {
        try? FileManager.default.createDirectory(at: MailRoom.dir, withIntermediateDirectories: true)
        let names = members(in: ws).filter { !exited.contains($0.id) }.map(\.name).joined(separator: "\n")
        try? (names + "\n").write(to: MailRoom.roster(ws), atomically: true, encoding: .utf8)
    }

    /// Picks up messages written by `argo-msg` and puts each in its recipient's terminal.
    func deliverMail() async {
        let fm = FileManager.default
        guard let files = try? fm.contentsOfDirectory(at: MailRoom.dir, includingPropertiesForKeys: nil).filter({ $0.pathExtension == "msg" }).sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) else { return }
        for file in files {
            defer { try? fm.removeItem(at: file) }
            guard let raw = try? String(contentsOf: file, encoding: .utf8), let gap = raw.range(of: "\n\n") else { continue }
            var head: [String: String] = [:]
            for line in raw[..<gap.lowerBound].split(separator: "\n") {
                if let eq = line.firstIndex(of: "=") { head[String(line[..<eq])] = String(line[line.index(after: eq)...]) }
            }
            // one line of plain text: nothing in a message may act as a keystroke in the other terminal
            let text = String(String(raw[gap.upperBound...]).unicodeScalars.map { $0.properties.generalCategory == .control ? " " : Character($0) })
                .split(separator: " ", omittingEmptySubsequences: true).joined(separator: " ")
            guard let ws = head["workspace"], let from = head["from"], let to = head["to"], !text.isEmpty,
                  let sender = members(in: ws).first(where: { $0.name == from }) else { continue }
            let targets = members(in: ws).filter { $0.id != sender.id && !exited.contains($0.id) && (to == "--all" || $0.name.caseInsensitiveCompare(to) == .orderedSame) }
            for t in targets { await deliver(Mail(from: from, to: t.name, text: String(text.prefix(2000))), to: t) }
        }
    }

    private func deliver(_ mail: Mail, to m: Member) async {
        guard let v = view(m.id) else { return }
        if cli[m.id] != nil {
            // an agent is listening: type it in as a prompt and submit
            v.send(txt: "[Message from \(mail.from)] \(mail.text)")
            try? await Task.sleep(nanoseconds: 400_000_000)
            v.send(txt: "\r")
        } else {
            // a bare shell would run typed text as a command, so only show it
            v.feed(text: "\r\n\u{1B}[1;34m[Message from \(mail.from)]\u{1B}[0m \(mail.text)\r\n")
        }
        inbox[m.id] = mail
        log.append(mail)
        if log.count > 200 { log.removeFirst(log.count - 200) }
        if focused != m.id { ringing.insert(m.id) }
        record(mail, in: m.workspace)
    }

    /// Keeps the conversation next to the shared record, so it can be read back later.
    private func record(_ mail: Mail, in ws: String) {
        let folder = WS.folder(ws)
        guard !folder.isEmpty else { return }
        let file = URL(fileURLWithPath: folder).appendingPathComponent(".argo/messages.md")
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        let line = "- \(mail.at.formatted(date: .omitted, time: .standard)) **\(mail.from) → \(mail.to)**: \(mail.text)\n"
        if let h = try? FileHandle(forWritingTo: file) {
            defer { try? h.close() }
            _ = try? h.seekToEnd()
            try? h.write(contentsOf: Data(line.utf8))
        } else {
            try? ("# Messages between terminals\n\n" + line).write(to: file, atomically: true, encoding: .utf8)
        }
    }
}

/// The latest message a terminal received, shown on its tab until the terminal is clicked.
struct MailChip: View {
    @EnvironmentObject var hub: TeamHub
    let member: Member
    var body: some View {
        if let mail = hub.inbox[member.id] {
            HStack(spacing: 4) {
                Image(systemName: "envelope.fill").font(.system(size: 9))
                Text("\(mail.from): \(mail.text)").font(.system(size: 11)).lineLimit(1).frame(maxWidth: 220, alignment: .leading).fixedSize()
            }
            .foregroundStyle(Theme.ring)
            .help("\(mail.from) → \(mail.to): \(mail.text)")
        }
    }
}
