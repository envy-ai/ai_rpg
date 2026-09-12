const Utils = require('./Utils.js');

const DEFAULT_MINIMUM_REPUTATION = -80;
const DEFAULT_MAXIMUM_REPUTATION = 20;

function resolveInitialFactionStandingBounds(config = {}) {
  const bounds = config?.factions?.starting_reputation;
  if (bounds === undefined || bounds === null) {
    return { min: DEFAULT_MINIMUM_REPUTATION, max: DEFAULT_MAXIMUM_REPUTATION };
  }
  if (!bounds || typeof bounds !== 'object' || Array.isArray(bounds)) {
    throw new Error('factions.starting_reputation must be an object with integer min and max values.');
  }
  const min = bounds.min;
  const max = bounds.max;
  if (!Number.isInteger(min) || !Number.isFinite(min)) {
    throw new Error('factions.starting_reputation.min must be a finite integer.');
  }
  if (!Number.isInteger(max) || !Number.isFinite(max)) {
    throw new Error('factions.starting_reputation.max must be a finite integer.');
  }
  if (min > max) {
    throw new Error('factions.starting_reputation.min must be less than or equal to max.');
  }
  return { min, max };
}

function normalizeFactionEntries(factions) {
  const values = factions instanceof Map
    ? Array.from(factions.values())
    : (Array.isArray(factions) ? factions : null);
  if (!values) {
    throw new TypeError('Initial faction standings require factions as a Map or array.');
  }

  const seenIds = new Set();
  const seenNames = new Set();
  return values.map((faction, index) => {
    const id = typeof faction?.id === 'string' ? faction.id.trim() : '';
    const name = typeof faction?.name === 'string' ? faction.name.trim() : '';
    if (!id) {
      throw new Error(`Initial faction standings faction ${index + 1} is missing an id.`);
    }
    if (!name) {
      throw new Error(`Initial faction standings faction "${id}" is missing a name.`);
    }
    if (seenIds.has(id)) {
      throw new Error(`Initial faction standings received duplicate faction id "${id}".`);
    }
    const nameKey = name.toLowerCase();
    if (seenNames.has(nameKey)) {
      throw new Error(`Initial faction standings received duplicate faction name "${name}".`);
    }
    seenIds.add(id);
    seenNames.add(nameKey);
    return { id, name, faction };
  });
}

function getDirectChild(element, tagName) {
  return Array.from(element?.childNodes || []).find(node => (
    node?.nodeType === 1 && (node.tagName || node.nodeName) === tagName
  )) || null;
}

function getDirectChildText(element, tagName) {
  const child = getDirectChild(element, tagName);
  return typeof child?.textContent === 'string' ? child.textContent.trim() : '';
}

