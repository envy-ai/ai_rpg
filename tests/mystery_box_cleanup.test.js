const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const nunjucks = require('nunjucks');

const Events = require('../Events.js');
const IdGenerator = require('../IdGenerator.js');
const MysteryBox = require('../MysteryBox.js');
const MysteryThread = require('../MysteryThread.js');
const { addEvalFilter } = require('../nunjucks_filters.js');

const rootDir = path.join(__dirname, '..');
const defaultConfigSource = fs.readFileSync(path.join(rootDir, 'config.default.yaml'), 'utf8');
const serverSource = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
const defaultConfig = yaml.load(defaultConfigSource);

function createPromptEnv() {
  const env = nunjucks.configure(path.join(rootDir, 'prompts'), {
    autoescape: false,
    throwOnUndefined: true
  });
  addEvalFilter(env);
  return env;
}

test('default config defines mystery box cleanup interval and server validates it', () => {
  assert.equal(defaultConfig.mystery_box_cleanup?.interval, 10);
  assert.match(defaultConfigSource, /mystery_box_cleanup:[\s\S]*?interval:\s*10\b/);
  assert.match(serverSource, /mystery_box_cleanup must be an object when provided/);
  assert.match(serverSource, /mystery_box_cleanup\.interval must be an integer greater than or equal to 1 when provided/);
});

