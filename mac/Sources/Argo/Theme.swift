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
        Text(text).font(.system(size: 10, weight: .medium, design: .monospaced))
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
