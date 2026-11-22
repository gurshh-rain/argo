import SwiftUI
import AppKit

/// Remembers how the user sized each pane. Weights are relative; a missing entry counts as 1.
@MainActor
final class SplitSizes: ObservableObject {
    @Published var weight: [String: CGFloat] = [:]
}

/// Panes laid out side by side or stacked, separated by hairlines you can drag to resize.
struct SplitStack<Content: View>: View {
    let horizontal: Bool
    /// One stable key per pane, in order.
    let keys: [String]
    var minSize: CGFloat = 60
    @ViewBuilder var content: (Int) -> Content
    @EnvironmentObject var sizes: SplitSizes

    var body: some View {
        GeometryReader { geo in
            let space = max(1, (horizontal ? geo.size.width : geo.size.height) - CGFloat(max(0, keys.count - 1)))
            let weights = keys.map { sizes.weight[$0] ?? 1 }
            let sum = max(0.0001, weights.reduce(0, +))
            let stack = horizontal ? AnyLayout(HStackLayout(spacing: 0)) : AnyLayout(VStackLayout(spacing: 0))
            stack {
                ForEach(Array(keys.enumerated()), id: \.element) { i, _ in
                    let length = space * weights[i] / sum
                    content(i).frame(width: horizontal ? length : nil, height: horizontal ? nil : length)
                    if i < keys.count - 1 {
                        Handle(horizontal: horizontal) { start, delta in
                            // move the boundary by `delta` points, keeping both neighbours above the minimum
                            let pair = start.0 + start.1
                            let floor = min(minSize * sum / space, pair / 2)
                            let a = min(max(start.0 + delta * sum / space, floor), pair - floor)
                            sizes.weight[keys[i]] = a
                            sizes.weight[keys[i + 1]] = pair - a
                        } begin: { (weights[i], weights[i + 1]) }
                    }
                }
            }
        }
    }
}

/// The 1pt divider with a wider invisible grab area.
private struct Handle: View {
    let horizontal: Bool
    let drag: ((CGFloat, CGFloat), CGFloat) -> Void
    let begin: () -> (CGFloat, CGFloat)
    @State private var start: (CGFloat, CGFloat)?
    @State private var hovering = false

    var body: some View {
        Rectangle().fill(start != nil || hovering ? Theme.ring : Theme.line)
            .frame(width: horizontal ? 1 : nil, height: horizontal ? nil : 1)
            .overlay {
                Color.clear.frame(width: horizontal ? 9 : nil, height: horizontal ? nil : 9).contentShape(Rectangle())
                    .onHover { inside in
                        hovering = inside
                        if inside { (horizontal ? NSCursor.resizeLeftRight : NSCursor.resizeUpDown).push() } else { NSCursor.pop() }
                    }
                    .gesture(
                        DragGesture(minimumDistance: 1, coordinateSpace: .global)
                            .onChanged { g in
                                if start == nil { start = begin() }
                                drag(start!, horizontal ? g.translation.width : g.translation.height)
                            }
                            .onEnded { _ in start = nil }
                    )
            }
            .zIndex(1)
    }
}
