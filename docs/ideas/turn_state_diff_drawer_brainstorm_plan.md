# Turn State-Diff Drawer Brainstorm and Implementation Plan

This document expands the "Turn state-diff drawer" idea from [user_experience_improvement_brainstorm.md](user_experience_improvement_brainstorm.md). It covers the player-facing UX, implementation options, recommended v1, rollout tasks, tests, and follow-up phases.

## Problem statement

The game already detects and records many state changes after a turn: event summaries, status summaries, time advancement, need-bar changes, disposition changes, faction reputation changes, XP/currency changes, item movement, NPC arrivals/departures, quest updates, travel, and location mutations. The current UI displays these as separate chat entries or inline summary batches. That is useful, but it makes the core turn read like a sequence of separate system messages instead of one coherent "what happened because of this action" result.

The drawer should answer:

1. What changed because of this turn?
2. Which changes matter most?
3. Which character, item, quest, faction, or location changed?
4. Was the change story-visible, mechanical, or developer-relevant?
5. Can the player ignore the details until they need them?

## Current implementation observations

Relevant documentation:

- [docs/ui/chat_interface.md](../ui/chat_interface.md) documents chat rendering, event-summary batches, bundled need/disposition/faction rendering, and prompt-progress behavior.
- [docs/api/common.md](../api/common.md) documents `ChatEntry`, including `summaryTitle`, `summaryItems`, `parentId`, `type`, and `metadata`.
- [docs/server_llm_notes.md](../server_llm_notes.md) documents `pushChatEntry`, `/api/chat`, event checks, and base-context handling for `event-summary` entries.

Relevant code:

- `api.js`
  - `buildEventSummaryBundle(...)` converts structured event outputs into display rows.
  - `recordEventSummaryEntry(...)` persists `type: 'event-summary'` entries with `summaryTitle`, `summaryItems`, `parentId`, and `locationId`.
  - `recordStatusSummaryEntry(...)` persists `type: 'status-summary'` entries.
  - `appendEventSummariesToChat(...)` records event/status/plausibility attachments for a parent turn.
- `public/js/chat.js`
  - `renderChatHistory()` already aggregates some parent-linked attachment entries.
  - `createEventSummaryElement(...)` and `createStatusSummaryElement(...)` render persisted summaries as standalone chat messages.
  - `processChatPayload(...)`, `startEventBundle()`, `flushEventBundle()`, and `flushStatusBundle()` render live summary batches from response payloads.
  - `getAttachmentTypes()` currently includes `skill-check`, `attack-check`, `plausibility`, `slop-remover`, and `supplemental-story-info`, but not `event-summary` or `status-summary`.
- `views/index.njk`
  - Initial server-rendered history already has a branch for `message.type == 'event-summary'`.
  - It loads `public/js/chat.js` after utility scripts.
- `public/css/main.scss`
  - Existing event-summary styling lives around `.message.event-summary-batch`, `.message.status-summary-batch`, and `.event-summary-list`.

## Gotchas

1. `event-summary` entries are real persisted chat history, and base-context rendering can use them. The drawer should not change their `content`, `type`, or persistence semantics.
2. Existing saves contain old summaries. The UI must render old `summaryItems` and content-only summaries without migration.
3. Some summaries have `parentId`; some older or standalone summaries may not. Parent-linked summaries should become drawers. Orphan/standalone summaries should still render as their own chat entries.
4. Do not add `event-summary` and `status-summary` to the generic attachment set wholesale. The current pruning/attachment fallback behavior could incorrectly hide standalone summaries or attach them to unrelated messages.
5. Streaming and final HTTP payload handling can both touch the same turn. Live drawer rendering needs to avoid duplicate rows.
6. Story Tools search currently includes event-summary text. The drawer must not remove summary entries from `serverHistory`; it should only change chat-log presentation.
7. The current server bundle rows are mostly display text. Rich grouping can be inferred in v1, but stable categories/entity links need later structured metadata.
8. SCSS edits require compiling the corresponding CSS before finishing implementation.

## UX goals

- Keep the assistant prose as the visual center of the turn.
- Attach mechanical consequences to the turn that caused them.
- Collapse by default unless the turn has urgent consequences.
- Make severe or blocking changes visible even while collapsed.
- Preserve full details for audit/debug without forcing normal players through raw event data.
- Make the drawer easy to scan on mobile.

## Non-goals for v1

- No new LLM prompts.
- No save migration.
- No editing of event outcomes from the drawer.
- No raw event payload inspector in the player-facing drawer.
- No automatic entity autolinking beyond what existing summary text already supports.
- No new backend event taxonomy required for the first release.

