# Hidden Items, Scenery, and Exits Implementation Plan (Archived)

> **Archive status:** This is a historical implementation plan, not a description of current runtime behavior. As of this documentation refresh, current hidden-visibility support is implemented for living NPCs only. `Thing.js` and `LocationExit.js` do not expose persisted `hiddenFromPlayer`, `discoveryDifficulty`, `hiddenSource`, or `hiddenReason` fields; `HiddenDiscovery.js` and the hidden item/exit tests named below do not exist; and the current XML event schema documents hidden-NPC reveal/hide events, not hidden thing/exit reveal/hide events.
>
> **If this work is resumed:** Treat unchecked tasks as proposed work and refresh code locations before editing. Keep documentation updates durable and behavioral; do not add recency notes or changelog entries. Repo rule: do not run git commands unless the user explicitly authorizes them.

**Historical Goal:** Add persisted hidden-state, difficulty-label-based discovery, reveal/hide events/tools, and client UI controls for hidden items, scenery, and exits.

**Proposed Architecture:** Mirror the existing hidden-NPC model at the data/API/UI layers, but replace NPC opposed checks with unopposed standard difficulty checks built in code and resolved through `resolveActionOutcome`. Hidden things/exits would remain in server/client payloads and base-context with `<hidden>true</hidden>`, while the Adventure UI would hide them by default and disable normal interaction until revealed. Generated hidden things/exits would carry a normalized discovery difficulty label.

**Tech Stack:** Node.js CommonJS, Express routes in `api.js`, Nunjucks prompts, browser UI in `views/index.njk`, SCSS in `public/css/main.scss`, Node test runner.

---

## Current Project Baseline

- Current persisted hidden visibility is NPC-only. `Player.hiddenFromPlayer` is documented in `docs/classes/Player.md`, `docs/api/npcs.md`, `docs/api/common.md`, and `docs/ui/chat_interface.md`; dead NPCs/corpses are normalized or treated as visible.
- `Events.js` currently has hidden-NPC checks (`hiddenNpcChecks`) and XML `<revealHiddenNpc>` / `<hideVisibleNpc>` support. It does not currently parse or process `<revealHiddenThing>`, `<hideVisibleThing>`, `<revealHiddenExit>`, or `<hideVisibleExit>`.
- `Thing.js` and `docs/classes/Thing.md` cover items/scenery, containers, flags, effects, generation, APIs, and mod fields. They do not currently include hidden-discovery fields for items or scenery.
- `LocationExit.js` and `docs/classes/LocationExit.md` cover directed graph edges, travel time, vehicle edges, images, and map/travel semantics. They do not currently include hidden-discovery fields for exits.
- The Adventure UI currently has hidden-NPC show/hide controls and styling. It does not currently have show-hidden controls or disabled revealed-state behavior for hidden items, scenery, or exits.

## Proposed Key Decisions

- Store these fields on `Thing` and `LocationExit`:
  - `hiddenFromPlayer: boolean`
  - `discoveryDifficulty: "Trivial" | "Easy" | "Medium" | "Hard" | "Very Hard" | "Legendary" | null`
  - `hiddenSource: "generated" | "event" | "manual" | "tool" | null`
  - `hiddenReason: string | null`
- `hiddenFromPlayer === true` requires a valid `discoveryDifficulty` for generated content and event/tool-created hidden state. The UI context-menu toggle may stamp `Medium` when hiding manually so the operation is deterministic and prompt-free.
- Discovery checks use the active setting's `perceptionAttribute` and optional `perceptionSkill`. No hiding stat is used for things/exits.
- Discovery checks build a `Plausible` unopposed skill-check object with `circumstanceModifiers: []` and call `resolveActionOutcome({ plausibility, player })`.
- Do not add a new LLM prompt. Do not call a plausibility prompt for hidden-object discovery.
- Hidden exits are visible in payloads but not rendered as normal travel buttons unless the user enables `show hidden`; even then, hidden exit travel buttons remain disabled until revealed.
- Hidden items/scenery are visible in payloads but not rendered in normal item/scenery panels unless the user enables `show hidden`; even then, hidden item interactions that would use the object in-world remain disabled until revealed.
- Prompt context would include hidden objects/exits with `<hidden>true</hidden>` and `<discoveryDifficulty>...</discoveryDifficulty>`, plus instruction text that hidden entries are GM-known, not player-available until revealed.

## Proposed Scope From Brainstorm

- Generated hidden items, scenery, and exits get a difficulty label at generation/parse time; invalid or missing labels fail loudly for hidden generated content.
- Reveal/hide support covers XML events, legacy events, prose tools, manual UI toggles, API payloads, and save/load persistence.
- Server-side interaction gates prevent unrevealed hidden exits from being used for travel and prevent unrevealed hidden things from being used by normal pickup/crafting/location-interaction flows.
- Client show-hidden controls expose hidden content for debugging/GM use with translucent styling, but do not make that content interactable as if discovered.
- Discovery checks reuse the standard unopposed difficulty-check pipeline directly in code, with no plausibility/difficulty prompt and no circumstance modifiers.
- No automatic ambient room scan is included in v1; explicit prose/event/tool discovery drives reveal attempts so hidden content does not roll every time the player enters a location.

## Proposed File Map

- Create `HiddenDiscovery.js`: shared normalization and prompt-free discovery-check helpers.
- Modify `Thing.js`: add hidden fields, accessors, JSON persistence, metadata hydration compatibility, copy behavior.
- Modify `LocationExit.js`: add hidden fields, accessors, JSON persistence, reverse-exit copy behavior.
- Modify `server.js`: parse generated thing hidden fields, parse generated region/location exits hidden fields, include hidden fields in prompt payloads, expose helper dependencies.
- Modify `api.js`: accept hidden fields in thing and exit routes, reveal/hide object/exit chat tools, hidden-discovery checks, action gating.
- Modify `Events.js`: parse/process XML and legacy reveal/hide events for things and exits.
- Modify prompts:
  - `prompts/_includes/item.njk`
  - `prompts/_includes/item-output.njk`
  - `prompts/_includes/region-generator.njk`
  - `prompts/_includes/events-xml.njk`
  - `prompts/base-context.xml.njk`
- Modify `views/index.njk`: show-hidden toggles for scenery/items/exits, translucent hidden styling, context-menu `Toggle Hidden`, disabled hidden exit travel.
- Modify `public/css/main.scss`: hidden item/scenery/exit styling and toggle placement.
- Add tests:
  - `tests/hidden_discovery_models.test.js`
  - `tests/hidden_discovery_generation.test.js`
  - `tests/hidden_discovery_events.test.js`
  - `tests/chat_tool_hidden_objects.test.js`
  - `tests/ui.hidden_things_exits.test.js`
- Update docs:
  - `docs/classes/Thing.md`
  - `docs/classes/LocationExit.md`
  - `docs/classes/Events.md`
  - `docs/classes/EventsEventTypes.md`
  - `docs/classes/EventsXmlEventSchema.md`
  - `docs/api/chat.md`
  - `docs/api/common.md`
  - `docs/api/things.md`
  - `docs/api/locations.md`
  - `docs/server_llm_notes.md`
  - `docs/ui/chat_interface.md`

---

### Task 1: Add Model/Persistence Tests

**Files:**
- Create: `tests/hidden_discovery_models.test.js`
- Later modify: `Thing.js`, `LocationExit.js`

- [ ] **Step 1: Write failing tests for `Thing` hidden state**

