const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const rootDir = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
const scssSource = fs.readFileSync(path.join(rootDir, 'public', 'css', 'main.scss'), 'utf8');
const chatDocSource = fs.readFileSync(path.join(rootDir, 'docs', 'ui', 'chat_interface.md'), 'utf8');
const assetsDocSource = fs.readFileSync(path.join(rootDir, 'docs', 'ui', 'assets_styles.md'), 'utf8');

function extractFunction(source, functionName) {
    const start = source.indexOf(`function ${functionName}(`);
    if (start < 0) {
        throw new Error(`Unable to locate ${functionName} in views/index.njk`);
    }

    const bodyStart = source.indexOf('{', start);
    if (bodyStart < 0) {
        throw new Error(`Unable to locate body for ${functionName}`);
    }

    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') {
            depth += 1;
        } else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return source.slice(start, index + 1);
            }
        }
    }

    throw new Error(`Unable to extract ${functionName}`);
}

function loadHealthDrainHelpers() {
    const helperSource = [
        extractFunction(viewSource, 'formatHealthDrainDisplayAmount'),
        extractFunction(viewSource, 'getActorHealthDrainPerRound')
    ].join('\n\n');
    const context = {};
    vm.runInNewContext(
        `${helperSource}
this.formatHealthDrainDisplayAmount = formatHealthDrainDisplayAmount;
this.getActorHealthDrainPerRound = getActorHealthDrainPerRound;`,
        context
    );
    return context;
}

test('portrait health-drain helper sums active negative Health status-effect deltas', () => {
    const { getActorHealthDrainPerRound, formatHealthDrainDisplayAmount } = loadHealthDrainHelpers();

    const actor = {
        isDead: false,
        statusEffects: [
            {
                duration: 4,
                needBars: [
                    { name: 'Health', delta: -2 },
                    { bar: 'health', delta: -1.5 },
                    { name: 'Food', delta: -20 },
                    { name: 'Health', delta: 3 }
                ]
            },
            {
                duration: null,
                needBars: [
                    { name: 'Health', delta: -0.5 }
                ]
            },
            {
                duration: 0,
                needBars: [
                    { name: 'Health', delta: -99 }
                ]
            }
        ]
    };

    assert.equal(getActorHealthDrainPerRound(actor), 4);
    assert.equal(formatHealthDrainDisplayAmount(3.5), '3.5');
});

test('portrait health-drain helper suppresses dead actors and actors without health drain', () => {
    const { getActorHealthDrainPerRound } = loadHealthDrainHelpers();

    assert.equal(getActorHealthDrainPerRound({
        isDead: true,
        statusEffects: [
            { needBars: [{ name: 'Health', delta: -5 }] }
        ]
    }), null);

    assert.equal(getActorHealthDrainPerRound({
        isDead: false,
        statusEffects: [
            { needBars: [{ name: 'Health', delta: 5 }] }
        ]
    }), null);
});

test('portrait health-drain indicator uses the corpse-countdown slot and documented blood asset', () => {
    assert.match(viewSource, /const HEALTH_DRAIN_ICON_PATH = '\/assets\/material-icons\/misc\/health_blood\.svg';/);
    assert.match(viewSource, /amountLabel\.textContent = `-\$\{displayAmount\}`;/);
    assert.match(viewSource, /applyCharacterHealthDrainStyling\(chatSidebarElements\.portrait, data\);/);
    assert.match(viewSource, /indicator\.className = 'character-condition-indicator npc-death-indicator';/);
    assert.match(viewSource, /indicator\.className = 'character-condition-indicator character-health-drain-indicator';/);
    assert.match(scssSource, /\.character-health-drain-indicator__icon[\s\S]*health_blood\.svg/);
    assert.match(chatDocSource, /red blood indicator/);
    assert.match(assetsDocSource, /health_blood\.svg/);
});
