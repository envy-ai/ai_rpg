import path from 'node:path';

function hasOwn(target, key) {
    return Object.prototype.hasOwnProperty.call(target, key);
}

export function resolveObjectPath(target, objectPath) {
    if (typeof objectPath !== 'string' || !objectPath.trim()) {
        throw new Error('Assertion paths must be non-empty strings.');
    }
    const segments = objectPath
        .replaceAll(/\[(\d+)\]/g, '.$1')
        .split('.')
        .map(segment => segment.trim())
        .filter(Boolean);
    let cursor = target;
    for (const segment of segments) {
        if ((typeof cursor !== 'object' && typeof cursor !== 'function') || cursor === null || !hasOwn(cursor, segment)) {
            return { exists: false, value: undefined };
        }
        cursor = cursor[segment];
    }
    return { exists: true, value: cursor };
}

function deepEqual(left, right) {
    try {
        return JSON.stringify(left) === JSON.stringify(right);
    } catch {
        return false;
    }
}

function describeValue(value) {
    if (value === undefined) return 'undefined';
    const text = JSON.stringify(value);
    return text && text.length > 300 ? `${text.slice(0, 297)}...` : text;
}

function resolveSource(context, sourceName) {
    const name = typeof sourceName === 'string' && sourceName.trim()
        ? sourceName.trim()
        : 'after';
    const resolved = resolveObjectPath(context, name);
    if (!resolved.exists) {
        throw new Error(`Unknown assertion source "${name}".`);
    }
    return resolved.value;
}

function sourcesForComparison(assertion, context) {
    return {
        before: resolveSource(context, assertion.beforeSource || 'before'),
        after: resolveSource(context, assertion.afterSource || 'after')
    };
}

function resolveExpected(assertion, context, valueField = 'value', fromField = 'valueFrom') {
    let expected = assertion[valueField];
    if (assertion[fromField]) {
        const expectedSource = resolveSource(context, assertion[fromField].source);
        const expectedResolved = resolveObjectPath(expectedSource, assertion[fromField].path);
        if (!expectedResolved.exists) {
            return { exists: false, value: undefined, error: `Comparison path ${assertion[fromField].path} is missing.` };
        }
        expected = expectedResolved.value;
    }
    return { exists: true, value: expected };
}

function objectContains(actual, expected) {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)
        || !expected || typeof expected !== 'object' || Array.isArray(expected)) {
        return false;
    }
    return Object.entries(expected).every(([key, expectedValue]) => {
        if (!hasOwn(actual, key)) return false;
        if (expectedValue && typeof expectedValue === 'object' && !Array.isArray(expectedValue)) {
            return objectContains(actual[key], expectedValue);
        }
        return deepEqual(actual[key], expectedValue);
    });
}

function result(assertion, passed, message, details = {}) {
    return {
        type: assertion.type,
        passed: Boolean(passed),
        message,
        ...details
    };
}

function requireAssertionObject(assertion) {
    if (!assertion || typeof assertion !== 'object' || Array.isArray(assertion)) {
        throw new Error('Assertions must be objects.');
    }
    if (typeof assertion.type !== 'string' || !assertion.type.trim()) {
        throw new Error('Every assertion requires a non-empty type.');
    }
}

function getCollectionPayload(state, collection) {
    const wrapper = state?.[collection];
    const payload = wrapper?.payload;
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.[collection])) return payload[collection];
    const singular = collection.endsWith('s') ? collection.slice(0, -1) : collection;
    if (Array.isArray(payload?.[singular])) return payload[singular];
    return [];
}

