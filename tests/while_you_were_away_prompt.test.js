const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const nunjucks = require('nunjucks');

const Globals = require('../Globals.js');
const Player = require('../Player.js');
const { addEvalFilter } = require('../nunjucks_filters.js');

function createPromptEnv() {
    const env = nunjucks.configure(path.join(process.cwd(), 'prompts'), {
        autoescape: false,
        throwOnUndefined: true
    });
    addEvalFilter(env);
    return env;
}

function createTempNeedBarDefs() {
    const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rpg-while-away-needs-'));

    const writeFile = (relativePath, content) => {
        const targetPath = path.join(tempBaseDir, relativePath);
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, content, 'utf8');
    };

    writeFile('defs/attributes.yaml', `
attributes:
  constitution:
    label: Constitution
    default: 5
`);
    writeFile('defs/gear_slots.yaml', 'gear_slots: {}\n');
    writeFile('defs/dispositions.yaml', 'dispositions: {}\nrange: {}\n');
    writeFile('defs/need_bars.yaml', `
need_bars:
  social:
    name: Social
    description: Social connection
    player: true
    party: true
    non_party: true
    min: 0
    max: 100
    initial: 50
    while_you_were_away_prompt_notes: Characters with friendly company nearby should usually recover this need.
`);

    return tempBaseDir;
}

test('while-you-were-away include renders current-location reunion candidates', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('_includes/while-you-were-away.njk', {
        whileYouWereAwayNpcs: [
            {
                name: 'Bob',
                lastSeenTimeAgo: '2 hours ago',
                lastSeenLocationName: 'Town Square',
                last_seen_location: 'town-square'
            }
        ]
    });

    assert.match(rendered, /Bob \(last seen 2 hours ago at Town Square\)/);
    assert.match(rendered, /<name>Bob<\/name>/);
    assert.match(rendered, /Only use the optional arrival section for a character who is physically in the exact current location right now but was not listed above\./);
    assert.match(rendered, /<travelDestination>HERE<\/travelDestination>/);
    assert.match(rendered, /<proseForPlayer>/);
});

test('while-you-were-away include renders need bar prompt notes from definitions', () => {
    const previousBaseDir = Globals.baseDir;
    const previousConfig = Globals.config;
    const tempBaseDir = createTempNeedBarDefs();

    Player.clearRuntimeRegistries();
    Globals.baseDir = tempBaseDir;
    Globals.config = {
        ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
        baseHealthPerLevel: Number.isFinite(previousConfig?.baseHealthPerLevel)
            ? previousConfig.baseHealthPerLevel
            : 10,
        formulas: {
            ...(previousConfig?.formulas && typeof previousConfig.formulas === 'object' ? previousConfig.formulas : {}),
            character_creation: {
                ...(previousConfig?.formulas?.character_creation && typeof previousConfig.formulas.character_creation === 'object'
                    ? previousConfig.formulas.character_creation
                    : {}),
                attribute_pool_formula: previousConfig?.formulas?.character_creation?.attribute_pool_formula ?? '0',
                skill_pool_formula: previousConfig?.formulas?.character_creation?.skill_pool_formula ?? '0',
                max_attribute: previousConfig?.formulas?.character_creation?.max_attribute ?? '999',
                max_skill: previousConfig?.formulas?.character_creation?.max_skill ?? '999'
            }
        }
    };
    Player.reloadDefinitionCaches({ refreshInstances: false });

    try {
        const needBarDefinitions = Player.getNeedBarDefinitionsForContext();
        assert.equal(
            needBarDefinitions[0].while_you_were_away_prompt_notes,
            'Characters with friendly company nearby should usually recover this need.'
        );

        const promptEnv = createPromptEnv();
        const rendered = promptEnv.render('_includes/while-you-were-away.njk', {
            needBarDefinitions,
            whileYouWereAwayNpcs: [
                {
                    name: 'Mira',
                    lastSeenTimeAgo: '5 hours ago',
                    lastSeenLocationName: 'Common Room',
                    last_seen_location: 'common-room'
                }
            ]
        });

        assert.match(
            rendered,
            /- social: Characters with friendly company nearby should usually recover this need\./
        );
        assert.match(rendered, /or N\/A if this character does not have that need bar/);
    } finally {
        Player.clearRuntimeRegistries();
        Globals.baseDir = previousBaseDir;
        Globals.config = previousConfig;
        Player.reloadDefinitionCaches({ refreshInstances: false });
        fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }
});

test('while-you-were-away include stays empty when no NPCs are supplied', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('_includes/while-you-were-away.njk', {
        whileYouWereAwayNpcs: []
    });

    assert.doesNotMatch(rendered, /last seen/i);
    assert.doesNotMatch(rendered, /<name>[^<]+<\/name>/);
});
