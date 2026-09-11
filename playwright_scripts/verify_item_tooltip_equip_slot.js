const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright');

const rootDir = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(rootDir, 'public', 'css', 'main.css'), 'utf8');
const artifactDir = path.join(rootDir, 'tmp');

function loadTooltipFormatter() {
  const source = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
  const start = source.indexOf('const formatThingTooltip = (thing = {}) => {');
  const end = source.indexOf('const formatThingTooltipWithCompatibleEquipped =', start);
  if (start < 0 || end < 0) throw new Error('Could not extract formatThingTooltip.');
  const context = {
    Number,
    String,
    Array,
    normalizeThingType: thing => thing?.thingType || thing?.type || 'item',
    capitalize: value => String(value).charAt(0).toUpperCase() + String(value).slice(1),
    escapeHtml: value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]),
    getRarityClass: () => '',
    isEquippableThing: thing => Boolean(thing?.slot || thing?.metadata?.slot),
    resolveThingSlotType: thing => String(thing?.slot || thing?.metadata?.slot || '').trim().toLowerCase(),
    formatSlotTypeLabel: value => String(value).replace(/\b\w/g, letter => letter.toUpperCase()),
    isWeaponThing: () => false,
    getMinimumUnmitigatedWeaponDamage: () => 0,
    formatInstalledModulesTooltipSection: () => '',
    getAttributeBonuses: () => [],
    formatAttributeName: value => String(value),
    formatDetailValue: value => String(value),
    formatStatusEffectDuration: () => ''
  };
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end)}\nthis.formatThingTooltip = formatThingTooltip;`, context);
  return context.formatThingTooltip;
}

const formatThingTooltip = loadTooltipFormatter();
const tooltip = ({ id, thing, long = false }) => `<div id="${id}" class="${long ? 'fixture-narrow' : ''}">${formatThingTooltip(thing)}</div>`;

async function inspect(page, viewport, screenshotName) {
  await page.setViewportSize(viewport);
  await page.setContent(`<!doctype html><html><head><style>${css}
    body { padding: 24px; background: #111827; }
    .fixture-stack { display: grid; gap: 18px; width: min(80vw, 470px); }
    .fixture-narrow { max-width: 180px; }
  </style></head><body><main class="fixture-stack">
    ${tooltip({ id: 'equippable', thing: { name: 'Astral Locket', thingType: 'item', level: 7, slot: 'accessory', rarity: 'Rare', description: 'A representative tooltip description.' } })}
    ${tooltip({ id: 'non-equippable', thing: { name: 'Canal Stone', thingType: 'scenery', level: 2, slot: 'accessory', description: 'A decorative stone.' } })}
    ${tooltip({ id: 'narrow', long: true, thing: { name: 'Astral Locket of the Long-Lived Cartographer', thingType: 'item', level: 7, slot: 'very long accessory slot', rarity: 'Rare', description: 'A representative tooltip description.' } })}
  </main></body></html>`);
  const result = await page.evaluate(() => {
    const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
    const equippable = document.querySelector('#equippable');
    const nonEquippable = document.querySelector('#non-equippable');
    const narrow = document.querySelector('#narrow');
    const level = equippable.querySelector('.tooltip-thing-level');
    const slot = equippable.querySelector('.tooltip-thing-equip-slot');
    const narrowLevel = narrow.querySelector('.tooltip-thing-level');
    const narrowSlot = narrow.querySelector('.tooltip-thing-equip-slot');
    return {
      equipText: slot?.textContent?.trim(),
      nonEquipSlotCount: nonEquippable.querySelectorAll('.tooltip-thing-equip-slot').length,
      desktopOrMobileRow: { level: rect('#equippable .tooltip-thing-level'), slot: rect('#equippable .tooltip-thing-equip-slot') },
      narrowWrapped: narrowSlot.getBoundingClientRect().top > narrowLevel.getBoundingClientRect().top,
      narrowFits: narrow.scrollWidth <= narrow.clientWidth,
      rowDisplay: getComputedStyle(equippable.querySelector('.tooltip-thing-level-slot-row')).display,
      rowWrap: getComputedStyle(equippable.querySelector('.tooltip-thing-level-slot-row')).flexWrap
    };
  });
  if (result.equipText !== 'Equip slot: Accessory') throw new Error(`Unexpected slot badge: ${result.equipText}`);
  if (result.nonEquipSlotCount !== 0) throw new Error('Non-equippable fixture rendered an equipment badge.');
  if (result.rowDisplay !== 'flex' || result.rowWrap !== 'wrap') throw new Error(`Unexpected row layout: ${result.rowDisplay}/${result.rowWrap}`);
  if (!result.narrowFits) throw new Error('Narrow tooltip overflows horizontally.');
  await page.screenshot({ path: path.join(artifactDir, screenshotName), fullPage: true });
  return result;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const desktop = await inspect(page, { width: 1280, height: 720 }, 'item-tooltip-equip-slot-desktop.png');
    const mobile = await inspect(page, { width: 390, height: 844 }, 'item-tooltip-equip-slot-mobile.png');
    console.log(JSON.stringify({ desktop, mobile }));
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
