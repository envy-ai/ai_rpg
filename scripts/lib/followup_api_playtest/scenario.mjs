import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
    findChangedLogs,
    FollowupApiClient,
    getLogManifest,
    nextAttemptDirectory,
    RealtimeSession,
    requireText,
    writeJson,
    writeText
} from './core.mjs';
import {
    buildTriage,
    evaluateAssertions,
    renderTriageMarkdown
} from './assertions.mjs';
import {
    assertRuntimeConfigProfile,
    loadConfigProfile
} from './config_profiles.mjs';
import {
    loadFixtureManifest,
    prepareRuntimeFixture,
    removeRuntimeFixture
} from './fixtures.mjs';

const MODES = new Set(['live-record', 'replay', 'live-verify', 'state-only']);
const TOP_LEVEL_FIELDS = new Set([
    'version',
    'scenario',
    'case',
    'description',
    'fixture',
    'configProfile',
    'trackedPaths',
    'steps',
    'assertions',
    'humanReview'
]);
const STEP_FIELDS = {
    loadFixture: new Set(['type', 'saveName', 'saveType', 'modMismatchChoice']),
    snapshot: new Set(['type', 'name']),
    request: new Set(['type', 'name', 'method', 'route', 'body', 'interactive']),
    startChat: new Set(['type', 'name', 'text', 'travel', 'travelMetadata', 'forcedNpcTurns', 'interactive']),
    awaitChat: new Set(['type', 'name']),
    waitForRealtime: new Set(['type', 'name', 'until', 'timeoutMs', 'pollIntervalMs']),
    waitForRequest: new Set([
        'type',
        'name',
        'method',
        'route',
        'body',
        'until',
        'timeoutMs',
        'pollIntervalMs'
    ]),
    chat: new Set(['type', 'name', 'text', 'travel', 'travelMetadata', 'forcedNpcTurns', 'interactive']),
    save: new Set(['type', 'name']),
    readSavedJson: new Set(['type', 'name', 'saveName', 'saveType', 'fileName']),
    reload: new Set(['type', 'name', 'saveName', 'saveType']),
    waitForPromptIdle: new Set([
        'type',
        'labelIncludes',
        'requireActivity',
        'timeoutMs',
        'quietPeriodMs',
        'pollIntervalMs'
    ]),
    assert: new Set(['type', 'assertions']),
    humanReviewNote: new Set(['type', 'text']),
    nodeTest: new Set(['type', 'name', 'files'])
};
const ASSERTION_FIELDS = {
    httpStatus: new Set(['type', 'equals']),
    responseOk: new Set(['type', 'equals']),
    exists: new Set(['type', 'source', 'path']),
    absent: new Set(['type', 'source', 'path']),
    nullish: new Set(['type', 'source', 'path']),
    equals: new Set(['type', 'source', 'path', 'equals', 'equalsFrom']),
    notEquals: new Set(['type', 'source', 'path', 'equals', 'equalsFrom']),
    count: new Set(['type', 'source', 'path', 'equals']),
    includes: new Set(['type', 'source', 'path', 'value']),
    notIncludes: new Set(['type', 'source', 'path', 'value']),
    stateUnchanged: new Set(['type', 'paths', 'beforeSource', 'afterSource']),
    exactDelta: new Set(['type', 'path', 'delta', 'beforeSource', 'afterSource']),
    greaterThan: new Set(['type', 'source', 'path', 'value', 'valueFrom']),
    greaterThanOrEqual: new Set(['type', 'source', 'path', 'value', 'valueFrom']),
    lessThan: new Set(['type', 'source', 'path', 'value', 'valueFrom']),
    lessThanOrEqual: new Set(['type', 'source', 'path', 'value', 'valueFrom']),
    entityField: new Set([
        'type',
        'source',
        'collection',
        'id',
        'path',
        'equals',
        'equalsFrom',
        'notEquals',
        'includes',
        'caseSensitive'
    ]),
    entityArrayObjectCount: new Set(['type', 'source', 'collection', 'id', 'path', 'where', 'equals']),
    entityArrayUnique: new Set(['type', 'source', 'collection', 'id', 'path']),
    arrayObjectCount: new Set(['type', 'source', 'path', 'where', 'equals']),
    arrayObjectField: new Set(['type', 'source', 'path', 'where', 'field', 'equals', 'equalsFrom']),
    arrayObjectFieldCount: new Set(['type', 'source', 'path', 'where', 'field', 'equals']),
    arrayObjectCountAtLeast: new Set(['type', 'source', 'path', 'where', 'minimum']),
    arrayObjectCountBetween: new Set(['type', 'source', 'path', 'where', 'minimum', 'maximum']),
    arrayNumericFieldBounds: new Set([
        'type',
        'source',
        'path',
        'field',
        'minimum',
        'minimumExclusive',
        'maximum',
        'maximumExclusive'
    ]),
    attackResultCount: new Set(['type', 'source', 'path', 'where', 'equals']),
    attackResultApplied: new Set([
        'type',
        'source',
        'path',
        'where',
        'beforeSource',
        'afterSource',
        'collection',
        'healthPath',
        'expectHealthLoss'
    ]),
    attackResultCompare: new Set([
        'type',
        'source',
        'path',
        'leftWhere',
        'rightWhere',
        'field',
        'operator'
    ]),
    uniqueBy: new Set(['type', 'source', 'path', 'key']),
    noRealtimeErrors: new Set(['type']),
    realtimeEventCount: new Set(['type', 'where', 'equals']),
    promptRunCount: new Set(['type', 'labelIncludes', 'equals']),
    noUnexpectedErrorLogs: new Set(['type', 'allowed', 'allowedPrefixes', 'allowRecoveredProviderRetries']),
    historyAddedTypeCount: new Set(['type', 'entryType', 'equals', 'beforeSource', 'afterSource']),
    historyAddedSequence: new Set(['type', 'entryTypes', 'expected', 'beforeSource', 'afterSource']),
    historyAddedNestedObjectCount: new Set([
        'type',
        'entryWhere',
        'path',
        'where',
        'equals',
        'beforeSource',
        'afterSource'
    ]),
    dispositionChangesMatchState: new Set([
        'type',
        'npcId',
        'playerId',
        'direction',
        'beforeSource',
        'afterSource'
    ]),
    factionReputationChangesMatchState: new Set([
        'type',
        'factionId',
        'direction',
        'onlyFaction',
        'beforeSource',
        'afterSource'
    ]),
    cassetteConsumed: new Set(['type'])
};

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertKnownFields(value, allowed, label) {
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
            throw new Error(`Unknown ${label} field "${key}".`);
        }
    }
}

function validateForcedNpcTurns(value, label) {
    if (value === undefined) return;
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error(`${label} must be a non-empty array.`);
    }
    value.forEach((entry, index) => {
        const entryLabel = `${label}[${index}]`;
        if (typeof entry === 'string') {
            requireText(entry, entryLabel);
            return;
        }
        if (!isPlainObject(entry)) {
            throw new Error(`${entryLabel} must be an NPC name or an { id, name } object.`);
        }
        assertKnownFields(entry, new Set(['id', 'name']), entryLabel);
        const hasId = typeof entry.id === 'string' && entry.id.trim();
        const hasName = typeof entry.name === 'string' && entry.name.trim();
        if (!hasId && !hasName) {
            throw new Error(`${entryLabel} requires a non-empty id or name.`);
        }
    });
}

