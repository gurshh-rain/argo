import SwiftUI

/// Right panel → Usage: for the current workspace, which agent and model did what, how often each
/// succeeded, and what it cost, grouped by agent with one row per model.
struct UsagePanel: View {
    @EnvironmentObject var store: Store

    /// A call plus the run it belongs to, so a subtask call can show the subtask's title.
    struct Entry: Hashable { let call: UsageCall; let run: Run }

    var entries: [Entry] {
        store.runs(in: store.project).flatMap { run in
            (run.usage ?? Self.legacy(run)).map { Entry(call: $0, run: run) }
        }
    }

    /// Runs saved before calls were recorded: one attempt per finished subtask, with the cost it kept.
    static func legacy(_ run: Run) -> [UsageCall] {
        run.tasks.compactMap { t in
            guard let a = t.ranWith, let agent = a.agent, ["done", "failed", "needs_attention"].contains(t.status) else { return nil }
            return UsageCall(at: t.startedAt ?? run.createdAt, ms: max(0, (t.finishedAt ?? 0) - (t.startedAt ?? 0)), role: "task", taskId: t.id,
                             agent: agent, model: a.model ?? "", ok: t.status == "done", costUsd: t.costUsd, tokensIn: nil, tokensOut: nil, terminal: nil)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 4) {
                RightTabs()
                Spacer()
                Button { store.filesHidden = true } label: { Image(systemName: "sidebar.right") }
                    .buttonStyle(IconButton()).font(.system(size: 12)).foregroundStyle(Theme.dim).help("Hide panel")
            }
            .padding(.horizontal, 8).frame(height: 30)
            HLine()
            ScrollView {
                let all = entries
                VStack(alignment: .leading, spacing: 18) {
                    if all.isEmpty {
                        Text("Nothing yet. Once a task runs in \(store.name(of: store.project)), each agent and model it used shows up here with its success rate and cost.")
                            .font(.system(size: 12)).foregroundStyle(Theme.dim)
                    } else {
                        totals(all.map(\.call))
                        ForEach(agents(all), id: \.self) { agent in agentSection(agent, all.filter { $0.call.agent == agent }.map(\.call)) }
                        recent(all)
                        Text("Costs are what each CLI reports. Codex and Devin report none, so their tokens are shown instead; local Ollama models are free. Argo uses this record to route later tasks in this workspace.")
                            .font(.system(size: 10.5)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .background(Theme.pane)
    }

    /// Agents ordered by what they cost, then by how much they ran.
    func agents(_ all: [Entry]) -> [String] {
        Dictionary(grouping: all.map(\.call), by: \.agent)
            .sorted { (cost($0.value) ?? 0, $0.value.count) > (cost($1.value) ?? 0, $1.value.count) }
            .map(\.key)
    }

    // MARK: sections

    func totals(_ calls: [UsageCall]) -> some View {
        HStack(spacing: 0) {
            stat(cost(calls).map(money) ?? "-", "spent")
            stat("\(calls.count)", calls.count == 1 ? "agent call" : "agent calls")
            stat(rate(calls), "succeeded")
        }
        .padding(.vertical, 10)
        .background(Theme.chip.opacity(0.5), in: RoundedRectangle(cornerRadius: 7))
    }

    func stat(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.system(size: 16, weight: .semibold)).monospacedDigit().foregroundStyle(Theme.text)
            Text(label).font(.system(size: 10.5)).foregroundStyle(Theme.dim)
        }.frame(maxWidth: .infinity)
    }

    func agentSection(_ agent: String, _ calls: [UsageCall]) -> some View {
        let models = Dictionary(grouping: calls, by: \.model).sorted { (cost($0.value) ?? 0, $0.value.count) > (cost($1.value) ?? 0, $1.value.count) }
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(store.agent(agent)?.label ?? agent.capitalized).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(Theme.agent(agent))
                Spacer()
                Text(spend(calls)).font(.system(size: 12, weight: .medium)).monospacedDigit().foregroundStyle(Theme.text)
            }
            ForEach(models, id: \.key) { model, cs in modelRow(agent, model, cs) }
        }
    }

