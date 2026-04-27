const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

const Globals = require('../Globals.js');
const Utils = require('../Utils.js');

function loadNpcActionPlanParser() {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('function parseNpcActionPlan(responseText) {');
    const end = source.indexOf('\n        function normalizeDifficultyLabel', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate parseNpcActionPlan in api.js');
    }

    const context = {
        Utils,
        sanitizeForXml(input) {
            return `<root>${input}</root>`
                .replace(/&(?![#a-zA-Z0-9]+;)/g, '&amp;')
                .replace(/<\s*br\s*>/gi, '<br/>')
                .replace(/<\s*hr\s*>/gi, '<hr/>');
        }
    };
    vm.createContext(context);
    vm.runInContext(
        `${source.slice(start, end)}\nthis.parseNpcActionPlan = parseNpcActionPlan;`,
        context
    );
    return context.parseNpcActionPlan;
}

test('parseNpcActionPlan ignores npc-plausibility fields except description', () => {
    const previousConfig = Globals.config;
    Globals.config = { ...(previousConfig || {}), strictXMLParsing: false };
    const parseNpcActionPlan = loadNpcActionPlanParser();
    try {
        const result = parseNpcActionPlan(`
<npcAction>
  <description>Marra studies the doorway and waves the others back.</description>
  <difficulty>Legendary</difficulty>
  <skill>Arcana</skill>
  <curcumstanceModifiers>
    <circumstanceModifier>
      <amount>-10</amount>
      <reason>Bad angle</reason>
    </circumstanceModifier>
  </curcumstanceModifiers>
</npcAction>`);

        assert.equal(result.description, 'Marra studies the doorway and waves the others back.');
        assert.deepEqual(Object.keys(result), ['description']);
    } finally {
        Globals.config = previousConfig;
    }
});
