# World Inspector and Editor Brainstorm

This document expands the world inspector idea from `user_experience_improvement_brainstorm.md`. It is a brainstorm, not an implementation spec. The core premise is an in-app developer/admin tool for inspecting, validating, navigating, and eventually editing the live game world without relying on ad hoc console inspection or raw save-file surgery.

## Core pitch

The game world is a graph of players, NPCs, locations, regions, exits, pending stubs, items, containers, vehicles, factions, quests, summaries, memories, weather, world time, and prompt-generated history. When something goes wrong, the hard part is often not fixing it; it is seeing exactly what state exists, which references point where, and which invariants are broken.

A world inspector/editor would provide a structured, searchable, relationship-aware view of the current save and runtime state. Editing should come later and be guarded by validation, previews, explicit confirmation, and audit trails.

## Goals

- Make live world state inspectable from the browser.
- Surface graph/reference problems clearly.
- Help debug generated saves, event outcomes, movement, containers, vehicles, factions, quests, and NPC state.
- Provide backlinks and relationship views, not just raw JSON.
- Validate invariants and distinguish errors, warnings, and informational checks.
- Enable careful, explicit repairs and edits without silent fallbacks.
- Reuse existing serializers and model APIs where possible.
- Keep destructive actions isolated, labeled, confirmed, and auditable.
- Support long-term growth into a safer world editor.

## Non-goals

- Do not make a full content creation studio in the first version.
- Do not replace normal player-facing edit modals where they already work.
- Do not silently repair data without an explicit user action.
- Do not expose secrets, API keys, or sensitive config values.
- Do not make raw JSON editing the primary workflow.
- Do not bypass model validation just to make edits convenient.
- Do not hide validation failures behind "best effort" saves.

## Audiences and modes

### Read-only inspector

The first and safest mode. It shows state, references, and validation results. No mutations.

Useful for:

- Debugging odd UI state.
- Understanding a generated world.
- Auditing save/load behavior.
- Inspecting event-check outcomes.
- Finding dangling references.

### Guided editor

Structured forms and action buttons for safe edits:

- Move NPC to location.
- Reassign location region.
- Repair reverse exit.
- Edit faction reference.
- Move item between location/inventory/container.
- Clear invalid pointer.
- Mark stub metadata.
- Adjust world time through existing helpers.

Each edit should validate, preview, apply, and refresh.

### Repair console

A focused set of explicit repair actions for known invariant problems. Repairs should show what they will do before applying.

Examples:

- Remove dangling NPC id from a location.
- Remove missing thing id from a container.
- Rebuild static indexes.
- Reconcile party members as off-location actors.
- Fix one-way exits when safe.
- Clear invalid faction references.
- Rebuild pending region stubs.

### Expert raw view

A raw JSON/XML view is useful for debugging, but it should be read-only at first. If raw editing is ever added, it should be behind a separate expert mode with full validation and diff preview.

## Information architecture

### Overview dashboard

Show a current-save snapshot:

- Save name and version.
- Current player.
- Current location and region.
- World time and calendar.
- Player party count.
- Counts for players, NPCs, locations, regions, stubs, exits, things, containers, factions, quests, active prompts, image jobs.
- Validation status summary.
- Recent errors/warnings.
- Active vehicle trips.
- Pending ability-selection blockers.

### Entity browser

Searchable list of all major entities:

- Players and NPCs.
- Locations.
- Regions.
- Exits.
- Pending stubs.
- Things.
- Containers.
- Factions.
- Quests.
- Skills.
- Status effects.
- Chat entries and summaries.
- Prompt jobs/log references where available.

Filters:

- Type.
- Region/location.
- Party/non-party.
- Dead/alive.
- Stub/hydrated.
- Vehicle/non-vehicle.
- Container/non-container.
- Has invalid references.
- Has image job.
- Recently updated.

### Detail view

Each entity detail view should show:

- Human-readable summary.
- Core fields.
- Relationship links.
- Backlinks.
- Validation findings.
- Raw serialized data.
- Related chat/event entries where available.
- Safe actions.
- Edit history/audit entries if available.

### Relationship graph

Graph views are especially useful for:

- Region -> locations -> exits.
- Location -> NPCs/things/exits.
- Player -> party -> inventories -> containers.
- Faction -> relations -> standings -> controlled locations/regions.
- Vehicle -> current outside exit -> destination/pending destination.
- Quest -> giver -> objectives -> rewards.

