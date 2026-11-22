# Phone Skill Demo

## What the demo does

The active AI agent asks the developer one question by phone, receives the spoken answer as text, and continues its current task.

```text
Agent → call-user skill → existing phone script → developer answers → TRANSCRIPT → same agent
```

The skill is [call-user/SKILL.md](../orchestrator/src/skills/call-user/SKILL.md). Argo includes its absolute path in work prompts when the existing phone attention setting is enabled. The skill is bundled with the orchestrator source by the existing Mac build script.

There is no separate task routing step: the agent that runs the command receives its output. The existing ElevenLabs phone integration remains optional and separate from this demo.

The phone setting also grants background coding workers access to the configured backend directory; background Codex workers get the outbound network access the call requires. It does not disable the workspace sandbox. Interactive terminals keep their existing CLI permissions; use Run in background if those permissions block the phone helper. Automatic attention notifications do not start a second legacy ElevenLabs call while the agent waits for an answer. The optional legacy call button remains a separate manual action.

## Local setup

The phone backend already exists on Ricardo's Mac at:

```text
/Users/gz/Documents/codevisor-call-demo
```

It needs its existing Python virtual environment, Twilio credentials, recipient number, and cloudflared installation. Keep those values in that backend's local `.env`, outside this repository. Cloning Argo alone does not install the backend or configure a Twilio account.

Use `ARGO_PHONE_DEMO_DIR` to point the skill to another installation. Set it before starting Argo or the coding agent:

```sh
export ARGO_PHONE_DEMO_DIR="/absolute/path/to/codevisor-call-demo"
```

The skill uses the backend's configured recipient. Argo's phone number field does not override this skill's backend configuration.

## Agent usage

1. Give the agent a task and allow phone questions for decisions that need your input. For example: "Build the login page. If you need my choice, use call-user to phone me."
2. The agent reads the skill, writes the question to a private temporary UTF8 file, and invokes the backend with `--prompt-file`.
3. Answer the phone, listen to the question, speak, then pause for three seconds.
4. The command returns `TRANSCRIPT:` and your answer. The agent uses those words in the same task and continues.

The skill uses the Python entrypoint rather than the interactive `.command` launcher. Each question has its own temporary file; it does not overwrite the manual `prompt.txt`.

## Check the connection without calling

```sh
cd /Users/gz/Documents/codevisor-call-demo
.venv/bin/python manual_call.py --check-connection
```

The first tunnel may need about a minute or more for DNS. A subsequent invocation reuses the running tunnel. Connection check timing is not a promise about phone ringing or transcript timing.

## Stop the tunnel

```sh
.venv/bin/python manual_call.py --stop-tunnel
```

Stopping the tunnel or restarting the Mac means the next invocation must establish a connection again. [Cloudflare documents](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) that Quick Tunnel addresses depend on the running process and have no uptime guarantee.

## Result handling

Use only the transcript produced by the current invocation. If an exact JSON record is needed, select the file matching the Call SID printed by that invocation. Do not substitute an older transcript.

Empty speech, busy state, setup failure, timeout or an uncertain call outcome should be reported to the user. Do not automatically dial again. If the command is still running, continue waiting on its existing process session.

Twilio Gather supplies the recognized answer as `SpeechResult`. The backend already handles that callback; the skill consumes its output. See the [official Gather reference](https://www.twilio.com/docs/voice/twiml/gather#action).

## Demo acceptance

1. With a synthetic backend, verify that the agent sends one question, makes one invocation, receives the expected text, and continues without another delivery service.
2. Verify that a failed invocation is reported without an automatic second call.
3. Run the existing Argo tests and validate skill metadata.
4. For a live demonstration, make one deliberate call and confirm that the calling agent receives the spoken answer.

Synthetic results and live phone results are separate evidence. A skill file alone does not prove that a real call was answered.