## Design alternatives

### Option A: Keep standalone event-summary cards, restyle them

Summary cards stay as separate chat messages, but become more compact, grouped, and collapsible.

Pros:

- Smallest change.
- Minimal rendering logic.
- Works with existing entries.

Cons:

- Still separates consequences from the assistant turn.
- Does not reduce chat-log clutter enough.
- Does not create the "turn as one unit" feel.

### Option B: Attach parent-linked summaries as a drawer under the turn

Persist event/status summaries exactly as today, but render summaries with `parentId` as a drawer attached to the parent assistant turn. Orphan summaries remain standalone.

Pros:

- Best balance of UX payoff and implementation risk.
- Keeps persistence/search/base-context behavior intact.
- Uses existing `parentId` data.
- Creates a reusable pattern for future turn-level attachments.

Cons:

- Needs careful live rendering for streamed/final payloads.
- Requires changes to chat-history aggregation.
- Parentless older entries remain standalone unless a later migration/inference pass is added.

Recommendation: choose this for v1.

### Option C: Build a separate right-side "Turn Inspector" panel

Selecting a turn opens a dedicated side panel with prose, state diffs, prompt details, and raw event data.

Pros:

- Most powerful long-term inspection model.
- Could combine player-facing and developer-facing details.

Cons:

- Larger design and implementation.
- Competes with existing Adventure/sidebar layout.
- More likely to become a developer tool than a normal-player aid.

This is better as a later follow-up after the drawer establishes the data model and interaction pattern.

## Recommended v1

Render parent-linked `event-summary` and `status-summary` entries as a collapsible drawer below their parent assistant message.

### Collapsed state

The collapsed drawer should show:

- Label: `What changed`.
- Total item count.
- Up to three compact category chips, such as `Travel`, `Inventory`, `Needs`, `Quest`, `Reputation`, `Status`.
- A severe-change indicator when any row is likely critical, such as death/incapacitation, damage, quest completion, travel, reputation loss, or critical need changes.

Example shape:

```text
What changed (7)  Travel  Inventory  Needs
```

### Expanded state

The expanded drawer should group rows by category:

- Time and travel.
- Character health/status/needs.
- Inventory and items.
- NPCs and party.
- Quests and rewards.
- Factions and relationships.
- Location/world changes.
- Other events.

Rows should retain the existing icon and summary text. The first release can group with category inference from summary title, row icon, and text. Later releases can use explicit server-side metadata.

### Default open/closed behavior

Default closed:

- Normal item movement.
- Ordinary time passing.
- Minor need or disposition changes.
- Miscellaneous scene changes.

Default open:

- Death or incapacitation.
- Environmental damage or healing.
- Quest completed.
- Party member joined/left.
- Reputation loss.
- Travel/location changed.
- Any row marked severe by future metadata.

For v1, "default open" can be conservative and based on row text/title matching. If this feels too noisy during play, switch to always collapsed and rely on the collapsed severity chip.

### Standalone fallback

Render a summary as a standalone chat entry when:

- It has no `parentId`.
- Its parent is not present after client history pruning.
- It is a direct system/status update not caused by a single visible turn.
- Rendering fails. In this case, fail loudly in console and fall back to the existing standalone renderer.

## Data model

Do not change the required `ChatEntry` contract for v1.

Existing fields are enough:

```js
{
    id: "entry-id",
    type: "event-summary",
    parentId: "assistant-turn-entry-id",
    summaryTitle: "Events - Player Turn",
    summaryItems: [
        { icon: "*", text: "Travelled to the Old Chapel." }
    ],
    content: "Events - Player Turn\n* Travelled to the Old Chapel."
}
```

Optional future enrichment:

```js
{
    icon: "*",
    text: "Travelled to the Old Chapel.",
    category: "travel",
    severity: "important",
    sourceType: "move_location",
    entityRefs: [
        { type: "location", id: "old-chapel-id", label: "Old Chapel" }
    ]
}
```

Future metadata should be additive only. Old clients should still render `icon` and `text`.

## Category taxonomy

Use these categories for display:

| Category | Examples | Severity hints |
| --- | --- | --- |
| `time` | Time passed, weather/light transition | Usually normal |
| `travel` | Player moved, vehicle moved, new exit | Important |
| `character` | Damage, healing, death, incapacitation | Important or critical |
| `needs` | Hunger, fatigue, morale, health regen | Normal to important |
| `inventory` | Pick up, drop, transfer, consume, item altered | Normal |
| `npc_party` | NPC arrived/left, joined/left party | Important |
| `quest_reward` | Quest received, objective complete, XP, currency | Important |
| `faction_relationship` | Disposition and faction reputation changes | Normal to important |
| `location_world` | Location altered, scenery/item appeared, exit discovered | Normal to important |
| `status` | Status effect gained/lost | Normal to important |
| `other` | Anything unclassified | Normal |