Create `tests/hidden_discovery_models.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const Thing = require('../Thing');
const LocationExit = require('../LocationExit');

test('Thing persists hidden discovery fields through JSON', () => {
  const thing = new Thing({
    name: 'Loose Wall Panel',
    description: 'A wall panel concealed behind grime.',
    thingType: 'scenery',
    hiddenFromPlayer: true,
    discoveryDifficulty: 'Hard',
    hiddenSource: 'generated',
    hiddenReason: 'The seams are caked with dust.'
  });

  assert.equal(thing.hiddenFromPlayer, true);
  assert.equal(thing.discoveryDifficulty, 'Hard');
  assert.equal(thing.hiddenSource, 'generated');
  assert.equal(thing.hiddenReason, 'The seams are caked with dust.');

  const serialized = thing.toJSON();
  assert.equal(serialized.hiddenFromPlayer, true);
  assert.equal(serialized.discoveryDifficulty, 'Hard');
  assert.equal(serialized.hiddenSource, 'generated');
  assert.equal(serialized.hiddenReason, 'The seams are caked with dust.');

  const loaded = Thing.fromJSON(serialized);
  assert.equal(loaded.hiddenFromPlayer, true);
  assert.equal(loaded.discoveryDifficulty, 'Hard');
  assert.equal(loaded.hiddenSource, 'generated');
  assert.equal(loaded.hiddenReason, 'The seams are caked with dust.');
});

test('Thing rejects hidden state without a valid discovery difficulty', () => {
  assert.throws(() => new Thing({
    name: 'Hidden Latch',
    description: 'A small latch under the table.',
    thingType: 'scenery',
    hiddenFromPlayer: true
  }), /discoveryDifficulty/i);

  assert.throws(() => new Thing({
    name: 'Hidden Latch',
    description: 'A small latch under the table.',
    thingType: 'scenery',
    hiddenFromPlayer: true,
    discoveryDifficulty: 'Impossible'
  }), /discoveryDifficulty/i);
});
```

- [ ] **Step 2: Write failing tests for `LocationExit` hidden state**

Append:

```js
test('LocationExit persists hidden discovery fields through JSON', () => {
  const exit = new LocationExit({
    destination: 'loc_secret_room',
    description: 'A hairline crack behind the tapestry.',
    hiddenFromPlayer: true,
    discoveryDifficulty: 'Very Hard',
    hiddenSource: 'generated',
    hiddenReason: 'The tapestry fully covers the seam.'
  });

  const serialized = exit.toJSON();
  assert.equal(serialized.hiddenFromPlayer, true);
  assert.equal(serialized.discoveryDifficulty, 'Very Hard');
  assert.equal(serialized.hiddenSource, 'generated');
  assert.equal(serialized.hiddenReason, 'The tapestry fully covers the seam.');

  const loaded = new LocationExit(serialized);
  assert.equal(loaded.hiddenFromPlayer, true);
  assert.equal(loaded.discoveryDifficulty, 'Very Hard');
  assert.equal(loaded.hiddenSource, 'generated');
  assert.equal(loaded.hiddenReason, 'The tapestry fully covers the seam.');
});

test('LocationExit createReverse preserves hidden discovery fields only when explicitly requested', () => {
  const exit = new LocationExit({
    destination: 'loc_secret_room',
    description: 'A hidden passage.',
    hiddenFromPlayer: true,
    discoveryDifficulty: 'Hard'
  });

  const reverse = exit.createReverse('Back through the hidden passage.', {
    destination: 'loc_main_hall'
  });

  assert.equal(reverse.hiddenFromPlayer, false);
  assert.equal(reverse.discoveryDifficulty, null);
});
```

- [ ] **Step 3: Run the model tests and verify they fail**

Run:

```bash
node --test tests/hidden_discovery_models.test.js
```

Expected: fail because `Thing` and `LocationExit` do not yet expose hidden discovery fields.

---

### Task 2: Add Shared Hidden Discovery Helper

**Files:**
- Create: `HiddenDiscovery.js`
- Modify: `server.js`, `api.js`, `Events.js` imports later
- Test: `tests/hidden_discovery_models.test.js`

- [ ] **Step 1: Create `HiddenDiscovery.js`**

Add:

```js
const DISCOVERY_DIFFICULTY_LABELS = Object.freeze([
  'Trivial',
  'Easy',
  'Medium',
  'Hard',
  'Very Hard',
  'Legendary'
]);

const DIFFICULTY_BY_KEY = new Map(
  DISCOVERY_DIFFICULTY_LABELS.map(label => [
    label.toLowerCase().replace(/[\s_-]+/g, ''),
    label
  ])
);

function normalizeDiscoveryDifficultyLabel(value, {
  required = false,
  fieldName = 'discoveryDifficulty'
} = {}) {
  if (value === null || value === undefined || value === '') {
    if (required) {
      throw new Error(`${fieldName} is required when hiddenFromPlayer is true.`);
    }
    return null;
  }
  const key = String(value).trim().toLowerCase().replace(/[\s_-]+/g, '');
  const label = DIFFICULTY_BY_KEY.get(key) || null;
  if (!label) {
    throw new Error(`${fieldName} must be one of: ${DISCOVERY_DIFFICULTY_LABELS.join(', ')}.`);
  }
  return label;
}

function normalizeHiddenSource(value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!text) return null;
  if (['generated', 'event', 'manual', 'tool'].includes(text)) {
    return text;
  }
  throw new Error('hiddenSource must be generated, event, manual, or tool.');
}

function normalizeHiddenReason(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function buildHiddenDiscoveryPlausibility({
  targetName,
  targetType,
  actorAttribute,
  actorSkill = null,
  difficultyLabel,
  reason = null
} = {}) {
  const resolvedTargetName = typeof targetName === 'string' && targetName.trim()
    ? targetName.trim()
    : 'hidden feature';
  const resolvedType = typeof targetType === 'string' && targetType.trim()
    ? targetType.trim()
    : 'thing';
  const resolvedDifficulty = normalizeDiscoveryDifficultyLabel(difficultyLabel, { required: true });
  const resolvedAttribute = typeof actorAttribute === 'string' && actorAttribute.trim()
    ? actorAttribute.trim()
    : '';
  if (!resolvedAttribute) {
    throw new Error('Hidden discovery checks require a perception attribute.');
  }
  const resolvedSkill = typeof actorSkill === 'string' && actorSkill.trim()
    ? actorSkill.trim()
    : null;
  const resolvedReason = normalizeHiddenReason(reason)
    || `The player searches for ${resolvedTargetName} (${resolvedType}).`;

  return {
    type: 'Plausible',
    reason: resolvedReason,
    skillCheck: {
      reason: resolvedReason,
      skill: resolvedSkill,
      attribute: resolvedAttribute,
      difficulty: resolvedDifficulty,
      checkType: 'unopposed',
      unopposedCheck: { difficultyLevel: resolvedDifficulty },
      circumstanceModifiers: [],
      circumstanceModifier: 0
    }
  };
}

module.exports = {
  DISCOVERY_DIFFICULTY_LABELS,
  normalizeDiscoveryDifficultyLabel,
  normalizeHiddenSource,
  normalizeHiddenReason,
  buildHiddenDiscoveryPlausibility
};
```

- [ ] **Step 2: Add helper tests**

Append to `tests/hidden_discovery_models.test.js`:

