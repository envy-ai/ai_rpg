import fs from 'node:fs/promises';
import path from 'node:path';
import { dump, load } from 'js-yaml';

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireProfileName(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9._-]+$/.test(value.trim())) {
        throw new Error('Config profile names may contain only letters, numbers, dots, underscores, and hyphens.');
    }
    return value.trim();
}

function setNestedValue(target, objectPath, value) {
    const segments = objectPath.split('.').map(segment => segment.trim()).filter(Boolean);
    if (!segments.length) {
        throw new Error('Config profile paths must contain at least one segment.');
    }
    let cursor = target;
    for (let index = 0; index < segments.length - 1; index += 1) {
        const segment = segments[index];
        if (!isPlainObject(cursor[segment])) cursor[segment] = {};
        cursor = cursor[segment];
    }
    cursor[segments.at(-1)] = value;
}

function mergeDeep(target, source) {
    if (!isPlainObject(source)) return target;
    const output = isPlainObject(target) ? { ...target } : {};
    for (const [key, value] of Object.entries(source)) {
        output[key] = isPlainObject(value)
            ? mergeDeep(isPlainObject(output[key]) ? output[key] : {}, value)
            : value;
    }
    return output;
}

async function loadBaseOverride(root, baseOverridePath) {
    if (!baseOverridePath) return {};
    const resolvedPath = path.resolve(root, baseOverridePath);
    let parsed;
    try {
        parsed = load(await fs.readFile(resolvedPath, 'utf8'));
    } catch (error) {
        throw new Error(`Failed to load base CLI override ${resolvedPath}: ${error.message}`);
    }
    if (!isPlainObject(parsed)) {
        throw new Error(`Base CLI override must contain a YAML object: ${resolvedPath}`);
    }
    return parsed;
}

