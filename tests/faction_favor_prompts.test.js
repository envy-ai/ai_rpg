const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
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

test('favor generation is a base-context prompt that lists factions needing favors with positive tiers only', () => {
    const base = fs.readFileSync(path.join(__dirname, '..', 'prompts', 'base-context.xml.njk'), 'utf8');
    assert.match(base, /\{% include "_includes\/" \+ promptType \+ "\.njk" %\}/);
    const rendered = env.render('_includes/faction-favors-generator.njk', {
        favorEffectTypes: Registry.describeAll(),
        factionsNeedingFavors: [{
            name: 'Ashen Guild', shortDescription: 'Smugglers.', goals: ['Control the docks'], assets: [{ name: 'Warehouse' }],
            reputationTiers: [{ threshold: -20, label: 'Enemy', perks: [] }, { threshold: 20, label: 'Friend', perks: ['Discounts'] }]
        }]
    });
    assert.match(rendered, /story so far/);
    assert.match(rendered, /<tier><threshold>20<\/threshold><label>Friend<\/label>/);
    assert.doesNotMatch(rendered, /<threshold>-20<\/threshold>/);
    assert.match(rendered, /<type>none\|reveal-route\|grant-item\|grant-currency\|fast-travel\|restore-needs<\/type>/);
    for (const template of ['faction-reputation-generator.xml.njk', 'fill-faction-form.xml.njk']) {
        assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'prompts', template), 'utf8'), /favor/i,
            `${template} no longer generates favors`);
    }
});

test('regeneration mode asks for one distinct favor at the same threshold and lists existing favors', () => {
    const rendered = env.render('_includes/faction-favors-generator.njk', {
        favorEffectTypes: Registry.describeAll(),
        favorToRegenerate: { name: 'Quiet Inquiry', shortDescription: 'Informants dig.', minThreshold: 20 },
        favorRegenerationNotes: 'Something about the docks.',
        factionsNeedingFavors: [{
            name: 'Ashen Guild',
            favors: [{ name: 'Quiet Inquiry', minThreshold: 20, shortDescription: 'Informants dig.' }, { name: 'War Chest', minThreshold: 60, shortDescription: 'A loan.' }],
            reputationTiers: [{ threshold: 20, label: 'Friend', perks: [] }, { threshold: 60, label: 'Ally', perks: [] }]
        }]
    });
    assert.match(rendered, /alternative to "Quiet Inquiry"/);
    assert.match(rendered, /same minThreshold \(20\)/);
    assert.match(rendered, /exactly one favor/);
    assert.match(rendered, /Player guidance for the new favor: Something about the docks\./);
    assert.match(rendered, /<existingFavors>.*War Chest/);
    assert.doesNotMatch(rendered, /Create faction favors for the factions listed below/);
});

test('favor XML parses target-sourced contents and treats empty contentsSource as omitted', () => {
    const entry = (name, source, requiresTarget = true) => `<favor><name>${name}</name><shortDescription>A delivery.</shortDescription>
        <description>A parcel arrives.</description><minThreshold>20</minThreshold><cooldown>1 day</cooldown>
        <requiresTarget>${requiresTarget}</requiresTarget><targetPrompt>What should be delivered?</targetPrompt>
        <effect><type>grant-item</type><itemName>Parcel</itemName><itemDescription>A sealed parcel.</itemDescription>${source}</effect></favor>`;
    const parse = entries => parseFavorsFromFactionNode(factionNode(`<favors>${entries}</favors>`), { factionName: 'Ashen Guild', tiers: TIERS });
    const [target, empty, omitted] = parse(entry('Target', '<contentsSource>target</contentsSource>') + entry('Empty', '<contentsSource/>') + entry('Omitted', ''));
    assert.equal(target.effect.params.contentsSource, 'target');
    assert.deepEqual(empty.effect, omitted.effect);
    assert.throws(() => parse(entry('Invalid', '<contentsSource>target</contentsSource>', false)), /requiresTarget/);
});

test('contentsSource XML optional scalar validates syntax and effect branch', () => {
    const entry = (type, source) => `<favors><favor><name>Gift</name><shortDescription>Gift.</shortDescription><description>A gift.</description>
        <minThreshold>20</minThreshold><cooldown>1 day</cooldown><requiresTarget>true</requiresTarget><targetPrompt>Which item?</targetPrompt>
        <effect><type>${type}</type><itemName>Parcel</itemName><itemDescription>A parcel.</itemDescription><amount>10</amount>${source}</effect></favor></favors>`;
    const parse = (type, source) => parseFavorsFromFactionNode(factionNode(entry(type, source)), { factionName: 'Ashen Guild', tiers: TIERS })[0];
    const omitted = parse('grant-item', '').effect;
    for (const value of ['<contentsSource/>', '<contentsSource></contentsSource>', '<contentsSource>  </contentsSource>']) {
        assert.deepEqual(parse('grant-item', value).effect, omitted);
    }
    for (const value of ['false', '0']) {
        assert.throws(() => parse('grant-item', `<contentsSource>${value}</contentsSource>`), /contentsSource/);
    }
    assert.throws(() => parse('grant-item', '<contentsSource><nested>target</nested></contentsSource>'), /contentsSource/);
    assert.throws(() => parse('grant-currency', '<contentsSource>target</contentsSource>'), /contentsSource/);
});
