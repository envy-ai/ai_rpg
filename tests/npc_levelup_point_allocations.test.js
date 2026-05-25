const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { DOMParser } = require('@xmldom/xmldom');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function extractBlock(source, startNeedle, endNeedle) {
    const start = source.indexOf(startNeedle);
    assert.notEqual(start, -1, `Unable to locate ${startNeedle}`);
    const end = source.indexOf(endNeedle, start);
    assert.notEqual(end, -1, `Unable to locate ${endNeedle}`);
    return source.slice(start, end);
}

function loadParseNpcSkillAssignments() {
    const block = extractBlock(
        serverSource,
        'function parseNpcSkillAssignments(xmlContent)',
        'async function requestNpcSkillAssignments'
    );
    const context = {
        Array,
        Error,
        Map,
        Number,
        String,
        console: { warn: () => {} },
        Utils: {
            parseXmlDocument: (content, type) => new DOMParser().parseFromString(content, type)
        },
        normalizePriorityValue: (value) => {
            const parsed = Number.parseInt(value, 10);
            if (!Number.isFinite(parsed)) {
                return 1;
            }
            return Math.max(1, Math.min(3, parsed));
        }
    };

    vm.createContext(context);
    vm.runInContext(
        `${block}
this.parseNpcSkillAssignments = parseNpcSkillAssignments;`,
        context
    );
    return context.parseNpcSkillAssignments;
}

function loadApplyNpcLevelUpProgressionAllocations(overrides = {}) {
    const helperBlock = extractBlock(
        serverSource,
        'function hasNpcPointAllocations(assignments)',
        'function buildAttributePriorityLookup'
    );
    const applyBlock = extractBlock(
        serverSource,
        'function applyNpcLevelUpProgressionAllocations({',
        'function directionKeyFromName'
    );
    const context = {
        Array,
        Error,
        Map,
        Number,
        Object,
        String,
        console,
        randomIntInclusive: () => 0,
        toAllocationPointBudget: (value) => {
            const numeric = Number(value);
            return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
        },
        ...overrides
    };

    vm.createContext(context);
    vm.runInContext(
        `${helperBlock}
${applyBlock}
this.applyNpcLevelUpProgressionAllocations = applyNpcLevelUpProgressionAllocations;`,
        context
    );
    return context.applyNpcLevelUpProgressionAllocations;
}

function loadApplyNpcCreationProgressionAllocations(overrides = {}) {
    const helperBlock = extractBlock(
        serverSource,
        'function hasNpcPointAllocations(assignments)',
        'function buildAttributePriorityLookup'
    );
    const applyBlock = extractBlock(
        serverSource,
        'function applyNpcCreationProgressionAllocations(npc, progressionEntry)',
        'function applyNpcLevelUpProgressionAllocations({'
    );
    const context = {
        Array,
        Error,
        Map,
        Number,
        Object,
        String,
        console,
        randomIntInclusive: () => 0,
        toAllocationPointBudget: (value) => {
            const numeric = Number(value);
            return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
        },
        ...overrides
    };

    vm.createContext(context);
    vm.runInContext(
        `${helperBlock}
${applyBlock}
this.applyNpcCreationProgressionAllocations = applyNpcCreationProgressionAllocations;`,
        context
    );
    return context.applyNpcCreationProgressionAllocations;
}

test('NPC progression parser reads explicit point allocations instead of priority weights', () => {
    const parseNpcSkillAssignments = loadParseNpcSkillAssignments();
    const assignments = parseNpcSkillAssignments(`
<npcs>
  <npc>
    <name>Velska</name>
    <skills>
      <skill><name>Stealth</name><points>3</points></skill>
      <skill><name>Scavenging</name><points>2</points></skill>
    </skills>
    <attributes>
      <attribute><name>Agility</name><points>2</points></attribute>
    </attributes>
  </npc>
</npcs>`);

    const entry = assignments.get('velska');
    assert.deepEqual(JSON.parse(JSON.stringify(entry.skills)), [
        { name: 'Stealth', points: 3 },
        { name: 'Scavenging', points: 2 }
    ]);
    assert.deepEqual(JSON.parse(JSON.stringify(entry.attributes)), [
        { name: 'Agility', points: 2 }
    ]);
});

test('NPC progression parser still supports priority assignments for creation and respec flows', () => {
    const parseNpcSkillAssignments = loadParseNpcSkillAssignments();
    const assignments = parseNpcSkillAssignments(`
<npcs>
  <npc>
    <name>Velska</name>
    <skills>
      <skill><name>Scavenging</name><priority>3</priority></skill>
    </skills>
    <attributes>
      <attribute><name>Strength</name><priority>2</priority></attribute>
    </attributes>
  </npc>
</npcs>`);

    const entry = assignments.get('velska');
    assert.deepEqual(JSON.parse(JSON.stringify(entry.skills)), [
        { name: 'Scavenging', priority: 3 }
    ]);
    assert.deepEqual(JSON.parse(JSON.stringify(entry.attributes)), [
        { name: 'Strength', priority: 2 }
    ]);
});