```js
const {
  normalizeDiscoveryDifficultyLabel,
  buildHiddenDiscoveryPlausibility
} = require('../HiddenDiscovery');

test('hidden discovery helper normalizes difficulty labels', () => {
  assert.equal(normalizeDiscoveryDifficultyLabel('very hard'), 'Very Hard');
  assert.equal(normalizeDiscoveryDifficultyLabel('Very_Hard'), 'Very Hard');
  assert.equal(normalizeDiscoveryDifficultyLabel('', { required: false }), null);
  assert.throws(() => normalizeDiscoveryDifficultyLabel('', { required: true }), /required/);
  assert.throws(() => normalizeDiscoveryDifficultyLabel('Impossible'), /must be one of/);
});

test('hidden discovery helper builds unopposed no-modifier plausibility', () => {
  const plausibility = buildHiddenDiscoveryPlausibility({
    targetName: 'Loose Wall Panel',
    targetType: 'scenery',
    actorAttribute: 'Awareness',
    actorSkill: 'Search',
    difficultyLabel: 'Hard'
  });

  assert.equal(plausibility.type, 'Plausible');
  assert.equal(plausibility.skillCheck.attribute, 'Awareness');
  assert.equal(plausibility.skillCheck.skill, 'Search');
  assert.equal(plausibility.skillCheck.checkType, 'unopposed');
  assert.equal(plausibility.skillCheck.unopposedCheck.difficultyLevel, 'Hard');
  assert.deepEqual(plausibility.skillCheck.circumstanceModifiers, []);
});
```

- [ ] **Step 3: Run and verify helper tests fail only on unimplemented model fields**

Run:

```bash
node --test tests/hidden_discovery_models.test.js
```

Expected: helper tests pass; model tests still fail until Task 3.

---

### Task 3: Implement Model Fields

**Files:**
- Modify: `Thing.js`
- Modify: `LocationExit.js`
- Test: `tests/hidden_discovery_models.test.js`

- [ ] **Step 1: Add hidden fields to `Thing`**

In `Thing.js`, import helpers near the top:

```js
const {
  normalizeDiscoveryDifficultyLabel,
  normalizeHiddenSource,
  normalizeHiddenReason
} = require('./HiddenDiscovery');
```

Add private fields:

```js
#hiddenFromPlayer = false;
#discoveryDifficulty = null;
#hiddenSource = null;
#hiddenReason = null;
```

Add constructor options:

```js
hiddenFromPlayer = false,
discoveryDifficulty = null,
hiddenSource = null,
hiddenReason = null,
```

After metadata initialization and before `#syncFieldsToMetadata()`:

```js
this.#hiddenFromPlayer = false;
this.#discoveryDifficulty = null;
this.#hiddenSource = null;
this.#hiddenReason = null;
this.hiddenFromPlayer = hiddenFromPlayer;
this.discoveryDifficulty = discoveryDifficulty;
this.hiddenSource = hiddenSource;
this.hiddenReason = hiddenReason;
```

Add accessors:

```js
get hiddenFromPlayer() {
  return this.#hiddenFromPlayer;
}

set hiddenFromPlayer(value) {
  this.#hiddenFromPlayer = Boolean(value);
  this.#discoveryDifficulty = normalizeDiscoveryDifficultyLabel(this.#discoveryDifficulty, {
    required: this.#hiddenFromPlayer
  });
  this.#lastUpdated = new Date().toISOString();
  this.#syncFieldsToMetadata();
}

get discoveryDifficulty() {
  return this.#discoveryDifficulty;
}

set discoveryDifficulty(value) {
  this.#discoveryDifficulty = normalizeDiscoveryDifficultyLabel(value, {
    required: this.#hiddenFromPlayer
  });
  this.#lastUpdated = new Date().toISOString();
  this.#syncFieldsToMetadata();
}

get hiddenSource() {
  return this.#hiddenSource;
}

set hiddenSource(value) {
  this.#hiddenSource = normalizeHiddenSource(value);
  this.#lastUpdated = new Date().toISOString();
  this.#syncFieldsToMetadata();
}

get hiddenReason() {
  return this.#hiddenReason;
}

set hiddenReason(value) {
  this.#hiddenReason = normalizeHiddenReason(value);
  this.#lastUpdated = new Date().toISOString();
  this.#syncFieldsToMetadata();
}
```

In `#applyMetadataFieldsFromMetadata()`, hydrate legacy metadata keys:

```js
const metadataHidden = meta.hiddenFromPlayer ?? meta.hidden;
const metadataDifficulty = meta.discoveryDifficulty ?? meta.hiddenDifficulty;
if (metadataHidden !== undefined) {
  this.#hiddenFromPlayer = Boolean(metadataHidden);
}
if (metadataDifficulty !== undefined) {
  this.#discoveryDifficulty = normalizeDiscoveryDifficultyLabel(metadataDifficulty, {
    required: this.#hiddenFromPlayer
  });
}
this.#hiddenSource = normalizeHiddenSource(meta.hiddenSource);
this.#hiddenReason = normalizeHiddenReason(meta.hiddenReason);
```

In `#syncFieldsToMetadata()`, keep these top-level authoritative and remove duplicates:

```js
delete this.#metadata.hidden;
delete this.#metadata.hiddenFromPlayer;
delete this.#metadata.discoveryDifficulty;
delete this.#metadata.hiddenDifficulty;
delete this.#metadata.hiddenSource;
delete this.#metadata.hiddenReason;
```

In `toJSON()` add:

```js
hiddenFromPlayer: this.#hiddenFromPlayer || undefined,
discoveryDifficulty: this.#discoveryDifficulty || undefined,
hiddenSource: this.#hiddenSource || undefined,
hiddenReason: this.#hiddenReason || undefined,
```

In `fromJSON(data)`, pass:

```js
hiddenFromPlayer: data.hiddenFromPlayer ?? data.metadata?.hiddenFromPlayer ?? data.metadata?.hidden ?? false,
discoveryDifficulty: data.discoveryDifficulty ?? data.metadata?.discoveryDifficulty ?? data.metadata?.hiddenDifficulty ?? null,
hiddenSource: data.hiddenSource ?? data.metadata?.hiddenSource ?? null,
hiddenReason: data.hiddenReason ?? data.metadata?.hiddenReason ?? null,
```

- [ ] **Step 2: Add hidden fields to `LocationExit`**

In `LocationExit.js`, import:

```js
const {
  normalizeDiscoveryDifficultyLabel,
  normalizeHiddenSource,
  normalizeHiddenReason
} = require('./HiddenDiscovery');
```

Add private fields and constructor options:

```js
#hiddenFromPlayer = false;
#discoveryDifficulty = null;
#hiddenSource = null;
#hiddenReason = null;

constructor({
  description = '',
  destination,
  destinationRegion = null,
  travelTimeMinutes = 0,
  bidirectional = true,
  id = null,
  imageId = null,
  isVehicle = false,
  vehicleType = null,
  hiddenFromPlayer = false,
  discoveryDifficulty = null,
  hiddenSource = null,
  hiddenReason = null
} = {}) {
```

Normalize after existing vehicle validation:

```js
this.#hiddenFromPlayer = Boolean(hiddenFromPlayer);
this.#discoveryDifficulty = normalizeDiscoveryDifficultyLabel(discoveryDifficulty, {
  required: this.#hiddenFromPlayer
});
this.#hiddenSource = normalizeHiddenSource(hiddenSource);
this.#hiddenReason = normalizeHiddenReason(hiddenReason);
```

Add getters/setters mirroring `Thing`.

Add to `getDetails()`:

```js
hiddenFromPlayer: this.#hiddenFromPlayer || undefined,
discoveryDifficulty: this.#discoveryDifficulty || undefined,
hiddenSource: this.#hiddenSource || undefined,
hiddenReason: this.#hiddenReason || undefined,
```

In `createReverse(...)`, default reverse exits to visible unless the caller passes explicit hidden options:

```js
hiddenFromPlayer: false,
discoveryDifficulty: null,
hiddenSource: null,
hiddenReason: null,
```