The category names are UI-facing implementation values, not prompt-facing concepts.

## Implementation plan

### Phase 1: Rendering-only drawer

Goal: attach existing parent-linked summaries to their parent turn without changing server persistence.

Files:

- Create `public/js/turn-state-diff-drawer.js`.
- Modify `views/index.njk`.
- Modify `public/js/chat.js`.
- Modify `public/css/main.scss`.
- Compile `public/css/main.css`.
- Create `tests/turn_state_diff_drawer_ui.test.js`.
- Update [docs/ui/chat_interface.md](../ui/chat_interface.md).

Steps:

1. Create `public/js/turn-state-diff-drawer.js`.
   - Expose `window.TurnStateDiffDrawer`.
   - Provide pure-ish helpers:
     - `isTurnDiffEntry(entry)`.
     - `normalizeTurnDiffEntries(entries)`.
     - `categorizeTurnDiffItem(item, entry)`.
     - `summarizeTurnDiff(entries)`.
     - `createDrawer(entries, options)`.
     - `appendDrawer(parentElement, entries, options)`.
   - Use DOM APIs and `textContent` for labels.
   - For summary item body text, allow the caller to pass a renderer callback so `AIRPGChat.setMessageContent(...)` can keep existing Markdown behavior.

2. Load the new script before `chat.js` in `views/index.njk`.
   - Add `<script src="/js/turn-state-diff-drawer.js"></script>` before `<script src="/js/chat.js"></script>`.
   - Do not make it a module unless the surrounding script loading is migrated.

3. Modify `AIRPGChat.renderChatHistory()`.
   - Add `getTurnDiffEntryTypes()` returning `new Set(['event-summary', 'status-summary'])`.
   - Keep `getAttachmentTypes()` unchanged for existing insight attachments.
   - Add `turnDiffEntries: []` to aggregated records.
   - When an entry is a turn-diff type and has a matching `parentId`, attach it to that parent record instead of creating a standalone record.
   - When no matching parent exists, leave it as a standalone record so old/history-pruned entries still render.
   - Preserve pending parent-linked turn-diff entries if the parent appears later in the iteration.

4. Modify `createChatMessageElement(...)`.
   - Change signature to `createChatMessageElement(entry, attachments = [], turnDiffEntries = [])`.
   - Create normal message DOM as today.
   - After message content/timestamp and before or after message actions, append the drawer if `turnDiffEntries.length > 0`.
   - Prefer the drawer immediately after the content and timestamp, before edit/action buttons, so the turn reads as prose then consequences then controls.
   - Standalone `event-summary` and `status-summary` entries should continue to use existing `createEventSummaryElement(...)` and `createStatusSummaryElement(...)`.

5. Add live rendering support.
   - Make `addMessage(...)` return the created message element.
   - In `processChatPayload(...)`, when the assistant response is rendered, store the returned element on the request context as `context.playerActionElement`.
   - Extend `activeEventBundle` and `activeStatusBundle` to optionally remember a `parentElement`.
   - When `flushEventBundle()` or `flushStatusBundle()` has a parent element, append/update a drawer under that element instead of appending a standalone summary message.
   - If there is no parent element, keep the existing standalone rendering path.
   - Keep server-history refresh behavior; after `/api/chat/history` reloads, the persisted parent-linked entries should render the same drawer.

6. Add drawer styling in `public/css/main.scss`.
   - Scope styles under `.turn-diff-drawer`.
   - Use an 8px-or-less border radius.
   - Keep it visually subordinate to assistant prose.
   - Use a real `<button>` or `<summary>` for toggling with visible focus.
   - Ensure category chips wrap on mobile.
   - Ensure the expanded list does not resize surrounding controls unpredictably.
   - Compile with `npm run scss:build:main`.

7. Add source-level tests in `tests/turn_state_diff_drawer_ui.test.js`.
   - Verify `views/index.njk` loads `/js/turn-state-diff-drawer.js` before `/js/chat.js`.
   - Verify `public/js/chat.js` defines `getTurnDiffEntryTypes`.
   - Verify `getAttachmentTypes()` does not include `event-summary` or `status-summary`.
   - Verify `renderChatHistory()` tracks `turnDiffEntries`.
   - Verify `addMessage(...)` returns `messageDiv`.
   - Verify SCSS includes `.turn-diff-drawer`, category/chip classes, and focus styles.