function validateAssertion(assertion, label) {
    if (!isPlainObject(assertion) || typeof assertion.type !== 'string') {
        throw new Error(`${label} must be an assertion object with a type.`);
    }
    const allowed = ASSERTION_FIELDS[assertion.type];
    if (!allowed) {
        throw new Error(`Unknown assertion type "${assertion.type}" in ${label}.`);
    }
    assertKnownFields(assertion, allowed, `${label} (${assertion.type})`);
    if (assertion.type === 'attackResultCount'
        || assertion.type === 'attackResultApplied'
        || assertion.type === 'attackResultCompare') {
        requireText(assertion.source, `${label}.source`);
        requireText(assertion.path, `${label}.path`);
    }
    if (assertion.type === 'attackResultCount' || assertion.type === 'attackResultApplied') {
        if (!isPlainObject(assertion.where)) {
            throw new Error(`${label}.where must be an object.`);
        }
    }
    if (assertion.type === 'attackResultCount'
        && (!Number.isInteger(assertion.equals) || assertion.equals < 0)) {
        throw new Error(`${label}.equals must be a non-negative integer.`);
    }
    if (assertion.type === 'arrayObjectCountAtLeast'
        && (!Number.isInteger(assertion.minimum) || assertion.minimum < 0)) {
        throw new Error(`${label}.minimum must be a non-negative integer.`);
    }
    if (assertion.type === 'arrayObjectCountBetween') {
        if (!isPlainObject(assertion.where)) {
            throw new Error(`${label}.where must be an object.`);
        }
        if (!Number.isInteger(assertion.minimum) || assertion.minimum < 0
            || !Number.isInteger(assertion.maximum) || assertion.maximum < assertion.minimum) {
            throw new Error(`${label} requires non-negative integer minimum/maximum bounds.`);
        }
    }
    if (assertion.type === 'arrayObjectField' || assertion.type === 'arrayObjectFieldCount') {
        requireText(assertion.source, `${label}.source`);
        requireText(assertion.path, `${label}.path`);
        requireText(assertion.field, `${label}.field`);
        if (!isPlainObject(assertion.where)) {
            throw new Error(`${label}.where must be an object.`);
        }
        if (assertion.type === 'arrayObjectFieldCount'
            && (!Number.isInteger(assertion.equals) || assertion.equals < 0)) {
            throw new Error(`${label}.equals must be a non-negative integer.`);
        }
        if (assertion.type === 'arrayObjectField' && assertion.equalsFrom !== undefined) {
            if (!isPlainObject(assertion.equalsFrom)) {
                throw new Error(`${label}.equalsFrom must be an object.`);
            }
            requireText(assertion.equalsFrom.source, `${label}.equalsFrom.source`);
            requireText(assertion.equalsFrom.path, `${label}.equalsFrom.path`);
        }
    }
    if (assertion.type === 'arrayNumericFieldBounds') {
        requireText(assertion.source, `${label}.source`);
        requireText(assertion.path, `${label}.path`);
        requireText(assertion.field, `${label}.field`);
        const bounds = ['minimum', 'minimumExclusive', 'maximum', 'maximumExclusive']
            .filter(field => assertion[field] !== undefined);
        if (!bounds.length || bounds.some(field => !Number.isFinite(assertion[field]))) {
            throw new Error(`${label} requires at least one finite numeric bound.`);
        }
    }
    if (assertion.type === 'entityField') {
        const hasOwn = field => Object.prototype.hasOwnProperty.call(assertion, field);
        const checks = ['equals', 'equalsFrom', 'notEquals', 'includes'].filter(hasOwn);
        if (!checks.length) {
            throw new Error(`${label} requires equals, equalsFrom, notEquals, or includes.`);
        }
        if (hasOwn('equals') && hasOwn('equalsFrom')) {
            throw new Error(`${label} cannot specify both equals and equalsFrom.`);
        }
        if (hasOwn('equalsFrom')) {
            if (!isPlainObject(assertion.equalsFrom)) {
                throw new Error(`${label}.equalsFrom must be an object.`);
            }
            requireText(assertion.equalsFrom.source, `${label}.equalsFrom.source`);
            requireText(assertion.equalsFrom.path, `${label}.equalsFrom.path`);
        }
        if (hasOwn('includes')) {
            requireText(assertion.includes, `${label}.includes`);
        }
        if (hasOwn('caseSensitive') && typeof assertion.caseSensitive !== 'boolean') {
            throw new Error(`${label}.caseSensitive must be a boolean.`);
        }
    }
    if (assertion.type === 'realtimeEventCount') {
        if (!isPlainObject(assertion.where)) {
            throw new Error(`${label}.where must be an object.`);
        }
        if (!Number.isInteger(assertion.equals) || assertion.equals < 0) {
            throw new Error(`${label}.equals must be a non-negative integer.`);
        }
    }
    if (assertion.type === 'promptRunCount') {
        requireText(assertion.labelIncludes, `${label}.labelIncludes`);
        if (!Number.isInteger(assertion.equals) || assertion.equals < 0) {
            throw new Error(`${label}.equals must be a non-negative integer.`);
        }
    }
    if (assertion.type === 'attackResultApplied') {
        for (const field of ['beforeSource', 'afterSource', 'collection', 'healthPath']) {
            if (assertion[field] !== undefined) requireText(assertion[field], `${label}.${field}`);
        }
        if (assertion.expectHealthLoss !== undefined && typeof assertion.expectHealthLoss !== 'boolean') {
            throw new Error(`${label}.expectHealthLoss must be a boolean.`);
        }
    }
    if (assertion.type === 'attackResultCompare') {
        if (!isPlainObject(assertion.leftWhere) || !isPlainObject(assertion.rightWhere)) {
            throw new Error(`${label}.leftWhere and .rightWhere must be objects.`);
        }
        requireText(assertion.field, `${label}.field`);
        const operators = new Set([
            'equals',
            'notEquals',
            'greaterThan',
            'greaterThanOrEqual',
            'lessThan',
            'lessThanOrEqual'
        ]);
        if (!operators.has(assertion.operator)) {
            throw new Error(`${label}.operator is invalid.`);
        }
    }
    if (assertion.type === 'noUnexpectedErrorLogs') {
        for (const field of ['allowed', 'allowedPrefixes']) {
            if (assertion[field] !== undefined
                && (!Array.isArray(assertion[field])
                    || assertion[field].some(value => typeof value !== 'string' || !value.trim()))) {
                throw new Error(`${label}.${field} must be an array of non-empty strings.`);
            }
        }
        if (assertion.allowRecoveredProviderRetries !== undefined
            && typeof assertion.allowRecoveredProviderRetries !== 'boolean') {
            throw new Error(`${label}.allowRecoveredProviderRetries must be a boolean.`);
        }
    }
    if (assertion.type === 'historyAddedNestedObjectCount') {
        if (!isPlainObject(assertion.entryWhere)) {
            throw new Error(`${label}.entryWhere must be an object.`);
        }
        requireText(assertion.path, `${label}.path`);
        if (!isPlainObject(assertion.where)) {
            throw new Error(`${label}.where must be an object.`);
        }
        if (!Number.isInteger(assertion.equals) || assertion.equals < 0) {
            throw new Error(`${label}.equals must be a non-negative integer.`);
        }
    }
    if (assertion.type === 'historyAddedSequence') {
        if (assertion.entryTypes !== undefined
            && (!Array.isArray(assertion.entryTypes)
                || !assertion.entryTypes.length
                || assertion.entryTypes.some(value => typeof value !== 'string' || !value.trim()))) {
            throw new Error(`${label}.entryTypes must be a non-empty array of non-empty strings when provided.`);
        }
        if (!Array.isArray(assertion.expected)
            || !assertion.expected.length
            || assertion.expected.some(value => !isPlainObject(value))) {
            throw new Error(`${label}.expected must be a non-empty array of objects.`);
        }
    }
    if (assertion.type === 'dispositionChangesMatchState') {
        requireText(assertion.npcId, `${label}.npcId`);
        requireText(assertion.playerId, `${label}.playerId`);
        if (assertion.direction !== undefined
            && !['increase', 'decrease', 'either'].includes(assertion.direction)) {
            throw new Error(`${label}.direction must be increase, decrease, or either.`);
        }
    }
    if (assertion.type === 'factionReputationChangesMatchState') {
        requireText(assertion.factionId, `${label}.factionId`);
        if (assertion.direction !== undefined
            && !['increase', 'decrease', 'either'].includes(assertion.direction)) {
            throw new Error(`${label}.direction must be increase, decrease, or either.`);
        }
        if (assertion.onlyFaction !== undefined && typeof assertion.onlyFaction !== 'boolean') {
            throw new Error(`${label}.onlyFaction must be a boolean when supplied.`);
        }
    }
}