- [ ] **Step 3: Run model tests**

Run:

```bash
node --test tests/hidden_discovery_models.test.js
```

Expected: all model/helper tests pass.

---

### Task 4: Parse Generated Hidden Things

**Files:**
- Modify: `prompts/_includes/item.njk`
- Modify: `prompts/_includes/item-output.njk`
- Modify: `server.js`
- Test: `tests/hidden_discovery_generation.test.js`

- [ ] **Step 1: Add failing parser tests**

Create `tests/hidden_discovery_generation.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const serverSource = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
const itemPrompt = fs.readFileSync(path.join(rootDir, 'prompts', '_includes', 'item.njk'), 'utf8');
const itemOutputPrompt = fs.readFileSync(path.join(rootDir, 'prompts', '_includes', 'item-output.njk'), 'utf8');

test('thing generator prompts request hidden state and discovery difficulty', () => {
  assert.match(itemPrompt, /<hiddenFromPlayer>/);
  assert.match(itemPrompt, /<discoveryDifficulty>/);
  assert.match(itemPrompt, /Trivial\|Easy\|Medium\|Hard\|Very Hard\|Legendary/);
  assert.match(itemOutputPrompt, /<hiddenFromPlayer>/);
  assert.match(itemOutputPrompt, /<discoveryDifficulty>/);
});

test('parseThingsXml reads hiddenFromPlayer and discoveryDifficulty', () => {
  assert.match(serverSource, /getDirectChildText\(node, 'hiddenFromPlayer'\)/);
  assert.match(serverSource, /normalizeDiscoveryDifficultyLabel\(discoveryDifficultyRaw/);
  assert.match(serverSource, /hiddenFromPlayer:\s*parsedHiddenFromPlayer/);
  assert.match(serverSource, /discoveryDifficulty:\s*parsedDiscoveryDifficulty/);
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
node --test tests/hidden_discovery_generation.test.js
```

Expected: fail because prompts/parser do not include hidden thing fields.

- [ ] **Step 3: Update item prompts**

In `prompts/_includes/item.njk`, after `<relativeLevel>` add:

```njk
<hiddenFromPlayer>{% if thingSeed.hiddenFromPlayer is defined %}{{ thingSeed.hiddenFromPlayer }}{% else %}<!--true if the item/scenery is physically present but not immediately obvious to the player; false otherwise-->{% endif %}</hiddenFromPlayer>
<discoveryDifficulty>{% if thingSeed.discoveryDifficulty %}{{ thingSeed.discoveryDifficulty }}{% else %}<!--Required if hiddenFromPlayer is true. One of Trivial|Easy|Medium|Hard|Very Hard|Legendary. Leave blank if hiddenFromPlayer is false.-->{% endif %}</discoveryDifficulty>
```

In `prompts/_includes/item-output.njk`, after `<relativeLevel>` add:

```njk
  <hiddenFromPlayer>{{ item.hiddenFromPlayer | default(false, true) }}</hiddenFromPlayer>
  <discoveryDifficulty>{{ item.discoveryDifficulty | default('', true) }}</discoveryDifficulty>
```

- [ ] **Step 4: Update `parseThingsXml`**

In `server.js`, import `normalizeDiscoveryDifficultyLabel` from `HiddenDiscovery.js`.

Inside `parseThingsXml`, after `parseBooleanTag` and before entry construction:

```js
const parsedHiddenFromPlayer = parseBooleanTag('hiddenFromPlayer');
const discoveryDifficultyRaw = getDirectChildText(node, 'discoveryDifficulty')
  || getDirectChildText(node, 'hiddenDifficulty');
const parsedDiscoveryDifficulty = normalizeDiscoveryDifficultyLabel(discoveryDifficultyRaw, {
  required: parsedHiddenFromPlayer,
  fieldName: `discoveryDifficulty for "${entryName}"`
});
```

Add fields to `entry`:

```js
hiddenFromPlayer: parsedHiddenFromPlayer,
discoveryDifficulty: parsedDiscoveryDifficulty,
hiddenSource: parsedHiddenFromPlayer ? 'generated' : null,
hiddenReason: parsedHiddenFromPlayer ? getDirectChildText(node, 'hiddenReason') : null,
```

- [ ] **Step 5: Pass parsed fields into `Thing` creation paths**

Update all `new Thing({ ... })` sites that consume `itemData` / parsed thing entries to pass:

```js
hiddenFromPlayer: Boolean(itemData.hiddenFromPlayer),
discoveryDifficulty: itemData.discoveryDifficulty || null,
hiddenSource: itemData.hiddenSource || null,
hiddenReason: itemData.hiddenReason || null,
```

Touch the generation paths around `server.js` item generation, single thing generation, container contents generation, location thing generation, separation/alteration where the parsed data creates or rewrites a `Thing`.

- [ ] **Step 6: Run generation tests**

Run:

```bash
node --test tests/hidden_discovery_generation.test.js tests/hidden_discovery_models.test.js
```

Expected: pass.

---

### Task 5: Add Hidden Exits to Generation, Persistence, and API

**Files:**
- Modify: `prompts/_includes/region-generator.njk`
- Modify: `prompts/base-context.xml.njk`
- Modify: `server.js`
- Modify: `api.js`
- Test: `tests/hidden_discovery_generation.test.js`

- [ ] **Step 1: Add failing tests for exit prompts/API**

Append:

```js
const regionGeneratorPrompt = fs.readFileSync(path.join(rootDir, 'prompts', '_includes', 'region-generator.njk'), 'utf8');
const baseContextPrompt = fs.readFileSync(path.join(rootDir, 'prompts', 'base-context.xml.njk'), 'utf8');
const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');

test('exit prompts and base context include hidden discovery fields', () => {
  assert.match(regionGeneratorPrompt, /<hiddenFromPlayer>/);
  assert.match(regionGeneratorPrompt, /<discoveryDifficulty>/);
  assert.match(baseContextPrompt, /<hidden>true<\/hidden>/);
  assert.match(baseContextPrompt, /<discoveryDifficulty>{{ exit\.discoveryDifficulty/);
});

test('exit creation API accepts hidden discovery fields', () => {
  assert.match(apiSource, /hiddenFromPlayer:\s*parsedExitHiddenFromPlayer/);
  assert.match(apiSource, /discoveryDifficulty:\s*parsedExitDiscoveryDifficulty/);
});
```

- [ ] **Step 2: Update region-generator exit XML**

Inside each generated `<exit>` and `<stubRegion>` block in `prompts/_includes/region-generator.njk`, add:

```njk
<hiddenFromPlayer>true if the route exists but is not immediately obvious to the player; false otherwise</hiddenFromPlayer>
<discoveryDifficulty>Required if hiddenFromPlayer is true. One of Trivial|Easy|Medium|Hard|Very Hard|Legendary. Leave blank if hiddenFromPlayer is false.</discoveryDifficulty>
```

- [ ] **Step 3: Update server parsing for generated exits**

Where region/location generation parses exit nodes, read direct child tags:

```js
const hiddenFromPlayer = parseBooleanText(getChildValue(exitNode, 'hiddenFromPlayer'));
const discoveryDifficulty = normalizeDiscoveryDifficultyLabel(
  getChildValue(exitNode, 'discoveryDifficulty') || getChildValue(exitNode, 'hiddenDifficulty'),
  { required: hiddenFromPlayer, fieldName: `discoveryDifficulty for exit to "${destinationName}"` }
);
```

Pass these into `LocationExit` creation options:

```js
hiddenFromPlayer,
discoveryDifficulty,
hiddenSource: hiddenFromPlayer ? 'generated' : null,
hiddenReason: hiddenFromPlayer ? description || null : null
```

