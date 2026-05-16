# IdGenerator

## Purpose
Central allocator for compact persisted domain-object IDs. It replaces timestamp/random IDs for objects the LLM may need to reference with per-type counters such as `char_1`, `thing_1`, `loc_1`, and `region_1`.

## Prefixes
- `char`: players and NPCs.
- `thing`: items and scenery.
- `loc`: locations.
- `exit`: location exits.
- `region`: regions and pending region stubs.
- `faction`: factions.
- `quest`: quests.
- `obj`: quest objectives.
- `status`: status effects.
- `mystery`: mystery boxes.
- `mthread`: mystery threads.

Operational IDs such as chat message IDs, prompt/session IDs, generated-image request IDs, and similar transient runtime identifiers are not allocated here.

## API
- `next(type)`: synchronously returns the next unused ID for a type and reserves it.
- `register(type, id)`: records an explicit or loaded ID and advances the counter when it already matches the compact prefix format.
- `seedCounters(counters)`: seeds counters from save metadata before hydration.
- `snapshotCounters()`: returns persisted counter values for `metadata.idCounters`.
- `reset()`: clears counters and reservations, used before loading a save.

## Notes
- Allocation is synchronous, so async turn work cannot interleave inside a single ID assignment.
- `next(...)` skips already registered IDs so newly generated objects do not collide with loaded or explicit IDs.
- Save metadata persists counters so deleted IDs are not reused after save/load.