export function normalizeAttackResults(invocations) {
    if (!Array.isArray(invocations)) return [];
    const normalized = [];
    for (const [invocationIndex, invocation] of invocations.entries()) {
        const metadata = invocation?.metadata && typeof invocation.metadata === 'object'
            ? invocation.metadata
            : {};
        if (invocation?.name === 'resolveAttack') {
            const application = metadata.application && typeof metadata.application === 'object'
                ? metadata.application
                : {};
            const summary = metadata.summary && typeof metadata.summary === 'object'
                ? metadata.summary
                : {};
            normalized.push({
                toolName: invocation.name,
                invocationIndex,
                resultIndex: 0,
                attacker: metadata.attacker || summary.attacker?.name || null,
                defender: summary.defender?.name || metadata.defender || application.targetName || null,
                targetId: application.targetId || summary.defender?.id || metadata.targetId || null,
                targetName: application.targetName || summary.defender?.name || metadata.defender || null,
                hit: summary.hit ?? metadata.hit ?? null,
                die: summary.roll?.die ?? null,
                damageApplied: application.damageApplied ?? summary.damage?.applied ?? null,
                damageEffectiveness: summary.damage?.effectiveness ?? null,
                damageMultiplier: summary.damage?.multiplier ?? null,
                position: null,
                startingHealth: application.startingHealth ?? summary.target?.startingHealth ?? null,
                endingHealth: application.endingHealth ?? summary.target?.remainingHealth ?? null
            });
            continue;
        }
        if (invocation?.name !== 'resolveAreaAttack') continue;
        const summary = metadata.summary && typeof metadata.summary === 'object'
            ? metadata.summary
            : {};
        const rows = Array.isArray(metadata.results)
            ? metadata.results
            : (Array.isArray(summary.results) ? summary.results : []);
        for (const [resultIndex, row] of rows.entries()) {
            const application = row?.application && typeof row.application === 'object'
                ? row.application
                : {};
            const attackSummary = row?.attackSummary && typeof row.attackSummary === 'object'
                ? row.attackSummary
                : {};
            normalized.push({
                toolName: invocation.name,
                invocationIndex,
                resultIndex,
                attacker: metadata.attacker || attackSummary.attacker?.name || summary.attacker || null,
                defender: attackSummary.defender?.name || application.targetName || row?.target || null,
                targetId: application.targetId || row?.targetId || null,
                targetName: application.targetName || row?.target || attackSummary.defender?.name || null,
                hit: row?.hit ?? attackSummary.hit ?? null,
                die: attackSummary.roll?.die ?? summary.sharedRoll?.die ?? null,
                damageApplied: application.damageApplied ?? row?.damageApplied ?? attackSummary.damage?.applied ?? null,
                damageEffectiveness: attackSummary.damage?.effectiveness ?? null,
                damageMultiplier: attackSummary.damage?.multiplier ?? null,
                position: row?.position ?? null,
                startingHealth: application.startingHealth ?? attackSummary.target?.startingHealth ?? null,
                endingHealth: application.endingHealth ?? attackSummary.target?.remainingHealth ?? null
            });
        }
    }
    return normalized;
}