- [ ] **Step 4: Update exit creation API**

In `api.js` `POST /api/locations/:id/exits`, destructure:

```js
hiddenFromPlayer: hiddenFromPlayerRaw,
discoveryDifficulty: discoveryDifficultyRaw,
hiddenReason: hiddenReasonRaw
```

Normalize:

```js
const parsedExitHiddenFromPlayer = Boolean(hiddenFromPlayerRaw);
const parsedExitDiscoveryDifficulty = normalizeDiscoveryDifficultyLabel(discoveryDifficultyRaw, {
  required: parsedExitHiddenFromPlayer,
  fieldName: 'discoveryDifficulty'
});
const parsedExitHiddenReason = typeof hiddenReasonRaw === 'string' && hiddenReasonRaw.trim()
  ? hiddenReasonRaw.trim()
  : null;
```

Add to all `exitOptions` used by `ensureExitConnection`, `createLocationFromEvent`, and `createRegionStubFromEvent`:

```js
hiddenFromPlayer: parsedExitHiddenFromPlayer,
discoveryDifficulty: parsedExitDiscoveryDifficulty,
hiddenSource: parsedExitHiddenFromPlayer ? 'manual' : null,
hiddenReason: parsedExitHiddenReason
```

- [ ] **Step 5: Update base context**

In `prompts/base-context.xml.njk`, inside current location `<exit>`:

```njk
{% if exit.hiddenFromPlayer %}<hidden>true</hidden>{% endif %}
{% if exit.discoveryDifficulty %}<discoveryDifficulty>{{ exit.discoveryDifficulty }}</discoveryDifficulty>{% endif %}
```

Add an instruction near `<exits>`:

```njk
<hiddenExitGuidance>Exits marked hidden are known to the GM/system but are not available to the player until revealed by play.</hiddenExitGuidance>
```

- [ ] **Step 6: Run tests**

Run:

```bash
node --test tests/hidden_discovery_generation.test.js tests/hidden_discovery_models.test.js
```

Expected: pass.

---

### Task 6: Add Thing/Exit Reveal and Hide Events

**Files:**
- Modify: `prompts/_includes/events-xml.njk`
- Modify: `Events.js`
- Modify docs later
- Test: `tests/hidden_discovery_events.test.js`

- [ ] **Step 1: Write failing event tests**

Create `tests/hidden_discovery_events.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const eventsSource = fs.readFileSync(path.join(rootDir, 'Events.js'), 'utf8');
const eventsPrompt = fs.readFileSync(path.join(rootDir, 'prompts', '_includes', 'events-xml.njk'), 'utf8');

test('events XML documents hidden thing and exit reveal/hide events', () => {
  assert.match(eventsPrompt, /<revealHiddenThing>/);
  assert.match(eventsPrompt, /<hideVisibleThing>/);
  assert.match(eventsPrompt, /<revealHiddenExit>/);
  assert.match(eventsPrompt, /<hideVisibleExit>/);
});

test('Events parser maps hidden thing and exit events', () => {
  assert.match(eventsSource, /case "revealHiddenThing"/);
  assert.match(eventsSource, /key: "reveal_hidden_thing"/);
  assert.match(eventsSource, /case "hideVisibleThing"/);
  assert.match(eventsSource, /key: "hide_visible_thing"/);
  assert.match(eventsSource, /case "revealHiddenExit"/);
  assert.match(eventsSource, /key: "reveal_hidden_exit"/);
  assert.match(eventsSource, /case "hideVisibleExit"/);
  assert.match(eventsSource, /key: "hide_visible_exit"/);
});

test('Events processing uses hidden discovery difficulty checks', () => {
  assert.match(eventsSource, /buildHiddenDiscoveryPlausibility/);
  assert.match(eventsSource, /resolveActionOutcome/);
  assert.match(eventsSource, /context\.hiddenDiscoveryChecks/);
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
node --test tests/hidden_discovery_events.test.js
```

Expected: fail because events are not implemented.

- [ ] **Step 3: Add XML guidance**

In `prompts/_includes/events-xml.njk`, add:

```njk
Use this when the prose reveals a hidden item or scenery object that already exists in the current location.
<revealHiddenThing>
  <thingName>Exact hidden item/scenery name</thingName>
  <description>How it was discovered</description>
</revealHiddenThing>

Use this when a visible item or scenery object becomes hidden from the player.
<hideVisibleThing>
  <thingName>Exact item/scenery name</thingName>
  <discoveryDifficulty>Trivial|Easy|Medium|Hard|Very Hard|Legendary</discoveryDifficulty>
  <description>Why it is hidden</description>
</hideVisibleThing>

Use this when the prose reveals a hidden exit/route that already exists in the current location.
<revealHiddenExit>
  <exitName>Exact exit destination/name</exitName>
  <description>How it was discovered</description>
</revealHiddenExit>

Use this when a visible exit/route becomes hidden from the player.
<hideVisibleExit>
  <exitName>Exact exit destination/name</exitName>
  <discoveryDifficulty>Trivial|Easy|Medium|Hard|Very Hard|Legendary</discoveryDifficulty>
  <description>Why it is hidden</description>
</hideVisibleExit>
```

- [ ] **Step 4: Add XML parser cases**

In `Events.js` XML parsing switch, add cases that produce keys:

```js
case "revealHiddenThing":
  return {
    key: "reveal_hidden_thing",
    raw: this._formatXmlLegacyRawEntry(node, ["thingName", "description"])
  };
case "hideVisibleThing":
  return {
    key: "hide_visible_thing",
    raw: this._formatXmlLegacyRawEntry(node, ["thingName", "discoveryDifficulty", "description"])
  };
case "revealHiddenExit":
  return {
    key: "reveal_hidden_exit",
    raw: this._formatXmlLegacyRawEntry(node, ["exitName", "description"])
  };
case "hideVisibleExit":
  return {
    key: "hide_visible_exit",
    raw: this._formatXmlLegacyRawEntry(node, ["exitName", "discoveryDifficulty", "description"])
  };
```

Update legacy grouped event parsing to recognize the same four keys with arrow-delimited raw values.

- [ ] **Step 5: Add processors**

Implement processors beside hidden NPC processors:

```js
reveal_hidden_thing: async function (entries = [], context = {}) {
  const player = context.player || this.currentPlayer || this._deps.getCurrentPlayer?.() || Globals.currentPlayer || null;
  for (const entry of entries) {
    const thing = this._resolveCurrentLocationThing(entry?.name);
    if (!thing || thing.hiddenFromPlayer !== true) continue;
    const resolution = this._runHiddenDiscoveryCheck({
      player,
      targetName: thing.name,
      targetType: thing.thingType || 'thing',
      difficultyLabel: thing.discoveryDifficulty,
      reason: entry.description || `The player attempts to notice ${thing.name}.`,
      context
    });
    if (resolution.success === true) {
      thing.hiddenFromPlayer = false;
      thing.hiddenSource = null;
      context.locationRefreshRequested = true;
    }
  }
}
```

Mirror it for exits with `_resolveCurrentLocationExit(entry.name)`.

For hide processors:

```js
thing.hiddenFromPlayer = true;
thing.discoveryDifficulty = normalizeDiscoveryDifficultyLabel(entry.discoveryDifficulty, {
  required: true,
  fieldName: `discoveryDifficulty for ${thing.name}`
});
thing.hiddenSource = 'event';
thing.hiddenReason = entry.description || null;
context.locationRefreshRequested = true;
```

Exit hide processing uses the same field updates on the `LocationExit`.

