# Non-Material Quest Rewards Plan

## Implementation Status

The shared typed registry, persisted quest fields, narrative notes, per-benefit application ids, completion summaries, confirmation/editor/list UI, generic field mutation, and explicit pending-reward retry flow are implemented. `party-member` is the initial registered mechanical type. The other proposed types remain intentionally disabled and fail validation until their authoritative service, access, knowledge, ownership, title, or world-change systems and registered definitions exist.

## Goal

Support quest rewards that are not items, currency, XP, faction reputation, or NPC disposition changes. Examples include recruiting a party member, receiving a service or favor, gaining access credentials, learning a recipe, unlocking a destination, or acquiring property.

## Proposed Model

Add a persisted `rewardBenefits` array to `Quest`. Each entry is a validated typed union rather than an arbitrary tool call:

```js
{
  id: 'ragna_support',
  type: 'party-member',
  targetId: 'npc_ragna_kaen',
  label: "Ragna Kaen's raid-certified combat support",
  description: 'Ragna joins the party with her Emberclaw gauntlets and Bloodmoon raid credentials.'
}
```

Initial benefit types:

- `party-member`: add an existing NPC to the player's party.
- `service`: grant ongoing or limited access to an NPC or faction service.
- `favor`: record a callable promise owed to the player.
- `access`: grant a permit, credential, facility, or restricted-area entitlement.
- `knowledge`: unlock a recipe, ability, location, fast-travel destination, or important information.
- `property`: grant a home, workshop, vehicle, business, or similar persistent asset.
- `title`: grant a recognized rank, office, or honorific.
- `world-change`: apply a narrowly defined persistent favorable state change.

Purely descriptive promises with no authoritative mechanic should use a separate persisted `rewardNotes` array so the UI does not imply that free-form prose was mechanically enforced.

## Shared Handler Contract

Implement benefit behavior through a server-owned registry keyed by `type`. Each registered handler must provide:

- `normalize(entry, context)`: return the canonical persisted shape or throw a clear validation error.
- `validate(entry, context)`: resolve target ids and verify that the requested mechanic is supported before quest acceptance when possible.
- `isSatisfied(entry, context)`: determine whether the authoritative state already contains the benefit.
- `apply(entry, context)`: perform only the typed mutation owned by that handler.
- `summarize(entry, result, context)`: return structured, display-ready applied-result metadata for reward prose and UI refreshes.

Every benefit entry needs a stable id. Persist applied benefit ids on the quest so completion retries skip successful mutations while retrying only unapplied benefits. A handler must treat an already-satisfied state as success, but it must not silently reinterpret an unsupported or missing target.

## Handling By Benefit Type

### `party-member`

- Persist the canonical NPC id, display label, and optional role/context text.
- Validate that the target resolves to a living NPC and is eligible for party membership.
- Apply through the existing player party-membership API so location membership and party representation stay consistent.
- Treat an NPC already in the party as satisfied; do not add duplicates.
- Do not transfer the NPC's equipped or carried Things to the player.
- Emit actor and party refresh metadata. Save/load already persists party membership through player state.
- If the NPC is dead, deleted, or otherwise ineligible when completion occurs, fail that benefit clearly and leave it unapplied.

### `service`

- Add a persisted service-grant record with a stable service id, provider actor/faction id, service kind, remaining uses or unlimited status, availability conditions, and optional expiry.
- Validate the provider and a registered service kind. Each service kind owns execution rules, costs, targets, and UI entry points.
- Applying the quest reward creates or extends the grant; it does not immediately perform the service unless the benefit explicitly defines an immediate service.
- Service use must decrement finite uses atomically and record the use independently from quest reward application.
- Treat an equivalent unlimited grant or a grant with at least the awarded remaining uses as satisfied.

### `favor`

- Add a persisted favor record with debtor actor/faction id, status (`available`, `called`, `fulfilled`, or `void`), scope text, and optional expiry.
- Quest completion creates the available favor exactly once.
- Calling in a favor must be a separate validated action or event. It marks the favor called or fulfilled only when the promised outcome succeeds.
- Do not let free-form favor text execute arbitrary tools. Supported mechanical favor outcomes must reference a registered favor subtype; otherwise the favor remains a narrative hook visible to prompts and the UI.
- Preserve consumed/fulfilled favors for history instead of deleting them.

### `access`

- Add a persisted entitlement set keyed by a canonical access key, with source, label, scope, and optional expiry or revocation metadata.
- Require the access key to correspond to a registered gate, route, facility, activity, vendor privilege, or other access-controlled mechanic.
- Completion adds the entitlement; existing active entitlement is satisfied.
- Access checks in routes and gameplay systems query the authoritative entitlement set rather than matching prose.
- Revocation and expiry are separate mechanics and must not alter the quest's applied-benefit history.

