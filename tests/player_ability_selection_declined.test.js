const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const serverSource = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
const scssSource = fs.readFileSync(path.join(rootDir, 'public', 'css', 'main.scss'), 'utf8');

function extractFunction(source, name) {
  const signature = `function ${name}(`;
  let start = source.indexOf(signature);
  if (start === -1) {
    start = source.indexOf(`async ${signature}`);
  }
  assert.notEqual(start, -1, `Unable to locate ${name}.`);

  const paramsStart = source.indexOf('(', start);
  assert.notEqual(paramsStart, -1, `Unable to locate ${name} parameters.`);
  let paramsDepth = 0;
  let paramsEnd = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') {
      paramsDepth += 1;
    } else if (char === ')') {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        paramsEnd = index;
        break;
      }
    }
  }
  assert.notEqual(paramsEnd, -1, `Unable to locate ${name} parameter end.`);

  const bodyStart = source.indexOf('{', paramsEnd);
  assert.notEqual(bodyStart, -1, `Unable to locate ${name} body.`);

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
  throw new Error(`Unable to locate ${name} end.`);
}

test('player ability option generation passes declined ability names into the existing prompt block', () => {
  const generateSource = extractFunction(serverSource, 'generatePlayerAbilityOptionsForLevel');

  assert.match(serverSource, /function getCharacterDeclinedAbilityNames\(character\)/);
  assert.match(generateSource, /const declinedAbilityNames = getCharacterDeclinedAbilityNames\(character\);/);
  assert.match(generateSource, /\[\.\.\.excludedAbilityNames, \.\.\.declinedAbilityNames\]/);
  assert.match(generateSource, /declinedAbilityNames/);
  assert.match(
    generateSource,
    /resolveConfiguredPromptMaxAttempts\(LLMClient\.resolveEffectiveAiConfiguration\('player_ability_options', config\)\.aiConfig,\s*\{\s*fallbackMaxAttempts:\s*3\s*\}\)/,
    'option shortages should use the configured prompt-attempt policy instead of a hard-coded attempt count'
  );

  const declinedIndex = generateSource.indexOf('declinedAbilityNames');
  const requestIndex = generateSource.indexOf('requestLevelUpAbilityAssignmentsForCharacter({');
  assert.ok(
    declinedIndex !== -1 && requestIndex !== -1 && declinedIndex < requestIndex,
    'declined ability names must be prepared before the prompt request is built'
  );
});

