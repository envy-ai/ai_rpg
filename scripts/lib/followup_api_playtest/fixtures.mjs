import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireFixtureName(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9._-]+$/.test(value.trim())) {
        throw new Error('Fixture names may contain only letters, numbers, dots, underscores, and hyphens.');
    }
    return value.trim();
}

async function listFilesRecursively(directory, prefix = '') {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    const files = [];
    for (const entry of entries) {
        const relative = prefix ? path.join(prefix, entry.name) : entry.name;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...await listFilesRecursively(absolute, relative));
        } else if (entry.isFile()) {
            files.push(relative);
        }
    }
    return files;
}

export async function hashDirectory(directory) {
    const hash = crypto.createHash('sha256');
    const files = await listFilesRecursively(directory);
    for (const relative of files) {
        hash.update(relative.replaceAll(path.sep, '/'), 'utf8');
        hash.update('\0');
        hash.update(await fs.readFile(path.join(directory, relative)));
        hash.update('\0');
    }
    return `sha256:${hash.digest('hex')}`;
}

export async function loadFixtureManifest(root, fixtureName) {
    const name = requireFixtureName(fixtureName);
    const fixtureRoot = path.join(root, 'tests', 'followup_api_playtest', 'fixtures', name);
    const manifestPath = path.join(fixtureRoot, 'manifest.json');
    let manifest;
    try {
        manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    } catch (error) {
        throw new Error(`Failed to load fixture manifest ${name}: ${error.message}`);
    }
    if (!isPlainObject(manifest) || manifest.version !== 1 || manifest.name !== name) {
        throw new Error(`Fixture manifest ${name} must contain version=1 and a matching name.`);
    }
    if (!isPlainObject(manifest.entities)) {
        throw new Error(`Fixture manifest ${name} requires an entities object.`);
    }
    const saveDirectory = path.join(fixtureRoot, 'save');
    const stat = await fs.stat(saveDirectory).catch(() => null);
    if (!stat?.isDirectory()) {
        throw new Error(`Fixture ${name} save directory is missing: ${saveDirectory}`);
    }
    if (typeof manifest.integrity !== 'string' || !/^sha256:[a-f0-9]{64}$/i.test(manifest.integrity)) {
        throw new Error(`Fixture manifest ${name} has an invalid integrity hash.`);
    }
    const actualIntegrity = await hashDirectory(saveDirectory);
    if (actualIntegrity !== manifest.integrity) {
        throw new Error(`Fixture ${name} integrity mismatch: expected ${manifest.integrity}, got ${actualIntegrity}.`);
    }
    return { ...manifest, fixtureRoot, saveDirectory, manifestPath };
}

export async function prepareRuntimeFixture(root, fixtureName) {
    const manifest = await loadFixtureManifest(root, fixtureName);
    const runtimeName = `followup_${manifest.name}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const runtimeDirectory = path.join(root, 'autosaves', runtimeName);
    await fs.mkdir(path.dirname(runtimeDirectory), { recursive: true });
    await fs.cp(manifest.saveDirectory, runtimeDirectory, { recursive: true, errorOnExist: true });
    const metadataPath = path.join(runtimeDirectory, 'metadata.json');
    let metadata;
    try {
        metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
    } catch (error) {
        throw new Error(`Prepared fixture ${manifest.name} has invalid metadata.json: ${error.message}`);
    }
    metadata.saveName = runtimeName;
    metadata.source = 'autosaves';
    metadata.timestamp = new Date().toISOString();
    await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
    return {
        manifest,
        runtimeName,
        runtimeDirectory,
        saveType: 'autosaves'
    };
}

export async function removeRuntimeFixture(runtimeFixture) {
    if (!runtimeFixture?.runtimeDirectory || !runtimeFixture?.runtimeName) return;
    const expectedName = path.basename(runtimeFixture.runtimeDirectory);
    if (expectedName !== runtimeFixture.runtimeName || !runtimeFixture.runtimeName.startsWith('followup_')) {
        throw new Error('Refusing to remove an unrecognized runtime fixture directory.');
    }
    await fs.rm(runtimeFixture.runtimeDirectory, { recursive: true, force: true });
}

export async function promoteFixture(root, {
    name,
    sourceSaveName,
    sourceSaveType = 'saves',
    manifestInput,
    replace = false
} = {}) {
    const fixtureName = requireFixtureName(name);
    const saveName = requireFixtureName(sourceSaveName);
    if (!['saves', 'autosaves'].includes(sourceSaveType)) {
        throw new Error('sourceSaveType must be saves or autosaves.');
    }
    if (!isPlainObject(manifestInput) || !isPlainObject(manifestInput.entities)) {
        throw new Error('Fixture promotion requires a manifest input with an entities object.');
    }
    if (!Array.isArray(manifestInput.invariants) || !manifestInput.invariants.length) {
        throw new Error('Fixture promotion requires at least one explicit runtime invariant.');
    }
    if (!isPlainObject(manifestInput.validation) || manifestInput.validation.passed !== true) {
        throw new Error('Fixture promotion requires explicit validation.passed=true evidence.');
    }
    const sourceDirectory = path.join(root, sourceSaveType, saveName);
    const sourceStat = await fs.stat(sourceDirectory).catch(() => null);
    if (!sourceStat?.isDirectory()) {
        throw new Error(`Source save directory not found: ${sourceDirectory}`);
    }
    const sourceMetadataPath = path.join(sourceDirectory, 'metadata.json');
    const sourceMetadata = JSON.parse(await fs.readFile(sourceMetadataPath, 'utf8'));
    const fixtureRoot = path.join(root, 'tests', 'followup_api_playtest', 'fixtures', fixtureName);
    const fixtureSaveDirectory = path.join(fixtureRoot, 'save');
    const existing = await fs.stat(fixtureRoot).catch(() => null);
    if (existing && !replace) {
        throw new Error(`Fixture ${fixtureName} already exists; pass replace=true to replace it explicitly.`);
    }
    if (existing && replace) {
        await fs.rm(fixtureRoot, { recursive: true, force: true });
    }
    await fs.mkdir(fixtureRoot, { recursive: true });
    await fs.cp(sourceDirectory, fixtureSaveDirectory, { recursive: true, errorOnExist: true });
    const integrity = await hashDirectory(fixtureSaveDirectory);
    const manifest = {
        version: 1,
        name: fixtureName,
        description: typeof manifestInput.description === 'string' ? manifestInput.description : '',
        createdAt: new Date().toISOString(),
        source: {
            setupCommand: typeof manifestInput.setupCommand === 'string' ? manifestInput.setupCommand : '',
            saveName,
            saveType: sourceSaveType,
            settingName: sourceMetadata.currentSettingName || sourceMetadata.settingName || null,
            playerName: sourceMetadata.playerName || null
        },
        configProfile: typeof manifestInput.configProfile === 'string' ? manifestInput.configProfile : null,
        requiredMods: Array.isArray(manifestInput.requiredMods) ? manifestInput.requiredMods : [],
        worldTime: manifestInput.worldTime ?? null,
        entities: manifestInput.entities,
        invariants: Array.isArray(manifestInput.invariants) ? manifestInput.invariants : [],
        validation: isPlainObject(manifestInput.validation) ? manifestInput.validation : {},
        integrity
    };
    await fs.writeFile(path.join(fixtureRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return { fixtureRoot, fixtureSaveDirectory, manifest };
}
