# Argo

Your AI coding team on Mac. Give it one high-level task; it plans the work, routes each
subtask to the coding CLI and model that suits it, runs independent subtasks in parallel in isolated
git worktrees, merges, checks, reviews and reports. Check on it, or redirect it, from your phone's browser.

## Demo

[![Argo demo: the first 30 seconds, looping. Click for the full video.](.github/assets/demo.gif)](web/public/media/argo.mp4)

▶ [Watch the full video](web/public/media/argo.mp4) (1 min 54 s, the same film shown on the website)

```
mac/            Native macOS app (SwiftUI, cmux-style: vertical run tabs, split agent panes, notification rings)
orchestrator/   Local daemon (Node, zero dependencies): planning, routing, worktrees, shared record
web/            Wasp app: landing page + phone console (start tasks, send follow-ups, approve plans)
```

## Run it

Requirements: macOS 14+, Node 24+, git, and at least one of `claude`, `codex`, `devin` on your PATH.

```sh
mac/build.sh && open mac/build/Argo.app      # starts the orchestrator itself
```

Choose a project folder (a git repository), type a task, review the plan, click any agent label to
override the agent, model or reasoning level for that subtask, then **Approve & run**.

**Settings** also has the appearance (System, Light or Dark) and **Check for Updates**, which compares the
installed version with the latest GitHub release and offers the DMG for this Mac when a newer one exists.

Phone:

```sh
npm i -g @wasp.sh/wasp-cli@0.26.1
cd web && wasp install && wasp db migrate-dev
./tunnel.sh          # needs cloudflared, or Tailscale running; prints the phone address
./dev.sh             # or: local only, http://localhost:4318
```

On the phone: open the address and go to /app. There is no login: anyone who can reach the address can
control your agents, so keep it on localhost or a private network (Tailscale).

## Ollama

Argo can also give subtasks to open models served by [Ollama](https://ollama.com), running on your
Mac or in Ollama's cloud (model names ending in `-cloud`). Ollama serves models rather than acting as
an agent, so Claude Code runs as the harness that edits files and runs commands, pointed at your
Ollama server; this is what `ollama launch claude` does. You therefore need both Ollama running and
Claude Code installed.

- Models come from your Ollama server (`ollama list`). Pull one, e.g. `ollama pull qwen3-coder`, or
  sign in to Ollama for cloud models. A different server: set `OLLAMA_HOST`.
- Difficulty picks the model by size: the smallest for easy subtasks, the largest for hard ones.
  Pin one in Settings, or name it in the task ("use gemma4:31b-cloud").
- The planner only chooses Ollama when you ask for it; you can also make it the default CLI in
  Settings or pick it per subtask.

## How it works

- **Orchestration.** The lead CLI produces a plan (subtasks, dependencies, an agent/model/reasoning
  choice with a reason for each). Subtasks whose dependencies are met run concurrently, up to the
  parallel limit. Each finished subtask is committed and merged into the run's integration branch
  `argo/<run>/main`; if a merge conflicts, the agent that produced it is asked to resolve it.
  Then checks run (configured, or detected from the repo), a different agent reviews the result, and
  the report lists what is done and what still needs you. Nothing touches your checkout until you
  click **Merge into <branch>**.
- **Shared record.** `<project>/.argo/` holds `state.json` and `MEMORY.md`: goal, constraints,
  follow-ups, decisions, each subtask's status, agent, model and changed files. Every agent gets it in
  its prompt and can re-read the live file; agents record decisions in `.argo/notes/`, which the
  orchestrator folds into the record. The directory is excluded via `.git/info/exclude`.
- **Staying current.** A teammate may have pushed since you last pulled. A run fetches and merges the newest
  remote commits into its integration branch before it plans, again before the checks, and once more when
  you click Merge (a conflict goes to the lead agent; your own checkout is never touched). The
  **Worktree** button opens Claude, Codex, Devin or a shell in a fresh worktree (`argo/wt/<name>`) started
  from the latest remote code, or puts another agent into an existing one. Each worktree tracks the remote
  branch; the app checks the remote every minute, shows "N behind" on that worktree's panes, and
  **Pull latest** merges new pushes in without losing an agent's uncommitted work.
- **Model controls.** Settings: default CLI (or Auto), a model per CLI, reasoning level, parallelism,
  whether plans need approval. Per-subtask override from the pane header. Every pane, the record and
  the phone show which agent and model did the work and whether it was an override.
- **Attention.** A failed agent, a blocked command, four minutes of silence, a merge conflict or a
  finished run raises a notification (blue ring and macOS notification).
  A follow-up while a subtask is blocked goes to that subtask ("approve" lets a blocked command run);
  otherwise it becomes a new subtask on the run.

## Tests

```sh
cd orchestrator && npm test     # scripted agent: planning, parallelism, isolation, override, follow-up, failure + retry
cd web && wasp compile
```

## Packaging a release

```sh
mac/package.sh 0.1.3      # builds, then writes the zip, both DMGs, SHA256SUMS.txt and latest.json to mac/dist/
```

The app is ad-hoc signed, not notarized, so on another Mac the first launch needs right-click → Open
(or `xattr -dr com.apple.quarantine /Applications/Argo.app`). It is built for the architecture of the
Mac that packages it, and needs Node 24+ and at least one coding CLI on the user's PATH.

Publish it as a GitHub release on the tag `v<version>` and attach everything in `mac/dist/`: both DMGs,
the zip, `SHA256SUMS.txt` and `latest.json`.

The Windows build goes on the same release. Set the version in `windows/package.json`, run
`cd windows && npm run package` (see `windows/README.md` for packaging from a Mac), and attach
`windows/dist/Argo-win32-x64.zip` and `windows/dist/latest-win.json`. The website's Windows button links to
`releases/latest/download/Argo-win32-x64.zip`, and the Windows app updates itself from `latest-win.json`,
signed with the same key.

- The website's Download buttons link to `releases/latest/download/Argo.dmg`, which GitHub redirects to
  the `Argo.dmg` in the newest release, so the site needs no change per version.
- The app updates itself from `releases/latest/download/latest.json`. It checks at launch and every
  six hours, shows **Update to x.y.z** at the bottom of the sidebar, and on click downloads the DMG,
  installs it in place and reopens. A release without `latest.json` is invisible to installed copies.

### Update signing

`latest.json` carries an Ed25519 signature over the DMG. The app only installs an image whose signature
matches the public key compiled into `mac/Sources/Argo/Update.swift`, so a tampered download is refused.

- The private key is at `~/.argo-signing/ed25519.key` on the Mac that cut the first signed release. It is
  not in the repository. Back it up; whoever packages a release needs it (or `ARGO_PRIVATE_KEY_FILE`).
- Without the key `mac/package.sh` still builds but writes no `latest.json`.
- If the key is lost, generate a new one with `swift mac/argo-sign.swift keygen` and put its public key in
  `Update.swift`. Copies already installed trust only the old key and must be updated by hand once.