function validateAssertions(assertions, label) {
    if (!Array.isArray(assertions)) {
        throw new Error(`${label} must be an array.`);
    }
    assertions.forEach((assertion, index) => validateAssertion(assertion, `${label}[${index}]`));
}

function validateInteractivePolicy(value, label, { required = false } = {}) {
    if (value === undefined) {
        if (required) {
            throw new Error(`${label} is required and must define roll, questAccepted, and confirmed.`);
        }
        return;
    }
    if (!isPlainObject(value)) throw new Error(`${label} must be an object.`);
    const allowed = new Set(['roll', 'questAccepted', 'confirmed', 'answer', 'deferPlayerInput']);
    assertKnownFields(value, allowed, label);
    for (const field of ['roll', 'questAccepted', 'confirmed']) {
        if (!Object.prototype.hasOwnProperty.call(value, field)) {
            throw new Error(`${label}.${field} is required.`);
        }
    }
    if (value.roll !== null && !Number.isInteger(value.roll)) {
        throw new Error(`${label}.roll must be an integer or null.`);
    }
    if (typeof value.questAccepted !== 'boolean') {
        throw new Error(`${label}.questAccepted must be a boolean.`);
    }
    if (typeof value.confirmed !== 'boolean') {
        throw new Error(`${label}.confirmed must be a boolean.`);
    }
    if (value.answer !== undefined && (typeof value.answer !== 'string' || !value.answer.trim())) {
        throw new Error(`${label}.answer must be a non-empty string when supplied.`);
    }
    if (value.deferPlayerInput !== undefined && typeof value.deferPlayerInput !== 'boolean') {
        throw new Error(`${label}.deferPlayerInput must be a boolean when supplied.`);
    }
}

function validateStepName(value, label) {
    const name = requireText(value, label);
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
        throw new Error(`${label} may contain only letters, numbers, underscores, and hyphens.`);
    }
    return name;
}

function requireSafeSavePathSegment(value, label) {
    const segment = requireText(value, label);
    if (!/^[A-Za-z0-9._-]+$/.test(segment)) {
        throw new Error(`${label} may contain only letters, numbers, dots, underscores, and hyphens.`);
    }
    return segment;
}

