# Quest Hidden-Route Knowledge Rewards Implementation Plan

## Goal

Add the first authoritative `knowledge` quest reward benefit: completing a quest can reveal one existing hidden directed exit and thereby disclose its destination route. The reward must use the existing typed/idempotent quest-benefit pipeline and hidden-exit mutation invariant; it must not mark the destination visited, grant fast travel, create a new exit, reveal the reverse edge, or rely on reward prose to mutate state.

This is the narrow first implementation of the broader `knowledge` idea in `docs/ideas/quest_nonmaterial_rewards_plan.md`. Implement it after `2026-09-12-map-route-inspection.md` so the applied reward can refresh and link into the player-safe route inspector.

## Product Decisions

1. Register core benefit type `knowledge` with exactly one supported v1 subtype: `route`.
2. A route benefit targets one existing directed `LocationExit` by `sourceLocationId` plus `targetId` (the exit id), and pins its expected `destinationLocationId`.
3. The target exit may be anywhere in the hydrated world graph, but it must exist when the quest is accepted and again when the reward is applied.
4. Newly generated/edited quests cannot promise a route that is already visible. If the player independently reveals it after accepting the quest, completion treats the benefit as already satisfied and applies it exactly once without error.
5. Application atomically changes only the target exit from `{ hiddenFromPlayer: true, discoveryDifficulty: <label> }` to `{ hiddenFromPlayer: false, discoveryDifficulty: null }`.
6. The reverse directed edge is unchanged. A bidirectional-looking connection can therefore still be known in only one direction.
7. Revealing a route does not set `Location.visited`, expand a stub, unlock Favorites, grant fast travel, or create any separate “known location” flag.
8. The destination becomes inspectable only through the normal visible-exit/map behavior. Travel eligibility continues to be derived by the route-inspection/fast-travel service.
9. If the source, exit, or pinned destination is missing or inconsistent at completion, the benefit fails explicitly, remains unapplied, and uses the existing Retry Pending Rewards flow.
10. Quest reward prose is presentation-only and is generated from the authoritative applied result. It never performs or infers the reveal.
11. Only old save hydration may tolerate fields omitted by older persisted quest data. New prompt XML, replay recordings, API input, and editor output use the new strict schema when a knowledge benefit is present.

## Why `route` Instead of General Location Knowledge

The current game has global `Location.visited` state but no independent “the player knows this location exists” state. Marking a location visited would falsely claim physical travel and would unlock existing visited-only behavior, including map fast travel. Adding a general per-player known-location registry would be a separate, much larger visibility migration.

For v1, the authoritative knowledge is therefore concrete: the player learns one hidden outgoing route. Revealing that edge naturally exposes its destination through existing map/location payloads without inventing a visit. Future `knowledge` subtypes such as `recipe`, `ability`, `lore`, or a true `location` discovery registry remain unsupported and must continue to fail validation.

## Persisted Benefit Shape

Canonical `Quest.rewardBenefits` entry:

```js
{
  id: 'knowledge-route:loc_12:exit_7',
  type: 'knowledge',
  subtype: 'route',
  targetId: 'exit_7',
  sourceLocationId: 'loc_12',
  destinationLocationId: 'loc_19',
  label: 'The concealed stair into the Sunken Archive',
  description: 'The archivist gives you the sequence of stones that opens the stair.'
}
```

Required fields are `id`, `type`, `subtype`, `targetId`, `sourceLocationId`, `destinationLocationId`, and `label`. `description` is nullable. Reject unknown fields in strict prompt parsing where the existing parser architecture supports allowed-child validation; do not silently discard alternate target semantics.

Do not persist difficulty on the reward. Difficulty belongs to the hidden exit and is cleared by reveal. Copying it into the quest would create stale competing state.

## Shared Hidden-Exit Reveal Service

Extract the authoritative mutation now embedded in the `reveal_hidden_exit` event handler into a reusable helper in `HiddenDiscovery.js`, for example:

```text
revealHiddenExit({
  sourceLocation,
  exitId,
  expectedDestinationLocationId,
  expectedDestinationName,
  allowAlreadyVisible
})
```

