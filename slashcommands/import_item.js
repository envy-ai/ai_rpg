const SlashCommandBase = require('../SlashCommandBase.js');
const Player = require('../Player.js');
const Location = require('../Location.js');
const Thing = require('../Thing.js');

function sanitizeMetadata(meta = {}) {
  const cleaned = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === 'string' && !value.trim()) {
      continue;
    }
    cleaned[key] = value;
  }
  return cleaned;
}

function normalizeThingType(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized === 'scenery' ? 'scenery' : 'item';
}

function combineCauseStatusEffects(itemData = {}) {
  const entries = [];
  if (itemData.causeStatusEffectOnTarget && typeof itemData.causeStatusEffectOnTarget === 'object') {
    entries.push({
      ...itemData.causeStatusEffectOnTarget,
      applyToTarget: true
    });
  }
  if (itemData.causeStatusEffectOnEquipper && typeof itemData.causeStatusEffectOnEquipper === 'object') {
    entries.push({
      ...itemData.causeStatusEffectOnEquipper,
      applyToEquipper: true
    });
  }
  if (!entries.length && itemData.causeStatusEffect && typeof itemData.causeStatusEffect === 'object') {
    entries.push(itemData.causeStatusEffect);
  }
  return entries.length ? entries : null;
}

function resolveInvokingPlayer(interaction) {
  const invokingPlayerId = typeof interaction?.user?.id === 'string'
    ? interaction.user.id.trim()
    : '';
  if (invokingPlayerId) {
    const indexedPlayer = Player.getById(invokingPlayerId);
    if (indexedPlayer) {
      return indexedPlayer;
    }
  }

  if (interaction?.currentPlayer && typeof interaction.currentPlayer === 'object') {
    return interaction.currentPlayer;
  }

  throw new Error('Cannot import items: no active invoking player was found.');
}

function resolvePlayerLocation(player) {
  const locationId = typeof player?.currentLocation === 'string'
    ? player.currentLocation.trim()
    : '';
  if (!locationId) {
    throw new Error('Cannot import items: invoking player has no current location.');
  }

  const location = Location.get(locationId);
  if (!location) {
    throw new Error(`Cannot import items: current location '${locationId}' was not found.`);
  }
  return location;
}

function resolveImportedThingLevel(itemData, args = {}, location) {
  if (Object.prototype.hasOwnProperty.call(args, 'level') && args.level !== undefined && args.level !== null) {
    return args.level;
  }

  if (!Number.isFinite(location?.baseLevel)) {
    throw new Error('Cannot import items: current location has no valid base level.');
  }

  const relativeLevel = Number.isFinite(itemData?.relativeLevel) ? itemData.relativeLevel : 0;
  return location.baseLevel + relativeLevel;
}

function createImportedThing(itemData, location, absoluteLevel) {
  if (!itemData || typeof itemData !== 'object') {
    throw new Error('Cannot import malformed item entry.');
  }

  const thingType = normalizeThingType(itemData.itemOrScenery || itemData.thingType);
  const attributeBonuses = Array.isArray(itemData.attributeBonuses)
    ? itemData.attributeBonuses.filter(entry => entry && typeof entry === 'object')
    : [];
  const metadata = sanitizeMetadata({
    locationId: location.id,
    locationName: location.name || location.id,
    rarity: itemData.rarity || null,
    itemType: itemData.type || null,
    value: itemData.value ?? null,
    weight: itemData.weight ?? null,
    properties: itemData.properties || null,
    slot: itemData.slot || null,
    attributeBonuses: attributeBonuses.length ? attributeBonuses : null,
    causeStatusEffectOnTarget: itemData.causeStatusEffectOnTarget || null,
    causeStatusEffectOnEquipper: itemData.causeStatusEffectOnEquipper || null,
    level: absoluteLevel,
    isVehicle: itemData.isVehicle === true,
    isCraftingStation: itemData.isCraftingStation === true,
    isProcessingStation: itemData.isProcessingStation === true,
    isHarvestable: itemData.isHarvestable === true,
    isSalvageable: itemData.isSalvageable === true
  });

  return new Thing({
    name: itemData.name,
    description: itemData.description
      || (thingType === 'scenery' ? 'Imported scenery.' : 'Imported item.'),
    shortDescription: itemData.shortDescription ?? null,
    thingType,
    rarity: itemData.rarity || null,
    itemTypeDetail: itemData.type || null,
    slot: itemData.slot || null,
    attributeBonuses: thingType === 'item' ? attributeBonuses : [],
    causeStatusEffect: combineCauseStatusEffects(itemData),
    count: itemData.count,
    level: absoluteLevel,
    relativeLevel: null,
    metadata,
    isVehicle: itemData.isVehicle === true,
    isCraftingStation: itemData.isCraftingStation === true,
    isProcessingStation: itemData.isProcessingStation === true,
    isHarvestable: itemData.isHarvestable === true,
    isSalvageable: itemData.isSalvageable === true
  });
}

