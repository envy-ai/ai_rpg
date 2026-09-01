const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
    validateCraftingPlausibilityOutcome
} = require('../api.js');

const rootDir = path.join(__dirname, '..');

function buildPlausibleXml({
    type = 'Plausible',
    reason = 'The tools and materials fit the attempt.',
    skill = 'N/A',
    attribute = 'Intelligence',
    difficulty = 'Medium'
} = {}) {
    return `<response>
  <plausibility>
    <type>${type}</type>
    <skillCheck>
      <reason>${reason}</reason>
      <skill>${skill}</skill>
      <attribute>${attribute}</attribute>
      <difficulty>${difficulty}</difficulty>
    </skillCheck>
  </plausibility>
</response>`;
}

function buildParsedPlausibility({
    type = 'Plausible',
    attribute = 'Intelligence',
    difficulty = 'Medium'
} = {}) {
    return {
        type,
        reason: null,
        skillCheck: {
            skill: null,
            attribute,
            difficulty,
            reason: 'The tools and materials fit the attempt.'
        }
    };
}

test('crafting plausibility validation accepts the complete actionable schema', () => {
    const result = validateCraftingPlausibilityOutcome(buildParsedPlausibility(), {
        responseXml: buildPlausibleXml()
    });

    assert.deepEqual(result, { type: 'plausible', reason: null });
});

test('crafting plausibility validation rejects a missing required type', () => {
    const responseXml = buildPlausibleXml().replace('    <type>Plausible</type>\n', '');

    assert.throws(
        () => validateCraftingPlausibilityOutcome({ ...buildParsedPlausibility(), type: null }, { responseXml }),
        /missing required <plausibility> <type>/i
    );
});

test('crafting plausibility validation rejects incomplete skill checks', () => {
    const responseXml = buildPlausibleXml().replace('      <attribute>Intelligence</attribute>\n', '');

    assert.throws(
        () => validateCraftingPlausibilityOutcome(
            buildParsedPlausibility({ attribute: null }),
            { responseXml }
        ),
        /missing required <skillCheck> <attribute>/i
    );
});

test('crafting plausibility validation rejects difficulty values outside the prompt contract', () => {
    assert.throws(
        () => validateCraftingPlausibilityOutcome(
            buildParsedPlausibility({ difficulty: 'Impossible' }),
            { responseXml: buildPlausibleXml({ difficulty: 'Impossible' }) }
        ),
        /must be Trivial, Easy, Medium, Hard, Very Hard, or Legendary/i
    );
});

test('implausible crafting requires and preserves a player-facing reason', () => {
    const responseXml = `<response>
  <plausibility>
    <reason>The selected materials cannot physically hold the requested shape.</reason>
    <type>Implausible</type>
  </plausibility>
</response>`;
    const plausibility = {
        type: 'Implausible',
        reason: 'The selected materials cannot physically hold the requested shape.',
        skillCheck: null
    };

    assert.deepEqual(
        validateCraftingPlausibilityOutcome(plausibility, { responseXml }),
        {
            type: 'implausible',
            reason: 'The selected materials cannot physically hold the requested shape.'
        }
    );

    assert.throws(
        () => validateCraftingPlausibilityOutcome(
            { ...plausibility, reason: null },
            { responseXml: responseXml.replace(/\s*<reason>[\s\S]*?<\/reason>/, '') }
        ),
        /missing required <plausibility> <reason>/i
    );
});

test('/api/craft retries initial structured outcomes before resolving or mutating', () => {
    const source = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
    const start = source.indexOf("        app.post('/api/craft'");
    const end = source.indexOf("        app.post('/api/locations/:id/modify'", start);
    const route = source.slice(start, end);

    assert.match(route, /const plausibilityAttempt = await runPromptWithParseRetries\(/);
    assert.match(route, /validateCraftingPlausibilityOutcome\(parsedPlausibility/);
    assert.match(route, /const parsedBaseSuccessResult = parsedCraftingResults\.get\('success'\)/);
    assert.match(route, /resolveCraftConsumedThings\(\{[\s\S]*?inputThings: availableThings/);
    assert.ok(
        route.indexOf('const plausibilityAttempt = await runPromptWithParseRetries(')
            < route.indexOf('const actionOutcome = resolveActionOutcome('),
        'The validated prompt attempt must finish before a die is resolved.'
    );
});

test('implausible crafting is a normal non-mutating response with a client notification', () => {
    const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
    const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
    const locationModifyStart = apiSource.indexOf("        app.post('/api/locations/:id/modify'");
    const locationModifyEnd = apiSource.indexOf("        app.post('/api/regions/generate'", locationModifyStart);
    const locationModifyRoute = apiSource.slice(locationModifyStart, locationModifyEnd);

    assert.match(apiSource, /mappedLevel === 'implausible'[\s\S]*?success: true,[\s\S]*?applied: false,[\s\S]*?implausible: true/);
    assert.match(locationModifyRoute, /mappedLevel === 'implausible'[\s\S]*?success: true,[\s\S]*?applied: false,[\s\S]*?implausible: true/);
    assert.match(viewSource, /function showImplausibleActionNotification\(result, actionLabel\)/);
    assert.match(viewSource, /alert\(`\$\{actionLabel\} is implausible:\\n\\n\$\{reason\}`\)/);
    assert.equal(
        (viewSource.match(/showImplausibleActionNotification\(result, actionLabel\)/g) || []).length,
        3,
        'Expected the helper definition plus crafting and salvage/harvest call sites.'
    );
});