function parseConfigReply(content, expectedPath) {
    if (typeof content !== 'string') {
        throw new Error(`Configuration reply for ${expectedPath} is missing text content.`);
    }
    if (content.includes('No configuration value found')) {
        throw new Error(`Runtime configuration is missing required path ${expectedPath}.`);
    }
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/i);
    if (jsonMatch) {
        try {
            return JSON.parse(jsonMatch[1]);
        } catch (error) {
            throw new Error(`Runtime configuration JSON for ${expectedPath} is invalid: ${error.message}`);
        }
    }
    const inlineMatches = [...content.matchAll(/`([^`]*)`/g)];
    if (inlineMatches.length < 2) {
        throw new Error(`Could not parse runtime configuration reply for ${expectedPath}.`);
    }
    const raw = inlineMatches.at(-1)[1];
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (raw === 'null') return null;
    if (raw === '') return '';
    const numeric = Number(raw);
    return Number.isFinite(numeric) && String(numeric) === raw ? numeric : raw;
}

export async function loadConfigProfile(root, profileName, stack = []) {
    const name = requireProfileName(profileName);
    if (stack.includes(name)) {
        throw new Error(`Config profile inheritance cycle: ${[...stack, name].join(' -> ')}`);
    }
    const filename = path.join(root, 'tests', 'followup_api_playtest', 'config_profiles', `${name}.json`);
    let parsed;
    try {
        parsed = JSON.parse(await fs.readFile(filename, 'utf8'));
    } catch (error) {
        throw new Error(`Failed to load config profile ${name} (${filename}): ${error.message}`);
    }
    if (!isPlainObject(parsed) || parsed.version !== 1 || parsed.name !== name || !isPlainObject(parsed.values)) {
        throw new Error(`Config profile ${name} must contain version=1, matching name, and object values.`);
    }
    const allowed = new Set(['version', 'name', 'description', 'extends', 'values']);
    for (const key of Object.keys(parsed)) {
        if (!allowed.has(key)) throw new Error(`Unknown config profile field ${name}.${key}.`);
    }
    let values = {};
    if (parsed.extends !== undefined) {
        const parent = await loadConfigProfile(root, requireProfileName(parsed.extends), [...stack, name]);
        values = { ...parent.values };
    }
    for (const [objectPath, value] of Object.entries(parsed.values)) {
        if (typeof objectPath !== 'string' || !objectPath.trim() || objectPath.split('.').some(segment => !segment.trim())) {
            throw new Error(`Config profile ${name} contains invalid path ${JSON.stringify(objectPath)}.`);
        }
        values[objectPath] = value;
    }
    return {
        version: 1,
        name,
        description: typeof parsed.description === 'string' ? parsed.description : '',
        extends: parsed.extends || null,
        values
    };
}

export function configProfileToObject(profile) {
    if (!profile || !isPlainObject(profile.values)) {
        throw new Error('configProfileToObject requires a loaded config profile.');
    }
    const result = {};
    for (const [objectPath, value] of Object.entries(profile.values)) {
        setNestedValue(result, objectPath, value);
    }
    return result;
}

export function buildCassetteConfigValues(mode, cassettePath = null) {
    if (!['live-record', 'replay', 'live-verify', 'state-only'].includes(mode)) {
        throw new Error('Cassette config mode must be live-record, replay, live-verify, or state-only.');
    }
    const normalizedPath = typeof cassettePath === 'string' && cassettePath.trim()
        ? cassettePath.trim()
        : '';
    if (['live-record', 'replay'].includes(mode) && !normalizedPath) {
        throw new Error(`${mode} cassette config requires a cassette path.`);
    }
    if (['live-verify', 'state-only'].includes(mode) && normalizedPath) {
        throw new Error(`${mode} cassette config does not accept a cassette path.`);
    }
    return mode === 'live-record'
        ? {
            'ai.record_outputs_file': normalizedPath,
            'ai.force_outputs_file': ''
        }
        : mode === 'replay'
            ? {
                'ai.record_outputs_file': '',
                'ai.force_outputs_file': normalizedPath
            }
            : {
                'ai.record_outputs_file': '',
                'ai.force_outputs_file': ''
            };
}

export async function writeConfigProfileOverride(root, profile, outputPath = null, {
    additionalValues = {},
    baseOverridePath = null
} = {}) {
    if (!isPlainObject(additionalValues)) {
        throw new Error('Additional config profile values must be an object.');
    }
    const resolvedOutputPath = outputPath
        ? path.resolve(root, outputPath)
        : path.join(root, 'tmp', `followup-api-${profile.name}.override.yaml`);
    const tmpRoot = path.join(root, 'tmp');
    const relative = path.relative(tmpRoot, resolvedOutputPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`CLI config overrides must be written under ${tmpRoot}.`);
    }
    await fs.mkdir(path.dirname(resolvedOutputPath), { recursive: true });
    const mergedProfile = {
        ...profile,
        values: {
            ...profile.values,
            ...additionalValues
        }
    };
    const baseOverride = await loadBaseOverride(root, baseOverridePath);
    const outputConfig = mergeDeep(baseOverride, configProfileToObject(mergedProfile));
    await fs.writeFile(
        resolvedOutputPath,
        dump(outputConfig, { noRefs: true, lineWidth: 120 }),
        'utf8'
    );
    return resolvedOutputPath;
}

export async function inspectRuntimeConfig(apiClient, profile) {
    const effective = {};
    const mismatches = [];
    for (const [objectPath, expected] of Object.entries(profile.values)) {
        const response = await apiClient.fetchJson('POST', '/api/slash-command', {
            command: 'get',
            args: { path: objectPath }
        });
        if (!response.ok || response.payload?.success !== true) {
            throw new Error(`Failed to inspect runtime config ${objectPath}: ${response.payload?.error || response.status}`);
        }
        const reply = Array.isArray(response.payload.replies) ? response.payload.replies[0] : null;
        const actual = parseConfigReply(reply?.content, objectPath);
        effective[objectPath] = actual;
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            mismatches.push({ path: objectPath, expected, actual });
        }
    }
    return { effective, mismatches };
}

export async function assertRuntimeConfigProfile(apiClient, profile) {
    const inspection = await inspectRuntimeConfig(apiClient, profile);
    if (inspection.mismatches.length) {
        const details = inspection.mismatches
            .map(entry => `${entry.path}: expected ${JSON.stringify(entry.expected)}, got ${JSON.stringify(entry.actual)}`)
            .join('; ');
        throw new Error(`Running server does not match config profile ${profile.name}: ${details}`);
    }
    return inspection.effective;
}