function parseInitialFactionStandingsXml(xmlContent, {
  factions,
  min = DEFAULT_MINIMUM_REPUTATION,
  max = DEFAULT_MAXIMUM_REPUTATION
} = {}) {
  if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
    throw new Error('Initial faction standing parser requires valid integer min/max bounds.');
  }
  if (typeof xmlContent !== 'string' || !xmlContent.trim()) {
    throw new Error('Initial faction standings response was empty.');
  }
  const expected = normalizeFactionEntries(factions);
  const expectedById = new Map(expected.map(entry => [entry.id, entry]));

  const doc = Utils.parseXmlDocumentStrict(xmlContent, 'text/xml');
  const parserError = doc.getElementsByTagName('parsererror')[0];
  if (parserError) {
    throw new Error(`Initial faction standings XML parsing error: ${parserError.textContent || 'unknown parser error'}`);
  }
  const root = doc.documentElement;
  if (!root || (root.tagName || root.nodeName) !== 'initialFactionStandings') {
    throw new Error('Initial faction standings response must contain exactly one <initialFactionStandings> root element.');
  }

  const rootChildren = Array.from(root.childNodes || []);
  for (const node of rootChildren) {
    if ((node?.nodeType === 3 || node?.nodeType === 4) && String(node.textContent || '').trim()) {
      const contentType = node.nodeType === 4 ? 'CDATA' : 'text';
      throw new Error(`Initial faction standings contains unexpected direct ${contentType} content outside <standing> elements.`);
    }
  }
  const standingNodes = rootChildren.filter(node => node?.nodeType === 1);
  for (const node of standingNodes) {
    if ((node.tagName || node.nodeName) !== 'standing') {
      throw new Error(`Initial faction standings contains unexpected <${node.tagName || node.nodeName}> element.`);
    }
  }

  const parsed = new Map();
  for (const node of standingNodes) {
    const allowedChildNames = new Set(['factionId', 'factionName', 'reputation']);
    const standingChildren = Array.from(node.childNodes || []);
    for (const child of standingChildren) {
      if ((child?.nodeType === 3 || child?.nodeType === 4) && String(child.textContent || '').trim()) {
        const contentType = child.nodeType === 4 ? 'CDATA' : 'text';
        throw new Error(`Initial faction standing contains unexpected direct ${contentType} content outside its required fields.`);
      }
    }
    const directChildren = standingChildren.filter(child => child?.nodeType === 1);
    for (const child of directChildren) {
      const childName = child.tagName || child.nodeName;
      if (!allowedChildNames.has(childName)) {
        throw new Error(`Initial faction standing contains unexpected <${childName}> element.`);
      }
    }
    for (const requiredChildName of allowedChildNames) {
      const count = directChildren.filter(child => (child.tagName || child.nodeName) === requiredChildName).length;
      if (count !== 1) {
        throw new Error(`Initial faction standing must contain exactly one <${requiredChildName}> element; found ${count}.`);
      }
    }
    const factionId = getDirectChildText(node, 'factionId');
    const factionName = getDirectChildText(node, 'factionName');
    const reputationText = getDirectChildText(node, 'reputation');
    if (!factionId) {
      throw new Error('Initial faction standing entry is missing <factionId>.');
    }
    if (!factionName) {
      throw new Error(`Initial faction standing for "${factionId}" is missing <factionName>.`);
    }
    if (parsed.has(factionId)) {
      throw new Error(`Initial faction standings contains duplicate entry for faction id "${factionId}".`);
    }
    const expectedFaction = expectedById.get(factionId);
    if (!expectedFaction) {
      throw new Error(`Initial faction standings references unknown faction id "${factionId}".`);
    }
    if (factionName !== expectedFaction.name) {
      throw new Error(
        `Initial faction standing faction name "${factionName}" does not match id "${factionId}" (expected "${expectedFaction.name}").`
      );
    }
    if (!/^-?(?:0|[1-9]\d*)$/.test(reputationText)) {
      throw new Error(`Initial faction standing for "${factionName}" <reputation> must be an integer from ${min} to ${max}.`);
    }
    const reputation = Number(reputationText);
    if (!Number.isInteger(reputation) || reputation < min || reputation > max) {
      throw new Error(`Initial faction standing for "${factionName}" <reputation> must be an integer from ${min} to ${max}.`);
    }
    parsed.set(factionId, reputation);
  }

  const missing = expected.filter(entry => !parsed.has(entry.id));
  if (missing.length) {
    throw new Error(`Initial faction standings is missing ${missing.map(entry => `"${entry.name}" (${entry.id})`).join(', ')}.`);
  }
  if (parsed.size !== expected.length) {
    throw new Error(`Initial faction standings returned ${parsed.size} entries, expected exactly ${expected.length}.`);
  }
  return parsed;
}

function applyInitialFactionStandings({
  player,
  factions,
  standings,
  min = DEFAULT_MINIMUM_REPUTATION,
  max = DEFAULT_MAXIMUM_REPUTATION
} = {}) {
  if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
    throw new Error('Applying initial faction standings requires valid integer min/max bounds.');
  }
  if (!player || typeof player.getFactionStandings !== 'function' || typeof player.setFactionStandings !== 'function') {
    throw new TypeError('Applying initial faction standings requires a player with faction-standing methods.');
  }
  const expected = normalizeFactionEntries(factions);
  if (!(standings instanceof Map)) {
    throw new TypeError('Applying initial faction standings requires a Map of generated standings.');
  }

  const generated = {};
  for (const entry of expected) {
    if (!standings.has(entry.id)) {
      throw new Error(`Generated initial faction standings is missing "${entry.name}" (${entry.id}).`);
    }
    const value = standings.get(entry.id);
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(`Generated initial standing for "${entry.name}" must be an integer from ${min} to ${max}.`);
    }
    generated[entry.id] = value;
  }
  if (standings.size !== expected.length) {
    throw new Error(`Generated initial faction standings has ${standings.size} entries, expected ${expected.length}.`);
  }

  const existing = player.getFactionStandings();
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
    throw new Error('Player faction standings must be an object.');
  }
  const merged = { ...existing };
  const applied = {};
  for (const entry of expected) {
    if (Object.prototype.hasOwnProperty.call(existing, entry.id)) {
      continue;
    }
    merged[entry.id] = generated[entry.id];
    applied[entry.id] = generated[entry.id];
  }

  // One validated write prevents a malformed response from partially mutating the player.
  player.setFactionStandings(merged);
  return { applied, preserved: { ...existing }, standings: merged };
}

module.exports = {
  DEFAULT_MINIMUM_REPUTATION,
  DEFAULT_MAXIMUM_REPUTATION,
  resolveInitialFactionStandingBounds,
  normalizeFactionEntries,
  parseInitialFactionStandingsXml,
  applyInitialFactionStandings
};
