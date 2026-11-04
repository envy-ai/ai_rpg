# DomainIdMigrationRuntime

`runDomainIdMigration({assertSupported,acquireBarrier,cancelAndDrain,capture,prepare,writeBackup,install,notify})`
orchestrates the explicit [/migrate_ids](../slashcommands/MigrateIdsCommand.md)
transaction. All callbacks are required. `acquireBarrier()` returns its release
callback, `capture()` returns the serializable snapshot, `prepare(snapshot)` returns
`{serialized,counts}`, and `writeBackup(snapshot)` returns a recoverable directory.
The other lifecycle callbacks may complete asynchronously, except the synchronous
support guard and barrier acquisition.

Preparation receives an isolated JSON clone; the captured original and prepared result
remain available for verification. After installation and rollback, recaptured
state crosses the same JSON serialization boundary before
`assertSnapshotPreserved(expected,canonicalCapture)`. This honors nested models'
`toJSON()` contracts, including live equipped `Thing` objects whose persisted
fields are backed by private state and prototype getters. The checker still
requires every captured object
field/list entry and scalar to remain present and equal, permits added defaults,
and ignores only `metadata.timestamp`. Installation or preservation failures
restore and verify the original. Restoration failure produces an `AggregateError`
retaining both errors; successful restoration raises the original failure as its
cause with the backup path. Errors distinguish installation from preservation
verification through their message and `migrationPhase`; failed restoration also
records `rollbackPhase`, distinguishing restoration from restoration verification.
Original cause and restoration stacks remain in the reported stack.
Browser notification runs after commit, and its error
reports `migrationCommitted: true` without rolling back committed identities.
Barrier release always runs in `finally`.

Native migration installation restores saved audit timestamps after reconstructing
locations, regions, exits and the active `SettingInfo` profile. Ordinary profile
loading retains its existing constructor timestamp behavior; the migration-only
restoration is necessary to preserve the captured world exactly.