This can start as lists/backlinks before becoming a visual graph.

## Domain views

### Players and NPCs

Inspect:

- Identity, aliases, party membership, current location.
- Health, max health, dead/persistent corpse state.
- Attributes, skills, abilities, unspent point calculations.
- Need bars and applicability.
- Status effects and intrinsic status effects.
- Gear, inventory, currency.
- Factions and standings.
- Dispositions, goals, memories, character arc.
- Party invariants.

Useful validations:

- Party members should not also be listed in location NPC lists.
- Current player should have a valid current location.
- Dead NPCs should have coherent corpse/persistence state.
- Gear should reference inventory items.
- Need-bar applicability should match definitions.
- Faction ids should resolve.

### Locations, exits, and stubs

Inspect:

- Location description, short description, base level, region, controlling faction.
- NPC ids and thing ids.
- Exits by direction.
- Exit destination, destination region, bidirectional flag, travel time, vehicle metadata.
- Stub metadata and generation hints.
- Visit state and last visited time.
- Random events and status effects.

Useful validations:

- Region membership matches `location.regionId`.
- Exits point to valid locations or valid pending stubs.
- Reverse exits exist when expected.
- Travel times are non-negative integers.
- Stub metadata is complete enough for expansion.
- Current player location is not deleted or orphaned.
- Vehicle exits do not expose invalid underway/finalizing travel state.

### Regions

Inspect:

- Region hierarchy.
- Entrance location.
- Location ids.
- Average level and relative level.
- Controlling faction.
- Weather definitions/state.
- Vehicle info.
- Random events, secrets, concepts.

Useful validations:

- Entrance location is in the region.
- Location ids resolve.
- Parent hierarchy has no cycles.
- Weather durations are valid.
- Vehicle info references valid exits/destinations.
- Pending region stubs are not duplicated.

### Things, inventories, and containers

Inspect:

- Thing type, count, rarity, level, flags.
- Ownership and placement metadata.
- Inventory owner.
- Container owner and contained ids.
- Gear state.
- Status effects and cause effects.
- Harvest history.
- Checksum and stack merge compatibility.

Useful validations:

- Thing appears in exactly one valid placement context unless explicitly allowed.
- Container contents resolve.
- Container nesting has no cycles.
- Equipped items belong to the actor inventory.
- Location thing ids match thing metadata.
- Inventory item ids resolve.
- Non-empty container deletion is blocked.

### Vehicles

Inspect:

- Vehicle-capable locations and regions.
- Terrain tags and icon.
- Current destination.
- Pending destination.
- Fixed route destinations.
- ETA and departure time.
- Vehicle exit id.
- Derived underway/arrived/arriving state.
- Outside location resolution.

Useful validations:

- `vehicleExitId` resolves.
- ETA/departure consistency matches `VehicleInfo` rules.
- Current and pending destinations are not both set.
- Fixed-route entries resolve or are valid `pending-region:` entries.
- Hidden disembark/boarding rules are explainable.

### Factions and quests

Inspect:

- Faction goals, tags, assets, relations, reputation tiers.
- Controlled locations and regions.
- Player standings.
- NPC faction ids.
- Quest objectives, rewards, giver info, faction reputation rewards.

Useful validations:

- Faction relations point to valid factions and not self unless allowed.
- Player standings reference valid factions.
- Controlling faction ids resolve.
- Quest reward faction ids resolve.
- Quest objectives have coherent completion state.

### World time, weather, and calendar

Inspect:

- Canonical world time.
- Display time/date/season/holiday.
- Region weather state.
- Offscreen activity scheduling metadata.
- Vehicle ETAs.
- Status-effect/need-bar applied-at stamps.

Useful validations:

- Minute-canonical fields are integers.
- Weather next-change times are valid.
- Status effects have valid durations/appliedAt values.
- Actor elapsed/last-visited stamps are coherent.

### Chat, summaries, memories, and prompts

Inspect:

- Chat entries by type.
- Hidden entries.
- Scene summaries.
- Plot summary and plot expander entries.
- NPC important memories and selection state.
- Prompt-progress state if active.
- Recent prompt logs by metadata label if discoverable.

Useful validations:

- Chat entries have ids, locations, timestamps.
- Hidden entries are excluded from client history when expected.
- Summary ranges are coherent.
- Prompt-generated state mutations have linked summaries when relevant.

