import SwiftUI

/// Renders agent-written text (Markdown-ish) as clean reading text: headings, lists, tables and code
/// blocks are laid out properly instead of showing raw `**`, `#`, `|` and backtick characters.
struct Prose: View {
    let text: String
    var size: CGFloat = 12
    var color: Color = Theme.text

    enum Block: Hashable {
        case heading(Int, String)
        case paragraph(String)
        case bullet(String, Int)
        case numbered(String, String)
        case table([[String]])
        case code(String)
        case rule
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            ForEach(Array(Self.parse(text).enumerated()), id: \.offset) { _, b in view(b) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
    }

    @ViewBuilder func view(_ b: Block) -> some View {
        switch b {
        case .heading(let level, let s):
            line(s).font(.system(size: level <= 1 ? size + 2.5 : level == 2 ? size + 1.5 : size + 0.5, weight: .semibold)).padding(.top, 3)
        case .paragraph(let s):
            line(s).font(.system(size: size)).lineSpacing(3)
        case .bullet(let s, let depth):
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                Circle().fill(Theme.dim).frame(width: 3.5, height: 3.5).offset(y: -2.5)
                line(s).font(.system(size: size)).lineSpacing(3)
            }.padding(.leading, CGFloat(depth) * 12)
        case .numbered(let n, let s):
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(n).font(.system(size: size, weight: .medium)).foregroundStyle(Theme.dim).monospacedDigit()
                line(s).font(.system(size: size)).lineSpacing(3)
            }
        case .table(let rows):
            let cols = rows.map(\.count).max() ?? 0
            Grid(alignment: .topLeading, horizontalSpacing: 10, verticalSpacing: 6) {
                ForEach(Array(rows.enumerated()), id: \.offset) { r, row in
                    GridRow {
                        ForEach(0..<cols, id: \.self) { c in
                            line(c < row.count ? row[c] : "").font(.system(size: size - 0.5, weight: r == 0 ? .semibold : .regular)).lineSpacing(2)
                        }
                    }
                    if r < rows.count - 1 { Rectangle().fill(Theme.line).frame(height: 1).gridCellColumns(max(cols, 1)) }
                }
            }
            .padding(8).background(Theme.chip.opacity(0.45), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
        case .code(let s):
            Text(s).font(.system(size: size - 0.5)).foregroundStyle(color.opacity(0.9)).lineSpacing(2)
                .padding(8).frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.chip.opacity(0.6), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
        case .rule:
            HLine().padding(.vertical, 2)
        }
    }

    /// One run of text with inline emphasis and links applied.
    func line(_ s: String) -> Text {
        let cleaned = s.replacingOccurrences(of: "`", with: "")
        let attributed = (try? AttributedString(markdown: cleaned, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(cleaned)
        return Text(attributed).foregroundColor(color)
    }

    static func parse(_ text: String) -> [Block] {
        var out: [Block] = []
        var para: [String] = [], table: [[String]] = [], code: [String]? = nil
        func flush() {
            if !para.isEmpty { out.append(.paragraph(para.joined(separator: " "))); para = [] }
            if !table.isEmpty { out.append(.table(table)); table = [] }
        }
        for raw in text.replacingOccurrences(of: "\r", with: "").components(separatedBy: "\n") {
            let t = raw.trimmingCharacters(in: .whitespaces)
            if t.hasPrefix("```") {
                if let c = code { out.append(.code(c.joined(separator: "\n"))); code = nil } else { flush(); code = [] }
                continue
            }
            if code != nil { code!.append(raw); continue }
            if t.isEmpty { flush(); continue }
            if t.hasPrefix("|") && t.hasSuffix("|") && t.count > 1 {
                if !para.isEmpty { flush() }
                let cells = t.dropFirst().dropLast().components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
                // the |---|---| line under the header carries no content
                if !cells.allSatisfy({ !$0.isEmpty && $0.allSatisfy { "-: ".contains($0) } }) { table.append(cells) }
                continue
            }
            if !table.isEmpty { flush() }
            if t.allSatisfy({ "-*_ ".contains($0) }) && t.filter({ $0 != " " }).count >= 3 { flush(); out.append(.rule); continue }
            let hashes = t.prefix { $0 == "#" }.count
            if (1...6).contains(hashes), t.dropFirst(hashes).first == " " {
                flush()
                out.append(.heading(hashes, t.dropFirst(hashes).trimmingCharacters(in: CharacterSet(charactersIn: "# "))))
                continue
            }
            if let mark = t.first, "-*•".contains(mark), t.dropFirst().first == " " {
                flush()
                out.append(.bullet(t.dropFirst(2).trimmingCharacters(in: .whitespaces), min(3, raw.prefix { $0 == " " || $0 == "\t" }.count / 2)))
                continue
            }
            let digits = t.prefix { $0.isNumber }
            let rest = t.dropFirst(digits.count)
            if !digits.isEmpty, digits.count <= 3, let sep = rest.first, ".)".contains(sep), rest.dropFirst().first == " " {
                flush()
                out.append(.numbered("\(digits).", rest.dropFirst(2).trimmingCharacters(in: .whitespaces)))
                continue
            }
            para.append(t)
        }
        if let c = code { out.append(.code(c.joined(separator: "\n"))) }
        flush()
        return out
    }
}