export function evaluateAssertion(assertion, context) {
    requireAssertionObject(assertion);
    switch (assertion.type) {
        case 'httpStatus': {
            const actual = Number(context.response?.status);
            const expected = Number(assertion.equals);
            return result(assertion, actual === expected, `HTTP status ${actual}; expected ${expected}.`, { actual, expected });
        }
        case 'responseOk': {
            const actual = context.response?.ok === true;
            const expected = assertion.equals === undefined ? true : assertion.equals === true;
            return result(assertion, actual === expected, `response.ok=${actual}; expected ${expected}.`, { actual, expected });
        }
        case 'exists':
        case 'absent':
        case 'equals':
        case 'notEquals':
        case 'count':
        case 'includes':
        case 'notIncludes': {
            const source = resolveSource(context, assertion.source);
            const resolved = resolveObjectPath(source, assertion.path);
            if (assertion.type === 'exists') {
                return result(assertion, resolved.exists, `${assertion.path} ${resolved.exists ? 'exists' : 'is missing'}.`);
            }
            if (assertion.type === 'absent') {
                return result(assertion, !resolved.exists, `${assertion.path} ${resolved.exists ? 'exists unexpectedly' : 'is absent'}.`);
            }
            if (!resolved.exists) {
                return result(assertion, false, `${assertion.path} is missing.`);
            }
            if (assertion.type === 'equals' || assertion.type === 'notEquals') {
                let expected = assertion.equals;
                if (assertion.equalsFrom) {
                    const expectedSource = resolveSource(context, assertion.equalsFrom.source);
                    const expectedResolved = resolveObjectPath(expectedSource, assertion.equalsFrom.path);
                    if (!expectedResolved.exists) {
                        return result(assertion, false, `Comparison path ${assertion.equalsFrom.path} is missing.`);
                    }
                    expected = expectedResolved.value;
                }
                const equal = deepEqual(resolved.value, expected);
                const passed = assertion.type === 'equals' ? equal : !equal;
                return result(
                    assertion,
                    passed,
                    `${assertion.path}=${describeValue(resolved.value)}; expected ${assertion.type === 'equals' ? '' : 'not '}${describeValue(expected)}.`,
                    { actual: resolved.value, expected }
                );
            }
            if (assertion.type === 'count') {
                const actual = Array.isArray(resolved.value) || typeof resolved.value === 'string'
                    ? resolved.value.length
                    : (resolved.value && typeof resolved.value === 'object' ? Object.keys(resolved.value).length : null);
                const expected = Number(assertion.equals);
                return result(assertion, actual === expected, `${assertion.path} count=${actual}; expected ${expected}.`, { actual, expected });
            }
            const collection = resolved.value;
            const includes = Array.isArray(collection)
                ? collection.some(entry => deepEqual(entry, assertion.value))
                : (typeof collection === 'string' && typeof assertion.value === 'string'
                    ? collection.includes(assertion.value)
                    : false);
            const passed = assertion.type === 'includes' ? includes : !includes;
            return result(assertion, passed, `${assertion.path} ${includes ? 'includes' : 'does not include'} ${describeValue(assertion.value)}.`);
        }
        case 'stateUnchanged': {
            if (!Array.isArray(assertion.paths) || !assertion.paths.length) {
                throw new Error('stateUnchanged requires a non-empty paths array.');
            }
            const sources = sourcesForComparison(assertion, context);
            const changes = [];
            for (const objectPath of assertion.paths) {
                const before = resolveObjectPath(sources.before, objectPath);
                const after = resolveObjectPath(sources.after, objectPath);
                if (before.exists !== after.exists || !deepEqual(before.value, after.value)) {
                    changes.push({ path: objectPath, before: before.value, after: after.value });
                }
            }
            return result(assertion, changes.length === 0, changes.length
                ? `${changes.length} selected state path(s) changed.`
                : `${assertion.paths.length} selected state path(s) are unchanged.`, { changes });
        }
        case 'exactDelta': {
            const sources = sourcesForComparison(assertion, context);
            const before = resolveObjectPath(sources.before, assertion.path);
            const after = resolveObjectPath(sources.after, assertion.path);
            if (!before.exists || !after.exists || !Number.isFinite(before.value) || !Number.isFinite(after.value)) {
                return result(assertion, false, `${assertion.path} must exist as a finite number before and after.`);
            }
            const actual = after.value - before.value;
            const expected = Number(assertion.delta);
            return result(assertion, actual === expected, `${assertion.path} delta=${actual}; expected ${expected}.`, { actual, expected });
        }
        case 'greaterThan':
        case 'greaterThanOrEqual':
        case 'lessThan':
        case 'lessThanOrEqual': {
            const source = resolveSource(context, assertion.source);
            const resolved = resolveObjectPath(source, assertion.path);
            const expected = resolveExpected(assertion, context);
            if (!resolved.exists || !Number.isFinite(resolved.value)) {
                return result(assertion, false, `${assertion.path} must exist as a finite number.`);
            }
            if (!expected.exists) return result(assertion, false, expected.error);
            if (!Number.isFinite(expected.value)) {
                return result(assertion, false, 'Numeric comparison value must be finite.');
            }
            const operations = {
                greaterThan: resolved.value > expected.value,
                greaterThanOrEqual: resolved.value >= expected.value,
                lessThan: resolved.value < expected.value,
                lessThanOrEqual: resolved.value <= expected.value
            };
            const symbols = {
                greaterThan: '>',
                greaterThanOrEqual: '>=',
                lessThan: '<',
                lessThanOrEqual: '<='
            };
            return result(
                assertion,
                operations[assertion.type],
                `${assertion.path}=${resolved.value}; expected ${symbols[assertion.type]} ${expected.value}.`,
                { actual: resolved.value, expected: expected.value }
            );
        }
        case 'entityField': {
            const source = resolveSource(context, assertion.source || 'after');
            const collection = getCollectionPayload(source, assertion.collection);
            const entity = collection.find(entry => entry?.id === assertion.id);
            if (!entity) {
                return result(assertion, false, `Entity ${assertion.id} is missing from ${assertion.collection}.`);
            }
            const resolved = resolveObjectPath(entity, assertion.path);
            let expected = assertion.equals;
            if (assertion.equalsFrom) {
                const expectedSource = resolveSource(context, assertion.equalsFrom.source);
                const expectedResolved = resolveObjectPath(expectedSource, assertion.equalsFrom.path);
                if (!expectedResolved.exists) {
                    return result(assertion, false, `Comparison path ${assertion.equalsFrom.path} is missing.`);
                }
                expected = expectedResolved.value;
            }
            const passed = resolved.exists && deepEqual(resolved.value, expected);
            return result(
                assertion,
                passed,
                `${assertion.collection}:${assertion.id}.${assertion.path}=${describeValue(resolved.value)}; expected ${describeValue(expected)}.`,
                { actual: resolved.value, expected }
            );
        }
        case 'entityArrayObjectCount': {
            const source = resolveSource(context, assertion.source || 'after');
            const collection = getCollectionPayload(source, assertion.collection);
            const entity = collection.find(entry => entry?.id === assertion.id);
            if (!entity) {
                return result(assertion, false, `Entity ${assertion.id} is missing from ${assertion.collection}.`);
            }
            const resolved = resolveObjectPath(entity, assertion.path);
            if (!resolved.exists || !Array.isArray(resolved.value)) {
                return result(assertion, false, `${assertion.collection}:${assertion.id}.${assertion.path} must be an array.`);
            }
            if (!assertion.where || typeof assertion.where !== 'object' || Array.isArray(assertion.where)) {
                throw new Error('entityArrayObjectCount requires a where object.');
            }
            const actual = resolved.value.filter(entry => objectContains(entry, assertion.where)).length;
            const expected = Number(assertion.equals);
            return result(
                assertion,
                actual === expected,
                `${assertion.collection}:${assertion.id}.${assertion.path} matching object count=${actual}; expected ${expected}.`,
                { actual, expected, where: assertion.where }
            );
        }
        case 'arrayObjectCount': {
            const source = resolveSource(context, assertion.source);
            const resolved = resolveObjectPath(source, assertion.path);
            if (!resolved.exists || !Array.isArray(resolved.value)) {
                return result(assertion, false, `${assertion.path} must be an array.`);
            }
            if (!assertion.where || typeof assertion.where !== 'object' || Array.isArray(assertion.where)) {
                throw new Error('arrayObjectCount requires a where object.');
            }
            const actual = resolved.value.filter(entry => objectContains(entry, assertion.where)).length;
            const expected = Number(assertion.equals);
            return result(
                assertion,
                actual === expected,
                `${assertion.path} matching object count=${actual}; expected ${expected}.`,
                { actual, expected, where: assertion.where }
            );
        }
        case 'attackResultCount': {
            const source = resolveSource(context, assertion.source);
            const resolved = resolveObjectPath(source, assertion.path);
            if (!resolved.exists || !Array.isArray(resolved.value)) {
                return result(assertion, false, `${assertion.path} must be an array of tool invocations.`);
            }
            if (!assertion.where || typeof assertion.where !== 'object' || Array.isArray(assertion.where)) {
                throw new Error('attackResultCount requires a where object.');
            }
            const attackResults = normalizeAttackResults(resolved.value);
            const actual = attackResults.filter(entry => objectContains(entry, assertion.where)).length;
            const expected = Number(assertion.equals);
            return result(
                assertion,
                actual === expected,
                `${assertion.path} normalized attack-result count=${actual}; expected ${expected}.`,
                { actual, expected, where: assertion.where, attackResults }
            );
        }
        case 'attackResultApplied': {
            const source = resolveSource(context, assertion.source);
            const resolved = resolveObjectPath(source, assertion.path);
            if (!resolved.exists || !Array.isArray(resolved.value)) {
                return result(assertion, false, `${assertion.path} must be an array of tool invocations.`);
            }
            if (!assertion.where || typeof assertion.where !== 'object' || Array.isArray(assertion.where)) {
                throw new Error('attackResultApplied requires a where object.');
            }
            const matches = normalizeAttackResults(resolved.value)
                .filter(entry => objectContains(entry, assertion.where));
            if (matches.length !== 1) {
                return result(
                    assertion,
                    false,
                    `${assertion.path} has ${matches.length} matching normalized attack results; expected exactly 1.`,
                    { actual: matches.length, expected: 1, where: assertion.where, matches }
                );
            }
            const attackResult = matches[0];
            if (typeof attackResult.targetId !== 'string' || !attackResult.targetId.trim()) {
                return result(assertion, false, 'Matching attack result has no canonical targetId.', { attackResult });
            }
            const collectionName = assertion.collection || 'players';
            const healthPath = assertion.healthPath || 'health';
            const sources = sourcesForComparison(assertion, context);
            const beforeEntity = getCollectionPayload(sources.before, collectionName)
                .find(entry => entry?.id === attackResult.targetId);
            const afterEntity = getCollectionPayload(sources.after, collectionName)
                .find(entry => entry?.id === attackResult.targetId);
            if (!beforeEntity || !afterEntity) {
                return result(
                    assertion,
                    false,
                    `Attack target ${attackResult.targetId} must exist in ${collectionName} before and after.`,
                    { attackResult }
                );
            }
            const beforeHealth = resolveObjectPath(beforeEntity, healthPath);
            const afterHealth = resolveObjectPath(afterEntity, healthPath);
            const stateMatches = beforeHealth.exists
                && afterHealth.exists
                && deepEqual(beforeHealth.value, attackResult.startingHealth)
                && deepEqual(afterHealth.value, attackResult.endingHealth);
            const healthLossMatches = assertion.expectHealthLoss !== true || (
                Number.isFinite(attackResult.damageApplied)
                && attackResult.damageApplied > 0
                && Number.isFinite(attackResult.startingHealth)
                && Number.isFinite(attackResult.endingHealth)
                && attackResult.endingHealth < attackResult.startingHealth
            );
            const passed = stateMatches && healthLossMatches;
            return result(
                assertion,
                passed,
                passed
                    ? `Attack result for ${attackResult.attacker} -> ${attackResult.targetName || attackResult.targetId} matches authoritative before/after health.`
                    : `Attack result health ${describeValue(attackResult.startingHealth)} -> ${describeValue(attackResult.endingHealth)} does not match ${collectionName}:${attackResult.targetId}.${healthPath} ${describeValue(beforeHealth.value)} -> ${describeValue(afterHealth.value)}${assertion.expectHealthLoss === true ? ' with positive health loss required' : ''}.`,
                {
                    attackResult,
                    beforeHealth: beforeHealth.value,
                    afterHealth: afterHealth.value,
                    expectHealthLoss: assertion.expectHealthLoss === true
                }
            );
        }
        case 'attackResultCompare': {
            const source = resolveSource(context, assertion.source);
            const resolved = resolveObjectPath(source, assertion.path);
            if (!resolved.exists || !Array.isArray(resolved.value)) {
                return result(assertion, false, `${assertion.path} must be an array of tool invocations.`);
            }
            const attackResults = normalizeAttackResults(resolved.value);
            const leftMatches = attackResults.filter(entry => objectContains(entry, assertion.leftWhere));
            const rightMatches = attackResults.filter(entry => objectContains(entry, assertion.rightWhere));
            if (leftMatches.length !== 1 || rightMatches.length !== 1) {
                return result(
                    assertion,
                    false,
                    `Attack-result comparison requires one left and one right match; found ${leftMatches.length} and ${rightMatches.length}.`,
                    { leftMatches, rightMatches }
                );
            }
            const left = resolveObjectPath(leftMatches[0], assertion.field);
            const right = resolveObjectPath(rightMatches[0], assertion.field);
            if (!left.exists || !right.exists) {
                return result(assertion, false, `Attack-result comparison field ${assertion.field} must exist on both results.`);
            }
            const operator = assertion.operator;
            let passed;
            if (operator === 'equals') passed = deepEqual(left.value, right.value);
            else if (operator === 'notEquals') passed = !deepEqual(left.value, right.value);
            else if (!Number.isFinite(left.value) || !Number.isFinite(right.value)) {
                return result(assertion, false, `Attack-result comparison field ${assertion.field} must be finite for ${operator}.`);
            } else if (operator === 'greaterThan') passed = left.value > right.value;
            else if (operator === 'greaterThanOrEqual') passed = left.value >= right.value;
            else if (operator === 'lessThan') passed = left.value < right.value;
            else if (operator === 'lessThanOrEqual') passed = left.value <= right.value;
            else throw new Error(`Unknown attackResultCompare operator "${operator}".`);
            return result(
                assertion,
                passed,
                `Normalized attack-result ${assertion.field}: ${describeValue(left.value)} ${operator} ${describeValue(right.value)}.`,
                {
                    left: left.value,
                    right: right.value,
                    field: assertion.field,
                    operator,
                    leftWhere: assertion.leftWhere,
                    rightWhere: assertion.rightWhere
                }
            );
        }
        case 'uniqueBy': {
            const source = resolveSource(context, assertion.source);
            const resolved = resolveObjectPath(source, assertion.path);
            if (!resolved.exists || !Array.isArray(resolved.value)) {
                return result(assertion, false, `${assertion.path} must be an array.`);
            }
            const seen = new Set();
            const duplicates = [];
            for (const entry of resolved.value) {
                const key = resolveObjectPath(entry, assertion.key).value;
                const serialized = JSON.stringify(key);
                if (seen.has(serialized)) duplicates.push(key);
                seen.add(serialized);
            }
            return result(assertion, duplicates.length === 0, duplicates.length
                ? `${assertion.path} has duplicate ${assertion.key} values: ${describeValue(duplicates)}.`
                : `${assertion.path} has unique ${assertion.key} values.`, { duplicates });
        }
        case 'noRealtimeErrors': {
            const errors = (context.realtime || []).filter(event => (
                event?.type === 'harness_response_error'
                || event?.type === 'unparseable'
                || event?.result?.ok === false
            ));
            return result(assertion, errors.length === 0, errors.length
                ? `${errors.length} realtime harness error(s) occurred.`
                : 'No realtime harness errors occurred.', { errors });
        }
        case 'noUnexpectedErrorLogs': {
            const errorLogs = (context.changedLogs || []).filter(entry => /^ERROR_/i.test(path.basename(entry.name || '')));
            const allowed = new Set(Array.isArray(assertion.allowed) ? assertion.allowed : []);
            const allowedPrefixes = Array.isArray(assertion.allowedPrefixes)
                ? assertion.allowedPrefixes
                : [];
            const unexpected = errorLogs.filter(entry => (
                !allowed.has(entry.name)
                && !allowedPrefixes.some(prefix => entry.name.startsWith(prefix))
            ));
            return result(assertion, unexpected.length === 0, unexpected.length
                ? `Unexpected error logs: ${unexpected.map(entry => entry.name).join(', ')}.`
                : 'No unexpected error logs were created.', { unexpected });
        }
        case 'historyAddedTypeCount': {
            if (typeof assertion.entryType !== 'string' || !assertion.entryType.trim()) {
                throw new Error('historyAddedTypeCount requires a non-empty entryType.');
            }
            const sources = sourcesForComparison(assertion, context);
            const history = summarizeHistoryChanges(sources.before, sources.after);
            const actual = history.addedByType[assertion.entryType.trim()] || 0;
            const expected = Number(assertion.equals);
            return result(
                assertion,
                actual === expected,
                `Added history type ${assertion.entryType.trim()} count=${actual}; expected ${expected}.`,
                { actual, expected }
            );
        }
        case 'historyAddedNestedObjectCount': {
            if (!assertion.entryWhere || typeof assertion.entryWhere !== 'object' || Array.isArray(assertion.entryWhere)) {
                throw new Error('historyAddedNestedObjectCount requires an entryWhere object.');
            }
            if (!assertion.where || typeof assertion.where !== 'object' || Array.isArray(assertion.where)) {
                throw new Error('historyAddedNestedObjectCount requires a where object.');
            }
            const sources = sourcesForComparison(assertion, context);
            const addedEntries = collectAddedHistoryEntries(sources.before, sources.after)
                .filter(entry => objectContains(entry, assertion.entryWhere));
            const nestedObjects = [];
            const invalidEntries = [];
            for (const entry of addedEntries) {
                const nested = resolveObjectPath(entry, assertion.path);
                if (!nested.exists || !Array.isArray(nested.value)) {
                    invalidEntries.push(entry?.id || entry?.type || null);
                    continue;
                }
                nestedObjects.push(...nested.value);
            }
            if (invalidEntries.length) {
                return result(
                    assertion,
                    false,
                    `${invalidEntries.length} matching added history entr${invalidEntries.length === 1 ? 'y has' : 'ies have'} no array at ${assertion.path}.`,
                    { invalidEntries }
                );
            }
            const actual = nestedObjects.filter(entry => objectContains(entry, assertion.where)).length;
            const expected = Number(assertion.equals);
            return result(
                assertion,
                actual === expected,
                `Added history ${assertion.path} matching object count=${actual}; expected ${expected}.`,
                {
                    actual,
                    expected,
                    entryWhere: assertion.entryWhere,
                    where: assertion.where,
                    matchingEntryCount: addedEntries.length
                }
            );
        }
        case 'cassetteConsumed': {
            const replay = context.cassetteStatus?.replay;
            const passed = replay?.active === true
                && replay?.version === 2
                && replay?.allConsumed === true;
            return result(assertion, passed, passed
                ? `Completion cassette consumed all ${replay.total} entries.`
                : `Completion cassette is not fully consumed: ${describeValue(replay)}.`, { replay });
        }
        default:
            throw new Error(`Unknown assertion type "${assertion.type}".`);
    }
}

