import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { readScenarioFile, validateScenarioDefinition } from '../followup_api_playtest/scenario.mjs';
import { loadFixtureManifest } from '../followup_api_playtest/fixtures.mjs';

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireSafeName(value, label) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9._-]+$/.test(value.trim())) {
        throw new Error(`${label} must contain only letters, numbers, dots, underscores, and hyphens.`);
    }
    return value.trim();
}

async function discoverJsonFiles(root, relativeRoot) {
    const absoluteRoot = path.resolve(root, relativeRoot);
    const relativeToProject = path.relative(root, absoluteRoot);
    if (relativeToProject.startsWith('..') || path.isAbsolute(relativeToProject)) {
        throw new Error(`Benchmark scenario root must stay inside the project: ${relativeRoot}`);
    }
    const files = [];
    async function visit(directory) {
        const entries = await fs.readdir(directory, { withFileTypes: true });
        for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                await visit(entryPath);
            } else if (entry.isFile() && entry.name.endsWith('.json')) {
                files.push(path.relative(root, entryPath));
            }
        }
    }
    await visit(absoluteRoot);
    return files;
}

export function extractLogicalCaseId(caseName) {
    if (typeof caseName !== 'string') return null;
    return caseName.trim().match(/^([A-Z]+-\d+)(?:-|$)/)?.[1] || null;
}

export function expandExpectedCases(expectedFamilies) {
    if (!Array.isArray(expectedFamilies) || !expectedFamilies.length) {
        throw new Error('Benchmark manifest expectedFamilies must be a non-empty array.');
    }
    const cases = [];
    const seen = new Set();
    for (let index = 0; index < expectedFamilies.length; index += 1) {
        const family = expectedFamilies[index];
        if (!isPlainObject(family)) {
            throw new Error(`expectedFamilies[${index}] must be an object.`);
        }
        const allowed = new Set(['prefix', 'from', 'to', 'exclude']);
        for (const key of Object.keys(family)) {
            if (!allowed.has(key)) throw new Error(`Unknown expectedFamilies[${index}].${key}.`);
        }
        const prefix = requireSafeName(family.prefix, `expectedFamilies[${index}].prefix`);
        if (!/^[A-Z]+$/.test(prefix)) {
            throw new Error(`expectedFamilies[${index}].prefix must contain uppercase letters only.`);
        }
        if (!Number.isInteger(family.from) || !Number.isInteger(family.to) || family.from < 1 || family.to < family.from) {
            throw new Error(`expectedFamilies[${index}] must have a positive integer from/to range.`);
        }
        const excluded = new Set(family.exclude || []);
        if ([...excluded].some(value => !Number.isInteger(value) || value < family.from || value > family.to)) {
            throw new Error(`expectedFamilies[${index}].exclude must contain integers inside its range.`);
        }
        for (let number = family.from; number <= family.to; number += 1) {
            if (excluded.has(number)) continue;
            const caseId = `${prefix}-${number}`;
            if (seen.has(caseId)) throw new Error(`Duplicate expected logical case ${caseId}.`);
            seen.add(caseId);
            cases.push(caseId);
        }
    }
    return cases;
}

export function scenarioSortKey(entry, expectedOrder) {
    const expectedIndex = expectedOrder.get(entry.caseId) ?? Number.MAX_SAFE_INTEGER;
    return `${String(expectedIndex).padStart(5, '0')}:${entry.definition.case}:${entry.file}`;
}

function collectFixtureReferences(value, references = new Set()) {
    if (typeof value === 'string') {
        for (const match of value.matchAll(/\$fixture\.([A-Za-z0-9_.-]+)/g)) references.add(match[1]);
    } else if (Array.isArray(value)) {
        value.forEach(entry => collectFixtureReferences(entry, references));
    } else if (isPlainObject(value)) {
        Object.values(value).forEach(entry => collectFixtureReferences(entry, references));
    }
    return references;
}

function fixturePathExists(entities, objectPath) {
    let cursor = entities;
    for (const segment of objectPath.split('.')) {
        if ((!isPlainObject(cursor) && !Array.isArray(cursor))
            || !Object.prototype.hasOwnProperty.call(cursor, segment)) return false;
        cursor = cursor[segment];
    }
    return true;
}

async function validateBenchmarkFixtures(root, definitions) {
    const manifests = new Map();
    for (const { file, definition } of definitions) {
        let entities = {};
        if (typeof definition.fixture === 'string') {
            if (!manifests.has(definition.fixture)) {
                manifests.set(definition.fixture, await loadFixtureManifest(root, definition.fixture));
            }
            entities = manifests.get(definition.fixture).entities;
        } else if (isPlainObject(definition.fixture)) {
            entities = definition.fixture.entities || {};
        }
        const references = collectFixtureReferences(definition);
        if (references.size && !definition.fixture) {
            throw new Error(`Benchmark scenario ${file} references fixture values without declaring a fixture.`);
        }
        for (const reference of references) {
            if (!fixturePathExists(entities, reference)) {
                throw new Error(`Benchmark scenario ${file} has unresolved fixture reference $fixture.${reference}.`);
            }
        }
    }
    return manifests;
}

