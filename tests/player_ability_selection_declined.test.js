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
  assert.match(generateSource, /for \(const rawName of \[\.\.\.excludedAbilityNames, \.\.\.declinedAbilityNames\]\)/);
  assert.match(generateSource, /declinedAbilityNames/);
  assert.match(
    generateSource,
    /resolveConfiguredPromptMaxAttempts\(config\?\.ai,\s*\{\s*fallbackMaxAttempts:\s*3\s*\}\)/,
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
  assert.match(applySource, /return await resolvePlayerAbilitySelectionState\(character,\s*\{\s*ensureOptionsForNext:\s*true/);
  assert.match(applySource, /character\.setAbilities\(mutationSnapshot\.abilities\)/);
  assert.match(applySource, /character\.setDeclinedAbilities\(mutationSnapshot\.declinedAbilities\)/);
  assert.match(applySource, /character\.clearPendingAbilityOptions\(\)/);
  assert.match(applySource, /character\.setPendingAbilityOptionsForLevel\(pendingLevel, pendingAbilities\)/);
});

test('player ability selection restores abilities, declines, and drafts when next-level generation fails', async () => {
  const applySource = extractFunction(serverSource, 'applyPlayerAbilitySelection');
  const options = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'].map(name => ({
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
    }
  };
  const initialState = structuredClone(state);
  const character = {
    isNPC: false,
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
    clearPendingAbilityOptionsForLevel: level => {
      delete state.pending[level];
    },
    clearPendingAbilityOptions: () => {
      state.pending = {};
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
    name => (typeof name === 'string' ? name.trim().toLowerCase() : '')
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
