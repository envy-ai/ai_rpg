import fs from 'node:fs/promises';
import path from 'node:path';
import { dump, load } from 'js-yaml';

import {
    loadConfigProfile,
    writeConfigProfileOverride
} from '../followup_api_playtest/config_profiles.mjs';

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function readYamlObject(filename, { optional = false } = {}) {
    try {
        const parsed = load(await fs.readFile(filename, 'utf8'));
        if (!isPlainObject(parsed)) throw new Error('file does not contain a YAML object');
        return parsed;
    } catch (error) {
        if (optional && error.code === 'ENOENT') return {};
        throw new Error(`Failed to read benchmark YAML ${filename}: ${error.message}`);
    }
}

function collectOverrideNames(...configs) {
    const names = new Set();
    for (const config of configs) {
        const overrides = config?.ai_model_overrides;
        if (!isPlainObject(overrides)) continue;
        for (const name of Object.keys(overrides)) names.add(name);
    }
    return [...names].sort();
}

async function atomicWriteText(filename, content) {
    await fs.mkdir(path.dirname(filename), { recursive: true });
    const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, content, 'utf8');
    await fs.rename(temporary, filename);
}

export async function writeBenchmarkConfig(root, {
    profileName,
    model,
    baseOverridePath,
    outputPath,
    endpoint = null,
    routerPreload = true
} = {}) {
    if (typeof model !== 'string' || !model.trim()) throw new Error('Benchmark model must be a non-empty string.');
    if (typeof profileName !== 'string' || !profileName.trim()) throw new Error('Benchmark profileName is required.');
    if (typeof baseOverridePath !== 'string' || !baseOverridePath.trim()) {
        throw new Error('Benchmark baseOverridePath is required.');
    }
    if (typeof outputPath !== 'string' || !outputPath.trim()) throw new Error('Benchmark outputPath is required.');
    if (endpoint !== null && (typeof endpoint !== 'string' || !endpoint.trim())) {
        throw new Error('Benchmark endpoint must be a non-empty string when supplied.');
    }

    const selectedModel = model.trim();
    const profile = await loadConfigProfile(root, profileName.trim());
    const additionalValues = {
        'ai.model': selectedModel,
        'ai.local_startup_script_path': '',
        'ai.record_outputs_file': '',
        'ai.force_outputs_file': '',
        'imagegen.enabled': false
    };
    if (endpoint) additionalValues['ai.endpoint'] = endpoint.trim();
    if (!Object.prototype.hasOwnProperty.call(profile.values, 'router_preload_model')) {
        additionalValues.router_preload_model = routerPreload ? selectedModel : '';
    }
    const absoluteOutput = path.resolve(root, outputPath);
    await writeConfigProfileOverride(root, profile, absoluteOutput, {
        additionalValues,
        baseOverridePath
    });

    const generated = await readYamlObject(absoluteOutput);
    const projectConfig = await readYamlObject(path.join(root, 'config.yaml'), { optional: true });
    const baseOverride = await readYamlObject(path.resolve(root, baseOverridePath));
    generated.ai ||= {};
    generated.ai.model = selectedModel;
    generated.ai.local_startup_script_path = '';
    generated.ai.record_outputs_file = '';
    generated.ai.force_outputs_file = '';
    if (endpoint) generated.ai.endpoint = endpoint.trim();
    generated.imagegen ||= {};
    generated.imagegen.enabled = false;
    if (!Object.prototype.hasOwnProperty.call(profile.values, 'router_preload_model')) {
        generated.router_preload_model = routerPreload ? selectedModel : '';
    }

    const overrideNames = collectOverrideNames(projectConfig, baseOverride, generated);
    generated.ai_model_overrides ||= {};
    for (const overrideName of overrideNames) {
        const existing = isPlainObject(generated.ai_model_overrides[overrideName])
            ? generated.ai_model_overrides[overrideName]
            : {};
        generated.ai_model_overrides[overrideName] = {
            ...existing,
            model: selectedModel
        };
        if (endpoint) generated.ai_model_overrides[overrideName].endpoint = endpoint.trim();
    }
    await atomicWriteText(absoluteOutput, dump(generated, { noRefs: true, lineWidth: 120 }));
    return {
        outputPath: absoluteOutput,
        profile,
        model: selectedModel,
        endpoint: endpoint?.trim() || null,
        routerPreloadModel: generated.router_preload_model ?? null,
        rewrittenOverrideProfiles: overrideNames
    };
}
