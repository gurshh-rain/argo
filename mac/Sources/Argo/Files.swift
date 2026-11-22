import SwiftUI
import AppKit

/// The right-hand file tree, as in cmux: the project folder (or home), folders first, expand in place.
struct FilesPanel: View {
    @EnvironmentObject var store: Store
    @State private var expanded = Set<String>()
    @State private var selected: String?
    @State private var searching = false
    @State private var filter = ""
    @State private var cache: [String: [Entry]] = [:]

    struct Entry: Hashable { let path: String; let name: String; let isDir: Bool }
    struct Row: Identifiable { let entry: Entry; let depth: Int; var id: String { entry.path } }

    var root: String { store.folder.isEmpty ? NSHomeDirectory() : store.folder }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                HStack(spacing: 4) { RightTabs() }
                Button { searching.toggle(); if !searching { filter = "" } } label: { Image(systemName: "magnifyingglass") }
                    .foregroundStyle(searching ? Theme.text : Theme.dim).help("Filter by name")
                Button { cache = [:] } label: { Image(systemName: "arrow.clockwise") }.help("Reload")
                Button { NSWorkspace.shared.open(URL(fileURLWithPath: root)) } label: { Image(systemName: "macwindow") }.help("Show in Finder")
                Spacer()
                Button { store.filesHidden = true } label: { Image(systemName: "sidebar.right") }.help("Hide files")
            }
            .buttonStyle(.plain).font(.system(size: 12)).foregroundStyle(Theme.dim)
            .padding(.horizontal, 8).frame(height: 30)
            HLine()
            if searching {
                TextField("Filter", text: $filter).textFieldStyle(.plain).font(.system(size: 12)).foregroundStyle(Theme.text)
                    .padding(.horizontal, 10).frame(height: 26)
                HLine()
            }
            HStack(spacing: 6) {
                Image(systemName: "folder.fill").font(.system(size: 11))
                Text(root.replacingOccurrences(of: NSHomeDirectory(), with: "~")).font(.system(size: 12)).lineLimit(1).truncationMode(.head)
                Spacer()
            }
            .foregroundStyle(Theme.dim).padding(.horizontal, 12).frame(height: 28)
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(rows(of: root, depth: 0)) { r in row(r) }
                }
            }
        }
        .background(Theme.pane)
        .onChange(of: store.project) { cache = [:]; expanded = [] }
    }

    func row(_ r: Row) -> some View {
        let e = r.entry
        return HStack(spacing: 7) {
            Image(systemName: "chevron.right").font(.system(size: 9, weight: .semibold))
                .rotationEffect(.degrees(expanded.contains(e.path) ? 90 : 0)).opacity(e.isDir ? 1 : 0).frame(width: 10)
            Image(systemName: e.isDir ? "folder.fill" : "doc").font(.system(size: 11)).frame(width: 16)
            Text(e.name).font(.system(size: 12)).foregroundStyle(Theme.text).lineLimit(1).truncationMode(.middle)
            Spacer(minLength: 0)
        }
        .foregroundStyle(Theme.dim)
        .padding(.leading, 12 + CGFloat(r.depth) * 14).padding(.trailing, 8).frame(height: 21)
        .background(selected == e.path ? Theme.rowSelected : Color.clear)
        .contentShape(Rectangle())
        .onTapGesture(count: 2) { if !e.isDir { NSWorkspace.shared.open(URL(fileURLWithPath: e.path)) } }
        .onTapGesture {
            selected = e.path
            guard e.isDir else { return }
            if expanded.contains(e.path) { expanded.remove(e.path) } else { expanded.insert(e.path) }
        }
        .contextMenu {
            Button("Reveal in Finder") { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: e.path)]) }
            Button("Copy path") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(e.path, forType: .string) }
        }
    }

    /// Visible rows, depth first; children only for expanded folders.
    func rows(of dir: String, depth: Int) -> [Row] {
        var out: [Row] = []
        for e in list(dir) where filter.isEmpty || e.isDir || e.name.localizedCaseInsensitiveContains(filter) {
            if !filter.isEmpty, e.isDir, !e.name.localizedCaseInsensitiveContains(filter), !expanded.contains(e.path) { continue }
            out.append(Row(entry: e, depth: depth))
            if e.isDir, expanded.contains(e.path), depth < 12 { out += rows(of: e.path, depth: depth + 1) }
        }
        return out
    }

    func list(_ dir: String) -> [Entry] {
        if let c = cache[dir] { return c }
        let fm = FileManager.default
        let names = (try? fm.contentsOfDirectory(atPath: dir)) ?? []
        let entries = names.filter { $0 != ".DS_Store" }.map { n -> Entry in
            let p = (dir as NSString).appendingPathComponent(n)
            var isDir: ObjCBool = false
            fm.fileExists(atPath: p, isDirectory: &isDir)
            return Entry(path: p, name: n, isDir: isDir.boolValue)
        }.sorted { a, b in
            a.isDir != b.isDir ? a.isDir : a.name.localizedStandardCompare(b.name) == .orderedAscending
        }
        DispatchQueue.main.async { cache[dir] = entries }
        return entries
    }
}