export async function loadBenchmarkManifest(root, filename = 'tests/followup_api_playtest/model_benchmark_manifest.json') {
    const absolute = path.resolve(root, filename);
    let manifest;
    try {
        manifest = JSON.parse(await fs.readFile(absolute, 'utf8'));
    } catch (error) {
        throw new Error(`Failed to read benchmark manifest ${absolute}: ${error.message}`);
    }
    if (!isPlainObject(manifest) || manifest.version !== 1) {
        throw new Error('Benchmark manifest must be a version 1 object.');
    }
    const allowed = new Set([
        'version',
        'name',
        'description',
        'scenarioRoots',
        'scenarioModules',
        'expectedFamilies',
        'knownAuditedModelFailures'
    ]);
    for (const key of Object.keys(manifest)) {
        if (!allowed.has(key)) throw new Error(`Unknown benchmark manifest field ${key}.`);
    }
    requireSafeName(manifest.name, 'manifest.name');
    if (!Array.isArray(manifest.scenarioRoots) || !manifest.scenarioRoots.length
        || manifest.scenarioRoots.some(value => typeof value !== 'string' || !value.trim())) {
        throw new Error('Benchmark manifest scenarioRoots must be a non-empty string array.');
    }
    if (manifest.scenarioModules !== undefined
        && (!Array.isArray(manifest.scenarioModules)
            || manifest.scenarioModules.some(value => typeof value !== 'string' || !value.trim()))) {
        throw new Error('Benchmark manifest scenarioModules must be a string array when supplied.');
    }
    if (manifest.knownAuditedModelFailures !== undefined && !isPlainObject(manifest.knownAuditedModelFailures)) {
        throw new Error('knownAuditedModelFailures must be an object when supplied.');
    }

    const expectedCases = expandExpectedCases(manifest.expectedFamilies);
    const expectedSet = new Set(expectedCases);
    const expectedOrder = new Map(expectedCases.map((caseId, index) => [caseId, index]));
    const discoveredFiles = [];
    for (const scenarioRoot of manifest.scenarioRoots) {
        discoveredFiles.push(...await discoverJsonFiles(root, scenarioRoot));
    }
    const uniqueFiles = [...new Set(discoveredFiles)];
    if (uniqueFiles.length !== discoveredFiles.length) {
        throw new Error('Benchmark scenario roots discover at least one file more than once.');
    }

    const definitions = [];
    for (const file of uniqueFiles) {
        definitions.push({ file, definition: await readScenarioFile(root, file) });
    }
    for (const moduleFilename of manifest.scenarioModules || []) {
        const absoluteModule = path.resolve(root, moduleFilename);
        const relativeModule = path.relative(root, absoluteModule);
        if (relativeModule.startsWith('..') || path.isAbsolute(relativeModule)) {
            throw new Error(`Benchmark scenario module must stay inside the project: ${moduleFilename}`);
        }
        const imported = await import(`${pathToFileURL(absoluteModule).href}?benchmark=${Date.now()}`);
        if (!Array.isArray(imported.scenarios)) {
            throw new Error(`Benchmark scenario module ${moduleFilename} must export a scenarios array.`);
        }
        imported.scenarios.forEach((definition, index) => {
            definitions.push({
                file: `${relativeModule}#${index + 1}:${definition?.case || 'unknown'}`,
                definition: validateScenarioDefinition(definition)
            });
        });
    }
    const fixtureManifests = await validateBenchmarkFixtures(root, definitions);

    const scenarios = [];
    const setupScenarios = [];
    for (const { file, definition } of definitions) {
        const caseId = extractLogicalCaseId(definition.case);
        if (!caseId) {
            setupScenarios.push({ file, case: definition.case, scenario: definition.scenario });
            continue;
        }
        if (!expectedSet.has(caseId)) {
            throw new Error(`Scenario ${file} maps to unknown logical case ${caseId}.`);
        }
        if (typeof definition.configProfile !== 'string' || !definition.configProfile.trim()) {
            throw new Error(`Benchmark scenario ${file} must declare configProfile.`);
        }
        scenarios.push({
            file,
            caseId,
            family: caseId.split('-')[0],
            profile: definition.configProfile,
            definition
        });
    }
    scenarios.sort((left, right) => (
        scenarioSortKey(left, expectedOrder).localeCompare(scenarioSortKey(right, expectedOrder))
    ));
    const runnableCaseIds = [...new Set(scenarios.map(entry => entry.caseId))];
    const runnableSet = new Set(runnableCaseIds);
    const missingCaseIds = expectedCases.filter(caseId => !runnableSet.has(caseId));
    const knownAuditedModelFailures = manifest.knownAuditedModelFailures || {};
    for (const [caseId, note] of Object.entries(knownAuditedModelFailures)) {
        if (!expectedSet.has(caseId) || typeof note !== 'string' || !note.trim()) {
            throw new Error(`Invalid knownAuditedModelFailures entry ${caseId}.`);
        }
    }

    return {
        manifestPath: path.relative(root, absolute),
        manifest: {
            ...manifest,
            knownAuditedModelFailures
        },
        expectedCases,
        scenarios,
        setupScenarios,
        runnableCaseIds,
        missingCaseIds,
        fixtureManifests: Object.fromEntries(
            [...fixtureManifests].map(([name, fixture]) => [name, {
                integrity: fixture.integrity,
                source: fixture.source
            }])
        )
    };
}

export function filterBenchmarkScenarios(inventory, { caseFilters = [], familyFilters = [] } = {}) {
    const cases = new Set(caseFilters.map(value => String(value).trim()).filter(Boolean));
    const families = new Set(familyFilters.map(value => String(value).trim().toUpperCase()).filter(Boolean));
    const scenarios = inventory.scenarios.filter(entry => {
        if (cases.size && !cases.has(entry.caseId) && !cases.has(entry.definition.case)) return false;
        if (families.size && !families.has(entry.family)) return false;
        return true;
    });
    if (!scenarios.length) throw new Error('Benchmark filters selected no runnable scenarios.');
    return scenarios;
}