## Core architecture ideas

### Inspector resource registry

Define a registry of inspectable resource types. Each resource type can provide:

- Type key.
- Label.
- List function.
- Detail serializer.
- Relationship extractor.
- Backlink extractor.
- Validator.
- Safe action definitions.
- Edit form schema.

This keeps the inspector extensible instead of hardcoding every entity into one large route.

### Snapshot endpoint

A read-only snapshot endpoint could return:

- Counts.
- Current save metadata.
- Current player/location/region summary.
- Validation summary.
- Resource type availability.

Possible route idea:

- `GET /api/world-inspector/snapshot`

### Entity detail endpoint

Possible route idea:

- `GET /api/world-inspector/entities/:type/:id`

Returns:

- Summary.
- Serialized entity.
- Relationships.
- Backlinks.
- Validation findings.
- Available actions.

### Validation endpoint

Possible route idea:

- `POST /api/world-inspector/validate`

Supports:

- Whole-world validation.
- Domain validation.
- Single-entity validation.

### Action endpoint

Possible route idea:

- `POST /api/world-inspector/actions/:actionName`

Rules:

- Validate input.
- Build a transaction plan.
- Return preview when `dryRun=true`.
- Apply only when explicitly requested.
- Revalidate affected domains.
- Return before/after summary.

## Editing model

### Transaction preview

Every edit should produce a preview:

- Requested action.
- Entities affected.
- Before values.
- After values.
- Related references that will change.
- Validation errors that would remain.
- Client refresh requests that will be needed.

The user confirms the transaction before applying it.

### Structured edits over raw writes

Prefer intent-based actions:

- Move NPC.
- Move thing.
- Reassign location region.
- Add reverse exit.
- Clear invalid faction.
- Split/merge stack.
- Set vehicle destination.

Avoid direct arbitrary property editing until there is strong validation.

### Audit log

Edits should record:

- Timestamp.
- Actor/source: world inspector.
- Action name.
- Entity ids.
- Before/after summary.
- Validation status.

Audit entries could live in save metadata or a dedicated admin log. They should not enter normal base-context history unless explicitly designed to.

## Validation severity

Use clear severities:

- Error: data is invalid or likely to break gameplay/save/load.
- Warning: suspicious or stale data, but gameplay may continue.
- Info: useful diagnostic detail.

Examples:

- Error: exit destination does not exist.
- Error: container cycle detected.
- Error: current player location missing.
- Warning: exit travel time is `0` and may need backfill.
- Warning: NPC has no short description.
- Info: location has unvisited stub exits.

## Safety principles

- Read-only first.
- Explicit edit mode.
- Dry-run previews.
- No silent repair.
- No destructive bulk actions without confirmation.
- Validate after every applied edit.
- Prefer existing model methods over raw mutation.
- Respect current game-loaded state.
- Do not expose secrets.
- Do not automatically autosave after destructive edits unless explicitly configured or confirmed.
- Make it easy to manually save after a successful repair.

## UI ideas

### Layout

A practical layout:

- Left: resource type and search/filter list.
- Center: selected entity detail.
- Right: relationships, backlinks, validation, actions.

Mobile can collapse this into tabs:

- Browse.
- Detail.
- Links.
- Validate.
- Actions.

### Search

Global search should support:

- Name.
- Id.
- Alias.
- Location/region.
- Type.
- Invalid-only.
- Recently updated.

### Relationship links

Any referenced id should be clickable:

- NPC current location.
- Location region.
- Exit destination.
- Thing owner/container/location.
- Quest giver.
- Faction relation target.
- Vehicle destination.

Backlinks are just as important:

- "What points to this?"
- "Why can't I delete this?"
- "Where is this item referenced?"

### Validation panel

The validation panel should show:

- Findings by severity.
- Affected entities.
- Explanation.
- Suggested safe actions.
- Raw diagnostic data when expanded.

### Compare and diff

Before/after diff views should be compact and domain-aware:

- Moved NPC from location A to party.
- Cleared invalid faction id X from location Y.
- Removed missing thing id from container Z.
- Created reverse exit from B to A.

Raw JSON diff can be an advanced expansion.

## Integration with existing pages

### `/debug`

The world inspector could start as a richer `/debug` page or a new debug subpage. If it grows into an editor, a dedicated route may be cleaner.