- [ ] **Step 6: Record check-results**

Add `context.hiddenDiscoveryChecks = []` records shaped like:

```js
context.hiddenDiscoveryChecks.push({
  action: 'reveal_hidden_thing',
  targetType: 'thing',
  targetId: thing.id,
  targetName: thing.name,
  success: resolution.success === true,
  resolution
});
```

In `api.js`, after event processing where `hiddenNpcChecks` are recorded, add a `recordHiddenDiscoveryCheckResults(...)` helper that uses existing `recordActionOutcomeCheckResultsEntry` with `promptLabel: 'Hidden discovery check'`, `skillLabel: resolution.skill || 'Perception'`, and metadata `{ hiddenDiscoveryCheck: true, targetType, targetId, targetName, action }`.

- [ ] **Step 7: Run event tests**

Run:

```bash
node --test tests/hidden_discovery_events.test.js tests/events.xml_event_parser.test.js
```

Expected: pass.

---

### Task 7: Add Prose Tools for Hidden Things and Exits

**Files:**
- Modify: `chat_tool_calls.js`
- Modify: `api.js`
- Test: `tests/chat_tool_hidden_objects.test.js`

- [ ] **Step 1: Write failing tool tests**

Create `tests/chat_tool_hidden_objects.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const toolSource = fs.readFileSync(path.join(rootDir, 'chat_tool_calls.js'), 'utf8');
const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');

test('hidden object prose tools are defined without check parameters', () => {
  assert.match(toolSource, /name: 'revealThing'/);
  assert.match(toolSource, /name: 'hideThing'/);
  assert.match(toolSource, /name: 'revealExit'/);
  assert.match(toolSource, /name: 'hideExit'/);
  assert.doesNotMatch(toolSource, /revealThing[\s\S]{0,600}useOpposedCheck/);
  assert.doesNotMatch(toolSource, /revealExit[\s\S]{0,600}useOpposedCheck/);
});

test('hidden object tool metadata requests location refresh', () => {
  assert.match(toolSource, /locationRefreshRequested:\s*true/);
  assert.match(apiSource, /revealThing/);
  assert.match(apiSource, /hideExit/);
});
```

- [ ] **Step 2: Add tool schemas**

In `chat_tool_calls.js`, add regular prose tools:

```js
{
  type: 'function',
  function: {
    name: 'revealThing',
    description: 'Reveal a hidden item or scenery object after you have already resolved any needed discovery check.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Thing ID or exact item/scenery name.' },
        description: { type: 'string', description: 'Optional short description of how it becomes visible.' }
      },
      required: ['name'],
      additionalProperties: false
    }
  }
}
```

Add `hideThing({ name, discoveryDifficulty, description? })`, `revealExit({ name, description? })`, and `hideExit({ name, discoveryDifficulty, description? })`. Hide tools require `discoveryDifficulty`; reveal tools do not perform checks.

- [ ] **Step 3: Implement tool handlers**

Add helpers:

```js
const executeSetThingHiddenTool = ({ name, description = '', hiddenFromPlayer, discoveryDifficulty = null, functionName } = {}) => {
  const targetThing = resolveThingReference(name, { fieldName: 'name', requireCurrentLocation: true });
  targetThing.hiddenFromPlayer = Boolean(hiddenFromPlayer);
  targetThing.discoveryDifficulty = hiddenFromPlayer
    ? normalizeDiscoveryDifficultyLabel(discoveryDifficulty, { required: true })
    : null;
  targetThing.hiddenSource = hiddenFromPlayer ? 'tool' : null;
  targetThing.hiddenReason = hiddenFromPlayer ? description : null;
  return {
    content: `<${functionName}Result><thing id="${targetThing.id}">${targetThing.name}</thing></${functionName}Result>`,
    metadata: {
      thingId: targetThing.id,
      thingName: targetThing.name,
      hiddenFromPlayer: targetThing.hiddenFromPlayer,
      locationRefreshRequested: true
    }
  };
};
```

Implement equivalent `executeSetExitHiddenTool` by resolving an exit from `Globals.location` / current location by id, destination name, or destination resolved label.

- [ ] **Step 4: Wire tools into execution switch**

Add cases in `executeChatToolCall`:

```js
} else if (toolCall.functionName === 'revealThing') {
  result = executeRevealThingTool(toolArgs);
} else if (toolCall.functionName === 'hideThing') {
  result = executeHideThingTool(toolArgs);
} else if (toolCall.functionName === 'revealExit') {
  result = executeRevealExitTool(toolArgs);
} else if (toolCall.functionName === 'hideExit') {
  result = executeHideExitTool(toolArgs);
}
```

- [ ] **Step 5: Run tool tests**

Run:

```bash
node --test tests/chat_tool_hidden_objects.test.js tests/chat_tool_calls.test.js
```

Expected: pass.

---

### Task 8: Add API Updates and Interaction Gating

**Files:**
- Modify: `api.js`
- Test: `tests/hidden_discovery_generation.test.js`

- [ ] **Step 1: Add thing API fields**

In `/api/things` POST and PUT destructuring, include:

```js
hiddenFromPlayer,
discoveryDifficulty,
hiddenSource,
hiddenReason
```

Normalize before `new Thing` / mutation:

```js
const normalizedHiddenFromPlayer = hiddenFromPlayer === undefined ? false : Boolean(hiddenFromPlayer);
const normalizedDiscoveryDifficulty = normalizeDiscoveryDifficultyLabel(discoveryDifficulty, {
  required: normalizedHiddenFromPlayer
});
```

Pass/update:

```js
thing.hiddenFromPlayer = normalizedHiddenFromPlayer;
thing.discoveryDifficulty = normalizedDiscoveryDifficulty;
thing.hiddenSource = normalizedHiddenFromPlayer ? (hiddenSource || 'manual') : null;
thing.hiddenReason = normalizedHiddenFromPlayer ? hiddenReason : null;
```

- [ ] **Step 2: Gate hidden thing interactions**

Reject hidden things in normal user-facing interaction endpoints unless the endpoint is specifically reveal/hide/edit:

```js
function requireThingVisibleToPlayer(thing, actionLabel = 'use this thing') {
  if (thing?.hiddenFromPlayer === true) {
    throw new Error(`Cannot ${actionLabel}: "${thing.name || thing.id}" is hidden from the player.`);
  }
}
```

Call this in pickup, drop-to-player, crafting input collection, salvage/harvest targets, container open from visible location, and direct movement into inventory. Do not apply it to admin edit endpoints or generic mutation tools.

- [ ] **Step 3: Gate hidden exit traversal**

In movement/travel helpers that resolve an exit from the current location, reject:

```js
if (matchedExit?.hiddenFromPlayer === true) {
  return res.status(400).json({
    success: false,
    error: 'That exit is hidden and has not been discovered.'
  });
}
```

Apply to `/api/player/move`, direct exit traversal, and map travel paths that rely on a location exit. Do not block admin map/edit APIs.

- [ ] **Step 4: Run targeted API/static tests**

Run:

```bash
node --test tests/hidden_discovery_generation.test.js tests/api.crafting_check_results.test.js
node --check api.js
```

Expected: pass.

---

### Task 9: Add UI Visibility Controls

**Files:**
- Modify: `views/index.njk`
- Modify: `public/css/main.scss`
- Test: `tests/ui.hidden_things_exits.test.js`

- [ ] **Step 1: Write failing UI tests**

