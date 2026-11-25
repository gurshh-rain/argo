import SwiftUI
import AppKit
import WebKit

/// A file open in an editor pane. It sits in the workspace's split layout beside the terminals.
struct Doc: Identifiable, Hashable {
    let id = UUID()
    let path: String
    /// The workspace it was opened in.
    let workspace: String
    var name: String { (path as NSString).lastPathComponent }
    var folder: String { ((path as NSString).deletingLastPathComponent as NSString).abbreviatingWithTildeInPath }
}

/// One editor: a web view running Monaco (the editor in VS Code, and in Argo for Windows) with the file's text.
@MainActor
final class EditorController: NSObject {
    /// Where build.sh puts the editor page and Monaco.
    static var page: URL? {
        guard let dir = Bundle.main.resourceURL?.appendingPathComponent("editor") else { return nil }
        let f = dir.appendingPathComponent("index.html")
        return FileManager.default.fileExists(atPath: f.path) && FileManager.default.fileExists(atPath: dir.appendingPathComponent("vs/loader.js").path) ? f : nil
    }

    let doc: Doc
    let web: WKWebView
    weak var hub: TeamHub?
    /// When the text shown here was last read from or written to disk.
    var mtime: Date?
    private var bom = false
    private var text: String
    private var ready = false

    init(doc: Doc, text: String, bom: Bool, mtime: Date?, hub: TeamHub) {
        self.doc = doc
        self.text = text
        self.bom = bom
        self.mtime = mtime
        self.hub = hub
        let config = WKWebViewConfiguration()
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 600, height: 400), configuration: config)
        super.init()
        config.userContentController.add(Relay(self), name: "argo")
        // no white flash before the page paints its own background
        web.setValue(false, forKey: "drawsBackground")
        if let page = Self.page { web.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent()) }
    }

    /// The web view keeps its message handler alive; this keeps that from keeping the controller alive too.
    private final class Relay: NSObject, WKScriptMessageHandler {
        weak var to: EditorController?
        init(_ to: EditorController) { self.to = to }
        func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
            let body = message.body as? [String: Any] ?? [:]
            MainActor.assumeIsolated { to?.receive(body) }
        }
    }

    private func call(_ function: String, _ args: Any...) {
        guard let data = try? JSONSerialization.data(withJSONObject: args), let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.argo.\(function)(...\(json))", completionHandler: nil)
    }

    /// A message from the page: it is ready, its text changed, it took the keyboard, or it is handing over text to save.
    func receive(_ m: [String: Any]) {
        guard let type = m["type"] as? String else { return }
        switch type {
        case "ready":
            ready = true
            setTheme()
            call("open", text, doc.path)
            if hub?.focused == doc.id { focus() }
        case "dirty":
            if m["value"] as? Bool == true { hub?.unsaved.insert(doc.id) } else { hub?.unsaved.remove(doc.id) }
        case "focus":
            if hub?.focused != doc.id { hub?.focused = doc.id }
        case "save":
            guard let text = m["text"] as? String, let version = m["version"] as? Int else { return }
            write(text, version: version)
        default: break
        }
    }

    /// ⌘S: the page hands back its text, which is then written to disk.
    func save() { if ready { call("save") } }

    private func write(_ text: String, version: Int, force: Bool = false) {
        if hub?.stale.contains(doc.id) == true && !force {
            hub?.ask?(Store.Confirm(title: "Overwrite \(doc.name)?", message: "The file changed on disk after you opened it (an agent may have edited it). Saving replaces that version with yours.", button: "Overwrite") { [weak self] in
                self?.write(text, version: version, force: true)
            })
            return
        }
        do {
            var data = Data(text.utf8)
            if bom { data = Data([0xEF, 0xBB, 0xBF]) + data }
            try data.write(to: URL(fileURLWithPath: doc.path), options: .atomic)
            self.text = text
            mtime = Self.modified(doc.path)
            hub?.stale.remove(doc.id); hub?.missing.remove(doc.id)
            call("saved", version)
        } catch {
            hub?.tell?("Could not save \(doc.name): \(error.localizedDescription)")
        }
    }

    /// Shows the version now on disk (an agent changed the file, or the user asked for it).
    func reload() {
        guard let file = Self.read(doc.path), let text = file.text else { return }
        self.text = text
        bom = file.bom
        mtime = file.mtime
        hub?.stale.remove(doc.id); hub?.missing.remove(doc.id)
        if ready { call("replace", text) }
    }

    func setTheme() {
        let dark = NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        call("theme", !dark)
    }

    func focus() {
        web.window?.makeFirstResponder(web)
        if ready { call("focus") }
    }

    static func modified(_ path: String) -> Date? { (try? FileManager.default.attributesOfItem(atPath: path))?[.modificationDate] as? Date }

    /// The file as text, or `text == nil` when it is not something to edit here (binary, or very large).
    static func read(_ path: String) -> (text: String?, bom: Bool, mtime: Date?)? {
        guard let data = FileManager.default.contents(atPath: path) else { return nil }
        let mtime = modified(path)
        guard data.count <= 2 << 20, !data.prefix(8000).contains(0) else { return (nil, false, mtime) }
        let bom = data.starts(with: [0xEF, 0xBB, 0xBF])
        guard let text = String(data: bom ? data.dropFirst(3) : data, encoding: .utf8) else { return (nil, false, mtime) }
        return (text, bom, mtime)
    }
}