The helper must:

1. require a hydrated source `Location`;
2. resolve the exit only among that location's direct outgoing edges;
3. validate the exact exit id and pinned destination id;
4. optionally validate the display name when called from an LLM event;
5. return an explicit `alreadyVisible` result for idempotent calls;
6. otherwise call the exit's paired `setHiddenDiscovery(...)` mutation once;
7. return canonical source, exit, destination, direction, and display metadata;
8. throw on missing or mismatched targets without searching for a “similar” exit.

Refactor `Events.reveal_hidden_exit` to call this helper so event reveals and quest rewards cannot diverge. Preserve the event's current-location and id/name restrictions.

## `knowledge` Benefit Handler

Register a `knowledge` handler in `QuestRewardBenefitRegistry.js`.

### `normalize(entry, context)`

- require `subtype === 'route'`;
- trim and require the three canonical ids and label;
- normalize optional description to `null`;
- return only the supported canonical fields;
- reject every other knowledge subtype explicitly.

### `validate(entry, context)`

- require an active quest-owning player context;
- resolve `sourceLocationId` from the authoritative location registry;
- resolve `targetId` only among the source's outgoing exits;
- require the exit destination to equal `destinationLocationId`;
- require the destination location to exist, including a legitimate hydrated stub;
- do not require the exit to remain hidden, because independent discovery after quest acceptance is valid satisfaction;
- do not accept a replacement exit with the same names but another id.

Add `findLocationById` to the reward-handler context instead of importing server state through a circular dependency. Keep `findActorById` for existing party-member rewards.

### `isSatisfied(entry, context)`

Return true only when validation succeeds and the exact exit has `hiddenFromPlayer === false` with `discoveryDifficulty === null`.

### `apply(entry, context)`

Call the shared reveal helper with the pinned source/exit/destination ids. Return canonical route metadata and whether mutation occurred.

### `summarize(entry, result, context)`

Return display-ready metadata:

```js
{
  id,
  type: 'knowledge',
  subtype: 'route',
  label,
  description,
  sourceLocationId,
  sourceLocationName,
  targetId,
  destinationLocationId,
  destinationLocationName,
  direction,
  alreadySatisfied,
  rewardLine,
  refresh: {
    locationIds: [sourceLocationId],
    regionMap: true,
    worldMap: true,
    favorites: true
  }
}
```

The reward line should say that the route was learned/revealed, not that the destination was visited or unlocked for fast travel.

## Quest Creation and XML

### Prompt context

Quest generation may offer a route-knowledge reward only from an authoritative GM-only list of eligible hidden exits. Each candidate needs exact:

- source location id/name;
- exit id and source direction;
- destination location id/name and region;
- short player-safe reward label.

Do not ask the model to reconstruct ids already known by the server. If no eligible hidden exits are present in the supplied generation context, the prompt must not emit a route benefit.

### Strict XML shape

Extend quest reward XML with:

```xml
<benefits>
  <knowledgeRoute>
    <sourceLocationId>loc_12</sourceLocationId>
    <exitId>exit_7</exitId>
    <destinationLocationId>loc_19</destinationLocationId>
    <label>The concealed stair into the Sunken Archive</label>
    <description>The archivist teaches the opening sequence.</description>
  </knowledgeRoute>
</benefits>
```

`description` may be empty; every other child is required exactly once. Unknown, duplicate, missing, mismatched, already-visible, or ineligible targets cause retryable parser failure before a quest candidate is registered or shown for confirmation.

Update every standard and TinyBrain path that creates or locally assembles quest data. Any recorded XML used by affected tests must be migrated to the new schema rather than adding prompt-output compatibility branches.

The server canonicalizes the stable benefit id as `knowledge-route:<sourceLocationId>:<exitId>`; the LLM is not asked to invent it.

## Quest Acceptance, Editing, and Persistence

