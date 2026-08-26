'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { backupConfigFile } = require('./ConfigFileBackup.js');

const MODES = Object.freeze(['generation', 'edit']);

function emptyPresets() {
    return { generation: {}, edit: {} };
}

function invalidPreset(message) {
    const error = new Error(message);
    error.code = 'INVALID_PRESET';
    return error;
}

function normalizePresetCollection(value, sourceLabel) {
    if (value === null || value === undefined) {
        return emptyPresets();
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${sourceLabel} must contain a YAML mapping.`);
    }

    const normalized = emptyPresets();
    for (const mode of MODES) {
        const entries = value[mode];
        if (entries === null || entries === undefined) {
            continue;
        }
        if (typeof entries !== 'object' || Array.isArray(entries)) {
            throw new Error(`${sourceLabel}.${mode} must be a YAML mapping.`);
        }
        for (const [name, settings] of Object.entries(entries)) {
            const normalizedName = name.trim();
            if (!normalizedName) {
                throw new Error(`${sourceLabel}.${mode} contains an empty preset name.`);
            }
            if (['__proto__', 'prototype', 'constructor'].includes(normalizedName.toLowerCase())) {
                throw new Error(`${sourceLabel}.${mode} contains reserved preset name "${normalizedName}".`);
            }
            if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
                throw new Error(`${sourceLabel}.${mode}.${normalizedName} must be a YAML mapping.`);
            }
            normalized[mode][normalizedName] = settings;
        }
    }
    return normalized;
}

class ImageWorkflowPresetStore {
    constructor(filePath, options = {}) {
        if (typeof filePath !== 'string' || !filePath.trim()) {
            throw new TypeError('ImageWorkflowPresetStore requires a preset file path.');
        }
        this.filePath = path.resolve(filePath);
        this.fs = options.fs || fs;
        this.yaml = options.yaml || yaml;
        this.backupFile = options.backupFile || backupConfigFile;
    }

    async load() {
        let source;
        try {
            source = await this.fs.promises.readFile(this.filePath, 'utf8');
        } catch (error) {
            if (error?.code === 'ENOENT') {
                return emptyPresets();
            }
            throw new Error(`Unable to read image workflow presets from ${this.filePath}: ${error.message}`);
        }

        let parsed;
        try {
            parsed = this.yaml.load(source);
        } catch (error) {
            throw new Error(`Unable to parse image workflow presets from ${this.filePath}: ${error.message}`);
        }
        return normalizePresetCollection(parsed, this.filePath);
    }

    async savePreset({ mode, name, settings, overwrite = false }) {
        if (!MODES.includes(mode)) {
            throw invalidPreset(`Unsupported image workflow preset mode "${mode}".`);
        }
        const normalizedName = typeof name === 'string' ? name.trim() : '';
        if (!normalizedName) {
            throw invalidPreset('Preset name cannot be empty.');
        }
        if (['__proto__', 'prototype', 'constructor'].includes(normalizedName.toLowerCase())) {
            throw invalidPreset(`Preset name "${normalizedName}" is reserved.`);
        }
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
            throw invalidPreset('Preset settings must be a JSON object.');
        }

        const presets = await this.load();
        if (Object.prototype.hasOwnProperty.call(presets[mode], normalizedName) && overwrite !== true) {
            const error = new Error(
                `Preset "${normalizedName}" already exists. Select it and use Save to replace it.`
            );
            error.code = 'PRESET_EXISTS';
            throw error;
        }

        const normalizedSettings = mode === 'edit'
            ? Object.fromEntries(Object.entries(settings).filter(([key]) => key !== 'resolutions'))
            : settings;
        presets[mode][normalizedName] = normalizedSettings;

        await this.fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
        if (this.fs.existsSync(this.filePath)) {
            await this.backupFile(this.filePath);
        }
        await this.fs.promises.writeFile(this.filePath, this.yaml.dump(presets, {
            defaultFlowStyle: false,
            quotingType: '"',
            forceQuotes: false
        }), 'utf8');

        return { name: normalizedName, mode, presets, filePath: this.filePath };
    }
}

module.exports = {
    ImageWorkflowPresetStore,
    emptyPresets,
    normalizePresetCollection
};
