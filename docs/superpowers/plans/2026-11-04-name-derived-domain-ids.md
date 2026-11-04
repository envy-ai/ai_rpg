# Name-derived domain IDs

## Accepted scope and behavior

All newly allocated IDs from the shared `IdGenerator` use `prefix_first_three_words`, then `_2`, `_3`, and later collision suffixes. Existing supplied, saved, and pending IDs remain stable through load, edits, and renames. Existing pre-1.2 numeric-ID migration remains unchanged. Operational IDs outside this allocator remain outside the change.

The first three source words are Unicode letter/number runs with internal straight or curly apostrophes; hyphens, underscores, whitespace, and other punctuation separate words. Apply the existing full-name NFC/lowercase/snake normalization after selecting those words. Thus `Fizz's Sparkle Energy Elixir` produces `fizz_s_sparkle_energy`. `normalizeName` retains its full-name semantics for canonical discipline comparisons. Missing or unusable source text throws with correction guidance.

Discipline reuse compares the complete normalized name and retains canonical metadata and IDs. Different full names sharing three words receive separate suffixed identities.

## Source fields

| Prefix | Source for a missing ID |
| --- | --- |
| `char` | Character name, including the existing displayed `Unnamed Player` default |
| `thing`, `loc`, `region`, `faction` | Validated object name |
| `quest` | Required quest name |
| `obj` | Objective description |
| `status` | Nonempty name, otherwise description; region string/text statuses use their normalized description |
| `ability`, `technique`, `discipline` | Name |
| `mystery`, `mthread`, `tracker` | Name |
| `sevent` | Normalized event text (the existing event/description input contract) |
| `exit` | Description, otherwise a loaded destination's name, otherwise the required destination ID |
| `tgrant` | Referenced technique name; owning item's descriptive name where the existing contract allows an unresolved reference |

Copies allocate from their final names and retain coherent new source/grant references. Technique correction slots allocate only once a readable candidate name exists, then retain that reserved identity across corrections. Standard and TinyBrain callers share these engine boundaries.

## Allocator and persistence

- `next(type, sourceText)` and `nextUniqueNamed(type, sourceText)` allocate distinct first-three-word IDs.
- `nextNamed(type, fullName)` reuses a process-local reservation for the same complete normalized name and uses distinct suffixes for truncated-stem collisions.
- `normalizeStem(sourceText)` exposes the first-three-word normalization; `normalizeName` remains unchanged.
- `snapshotNamedCounters()` and `seedNamedCounters()` persist nested `{ prefix: { normalizedStem: highestOrdinal } }` in `metadata.idNameCounters`. Ordinal 1 denotes the bare ID; 2 denotes `_2`.
- Existing `snapshotCounters()` / `seedCounters()` and `metadata.idCounters` retain historical numeric reservations.
- Deleted and discarded reservations survive save/reload through the named high-water counters. Exact historical checks account for numeric-ending natural stems as well as generated suffixes.
- Hydration seeds both counter stores and reserves supplied identities across serialized categories and nested owned/pending records before any model allocates missing IDs. Reservation visits known identity fields and map keys, not arbitrary prose/string values.

The new metadata is additive. Older saves without it reserve all supplied identities before allocation; no existing ID is rewritten by this change.

## Verification

Focused allocator/model/service/save tests cover Unicode and punctuation, apostrophes, first-three-word collisions, full-title discipline reuse, numeric-ending stems, explicit IDs, copy/grant identities, deleted/discarded persistence, late saved identities, nested pending drafts, source errors, and correction-slot stability. Existing affected tests must follow the new contract rather than retain numeric-ID compatibility. Run relevant syntax checks and regression tests under the required 16 GB systemd test scope. No server restart, live-save writes, or git operations are part of this task.

## Explicit running-world migration extension

The user additionally requested a slash command that updates all shared-domain IDs in the running game. This is a separately invoked operation; implementation/testing must not execute it on the user's live world. Ordinary load and rename still preserve existing IDs.

Prepare a detached complete serialized snapshot, derive a canonical old-to-new identity map using the same source-word rules, and rewrite exact structured references and map keys. Preserve prose/history text and operational UUIDs. Derived technique identities require semantic rewriting: learned/status source IDs, implicit status-grant IDs, and receipt effect mutation IDs must remain coherent with remapped actor/technique/status/grant IDs. Pending quest offers belong in the captured snapshot. Story bindings and extension-owned references require an explicit supported migration contract or a clear preflight rejection; silent partial migration is unacceptable.

The [`/migrate_ids` command](../../slashcommands/MigrateIdsCommand.md), alias `/migrate_domain_ids`, coordinates the existing runtime-replacement/cancellation lifecycle and installs only a fully prepared validated candidate, with an original backup available for recovery. [DomainIdMigration](../../classes/DomainIdMigration.md) prepares the pure map; [runtime orchestration](../../classes/DomainIdMigrationRuntime.md) owns preservation and rollback. Bound Stories are explicitly unsupported and reject before mutation without sidecar writes. Prepared worlds keep conforming IDs so repeated command execution does not churn identities. Derived mappings also cover equipment status/grant sources, party/route quest benefit IDs and compound ability-image targets. Strict migration hydration preserves audit times/null visit times, propagates entity errors, and skips ordinary pending-region repair; normal loading retains its existing behavior.
