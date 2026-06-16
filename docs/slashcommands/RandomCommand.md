# RandomCommand

## Purpose
`/random <type>` forces a random event through the standard random-event narrative pipeline. The generated chat entries are stored in history, event checks run against the generated prose, and the chat client receives a history refresh event.

## Registration
- Implementation: `slashcommands/random.js`.
- Canonical name: `random`.
- Aliases: none.
- Usage: `/random <type>`.

## Args
- `type` (string, required): event source to force. The command trims and lowercases the value and accepts only letters, digits, underscores, and hyphens.

Valid types:
- `location`: consumes a seed from the resolved current location's `randomEvents`.
- `region`: consumes a seed from the resolved current region's `randomEvents`; generated entries use the `regional` rarity label.
- `common` and `rare`: built-in file-backed lists from `random_events/common.txt` and `random_events/rare.txt`.
- Custom file-backed types: any non-reserved key under `Globals.config.random_event_frequency`, loaded from `random_events/<type>.txt`.

Reserved `random_event_frequency` keys are not valid custom file-backed types: `enabled`, `location`, `region`, `locationSpecific`, and `regionSpecific`.

## Behavior
- Builds the valid type list from `location`, `region`, `common`, `rare`, and custom file-backed `random_event_frequency` keys.
- Rejects empty, malformed, or unknown types with an ephemeral usage error listing valid choices.
- Requires `Globals.triggerRandomEvent` to be present; missing random-event support raises `Error('Random event triggering is unavailable.')`.
- Calls `Globals.triggerRandomEvent({ type: normalizedType, entryCollector })`.
- `Globals.triggerRandomEvent` routes to `maybeTriggerRandomEvent({ forceType: type, entryCollector })` in `api.js`.
- Forced `location` and `region` events consume one seeded event from the resolved location or region when a seed is available.
- Forced file-backed events pick one non-comment, non-empty line from `random_events/<type>.txt`; missing or empty files produce no event result.
- The narrative pipeline renders `base-context.xml.njk` with `promptType: 'random-event'`, sends the prompt through `LLMClient.chatCompletion`, logs it with `LLMClient.logPrompt({ prefix: 'random_event', metadataLabel: 'random_event', ... })`, stores a `type: 'random-event'` assistant chat entry, runs event checks with time advancement suppressed, summarizes the entry, and records event/status summary entries.
- The command reply is public and uses the last collected entry content when entries exist; otherwise it falls back to the returned summary or response text.
- After a successful public reply, the command emits `chat_history_updated` through `Globals.realtimeHub.emit(null, 'chat_history_updated', {})`. Emit failures are logged as warnings and do not change the command reply.

## No-Event and Error Cases
- `random_event_frequency.enabled === false` makes `maybeTriggerRandomEvent` return `null`; the command replies ephemerally that no event was available.
- A resolved region with no seeded regional events makes the random-event pipeline return `null` before forced type dispatch.
- A forced location or region type with no matching seeded events returns `null`.
- Missing or empty file-backed event lists return `null`.
- Exceptions thrown while triggering are caught and returned as ephemeral `Failed to trigger <type> random event: ...` replies.

## Related Tests
- There is no direct unit test for `slashcommands/random.js`.
- `tests/random_event_seed_generation_config.test.js` covers the `random_event_frequency.enabled === false` seed-generation gate and related random-event documentation.
