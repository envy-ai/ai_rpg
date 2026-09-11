const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('location and NPC cards use rich item-style tooltip formatters', () => {
    const indexSource = fs.readFileSync(require.resolve('../views/index.njk'), 'utf8');
    const scssSource = fs.readFileSync(require.resolve('../public/css/main.scss'), 'utf8');

    assert.match(indexSource, /const formatNpcTooltipHtml = \(npc = \{\}\) =>/);
    assert.match(indexSource, /const formatLocationTooltipHtml = \(location = \{\}\) =>/);
    assert.match(indexSource, /const createRichEntityLightboxDataProvider = \(entity, entityType\) =>/);
    assert.match(indexSource, /tooltip-thing tooltip-entity is-npc/);
    assert.match(indexSource, /tooltip-thing tooltip-entity is-location/);
    assert.match(indexSource, /lightboxDataProvider: createRichEntityLightboxDataProvider\(location, 'location'\)/);
    assert.equal(
        (indexSource.match(/lightboxDataProvider: createRichEntityLightboxDataProvider\([^\n]+, 'npc'\)/g) || []).length,
        2,
        'shared NPC cards and Party-tab portraits should use rich lightbox details'
    );
    assert.doesNotMatch(indexSource, /createDescriptionLightboxDataProvider/);
    assert.match(indexSource, /bindLocationFloatingTooltip\(locationImage, location\)/);
    assert.doesNotMatch(indexSource, /tooltipController\.show\(locationDescriptionHtml/);
    assert.equal(
        (indexSource.match(/show\(formatNpcTooltipHtml\(/g) || []).length,
        2,
        'compact party and location NPC cards should use the rich formatter through the shared controller'
    );
    assert.match(indexSource, /floatingTooltip\.innerHTML = formatNpcTooltipHtml\(member\)/);
    assert.match(indexSource, /npc\.hiddenFromPlayer !== true \|\| npc\.isDead === true/);
    assert.match(indexSource, /tooltip-thing-bonuses-title">Toward You/);
    assert.match(indexSource, /formatRichTooltipEffects\(npc\?\.statusEffects\)/);
    assert.match(indexSource, /formatRichTooltipEffects\(location\?\.statusEffects, 'Location Effects'\)/);

    assert.match(scssSource, /\.location-tooltip\s*\{\s*display: none !important;/);
    assert.match(scssSource, /\.tooltip-entity\s*\{[\s\S]*&\.is-location[\s\S]*&\.is-npc/);
    assert.match(scssSource, /\.tooltip-entity-flags/);
});
