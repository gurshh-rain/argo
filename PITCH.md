# Argo: pitch

**Your AI coding team, controlled by voice.**
Give Argo one task. It splits the work across Claude Code, Codex and Devin on your Mac, runs them in
parallel without collisions, checks the result, and calls your phone when it needs you.

---

## The 30-second version

Developers don't write most of their code anymore. They manage agents. But managing three agents means
three terminals, three contexts to repeat, merge conflicts between them, and checking back every few
minutes in case one got stuck on a permission prompt.

Argo is a Mac app that acts as the engineering manager. You give it one high-level task. It plans the
subtasks, picks the right agent and model for each one, runs independent work in parallel in isolated
git worktrees, merges, runs your tests, has a different agent review the result, and tells you what's
done and what isn't. When an agent errors, gets blocked, or finishes, Argo calls you. You answer, say
"tell Codex to back up the database first," and it relays the instruction to the right agent.

Your agents keep working. You keep living your life. When they need you, they call you.

---

## The problem

1. **Agents need babysitting.** They stop on permission prompts, loop on failing tests, or go quiet.
   You find out 40 minutes later when you check the terminal.
2. **Multiple agents collide.** Two agents in one checkout overwrite each other. Running them
   separately means you're the one merging.
3. **Context doesn't travel.** Each CLI starts from zero. You re-explain the goal, the constraints and
   what the other agent already decided.
4. **Picking the right agent is manual.** Claude Code is better at some things, Codex at others, and a
   cheap fast model is fine for boilerplate. Nobody wants to make that call ten times a task.
5. **You're tied to the desk.** All of this assumes you're staring at a screen.

## The solution

| What you need | What Argo does |
|---|---|
| One task in, finished work out | Lead agent writes a plan: subtasks, dependencies, and an agent / model / reasoning level for each, with a reason |
| Parallel without chaos | Each subtask gets its own git worktree and branch; finished work merges into `argo/<run>/main`; conflicts go back to the agent that caused them |
| No repeated context | `.argo/state.json` + `MEMORY.md`: goal, constraints, decisions, task status, changed files. Every agent reads it and writes decisions back |
| Control over cost and quality | Default CLI, model and reasoning level, or Auto. Override any subtask with one click. Every pane shows which agent and model did the work |
| Trust before it touches your code | Tests run, a *different* agent reviews, and nothing reaches your branch until you click Merge |
| Freedom from the desk | Phone console: speak a task, see the transcript before it sends, hear a spoken status. Argo phones you (ElevenLabs + Twilio) on errors, blocks, stalls and completions |

## Demo (what judges see, ~2 min)

1. On the Mac: pick a repo, type *"Add a /health endpoint with tests and update the README."*
2. Argo shows the plan: endpoint → Codex, tests → Claude Code (runs in parallel), docs → cheap fast model.
3. Click the docs subtask label and **override** it to Claude Code with a different model. The pane
   header now shows "override."
4. **Approve & run.** Two panes run side by side in separate worktrees. Both write to the shared record.
5. A test fails / a command is blocked. The ring turns blue and **the phone rings**:
   *"Your Codex agent hit a failing test on the health endpoint. Want me to have it fix it or skip?"*
6. Answer by voice: *"Tell Codex to fix it and add a timeout test."* It lands on the right subtask.
7. Checks pass, Claude reviews Codex's work, report lists done / needs attention. Click **Merge**.

---

## Target market

**Who feels it most today (beachhead):**
- **Solo developers, indie hackers and founders** already paying for both Claude Code and Codex (or
  Cursor/Devin) and running 2+ agents at once. They're on $100–200/month plans, ship alone, and have
  no team to delegate the coordination to. Argo is their team lead.
- **Seed to Series A startups, 2–15 engineers**, where every engineer is told to "use agents" and each
  one is improvising their own multi-terminal setup.

**Next:**
- **Engineering teams at mid-size companies** that want a shared record of what agents did, which
  model did it, and what it cost: audit and spend control.
- **Agencies and contractors** juggling multiple client repos at once.

**Why this market is real:**
- Coding agents are now the default way new code gets written at startups, and the CLIs (Claude Code,
  Codex, Devin, Gemini CLI) are multiplying, not consolidating. Every new agent makes the coordination
  problem worse and makes a neutral layer above them more valuable.