### `knowledge`

- Use a registered subtype such as `recipe`, `ability`, `location`, `fast-travel`, `lore`, or `technique`, plus a canonical target id.
- Validate the target against the owning registry and apply through that system's existing unlock API.
- Existing unlocks are satisfied and are not duplicated.
- Recipe and ability unlocks must not create inventory Things. Location knowledge reveals information; fast-travel permission remains a separate flag when discovery alone is insufficient.
- Plain information without a mechanical registry target belongs in `rewardNotes` or a persisted lore/memory record, not a fake unlock id.

### `property`

- Use a registered subtype such as `location`, `vehicle`, `workshop`, `business`, or `outpost`, with a canonical entity id and ownership role.
- Validate that the entity exists, supports ownership, and is transferable under its owning model.
- Apply through the entity's ownership API, including any required faction, location, inventory, or vehicle index updates.
- Treat matching ownership as satisfied. Conflicting ownership must fail explicitly rather than overwrite another owner silently.
- Emit refresh metadata for every affected entity and persist ownership in that entity's normal save representation.

### `title`

- Add a persisted player title record with a canonical title key, display name, granting authority, and active/inactive state.
- Existing title ownership is satisfied. Equipping or displaying a title is separate from earning it.
- If titles carry mechanics, reference a registered title definition whose effects are derived by the normal stat/perk system; do not embed arbitrary modifiers in the quest.
- Revoked or inactive titles remain in history with their current state.

### `world-change`

- Require a registered world-change subtype and a strictly validated payload. Do not accept arbitrary property paths, generic tool names, or free-form mutation instructions.
- Each subtype owns target resolution, preconditions, mutation, idempotency, refresh metadata, and persistence. Examples might include opening a named route, establishing a faction outpost, or permanently repairing a specific facility.
- Prefer an existing domain API whenever the world change maps to one. Add a new subtype only when no narrower benefit type fits.
- Store a durable change key in the affected world state so `isSatisfied` can verify the outcome without relying only on the quest's applied-benefit list.
- Fail the benefit if current world state conflicts with its preconditions; never force an incompatible overwrite as a reward fallback.

### `rewardNotes`

- Persist trimmed display text only; reject blank entries.
- Show notes in confirmation, quest details, completion summaries, and relevant prompt context.
- Apply no mutation, require no handler, and never count a note as proof that a mechanic was granted.
- Mark notes presented when the quest reward completes, while retaining them permanently with the completed quest.

## Completion Behavior

1. Normalize and validate benefit entries when a quest is created, edited, or loaded.
2. Resolve referenced entities by canonical id before applying a benefit.
3. Dispatch each benefit to a dedicated server-owned handler; never execute arbitrary serialized tool calls.
4. Make handlers idempotent. An already-satisfied benefit, such as an NPC already being in the party, counts as successfully applied.
5. Record stable benefit ids as applied so a partial failure can be retried without duplicating earlier effects.
6. Set `rewardClaimed` only after every structured reward and benefit has been applied successfully.
7. Generate reward prose only from the authoritative applied results, preserving the existing presentation-only reward-prose boundary.

## Ragna Example

Ragna should be represented as a `party-member` benefit. Her Emberclaw gauntlets remain her equipment, and her Bloodmoon credentials remain part of her capabilities; neither should become a player inventory item. If her credentials also grant the player independent raid access, add a separate `access` benefit for that entitlement.

## Implementation Areas

- Extend `Quest` normalization, serialization, hydration, and editing with `rewardBenefits`, `rewardNotes`, and per-benefit application state.
- Add the shared benefit-handler registry and typed handler contract before enabling any generated benefit type.
- Add any required authoritative player entitlement, service/favor, title, and ownership state with save hydration and migrations.
- Extend quest-generation prompts and parsers in both standard and TinyBrain paths.
- Add typed completion handlers and structured completion summaries in `Events`.
- Add benefit previews to quest confirmation, quest editing, and active/completed quest displays.
- Include the new fields in generic prompt field mutation where appropriate.
- Update quest/API/UI documentation and save compatibility notes.

## Verification

- Unit-test every benefit type's validation, persistence, application, and idempotency.
- Contract-test every handler's `normalize`, `validate`, `isSatisfied`, `apply`, and `summarize` behavior.
- Test mixed conventional and non-material rewards, including partial failure followed by retry.
- Test unknown/deleted targets as explicit completion errors rather than silent skips.
- Test access expiry/revocation, finite service consumption, favor fulfillment, conflicting property ownership, and registered world-change preconditions.
- Test confirmation and quest-list rendering for mechanical benefits and narrative-only notes.
- Add an end-to-end recruitment quest proving that the NPC joins once, retains their equipment, and survives save/load.
