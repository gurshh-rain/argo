# Argo voice capabilities

[Call user skill](functions/01_call_skill/SUBPLAN.md) replaces the larger provider migration for this demo: the current agent runs the existing phone program and receives its result directly.

The skill remains inside orchestrator/src so the existing macOS build includes it automatically. Argo work prompts point agents to it when phone questions are enabled. The parent maintains progress, prompt integration, setup and publication; the skill owner maintains the skill instructions.

[Mac voice input](functions/02_mac_voice_input/SUBPLAN.md) adds recording to the native composer, reuses ElevenLabs transcription, and fills the draft for manual review. The user edits the API key in ~/.argo/.env; no key entry interface is requested.
