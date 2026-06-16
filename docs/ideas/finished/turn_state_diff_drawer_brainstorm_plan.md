# Turn State-Diff Drawer Archive

Archive status: implemented. This file preserves the original design intent for the
turn state-diff drawer and records the current implementation shape. It is not the
canonical day-to-day reference for the UI or API contract.

Current behavior is documented in:

- [docs/ui/chat_interface.md](../../ui/chat_interface.md): chat rendering, live
  event/status bundles, direct travel summary behavior, entity chips, and drawer UX.
- [docs/api/common.md](../../api/common.md): `ChatEntry` and `SummaryItem`
  fields used by `event-summary` and `status-summary` rows.
- [docs/api/chat.md](../../api/chat.md): player-turn and direct-travel chat flow.

The original idea came from
[user_experience_improvement_brainstorm.md](../user_experience_improvement_brainstorm.md):
make turn consequences readable as part of the turn, instead of scattering them
through separate system-like chat cards.

## Original Problem

The game already records many turn consequences: event summaries, status changes,
time advancement, need-bar changes, disposition and faction movement, XP/currency,
item movement, NPC arrivals/departures, quest updates, travel, and location
mutations. Before the drawer, those appeared primarily as separate summary batches.
That preserved information, but made a turn read like several disconnected system
messages.

The drawer was designed to answer:

1. What changed because of this turn?
2. Which changes matter most?
3. Which character, item, quest, faction, or location changed?
4. Was the change story-visible, mechanical, or developer-relevant?
5. Can the player ignore the details until they need them?

## Current Implementation

Parent-linked `event-summary` and `status-summary` chat entries render as a
collapsible `What changed` drawer inside their parent visible turn message.
Standalone summaries still render as summary cards when they have no usable parent
or when they represent a direct standalone notification.

The persisted entries remain real chat-history entries. Their `content`, `type`,
`parentId`, `summaryTitle`, `summaryItems`, `locationId`, and metadata continue to
serve save/load, Story Tools search, base-context history, and compatibility with
older saves. The drawer changes presentation, not persistence.

Key implementation files:

- `api.js`
  - `buildEventSummaryBundle(...)` creates normalized summary rows.
  - `recordEventSummaryEntry(...)` persists `type: 'event-summary'` entries.
  - `recordStatusSummaryEntry(...)` persists `type: 'status-summary'` entries.
  - Summary rows are normalized with `category`, `severity`, `sourceType`,
    `entityRefs`, and optional row `metadata`.
- `public/js/chat.js`
  - `getAttachmentTypes()` deliberately excludes `event-summary` and
    `status-summary`.
  - `getTurnDiffEntryTypes()` owns the separate turn-diff aggregation path.
  - `renderChatHistory()` attaches parent-linked summaries to their parent record
    and leaves orphan summaries standalone.
  - Live event/status bundles attach to the current assistant message when a live
    parent element exists; otherwise they use the normal standalone summary path.
  - Missing `TurnStateDiffDrawer` support raises an explicit error.
- `public/js/turn-state-diff-drawer.js`
  - Normalizes legacy and current summary rows.
  - Groups rows by category.
  - Orders rows by severity within categories.
  - Moves routine elapsed-time rows into the drawer header.
  - Renders entity chips and new-exit map pills.
  - Dedupe logic prevents the same live/persisted summary from appearing twice.
- `views/index.njk`
  - Loads `/js/turn-state-diff-drawer.js` before `/js/chat.js`.
  - Routes exact id-backed drawer entity selections into existing UI targets.
- `public/css/main.scss`
  - Owns `.turn-diff-drawer` styling and responsive behavior.
- `tests/turn_state_diff_drawer_ui.test.js`
  - Provides the current source-level regression coverage for script loading,
    aggregation, metadata normalization, drawer rendering, entity chips, new-exit
    pills, severity ordering, and docs coverage.

## Current Data Contract

The drawer uses existing `ChatEntry` fields rather than a separate turn-diff save
record. A current summary row looks like:

```js
{
    id: "entry-id",
    type: "event-summary",
    parentId: "assistant-turn-entry-id",
    summaryTitle: "Events - Player Turn",
    summaryItems: [{
        icon: "🚶",
        text: "Travelled to Old Chapel.",
        category: "travel",
        severity: "important",
        sourceType: "move_location",
        entityRefs: [
            { type: "location", id: "old-chapel-id", name: "Old Chapel" }
        ],
        metadata: null
    }],
    content: "Events - Player Turn\n• 🚶 Travelled to Old Chapel."
}
```

Legacy entries may have only `content`, or may have `summaryItems` without
category/severity/source/entity metadata. The client still renders those rows
readably: uncategorized event rows become `Other`, and uncategorized status rows
become `Status`.

Current categories are:

| Category | Label | Typical source |
| --- | --- | --- |
| `travel` | Travel | Movement, direct travel, new exits |
| `time` | Time | World-time advancement and transitions |
| `character` | Character | Damage, healing, death, NPC alteration |
| `needs` | Needs | Need-bar deltas |
| `inventory` | Inventory | Item transfer, pickup, drop, consume, alter |
| `npc_party` | NPCs | NPC arrival/departure and party changes |
| `quest_reward` | Quests | Quest progress, XP, currency |
| `disposition` | Dispositions | NPC disposition changes |
| `faction_relationship` | Factions | Faction reputation changes |
| `location_world` | World | Location, scenery, world changes |
| `status` | Status | Status effect changes |
| `other` | Other | Compatibility and unclassified rows |