Create `tests/ui.hidden_things_exits.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
const scssSource = fs.readFileSync(path.join(rootDir, 'public', 'css', 'main.scss'), 'utf8');
const chatDocSource = fs.readFileSync(path.join(rootDir, 'docs', 'ui', 'chat_interface.md'), 'utf8');

test('thing and exit panels have show-hidden toggles', () => {
  assert.match(viewSource, /toggleHiddenSceneryButton/);
  assert.match(viewSource, /toggleHiddenItemsButton/);
  assert.match(viewSource, /toggleHiddenExitsButton/);
  assert.match(viewSource, /show hidden/);
});

test('hidden things and exits are filtered and styled client-side', () => {
  assert.match(viewSource, /isThingHiddenFromLocationDisplay/);
  assert.match(viewSource, /shouldRenderLocationThing/);
  assert.match(viewSource, /isExitHiddenFromLocationDisplay/);
  assert.match(viewSource, /shouldRenderLocationExit/);
  assert.match(scssSource, /\.entity-card--thing\.is-hidden-from-player/);
  assert.match(scssSource, /\.exit-item\.is-hidden-from-player/);
});

test('thing context menu has Toggle Hidden', () => {
  assert.match(viewSource, /toggleThingHiddenButton\.textContent = 'Toggle Hidden'/);
  assert.match(viewSource, /toggleExitHidden/);
  assert.match(chatDocSource, /hidden items/);
});
```

- [ ] **Step 2: Add toggles in markup**

Use the same eye icon pattern as `toggleHiddenNpcsButton`:

```html
<button type="button" class="location-hidden-things-toggle" id="toggleHiddenSceneryButton" aria-label="show hidden" aria-pressed="false" title="show hidden">
  <span aria-hidden="true">...</span>
</button>
```

Add one toggle to each section header:

- `locationExits`
- `locationSceneryPanel`
- `locationItemsPanel`

- [ ] **Step 3: Add client helper state**

Near existing `locationNpcsShowHidden` state:

```js
let locationSceneryShowHidden = false;
let locationItemsShowHidden = false;
let locationExitsShowHidden = false;

function isThingHiddenFromLocationDisplay(thing) {
  return Boolean(thing?.hiddenFromPlayer);
}

function shouldRenderLocationThing(thing, showHidden = false) {
  return !isThingHiddenFromLocationDisplay(thing) || Boolean(showHidden);
}

function shouldStyleLocationThingAsHidden(thing, showHidden = false) {
  return Boolean(showHidden) && isThingHiddenFromLocationDisplay(thing);
}

function isExitHiddenFromLocationDisplay(exit) {
  return Boolean(exit?.hiddenFromPlayer);
}

function shouldRenderLocationExit(exit, showHidden = false) {
  return !isExitHiddenFromLocationDisplay(exit) || Boolean(showHidden);
}
```

- [ ] **Step 4: Filter rendered things and exits**

In `renderLocationThingCollections`, filter `sceneryThings` and `itemThings` before calling `renderThingCollectionPanel`:

```js
const visibleSceneryThings = sceneryThings.filter(thing => shouldRenderLocationThing(thing, locationSceneryShowHidden));
const visibleItemThings = itemThings.filter(thing => shouldRenderLocationThing(thing, locationItemsShowHidden));
```

Decorate cards:

```js
card.classList.toggle('is-hidden-from-player', shouldStyleLocationThingAsHidden(thing, showHiddenForPanel));
```

In exit rendering, filter `rawExitEntries` through `shouldRenderLocationExit(exit, locationExitsShowHidden)`. If rendering a hidden exit with show-hidden on:

```js
container.classList.add('is-hidden-from-player');
travelButton.disabled = true;
travelButton.title = 'Hidden exit; reveal it before traveling.';
```

- [ ] **Step 5: Add `Toggle Hidden` context menu actions**

In `registerThingContextMenu`, add:

```js
const toggleThingHiddenButton = document.createElement('button');
toggleThingHiddenButton.type = 'button';
toggleThingHiddenButton.className = 'entity-context-menu-item thing-card-menu-item';
toggleThingHiddenButton.textContent = 'Toggle Hidden';
menu.appendChild(toggleThingHiddenButton);
```

Handler:

