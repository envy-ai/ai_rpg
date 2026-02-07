const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = 'http://127.0.0.1:7777';

const topLevelScreens = [
  { name: 'chat_interface', url: `${BASE_URL}/` },
  { name: 'configuration', url: `${BASE_URL}/config` },
  { name: 'game_settings', url: `${BASE_URL}/settings` },
  { name: 'lorebooks', url: `${BASE_URL}/lorebooks` },
  { name: 'debug', url: `${BASE_URL}/debug` }
];

const chatSubTabs = [
  { name: 'chat_adventure', hash: '#tab-adventure' },
  { name: 'chat_map', hash: '#tab-map' },
  { name: 'chat_world_map', hash: '#tab-world-map' },
  { name: 'chat_character', hash: '#tab-character' },
  { name: 'chat_quests', hash: '#tab-quests' },
  { name: 'chat_factions', hash: '#tab-factions' },
  { name: 'chat_party', hash: '#tab-party' }
];

function makeOutputDir() {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const outputDir = path.join(process.cwd(), 'tmp', `major_screens_${stamp}`);
  fs.mkdirSync(outputDir, { recursive: true });
  return outputDir;
}

async function capture(page, label, url, outputDir) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1200);
  const target = path.join(outputDir, `${label}.png`);
  await page.screenshot({
    path: target,
    fullPage: false
  });
  return target;
}

async function run() {
  const outputDir = makeOutputDir();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 }
  });
  const page = await context.newPage();
  const outputs = [];

  try {
    for (const screen of topLevelScreens) {
      const saved = await capture(page, screen.name, screen.url, outputDir);
      outputs.push(saved);
      console.log(`Saved ${saved}`);
    }

    for (const tab of chatSubTabs) {
      const url = `${BASE_URL}/${tab.hash}`;
      const saved = await capture(page, tab.name, url, outputDir);
      outputs.push(saved);
      console.log(`Saved ${saved}`);
    }
  } finally {
    await context.close();
    await browser.close();
  }

  console.log(`\nCaptured ${outputs.length} screenshots in: ${outputDir}`);
}

run().catch(error => {
  console.error('Failed to capture major screens:', error);
  process.exitCode = 1;
});