### Existing edit modals

Where current edit modals already work, the inspector can link to them instead of duplicating behavior.

### Maps

Map pages can link to inspector views for:

- Locations.
- Regions.
- Exits.
- Stubs.
- Orphaned nodes.

### Chat and event summaries

Event summaries can link to affected entities. Inspector entity pages can link back to related summary entries.

## Known repair workflows

Useful first repair workflows:

- Find orphaned locations.
- Find dangling exits.
- Find stale region membership.
- Find location NPC ids that no longer resolve.
- Find party NPCs still listed in locations.
- Find invalid thing placements.
- Find container cycles.
- Find non-empty containers that are deletion-blocked.
- Find invalid faction references.
- Find invalid vehicle destination/exit state.
- Find missing travel times.
- Find missing short descriptions.

Existing slash commands like `/orphaned_locations`, `/fix_exits`, `/fill_exit_travel_times`, and `/short_description_check` suggest good early inspector panels.

## Testing ideas

Unit-level:

- Resource registry behavior.
- Relationship extraction.
- Backlink extraction.
- Validation checks.
- Transaction preview building.
- Dry-run no-mutation guarantees.
- Action application and post-validation.

Integration:

- Snapshot endpoint with loaded game.
- Entity detail for player/location/thing/region/faction/quest.
- Validation of deliberately malformed save fixture.
- Safe repair of a dangling reference.
- Move item transaction preview/apply.
- Rebuild party/location invariant.

Playwright:

- Open inspector.
- Search for current location.
- Navigate relationship links.
- Run validation.
- Expand a finding.
- Dry-run a repair.
- Apply a safe repair on fixture data.
- Confirm UI refreshes affected panels.

Fixtures:

- Dangling exit destination.
- Party NPC also in location list.
- Container cycle.
- Invalid faction id.
- Stale location region membership.
- Vehicle exit id missing.

## Rollout options

### Slice 1: Read-only snapshot and entity browser

Show counts, current player/location/region, entity lists, detail views, relationships, and raw JSON.

Pros:
- Low mutation risk.
- Immediately useful for debugging.

Cons:
- Does not repair problems yet.

### Slice 2: Validation dashboard

Add whole-world and entity-level validation with severity grouping and links.

Pros:
- Surfaces hidden corruption quickly.
- Helps prioritize repairs.

Cons:
- Requires careful validation design.

### Slice 3: Backlinks and graph views

Add "what points here?" for each entity plus region/location/exit graph views.

Pros:
- Makes delete/move/edit reasoning much easier.

Cons:
- Relationship extraction needs coverage across domains.

### Slice 4: Safe repair actions

Add explicit dry-run/apply actions for a small set of known repairs.

Pros:
- Solves real corruption/debugging pain.

Cons:
- Must be strongly tested to avoid making bad state worse.

### Slice 5: Guided editor

Add structured edit forms and transaction previews for common admin edits.

Pros:
- Turns inspector into a practical world editor.

Cons:
- Larger UX and validation surface.

### Slice 6: Advanced world editor

Support richer workflows: create locations/regions/things/NPCs, edit graphs, batch operations, import/export, and visual graph editing.

Pros:
- Powerful long-term admin tool.

Cons:
- High complexity and easy to blur into a full content studio.

## Strong first implementation candidate

The strongest first feature would likely be a read-only inspector plus validation dashboard:

- Route under `/debug` or a dedicated `/world-inspector`.
- Resource list for players, NPCs, locations, regions, exits, things, containers, factions, quests, and vehicles.
- Entity detail with relationships/backlinks.
- Whole-world validation summary.
- Raw JSON expansion.
- No mutations.

This gives immediate debugging value while avoiding the safety risks of editing.

## Open questions for a future spec

1. Should the inspector live under `/debug` or as a dedicated top-level route?
2. Should it be available in normal builds, or gated by config/developer mode?
3. Which validators should be considered errors versus warnings?
4. Where should inspector edit audit logs be stored?
5. Should safe repairs autosave, offer save, or never save automatically?
6. Should raw JSON editing ever be allowed?
7. Which existing slash-command diagnostics should be folded into the first validation dashboard?
8. How much hidden story/prompt data should be visible by default?
9. Should generated repair actions be possible, or only hand-coded actions?
10. How should inspector edits notify open chat/map/settings tabs to refresh?

