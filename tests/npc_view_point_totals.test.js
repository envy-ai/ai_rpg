const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const viewSource = fs.readFileSync(path.join(__dirname, '..', 'views', 'index.njk'), 'utf8');

function extractBlock(source, startNeedle, endNeedle) {
    const start = source.indexOf(startNeedle);
    assert.notEqual(start, -1, `Unable to locate ${startNeedle}`);
    const end = source.indexOf(endNeedle, start);
    assert.notEqual(end, -1, `Unable to locate ${endNeedle}`);
    return source.slice(start, end);
}

test('NPC view point totals use server-derived pools instead of read-only local recomputation', () => {
    const showBlock = extractBlock(
        viewSource,
        'async function showNpcViewModal(npc)',
        'function initTabs()'
    );

    assert.doesNotMatch(showBlock, /attributePoolBaseValue:\s*isPlayerView\s*&&/);
    assert.doesNotMatch(showBlock, /skillPoolBaseValue:\s*isPlayerView\s*&&/);
    assert.match(showBlock, /attributePoolBaseValue:\s*Number\.isFinite\(unspentAttributePoints\)\s*\?\s*unspentAttributePoints\s*:\s*null/);
    assert.match(showBlock, /skillPoolBaseValue:\s*Number\.isFinite\(unspentSkillPoints\)\s*\?\s*unspentSkillPoints\s*:\s*null/);
    assert.match(showBlock, /attributeFloorValues:\s*attributeValues/);
    assert.match(showBlock, /skillFloorValues:\s*skillValues/);
});

test('NPC view does not hide read-only point totals', () => {
    const visibilityBlock = extractBlock(
        viewSource,
        'if (npcViewAttributePointsGroup)',
        'let factionDirectory = null'
    );

    assert.doesNotMatch(visibilityBlock, /setAttribute\('hidden'/);
});