test('player ability selection submit persists unselected thumbs-down options', () => {
  const applySource = extractFunction(serverSource, 'applyPlayerAbilitySelection');
  const routeStart = apiSource.indexOf("app.post('/api/player/ability-selection/submit'");
  assert.notEqual(routeStart, -1, 'Unable to locate ability-selection submit route.');
  const routeEnd = apiSource.indexOf("app.delete('/api/player/quests/:questId'", routeStart);
  assert.notEqual(routeEnd, -1, 'Unable to locate ability-selection submit route end.');
  const routeSource = apiSource.slice(routeStart, routeEnd);

  assert.match(routeSource, /const \{ level, selectedAbilityNames, declinedAbilityNames \} = req\.body \|\| \{\};/);
  assert.match(routeSource, /declinedAbilityNames/);

  assert.match(applySource, /declinedAbilityNames = \[\]/);
  assert.match(applySource, /selectedAbilityNames must be an array/);
  assert.match(applySource, /declinedAbilityNames must be an array/);
  assert.match(applySource, /declinedAbilitiesToSave/);
  assert.match(applySource, /character\.addDeclinedAbilities\(declinedAbilitiesToSave\)/);
  assert.match(applySource, /const mutationSnapshot = \{/);
  assert.match(applySource, /pendingAbilityOptionsByLevel:\s*character\.getPendingAbilityOptionsByLevel\(\)/);
  assert.match(applySource, /const nextSelection = await resolvePlayerAbilitySelectionState\(character,\s*\{\s*ensureOptionsForNext:\s*true/);
  assert.match(applySource, /return nextSelection;/);
  assert.match(applySource, /character\.setAbilities\(mutationSnapshot\.abilities\)/);
  assert.match(applySource, /character\.setDeclinedAbilities\(mutationSnapshot\.declinedAbilities\)/);
  assert.match(applySource, /character\.clearPendingAbilityOptions\(\)/);
  assert.match(applySource, /character\.setPendingAbilityOptionsForLevel\(pendingLevel, pendingAbilities\)/);
});

test('player ability selection restores abilities, declines, and drafts when next-level generation fails', async () => {
  const applySource = extractFunction(serverSource, 'applyPlayerAbilitySelection');
  const options = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'].map(name => ({
    id: `ability-${name}`,
    name,
    description: `${name} description`,
    shortDescription: `${name} short`,
    type: 'Passive',
    level: 2
  }));
  const state = {
    abilities: [{
      name: 'Existing',
      description: 'Existing description',
      shortDescription: 'Existing short',
      type: 'Passive',
      level: 1
    }],
    declined: [{
      name: 'Old Decline',
      description: 'Old decline description',
      shortDescription: 'Old decline short',
      type: 'Passive',
      level: 1
    }],
    pending: {
      2: options.map(ability => ({ ...ability }))
    },
    drafts: { 2: options.map(ability => ({ abilityId: ability.id, draft: { statusEffects: [] } })) }
  };
  const initialState = structuredClone(state);
  const character = {
    isNPC: false,
    health: 10,
    setHealth: value => { character.health = value; },
    getAbilities: () => state.abilities.map(ability => ({ ...ability })),
    setAbilities: abilities => {
      state.abilities = abilities.map(ability => ({ ...ability }));
    },
    getDeclinedAbilities: () => state.declined.map(ability => ({ ...ability })),
    setDeclinedAbilities: abilities => {
      state.declined = abilities.map(ability => ({ ...ability }));
    },
    addDeclinedAbilities: abilities => {
      state.declined.push(...abilities.map(ability => ({ ...ability })));
    },
    getPendingAbilityOptionsByLevel: () => structuredClone(state.pending),
    getPendingAbilityAttachmentDraftsByLevel: () => structuredClone(state.drafts),
    setPendingAbilityAttachmentDraftsForLevel: (level, drafts) => { state.drafts[level] = structuredClone(drafts); },
    clearPendingAbilityOptionsForLevel: level => {
      delete state.pending[level];
      delete state.drafts[level];
    },
    clearPendingAbilityOptions: () => {
      state.pending = {};
      state.drafts = {};
    },
    setPendingAbilityOptionsForLevel: (level, abilities) => {
      state.pending[level] = abilities.map(ability => ({ ...ability }));
    }
  };

  let resolveCalls = 0;
  const executableApplySource = applySource.startsWith('async ')
    ? applySource
    : `async ${applySource}`;
  const applyPlayerAbilitySelection = new Function(
    'resolvePlayerAbilitySelectionState',
    'ensureUniqueAbilityNames',
    'getCharacterAbilities',
    'sortAbilitiesByLevelAndName',
    'normalizeAbilityNameForLookup',
    'authorNewAbilityAttachments',
    'config',
    'getActiveSettingSnapshot',
    `${executableApplySource}; return applyPlayerAbilitySelection;`
  )(
    async () => {
      resolveCalls += 1;
      if (resolveCalls === 1) {
        return {
          pending: true,
          selection: {
            level: 2,
            requiredSelections: 3,
            optionsReady: true,
            options
          }
        };
      }
      throw new Error('next-level generation failed');
    },
    () => {},
    target => target.getAbilities(),
    abilities => abilities.sort((left, right) => left.level - right.level || left.name.localeCompare(right.name)),
    name => (typeof name === 'string' ? name.trim().toLowerCase() : ''),
    async () => {},
    {},
    () => ({})
  );

  await assert.rejects(
    applyPlayerAbilitySelection(character, {
      level: 2,
      selectedAbilityNames: ['Alpha', 'Bravo', 'Charlie'],
      declinedAbilityNames: ['Delta', 'Echo', 'Foxtrot']
    }),
    /next-level generation failed/
  );

  assert.equal(resolveCalls, 2);
  assert.deepEqual(state, initialState);
});