- `Quest` already persists normalized `rewardBenefits` and `appliedRewardBenefitIds`; extend serializers only where generic benefit projection currently drops subtype-specific fields.
- Pending quest confirmation records must retain the canonical route fields across clients and saves.
- Base prompt context must serialize `subtype`, source, and destination ids/names so later quest reasoning understands the promised reward without exposing unrelated hidden exits.
- Quest edit API validation must accept the canonical route shape and reject partial/mismatched ids with HTTP 400.
- The quest editor gains a narrow “Route knowledge” benefit row alongside “Party member,” populated from currently eligible hidden exits. Do not use a free-form exit-id text box when authoritative options are available.
- Editing an already-applied benefit may not change its type, subtype, source, exit, or destination identity. Reuse and extend the existing applied-benefit identity guard.
- Old saves with only party-member benefits remain valid. Unknown benefit types remain explicit load errors under the existing registry contract.

## Completion, Failure, and Idempotency

Reward application keeps the existing transaction ordering:

1. normalize benefit list;
2. skip ids already present in `appliedRewardBenefitIds` while still rebuilding summary metadata;
3. validate the route target;
4. reveal it or recognize it as already visible;
5. persist that benefit id immediately;
6. continue conventional rewards;
7. set `rewardClaimed` only after all rewards succeed;
8. generate reward prose from the applied results.

If the route target was deleted or retargeted, throw a clear error naming the quest, source location id, and exit id. Leave the benefit id unapplied and `rewardClaimed` false. Do not create a replacement route, reveal another same-name exit, or silently turn the entry into a narrative note.

A retry after restoring the exact route applies once. A retry after the player independently revealed it records the benefit as already satisfied and completes cleanly.

## UI and Route-Inspector Integration

Update all reward projections and presentations that currently assume every benefit is a party member:

- inline pending quest offer;
- quest confirmation manager;
- active/completed quest cards;
- quest editor;
- reward completion summaries;
- base prompt context.

Display route knowledge as, for example, `Route knowledge: Old Gatehouse → Hidden Garden`. Never label it “Destination unlocked” or “Fast travel unlocked.”

When the reward applies:

- request current-location refresh only if the source is current;
- refresh Region Map, World Map, and Favorites data;
- include a `View route` action when the destination is represented by the route-inspector contract;
- opening that action is read-only and may show Travel disabled if the destination is unvisited, a stub, or otherwise unavailable.

If the route was already visible, show an unobtrusive “Route already known” result while still treating the benefit as successfully satisfied.

## Implementation Tasks

### Task 1: Shared reveal service

**Files:**

- Modify: `HiddenDiscovery.js`
- Modify: `Events.js`
- Modify: `tests/hidden_discovery_events.test.js`
- Modify: `tests/hidden_discovery_models.test.js`

Extract, test, and adopt one direct-exit resolution/mutation path. Preserve event-specific current-location name validation and refresh behavior.

### Task 2: Register the `knowledge/route` benefit

**Files:**

- Modify: `QuestRewardBenefitRegistry.js`
- Modify: `tests/quest.nonmaterial_rewards.test.js`
- Add: `tests/quest.route_knowledge_reward.test.js`

Test normalization, unsupported subtype rejection, exact identity validation, application, already-satisfied behavior, deleted/retargeted exits, directed asymmetry, and per-benefit retry idempotency.

### Task 3: Preserve the full benefit shape

**Files:**

- Modify: `Quest.js` if generic normalization needs subtype-aware projection
- Modify: `QuestConfirmationManager.js`
- Modify: `Events.js`
- Modify: `api.js`
- Modify: `chat_tool_calls.js`
- Modify: `prompts/base-context.xml.njk`

Audit every `.map(...)` over `rewardBenefits`; several current projections retain only `id`, `type`, `targetId`, `label`, `description`, and `role`. Add explicit typed serialization so knowledge fields cannot disappear between generation, pending confirmation, acceptance, editing, save/reload, prompt context, and completion.

### Task 4: Extend standard and TinyBrain quest generation

**Files:**

- Modify: `prompts/_includes/quest-generate.njk`
- Modify the applicable TinyBrain quest-generation prompt/parser/result-builder files identified during implementation
- Modify: `Events.js`
- Update affected replay XML/fixtures under `tests/`