class ImportItemCommand extends SlashCommandBase {
  static get name() {
    return 'import_item';
  }

  static get description() {
    return 'Upload XML and import all parsed item/scenery entries into your current location, with an optional absolute item level.';
  }

  static get showExecutionOverlay() {
    return false;
  }

  static get args() {
    return [
      { name: 'level', type: 'integer', required: false }
    ];
  }

  static validateArgs(providedArgs = {}) {
    const errors = super.validateArgs(providedArgs);
    if (Object.prototype.hasOwnProperty.call(providedArgs, 'level')) {
      const level = providedArgs.level;
      if (!Number.isInteger(level) || level < 1) {
        errors.push('Argument "level" must be a positive integer.');
      }
    }
    return errors;
  }

  static async execute(interaction, args = {}) {
    const levelHint = Object.prototype.hasOwnProperty.call(args, 'level')
      ? ` Imported entries will use level ${args.level}.`
      : ' Imported entries will use the current location level plus any XML relativeLevel adjustment.';
    await interaction.reply({
      content: `Choose one or more XML files to import item, thing, or scenery entries into your current location.${levelHint}`,
      ephemeral: false,
      action: {
        type: 'request_file_upload',
        title: 'Import XML Items',
        description: 'Upload XML containing <item>, <thing>, or <scenery> entries. Every parsed entry will be placed in your current location and assigned either the explicit slash-command level or the current location level plus XML relativeLevel.',
        accept: '.xml,text/xml,application/xml',
        multiple: true,
        uploadMessage: 'Importing XML items...'
      }
    });
  }

  static async handleUpload(interaction, args = {}, uploads = []) {
    if (typeof interaction?.parseThingsXml !== 'function') {
      throw new Error('Item XML parser is unavailable in the slash command context.');
    }
    if (!Array.isArray(uploads) || !uploads.length) {
      throw new Error('No uploaded XML files were provided.');
    }

    const player = resolveInvokingPlayer(interaction);
    const location = resolvePlayerLocation(player);
    const parsedByFile = [];

    for (const upload of uploads) {
      const parsedEntries = await interaction.parseThingsXml(upload.content, {
        isInventory: false
      });
      if (!Array.isArray(parsedEntries) || !parsedEntries.length) {
        throw new Error(`Uploaded file "${upload.filename}" did not contain any importable <item>, <thing>, or <scenery> entries.`);
      }
      parsedByFile.push({
        filename: upload.filename,
        entries: parsedEntries
      });
    }

    const thingRegistry = interaction?.thingRegistry instanceof Map
      ? interaction.thingRegistry
      : null;
    if (!thingRegistry) {
      throw new Error('Thing registry is unavailable in the slash command context.');
    }

    const createdThings = [];
    for (const fileResult of parsedByFile) {
      for (const itemData of fileResult.entries) {
        const absoluteLevel = resolveImportedThingLevel(itemData, args, location);
        const thing = createImportedThing(itemData, location, absoluteLevel);
        thingRegistry.set(thing.id, thing);
        location.addThingId(thing.id);
        createdThings.push(thing);
      }
    }

    const importedNames = createdThings
      .map(thing => thing?.name)
      .filter(name => typeof name === 'string' && name.trim())
      .join(', ');
    const perFileSummary = parsedByFile
      .map(result => `${result.filename}: ${result.entries.length}`)
      .join('; ');
    const levelSummary = Object.prototype.hasOwnProperty.call(args, 'level')
      ? `at level ${args.level}`
      : `using location base level ${location.baseLevel} with XML relativeLevel adjustments`;

    await interaction.reply({
      content: `Imported ${createdThings.length} entr${createdThings.length === 1 ? 'y' : 'ies'} into ${location.name || location.id} ${levelSummary}. Files: ${perFileSummary}.${importedNames ? ` Entries: ${importedNames}` : ''}`,
      ephemeral: false
    });
  }
}

module.exports = ImportItemCommand;