export async function readSavedJson(root, {
    saveName,
    saveType = 'saves',
    fileName
} = {}) {
    const safeSaveName = requireSafeSavePathSegment(saveName, 'readSavedJson.saveName');
    const safeFileName = requireSafeSavePathSegment(fileName, 'readSavedJson.fileName');
    if (!['saves', 'autosaves'].includes(saveType)) {
        throw new Error('readSavedJson.saveType must be saves or autosaves.');
    }
    if (!safeFileName.endsWith('.json')) {
        throw new Error('readSavedJson.fileName must identify a JSON file.');
    }
    const filePath = path.join(root, saveType, safeSaveName, safeFileName);
    let payload;
    try {
        payload = JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch (error) {
        throw new Error(`Failed to read saved JSON ${saveType}/${safeSaveName}/${safeFileName}: ${error.message}`);
    }
    return {
        method: 'READ',
        route: `/${saveType}/${safeSaveName}/${safeFileName}`,
        status: 200,
        ok: true,
        payload
    };
}

export function validateScenarioDefinition(definition) {
    if (!isPlainObject(definition)) {
        throw new Error('Scenario definition must be an object.');
    }
    assertKnownFields(definition, TOP_LEVEL_FIELDS, 'scenario');
    if (definition.version !== 1) throw new Error('Scenario definition version must be 1.');
    requireText(definition.scenario, 'scenario.scenario');
    requireText(definition.case, 'scenario.case');
    if (definition.fixture !== undefined
        && typeof definition.fixture !== 'string'
        && !isPlainObject(definition.fixture)) {
        throw new Error('scenario.fixture must be a canonical fixture name or an existing-save object.');
    }
    if (isPlainObject(definition.fixture)) {
        assertKnownFields(definition.fixture, new Set(['saveName', 'saveType', 'entities']), 'scenario.fixture');
        requireText(definition.fixture.saveName, 'scenario.fixture.saveName');
        if (definition.fixture.saveType !== undefined && !['saves', 'autosaves'].includes(definition.fixture.saveType)) {
            throw new Error('scenario.fixture.saveType must be saves or autosaves.');
        }
        if (definition.fixture.entities !== undefined && !isPlainObject(definition.fixture.entities)) {
            throw new Error('scenario.fixture.entities must be an object.');
        }
    }
    if (definition.configProfile !== undefined) requireText(definition.configProfile, 'scenario.configProfile');
    if (!Array.isArray(definition.steps) || !definition.steps.length) {
        throw new Error('scenario.steps must be a non-empty array.');
    }
    const stepNames = new Set();
    const pendingChatNames = new Set();
    definition.steps.forEach((step, index) => {
        if (!isPlainObject(step) || typeof step.type !== 'string') {
            throw new Error(`scenario.steps[${index}] must be an object with a type.`);
        }
        const allowed = STEP_FIELDS[step.type];
        if (!allowed) throw new Error(`Unknown scenario step type "${step.type}".`);
        assertKnownFields(step, allowed, `scenario.steps[${index}] (${step.type})`);
        if (step.type === 'chat' || step.type === 'startChat') {
            requireText(step.text, `scenario.steps[${index}].text`);
            validateInteractivePolicy(step.interactive, `scenario.steps[${index}].interactive`, { required: true });
            validateForcedNpcTurns(step.forcedNpcTurns, `scenario.steps[${index}].forcedNpcTurns`);
            if (step.type === 'startChat') {
                const pendingName = validateStepName(step.name, `scenario.steps[${index}].name`);
                if (pendingChatNames.has(pendingName)) {
                    throw new Error(`Duplicate pending chat name "${pendingName}".`);
                }
                pendingChatNames.add(pendingName);
            }
        } else if (step.type === 'awaitChat') {
            const pendingName = validateStepName(step.name, `scenario.steps[${index}].name`);
            if (!pendingChatNames.delete(pendingName)) {
                throw new Error(`awaitChat step references unknown pending chat "${pendingName}".`);
            }
        } else if (step.type === 'waitForRealtime') {
            validateAssertions(step.until, `scenario.steps[${index}].until`);
            if (!step.until.length) {
                throw new Error(`scenario.steps[${index}].until must contain at least one assertion.`);
            }
            if (step.until.some(assertion => assertion.type === 'cassetteConsumed')) {
                throw new Error('cassetteConsumed may only be used in scenario.assertions after replay finalization.');
            }
            for (const field of ['timeoutMs', 'pollIntervalMs']) {
                if (step[field] !== undefined && (!Number.isFinite(step[field]) || step[field] <= 0)) {
                    throw new Error(`scenario.steps[${index}].${field} must be a finite positive number.`);
                }
            }
        } else if (step.type === 'request') {
            requireText(step.method, `scenario.steps[${index}].method`);
            requireText(step.route, `scenario.steps[${index}].route`);
            validateInteractivePolicy(step.interactive, `scenario.steps[${index}].interactive`);
        } else if (step.type === 'waitForRequest') {
            requireText(step.name, `scenario.steps[${index}].name`);
            requireText(step.method, `scenario.steps[${index}].method`);
            requireText(step.route, `scenario.steps[${index}].route`);
            validateAssertions(step.until, `scenario.steps[${index}].until`);
            if (!step.until.length) {
                throw new Error(`scenario.steps[${index}].until must contain at least one assertion.`);
            }
            if (step.until.some(assertion => assertion.type === 'cassetteConsumed')) {
                throw new Error('cassetteConsumed may only be used in scenario.assertions after replay finalization.');
            }
            for (const field of ['timeoutMs', 'pollIntervalMs']) {
                if (step[field] !== undefined && (!Number.isFinite(step[field]) || step[field] <= 0)) {
                    throw new Error(`scenario.steps[${index}].${field} must be a finite positive number.`);
                }
            }
        } else if (step.type === 'snapshot') {
            requireText(step.name, `scenario.steps[${index}].name`);
        } else if (step.type === 'readSavedJson') {
            requireText(step.name, `scenario.steps[${index}].name`);
            requireSafeSavePathSegment(step.fileName, `scenario.steps[${index}].fileName`);
            if (!step.fileName.endsWith('.json')) {
                throw new Error(`scenario.steps[${index}].fileName must identify a JSON file.`);
            }
            if (step.saveType !== undefined && !['saves', 'autosaves'].includes(step.saveType)) {
                throw new Error(`scenario.steps[${index}].saveType must be saves or autosaves.`);
            }
        } else if (step.type === 'waitForPromptIdle') {
            requireText(step.labelIncludes, `scenario.steps[${index}].labelIncludes`);
            if (step.requireActivity !== undefined && typeof step.requireActivity !== 'boolean') {
                throw new Error(`scenario.steps[${index}].requireActivity must be a boolean.`);
            }
            for (const field of ['timeoutMs', 'quietPeriodMs', 'pollIntervalMs']) {
                if (step[field] !== undefined && (!Number.isFinite(step[field]) || step[field] < 0)) {
                    throw new Error(`scenario.steps[${index}].${field} must be a finite non-negative number.`);
                }
            }
        } else if (step.type === 'assert') {
            validateAssertions(step.assertions, `scenario.steps[${index}].assertions`);
            if (step.assertions.some(assertion => assertion.type === 'cassetteConsumed')) {
                throw new Error('cassetteConsumed may only be used in scenario.assertions after replay finalization.');
            }
        } else if (step.type === 'humanReviewNote') {
            requireText(step.text, `scenario.steps[${index}].text`);
        } else if (step.type === 'nodeTest') {
            validateStepName(step.name, `scenario.steps[${index}].name`);
            if (!Array.isArray(step.files) || !step.files.length
                || step.files.some(file => typeof file !== 'string' || !/^tests\/[A-Za-z0-9._/-]+\.test\.js$/.test(file))) {
                throw new Error(`scenario.steps[${index}].files must contain source-controlled tests/*.test.js paths.`);
            }
        }
        if (step.name !== undefined && step.type !== 'awaitChat') {
            const name = validateStepName(step.name, `scenario.steps[${index}].name`);
            if (stepNames.has(name)) {
                throw new Error(`Duplicate scenario step name "${name}".`);
            }
            stepNames.add(name);
        }
    });
    if (pendingChatNames.size) {
        throw new Error(`Scenario has unawaited startChat step(s): ${Array.from(pendingChatNames).join(', ')}.`);
    }
    if (definition.trackedPaths !== undefined) {
        if (!Array.isArray(definition.trackedPaths) || definition.trackedPaths.some(entry => typeof entry !== 'string' || !entry.trim())) {
            throw new Error('scenario.trackedPaths must be an array of non-empty strings.');
        }
    }
    validateAssertions(definition.assertions || [], 'scenario.assertions');
    if (definition.humanReview !== undefined
        && (!Array.isArray(definition.humanReview)
            || definition.humanReview.some(entry => typeof entry !== 'string' || !entry.trim()))) {
        throw new Error('scenario.humanReview must be an array of non-empty strings.');
    }
    return definition;
}

const VARIABLE_ROOTS = new Set(['fixture', 'response', 'snapshot']);

function resolveVariablePath(value, roots, { allowUnresolvedRuntime = false } = {}) {
    const match = value.match(/^\$(fixture|response|snapshot)\.([A-Za-z0-9_.-]+)$/);
    if (!match) return { matched: false, value };
    const [, rootName, variablePath] = match;
    if (allowUnresolvedRuntime && rootName !== 'fixture') {
        return { matched: true, unresolved: true, value };
    }
    const segments = variablePath.split('.');
    let cursor = roots[rootName];
    for (const segment of segments) {
        if (!isPlainObject(cursor) && !Array.isArray(cursor)) {
            throw new Error(`Unresolved ${rootName} variable ${value}.`);
        }
        if (!Object.prototype.hasOwnProperty.call(cursor, segment)) {
            throw new Error(`Unresolved ${rootName} variable ${value}.`);
        }
        cursor = cursor[segment];
    }
    return { matched: true, unresolved: false, value: cursor };
}

function replaceScenarioVariables(value, roots, { allowUnresolvedRuntime = false } = {}) {
    if (typeof value === 'string') {
        const exact = resolveVariablePath(value, roots, { allowUnresolvedRuntime });
        if (exact.matched) {
            return exact.value;
        }
        return value.replaceAll(/\$(fixture|response|snapshot)\.([A-Za-z0-9_.-]+)/g, (match, rootName, variablePath) => {
            if (!VARIABLE_ROOTS.has(rootName)) return match;
            if (allowUnresolvedRuntime && rootName !== 'fixture') return match;
            const segments = variablePath.split('.');
            let cursor = roots[rootName];
            for (const segment of segments) {
                if ((!isPlainObject(cursor) && !Array.isArray(cursor))
                    || !Object.prototype.hasOwnProperty.call(cursor, segment)) {
                    throw new Error(`Unresolved ${rootName} variable $${rootName}.${variablePath}.`);
                }
                cursor = cursor[segment];
            }
            if (typeof cursor !== 'string' && typeof cursor !== 'number' && typeof cursor !== 'boolean') {
                throw new Error(`Embedded ${rootName} variable $${rootName}.${variablePath} must resolve to a scalar.`);
            }
            return String(cursor);
        });
    }
    if (Array.isArray(value)) {
        return value.map(entry => replaceScenarioVariables(entry, roots, { allowUnresolvedRuntime }));
    }
    if (isPlainObject(value)) {
        return Object.fromEntries(Object.entries(value).map(
            ([key, entry]) => [key, replaceScenarioVariables(entry, roots, { allowUnresolvedRuntime })]
        ));
    }
    return value;
}

async function loadScenarioFixture(apiClient, realtime, definition, root) {
    if (!definition.fixture) return { runtimeFixture: null, entities: {}, loadResult: null };
    let runtimeFixture = null;
    let saveName;
    let saveType;
    let entities = {};
    if (typeof definition.fixture === 'string') {
        runtimeFixture = await prepareRuntimeFixture(root, definition.fixture);
        saveName = runtimeFixture.runtimeName;
        saveType = runtimeFixture.saveType;
        entities = runtimeFixture.manifest.entities;
    } else {
        saveName = definition.fixture.saveName;
        saveType = definition.fixture.saveType || 'saves';
        entities = definition.fixture.entities || {};
    }
    const result = await apiClient.fetchJson('POST', '/api/load', {
        saveName,
        saveType,
        clientId: realtime?.clientId || undefined
    });
    if (!result.ok || result.payload?.success !== true) {
        if (runtimeFixture) await removeRuntimeFixture(runtimeFixture);
        throw new Error(`Failed to load scenario fixture ${saveName}: ${result.payload?.error || result.status}`);
    }
    return { runtimeFixture, entities, loadResult: result };
}

async function readCassetteStatus(apiClient) {
    const response = await apiClient.fetchJson('GET', '/api/llm-completion-cassette/status');
    if (!response.ok || response.payload?.success !== true) {
        throw new Error(`Failed to read completion cassette status: ${response.payload?.error || response.status}`);
    }
    return { replay: response.payload.replay, recording: response.payload.recording };
}

export async function waitForCompletionCassetteRecordingIdle(apiClient, {
    timeoutMs = 60_000,
    pollIntervalMs = 100,
    quietPeriodMs = 500
} = {}) {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
        throw new Error('Completion cassette idle timeout must be a finite non-negative number.');
    }
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
        throw new Error('Completion cassette idle poll interval must be a finite positive number.');
    }
    if (!Number.isFinite(quietPeriodMs) || quietPeriodMs < 0) {
        throw new Error('Completion cassette idle quiet period must be a finite non-negative number.');
    }
    const startedAt = Date.now();
    let idleSince = null;
    let idleTotal = null;
    while (true) {
        const status = await readCassetteStatus(apiClient);
        if (status.recording?.active !== true) {
            throw new Error('Completion cassette recording became inactive before finalization.');
        }
        if (status.recording.completionActive !== true) {
            const total = status.recording.total;
            if (idleSince === null || total !== idleTotal) {
                idleSince = Date.now();
                idleTotal = total;
            }
            if (Date.now() - idleSince >= quietPeriodMs) {
                return status;
            }
        } else {
            idleSince = null;
            idleTotal = null;
        }
        if (Date.now() - startedAt >= timeoutMs) {
            throw new Error(
                `Timed out after ${timeoutMs}ms waiting for the completion cassette recorder to become idle.`
            );
        }
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
}