extension TeamHub {
    func docs(in ws: String) -> [Doc] { docs.filter { $0.workspace == ws } }
    func editor(_ id: UUID) -> EditorController? { editors[id] }

    /// Every pane of a workspace (terminals and files), in the order the layout shows them.
    func paneIDs(in ws: String) -> [UUID] {
        func walk(_ n: Layout) -> [UUID] {
            switch n {
            case .leaf(let id): return members.contains { $0.id == id } || docs.contains { $0.id == id } ? [id] : []
            case .split(_, let kids): return kids.flatMap(walk)
            }
        }
        return layouts[ws].map(walk) ?? []
    }

    /// Opens a file in an editor pane beside the focused pane, or shows the pane that already has it.
    /// Images, binaries and very large files go to the app macOS opens them with.
    func open(file path: String, in ws: String, horizontal: Bool = true) {
        if let d = docs(in: ws).first(where: { $0.path == path }) { return focus(d.id) }
        guard let file = EditorController.read(path) else { tell?("Could not open \(path)."); return }
        guard let text = file.text, EditorController.page != nil else {
            NSWorkspace.shared.open(URL(fileURLWithPath: path))
            return
        }
        let d = Doc(path: path, workspace: ws)
        let panes = paneIDs(in: ws)
        let target = focused.flatMap { panes.contains($0) ? $0 : nil } ?? panes.last
        docs.append(d)
        editors[d.id] = EditorController(doc: d, text: text, bom: file.bom, mtime: file.mtime, hub: self)
        if let target, let l = layouts[ws] { layouts[ws] = l.inserting(d.id, beside: target, horizontal: horizontal) }
        else { layouts[ws] = .leaf(d.id) }
        focused = d.id
    }

    /// Closes a file's pane. Unsaved changes are only dropped when the user agrees (or `force`).
    func closeDoc(_ id: UUID, force: Bool = false) {
        guard let d = docs.first(where: { $0.id == id }) else { return }
        if unsaved.contains(id) && !force, let ask {
            ask(Store.Confirm(title: "Close \(d.name) without saving?", message: "Your changes to it will be lost.", button: "Discard changes") { [weak self] in self?.closeDoc(id, force: true) })
            return
        }
        editors[id]?.web.removeFromSuperview()
        editors[id] = nil
        docs.removeAll { $0.id == id }
        layouts[d.workspace] = layouts[d.workspace]?.removing(id)
        unsaved.remove(id); stale.remove(id); missing.remove(id)
        if focused == id { focused = paneIDs(in: d.workspace).last }
    }

    func saveFocused() { if let id = focused { editors[id]?.save() } }

    /// Agents edit the same files. A file that changed on disk is reloaded if it has no unsaved edits here;
    /// otherwise its pane says so and the user chooses.
    func watchFiles() {
        for d in docs {
            guard let e = editors[d.id] else { continue }
            guard let now = EditorController.modified(d.path) else { missing.insert(d.id); continue }
            missing.remove(d.id)
            if now == e.mtime { continue }
            if unsaved.contains(d.id) { stale.insert(d.id) } else { e.reload() }
        }
    }

    /// "Keep mine": stop flagging the version on disk; the next save overwrites it.
    func keepMine(_ id: UUID) {
        guard let d = docs.first(where: { $0.id == id }) else { return }
        editors[id]?.mtime = EditorController.modified(d.path)
        stale.remove(id)
    }