test('player ability selection modal renders separate select and thumbs-down controls', () => {
  const renderSource = extractFunction(viewSource, 'renderPlayerAbilitySelectionCards');
  const submitSource = extractFunction(viewSource, 'submitPlayerAbilitySelection');

  assert.match(renderSource, /const declined = playerAbilitySelectionState\.declinedNames\.has\(abilityKey\);/);
  assert.match(renderSource, /const card = document\.createElement\('div'\);/);
  assert.match(renderSource, /const selectButton = document\.createElement\('button'\);/);
  assert.match(renderSource, /selectButton\.className = 'player-ability-selection-card-select';/);
  assert.match(renderSource, /const topRow = document\.createElement\('div'\);/);
  assert.match(renderSource, /topRow\.className = 'player-ability-selection-card-top-row';/);
  assert.match(renderSource, /const declineToggle = document\.createElement\('button'\);/);
  assert.match(renderSource, /declineToggle\.className = 'player-ability-selection-decline-toggle';/);
  assert.match(renderSource, /declineToggle\.textContent = '👎';/);
  assert.match(renderSource, /declineToggle\.setAttribute\('aria-label', `Thumbs down \$\{abilityName\}`\);/);
  assert.match(renderSource, /declineToggle\.setAttribute\('aria-pressed', declined \? 'true' : 'false'\);/);
  assert.match(renderSource, /topRow\.appendChild\(header\);/);
  assert.match(renderSource, /selectButton\.appendChild\(topRow\);/);
  assert.match(renderSource, /selectButton\.appendChild\(description\);/);
  assert.match(renderSource, /playerAbilitySelectionState\.declinedNames\.delete\(abilityKey\);/);
  assert.match(renderSource, /playerAbilitySelectionState\.selectedNames\.delete\(abilityKey\);/);
  assert.match(renderSource, /event\.stopPropagation\(\);/);

  assert.match(submitSource, /const declinedAbilityNames = \[\];/);
  assert.match(submitSource, /for \(const key of playerAbilitySelectionState\.declinedNames\)/);
  assert.match(submitSource, /declinedAbilityNames/);
});

