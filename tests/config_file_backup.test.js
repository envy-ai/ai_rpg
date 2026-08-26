const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { backupConfigFile } = require('../ConfigFileBackup.js');

test('backupConfigFile preserves the exact existing YAML in an ignored sibling directory', async (t) => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'airpg-config-backup-'));
    t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
    const configPath = path.join(root, 'config.yaml');
    const original = '# retained comment\nserver:\n  port: 7777\n';
    await fs.promises.writeFile(configPath, original, 'utf8');

    const backupPath = await backupConfigFile(configPath, {
        now: () => new Date('2026-08-14T12:34:56.789Z'),
        createId: () => 'test-id'
    });

    assert.equal(
        backupPath,
        path.join(root, 'config-backups', 'config-2026-08-14T12-34-56-789Z-test-id.yaml')
    );
    assert.equal(await fs.promises.readFile(backupPath, 'utf8'), original);
    assert.equal(await fs.promises.readFile(configPath, 'utf8'), original);
});
