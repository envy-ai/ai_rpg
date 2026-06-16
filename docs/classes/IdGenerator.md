# IdGenerator

## Purpose
`IdGenerator` is the process-local allocator for compact persisted domain-object IDs. It gives model objects stable IDs the LLM and save data can reference, using per-prefix counters such as `char_1`, `thing_1`, `loc_1`, and `region_1`.

The allocator is a singleton with static state. Callers reset it at new-game and load boundaries, seed it from save metadata, and let model constructors register loaded IDs as records hydrate.

Operational IDs such as chat message IDs, prompt/session IDs, generated-image request IDs, and other transient runtime identifiers are outside this allocator.

## Prefixes And Type Aliases
`next(type)`, `register(type, id)`, and `seedCounters(counters)` accept these object type names:

| Prefix | Accepted type keys | Persisted objects |
| --- | --- | --- |
| `char` | `character`, `char`, `player`, `npc` | Players and NPCs |
| `thing` | `thing`, `item` | Items and scenery |
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

Unknown or blank object types throw. The class does not create implicit prefixes.

## API
- `next(type)`: returns and reserves the next unused `${prefix}_${number}` ID for the normalized object type. It skips IDs already registered for that prefix and stores the selected counter value.
- `register(type, id)`: records a non-empty string ID as used for that type. If the trimmed ID exactly matches `${prefix}_${positiveInteger}`, the stored counter advances to at least that value. Non-string and blank IDs are ignored after the type is validated.
- `seedCounters(counters = {})`: seeds counters from a plain object, usually `metadata.idCounters`, using the same accepted type keys as the rest of the API. Unknown keys throw. Counter values must be finite non-negative integers; invalid numeric values throw.
- `snapshotCounters()`: returns positive counter values keyed by compact prefix for persistence in `metadata.idCounters`.
- `reset()`: clears all counters and registered IDs.

## Runtime Callers
- `Player`, `Thing`, `Location`, `LocationExit`, `Region`, `Faction`, `Quest`, and `StatusEffect` allocate missing IDs through `next(...)` and register provided IDs.
- `MysteryBox`, `MysteryThread`, `ScheduledEvent`, and `Tracker` allocate `mystery_n`, `mthread_n`, `sevent_n`, and `tracker_n` IDs and register loaded IDs through their constructors and `loadAll(...)` helpers.
- `Utils.serializeGameState(...)` persists `IdGenerator.snapshotCounters()` as `metadata.idCounters`.
- `Utils.hydrateGameState(...)` runs save migrations, calls `IdGenerator.reset()`, seeds from `metadata.idCounters`, then hydrates model records so constructors/loaders can register explicit IDs.
- The new-game flow in `api.js` resets the generator before clearing and rebuilding world state.

## Allocation Semantics
- Allocation is synchronous, so async turn work cannot interleave inside a single ID assignment.
- Registration reserves the exact ID string for a prefix. Custom IDs that do not match the compact counter pattern are still treated as used, but they do not advance the numeric counter.
- `next(...)` only reuses a compact ID if it is neither registered in memory nor covered by a saved counter. Persisted `metadata.idCounters` prevents deleted compact IDs from being recycled after save/load.
- `snapshotCounters()` omits prefixes that have no positive counter value, so empty worlds do not persist zero counters.

## Save-Version And ID Migration
`Utils.hydrateGameState(...)` includes compatibility behavior for saves below version `1.2`. Before model hydration, persisted domain IDs are mapped to compact counter IDs for these prefixes:

`char`, `thing`, `loc`, `exit`, `region`, `faction`, `quest`, `obj`, and `status`.

The migration rewrites object keys and exact string values that match migrated IDs, including structured references such as inventory IDs, party members, location/region links, exits, vehicle destinations, faction relations, quest references, and status-effect IDs. It does not replace ID substrings embedded inside longer prose.

The migration writes the resulting counters into `metadata.idCounters` and sets the in-memory `metadata.saveFileSaveVersion` to `1.2`. Hydration then resets `IdGenerator`, seeds from those counters, and lets loaded records register their IDs. This preserves existing references while ensuring future allocations continue after the highest migrated counter.
