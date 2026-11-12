# IdGenerator

## Purpose
`IdGenerator` is the process-local allocator for compact persisted domain-object IDs. It gives model objects stable IDs the LLM and save data can reference, using `prefix_first_three_words`, then `_2`, `_3`, and later collision suffixes. Existing saved IDs remain stable. Discipline reuse compares complete normalized names.

The allocator is a singleton with static state. Callers reset it at new-game and load boundaries, seed it from save metadata, and let model constructors register loaded IDs as records hydrate.

Operational IDs such as chat messages, images, prompts, sessions, requests and Story records use `nextSequential(category)` through the separate durable [OperationalIdAllocator](OperationalIdAllocator.md). These numeric ranges are installation-wide and are not reset or rolled back with the named domain stores. Existing domain numeric registration also reserves its exact prefix against that allocator.

## Prefixes And Type Aliases
`next(type, sourceText)`, `register(type, id)`, and the counter seeding methods accept these object type names:

| Prefix | Accepted type keys | Persisted objects |
| --- | --- | --- |
| `char` | `character`, `char`, `player`, `npc` | Players and NPCs |
| `thing` | `thing`, `item` | Items and scenery |
| `itemdef` | `itemDefinition`, `itemdef` | Permanent item definitions |
| `loc` | `location`, `loc` | Locations |
| `exit` | `exit`, `locationExit` | Location exits |
| `region` | `region` | Regions and pending region stubs |
| `faction` | `faction` | Factions |
| `mystery` | `mysteryBox`, `mystery` | Mystery boxes |
| `mthread` | `mysteryThread`, `mthread` | Mystery threads |
| `sevent` | `scheduledEvent`, `sevent` | Scheduled events |
| `tracker` | `tracker`, `trackers` | Plot trackers |
| `quest` | `quest` | Quests |
| `obj` | `objective`, `obj` | Quest objectives |
| `status` | `status`, `statusEffect` | Status effects |
| `ability` | `ability` | Owned, declined, and pending ability records |
| `technique` | `technique` | World technique definitions and attachment candidates |
| `discipline` | `discipline` | Technique disciplines and attachment candidates |
| `tgrant` | `techniqueGrant`, `tgrant` | Explicit technique grant IDs |

Unknown or blank object types throw. The class does not create implicit prefixes.

## API
- `next(type, sourceText)`: reserves a fresh `${prefix}_${normalizeStem(sourceText)}` ID, then `_2`, `_3`, and later suffixes for collisions. Repeated names allocate distinct identities. Missing or unusable source text throws.
- `normalizeName(name)`: full NFC/lowercase Unicode-letter/number snake normalization. This remains the canonical full-name comparison used by disciplines.
- `normalizeStem(sourceText)`: selects at most three source words, then applies `normalizeName`. Internal straight/curly apostrophes stay within a word; hyphens, underscores and other punctuation separate words. `Fizz's Sparkle Energy Elixir` becomes `fizz_s_sparkle_energy`.
- `nextNamed(type, fullName)`: reuses a process-local reservation for the complete normalized name. Distinct names with the same three-word stem receive different suffixes. `TechniqueService.resolveDiscipline` first resolves existing/staged canonical full names.
- `nextUniqueNamed(type, sourceText)`: same fresh-allocation contract as `next`.
- `register(type, id)`: reserves exact supplied IDs without changing them. Numeric IDs advance historical numeric counters. Normalized supplied named IDs not already covered by a named counter reserve their entire remainder as ordinal 1, preserving imported identities without consuming unrelated bare names. Blank/non-string IDs remain ignored after type validation.
- `seedCounters(counters = {})` / `snapshotCounters()`: restore/persist historical numeric high-water counters in `metadata.idCounters`.
- `seedNamedCounters(counters = {})` / `snapshotNamedCounters()`: restore/persist `{ prefix: { normalizedStem: highestOrdinal } }` in `metadata.idNameCounters`. Ordinal 1 means the bare ID, 2 means `_2`. Present malformed structures, nonnormalized stems and nonpositive/unsafe integer counters reject with field guidance. Unknown prefixes reject.
- `reset()`: clears numeric/named counters, exact registrations and process-local canonical reservations.
- `withIsolatedState(callback)`: runs synchronous preparation with fresh allocator stores and restores every original store in `finally`. Async callbacks and returned promises reject. Used by [DomainIdMigration](DomainIdMigration.md) so planning never consumes live IDs.

## Runtime source fields

| Objects | Source for missing IDs |
| --- | --- |
| Item definitions | Canonical item name |
| Characters, things, locations, regions, factions | Name; characters retain the existing displayed `Unnamed Player` default |
| Quests / objectives | Required quest name / objective description |
| Status effects | Nonempty name, otherwise description; region string/text statuses use their normalized description |
| Abilities, techniques, disciplines | Name |
| Mystery boxes/threads, trackers | Name |
| Scheduled events | Existing normalized event/description text |
| Exits | Description, then loaded destination name, then required destination ID |
| Explicit technique grants | Referenced technique name; owning item name where the existing contract permits an unresolved reference |

`Thing.copy` allocates from the final copy name and gives inherited grants independent identities/source references. Standard and TinyBrain flows use the same engine allocation boundaries. Technique correction slots reserve only once a readable candidate name exists and retain that identity across retries.

## Persistence and reservation

`Utils.serializeGameState` stores both counter snapshots. Hydration applies existing migrations, resets/seeds the allocator, then reserves known supplied map keys and nested identity fields across the complete incoming world before constructing any model. This includes pending region stubs, embedded exits, catalogue definitions/disciplines, actor quests/objectives, owned/declined/pending abilities and attachment drafts, status effects, explicit grants, and pending quest candidates. It does not scan arbitrary prose for IDs.

Deleted/discarded allocations remain consumed across save/reload through per-base named high-water counters. Collisions also check natural numeric-ending stems: an old `thing_red_2` can represent name `Red 2` or the second `Red`; neither spelling may recycle the same reserved ID. Historical numeric counters still protect old IDs such as `thing_2`. Supplied named identities from saves predating named-counter metadata become durable whole-stem reservations; new generated suffixes use their shared base counter rather than per-ID tombstones.

Existing saved and pending IDs, including UUID-style/custom identities, remain unchanged through ordinary hydration and renames. Missing old metadata initializes empty and loaded records reserve their exact identities. A rejected preview may consume an ordinal, which remains consumed on the next save.

## Save-Version And ID Migration

Ordinary hydration preserves supplied historical IDs and exact references, including saves below version `1.2` or without version metadata. The former automatic numeric-ID rewrite is removed. Only explicit `/migrate_ids` converts supported existing UUIDs; unrelated legacy need-bar/time/schema migrations retain their native behavior.

See the [implementation plan](../superpowers/plans/2026-11-04-name-derived-domain-ids.md) for scope and verification.

Item definitions use `itemDefinition` (alias `itemdef`) with prefix `itemdef` and the canonical item name as the source. Catalogue hydration reserves saved definition IDs alongside live domain IDs; definitions retain IDs after all instances disappear.

Standard reusable item families allocate `itemFamily` / `itemfamily` IDs from their canonical name and reserve saved family IDs before hydration.

## Sequential operational API

`nextSequential(category)` returns `category_integer`; `reserveSequential(category,count)` reserves a complete server/browser block; `registerSequential(id)` registers a known supplied numeric identity; `discardSequentialRanges()` abandons unused local ranges at a load boundary. These delegate to the durable operational allocator, independently of `reset()` and `withIsolatedState()`. Detached explicit UUID migration can consume durable reservations and leave gaps even though the ordinary domain maps are restored. New named domain allocation remains unchanged.