test('player ability selection thumbs-down control has dedicated styles', () => {
  assert.match(scssSource, /\.player-ability-selection-card-select\s*\{/);
  assert.match(scssSource, /\.player-ability-selection-card-top-row\s*\{/);
  assert.match(scssSource, /\.player-ability-selection-decline-toggle\s*\{/);
  assert.match(scssSource, /width:\s*32px;/);
  assert.match(scssSource, /height:\s*32px;/);
  assert.match(scssSource, /border-radius:\s*4px;/);
  assert.match(scssSource, /\.player-ability-selection-decline-toggle\.is-declined\s*\{/);
  assert.match(scssSource, /\.player-ability-selection-card\.is-declined\s+\.player-ability-selection-card-select\s*\{/);
});

test('legacy pending offers stay unprompted on a read-only poll and gain explicit drafts only when requested', async () => {
  const source = extractFunction(fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8'), 'resolvePlayerAbilitySelectionState');
  const options = [{ id: 'a', name: 'Alpha', level: 2 }, { id: 'b', name: 'Bravo', level: 2 }];
  let drafts = [], preparations = 0;
  const character = {
    isNPC: false,
    getPendingAbilityOptionsByLevel: () => ({ 2: structuredClone(options) }),
    getPendingAbilityOptionsForLevel: () => structuredClone(options),
    getPendingAbilityAttachmentDraftsForLevel: () => structuredClone(drafts),
    setPendingAbilityAttachmentDraftsForLevel: (_level, value) => { drafts = structuredClone(value); },
    clearPendingAbilityOptionsForLevel: () => { throw new Error('unexpected clear'); },
    clearPendingAbilityOptions: () => { throw new Error('unexpected clear'); }
  };
  const resolve = new Function('requirePlayerAbilitySelectionMethods', 'resolvePlayerAbilitySelectionConfig',
    'resolveCharacterLevelForAbilitySelection', 'resolvePlayerMissingAbilityLevels', 'normalizePendingAbilityLevelKey',
    'ensureUniqueAbilityNames', 'getCharacterAbilities', 'generatePlayerAbilityOptionsForLevel',
    'preparePendingPlayerAbilityAttachmentDrafts', 'randomUUID', `${source.startsWith('async ') ? source : `async ${source}`}; return resolvePlayerAbilitySelectionState;`)(
    () => {}, () => ({ optionsPerLevel: 2, requiredPerLevel: 1 }), () => 2,
    () => [{ level: 2, existingAbilities: [] }], Number, () => {}, () => [],
    async () => { throw new Error('unexpected option generation'); },
    async (_character, _level, offered) => { preparations += 1; return offered.map(option => ({ abilityId: option.id, draft: { statusEffects: [] } })); },
    () => 'unused');
  const poll = await resolve(character, { ensureOptionsForNext: false });
  assert.equal(preparations, 0);
  assert.equal(poll.selection.optionsReady, false);
  assert.deepEqual(drafts, []);
  const enriched = await resolve(character, { ensureOptionsForNext: true });
  assert.equal(preparations, 1);
  assert.equal(enriched.selection.optionsReady, true);
  assert.deepEqual(enriched.selection.options.map(option => option.attachmentDraft), [{ statusEffects: [] }, { statusEffects: [] }]);
  await resolve(character, { ensureOptionsForNext: true });
  assert.equal(preparations, 1);
});

test('acceptance passes only selected saved drafts to attachment commit without retaining preview DTOs', async () => {
  const source = extractFunction(fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8'), 'applyPlayerAbilitySelection');
  const options = [
    { id: 'a', name: 'Alpha', level: 2, attachmentDraft: { statusEffects: [{ id: 'status-a', name: 'Ward', duration: -1 }] } },
    { id: 'b', name: 'Bravo', level: 2, attachmentDraft: { statusEffects: [{ id: 'status-b', name: 'Guard', duration: -1 }] } }
  ];
  const state = { abilities: [], declined: [], pending: { 2: options }, drafts: { 2: options.map(option => ({ abilityId: option.id, draft: option.attachmentDraft })) } };
  const actor = {
    isNPC: false, health: 10,
    getAbilities: () => structuredClone(state.abilities), setAbilities: value => { state.abilities = structuredClone(value); },
    getDeclinedAbilities: () => structuredClone(state.declined), setDeclinedAbilities: value => { state.declined = structuredClone(value); },
    addDeclinedAbilities: value => { state.declined.push(...structuredClone(value)); }, setHealth: value => { actor.health = value; },
    getPendingAbilityOptionsByLevel: () => structuredClone(state.pending), getPendingAbilityAttachmentDraftsByLevel: () => structuredClone(state.drafts),
    clearPendingAbilityOptionsForLevel: level => { delete state.pending[level]; delete state.drafts[level]; },
    clearPendingAbilityOptions: () => { state.pending = {}; state.drafts = {}; },
    setPendingAbilityOptionsForLevel: (level, value) => { state.pending[level] = structuredClone(value); },
    setPendingAbilityAttachmentDraftsForLevel: (level, value) => { state.drafts[level] = structuredClone(value); }
  };
  let calls = 0, committed;
  const apply = new Function('resolvePlayerAbilitySelectionState', 'ensureUniqueAbilityNames', 'getCharacterAbilities',
    'sortAbilitiesByLevelAndName', 'normalizeAbilityNameForLookup', 'authorNewAbilityAttachments', 'config', 'getActiveSettingSnapshot',
    `${source.startsWith('async ') ? source : `async ${source}`}; return applyPlayerAbilitySelection;`)(
    async () => ++calls === 1 ? { pending: true, selection: { level: 2, requiredSelections: 1, optionsReady: true, options } } : { pending: false },
    () => {}, target => target.getAbilities(), value => value, name => name.trim().toLowerCase(),
    async value => { committed = value; }, {}, () => ({}));
  await apply(actor, { level: 2, selectedAbilityNames: ['Alpha'], declinedAbilityNames: ['Bravo'] });
  assert.deepEqual(committed.abilityIds, ['a']);
  assert.deepEqual(committed.draftsByAbilityId, { a: options[0].attachmentDraft });
  assert.equal('attachmentDraft' in state.abilities[0], false);
  assert.equal('attachmentDraft' in state.declined[0], false);
});