export async function waitForCompletionCassetteReplayConsumed(apiClient, {
    timeoutMs = 60_000,
    pollIntervalMs = 100,
    quietPeriodMs = 500
} = {}) {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
        throw new Error('Completion cassette replay timeout must be a finite non-negative number.');
    }
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
        throw new Error('Completion cassette replay poll interval must be a finite positive number.');
    }
    if (!Number.isFinite(quietPeriodMs) || quietPeriodMs < 0) {
        throw new Error('Completion cassette replay quiet period must be a finite non-negative number.');
    }
    const startedAt = Date.now();
    let settledSince = null;
    while (true) {
        const status = await readCassetteStatus(apiClient);
        if (status.replay?.active !== true || status.replay?.version !== 2) {
            throw new Error('Completion cassette replay became inactive before consumption was verified.');
        }
        if (status.replay.failureCount > 0) {
            throw new Error(
                `Completion cassette replay recorded ${status.replay.failureCount} strict failure`
                + `${status.replay.failureCount === 1 ? '' : 's'}: `
                + `${status.replay.lastFailure?.message || 'unknown replay failure'}`
            );
        }
        if (status.replay.completionActive !== true && status.replay.allConsumed === true) {
            settledSince ??= Date.now();
            if (Date.now() - settledSince >= quietPeriodMs) {
                return status;
            }
        } else {
            settledSince = null;
        }
        if (Date.now() - startedAt >= timeoutMs) {
            throw new Error(
                `Timed out after ${timeoutMs}ms waiting for completion cassette replay consumption `
                + `(consumed=${status.replay.consumed ?? 'unknown'}, total=${status.replay.total ?? 'unknown'}, `
                + `completionActive=${status.replay.completionActive === true}).`
            );
        }
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
}

export async function archiveAndResetIncompleteCassetteRecording(apiClient, {
    attemptDir,
    description = ''
} = {}) {
    if (typeof attemptDir !== 'string' || !attemptDir.trim()) {
        throw new Error('Failed cassette cleanup requires an attemptDir.');
    }
    const status = await waitForCompletionCassetteRecordingIdle(apiClient, {
        quietPeriodMs: 0
    });
    const resolvedPath = status.recording?.resolvedPath;
    if (typeof resolvedPath !== 'string' || !resolvedPath.trim()) {
        throw new Error('Incomplete cassette recording status did not include its resolved path.');
    }
    const archivePath = path.join(attemptDir, 'incomplete-completion-cassette.json');
    const recordingExists = await fs.access(resolvedPath).then(() => true).catch(() => false);
    if (recordingExists) {
        await fs.copyFile(resolvedPath, archivePath);
    } else if (Number(status.recording?.total) > 0) {
        throw new Error(
            `Incomplete cassette reports ${status.recording.total} entries but its file is missing: ${resolvedPath}`
        );
    }
    const reset = await apiClient.fetchJson(
        'POST',
        '/api/llm-completion-cassette/reset-incomplete-recording',
        { description }
    );
    if (!reset.ok || reset.payload?.success !== true) {
        throw new Error(`Failed to reset incomplete cassette recording: ${reset.payload?.error || reset.status}`);
    }
    return {
        archivePath: recordingExists ? archivePath : null,
        discardedTotal: reset.payload.recording?.discardedTotal ?? null,
        recording: reset.payload.recording
    };
}

async function assertModePreflight(apiClient, mode, { root, cassettePath = null } = {}) {
    const status = await readCassetteStatus(apiClient);
    if (mode === 'live-record') {
        if (status.recording?.active !== true || status.replay?.active === true) {
            throw new Error('live-record mode requires recording configuration and no replay fixture.');
        }
        if (status.recording.complete === true || Number(status.recording.total) > 0) {
            throw new Error(
                'live-record mode requires a fresh empty cassette recording destination '
                + `(complete=${status.recording.complete === true}, total=${status.recording.total ?? 'unknown'}).`
            );
        }
    } else if (mode === 'replay') {
        if (status.replay?.active !== true || status.replay?.version !== 2 || status.recording?.active === true) {
            throw new Error('replay mode requires one active version 2 cassette and no recording destination.');
        }
    } else if (mode === 'live-verify' || mode === 'state-only') {
        if (status.replay?.active === true || status.recording?.active === true) {
            throw new Error(`${mode} mode prohibits forced replay and completion recording.`);
        }
    }
    if (cassettePath) {
        const expectedPath = path.resolve(root, cassettePath);
        const actualPath = mode === 'live-record'
            ? status.recording?.resolvedPath
            : status.replay?.resolvedPath;
        if (path.resolve(actualPath || '') !== expectedPath) {
            throw new Error(
                `${mode} mode expected cassette ${expectedPath}, but the server is configured for ${actualPath || 'none'}.`
            );
        }
    }
    return status;
}

function assertionContext({
    before,
    after,
    response,
    realtime,
    changedLogs,
    cassetteStatus,
    stepResults,
    fixture,
    snapshots,
    responses
}) {
    return {
        before,
        after,
        response,
        realtime,
        changedLogs,
        cassetteStatus,
        steps: stepResults,
        fixture,
        snapshots,
        responses
    };
}

function scenarioFailure(message, attemptDir) {
    const error = new Error(message);
    error.attemptDir = attemptDir;
    return error;
}

export function resolvePromptWaitRequireActivity(mode, configuredValue = true) {
    if (mode === 'replay') {
        return false;
    }
    return configuredValue !== false;
}

