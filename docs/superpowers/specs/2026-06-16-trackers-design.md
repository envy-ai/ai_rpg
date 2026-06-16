# Trackers Design

## Goal

Add a first-class `Tracker` model for LLM-created plot state that can be shown in the player sidebar, persisted in saves, included compactly in base context, and mutated through chat-tool world-state mutators.

## Scope

Trackers are global game-state records. Every persisted tracker is active until removed; there is no inactive/archive status in this version. Hidden trackers are persisted and included in prompt context, but the player sidebar hides them by default behind an eye toggle.

## Data Model

Create `Tracker.js` with a registry pattern matching `ScheduledEvent` and `MysteryThread`.

Fields:

- `id`: compact persisted id allocated by `IdGenerator.next('tracker')`, using a `tracker_n` prefix.
- `name`: non-empty display name.
- `type`: one of `countdown`, `numerical_count`, `x_out_of_total`, `percentage`, or `short_string`.
- `value`: stored as a trimmed string so each tracker can preserve its exact display form.
- `hiddenFromPlayer`: boolean.
- `lastUpdatedWorldMinute`: non-negative integer world minute from `Globals.getTotalWorldMinutes()`.
- `description`: non-empty paragraph for LLM update guidance.
- `createdAt` / `updatedAt`: real ISO timestamps for diagnostics and save output.

Validation should fail loudly:

- Constructors and loaders require object payloads.
- `name`, `type`, `value`, and `description` are required for creation.
- `short_string` values must be three words or fewer.
- `x_out_of_total` values must use an `x/total` shape with non-negative integer parts.
- `percentage` values must use a finite number with a percent sign.
- Numerical and countdown values must be non-empty strings; no clamping is applied.

## Persistence

Add `tracker` / `trackers` support to `IdGenerator`.

Add `Tracker.serializeAll()` and `Tracker.loadAll()` into `Utils.serializeGameState(...)` and `Utils.hydrateGameState(...)`. Save files should write `trackers.json`, read it with `{}` as the legacy fallback, and include `metadata.totalTrackers`.

New games and loaded games should clear and hydrate the runtime tracker registry through the same model API used by other persisted records.

## Prompt Context

`prepareBasePromptContext(...)` should expose active trackers as `trackers`.

`prompts/base-context.xml.njk` should render them near the end of `<gameState>`, after active mystery threads and before recent story history:

```xml
<trackers>
tracker_1 | Name | type=countdown | value=3 turns | hidden=false | lastUpdated=18 minutes ago | guidance=Update when the ritual advances, stalls, or is interrupted.
tracker_2 | Name | type=percentage | value=45% | hidden=true | lastUpdated=2 hours ago | guidance=Update when the conspiracy's influence visibly grows or shrinks.
</trackers>
```

The prompt context should use plain text inside the tag, not a nested XML node per tracker. The LLM-facing base context includes `id`, `name`, `type`, `value`, `hidden`, formatted last-updated time, and the tracker description as compact `guidance=` text. Including guidance is necessary because the description tells the LLM how and when to update the tracker.

## Chat Tools

Add these built-in tools to `chat_tool_calls.js` and make them available wherever existing world-state mutators are available:

- `addTracker({ name, type, value, hiddenFromPlayer, description })`
- `removeTracker({ tracker })`
- `updateTracker({ tracker, value })`

`tracker` resolves by exact id first, then exact/loose name. Ambiguous name matches return visible candidate errors with ids. Tool results return compact XML with the tracker id, name, type, value, hidden flag, and last-updated display text.

Tool behavior:

- `addTracker` creates a tracker and stamps `lastUpdatedWorldMinute` to current world time.
- `removeTracker` deletes exactly one existing tracker.
- `updateTracker` only changes `value` and `lastUpdatedWorldMinute`.

Description and hidden flag are creation-only for this pass. If future editing is needed, it can be added as a fourth mutator without broadening the current tools.

## Sidebar UI

Add a Trackers section under the party section in the chat sidebar.

The section includes:

- Header label `Trackers`.
- Count badge for visible trackers.
- Eye toggle styled like the hidden NPC toggle.
- Empty state when no visible trackers are available.
- Compact tracker rows showing name and current value only. Type labels and `last updated` time are intentionally omitted from the sidebar cards.

Hidden trackers are invisible by default. When the eye toggle is active, hidden trackers render with a subdued visual treatment.

`serializeNpcForClient(currentPlayer)` or the `/api/player` response path should include `trackers` so existing sidebar refreshes update the tracker list without adding another endpoint. Chat responses and location refresh flows that already refresh `/api/player` will then update the sidebar naturally.

## Styling

Add styles to `public/css/main.scss`, near existing chat sidebar styles. Reuse restrained dark sidebar styling, stable row heights, and the existing hidden-toggle visual language. Compile `public/css/main.css` before finishing implementation.

## Testing

Use Node tests first, then focused UI/static checks:

- `tests/tracker.test.js`: model validation, save/load round trip, id allocation, remove/update semantics, formatted last-updated support.
- `tests/chat_tool_trackers.test.js`: tool schemas, add/update/remove execution, validation errors, ambiguous target errors.
- `tests/base_context_inventory_value.test.js` or a new prompt-context test: base context renders compact `<trackers>` text with tracker guidance as plain text rather than nested XML.
- A source-level UI test or focused browser test should verify the sidebar has the tracker section and hidden toggle wiring.

Implementation verification should run the relevant node tests, a syntax check for touched JS files, `npm run scss:build:main`, and any focused UI test added for the sidebar.

## Documentation

Add `docs/classes/Tracker.md` after implementation. Update `docs/README.md` to list the class doc and this design spec.
