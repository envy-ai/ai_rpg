const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const nunjucks = require('nunjucks');

const rootDir = path.join(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

const viewSource = read('views/index.njk');
const apiSource = read('api.js');
const scssSource = read('public/css/main.scss');
const chatDocs = read('docs/ui/chat_interface.md');
const thingsDocs = read('docs/api/things.md');
const configSource = read('config.default.yaml');

test('ai item search prompt renders strict and lenient modes', () => {
    const env = nunjucks.configure(path.join(rootDir, 'prompts'), {
        autoescape: false,
        throwOnUndefined: false
    });

    const strictOutput = env.render('ai-item-search.xml.njk', {
        criteria: 'portable light sources',
        mode: 'strict',
        items: [
            {
                name: 'Storm Lantern',
                description: 'A hooded lantern for crossing wet alleys.',
                level: '1',
                quality: 'common',
                quantity: '1',
                equipmentSlot: 'hand'
            }
        ]
    });
    assert.match(strictOutput, /Only include items that clearly match the criteria\./);
    assert.match(strictOutput, /<results>/);

    const lenientOutput = env.render('ai-item-search.xml.njk', {
        criteria: 'anything that might help with light',
        mode: 'lenient',
        items: [
            {
                name: 'Mirrored Buckle',
                description: 'A polished buckle.',
                level: '',
                quality: '',
                quantity: '',
                equipmentSlot: ''
            }
        ]
    });
    assert.match(lenientOutput, /include it in the results/);
});

test('things API exposes logged ai item search endpoint', () => {
    assert.match(apiSource, /app\.post\('\/api\/things\/ai-search', async \(req, res\) => \{/);
    assert.match(apiSource, /promptEnv\.render\('ai-item-search\.xml\.njk'/);
    assert.match(apiSource, /const metadataLabel = 'ai_item_search'/);
    assert.match(apiSource, /requiredRegex: \/<results\[\\s\\S\]\*<\\\/results>\/i/);
    assert.match(apiSource, /LLMClient\.logPrompt\(\{[\s\S]*?metadataLabel,[\s\S]*?generationPrompt: parsedTemplate\.generationPrompt,[\s\S]*?response: responseText/);
    assert.match(apiSource, /parseAiItemSearchResponse\(responseText\)/);
    assert.match(apiSource, /matchedIds = items[\s\S]*?normalizedResultNames\.has\(item\.name\.toLowerCase\(\)\)/);
    assert.match(apiSource, /createAiItemSearchValidationError/);
});

test('shared thing-list UI adds ai search controls and enter-to-search behavior', () => {
    assert.match(viewSource, /thingListAiSearchStates = new Map\(\)/);
    assert.match(viewSource, /text\.textContent = 'Use AI search \(enter to confirm criteria\)'/);
    assert.match(viewSource, /function ensureThingListAiSearchControls\(\{/);
    assert.match(viewSource, /searchInput\.addEventListener\('input', \(\) => \{[\s\S]*?if \(state\.enabled\) \{[\s\S]*?return;[\s\S]*?state\.rerender\?\.\(\);/);
    assert.match(viewSource, /searchInput\.addEventListener\('keydown', \(event\) => \{[\s\S]*?event\.key !== 'Enter'[\s\S]*?runThingListAiSearch\(state\)/);
    assert.match(viewSource, /fetch\('\/api\/things\/ai-search'/);
    assert.match(viewSource, /filters\.aiSearch\?\.enabled/);
    assert.match(viewSource, /filters\.aiSearch\.matchedIds\?\.has\(itemId\)/);
});

test('ai search is bound to every shared filterable item panel', () => {
    [
        'npcInventory',
        'containerPlayerInventory',
        'containerContents',
        'barterPlayerInventory',
        'barterMerchantInventory',
        'craftingInventory',
        'moduleWorkbenchInventory',
        'locationScenery',
        'locationItems'
    ].forEach(panelKey => {
        assert.match(viewSource, new RegExp(`panelKey: '${panelKey}'`));
    });
});

test('ai item search has styling, docs, and prompt progress coverage', () => {
    assert.match(scssSource, /\.thing-list-ai-search-toggle/);
    assert.match(scssSource, /\.thing-list-ai-search-status/);
    assert.match(chatDocs, /Use AI search \(enter to confirm criteria\)/);
    assert.match(chatDocs, /\/api\/things\/ai-search/);
    assert.match(thingsDocs, /POST \/api\/things\/ai-search/);
    assert.match(thingsDocs, /metadata label `ai_item_search`/);
    assert.match(configSource, /ai_item_search:\s*5000/);
});