    func modelRow(_ agent: String, _ model: String, _ calls: [UsageCall]) -> some View {
        let ok = calls.filter(\.ok).count
        let byRole = Dictionary(grouping: calls, by: \.role).sorted { $0.value.count > $1.value.count }
            .map { "\($0.value.count) \(Self.roleName($0.key, $0.value.count))" }.joined(separator: ", ")
        return VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(model.isEmpty ? (agent == "codex" ? "configured model" : "default model") : model)
                    .font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.text).lineLimit(1)
                Spacer()
                Text(spend(calls)).font(.system(size: 11.5)).monospacedDigit().foregroundStyle(Theme.dim)
            }
            // success bar: the filled part is the share of calls that succeeded
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.chip)
                    Capsule().fill(Theme.agent(agent)).frame(width: g.size.width * CGFloat(ok) / CGFloat(max(1, calls.count)))
                }
            }.frame(height: 4)
            Text("\(rate(calls)) of \(calls.count) succeeded · \(byRole)\(tokens(calls).map { " · \($0)" } ?? "")")
                .font(.system(size: 10.5)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.leading, 10)
        .overlay(alignment: .leading) { Rectangle().fill(Theme.line).frame(width: 1) }
    }

    func recent(_ all: [Entry]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Who did what").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.dim)
            ForEach(all.sorted { $0.call.at > $1.call.at }.prefix(20), id: \.self) { e in
                let c = e.call
                HStack(alignment: .top, spacing: 7) {
                    Image(systemName: c.ok ? "checkmark.circle.fill" : "xmark.circle.fill")
                        .font(.system(size: 10.5)).foregroundStyle(c.ok ? Theme.green : Theme.red).padding(.top, 2)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(what(e)).font(.system(size: 12)).foregroundStyle(Theme.text).lineLimit(2)
                        Text("\(store.agent(c.agent)?.label ?? c.agent) · \(c.model.isEmpty ? "default model" : c.model)\(c.terminal == true ? " · in a terminal" : "")\(c.ms > 0 ? " · \(duration(c.ms))" : "")")
                            .font(.system(size: 10.5)).foregroundStyle(Theme.agent(c.agent))
                    }
                    Spacer(minLength: 4)
                    Text(c.costUsd.map(money) ?? tokens([c]) ?? "").font(.system(size: 10.5)).monospacedDigit().foregroundStyle(Theme.dim)
                }
            }
        }
    }

    // MARK: wording and numbers

    func what(_ e: Entry) -> String {
        let task = e.run.tasks.first { $0.id == e.call.taskId }?.title
        switch e.call.role {
        case "plan": return "Planned: \(e.run.goal)"
        case "review": return "Reviewed: \(e.run.goal)"
        case "merge": return "Resolved a merge conflict\(task.map { " in \($0)" } ?? "")"
        case "sync": return "Merged a teammate's push into: \(e.run.goal)"
        default: return task ?? e.run.goal
        }
    }
    static func roleName(_ role: String, _ n: Int) -> String {
        let s = n == 1 ? "" : "s"
        switch role {
        case "plan": return "plan\(s)"
        case "review": return "review\(s)"
        case "merge", "sync": return "merge fix\(n == 1 ? "" : "es")"
        default: return "subtask\(s)"
        }
    }
    /// Total dollars across calls that reported a price, or nil when none did.
    func cost(_ calls: [UsageCall]) -> Double? {
        let priced = calls.compactMap(\.costUsd)
        return priced.isEmpty ? nil : priced.reduce(0, +)
    }
    /// Dollars when the CLI reports them, otherwise tokens, otherwise a dash.
    func spend(_ calls: [UsageCall]) -> String { cost(calls).map(money) ?? tokens(calls) ?? "-" }
    func money(_ d: Double) -> String { d == 0 ? "free" : d < 0.01 ? "<$0.01" : String(format: "$%.2f", d) }
    func rate(_ calls: [UsageCall]) -> String { calls.isEmpty ? "-" : "\(Int((Double(calls.filter(\.ok).count) / Double(calls.count) * 100).rounded()))%" }
    func tokens(_ calls: [UsageCall]) -> String? {
        let n = calls.reduce(0) { $0 + ($1.tokensIn ?? 0) + ($1.tokensOut ?? 0) }
        if n == 0 { return nil }
        return n >= 1_000_000 ? String(format: "%.1fM tokens", n / 1_000_000) : n >= 1000 ? String(format: "%.1fk tokens", n / 1000) : "\(Int(n)) tokens"
    }
    func duration(_ ms: Double) -> String {
        let s = Int(ms / 1000)
        return s < 60 ? "\(s)s" : "\(s / 60)m \(s % 60)s"
    }
}