8. Add focused browser coverage if practical.
   - Create `tests/e2e/turn-state-diff-drawer.spec.js`.
   - Use a seeded or mocked chat-history payload with one assistant entry and two parent-linked summaries.
   - Assert the assistant message has a `What changed` drawer.
   - Assert the parent-linked summaries do not also appear as separate chat cards.
   - Assert an orphan summary still appears as a standalone event-summary card.
   - Assert the drawer toggles with mouse and keyboard.

9. Update docs.
   - Add a short section to [docs/ui/chat_interface.md](../ui/chat_interface.md) describing the drawer.
   - Mention the new script in the chat UI architecture section.
   - Keep [docs/api/common.md](../api/common.md) unchanged unless the implementation adds optional metadata fields.

Verification commands:

```bash
node --test tests/turn_state_diff_drawer_ui.test.js
npm run scss:build:main
npm run test:e2e:headless -- tests/e2e/turn-state-diff-drawer.spec.js
```

If the e2e fixture is too expensive for v1, the minimum acceptable verification is:

```bash
node --test tests/turn_state_diff_drawer_ui.test.js
npm run scss:build:main
```

### Phase 2: Server-side summary metadata

Goal: make drawer rows trustworthy data, not text/icon guesses. This phase now assumes Phase 1 already ships exact `summaryItems[].category` values from server and live client paths.

Files:

- Modify `api.js`.
- Modify [docs/api/common.md](../api/common.md).
- Add or update API/helper tests around event-summary entry construction.

Steps:

1. Change `buildEventSummaryBundle(...)` so internal `add(...)` can accept an object:

```js
add({
    icon: '*',
    text: 'Travelled to the Old Chapel.',
    category: 'travel',
    severity: 'important',
    sourceType: 'move_location',
    entityRefs: [{ type: 'location', id: '...', name: 'Old Chapel' }]
});
```

2. Preserve backward compatibility:

```js
add('*', 'Travelled to the Old Chapel.');
```

3. Include metadata in `summaryItems`:

```js
summaryItems: bundle.items.map(item => ({
    icon: item?.icon || '*',
    text: item?.text || '',
    category: item?.category || null,
    severity: item?.severity || 'normal',
    sourceType: item?.sourceType || null,
    entityRefs: Array.isArray(item?.entityRefs) ? item.entityRefs : []
}))
```

4. Assign categories at the event-type switch point:
   - `move_location`, `move_new_location`, `new_exit_discovered`: `travel`.
   - `death_incapacitation`, `attack_damage`, `heal_recover`, `environmentalDamageEvents`: `character`.
   - `needBarChanges`: `needs`.
   - `dispositionChanges`, `factionReputationChanges`, `hostile_to_friendly`: `faction_relationship`.
   - `quest_received`, `completed_quest_objective`, XP/currency rewards: `quest_reward`.
   - `pick_up_item`, `drop_item`, `transfer_item`, `consume_item`, `alter_item`, `harvest_gather`: `inventory`.
   - `npc_arrival_departure`, `party_change`, `alter_npc`: `npc_party`.
   - `alter_location`, `item_appear`, `scenery_appear`: `location_world`.
   - `status-summary` entries: `status`.

5. Assign severity conservatively:
   - `critical`: death, incapacitation, severe damage, hard blocker.
   - `important`: travel, quest completion, party changes, reputation loss, new quest.
   - `normal`: ordinary inventory/time/need/status changes.

6. Update the drawer helper to preserve `entityRefs`, prefer explicit `category` and `severity`, and fall back only for old entries.

7. Keep entity refs data-only in Phase 2. Clickable chips and modal navigation belong in Phase 3.

Verification commands:

```bash
node --test tests/events.time_passed.test.js tests/events.move_travel_time.test.js tests/events.need_bar_prompt.test.js
node --test tests/turn_state_diff_drawer_ui.test.js
```

Current implementation note:
- `api.js` normalizes `category`, `severity`, `sourceType`, and `entityRefs` for persisted `event-summary` and `status-summary` entries.
- `public/js/chat.js` preserves the same fields for live bundled drawer rows.
- `public/js/turn-state-diff-drawer.js` carries `entityRefs` through row normalization but does not render clickable links yet.

### Phase 3: Entity links and richer inspection

Goal: make rows navigable and more useful for campaign continuity.

Files:

- Modify `api.js` event summary construction.
- Modify `public/js/turn-state-diff-drawer.js`.
- Reuse existing tooltip/modal helpers in `views/index.njk` and `public/js/chat.js`.
- Update [docs/api/common.md](../api/common.md) if `entityRefs` becomes official.

