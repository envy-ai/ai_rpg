# MainQuestCommand

`/mainquest action=<start|status|check|abandon> [goal="..."] [mode=new|sequel|auto]`

- `start`: starts a main quest (waits for generation) with the optional goal and mode, then replies with its title and premise.
- `status`: developer view of the active main quest, including hidden truth, all stages with outlines, exit conditions and outcomes, roles and bindings, established facts, endings and turns since progress; or the offer state when none is active.
- `check`: runs a progress check now and reports the result.
- `abandon`: abandons the active main quest.

Uses the same runtime as the API ([main_quest.md](../api/main_quest.md)).
