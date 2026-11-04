'use strict';

const clone = value => JSON.parse(JSON.stringify(value));

/** A migration must retain every captured value; hydration may add defaults. */
function assertSnapshotPreserved(expected, actual, path = 'snapshot') {
    if (path === 'snapshot.metadata.timestamp') return;
    if (expected === null || typeof expected !== 'object') {
        if (expected !== actual) throw new Error(`${path}: ID migration hydration changed a captured value. Restore the backup and correct the hydration contract before retrying.`);
        return;
    }
    if (!actual || typeof actual !== 'object' || Array.isArray(expected) !== Array.isArray(actual)) {
        throw new Error(`${path}: ID migration hydration lost a captured record or collection. Restore the backup before retrying.`);
    }
    if (Array.isArray(expected) && expected.length !== actual.length) {
        throw new Error(`${path}: ID migration hydration changed a captured list's length. Restore the backup before retrying.`);
    }
    for (const key of Object.keys(expected)) {
        if (!Object.hasOwn(actual, key)) throw new Error(`${path}.${key}: ID migration hydration lost a captured field. Restore the backup before retrying.`);
        assertSnapshotPreserved(expected[key], actual[key], `${path}.${key}`);
    }
}

/** Native lifecycle callbacks keep this transaction independent of HTTP/UI. */
async function runDomainIdMigration({ assertSupported, acquireBarrier, cancelAndDrain, capture, prepare, writeBackup, install, notify }) {
    for (const [name, callback] of Object.entries({ assertSupported, acquireBarrier, cancelAndDrain, capture, prepare, writeBackup, install, notify })) {
        if (typeof callback !== 'function') throw new TypeError(`ID migration requires ${name} callback.`);
    }
    assertSupported();
    const release = acquireBarrier();
    if (typeof release !== 'function') throw new TypeError('ID migration barrier must return a release callback.');
    try {
        await cancelAndDrain();
        assertSupported();
        const original = clone(capture());
        const prepared = prepare(clone(original));
        if (!prepared?.serialized || !prepared.counts) throw new Error('ID migration preparation must return a serialized snapshot and counts.');
        const backupPath = await writeBackup(clone(original));
        if (typeof backupPath !== 'string' || !backupPath.trim()) throw new Error('ID migration backup must return its recoverable save directory.');
        let migrationPhase = 'installation';
        try {
            await install(clone(prepared.serialized));
            migrationPhase = 'preservation verification';
            // Capture may contain live model instances (for example equipped
            // Things). Compare their saved JSON, just like the original snapshot.
            assertSnapshotPreserved(prepared.serialized, clone(capture()));
        } catch (cause) {
            let rollbackPhase = 'restoration';
            try {
                await install(clone(original));
                rollbackPhase = 'restoration verification';
                assertSnapshotPreserved(original, clone(capture()));
            } catch (rollbackError) {
                const error = new AggregateError([cause, rollbackError], `ID migration failed during ${migrationPhase}, and original-runtime ${rollbackPhase} also failed. Load the pre-migration backup at ${backupPath}.`, { cause });
                error.stack += `\nOriginal migration failure:\n${cause.stack || cause.message}\nOriginal-runtime restoration failure:\n${rollbackError.stack || rollbackError.message}`;
                error.migrationPhase = migrationPhase;
                error.rollbackPhase = rollbackPhase;
                error.backupPath = backupPath;
                throw error;
            }
            const error = new Error(`ID migration failed during ${migrationPhase}; the original runtime was restored. Backup: ${backupPath}. ${cause.message}`, { cause });
            error.stack += `\nCaused by:\n${cause.stack || cause.message}`;
            error.migrationPhase = migrationPhase;
            error.backupPath = backupPath;
            throw error;
        }
        // Notification happens after commit and cannot trigger a mechanics retry.
        try {
            await notify();
        } catch (cause) {
            const error = new Error(`ID migration committed, but the browser refresh failed. Reload every connected tab. Backup: ${backupPath}. ${cause.message}`, { cause });
            error.stack += `\nCaused by:\n${cause.stack || cause.message}`;
            error.migrationCommitted = true;
            error.backupPath = backupPath;
            throw error;
        }
        return { counts: prepared.counts, backupPath };
    } finally {
        release();
    }
}

module.exports = { runDomainIdMigration, assertSnapshotPreserved };
