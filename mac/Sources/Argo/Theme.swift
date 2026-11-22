import SwiftUI

enum Theme {
    // Sampled from ref.png (cmux): one flat gray surface, hairline dividers, blue as the only hue.
    static let bg = Color(red: 0x1e / 255, green: 0x1e / 255, blue: 0x1e / 255)
    static let sidebar = bg
    static let pane = bg
    static let header = bg
    static let line = Color(red: 0x2c / 255, green: 0x2c / 255, blue: 0x2c / 255)
    static let rowSelected = Color(red: 0x30 / 255, green: 0x30 / 255, blue: 0x30 / 255)
    static let chip = Color(red: 0x31 / 255, green: 0x31 / 255, blue: 0x31 / 255)
    static let selected = Color(red: 0, green: 0x91 / 255, blue: 1)
    static let text = Color(red: 0.87, green: 0.87, blue: 0.87)
    static let dim = Color(red: 0.56, green: 0.56, blue: 0.58)
    static let ring = Color(red: 0, green: 0x7a / 255, blue: 1)
    static let green = Color.white
    static let red = Color(white: 0.7)
    static let amber = Color(white: 0.85)
    /// Monospace is for terminal content only: agent output, command output and the terminals themselves.
    static let mono = Font.system(size: 12, design: .monospaced)

    static func status(_ s: String) -> Color {
        switch s {
        case "done": return green
        case "running", "merging", "planning", "verifying": return ring
        case "failed": return red
        case "needs_attention", "awaiting_approval": return amber
        default: return dim
        }
    }
    static func agent(_ id: String?) -> Color {
        switch id {
        case "claude": return Color(white: 0.95)
        case "codex": return Color(white: 0.7)
        case "devin": return Color(white: 0.55)
        default: return dim
        }
    }
}

struct StatusDot: View {
    let status: String
    @State private var pulse = false
    var live: Bool { ["running", "merging", "planning", "verifying"].contains(status) }
    var body: some View {
        Circle().fill(Theme.status(status)).frame(width: 7, height: 7)
            .opacity(live && pulse ? 0.35 : 1)
            .animation(live ? .easeInOut(duration: 0.8).repeatForever() : .default, value: pulse)
            .onAppear { pulse = true }
    }
}

struct Chip: View {
    let text: String
    var color: Color = Theme.dim
    var body: some View {
        Text(text).font(.system(size: 10, weight: .medium))
            .padding(.horizontal, 6).padding(.vertical, 2)
            .foregroundStyle(color)
            .background(color.opacity(0.14), in: RoundedRectangle(cornerRadius: 4))
    }
}

extension String {
    var pretty: String { replacingOccurrences(of: "_", with: " ") }
}

struct VLine: View { var body: some View { Rectangle().fill(Theme.line).frame(width: 1) } }
struct HLine: View { var body: some View { Rectangle().fill(Theme.line).frame(height: 1) } }

/// Text buttons. Primary is the one action we want taken; secondary is everything else; danger removes something.
struct ArgoButton: ButtonStyle {
    enum Kind { case primary, secondary, danger }
    var kind: Kind = .secondary
    var large = false
    func makeBody(configuration: Configuration) -> some View { Look(configuration: configuration, kind: kind, large: large) }

    private struct Look: View {
        let configuration: Configuration
        let kind: Kind
        let large: Bool
        @Environment(\.isEnabled) private var enabled
        @State private var hover = false
        var body: some View {
            let fill: Color = kind == .primary ? Theme.ring : kind == .danger ? Theme.red.opacity(0.16) : Theme.chip
            let text: Color = kind == .primary ? .white : kind == .danger ? Theme.red : Theme.text
            configuration.label
                .font(.system(size: large ? 13 : 12, weight: .medium)).foregroundStyle(text).lineLimit(1)
                .padding(.horizontal, large ? 14 : 10).frame(height: large ? 30 : 24)
                .background(fill, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(Color.white.opacity(configuration.isPressed ? 0.0 : hover ? 0.08 : 0)))
                .overlay(RoundedRectangle(cornerRadius: 7, style: .continuous).strokeBorder(kind == .secondary ? Color.white.opacity(0.10) : .clear, lineWidth: 1))
                .opacity(enabled ? (configuration.isPressed ? 0.75 : 1) : 0.4)
                .contentShape(RoundedRectangle(cornerRadius: 7))
                .onHover { hover = $0 }
                .animation(.easeOut(duration: 0.12), value: hover)
        }
    }
}

/// Icon-only buttons: no chrome until hovered, then a soft rounded highlight.
struct IconButton: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View { Look(configuration: configuration) }
    private struct Look: View {
        let configuration: Configuration
        @Environment(\.isEnabled) private var enabled
        @State private var hover = false
        var body: some View {
            configuration.label
                .padding(.horizontal, 4).frame(minWidth: 22, minHeight: 22)
                .background(Color.white.opacity(configuration.isPressed ? 0.16 : hover ? 0.09 : 0), in: RoundedRectangle(cornerRadius: 5, style: .continuous))
                .opacity(enabled ? 1 : 0.4)
                .contentShape(Rectangle())
                .onHover { hover = $0 }
        }
    }
}