Provide only eligible authoritative candidates, require strict `knowledgeRoute` children, resolve names/ids before mutation, and log every new prompt through the existing `LLMClient.logPrompt()` path.

### Task 5: Quest confirmation/editor/display UI

**Files:**

- Modify: `views/index.njk`
- Modify: `public/js/chat.js`
- Modify: `public/css/main.scss`
- Compile: `public/css/main.css`
- Compile: `public/css/main.css.map`
- Modify: `tests/quest_editor_reward_ui.test.js`
- Modify: `tests/quest.nonmaterial_rewards.test.js`

Add route-benefit display and an authoritative editor selector. Ensure mobile layout, keyboard labeling, pending-offer persistence, and applied-benefit edit locks remain correct.

### Task 6: Route refresh and summary action

**Files:**

- Modify: `Events.js`
- Modify: `public/js/chat.js`
- Modify: `views/index.njk`
- Modify: `public/js/map.js` and/or `public/js/world-map.js` only for the shared route-inspector opening hook
- Add: `tests/e2e/quest-hidden-route-reward.spec.js`

Verify the hidden exit is absent before completion, visible afterward, and immediately inspectable without implying visit or fast-travel access.

### Task 7: Documentation

**Files:**

- Modify: `docs/ideas/quest_nonmaterial_rewards_plan.md`
- Modify: `docs/classes/QuestRewardBenefitRegistry.md`
- Modify: `docs/classes/Quest.md`
- Modify: `docs/classes/Events.md`
- Modify: `docs/classes/LocationExit.md`
- Modify: `docs/api/quests.md`
- Modify: `docs/ui/chat_interface.md`
- Modify: `docs/ui/maps.md`
- Modify: `docs/README.md`

Document `knowledge/route` as implemented while leaving every other proposed knowledge subtype explicitly unsupported.

## Verification

Run at minimum:

```bash
node --check HiddenDiscovery.js
node --check QuestRewardBenefitRegistry.js
node --check Quest.js
node --check QuestConfirmationManager.js
node --check Events.js
node --check api.js
node --check chat_tool_calls.js
npm run scss:build:main
node --test tests/hidden_discovery_events.test.js tests/hidden_discovery_models.test.js tests/quest.nonmaterial_rewards.test.js tests/quest.route_knowledge_reward.test.js tests/quest_editor_reward_ui.test.js tests/map_route_inspection.test.js
npm run test:e2e:headless -- tests/e2e/quest-hidden-route-reward.spec.js
```

Also run affected quest generation/parser, pending-confirmation persistence, save/reload, reward retry, TinyBrain, base-context, map, and hidden-discovery suites.

The Playwright scenario should:

1. load a fixture with one accepted quest and one hidden directed exit;
2. prove the exit and route are absent from normal UI/map/preview before completion;
3. complete the final objective;
4. prove the benefit applies once and the exit becomes visible;
5. open View route and verify the route is inspectable;
6. prove the destination remains unvisited and Travel remains disabled;
7. reload the save and prove reveal/applied-benefit state persists;
8. retry rewards and prove no duplicate mutation or summary occurs.

Store artifacts under `tmp/`. Restart the regular server only with current user permission and without loading a save.

## Completion Criteria

- `knowledge/route` is the only newly supported knowledge subtype.
- The reward targets one exact existing directed exit and cannot drift by name.
- Completion reveals through the same atomic helper as normal reveal events.
- Independent early discovery is idempotent success; missing/retargeted targets fail explicitly and remain retryable.
- No visit, stub expansion, reverse-edge reveal, destination creation, or fast-travel grant occurs.
- All quest projections preserve the typed fields across prompts, confirmation, editing, save/load, completion, and summaries.
- Standard and TinyBrain paths have equivalent support and strict parsers.
- The newly known route appears in the route inspector without leaking any other hidden route.
- Focused Node and Playwright coverage passes, SCSS is compiled, and documentation reflects only the shipped subtype.
