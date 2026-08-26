const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');

const rootDir = path.join(__dirname, '..');
const env = new nunjucks.Environment(
    new nunjucks.FileSystemLoader(path.join(rootDir, 'prompts')),
    { autoescape: false }
);

test('season image description prompt requests distinct exterior and interior fields', () => {
    const rendered = env.render('season-image-descriptions.xml.njk', {
        setting: { name: 'Test World', description: 'A temperate fantasy setting.' },
        seasons: [
            { name: 'Winter', description: 'Cold and dim.' },
            { name: 'Summer', description: 'Warm and bright.' }
        ]
    });

    assert.match(rendered, /<seasonImageDescriptions>/);
    assert.match(rendered, /<vegetationDescription>/);
    assert.match(rendered, /<interiorDescription>/);
    assert.match(rendered, /Keep the view indoors/);
    assert.doesNotMatch(rendered, /<maxTokens>/);
});

test('calendar generation and backfill parsing require interior descriptions', () => {
    const calendarPrompt = fs.readFileSync(
        path.join(rootDir, 'prompts', 'calendar-generator.xml.njk'),
        'utf8'
    );
    const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');

    assert.match(calendarPrompt, /<interiorDescription>/);
    assert.match(apiSource, /missing <interiorDescription>/);
    assert.match(apiSource, /ensureCalendarSeasonImageDescriptions/);
    assert.match(apiSource, /LLMClient\.logPrompt\(\{[\s\S]*metadataLabel: 'season_image_descriptions'/);
});

test('all location generation paths request an explicit weather exposure scope', () => {
    for (const relativePath of [
        '_includes/location-generator-full.njk',
        '_includes/location-generator-stub.njk',
        '_includes/region-generator.njk'
    ]) {
        const source = fs.readFileSync(path.join(rootDir, 'prompts', relativePath), 'utf8');
        assert.match(source, /<hasWeather>/, `${relativePath} must request hasWeather`);
        assert.match(source, /"sheltered"/, `${relativePath} must document sheltered exposure`);
        assert.match(source, /"no"/, `${relativePath} must document indoor exposure`);
    }
});