export async function runScenario({
    root,
    definition,
    mode,
    baseUrl = 'http://127.0.0.1:7777',
    wsUrl = 'ws://127.0.0.1:7777/ws',
    cassettePath = null,
    keepRuntimeFixture = false,
    apiClient: providedApiClient = null,
    realtimeSession: providedRealtimeSession = null
} = {}) {
    validateScenarioDefinition(definition);
    if (!MODES.has(mode)) {
        throw new Error(`Scenario mode must be one of: ${Array.from(MODES).join(', ')}.`);
    }
    const attemptDir = await nextAttemptDirectory(root, definition.scenario, definition.case);
    const startedAt = new Date().toISOString();
    await writeJson(attemptDir, 'scenario.json', definition);
    await writeJson(attemptDir, 'run.json', { mode, baseUrl, wsUrl, cassettePath, startedAt });

    const apiClient = providedApiClient || new FollowupApiClient({ baseUrl });
    const profile = definition.configProfile
        ? await loadConfigProfile(root, definition.configProfile)
        : null;
    const effectiveConfig = profile
        ? await assertRuntimeConfigProfile(apiClient, profile)
        : {};
    await writeJson(attemptDir, 'effective-config.json', {
        profile: profile?.name || null,
        values: effectiveConfig
    });
    await assertModePreflight(apiClient, mode, { root, cassettePath });

    const preflightFixtureEntities = typeof definition.fixture === 'string'
        ? (await loadFixtureManifest(root, definition.fixture)).entities
        : (definition.fixture?.entities || {});
    replaceScenarioVariables(definition, {
        fixture: preflightFixtureEntities,
        response: {},
        snapshot: {}
    }, { allowUnresolvedRuntime: true });

    const realtime = providedRealtimeSession || new RealtimeSession({ apiClient, wsUrl });
    await realtime.connect();
    let runtimeFixture = null;
    let fixtureEntities = {};
    let before = null;
    let after = null;
    let beforeLogs = [];
    let changedLogs = [];
    let lastResponse = null;
    let cassetteStatus = null;
    let executionError = null;
    const durations = [];
    const assertionResults = [];
    const stepResults = [];
    const snapshots = {};
    const responses = {};
    const humanReview = [...(definition.humanReview || [])];
    let latestSavedName = null;
    let lastRealtimeOperationStartIndex = 0;
    const pendingChats = new Map();

    try {
        const fixtureStart = Date.now();
        const loadedFixture = await loadScenarioFixture(apiClient, realtime, definition, root);
        runtimeFixture = loadedFixture.runtimeFixture;
        fixtureEntities = loadedFixture.entities;
        if (loadedFixture.loadResult) {
            stepResults.push({ type: 'loadFixture', response: loadedFixture.loadResult });
            durations.push({ step: 'loadFixture', durationMs: Date.now() - fixtureStart });
        }
        before = await apiClient.captureState();
        beforeLogs = await getLogManifest(root);
        await writeJson(attemptDir, 'before.json', before);
        if (runtimeFixture?.manifest?.invariants?.length) {
            const fixtureInvariantResults = evaluateAssertions(
                runtimeFixture.manifest.invariants,
                assertionContext({
                    before,
                    after: before,
                    response: loadedFixture.loadResult,
                    realtime: realtime.events,
                    changedLogs: [],
                    cassetteStatus: await readCassetteStatus(apiClient),
                    stepResults,
                    fixture: fixtureEntities,
                    snapshots,
                    responses
                })
            );
            assertionResults.push(...fixtureInvariantResults);
            stepResults.push({ type: 'fixtureInvariants', assertions: fixtureInvariantResults });
            const failedInvariant = fixtureInvariantResults.find(entry => !entry.passed);
            if (failedInvariant) {
                throw new Error(`Fixture invariant failed: ${failedInvariant.message}`);
            }
        }

        for (let index = 0; index < definition.steps.length; index += 1) {
            const rawStep = definition.steps[index];
            if (rawStep.type === 'loadFixture') {
                if (!definition.fixture) {
                    const saveName = replaceScenarioVariables(rawStep.saveName, {
                        fixture: fixtureEntities,
                        response: responses,
                        snapshot: snapshots
                    });
                    const result = await apiClient.fetchJson('POST', '/api/load', {
                        saveName,
                        saveType: rawStep.saveType || 'saves',
                        modMismatchChoice: rawStep.modMismatchChoice,
                        clientId: realtime.clientId
                    });
                    if (!result.ok || result.payload?.success !== true) {
                        throw new Error(`loadFixture step failed: ${result.payload?.error || result.status}`);
                    }
                    lastResponse = result;
                    before = await apiClient.captureState();
                    beforeLogs = await getLogManifest(root);
                    await writeJson(attemptDir, 'before.json', before);
                    stepResults.push({ index, type: rawStep.type, response: result });
                }
                continue;
            }
            const step = replaceScenarioVariables(rawStep, {
                fixture: fixtureEntities,
                response: responses,
                snapshot: snapshots
            });
            const stepStartedAt = Date.now();
            if (step.type === 'snapshot') {
                const snapshot = await apiClient.captureState();
                await writeJson(attemptDir, `snapshot-${step.name.replaceAll(/[^A-Za-z0-9._-]/g, '_')}.json`, snapshot);
                snapshots[step.name] = snapshot;
                stepResults.push({ index, type: step.type, name: step.name });
            } else if (step.type === 'chat') {
                if (mode === 'state-only') throw new Error('state-only mode does not allow chat steps.');
                lastRealtimeOperationStartIndex = realtime.events.length;
                const identifiers = realtime.beginRequest(step.interactive || {});
                const body = {
                    messages: [{ role: 'user', content: step.text }],
                    clientId: identifiers.clientId,
                    requestId: identifiers.requestId,
                    travel: step.travel === true
                };
                if (step.travelMetadata !== undefined) body.travelMetadata = step.travelMetadata;
                if (step.forcedNpcTurns !== undefined) body.forcedNpcTurns = step.forcedNpcTurns;
                try {
                    lastResponse = await apiClient.fetchJson('POST', '/api/chat', body);
                } finally {
                    realtime.endRequest(identifiers.requestId);
                }
                if (step.name) responses[step.name] = lastResponse;
                stepResults.push({ index, type: step.type, requestId: identifiers.requestId, response: lastResponse });
            } else if (step.type === 'startChat') {
                if (mode === 'state-only') throw new Error('state-only mode does not allow startChat steps.');
                if (pendingChats.has(step.name)) {
                    throw new Error(`Pending chat "${step.name}" already exists.`);
                }
                lastRealtimeOperationStartIndex = realtime.events.length;
                const identifiers = realtime.beginRequest(step.interactive || {});
                const body = {
                    messages: [{ role: 'user', content: step.text }],
                    clientId: identifiers.clientId,
                    requestId: identifiers.requestId,
                    travel: step.travel === true
                };
                if (step.travelMetadata !== undefined) body.travelMetadata = step.travelMetadata;
                if (step.forcedNpcTurns !== undefined) body.forcedNpcTurns = step.forcedNpcTurns;
                const outcomePromise = apiClient.fetchJson('POST', '/api/chat', body).then(
                    response => ({ response, error: null }),
                    error => ({ response: null, error })
                );
                pendingChats.set(step.name, {
                    identifiers,
                    outcomePromise
                });
                stepResults.push({
                    index,
                    type: step.type,
                    name: step.name,
                    requestId: identifiers.requestId,
                    started: true
                });
            } else if (step.type === 'awaitChat') {
                const pending = pendingChats.get(step.name);
                if (!pending) {
                    throw new Error(`No pending chat named "${step.name}" exists.`);
                }
                const outcome = await pending.outcomePromise;
                realtime.endRequest(pending.identifiers.requestId);
                pendingChats.delete(step.name);
                if (outcome.error) throw outcome.error;
                lastResponse = outcome.response;
                responses[step.name] = lastResponse;
                stepResults.push({
                    index,
                    type: step.type,
                    name: step.name,
                    requestId: pending.identifiers.requestId,
                    response: lastResponse
                });
            } else if (step.type === 'waitForRealtime') {
                const timeoutMs = step.timeoutMs ?? 60_000;
                const pollIntervalMs = step.pollIntervalMs ?? 25;
                const waitStartedAt = Date.now();
                let results = [];
                while (true) {
                    results = evaluateAssertions(step.until, assertionContext({
                        before,
                        after,
                        response: lastResponse,
                        realtime: realtime.events,
                        changedLogs,
                        cassetteStatus,
                        stepResults,
                        fixture: fixtureEntities,
                        snapshots,
                        responses
                    }));
                    if (results.every(result => result.passed)) {
                        stepResults.push({
                            index,
                            type: step.type,
                            name: step.name || null,
                            durationMs: Date.now() - waitStartedAt,
                            assertions: results
                        });
                        break;
                    }
                    if (Date.now() - waitStartedAt >= timeoutMs) {
                        const failures = results
                            .filter(result => !result.passed)
                            .map(result => result.message)
                            .join(' | ');
                        throw new Error(`Timed out after ${timeoutMs}ms waiting for realtime state: ${failures}`);
                    }
                    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
                }
            } else if (step.type === 'request') {
                lastRealtimeOperationStartIndex = realtime.events.length;
                let body = step.body;
                let identifiers = null;
                if (step.interactive !== undefined) {
                    if (mode === 'state-only') throw new Error('state-only mode does not allow interactive requests.');
                    identifiers = realtime.beginRequest(step.interactive || {});
                    body = isPlainObject(body)
                        ? { ...body, ...identifiers }
                        : { ...identifiers };
                }
                try {
                    lastResponse = await apiClient.fetchJson(step.method.toUpperCase(), step.route, body);
                } finally {
                    if (identifiers) realtime.endRequest(identifiers.requestId);
                }
                if (step.name) responses[step.name] = lastResponse;
                stepResults.push({ index, type: step.type, requestId: identifiers?.requestId || null, response: lastResponse });
            } else if (step.type === 'waitForRequest') {
                const timeoutMs = step.timeoutMs ?? 60_000;
                const pollIntervalMs = step.pollIntervalMs ?? 100;
                const waitStartedAt = Date.now();
                let attempts = 0;
                let results = [];
                while (true) {
                    attempts += 1;
                    lastResponse = await apiClient.fetchJson(step.method.toUpperCase(), step.route, step.body);
                    responses[step.name] = lastResponse;
                    results = evaluateAssertions(step.until, assertionContext({
                        before,
                        after,
                        response: lastResponse,
                        realtime: realtime.events,
                        changedLogs,
                        cassetteStatus,
                        stepResults,
                        fixture: fixtureEntities,
                        snapshots,
                        responses
                    }));
                    if (results.every(result => result.passed)) {
                        stepResults.push({
                            index,
                            type: step.type,
                            name: step.name,
                            attempts,
                            durationMs: Date.now() - waitStartedAt,
                            response: lastResponse,
                            assertions: results
                        });
                        break;
                    }
                    if (Date.now() - waitStartedAt >= timeoutMs) {
                        const failures = results
                            .filter(result => !result.passed)
                            .map(result => result.message)
                            .join(' | ');
                        throw new Error(
                            `Timed out after ${timeoutMs}ms waiting for ${step.method.toUpperCase()} ${step.route}: ${failures}`
                        );
                    }
                    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
                }
            } else if (step.type === 'waitForPromptIdle') {
                const waitResult = await realtime.waitForPromptIdle({
                    labelIncludes: step.labelIncludes,
                    sinceEventIndex: lastRealtimeOperationStartIndex,
                    requireActivity: resolvePromptWaitRequireActivity(mode, step.requireActivity ?? true),
                    timeoutMs: step.timeoutMs ?? 300_000,
                    quietPeriodMs: step.quietPeriodMs ?? 500,
                    pollIntervalMs: step.pollIntervalMs ?? 50
                });
                stepResults.push({ index, type: step.type, result: waitResult });
            } else if (step.type === 'save') {
                lastResponse = await apiClient.fetchJson('POST', '/api/save');
                if (!lastResponse.ok || lastResponse.payload?.success !== true) {
                    throw new Error(`save step failed: ${lastResponse.payload?.error || lastResponse.status}`);
                }
                latestSavedName = lastResponse.payload.saveName;
                if (step.name) responses[step.name] = lastResponse;
                stepResults.push({ index, type: step.type, response: lastResponse });
            } else if (step.type === 'readSavedJson') {
                const saveName = step.saveName || latestSavedName;
                if (!saveName) {
                    throw new Error('readSavedJson step requires saveName or a preceding save step.');
                }
                lastResponse = await readSavedJson(root, {
                    saveName,
                    saveType: step.saveType || 'saves',
                    fileName: step.fileName
                });
                responses[step.name] = lastResponse;
                await writeJson(
                    attemptDir,
                    `saved-${step.name.replaceAll(/[^A-Za-z0-9._-]/g, '_')}.json`,
                    lastResponse.payload
                );
                stepResults.push({ index, type: step.type, response: lastResponse });
            } else if (step.type === 'reload') {
                const saveName = step.saveName || latestSavedName;
                if (!saveName) throw new Error('reload step requires saveName or a preceding save step.');
                lastResponse = await apiClient.fetchJson('POST', '/api/load', {
                    saveName,
                    saveType: step.saveType || 'saves',
                    clientId: realtime.clientId
                });
                if (!lastResponse.ok || lastResponse.payload?.success !== true) {
                    throw new Error(`reload step failed: ${lastResponse.payload?.error || lastResponse.status}`);
                }
                if (step.name) responses[step.name] = lastResponse;
                stepResults.push({ index, type: step.type, response: lastResponse });
            } else if (step.type === 'assert') {
                after = await apiClient.captureState();
                const afterLogs = await getLogManifest(root);
                changedLogs = findChangedLogs(beforeLogs, afterLogs);
                cassetteStatus = await readCassetteStatus(apiClient);
                const results = evaluateAssertions(step.assertions, assertionContext({
                    before,
                    after,
                    response: lastResponse,
                    realtime: realtime.events,
                    changedLogs,
                    cassetteStatus,
                    stepResults,
                    fixture: fixtureEntities,
                    snapshots,
                    responses
                }));
                assertionResults.push(...results);
                stepResults.push({ index, type: step.type, assertions: results });
                const failed = results.find(entry => !entry.passed);
                if (failed) throw new Error(`Scenario assertion failed: ${failed.message}`);
            } else if (step.type === 'humanReviewNote') {
                humanReview.push(step.text);
                stepResults.push({ index, type: step.type, text: step.text });
            } else if (step.type === 'nodeTest') {
                const testFiles = step.files.map(file => path.resolve(root, file));
                for (const testFile of testFiles) {
                    const relative = path.relative(path.join(root, 'tests'), testFile);
                    if (relative.startsWith('..') || path.isAbsolute(relative)) {
                        throw new Error(`nodeTest file must stay inside tests/: ${testFile}`);
                    }
                }
                const execute = promisify(execFile);
                try {
                    const output = await execute(process.execPath, ['--test', ...testFiles], {
                        cwd: root,
                        maxBuffer: 16 * 1024 * 1024
                    });
                    lastResponse = {
                        method: 'NODE',
                        route: step.files.join(','),
                        status: 200,
                        ok: true,
                        durationMs: Date.now() - stepStartedAt,
                        payload: { success: true, stdout: output.stdout, stderr: output.stderr }
                    };
                } catch (error) {
                    lastResponse = {
                        method: 'NODE',
                        route: step.files.join(','),
                        status: 500,
                        ok: false,
                        durationMs: Date.now() - stepStartedAt,
                        payload: {
                            success: false,
                            error: `Node test process failed with exit code ${error.code ?? 'unknown'}.`,
                            stdout: error.stdout || '',
                            stderr: error.stderr || ''
                        }
                    };
                }
                responses[step.name] = lastResponse;
                stepResults.push({ index, type: step.type, name: step.name, response: lastResponse });
            }
            durations.push({ step: `${index}:${step.type}`, durationMs: Date.now() - stepStartedAt });
        }

        const finalAssertions = replaceScenarioVariables(definition.assertions || [], {
            fixture: fixtureEntities,
            response: responses,
            snapshot: snapshots
        });
        const cassetteAssertions = finalAssertions.filter(assertion => assertion.type === 'cassetteConsumed');
        const mechanicalFinalAssertions = finalAssertions.filter(assertion => assertion.type !== 'cassetteConsumed');
        if (cassetteAssertions.length && mode !== 'replay') {
            throw new Error('cassetteConsumed final assertions require replay mode.');
        }
        if (mechanicalFinalAssertions.length) {
            after = await apiClient.captureState();
            const afterLogs = await getLogManifest(root);
            changedLogs = findChangedLogs(beforeLogs, afterLogs);
            cassetteStatus = await readCassetteStatus(apiClient);
            const finalResults = evaluateAssertions(mechanicalFinalAssertions, assertionContext({
                before,
                after,
                response: lastResponse,
                realtime: realtime.events,
                changedLogs,
                cassetteStatus,
                stepResults,
                fixture: fixtureEntities,
                snapshots,
                responses
            }));
            assertionResults.push(...finalResults);
            const failed = finalResults.find(entry => !entry.passed);
            if (failed) throw new Error(`Scenario assertion failed: ${failed.message}`);
        }

        if (mode === 'live-record') {
            await waitForCompletionCassetteRecordingIdle(apiClient);
            const completed = await apiClient.fetchJson(
                'POST',
                '/api/llm-completion-cassette/complete-recording',
                { description: `${definition.scenario}/${definition.case}` }
            );
            if (!completed.ok || completed.payload?.success !== true) {
                throw new Error(`Failed to complete recorded cassette: ${completed.payload?.error || completed.status}`);
            }
            const completedCassettePath = completed.payload.recording?.resolvedPath;
            if (typeof completedCassettePath !== 'string' || !completedCassettePath.trim()) {
                throw new Error('Completed cassette response did not include its resolved path.');
            }
            const cassetteArtifactPath = path.join(attemptDir, 'completion-cassette.json');
            if (path.resolve(completedCassettePath) !== path.resolve(cassetteArtifactPath)) {
                await fs.copyFile(completedCassettePath, cassetteArtifactPath);
            }
        } else if (mode === 'replay') {
            await waitForCompletionCassetteReplayConsumed(apiClient);
            const consumed = await apiClient.fetchJson('POST', '/api/llm-completion-cassette/assert-consumed');
            if (!consumed.ok || consumed.payload?.success !== true) {
                throw new Error(`Completion cassette was not fully consumed: ${consumed.payload?.error || consumed.status}`);
            }
            cassetteStatus = await readCassetteStatus(apiClient);
            if (cassetteAssertions.length) {
                const cassetteResults = evaluateAssertions(cassetteAssertions, assertionContext({
                    before,
                    after,
                    response: lastResponse,
                    realtime: realtime.events,
                    changedLogs,
                    cassetteStatus,
                    stepResults,
                    fixture: fixtureEntities
                }));
                assertionResults.push(...cassetteResults);
                const failed = cassetteResults.find(entry => !entry.passed);
                if (failed) throw new Error(`Scenario assertion failed: ${failed.message}`);
            }
        }
    } catch (error) {
        executionError = error;
    } finally {
        if (pendingChats.size) {
            try {
                const cancellation = await apiClient.fetchJson('POST', '/api/prompts/cancel-all', {
                    waitForDrain: true,
                    timeoutMs: 10_000,
                    clientId: realtime.clientId
                });
                if (!cancellation.ok || cancellation.payload?.success !== true) {
                    throw new Error(cancellation.payload?.error || `HTTP ${cancellation.status}`);
                }
                for (const [name, pending] of pendingChats.entries()) {
                    const outcome = await pending.outcomePromise;
                    realtime.endRequest(pending.identifiers.requestId);
                    stepResults.push({
                        type: 'pendingChatCleanup',
                        name,
                        requestId: pending.identifiers.requestId,
                        cancellation,
                        response: outcome.response,
                        error: outcome.error?.message || null
                    });
                }
                pendingChats.clear();
            } catch (pendingCleanupError) {
                executionError ||= new Error(`Failed to cancel pending scenario chat: ${pendingCleanupError.message}`);
            }
        }
        try {
            after = await apiClient.captureState();
        } catch (captureError) {
            executionError ||= captureError;
        }
        try {
            const afterLogs = await getLogManifest(root);
            changedLogs = findChangedLogs(beforeLogs, afterLogs);
        } catch (logError) {
            executionError ||= logError;
        }
        try {
            cassetteStatus = await readCassetteStatus(apiClient);
        } catch (statusError) {
            executionError ||= statusError;
        }
        if (executionError && mode === 'live-record') {
            try {
                const cleanup = await archiveAndResetIncompleteCassetteRecording(apiClient, {
                    attemptDir,
                    description: `Reset after failed ${definition.scenario}/${definition.case}`
                });
                stepResults.push({
                    type: 'cassetteFailureCleanup',
                    archivePath: cleanup.archivePath ? path.relative(root, cleanup.archivePath) : null,
                    discardedTotal: cleanup.discardedTotal
                });
            } catch (cleanupError) {
                stepResults.push({
                    type: 'cassetteFailureCleanup',
                    error: cleanupError.message
                });
                const originalError = executionError;
                executionError = new Error(
                    `${originalError.message}; completion cassette cleanup also failed: ${cleanupError.message}`,
                    { cause: originalError }
                );
            }
        }
        await realtime.close().catch((closeError) => {
            executionError ||= closeError;
        });
    }

    const finishedAt = new Date().toISOString();
    const triage = buildTriage({
        scenario: definition.scenario,
        caseName: definition.case,
        mode,
        fixture: typeof definition.fixture === 'string'
            ? definition.fixture
            : definition.fixture?.saveName,
        configProfile: profile?.name,
        startedAt,
        finishedAt,
        durations,
        before,
        after,
        response: lastResponse,
        realtime: realtime.events,
        changedLogs,
        assertions: assertionResults,
        trackedPaths: definition.trackedPaths,
        cassetteStatus,
        humanReview
    });
    if (executionError) {
        triage.executionError = {
            message: executionError.message,
            stack: executionError.stack || null
        };
    }
    await writeJson(attemptDir, 'response.json', lastResponse);
    await writeJson(attemptDir, 'realtime.json', realtime.events);
    await writeJson(attemptDir, 'after.json', after);
    await writeJson(attemptDir, 'logs.json', { startedAt, finishedAt, changedLogs });
    await writeJson(attemptDir, 'steps.json', stepResults);
    await writeJson(attemptDir, 'triage.json', triage);
    await writeText(attemptDir, 'triage.md', renderTriageMarkdown(triage));

    if (runtimeFixture && !keepRuntimeFixture) {
        await removeRuntimeFixture(runtimeFixture);
    }
    if (executionError) {
        throw scenarioFailure(executionError.message, attemptDir);
    }
    return {
        attemptDir,
        result: {
            ok: true,
            status: 200,
            payload: {
                success: true,
                response: lastResponse || null
            }
        },
        response: lastResponse || null,
        triage
    };
}

export async function readScenarioFile(root, filename) {
    const absolute = path.resolve(root, filename);
    let parsed;
    try {
        parsed = JSON.parse(await fs.readFile(absolute, 'utf8'));
    } catch (error) {
        throw new Error(`Failed to read scenario file ${absolute}: ${error.message}`);
    }
    return validateScenarioDefinition(parsed);
}
