# Mystery Box Cleanup Design

## Goal

Add a shared mystery cleanup flow that periodically reviews active mystery threads and unresolved boxes, marks resolved threads inactive, marks revealed boxes resolved, and can be run on demand with `/resolve_mystery_threads`.

## Design

The existing `prompts/_includes/mystery_box_cleanup.njk` becomes the canonical cleanup prompt. It runs through `base-context.xml.njk` with `promptType: "mystery_box_cleanup"` and receives an explicit `mysteryCleanupThreads` context containing active threads and their unresolved boxes by id, name, summary, constraints, keys, and private text. The prompt returns `<mysteryThreads>` entries with ids, thoughts, thread-level `resolved`, box ids, box thoughts, and box-level `revealed`.

The parser resolves returned ids exactly. A resolved thread is updated to `status: "inactive"` to match the existing mystery-thread-check behavior. A revealed box is updated through `MysteryBox.markResolved()`. Unknown thread or box ids are ignored with warnings so one bad model entry does not prevent other valid cleanup results from applying.

## Configuration

`config.default.yaml` adds:

```yaml
mystery_box_cleanup:
  interval: 10
```

`interval` counts eligible player-action turns, matching the existing improvement prompt cadence. It must be an integer greater than or equal to `1`. There is no separate enabled flag; the configured interval controls cadence and the slash command can always run the prompt manually.

## Slash Command

`/resolve_mystery_threads` runs the same cleanup flow immediately, applies the results, persists mystery state when a current save directory exists, then replies with the resolved thread and box names plus the prompt's thoughts. If nothing resolves, it replies that no mystery threads or boxes were resolved.

## Error Handling

Manual slash-command failures throw clear errors. Periodic background failures are warning-logged and do not abort the player turn. Prompt calls are logged through `LLMClient.logPrompt()` under `mystery_box_cleanup`.

## Tests

Focused tests cover config defaults/validation, cleanup XML parsing and application, prompt rendering with ids and unresolved boxes, slash-command registration/reply behavior, and periodic scheduling hooks.