```js
await fetch(`/api/things/${encodeURIComponent(thing.id)}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    hiddenFromPlayer: !Boolean(thing.hiddenFromPlayer),
    discoveryDifficulty: !Boolean(thing.hiddenFromPlayer) ? 'Medium' : null,
    hiddenSource: !Boolean(thing.hiddenFromPlayer) ? 'manual' : null
  })
});
await window.loadCurrentLocation?.();
```

For exits, add a context-menu or icon action beside edit/delete:

```js
const toggleExitHiddenButton = document.createElement('button');
toggleExitHiddenButton.type = 'button';
toggleExitHiddenButton.className = 'exit-hidden-toggle-button';
toggleExitHiddenButton.textContent = '👁';
toggleExitHiddenButton.title = 'Toggle Hidden';
```

Call a new API path or reuse exit update support:

```js
await fetch(`/api/locations/${encodeURIComponent(location.id)}/exits/${encodeURIComponent(exitId)}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    hiddenFromPlayer: !Boolean(exit.hiddenFromPlayer),
    discoveryDifficulty: !Boolean(exit.hiddenFromPlayer) ? 'Medium' : null,
    hiddenSource: !Boolean(exit.hiddenFromPlayer) ? 'manual' : null
  })
});
```

- [ ] **Step 6: Add SCSS and compile**

In `public/css/main.scss`:

```scss
.entity-card--thing.is-hidden-from-player,
.thing-card.is-hidden-from-player {
  opacity: 0.34;
  outline: 1px dashed rgba(255, 255, 255, 0.45);
}

.exit-item.is-hidden-from-player {
  opacity: 0.42;
}

.exit-item.is-hidden-from-player .exit-button {
  cursor: not-allowed;
}

.location-hidden-things-toggle,
.location-hidden-exits-toggle {
  @extend .location-hidden-npcs-toggle;
}
```

Compile the corresponding CSS using the repo's existing CSS build command. If there is no package script, run the existing Sass command used elsewhere in the repo.

- [ ] **Step 7: Run UI tests**

Run:

```bash
node --test tests/ui.hidden_things_exits.test.js tests/ui.hidden_npcs.test.js
node -e "const nunjucks=require('nunjucks'); const env=nunjucks.configure('views', { autoescape: true }); env.getTemplate('index.njk'); console.log('index.njk parsed');"
```

Expected: pass.

---

### Task 10: Wire Automatic Discovery Checks

**Files:**
- Modify: `api.js`
- Modify: `Events.js`
- Test: `tests/hidden_discovery_events.test.js`

- [ ] **Step 1: Add API helper**

In `api.js`, add:

```js
function getPerceptionDiscoverySettings() {
  const settingSnapshot = typeof getActiveSettingSnapshot === 'function'
    ? getActiveSettingSnapshot()
    : (typeof currentSetting?.toJSON === 'function' ? currentSetting.toJSON() : currentSetting);
  const perceptionAttribute = typeof settingSnapshot?.perceptionAttribute === 'string'
    ? settingSnapshot.perceptionAttribute.trim()
    : '';
  if (!perceptionAttribute) {
    throw new Error('Hidden discovery checks require perceptionAttribute in world settings.');
  }
  const perceptionSkill = typeof settingSnapshot?.perceptionSkill === 'string' && settingSnapshot.perceptionSkill.trim()
    ? settingSnapshot.perceptionSkill.trim()
    : null;
  return { perceptionAttribute, perceptionSkill };
}
```

- [ ] **Step 2: Add shared resolution helper**

```js
function resolveHiddenDiscoveryCheck({ player, targetName, targetType, difficultyLabel, reason }) {
  if (!(player instanceof Player)) {
    throw new Error('Hidden discovery check requires a current player.');
  }
  const settings = getPerceptionDiscoverySettings();
  const plausibility = buildHiddenDiscoveryPlausibility({
    targetName,
    targetType,
    actorAttribute: settings.perceptionAttribute,
    actorSkill: settings.perceptionSkill,
    difficultyLabel,
    reason
  });
  const resolution = resolveActionOutcome({ plausibility, player });
  if (!resolution || typeof resolution !== 'object') {
    throw new Error(`Hidden discovery check for "${targetName}" did not return an action resolution.`);
  }
  return resolution;
}
```

- [ ] **Step 3: Use helper in Events dependency injection**

When constructing `Events`, pass:

```js
resolveHiddenDiscoveryCheck
```

In `Events.js`, add `_runHiddenDiscoveryCheck(...)` that calls the dependency and appends to `context.hiddenDiscoveryChecks`.

- [ ] **Step 4: Add optional automatic pass after location refresh points**

Do not scan every hidden item on every turn. Run this only when a text/event says a hidden object/exit is revealed, or when an explicit search action is resolved by prose tool/event. This keeps hidden content from being automatically rolled every time the player enters a room.

If future automatic room-scan behavior is wanted, add it as a separate feature with a config gate.

- [ ] **Step 5: Run checks**

Run:

```bash
node --test tests/hidden_discovery_events.test.js tests/chat_tool_hidden_objects.test.js
```

Expected: pass.

---

### Task 11: Documentation

**Files:**
- Modify docs listed in File Map
- Test: relevant static doc tests and `rg`

- [ ] **Step 1: Update class docs**

Add to `docs/classes/Thing.md`:

```md
- Hidden discovery: `hiddenFromPlayer`, `discoveryDifficulty`, `hiddenSource`, and `hiddenReason` persist on items/scenery. Hidden things remain in payloads and prompt context but are hidden by default in the Adventure UI until revealed.
```

Add to `docs/classes/LocationExit.md`:

```md
- Hidden discovery: exits can persist `hiddenFromPlayer`, `discoveryDifficulty`, `hiddenSource`, and `hiddenReason`. Hidden exits are sent to the client and prompt context, but normal travel UI omits them unless `show hidden` is enabled, and travel remains disabled until reveal.
```

- [ ] **Step 2: Update event docs**

Add rows to `docs/classes/EventsEventTypes.md`:

```md
| `reveal_hidden_thing` | XML `revealHiddenThing`, legacy event | Thing name, description | Runs a prompt-free unopposed player perception difficulty check against the thing's stored `discoveryDifficulty`; success clears `hiddenFromPlayer`. |
| `hide_visible_thing` | XML `hideVisibleThing`, legacy event | Thing name, difficulty, description | Marks a current-location item/scenery hidden with a required discovery difficulty. |
| `reveal_hidden_exit` | XML `revealHiddenExit`, legacy event | Exit name, description | Runs a prompt-free unopposed player perception difficulty check against the exit's stored `discoveryDifficulty`; success clears `hiddenFromPlayer`. |
| `hide_visible_exit` | XML `hideVisibleExit`, legacy event | Exit name, difficulty, description | Marks a current-location exit hidden with a required discovery difficulty. |
```

- [ ] **Step 3: Update API docs**

Document:

- `Thing` payload fields in `docs/api/common.md`.
- `PUT /api/things/:id` hidden fields in `docs/api/things.md`.
- Exit creation/update hidden fields and hidden travel rejection in `docs/api/locations.md`.
- Prose tools in `docs/api/chat.md`.

- [ ] **Step 4: Update UI/server docs**

Document:

- `docs/ui/chat_interface.md`: show-hidden toggles for exits/items/scenery, disabled hidden exits, translucent hidden cards.
- `docs/server_llm_notes.md`: prompt-free discovery checks via `resolveActionOutcome`, no LLM prompt, no circumstance modifiers.

Do not add recency notes or changelog-style summaries. Keep documentation updates focused on durable class/API/UI behavior and current project indexing conventions at implementation time.

- [ ] **Step 5: Run doc/static tests**

Run:

```bash
node --test tests/hidden_discovery_models.test.js tests/hidden_discovery_generation.test.js tests/hidden_discovery_events.test.js tests/chat_tool_hidden_objects.test.js tests/ui.hidden_things_exits.test.js
rg -n "hiddenFromPlayer|discoveryDifficulty|revealHiddenThing|revealHiddenExit" docs --glob '!all.md'
```

Expected: tests pass; docs search shows all expected references.

---

### Task 12: Final Verification

**Files:**
- All modified files

- [ ] **Step 1: Syntax checks**

Run:

```bash
node --check HiddenDiscovery.js
node --check Thing.js
node --check LocationExit.js
node --check server.js
node --check api.js
node --check Events.js
node --check chat_tool_calls.js
node --check tests/hidden_discovery_models.test.js
node --check tests/hidden_discovery_generation.test.js
node --check tests/hidden_discovery_events.test.js
node --check tests/chat_tool_hidden_objects.test.js
node --check tests/ui.hidden_things_exits.test.js
```

Expected: all commands exit 0.

- [ ] **Step 2: Prompt parse check**

Run:

```bash
node -e "const nunjucks=require('nunjucks'); const env=nunjucks.configure('prompts', { autoescape: false }); ['base-context.xml.njk','_includes/item.njk','_includes/item-output.njk','_includes/region-generator.njk','_includes/events-xml.njk'].forEach(name => env.getTemplate(name)); console.log('prompt templates parsed');"
```

Expected: `prompt templates parsed`.

- [ ] **Step 3: UI template parse check**

Run:

```bash
node -e "const nunjucks=require('nunjucks'); const env=nunjucks.configure('views', { autoescape: true }); env.getTemplate('index.njk'); console.log('index.njk parsed');"
```

Expected: `index.njk parsed`.

- [ ] **Step 4: Targeted test suite**

Run:

```bash
node --test \
  tests/hidden_discovery_models.test.js \
  tests/hidden_discovery_generation.test.js \
  tests/hidden_discovery_events.test.js \
  tests/chat_tool_hidden_objects.test.js \
  tests/ui.hidden_things_exits.test.js \
  tests/ui.hidden_npcs.test.js \
  tests/events.xml_event_parser.test.js \
  tests/chat_tool_resolve_plausibility.test.js \
  tests/server.dc_formula_outcome.test.js \
  tests/api.crafting_check_results.test.js
```

Expected: all tests pass.

- [ ] **Step 5: SCSS compilation**

Run the repo's Sass build command after modifying `public/css/main.scss`. If `package.json` exposes a CSS build script, use it. If not, use the same Sass invocation already used in the repo for `public/css/main.scss`.

Expected: corresponding CSS output is updated and no Sass errors occur.

## Self-Review

- Spec coverage:
  - Persisted hidden items/scenery: Tasks 1, 3, 4, 8.
  - Persisted hidden exits: Tasks 1, 3, 5, 8.
  - Generated hidden items get difficulty labels: Task 4.
  - Difficulty handled standard way with no prompt: Tasks 2, 6, 10.
  - Show-hidden UI and translucency: Task 9.
  - Context-menu toggles: Task 9.
  - Reveal/hide events and legacy support: Task 6.
  - Reveal/hide prose tools: Task 7.
  - API support and interaction gating: Task 8.
  - Documentation: Task 11.
- Placeholder scan: no plan step depends on unspecified fields or unnamed files.
- Planned type consistency: `hiddenFromPlayer`, `discoveryDifficulty`, `hiddenSource`, and `hiddenReason` are used consistently across proposed models, prompts, API, events, tools, and docs.
