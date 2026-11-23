import SwiftUI
import AppKit

/// A color that follows the app's appearance (Settings → Appearance), resolved by AppKit at draw time.
func adaptive(dark: NSColor, light: NSColor) -> Color {
    Color(nsColor: NSColor(name: nil) { $0.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light })
}
private func rgb(_ hex: Int) -> NSColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: 1)
}

enum Theme {
    // Dark is sampled from ref.png (cmux): one flat gray surface, hairline dividers, blue as the only hue.
    // Light mirrors it: one flat near-white surface, the same blue.
    static let bg = adaptive(dark: rgb(0x1e1e1e), light: rgb(0xf7f7f7))
    static let sidebar = bg
    static let pane = bg
    static let header = bg
    static let line = adaptive(dark: rgb(0x2c2c2c), light: rgb(0xdedede))
    static let rowSelected = adaptive(dark: rgb(0x303030), light: rgb(0xe9e9e9))
    static let chip = adaptive(dark: rgb(0x313131), light: rgb(0xe7e7e7))
    static let selected = Color(red: 0, green: 0x91 / 255, blue: 1)
    static let text = adaptive(dark: NSColor(white: 0.87, alpha: 1), light: NSColor(white: 0.12, alpha: 1))
    static let dim = adaptive(dark: NSColor(white: 0.56, alpha: 1), light: NSColor(white: 0.43, alpha: 1))
    static let ring = Color(red: 0, green: 0x7a / 255, blue: 1)
    static let green = adaptive(dark: .white, light: NSColor(white: 0.1, alpha: 1))
    static let red = adaptive(dark: NSColor(white: 0.7, alpha: 1), light: NSColor(white: 0.35, alpha: 1))
    static let amber = adaptive(dark: NSColor(white: 0.85, alpha: 1), light: NSColor(white: 0.25, alpha: 1))
    /// Hover and pressed highlights: lighten on dark, darken on light.
    static let wash = adaptive(dark: .white, light: .black)
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
        case "claude": return adaptive(dark: NSColor(white: 0.95, alpha: 1), light: NSColor(white: 0.1, alpha: 1))
        case "codex": return adaptive(dark: NSColor(white: 0.7, alpha: 1), light: NSColor(white: 0.32, alpha: 1))
        case "devin": return adaptive(dark: NSColor(white: 0.55, alpha: 1), light: NSColor(white: 0.48, alpha: 1))
        case "ollama": return adaptive(dark: NSColor(white: 0.82, alpha: 1), light: NSColor(white: 0.22, alpha: 1))
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
                .overlay(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(Theme.wash.opacity(configuration.isPressed ? 0.0 : hover ? 0.08 : 0)))
                .overlay(RoundedRectangle(cornerRadius: 7, style: .continuous).strokeBorder(kind == .secondary ? Theme.wash.opacity(0.10) : .clear, lineWidth: 1))
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
                .background(Theme.wash.opacity(configuration.isPressed ? 0.16 : hover ? 0.09 : 0), in: RoundedRectangle(cornerRadius: 5, style: .continuous))
                .opacity(enabled ? 1 : 0.4)
                .contentShape(Rectangle())
                .onHover { hover = $0 }
        }
    }
}

/// A compact segmented switch in Argo's own style: a soft track with the chosen option raised on it.
struct Segmented<Value: Hashable>: View {
    struct Option { let value: Value; let label: String; var icon: String? = nil }
    @Binding var selection: Value
    let options: [Option]
    var large = false
    @Namespace private var ns

    var body: some View {
        HStack(spacing: 2) {
            ForEach(Array(options.enumerated()), id: \.offset) { _, o in
                let on = o.value == selection
                Button { withAnimation(.easeOut(duration: 0.15)) { selection = o.value } } label: {
                    HStack(spacing: 5) {
                        if let icon = o.icon { Image(systemName: icon).font(.system(size: large ? 11.5 : 10.5)) }
                        Text(o.label).fixedSize()
                    }
                    .font(.system(size: large ? 12.5 : 12, weight: on ? .semibold : .medium))
                    .foregroundStyle(on ? Theme.text : Theme.dim)
                    .padding(.horizontal, large ? 14 : 10).frame(height: large ? 26 : 22)
                    .frame(maxWidth: large ? .infinity : nil)
                    .background {
                        if on {
                            RoundedRectangle(cornerRadius: 6, style: .continuous).fill(Theme.rowSelected)
                                .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(Color.primary.opacity(0.10), lineWidth: 1))
                                .matchedGeometryEffect(id: "pick", in: ns)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(2)
        .background(Theme.chip.opacity(0.55), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Color.primary.opacity(0.06), lineWidth: 1))
    }
}
