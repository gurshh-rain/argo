import { action, app, page, query, route } from "@wasp.sh/spec";
import { LandingPage } from "./src/LandingPage" with { type: "ref" };
import { ConsolePage } from "./src/ConsolePage" with { type: "ref" };
import {
  getDashboard,
  startTask,
  sendFollowup,
  approveRun,
} from "./src/operations" with { type: "ref" };

export default app({
  name: "argo",
  wasp: { version: "^0.26.1" },
  title: "argo - ai orchestration",
  head: [
    "<link rel='icon' type='image/png' href='/argo.png' />",
    "<meta name='viewport' content='width=device-width, initial-scale=1, viewport-fit=cover' />",
    "<meta name='theme-color' content='#111214' />",
    "<meta name='description' content='Bring Claude Code, Codex, and Devin together. Plan, build, and review in one native Mac workspace.' />",
  ],
  spec: [
    route("LandingRoute", "/", page(LandingPage)),
    route("ConsoleRoute", "/app", page(ConsolePage)),

    query(getDashboard),
    action(startTask, { entities: ["VoiceCommand"] }),
    action(sendFollowup, { entities: ["VoiceCommand"] }),
    action(approveRun),
  ],
});
