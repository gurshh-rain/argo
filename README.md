# Argo

Your AI coding team, controlled by voice. Give it one high-level task; it plans the work, routes each
subtask to the coding CLI and model that suits it, runs independent subtasks in parallel in isolated
git worktrees, merges, checks, reviews and reports. Check on it, or redirect it, by speaking from your phone.

```
mac/            Native macOS app (SwiftUI, cmux-style: vertical run tabs, split agent panes, notification rings)
orchestrator/   Local daemon (Node, zero dependencies): planning, routing, worktrees, shared record, voice, calls
web/            Wasp app: landing page + authenticated phone console (voice in, transcript confirm, spoken status)
```

## Run it

Requirements: macOS 14+, Node 24+, git, and at least one of `claude`, `codex`, `devin` on your PATH.

```sh
mac/build.sh && open mac/build/Argo.app      # starts the orchestrator itself
```

Choose a project folder (a git repository), type a task, review the plan, click any agent label to
override the agent, model or reasoning level for that subtask, then **Approve & run**.

For voice input in the native Mac app, put `ELEVENLABS_API_KEY` in `~/.argo/.env` and restart the background service. Click the microphone beside the task input, allow microphone access, speak, then click stop. ElevenLabs fills the recognized text into your existing draft for review; use the normal send button when ready. Cancel discards the recording. Recordings are limited to two minutes and temporary audio is removed after capture. No separate dictation app is needed.

Phone:

```sh
npm i -g @wasp.sh/wasp-cli@0.26.1
cd web && wasp install && wasp db migrate-dev
./tunnel.sh          # needs cloudflared, or Tailscale running; prints the phone address
./dev.sh             # or: local only, http://localhost:4318
```

On the phone: open the address and go to /app. There is no login: anyone who can reach the address can
control your agents, so keep it on localhost or a private network (Tailscale).

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
  finished run raises a notification (blue ring and macOS notification). Agents ask phone questions through the call-user skill.
  A follow-up while a subtask is blocked goes to that subtask ("approve" lets a blocked command run);
  otherwise it becomes a new subtask on the run.
- **Voice.** The phone records audio, ElevenLabs Scribe transcribes it, and the transcript is shown
  and editable before it is sent as a new task or a follow-up. **Speak status** reads a summary with
  ElevenLabs TTS. Without an ElevenLabs key the phone's built-in speech recognition and voice are used.

## Ask the developer by phone

For the hackathon demo, coding agents use the [call-user skill](orchestrator/src/skills/call-user/SKILL.md): write one question, run the existing local phone script, read `TRANSCRIPT`, and continue the same task. Argo includes the skill path in agent work prompts when **Call me when an agent needs attention** is enabled.

The existing phone backend is installed at `/Users/gz/Documents/codevisor-call-demo` on Ricardo's Mac. Set `ARGO_PHONE_DEMO_DIR` before launching Argo to use another installation. This demo needs that backend and its configured Twilio account; cloning Argo alone does not install them. See [usage](docs/phone-call-usage-plan.md).

When phone questions are enabled, background coding workers receive access to that backend's runtime directory. Background Codex workers also receive outbound network access for the call while keeping the workspace sandbox. Interactive terminals keep their existing CLI permissions; use Run in background if those permissions block the phone helper. Turning the setting off omits these phone additions. Attention notifications no longer automatically initiate a second ElevenLabs call.

## Optional ElevenLabs phone integration

Put keys in `~/.argo/.env` (see `orchestrator/.env.example`) and restart the app.

Outbound calls use ElevenLabs Agents with a Twilio number
(`POST /v1/convai/twilio/outbound-call`). Create the agent in the ElevenLabs dashboard:

1. Import your Twilio number under Phone Numbers; put its id in `ELEVENLABS_PHONE_NUMBER_ID`.
2. Create an agent; put its id in `ELEVENLABS_AGENT_ID`. First message: `{{event_message}}`.
   System prompt: it is the developer's coding-team dispatcher; `{{status_summary}}` is the current
   state; it should relay the developer's decision with the `instruct` tool and confirm what it sent.
3. Add two webhook tools, each sending header `x-argo-secret: <ARGO_HOOK_SECRET from web/.env.server>`:
   - `get_status` → `POST <phone address>/_server/hooks/voice/status`, body `{ "run_id": "{{run_id}}" }`
   - `instruct` → `POST <phone address>/_server/hooks/voice/instruct`, body `{ "run_id": "{{run_id}}", "instruction": "<what the developer said>" }`
4. In the Mac app's Settings, enter your phone number and enable calls.

## Direct Twilio phone plan

See the [phone skill usage guide](docs/phone-call-usage-plan.md) for the simple direct Twilio demo. The skill runs the existing phone program and returns text to its calling agent; it does not require a new provider API or callback routing inside Argo.

## Tests

```sh
cd orchestrator && npm test     # scripted agent: planning, parallelism, isolation, override, follow-up, failure + retry
cd web && wasp compile
```
