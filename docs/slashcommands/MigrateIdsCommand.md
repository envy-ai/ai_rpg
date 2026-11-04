# MigrateIdsCommand

`/migrate_ids` (alias `/migrate_domain_ids`) explicitly migrates the current loaded
game's shared domain identities to the name format described in
[IdGenerator](../classes/IdGenerator.md). It accepts no arguments. Operational,
chat-message, image-request, setting-profile and story-library identities are
outside its scope. Existing conforming IDs remain stable; structured references
and derived technique source/receipt identities are remapped together.

The command is available through `interaction.migrateDomainIds()`. It first
rejects a missing game or any player `modState['story-authoring']` binding/setup:
the separate Stories library retains canonical game IDs and requires a coordinated
library migration. No binding or library state is cleared or rewritten.

The native game replacement barrier blocks mutations, advances runtime generation,
cancels prompts/input/images and drains accepted gameplay/continuity work. Pending
quest offers are retained. The settled snapshot includes live metadata/counters,
pending quest confirmations and mod fields. Pure detached preparation validates
the remapped graph before installation.

The transaction also captures the known runtime player-arrival visit map and
processed-movement flag. Location keys remap while arrival tokens and pre-arrival
visit facts remain exact, including after rollback; migration cannot manufacture
a new arrival and repeat hostile spawning or hidden-discovery checks. This
transaction-only state is omitted by the ordinary disk save writer.

Before changing live registries, the command writes a separately loadable recovery
save under `saves/<timestamp>_<unique>_before_id_migration`. Existing saves are not
rewritten. A backup failure stops installation. Native strict snapshot hydration
rebuilds registries/indexes, restores the exact current player, pending offers,
world metadata and location/region/exit/setting audit timestamps, then verifies captured content was
retained. It skips load-only pending-region merging and prompt/backfill work.
Preservation checks compare canonical JSON snapshots, honoring nested equipped
items' native `toJSON()` representation while still rejecting missing or changed
saved fields.

Installation/verification failures restore the original snapshot. An incomplete
restore retains both errors and the recovery directory in an `AggregateError`;
the existing API error response provides its stack. Notification failures after
commit explicitly report that migration committed and request manual reload.
Diagnostics identify whether installation, preservation verification, restoration
or restoration verification failed and retain the original cause stacks.

Success reports per-domain counts and the recovery directory, broadcasts
`reload_page` to every connected browser, and returns the existing slash-command
reload action to the invoking browser. Save normally afterward to persist the
migrated running game. The command is implemented but is never automatically
executed at startup, on load, or by development verification.

`DomainIdMigrationRuntime.runDomainIdMigration` owns the injected transaction and
`assertSnapshotPreserved` rejects dropped/changed captured values while permitting
additional native defaults. Only the generated snapshot metadata timestamp is
excluded. Focused tests exercise preparation/backup failures, successful commit,
restoration, failed restoration and committed notification errors without touching
a live game.