Steps:

1. Add `entityRefs` where the server knows stable ids.
   - NPC changes should include NPC id/name when available.
   - Thing changes should include thing id/name when available.
   - Location/travel changes should include location id/name when available.
   - Faction changes should include faction id/name when available.
   - Quest changes should include quest id/name when available.

2. Render row labels as entity chips when `entityRefs` exist.

3. Clicking an entity chip should open the existing modal/tooltip/focus behavior for that type.

4. Ambiguous or name-only references should stay plain text in v1 of this phase.

Verification should include at least one browser test for NPC and item row links.

## Detailed UI behavior

### Drawer placement

Place the drawer inside the parent `.message.ai-message` after `.message-content` and `.message-timestamp`. It should feel like part of the turn, not a separate message.

### Toggle behavior

Use a real interactive element:

- `<details>` / `<summary>` is acceptable if styling and keyboard behavior are reliable.
- A `<button aria-expanded="...">` is acceptable if custom state handling is clearer.

The implementation should keep focus visible and should support `Enter` and `Space`.

### Labels

Use short utilitarian labels:

- `What changed`.
- `No visible state changes` should not render; absence is cleaner.
- Category labels: `Time`, `Travel`, `Character`, `Needs`, `Inventory`, `NPCs`, `Quests`, `Factions`, `World`, `Status`, `Other`.

Do not put instructional text in the UI.

### Mobile behavior

- The collapsed row should wrap cleanly.
- Category chips should not force horizontal scrolling.
- Expanded rows should use a single column.
- Long row text should wrap without overlapping icons or controls.

### Accessibility

- Toggle has an accessible name that includes the item count.
- Expanded groups have headings or accessible labels.
- Focus style is visible.
- Icons are decorative unless they are the only visible label.
- Row text remains available as text, not only title attributes.

## Acceptance criteria

1. A parent-linked `event-summary` entry renders inside a drawer on the parent assistant message.
2. A parent-linked `status-summary` entry renders in the same drawer, grouped separately from event rows when expanded.
3. The same summary entries remain in `serverHistory` and Story Tools search.
4. Parent-linked summaries are not duplicated as standalone chat cards.
5. Orphan summaries still render as standalone cards.
6. Old summaries with only `content` and no `summaryItems` still render readably.
7. Live turn responses show the drawer without waiting for a manual page refresh.
8. Streaming/final response handling does not duplicate drawer rows.
9. Mobile layout wraps without overlap.
10. Keyboard users can focus and toggle the drawer.

## Test strategy

### Unit/static source tests

Use Node's built-in test runner for low-cost regression checks. Existing UI tests in this repo often inspect source files directly, so a source-level test is acceptable for ensuring the right hooks remain present.

Suggested file: `tests/turn_state_diff_drawer_ui.test.js`.

Assertions:

- New script is included before `chat.js`.
- `public/js/chat.js` has `getTurnDiffEntryTypes`.
- `getAttachmentTypes` does not include event/status summaries.
- `renderChatHistory` stores `turnDiffEntries`.
- `createChatMessageElement` receives `turnDiffEntries`.
- `addMessage` returns `messageDiv`.
- SCSS contains drawer, category, chip, expanded row, and focus selectors.

### Browser tests

Suggested file: `tests/e2e/turn-state-diff-drawer.spec.js`.

Test cases:

1. Parent-linked event/status summaries attach to the assistant message.
2. Orphan summaries remain standalone.
3. The drawer toggles by click.
4. The drawer toggles by keyboard.
5. The drawer survives chat-history refresh.

### Manual smoke checklist

1. Start a game or load a fixture save.
2. Take an action that changes location or inventory.
3. Confirm the assistant turn shows `What changed`.
4. Expand it and confirm all expected rows are present.
5. Refresh the page and confirm the drawer still appears.
6. Use Story Tools search for text from a summary row and confirm it is still searchable.
7. Resize to mobile width and confirm no overlap.

## Rollout recommendation

Ship Phase 1 first. It gives most of the player-facing value while leaving the server event model intact.

After Phase 1 has been used for a few sessions, decide whether Phase 2 is needed. If category inference is good enough, postpone server-side enrichment until entity links or developer inspection require it.

## Future ideas

- Add per-row entity chips for NPCs, items, locations, factions, and quests.
- Add drawer filters for "important only" and "developer details".
- Add a compact "turn outcome" severity badge to the assistant message header.
- Merge skill-check, attack-check, plausibility, and slop-remover insight buttons into a sibling "Why" drawer while keeping mechanical state changes in "What changed".
- Add a turn inspector side panel only after the drawer pattern is stable.
