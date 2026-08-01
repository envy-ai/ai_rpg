# Faction Influence Mod — Implementation Plan

## Status

Proposed. No location-scoped entity fields, no faction-influence tracking, and no
faction-influence mod exist yet.

## Goal

Give every location a living map of faction presence — which factions hold sway
there, how strongly, and how that balance shifts as the story unfolds — and let
it shape the game: who shows up, what the GM prose emphasizes, and when control
of a place visibly changes hands.

Concretely: a new bundled mod, `mods/faction-influence`, that registers a
`factionInfluence` field on locations (`{ factionId: 0–100 }`), exposes it to
location generation and the location edit modal, nudges it through a new
mod-registered XML event, and injects it into prompts. When one faction's
influence overtakes the declared controller's by a configurable margin, the mod
announces — and optionally applies — a change of control.

## Core Decision

**Two workstreams: infrastructure first, mod second.** The mod is only possible
because locations currently have no entity-field support at all. Workstream A
adds generic `'location'` support to the entity-field system (a feature every
future location-field mod needs — see the brainstorm list: lighting, danger
rating, prosperity, rest quality, …). Workstream B builds the faction-influence
mod on top of it, using only existing mod hooks wherever they exist.

**Influence complements `controllingFactionId`; it does not replace it.**
`Location.#controllingFactionId` (Location.js:39) remains the declared,
single-faction controller written by location generation and the edit modal.
`factionInfluence` is the dynamic, granular layer underneath. The mod *derives*
de facto control from the influence map and, on a threshold crossing, offers the
control-change event; whether it also rewrites `controllingFactionId` is a
config option (default: announce only).

**Phase 1 effects are prompt-level and event-level only.** Influence affects
generated NPC faction weighting and GM prose through existing prompt hooks, and
changes through a mod-registered XML event. Mechanical effects on barter pricing
and NPC dispositions require hooks that do not exist today (see Non-Goals /
Phase 2).

## Existing Foundations

Verified against the codebase:

- `ModExtensionRegistry.#normalizeEntityType` (ModExtensionRegistry.js:194-196)
  has **no whitelist** — `registerEntityField({ entityType: 'location' })`
  registers today but has zero consumers. Reserved-name checks exist only for
  `'thing'` (1214-1216) and `'player'` (1217-1219).
- `extension_field_access.js` is fully generic: `createExtensionFieldAccess({
  entityType, label })` already powers identical Player and Thing wiring.
- Player wiring to copy: factory instance (Player.js:17), `#extensionFields`
  (114), constructor install+apply (2292-2293), accessors (4024-4049), `toJSON`
  spread (6373), `fromJSON` extract (6473).
- Location equivalents: constructor (Location.js:297, field init 335-405),
  serialization object `getDetails()` (1493-1543), save-load hydration field
  mapping in Utils.js:2190-2227 (there is no `Location.fromJSON`).