test('mystery box cleanup scheduler uses interval gate and persisted counter hooks', () => {
  assert.match(apiSource, /function resolveMysteryBoxCleanupInterval\(\)/);
  assert.match(apiSource, /function shouldRunMysteryBoxCleanupThisTurn\(\)/);
  assert.match(apiSource, /mysteryBoxCleanupTurnCounter\s*\+=\s*1/);
  assert.match(apiSource, /mysteryBoxCleanupTurnCounter\s*%\s*interval\s*===\s*0/);
  assert.match(apiSource, /scheduleMysteryBoxCleanupPrompt\(/);
  assert.match(apiSource, /metadata\.mysteryBoxCleanupTurnCounter/);
});

test('mystery box cleanup parser reads thread and box decisions with thoughts', () => {
  const parsed = Events._parseMysteryBoxCleanupResponse(`
Step 1: Reviewed the mysteries.
<mysteryThreads>
  <mysteryThread>
    <id>mthread_1</id>
    <thoughts>The culprit confessed, and no hidden facts remain needed for this thread.</thoughts>
    <resolved>true</resolved>
    <mysteryBoxes>
      <mysteryBox>
        <id>mystery_1</id>
        <thoughts>The protocol phrase is now public story knowledge.</thoughts>
        <revealed>true</revealed>
      </mysteryBox>
      <mysteryBox>
        <id>mystery_2</id>
        <thoughts>The witness is still unidentified.</thoughts>
        <revealed>false</revealed>
      </mysteryBox>
    </mysteryBoxes>
  </mysteryThread>
</mysteryThreads>`);

  assert.deepEqual(parsed.threads, [
    {
      id: 'mthread_1',
      thoughts: 'The culprit confessed, and no hidden facts remain needed for this thread.',
      resolved: true,
      boxes: [
        {
          id: 'mystery_1',
          thoughts: 'The protocol phrase is now public story knowledge.',
          revealed: true
        },
        {
          id: 'mystery_2',
          thoughts: 'The witness is still unidentified.',
          revealed: false
        }
      ]
    }
  ]);
});

test('mystery box cleanup applies resolved threads and revealed boxes by id', () => {
  IdGenerator.reset();
  MysteryBox.clear();
  MysteryThread.clear();

  const revealedBox = new MysteryBox({
    name: 'ELLISON-SEVEN',
    text: 'The private protocol phrase.'
  });
  const unresolvedBox = new MysteryBox({
    name: 'Omega Witness',
    text: 'The witness remains unknown.'
  });
  const thread = new MysteryThread({
    name: 'Ellison Conspiracy',
    status: 'active',
    summary: 'Ellison and a witness are tied to the protocol.',
    boxIds: [revealedBox.id, unresolvedBox.id]
  });

  const result = Events._applyMysteryBoxCleanupResult({
    threads: [
      {
        id: thread.id,
        thoughts: 'Ellison confessed, resolving the thread.',
        resolved: true,
        boxes: [
          {
            id: revealedBox.id,
            thoughts: 'The protocol is revealed.',
            revealed: true
          },
          {
            id: unresolvedBox.id,
            thoughts: 'The witness is still hidden.',
            revealed: false
          }
        ]
      }
    ]
  });

  assert.equal(thread.status, 'inactive');
  assert.equal(revealedBox.resolved, true);
  assert.equal(unresolvedBox.resolved, false);
  assert.deepEqual(result.resolvedThreads, [
    {
      id: thread.id,
      name: 'Ellison Conspiracy',
      thoughts: 'Ellison confessed, resolving the thread.'
    }
  ]);
  assert.deepEqual(result.resolvedBoxes, [
    {
      id: revealedBox.id,
      name: 'ELLISON-SEVEN',
      thoughts: 'The protocol is revealed.',
      threadId: thread.id,
      threadName: 'Ellison Conspiracy'
    }
  ]);

  MysteryBox.clear();
  MysteryThread.clear();
});

test('mystery box cleanup summarizes resolved decisions from prompt candidates', () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  let result;
  try {
    result = Events._summarizeMysteryBoxCleanupDecisions({
      threads: [
        {
          id: 'mthread_1',
          thoughts: 'The thread still has one unresolved political implication.',
          resolved: false,
          boxes: [
            {
              id: 'mystery_1',
              thoughts: 'The note itself was fully shown to the player.',
              revealed: true
            },
            {
              id: 'mystery_2',
              thoughts: 'This one remains hidden.',
              revealed: false
            },
            {
              id: 'mystery_missing',
              thoughts: 'The model should not have invented this.',
              revealed: true
            }
          ]
        },
        {
          id: 'mthread_2',
          thoughts: 'This thread is fully resolved.',
          resolved: true,
          boxes: []
        }
      ]
    }, [
      {
        id: 'mthread_1',
        name: 'Verdant Scales Coalition Claim',
        mysteryBoxes: [
          { id: 'mystery_1', name: "Harka's Foundation Resin Note" },
          { id: 'mystery_2', name: 'Pemphra Concealment' }
        ]
      },
      {
        id: 'mthread_2',
        name: 'North Moss Trail Night Hazard',
        mysteryBoxes: []
      }
    ]);
  } finally {
    console.warn = originalWarn;
  }

  assert.deepEqual(result.resolvedThreads, [
    {
      id: 'mthread_2',
      name: 'North Moss Trail Night Hazard',
      thoughts: 'This thread is fully resolved.'
    }
  ]);
  assert.deepEqual(result.resolvedBoxes, [
    {
      id: 'mystery_1',
      name: "Harka's Foundation Resin Note",
      thoughts: 'The note itself was fully shown to the player.',
      threadId: 'mthread_1',
      threadName: 'Verdant Scales Coalition Claim'
    }
  ]);
});

test('mystery box cleanup include renders explicit thread and unresolved box ids', () => {
  const promptEnv = createPromptEnv();
  const rendered = promptEnv.render('_includes/mystery_box_cleanup.njk', {
    mysteryCleanupThreads: [
      {
        id: 'mthread_1',
        name: 'Ellison Conspiracy',
        status: 'active',
        summary: 'Ellison used the protocol.',
        constraints: ['ELLISON-SEVEN belongs to Ellison.'],
        mysteryBoxes: [
          {
            id: 'mystery_1',
            name: 'ELLISON-SEVEN',
            keys: ['protocol phrase'],
            text: 'Ellison used the phrase as a private proof.'
          }
        ]
      }
    ]
  });

  assert.match(rendered, /mthread_1/);
  assert.match(rendered, /Ellison Conspiracy/);
  assert.match(rendered, /mystery_1/);
  assert.match(rendered, /ELLISON-SEVEN/);
  assert.match(rendered, /Ellison used the phrase as a private proof\./);
});