    func restyleEditors() { for e in editors.values { e.setTheme() } }

    /// Writes a picture of each editor pane to `<base>.editor-N.png` (for headless checks), then calls `done`.
    func snapshotEditors(to base: String, done: @escaping () -> Void) {
        var left = docs.count
        guard left > 0 else { return done() }
        for (n, d) in docs.enumerated() {
            guard let web = editors[d.id]?.web else { left -= 1; if left == 0 { done() }; continue }
            web.takeSnapshot(with: nil) { image, _ in
                if let tiff = image?.tiffRepresentation, let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
                    try? png.write(to: URL(fileURLWithPath: "\(base).editor-\(n + 1).png"))
                }
                left -= 1
                if left == 0 { done() }
            }
        }
    }
}

struct EditorHost: NSViewRepresentable {
    let view: WKWebView
    func makeNSView(context: Context) -> NSView {
        let c = NSView()
        attach(c)
        return c
    }
    func updateNSView(_ c: NSView, context: Context) { attach(c) }
    private func attach(_ c: NSView) {
        guard view.superview !== c else { return }
        view.removeFromSuperview()
        view.frame = c.bounds
        view.autoresizingMask = [.width, .height]
        c.addSubview(view)
    }
}

/// A file in the workspace: the same frame as a terminal pane, with the editor inside.
struct EditorPane: View {
    @EnvironmentObject var hub: TeamHub
    @EnvironmentObject var store: Store
    let doc: Doc
    var body: some View {
        PaneFrame(active: hub.focused == doc.id) {
            Image(systemName: "doc").font(.system(size: 11)).foregroundStyle(Theme.text)
            Text(doc.name).font(.system(size: 12)).foregroundStyle(Theme.text).lineLimit(1).fixedSize().help(doc.path)
            if hub.unsaved.contains(doc.id) { Circle().fill(Theme.text).frame(width: 7, height: 7).help("Unsaved changes (⌘S saves)") }
            if hub.missing.contains(doc.id) { Chip(text: "deleted") }
            Button { hub.closeDoc(doc.id) } label: { Image(systemName: "xmark").font(.system(size: 9, weight: .semibold)) }
                .buttonStyle(IconButton()).foregroundStyle(Theme.dim).help("Close this file (⌘W)")
        } trailing: {
            Menu {
                ForEach(TeamHub.kinds, id: \.id) { k in
                    Button("New \(k.label) terminal") { hub.add(kind: k.id, project: doc.workspace, beside: doc.id) }
                        .disabled(k.bin != nil && !(store.agent(k.id)?.installed ?? true))
                }
            } label: { Image(systemName: "apple.terminal") }
            .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().help("New terminal beside this file")
            Button { hub.add(kind: "shell", project: doc.workspace, beside: doc.id, horizontal: true) } label: { Image(systemName: "square.split.2x1") }
                .help("Split right: open a terminal beside this file")
            Button { hub.add(kind: "shell", project: doc.workspace, beside: doc.id, horizontal: false) } label: { Image(systemName: "square.split.1x2") }
                .help("Split down: open a terminal below this file")
        } content: {
            VStack(spacing: 0) {
                if let e = hub.editor(doc.id) { EditorHost(view: e.web).background(Theme.pane) }
                if hub.stale.contains(doc.id) {
                    HStack(spacing: 8) {
                        Image(systemName: "bell.badge.fill").foregroundStyle(Theme.ring)
                        Text("Changed on disk while you have unsaved edits.").font(.system(size: 11)).foregroundStyle(Theme.text).lineLimit(2)
                            .help("Someone else (an agent, most likely) changed this file. Reload shows their version and drops your edits; Keep mine leaves yours, and saving then replaces theirs.")
                        Spacer(minLength: 4)
                        Button("Reload") { hub.editor(doc.id)?.reload() }.fixedSize()
                        Button("Keep mine") { hub.keepMine(doc.id) }.fixedSize()
                    }
                    .buttonStyle(ArgoButton()).padding(.horizontal, 8).padding(.vertical, 6).background(Theme.rowSelected)
                }
            }
        }
        .buttonStyle(IconButton()).font(.system(size: 12)).foregroundStyle(Theme.dim).tint(Theme.dim)
    }
}