test('NPC level-up under-allocation is filled among assigned attributes with a warning', () => {
    const warnings = [];
    let appliedAttributes = null;
    const applyNpcLevelUpProgressionAllocations = loadApplyNpcLevelUpProgressionAllocations({
        console: { warn: (...args) => warnings.push(args.join(' ')), log: () => {} },
        captureCharacterProgressionSnapshot: () => ({}),
        computeNpcLevelUpAttributeBudget: () => ({ points: 3, maxAttribute: 20 }),
        computeNpcLevelUpSkillBudget: () => ({ points: 0, maxSkill: null }),
        applyNpcAttributeAllocations: (_npc, assignments) => {
            appliedAttributes = assignments;
            return assignments.reduce((sum, entry) => sum + entry.points, 0);
        },
        applyNpcSkillAllocations: () => 0
    });

    applyNpcLevelUpProgressionAllocations({
        npc: { name: 'Velska' },
        previousLevel: 2,
        newLevel: 3,
        progressionEntry: {
            attributes: [{ name: 'Agility', points: 1 }]
        }
    });

    assert.deepEqual(JSON.parse(JSON.stringify(appliedAttributes)), [{ name: 'Agility', points: 3 }]);
    assert.ok(warnings.some(message => message.includes('under-allocated') && message.includes('attribute')));
});

test('NPC level-up over-allocation is reduced among assigned skills with a warning', () => {
    const warnings = [];
    let appliedSkills = null;
    const applyNpcLevelUpProgressionAllocations = loadApplyNpcLevelUpProgressionAllocations({
        console: { warn: (...args) => warnings.push(args.join(' ')), log: () => {} },
        captureCharacterProgressionSnapshot: () => ({}),
        computeNpcLevelUpAttributeBudget: () => ({ points: 0, maxAttribute: null }),
        computeNpcLevelUpSkillBudget: () => ({ points: 2, maxSkill: 10 }),
        applyNpcAttributeAllocations: () => 0,
        applyNpcSkillAllocations: (_npc, assignments) => {
            appliedSkills = assignments;
            return assignments.reduce((sum, entry) => sum + entry.points, 0);
        }
    });

    applyNpcLevelUpProgressionAllocations({
        npc: { name: 'Velska' },
        previousLevel: 2,
        newLevel: 3,
        progressionEntry: {
            skills: [{ name: 'Stealth', points: 5 }]
        }
    });

    assert.deepEqual(JSON.parse(JSON.stringify(appliedSkills)), [{ name: 'Stealth', points: 2 }]);
    assert.ok(warnings.some(message => message.includes('over-allocated') && message.includes('skill')));
});

test('NPC level-up prompt requests exact point allocations instead of priorities', () => {
    const promptSource = fs.readFileSync(
        path.join(__dirname, '..', 'prompts', '_includes', 'npc-generate-abilities-levelup.njk'),
        'utf8'
    );

    assert.match(promptSource, /attribute point/i);
    assert.match(promptSource, /skill point/i);
    assert.match(promptSource, /<points>/);
    assert.doesNotMatch(promptSource, /priority/i);
});

test('NPC creation skill point allocations are rebalanced against the post-attribute skill pool', () => {
    const warnings = [];
    let applySkillCalls = [];
    let budgetCallCount = 0;
    const applyNpcCreationProgressionAllocations = loadApplyNpcCreationProgressionAllocations({
        console: { warn: (...args) => warnings.push(args.join(' ')), log: () => {} },
        computeNpcCreationProgressionBudget: () => {
            budgetCallCount += 1;
            return budgetCallCount === 1
                ? { attributePoints: 2, skillPoints: 1, maxAttribute: 20, maxSkill: 10 }
                : { attributePoints: 0, skillPoints: 4, maxAttribute: 20, maxSkill: 10 };
        },
        applyNpcAttributeAllocations: () => 2,
        applyNpcSkillAllocations: (_npc, assignments, budget) => {
            applySkillCalls.push({ assignments, budget });
            return assignments.reduce((sum, entry) => sum + entry.points, 0);
        }
    });

    applyNpcCreationProgressionAllocations({ name: 'Velska' }, {
        attributes: [{ name: 'Agility', priority: 3 }],
        skills: [{ name: 'Stealth', points: 1 }]
    });

    assert.deepEqual(JSON.parse(JSON.stringify(applySkillCalls)), [{
        assignments: [{ name: 'Stealth', points: 4 }],
        budget: { points: 4, maxSkill: 10 }
    }]);
    assert.ok(warnings.some(message => message.includes('under-allocated') && message.includes('skill')));
});

test('NPC skill generation prompt supports attribute-priority and skill-point modes', () => {
    const promptSource = fs.readFileSync(
        path.join(__dirname, '..', 'prompts', '_includes', 'npc-generate-skills.njk'),
        'utf8'
    );

    assert.match(promptSource, /progressionAssignmentMode/);
    assert.match(promptSource, /skillPointBudgets/);
    assert.match(promptSource, /<points>/);
    assert.match(promptSource, /Attribute priorities/i);
});
