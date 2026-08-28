# Quest Check Command

`/quest_check` runs the dedicated quest checker prompt immediately and applies its parsed results.

## Behavior

- Requires `quest_checks.enabled: true` and at least one active, unpaused quest.
- Calls `Events.runQuestChecks()` with `allowWithoutEventChecks: true` and `bypassInterval: true`, so the manual check is not blocked by `event_checks.enabled` or `quest_checks.interval`.
- Resets the quest-check turn counter after the prompt succeeds, matching the cadence reset used by event-signaled quest checks.
- Parses the returned `<quests>` XML and applies newly completed objectives through `Events.processQuestObjectiveCompletionEntries()`, including normal quest rewards and reward prose.
- Replies with the number and details of newly applied objective completions and rewards. A valid check that finds nothing new reports zero changes.
- Requests location and relationship refreshes when the check changes quest state or grants rewards.

## Errors

The command fails with an explicit error when quest checking is disabled, there is no active player, no active unpaused quests exist, the prompt does not return a response, parsing fails, or the slash-command runtime helper is unavailable.