Current severity values are `normal`, `important`, and `critical`.

## Current Drawer Behavior

Collapsed drawers show `What changed (N)`, up to three category chips, an
`Important` or `Critical` marker when applicable, and a right-aligned elapsed-time
label when the turn has a routine `time_passed` row. Routine elapsed-time rows do
not count toward `N` and do not create a body `Time` group when they are the only
time row. If elapsed time is the only row, the drawer remains visible with a
disabled `What changed (0)` control.

Expanded drawers group rows by category. `needs` and `disposition` rows receive
special per-character grouped rows using their structured metadata; other
categories use standard icon/text rows.

Rows preserve `sourceType` as DOM metadata. `entityRefs` render as compact chips:
id-backed refs are buttons that emit `airpg:turn-diff-entity-selected`; name-only
refs are visible but not clickable. The page routes exact id-backed refs to
existing UI targets where possible:

- Characters open the character view.
- Locations open the location context menu.
- Visible things scroll and highlight in place.
- Container things can open the container modal.
- Quest and faction refs switch to their panels.

`new_exit_discovered` rows with `metadata.newExitDiscovered` also render a map
navigation pill that opens the origin-region map and focuses the new destination
or region-exit bubble.

Direct gameplay travel has extra compatibility handling. Server-parented direct
move summaries attach to visible arrival prose, prior travel prose, or the travel
user/comment entry. Parentless legacy direct-travel summaries can attach
client-side to a following visible `while-you-were-away-player` arrival entry.
Character-menu story-tool teleports do not create travel/time summaries; map and
Favorites fast travel remain gameplay travel and can create normal drawer rows.

## Original Design Notes

The chosen v1 design was "attach parent-linked summaries as a drawer under the
turn." Two alternatives were considered:

- Restyle standalone event-summary cards. This was low risk but did not reduce
  chat-log clutter enough.
- Build a separate right-side Turn Inspector. This would be more powerful, but
  competed with the existing Adventure/sidebar layout and was more developer-tool
  oriented.

Original v1 non-goals still mostly hold:

- No new LLM prompt is required for the drawer itself.
- No save migration is required.
- No player-facing raw event payload inspector is part of the drawer.
- Event outcome editing stays outside the drawer.
- Prompt-facing event taxonomy is separate from drawer-facing categories.

The old rollout phases are now historical context:

- Phase 1, rendering parent-linked summaries as drawers, is implemented.
- Phase 2, server/live summary metadata, is implemented.
- Phase 3, entity chips and id-backed UI routing, is implemented for the current
  target types listed above.
- The larger Turn Inspector panel remains only a future idea.

## Maintenance Gotchas

1. Do not change summary persistence just to change drawer presentation.
   `event-summary` and `status-summary` entries are stored history and are used
   outside the chat renderer.
2. Keep turn-diff entries separate from generic insight attachments. Adding
   `event-summary` or `status-summary` to `getAttachmentTypes()` can hide or
   misattach standalone summaries.
3. Keep legacy summary compatibility. Old saves may contain content-only
   summaries, missing parent ids, or summary rows without metadata.
4. Do not guess navigation targets for name-only `entityRefs`; exact id-backed
   refs are the clickable path.
5. When adding a category or severity, update `api.js`, `public/js/chat.js`,
   `public/js/turn-state-diff-drawer.js`, `docs/api/common.md`, focused UI docs,
   and the source-level drawer test together.
6. Live rendering and persisted history refresh can both touch the same turn.
   Preserve dedupe behavior when changing bundle flushing or parent selection.
7. Need/disposition grouping depends on row `metadata.needBarChange` and
   `metadata.dispositionChange`. Keep those shapes stable when changing summary
   text.
8. Drawer style changes belong in `public/css/main.scss`; compile
   `public/css/main.css` after SCSS edits.
9. The current implementation raises explicit errors for missing drawer script
   support. Avoid replacing that with silent placeholder rendering.

## Verification References

Use the focused source-level drawer test when changing this system:

```bash
node --test tests/turn_state_diff_drawer_ui.test.js
```

When editing drawer SCSS, also run:

```bash
npm run scss:build:main
```

The original plan proposed a dedicated
`tests/e2e/turn-state-diff-drawer.spec.js`, but that file is not part of the
current test suite. Add browser coverage when changing interaction behavior that
cannot be checked by the existing source-level test.

## Future Ideas

- Add a side-panel Turn Inspector only if normal drawer interactions are not
  enough for campaign review/debugging.
- Add drawer filters for important-only and developer details.
- Add a compact turn outcome severity marker to the assistant message header.
- Merge skill-check, attack-check, plausibility, and slop-remover insight buttons
  into a sibling "Why" drawer while keeping mechanical state changes in
  `What changed`.
- Reuse the structured row pattern for entity history and developer inspection.