- Edit-modal precedent (this week's Player work): server injection
  (server.js:31403-31404), client config (views/index.njk:3134-3135), modal
  section + renderers (16179-16273), PUT handling with parse/apply helpers
  (api.js:514, 601-623, applied 30443-30444). `PUT /api/locations/:id` exists
  (api.js:34350-34603) and `#locationEditModal` exists (views/index.njk:2843)
  with a controlling-faction select already present (2890-2891).
- Location generation: `renderLocationGeneratorPrompt` (payload ~server.js:26380-26452,
  template `prompts/_includes/location-generator-full.njk`), parsed by
  `Location.fromXMLSnippet` (Location.js:407-730) which generically captures
  unknown tags (443-466) but drops them when forwarding (648-729).
  `modGenerationPromptInstructions` with `generationType: 'location'` already
  renders (server.js:26449).
- Mod XML events: `registerXmlEvent({ modName, tagName, eventKey, promptSchema,
  parser, handler })` (ModExtensionRegistry.js:692-729); flow at Events.js:6366-6377,
  5638-5664, 6406-6413, 6940-6959. Prompt schemas render in
  `prompts/_includes/events-xml-schema.njk:29-45`. Working example:
  `mods/implants/mod.js:348-387`.
- Faction model: `Faction` with relations and `reputationTiers`
  (Faction.js:126-156, 335-352); player standings
  (Player.js:3892-4100); the witness-gated `faction_reputation_change` handler
  (Events.js:13286-13388).
- Prompt injection: `registerBaseContextContributor` (ModExtensionRegistry.js:771
  → base-context.xml.njk:151) and `registerGenerationPromptInstruction`
  (904-947; types `item|location|region` only, 566-573).
- Mod settings UI: `registerSettingTab`/`registerSettingField` (1074-1143,
  rendered in views/settings.njk). Mod data endpoints: `registerModRoute`;
  client JS/CSS auto-injection from a mod's `public/` dir (server.js:31375-31406).

## Workstream A — Location entity-field infrastructure

### A1. Registry support

- Add `#locationReservedFieldNames` (id, name, description, shortDescription,
  baseLevel, exits, visited, favorite, imageId, imagePrompt, imageVariants,
  createdAt, lastUpdated, isStub, stubMetadata, hasGeneratedStubs, npcIds,
  statusEffects, thingIds, generationHints, randomEvents, regionId,
  controllingFactionId, vehicleInfo, lastVisitedTime, characterConcepts,
  enemyConcepts — from Location.js:17-43) and a `'location'` branch in
  `registerEntityField` (ModExtensionRegistry.js:1214-1219).
- Add reserved XML prompt tags for locations in
  `#normalizeEntityFieldXmlPrompt` (265-270): name, description,
  shortDescription, controllingFaction, relativeLevel, numNpcs, numItems,
  numScenery, numHostiles, randomStoryEvents, hasWeather.
- `exposeToCreateTool`/`exposeToUpdateTool`: no location chat tools exist;
  reject these flags for `'location'` with a clear error (or silently ignore —
  decide and document).

### A2. Location wiring (mirror Player.js)

- `const locationExtensionFields = createExtensionFieldAccess({ entityType:
  'location', label: 'Location' })` in Location.js.
- `#extensionFields = {}`; constructor rest `...extensionFieldInputs`,
  install accessors + apply before registry indexing (~Location.js:396).
- Public `getExtensionField`/`setExtensionField`/`getExtensionFields`.
- Spread `...this.getExtensionFields()` in `getDetails()` (1493-1543).
- Hydration: spread `...locationExtensionFields.extractInputs(locationData)`
  into the `new Location({...})` mapping at Utils.js:2190-2227.
- Verify `StatusEffect`-style private-field patterns are unnecessary here (the
  factory handles storage; Location only delegates).

### A3. Edit modal

- Inject `locationEditFields: modExtensionRegistry.getEntityFields('location',
  { exposeToEditModal: true })` next to server.js:31403-31404; expose as
  `window.AIRPG_CONFIG.locationEditFields` next to views/index.njk:3134-3135.
- Add a Mod Fields section to `#locationEditModal` (views/index.njk:2843+),
  reusing the shared render/parse/collect helpers introduced for Player fields
  (getRegisteredPlayerEditFields pattern, 16179-16273) — factor the three
  near-identical helper sets (thing/player) into one parameterized set while
  touching this, or copy the pattern a third time and refactor later; decide at
  implementation time. `type: 'object'` fields render as JSON textareas today.
- `PUT /api/locations/:id` (api.js:34350-34603): extract/apply registered
  location fields via the same payload-helper pattern (api.js:601-623), with
  400 on validation failure.

### A4. Generation scaffolding and parsing

- Add `getLocationGeneratorPromptFields()` (mirror
  `getPlayerGeneratorPromptFields`, server.js:21122-21125) and a
  `prompts/_includes/location-generator-fields.njk` include (mirror
  `_includes/player-generator-fields.njk`), included by
  `location-generator-full.njk` (and `-stub.njk` if stubs should carry fields).
  Wire the variable through `renderLocationGeneratorPrompt`'s payload
  (~server.js:26380-26452). **Do not repeat the NPC mistake** — the variable
  must actually reach the render context (see the playerGeneratorPromptFields
  fix, commit pending review).
- Add `getLocationExtensionFieldInputsFromXmlNode` (mirror server.js:21252-21276)
  and use it in `Location.fromXMLSnippet`: the generic capture (Location.js:443-466)
  already picks up unknown tags; normalize+validate them through the registered
  fields and forward into `new Location(...)` (715-729) and stub promotion
  (648-662).

### A5. Tests for Workstream A

- Registry: location reserved names, duplicate rejection, edit-metadata
  normalization (extend tests/mod_extension_hooks.test.js patterns).
- Location round-trip: register field → `new Location` → `getDetails()` →
  rehydrate via the Utils.js:2190 path → value intact.
- UI source-grep test (mirror tests/mod_npc_edit_fields_ui.test.js) for
  `locationEditFields` injection, modal section, and PUT wiring.
- Generation: render `location-generator-full.njk` with a registered field and
  assert the scaffold appears; parse a snippet with the tag and assert the
  value lands on the Location.
- Full suite must match the 24-failure baseline (tmp/audit/baseline_nonum.txt).

## Workstream B — The `faction-influence` mod

### B1. Field registration

```js
scope.registerEntityField({
    entityType: 'location',
    fieldName: 'factionInfluence',
    type: 'object',
    description: 'Map of faction name or ID to influence 0-100...',
    exposeToGeneratorPrompt: true,
    exposeToXmlParser: true,
    exposeToEditModal: true,
    edit: { label: 'Faction influence', inputType: 'textarea', order: 30,
            description: 'JSON object: { "Faction Name": 0-100 }' },
    xmlPrompt: {
        tagName: 'factionInfluence',
        placeholder: 'One <faction name="Exact faction name" influence="0-100"/> per faction with a meaningful presence; omit factions with no presence.'
    },
    validateValue(value, { fieldName }) {
        // plain object; keys resolve to factions (by id or exact name);
        // values finite numbers clamped to 0-100; unknown factions throw.
    }
});
```

Values are normalized to faction **IDs** at write time (resolve names via
`Faction.getByName`, mirroring resolveFactionNameToId at server.js:17587), so
prompts and events always read a canonical shape. Faction deletion leaves stale
keys; a load-time prune is acceptable (log once, drop the key).

### B2. Prompt surfacing (existing hooks only)

- `registerBaseContextContributor`: emit a compact `<factionInfluence>` block
  for the current location (and optionally the current region's locations where
  influence is contested, margin configurable) — faction name, value, and the
  derived de facto controller. This is the GM-prose lever: patrols, accents of
  power, who watches whom.
- `registerGenerationPromptInstruction({ generationTypes: ['location'] })`:
  instruct location/NPC generation to weight spawned NPC faction membership by
  the influence map (majority faction common, minority rare, zero-influence
  factions absent) and to keep generated `controllingFaction` consistent with
  the leader. Note: this instruction reaches the location generator directly;
  NPC batch prompts (`location-generator-npcs.xml.njk`) see it via base
  context — verify during implementation and, if needed, pass the map into
  `renderLocationNpcPrompt` explicitly.

### B3. The `factionInfluenceChange` event

`registerXmlEvent({ tagName: 'factionInfluenceChange', eventKey:
'faction_influence_change', promptSchema, parser, handler })`:

```xml
<factionInfluenceChange>
  <factionName>Exact faction name</factionName>
  <direction>increase|decrease</direction>
  <magnitude>small|medium|large</magnitude>
  <reason>One sentence</reason>
</factionInfluenceChange>
```

- Magnitudes map to ±5/10/20 (configurable via mod settings).
- Handler: resolve faction (reuse witness-gating philosophy from
  `faction_reputation_change`, Events.js:13306-13359 — only apply if the event
  is observable at the current location), clamp 0-100, apply to the **current
  location's** map, record into `context.factionInfluenceChanges` for the
  turn-diff UI.
- **Threshold crossing:** after applying, if a non-controller's influence now
  exceeds the controller's by the configured margin (default 20), either
  (a) append a chat-visible "control of X is slipping" status entry
  (default), or (b) additionally rewrite `Location.controllingFactionId`
  (config option). Never rewrite silently without a visible entry.

### B4. Settings (World Profiles)

`registerSettingTab` "Faction Influence" with fields: enabled, shift magnitudes
(3 integers), control-change margin (integer, default 20), apply-control-change
(boolean, default false), contested-influence floor for base-context surfacing
(integer, default 30).

### B5. Overview UI (optional, no new hooks)

A small client script in the mod's `public/` dir + a `registerModRoute` JSON
endpoint returning all locations with influence maps; renders a sortable
influence table in a modal opened from a chat-page button. Uses only the
existing client-injection mechanism (server.js:31375-31406). Defer if scope
creeps; the edit modal already provides per-location viewing/editing.

### B6. Mod manifest/docs

`mod.yaml` (manifest), `docs/mods/faction-influence.md` mirroring
docs/mods/nsfw-boost.md structure; index in docs/README.md; note in
docs/modding_hooks.md that `'location'` entity fields exist (with the
create/update-tool limitation).

## Non-Goals / Phase 2

- **Barter pricing and disposition effects.** No registry hooks exist for
  either (verified: ModExtensionRegistry.js:643-1462). Phase 2 would add a
  `registerBarterPriceModifier` / `registerDispositionModifier` hook and have
  the mod translate influence into prices and reactions. Explicitly out of
  scope here.
- Region-level influence maps (regions already have `controllingFactionId`;
  derive regional pictures by aggregating member locations instead of adding a
  second map).
- Time-based influence decay or drift (needs a scheduled-event integration;
  possible later via the existing scheduled-event runtime).
- Faction-vs-faction wars modeled as influence transfers (emergent from events
  already; no dedicated system).

## Implementation Tasks

1. **A1-A2**: registry + Location wiring + hydration; unit tests.
2. **A4**: generation scaffold + `fromXMLSnippet` extraction; render/parse
   tests (with a regression test asserting the variable reaches the render
   context).
3. **A3**: edit modal injection, section, PUT handling; UI source-grep test.
4. **B1-B2**: mod skeleton, field registration, prompt contributors; manual
   smoke (generate a location with factions present; verify the map appears
   and is filled).
5. **B3**: XML event parser/handler + threshold logic; handler tests mirroring
   `faction_reputation_change` coverage (tests/events.* patterns).
6. **B4 (+B5 optional)**: settings tab; overview endpoint/UI if in scope.
7. Docs + full suite at baseline (tmp/audit/baseline_nonum.txt) + a live
   playthrough check: generate a contested town, drive an influence event
   through prose, observe the control-change announcement.

## Verification Matrix

| Scenario | Assertion |
| --- | --- |
| Field registered, location generated | Generated location has influence map matching generated controllingFaction |
| Save/load round-trip | Influence map survives hydration byte-identically |
| Edit modal save | JSON edit persists; invalid JSON/faction/range → 400, no partial write |
| Prose with faction action | `factionInfluenceChange` parsed, clamped, witness-gated, applied to current location |
| Threshold crossing (announce mode) | Status entry appears; `controllingFactionId` unchanged |
| Threshold crossing (apply mode) | `controllingFactionId` updated; status entry appears |
| NPC generation in influenced location | Prompt shows weighting instruction; spawned NPC factions skew accordingly |
| Unknown faction in any path | Explicit validation error; nothing written |
| Mod disabled | No field, no prompt blocks, no event tag; saves still load (field ignored on hydrate) |

## Definition Of Done

- A mod can `registerEntityField({ entityType: 'location', ... })` and get
  persistence, hydration, generation scaffolding/parsing, and edit-modal
  support with no core-code changes beyond Workstream A.
- The faction-influence mod works end-to-end with the mod enabled and is
  fully inert (no schema, prompts, or events) when disabled.
- All new tests pass; the full suite matches the pre-work baseline failures.
- Documentation updated and indexed in docs/README.md.
