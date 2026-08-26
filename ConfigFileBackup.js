const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

async function backupConfigFile(configPath, options = {}) {
    if (typeof configPath !== 'string' || !configPath.trim()) {
        throw new TypeError('backupConfigFile requires a config file path.');
    }

    const backupDirectory = options.backupDirectory
        || path.join(path.dirname(configPath), 'config-backups');
    const now = typeof options.now === 'function' ? options.now() : new Date();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
        throw new TypeError('backupConfigFile requires options.now to return a valid Date.');
    }
    const createId = typeof options.createId === 'function' ? options.createId : randomUUID;
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDirectory, `config-${timestamp}-${createId()}.yaml`);

    await fs.promises.mkdir(backupDirectory, { recursive: true });
    await fs.promises.copyFile(configPath, backupPath, fs.constants.COPYFILE_EXCL);
    return backupPath;
}

module.exports = { backupConfigFile };
