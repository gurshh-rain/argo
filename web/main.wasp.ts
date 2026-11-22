import { action, api, app, page, query, route } from "@wasp.sh/spec";
import { LandingPage } from "./src/LandingPage" with { type: "ref" };
import { ConsolePage } from "./src/ConsolePage" with { type: "ref" };
import {
  getDashboard,
  startTask,
  sendFollowup,
  approveRun,
  transcribeAudio,
  speakStatus,
} from "./src/operations" with { type: "ref" };
import { voiceStatusHook, voiceInstructHook } from "./src/hooks" with { type: "ref" };

export default app({
  name: "argo",
  wasp: { version: "^0.26.1" },
  title: "Argo",
  head: [
    "<link rel='icon' href='/favicon.ico' />",
    "<meta name='viewport' content='width=device-width, initial-scale=1, viewport-fit=cover' />",
    "<meta name='theme-color' content='#000000' />",
  ],
  spec: [
    route("LandingRoute", "/", page(LandingPage)),
    route("ConsoleRoute", "/app", page(ConsolePage)),

    query(getDashboard),
    action(startTask, { entities: ["VoiceCommand"] }),
    action(sendFollowup, { entities: ["VoiceCommand"] }),
    action(approveRun),
    action(transcribeAudio),
    action(speakStatus),

    // Server tools the ElevenLabs phone agent calls during a call.
    api("POST", "/hooks/voice/status", voiceStatusHook),
    api("POST", "/hooks/voice/instruct", voiceInstructHook),
  ],
});