export function evaluateAssertions(assertions, context) {
    if (!Array.isArray(assertions)) {
        throw new Error('Scenario assertions must be an array.');
    }
    return assertions.map(assertion => evaluateAssertion(assertion, context));
}

function collectHistoryEntries(state) {
    const payload = state?.history?.payload;
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.history)) return payload.history;
    if (Array.isArray(payload?.entries)) return payload.entries;
    return [];
}

function historyEntryKey(entry, index) {
    return entry?.id || entry?.timestamp || `index:${index}`;
}

function collectAddedHistoryEntries(before, after) {
    const beforeEntries = collectHistoryEntries(before);
    const afterEntries = collectHistoryEntries(after);
    const beforeKeys = new Set(beforeEntries.map(historyEntryKey));
    return afterEntries.filter((entry, index) => !beforeKeys.has(historyEntryKey(entry, index)));
}

export function summarizeHistoryChanges(before, after) {
    const beforeEntries = collectHistoryEntries(before);
    const afterEntries = collectHistoryEntries(after);
    const added = collectAddedHistoryEntries(before, after);
    const byType = {};
    for (const entry of added) {
        const type = typeof entry?.type === 'string' && entry.type.trim() ? entry.type.trim() : 'unknown';
        byType[type] = (byType[type] || 0) + 1;
    }
    return {
        beforeCount: beforeEntries.length,
        afterCount: afterEntries.length,
        addedCount: added.length,
        added: added.map(entry => ({
            id: entry?.id || null,
            timestamp: entry?.timestamp || null,
            type: entry?.type || null,
            parentId: entry?.parentId || entry?.metadata?.parentId || null
        })),
        addedByType: byType
    };
}

