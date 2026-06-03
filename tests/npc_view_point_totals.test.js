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

test('NPC view renders calculated attributes above base attribute controls', () => {
    const scssSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'main.scss'), 'utf8');
    const attributesSection = extractBlock(
        viewSource,
        '<section class="npc-view-section" id="npcViewAttributesSection">',
        '<section class="npc-view-section" id="npcViewSkillsSection">'
    );
    const showBlock = extractBlock(
        viewSource,
        'async function showNpcViewModal(npc)',
        'function initTabs()'
    );

    assert.match(attributesSection, /id="npcViewCalculatedAttributesSection"/);
    assert.match(attributesSection, /id="npcViewCalculatedAttributesList"/);
    assert.ok(
        attributesSection.indexOf('id="npcViewCalculatedAttributesSection"')
            < attributesSection.indexOf("{% set attributeSectionId = 'npcViewAttributeAllocationSection' %}"),
        'calculated attributes should appear above the base attribute controls'
    );
    assert.match(viewSource, /const npcViewCalculatedAttributesList = document\.getElementById\('npcViewCalculatedAttributesList'\)/);
    assert.match(viewSource, /function resolveNpcViewCalculatedAttributeEntries\(actor = \{\}\)/);
    assert.match(viewSource, /function renderNpcViewCalculatedAttributes\(actor = \{\}\)/);
    assert.match(showBlock, /renderNpcViewCalculatedAttributes\(latestNpc\)/);
    assert.match(scssSource, /\.npc-view-calculated-attribute--higher/);
    assert.match(scssSource, /\.npc-view-calculated-attribute--lower/);
    assert.match(scssSource, /\.npc-view-calculated-attribute--same/);
});
