# Quest Check Command

`/quest_check` runs the dedicated quest checker prompt immediately and applies its parsed results.

## Behavior

- Requires `quest_checks.enabled: true` and at least one active, unpaused quest.
- Calls `Events.runQuestChecks()` with `allowWithoutEventChecks: true` and `bypassInterval: true`, so the manual check is not blocked by `event_checks.enabled` or `quest_checks.interval`.
- Resets the quest-check turn counter after the prompt succeeds, matching the cadence reset used by event-signaled quest checks.
- Parses the returned `<quests>` XML and applies newly completed objectives through `Events.processQuestObjectiveCompletionEntries()`, including normal quest rewards and reward prose.
- Stores a durable **Quest Check** event-summary in Adventure history with newly completed objectives, completion reasons and actual XP/currency/disposition/faction changes. A valid check that finds nothing new also stores a concise zero-change result.
- Stores typed non-XP/non-currency reward summaries as separate native event-summary cards and generated reward prose as ordinary `quest-reward` assistant entries. Gift summaries do not depend on prose being present; actual XP/currency awards appear once in their canonical change rows. Item quantity metadata and exact reward text use the shared reward-summary formatter.
- Returns `storedEntries` from the runtime helper and verifies storage before accepting command success. Successful commands send an empty reply because their results are already in history; reward-processing errors retain a concise ephemeral error reply.
- Stores the objective/main summary before reward-history presentation, preserving committed objectives and their visible results when later reward presentation/storage fails. Reward processing still applies through the existing engine once; no history operation rechecks quests or grants rewards again.
- Requests history, location and relationship refreshes, including for zero-change checks. Stored result cards and reward prose are standalone entries so the Adventure renderer displays them after refresh/reload.

## Errors

The command fails with an explicit error when quest checking is disabled, there is no active player, no active unpaused quests exist, the prompt does not return a response, parsing fails, or the slash-command runtime helper is unavailable.

History storage failures also surface explicitly. Existing quest reward application/presentation errors preserve completed objectives and already-applied reward state; they are returned as processing errors rather than triggering another quest check.