export function summarizePromptTimeline(events) {
    const statusEvents = [];
    const promptById = new Map();
    for (const event of events || []) {
        if (event?.type === 'chat_status') {
            statusEvents.push({
                requestId: event.requestId || null,
                timestamp: event.serverTime || event.receivedAt || null,
                stage: event.stage || null,
                message: event.message || null
            });
        }
        if (event?.type !== 'prompt_progress' || !Array.isArray(event.entries)) continue;
        for (const entry of event.entries) {
            if (!entry?.id) continue;
            promptById.set(entry.id, {
                id: entry.id,
                label: entry.label || null,
                model: entry.model || null,
                progressGroupId: entry.progressGroupId || null,
                progressGroupTargetLabel: entry.progressGroupTargetLabel || null,
                seconds: Number.isFinite(entry.seconds) ? entry.seconds : null,
                retries: Number.isInteger(entry.retries) ? entry.retries : 0,
                responseFailed: entry.responseFailed === true,
                failedResponseCount: Array.isArray(entry.failedResponses) ? entry.failedResponses.length : 0,
                isComplete: entry.isComplete === true
            });
        }
    }
    return { statuses: statusEvents, prompts: Array.from(promptById.values()) };
}

export function summarizeSelectedPaths(before, after, paths = []) {
    const changes = [];
    for (const objectPath of paths) {
        const previous = resolveObjectPath(before, objectPath);
        const next = resolveObjectPath(after, objectPath);
        if (previous.exists !== next.exists || !deepEqual(previous.value, next.value)) {
            changes.push({ path: objectPath, before: previous.value, after: next.value });
        }
    }
    return changes;
}

