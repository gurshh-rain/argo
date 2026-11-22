# Phone skill flow

Argo work prompt → call-user/SKILL.md → temporary question file → existing manual_call.py → Twilio call → TRANSCRIPT in command output → current agent continues.

The helper passed independent synthetic checks and one deliberate live call returned a transcript, confirmed by the user. The phone backend remains a separate existing local installation.

Mac voice input: native microphone button → private temporary recording → existing voice/stt endpoint → ElevenLabs → composer draft → user reviews and sends. Implementation and acceptance are tracked in [its subplan](functions/02_mac_voice_input/SUBPLAN.md).
