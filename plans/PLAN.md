# Phone skill demo plan

[Call user skill](functions/01_call_skill/SUBPLAN.md) is the only implementation unit. It replaces the larger provider migration for this demo: the current agent runs the existing phone program and receives its result directly.

The skill remains inside orchestrator/src so the existing macOS build includes it automatically. Argo work prompts point agents to it when phone questions are enabled. The parent maintains progress, prompt integration, setup and publication; the skill owner maintains the skill instructions.
