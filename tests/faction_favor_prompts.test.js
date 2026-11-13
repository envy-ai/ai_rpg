const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const nunjucks = require('nunjucks');
const { DOMParser } = require('@xmldom/xmldom');

const Registry = require('../FactionFavorEffectRegistry.js');
const { parseFavorsFromFactionNode } = require('../FactionFavorXml.js');

const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'prompts')), { autoescape: false });
const TIERS = [{ threshold: 0, label: 'Neutral' }, { threshold: 20, label: 'Friend' }, { threshold: 60, label: 'Ally' }];

const factionNode = favorsXml => new DOMParser()
    .parseFromString(`<faction><name>Ashen Guild</name>${favorsXml}</faction>`, 'text/xml').documentElement;

test('generated favor XML parses into validated drafts', () => {
    const favors = parseFavorsFromFactionNode(factionNode(`<favors>
        <favor><name>Coin Loan</name><shortDescription>A loan.</shortDescription><description>The guild lends coin.</description>
          <minThreshold>60</minThreshold><cooldown>5 days</cooldown><requiresTarget>false</requiresTarget><targetPrompt></targetPrompt>
          <presence>faction-presence</presence><effect><type>grant-currency</type><amount>75</amount></effect></favor>
        <favor><name>Rest Easy</name><shortDescription>Lodging.</shortDescription><description>A bed.</description>
          <minThreshold>20</minThreshold><cooldown>2 days</cooldown><presence>faction-presence</presence>
          <effect><type>restore-needs</type><needBars><needBar><name>Rest</name><percentage>100</percentage></needBar></needBars></effect></favor>
        <favor><name>Whisper</name><shortDescription>Rumours.</shortDescription><description>Informants talk.</description>
          <minThreshold>20</minThreshold><cooldown>1 day</cooldown><requiresTarget>true</requiresTarget><targetPrompt>About whom?</targetPrompt>
          <effect><type>none</type></effect></favor>
    </favors>`), { factionName: 'Ashen Guild', tiers: TIERS });
    assert.equal(favors.length, 3);
    assert.deepEqual(favors[0].effect, { type: 'grant-currency', params: { amount: 75 } });
    assert.deepEqual(favors[1].effect.params.bars, [{ needBar: 'Rest', percentage: 100 }]);
    assert.equal(favors[2].effect, null);
    assert.equal(favors[2].requiresTarget, true);
    assert.equal(favors[0].id, undefined, 'drafts carry no ids until stored on a faction');
});

test('invalid generated favors produce correction feedback', () => {
    assert.throws(() => parseFavorsFromFactionNode(factionNode(`<favors><favor><name>X</name><shortDescription>s</shortDescription>
        <description>d</description><minThreshold>40</minThreshold><cooldown>1 day</cooldown></favor></favors>`), { factionName: 'Ashen Guild', tiers: TIERS }),
        /Valid thresholds: 20, 60/);
    assert.throws(() => parseFavorsFromFactionNode(factionNode(`<favors><favor><name>X</name><shortDescription>s</shortDescription>
        <description>d</description><minThreshold>20</minThreshold><cooldown>1 day</cooldown><effect><type>teleport</type></effect></favor></favors>`), { factionName: 'Ashen Guild', tiers: TIERS }),
        /"teleport" is not a known effect/);
    assert.deepEqual(parseFavorsFromFactionNode(factionNode(''), { factionName: 'Ashen Guild', tiers: TIERS }), []);
});

test('base-context favor include renders one compact row per favor', () => {
    const rendered = env.render('_includes/faction-favors.njk', {
        factionFavors: [
            { factionName: 'Ashen Guild', name: 'Safe Lodging', shortDescription: 'A night in a guild house.', status: 'available' },
            { factionName: 'Ashen Guild', name: 'Quiet Inquiry', shortDescription: 'Informants dig.', status: 'ready in 2 days' }
        ]
    });
    assert.match(rendered, /Ashen Guild \| Safe Lodging \| A night in a guild house\. \| available/);
    assert.match(rendered, /Quiet Inquiry \| Informants dig\. \| ready in 2 days/);
    assert.match(rendered, /must not be provided in prose/);
});

test('favor activation include marks applied effects and rival reactions', () => {
    const rendered = env.render('_includes/favor-activation.njk', {
        favorActivation: {
            factionName: 'Ashen Guild', favorName: 'Coin Loan', description: 'The guild lends coin.', target: '',
            effectSummary: 'The player received 75 currency.', rivalPenaltySummary: 'Tidewatch (rival) saw this; standing with them -1.'
        }
    });
    assert.match(rendered, /<alreadyApplied>The player received 75 currency\.<\/alreadyApplied>/);
    assert.match(rendered, /<rivalReaction>Tidewatch/);
    assert.doesNotMatch(rendered, /<target>/);
});

test('reputation generator prompt includes favor guidance and schema only when enabled', () => {
    const base = { factions: [{ name: 'Ashen Guild', tags: [], goals: [] }], favorEffectTypes: Registry.describeAll() };
    const enabled = env.render('faction-reputation-generator.xml.njk', { ...base, favorsEnabled: true });
    assert.match(enabled, /Faction favors:/);
    assert.match(enabled, /<type>none\|reveal-route\|grant-item\|grant-currency\|fast-travel\|restore-needs<\/type>/);
    const disabled = env.render('faction-reputation-generator.xml.njk', { ...base, favorsEnabled: false });
    assert.doesNotMatch(disabled, /<favors>/);
});
