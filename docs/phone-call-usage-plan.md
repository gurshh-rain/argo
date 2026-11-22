# Phone Call Usage and Agent Integration Plan

## Goal

Our AI sends a question, the phone calls the developer and reads it aloud, the developer answers, and the AI receives the answer as text in the original task.

```text
AI question → phone call → spoken answer → transcript → original AI task
```

This branch contains a usage and integration plan. The direct Twilio adapter described below has not been added to Argo yet.

## What exists today

1. Argo already raises attention events and can initiate calls through ElevenLabs Agents and a linked Twilio number. See [voice.ts](../orchestrator/src/voice.ts) and [engine.ts](../orchestrator/src/engine.ts).
2. Argo already accepts text instructions for a run through `POST /api/runs/<run_id>/instruct`. See [server.ts](../orchestrator/src/server.ts).
3. A separate Python demo on Ricardo's Mac can make a direct Twilio call, read editable text, receive a speech transcript, and reuse its background Cloudflare tunnel. Its location is `/Users/gz/Documents/codevisor-call-demo`. These Python files are not included in this repository.
4. The missing piece is the adapter that connects that direct Twilio flow to our AI and preserves the originating run and task.

The direct Twilio path uses Twilio speech recognition and does not need an ElevenLabs key. It is a separate option from the existing ElevenLabs call path documented in the [README](../README.md#elevenlabs-and-phone-calls).

## Use the local demo now

These steps apply to the existing installation on Ricardo's Mac. Cloning Argo alone does not install this demo.

### 1. Check the local prerequisites

The demo needs its existing `.venv`, the Python `twilio` package, `cloudflared`, and a Twilio account able to call the configured recipient. Keep the Mac awake and connected during use.

The demo reads these keys from its own local `.env`:

```dotenv
TWILIO_ACCOUNT_SID=YOUR_ACCOUNT_SID
TWILIO_AUTH_TOKEN=YOUR_AUTH_TOKEN
TWILIO_TO=YOUR_VERIFIED_PLUS_ONE_NUMBER
```

Use the actual configured values locally. The current demo accepts North American numbers beginning with `+1`. Its manual transcription path does not send a `From` field; that behavior was verified with the current trial account and is not a promise about every Twilio account.

Argo currently reads integration secrets from the process environment or `~/.argo/.env`. That is a different configuration location. Adding Twilio values there alone does not enable the proposed adapter.

### 2. Edit the question and preview it

Open the demo's `prompt.txt`, replace the question, and save it as UTF8 plain text. For example:

```text
The login task needs your decision. Should I use email login or Google login? Please answer, then pause for three seconds.
```

The current prompt limit is 1 to 1000 characters. The spoken question and recognition default to English. Editing the question does not change the recognition language.

Preview without a call or network access:

```sh
cd /Users/gz/Documents/codevisor-call-demo
.venv/bin/python manual_call.py --dry-run
```

### 3. Prepare the connection

```sh
.venv/bin/python manual_call.py --check-connection
```

This checks connectivity without reading account credentials or placing a call. A new tunnel may spend around a minute or more waiting for DNS. Run the command again after it succeeds: `Tunnel reused` and the same session identifier confirm reuse.

Local connection checks previously measured about 81 seconds for a new tunnel and under one second for reuse. Those measurements describe connection preparation, not time until the phone rings or future performance guarantees.

### 4. Make one call and read the answer

Double click `手动电话转写.command`, or run:

```sh
.venv/bin/python manual_call.py
```

Keep the terminal open. Answer the phone, listen to the question, speak, and pause for three seconds. Success prints `TRANSCRIPT:` followed by your words and saves a text record at `transcripts/<CallSid>.json`. This is the result our AI adapter will consume. The script does not automatically deliver it to Argo today.

The existing Gather configuration requests speech recognition and uses a three second pause. Twilio supplies the recognized text in `SpeechResult` through the callback. See the [Gather reference](https://www.twilio.com/docs/voice/twiml/gather#action).

### 5. Stop the background tunnel when finished

Double click `关闭电话通道.command`, or run:

```sh
.venv/bin/python manual_call.py --stop-tunnel
```

Closing a completed call's terminal leaves the tunnel available for reuse. Explicitly stopping it, rebooting, or losing the tunnel process means the next start must establish a connection again. Quick Tunnels are temporary and have no uptime guarantee. See [Cloudflare's documentation](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

## Integrate it with our AI

### Step 1. Make the phone component available to Argo

Bring the reviewed Python source and dependency instructions into a dedicated component, or configure an explicit path to the existing installation for the first local demo. Include a sample configuration with placeholders. Keep real credentials, transcript records, tunnel state, and the virtual environment outside version control.

Keep the existing ElevenLabs provider available. Add explicit selection of the direct Twilio provider and update the integration availability check in [config.ts](../orchestrator/src/config.ts); it currently requires the three ElevenLabs call credentials.

### Step 2. Define a `call_user` operation

The orchestrator should own this operation. Register it with the AI runtime we use; documenting its name does not automatically make it a tool inside a coding CLI.

Proposed input:

```json
{
  "run_id": "run_example",
  "task_id": "t1",
  "message": "Should I use email login or Google login?"
}
```

Use the configured developer number. Give each request its own prompt file and call identifier so an AI question does not overwrite the manual `prompt.txt`. Reuse the existing tunnel and invocation lock. Submit one phone call per request.

### Step 3. Track the call while the developer answers

Store the association between the request, run, task, and actual Twilio Call SID. A proposed start endpoint can return a call identifier immediately; a status endpoint can return the eventual result. These endpoints are planned, not existing Argo routes:

```text
POST /api/phone/calls
GET /api/phone/calls/<call_id>
```

Keep management routes behind the existing local Argo authentication. The public tunnel should expose only the phone instruction and callback service, not the orchestrator's management API.

### Step 4. Return the transcript to the original task

After accepting the callback for the bound call, return a result such as:

```json
{
  "call_id": "call_example",
  "run_id": "run_example",
  "task_id": "t1",
  "status": "completed",
  "text": "Use Google login."
}
```

For an AI waiting on `call_user`, deliver this as its tool result so it can continue. For an Argo attention event, use the existing `engine.instruct(run, text, 'phone-call')` path once. Choose one delivery path for each request so the answer does not also create a duplicate followup.

The existing `engine.instruct` chooses the latest unresolved blocked task in that run; it does not accept an explicit task identifier. Before using it, verify that the blocked task still matches the call's task. Add explicit routing or leave the result pending if that match cannot be established. Do not silently deliver the answer to a different task.

### Step 5. Handle results without duplicate calls

Return explicit states for `completed`, `no_speech`, `timeout`, `failed`, and `unknown`. Empty speech must not become an instruction. Preserve a result for later retrieval if the AI disconnects. Repeated callbacks or result retrieval must not deliver the same answer twice.

A call creation request with an uncertain outcome must remain `unknown` until reconciled; do not automatically dial again. Keep Twilio signature validation as the default. The local demo's explicit trial compatibility mode uses a temporary callback capability and matching account and call identity; it is not equivalent to a validated Twilio signature. See [Twilio request security](https://www.twilio.com/docs/usage/security).

## Acceptance plan

1. Use synthetic callbacks to verify that a message becomes the spoken question, and that returned text belongs to the correct run, task, and call.
2. Verify empty speech, timeout, uncertain call creation, duplicate callbacks, and simultaneous requests without extra dialing or duplicate delivery.
3. Check that two connection preparations reuse the same tunnel and that the stop command affects only this component.
4. Make one deliberate live call from the AI, answer it, and verify that the text reaches the original task and the AI continues from that answer.
5. Record local checks separately from the live result. A fast connection check does not prove successful calling, recognition, or delivery to an AI.

The first complete milestone is one question and one spoken answer delivered as text to the original AI task. Audio recording, continuous voice conversation, and ElevenLabs transcription are not required for this milestone.