export function buildTriage({
    scenario,
    caseName,
    mode,
    fixture,
    configProfile,
    startedAt,
    finishedAt,
    durations,
    before,
    after,
    response,
    realtime,
    changedLogs,
    assertions,
    trackedPaths,
    cassetteStatus,
    humanReview
} = {}) {
    const assertionResults = assertions || [];
    const failedAssertions = assertionResults.filter(entry => !entry.passed);
    const passedAssertions = assertionResults.filter(entry => entry.passed);
    return {
        scenario,
        case: caseName,
        mode,
        fixture: fixture || null,
        configProfile: configProfile || null,
        startedAt,
        finishedAt,
        durations: durations || [],
        response: response
            ? {
                method: response.method,
                route: response.route,
                status: response.status,
                ok: response.ok,
                durationMs: response.durationMs,
                error: response.payload?.error || null,
                code: response.payload?.code || null,
                stack: response.payload?.stack || response.payload?.backtrace || null
            }
            : null,
        assertions: {
            failed: failedAssertions,
            passed: passedAssertions,
            total: assertionResults.length
        },
        selectedStateChanges: summarizeSelectedPaths(before, after, trackedPaths || []),
        history: summarizeHistoryChanges(before, after),
        promptTimeline: summarizePromptTimeline(realtime),
        changedLogs: (changedLogs || []).map(entry => ({ ...entry })),
        cassette: cassetteStatus || null,
        humanReview: Array.isArray(humanReview) ? humanReview : []
    };
}