- Developers already pay real money for agents. The person spending $200+/month on agent subscriptions
  will pay a fraction of that to get more out of them and stop babysitting.
- Rough sizing: there are tens of millions of professional developers worldwide, and a fast-growing
  slice of them pay for at least one coding agent. If even 1M of them run multiple agents and pay
  $20/month, that's a $240M/year opportunity, before team and enterprise pricing.

## How we make money

| Plan | Price | For |
|---|---|---|
| Free | $0 | Local orchestration, 2 parallel agents, shared record, desktop notifications |
| Pro | $20/mo | Unlimited parallelism, phone console, voice status, outbound phone calls, auto-routing |
| Team | $40/seat/mo | Shared records across a team, spend and model dashboards, audit log, policy (which agents/models are allowed where) |

Users bring their own agent subscriptions. We don't resell tokens, so margins are software margins.
Phone minutes are the only real variable cost and are capped per plan.

## Competition and why we win

| | Examples | What they lack |
|---|---|---|
| Single-vendor agents | Claude Code, Codex, Devin, Cursor background agents | Locked to one vendor's models. No reason to route work to a competitor |
| Multi-agent terminals / worktree managers | cmux, Conductor, Claude Squad, Vibe Kanban | You still plan, assign, merge and check. No orchestration, no shared memory, no voice |
| Cloud agent platforms | Devin, Codex cloud, Factory | Your code leaves your machine; limited to their agent |

**Argo's edge:**
1. **Vendor-neutral.** It routes across CLIs on strengths, speed and cost. Model companies won't build
   the thing that sends work to their competitors.
2. **Orchestration, not just tabs.** Plan → parallel run → merge → checks → cross-agent review → report.
3. **Shared memory** that makes agents interchangeable mid-task.
4. **It reaches you.** Phone calls and voice turn "check the terminal" into "answer when it rings."
5. **Local-first.** Agents run on your Mac with your keys. Your code stays on your machine.

**Moat over time:** the routing data. Every run records which agent and model handled what kind of
subtask, and whether it passed checks and review. That becomes the best dataset anywhere on "which
agent is actually good at what," and our Auto mode gets better with every run.

## Go-to-market

1. **Open-source the orchestrator, sell the convenience.** The daemon is free and hackable; the Mac app,
   phone calls and team features are paid.
2. **Launch where agent power users already are:** X/Twitter dev community, Hacker News, r/ClaudeAI,
   r/ChatGPTCoding, Claude Code and Codex Discords. The demo is a phone ringing because a coding agent
   needs you. That clip shares itself.
3. **Founder-led sales to startups** where an eng lead wants visibility into what agents are doing.
4. **Integrations as distribution:** each new CLI we support (Gemini CLI, Aider, Amp, OpenCode) is a
   launch post to that tool's community.

## Why now

- Coding agents crossed the line from autocomplete to running for 30+ minutes on their own. The
  bottleneck moved from writing code to supervising agents.
- There are now several strong agent CLIs with different strengths. A year ago there was one choice.
- Voice AI (ElevenLabs Agents, Scribe) is good enough that a phone call with your codebase feels
  natural, not like an IVR menu.

## What's built (this hackathon)

- **Native macOS app** (SwiftUI): vertical run tabs, split agent panes, notification rings, settings,
  per-subtask override.
- **Orchestrator daemon** (Node, zero dependencies): planner, router, git worktree isolation,
  merge + conflict resolution, checks, cross-agent review, shared record, attention detection.
- **Phone console** (Wasp): voice in via ElevenLabs Scribe, editable transcript before submit, spoken
  status via ElevenLabs TTS, follow-ups routed to the blocked subtask.
- **Outbound calls** via ElevenLabs Agents + Twilio, with `get_status` and `instruct` tools so the call
  can read state and send instructions.
- Tests covering planning, parallelism, isolation, override, follow-up and failure + retry.

## Roadmap

- **Next 30 days:** phone login (passkeys), more CLIs (Gemini CLI, Aider, Amp), cost tracking per subtask.
- **Next 90 days:** cloud runners so long jobs and test suites keep going when the laptop sleeps;
  learned auto-routing from run history; Slack and Linear as task inputs.
- **Then:** team workspaces with a shared record across engineers, approval policies, and spend controls.

## The ask

We're looking for early users who already run more than one coding agent. Try it on a real repo, tell
us where it breaks, and let us call you when your agents need you.
