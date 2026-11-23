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