export function renderTriageMarkdown(triage) {
    const lines = [
        `# ${triage.scenario} / ${triage.case} triage`,
        '',
        `- Mode: ${triage.mode}`,
        `- Fixture: ${triage.fixture || 'none'}`,
        `- Config profile: ${triage.configProfile || 'none'}`,
        `- Started: ${triage.startedAt}`,
        `- Finished: ${triage.finishedAt}`,
        `- Response: ${triage.response ? `${triage.response.status} (${triage.response.ok ? 'ok' : 'failed'})` : 'none'}`,
        `- Assertions: ${triage.assertions.passed.length} passed, ${triage.assertions.failed.length} failed`,
        ''
    ];
    if (triage.response?.error) {
        lines.push('## Response error', '', triage.response.error, '');
    }
    lines.push('## Failed assertions', '');
    if (!triage.assertions.failed.length) {
        lines.push('- None', '');
    } else {
        for (const entry of triage.assertions.failed) lines.push(`- ${entry.message}`);
        lines.push('');
    }
    lines.push('## Passed assertions', '');
    if (!triage.assertions.passed.length) {
        lines.push('- None', '');
    } else {
        for (const entry of triage.assertions.passed) lines.push(`- ${entry.message}`);
        lines.push('');
    }
    lines.push('## Selected state changes', '');
    if (!triage.selectedStateChanges.length) {
        lines.push('- None', '');
    } else {
        for (const change of triage.selectedStateChanges) {
            lines.push(`- \`${change.path}\`: ${describeValue(change.before)} → ${describeValue(change.after)}`);
        }
        lines.push('');
    }
    lines.push('## Prompt timeline', '');
    if (!triage.promptTimeline.prompts.length) {
        lines.push('- No prompt-progress entries', '');
    } else {
        for (const prompt of triage.promptTimeline.prompts) {
            lines.push(
                `- ${prompt.label || prompt.id}: ${prompt.seconds ?? '?'}s, retries=${prompt.retries}, `
                + `failed responses=${prompt.failedResponseCount}`
            );
        }
        lines.push('');
    }
    lines.push('## Changed logs', '');
    if (!triage.changedLogs.length) {
        lines.push('- None', '');
    } else {
        for (const entry of triage.changedLogs) lines.push(`- \`${entry.name}\` (${entry.size} bytes)`);
        lines.push('');
    }
    lines.push('## Human review', '');
    if (!triage.humanReview.length) {
        lines.push('- None');
    } else {
        for (const item of triage.humanReview) lines.push(`- [ ] ${item}`);
    }
    lines.push('');
    return lines.join('\n');
}
