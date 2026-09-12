'use strict';

const path = require('path');
const { loadMergedDefinitionFile } = require('./DefinitionLoader.js');
const Utils = require('./Utils.js');
const Region = require('./Region.js');

const STANDING_KEYS = [
  'dislikes_below',
  'unfriendly_below',
  'hostile_below',
  'severe_enemy_below',
  'extermination_below'
];

const FACTION_DANGER_MATRIX = Object.freeze([
  Object.freeze([1, 1, 1, 1, 1]),
  Object.freeze([1, 1, 1, 1, 2]),
  Object.freeze([1, 1, 2, 3, 4]),
  Object.freeze([1, 2, 3, 4, 5]),
  Object.freeze([1, 2, 4, 5, 5]),
  Object.freeze([1, 3, 4, 5, 5])
]);

function requirePlainObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`location_danger.yaml ${fieldName} must be an object.`);
  }
  return value;
}

function normalizeLegacyInteger(value, defaultValue, fieldName) {
  const resolved = value === null || value === undefined ? defaultValue : value;
  if (typeof resolved !== 'number' || !Number.isFinite(resolved) || !Number.isInteger(resolved)) {
    throw new Error(`${fieldName} must be a finite integer.`);
  }
  return resolved;
}

function validateLocationDangerDefinition(definition) {
  const root = requirePlainObject(definition, 'root');
  const rawThresholds = requirePlainObject(root.faction_standing_thresholds, 'faction_standing_thresholds');
  const thresholds = {};
  for (const key of STANDING_KEYS) {
    const value = rawThresholds[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`location_danger.yaml faction_standing_thresholds.${key} must be a finite number.`);
    }
    thresholds[key] = value;
  }
  for (let index = 1; index < STANDING_KEYS.length; index += 1) {
    if (!(thresholds[STANDING_KEYS[index - 1]] > thresholds[STANDING_KEYS[index]])) {
      throw new Error(`location_danger.yaml faction_standing_thresholds must satisfy ${STANDING_KEYS.join(' > ')}.`);
    }
  }

  const rawCurves = requirePlainObject(root.arrival_probability_by_rating, 'arrival_probability_by_rating');
  const arrivalProbabilityByRating = {};
  let previousCap = -Infinity;
  for (let rating = 1; rating <= 5; rating += 1) {
    const field = `arrival_probability_by_rating.${rating}`;
    const rawCurve = requirePlainObject(rawCurves[rating], field);
    const cap = rawCurve.cap;
    if (typeof cap !== 'number' || !Number.isFinite(cap) || cap < 0 || cap > 1) {
      throw new Error(`location_danger.yaml ${field}.cap must be a finite probability from 0 through 1.`);
    }
    if (rating === 1 && cap !== 0) {
      throw new Error(`location_danger.yaml ${field}.cap must be 0.`);
    }
    if (rating > 1 && !(cap > previousCap)) {
      throw new Error(`location_danger.yaml ${field}.cap must be greater than the preceding rating cap.`);
    }

    let halfLifeMinutes = null;
    if (rating === 1) {
      if (rawCurve.half_life !== null) {
        throw new Error(`location_danger.yaml ${field}.half_life must be null.`);
      }
    } else {
      try {
        halfLifeMinutes = Utils.parseDurationToMinutes(rawCurve.half_life, {
          fieldName: `location_danger.yaml ${field}.half_life`
        });
      } catch (error) {
        throw new Error(`location_danger.yaml ${field}.half_life is invalid: ${error.message}`);
      }
      if (!Number.isFinite(halfLifeMinutes) || halfLifeMinutes <= 0) {
        throw new Error(`location_danger.yaml ${field}.half_life must resolve to a positive duration.`);
      }
    }
    arrivalProbabilityByRating[rating] = Object.freeze({ halfLifeMinutes, cap });
    previousCap = cap;
  }

  return Object.freeze({
    factionStandingThresholds: Object.freeze(thresholds),
    arrivalProbabilityByRating: Object.freeze(arrivalProbabilityByRating)
  });
}

function loadLocationDangerDefinition({ baseDir = __dirname } = {}) {
  const { value } = loadMergedDefinitionFile({
    baseDir: path.resolve(baseDir),
    filename: 'location_danger.yaml'
  });
  return validateLocationDangerDefinition(value);
}

function resolveEffectiveLocationDanger(location) {
  if (!location || typeof location !== 'object') {
    throw new TypeError('resolveEffectiveLocationDanger requires a location object.');
  }
  const locationBaseDanger = normalizeLegacyInteger(location.dangerLevel, 1, 'Location dangerLevel');
  const region = location.region || (typeof location.regionId === 'string' ? Region.get(location.regionId) : null);
  const regionDangerModifier = normalizeLegacyInteger(region?.dangerModifier, 0, 'Region dangerModifier');
  const rawDangerLevel = locationBaseDanger + regionDangerModifier;
  const effectiveDangerLevel = Math.max(1, Math.min(5, rawDangerLevel));
  return {
    locationBaseDanger,
    regionId: region?.id || location.regionId || null,
    regionDangerModifier,
    rawDangerLevel,
    effectiveDangerLevel,
    wildContribution: effectiveDangerLevel - 1
  };
}

function resolveAntagonismBand(standing, thresholds) {
  const resolvedStanding = standing === null || standing === undefined ? 0 : standing;
  if (typeof resolvedStanding !== 'number' || !Number.isFinite(resolvedStanding)) {
    throw new Error('Faction standing must be a finite number or null.');
  }
  const values = thresholds || loadLocationDangerDefinition().factionStandingThresholds;
  if (resolvedStanding < values.extermination_below) return 5;
  if (resolvedStanding < values.severe_enemy_below) return 4;
  if (resolvedStanding < values.hostile_below) return 3;
  if (resolvedStanding < values.unfriendly_below) return 2;
  if (resolvedStanding < values.dislikes_below) return 1;
  return 0;
}

function resolveFactionDangerRating({ standing = null, violenceLevel = null, thresholds = null } = {}) {
  const violence = normalizeLegacyInteger(violenceLevel, 1, 'Faction violenceLevel');
  if (violence < 1 || violence > 5) {
    throw new Error('Faction violenceLevel must be an integer from 1 to 5.');
  }
  const antagonismBand = resolveAntagonismBand(standing, thresholds);
  const factionRating = FACTION_DANGER_MATRIX[antagonismBand][violence - 1];
  return { antagonismBand, violenceLevel: violence, factionRating, factionContribution: factionRating - 1 };
}

function calculateArrivalProbability(rating, elapsedMinutes, curves = null) {
  const normalizedRating = normalizeLegacyInteger(rating, 1, 'Effective danger rating');
  if (normalizedRating < 1 || normalizedRating > 5) {
    throw new Error('Effective danger rating must be an integer from 1 to 5.');
  }
  if (typeof elapsedMinutes !== 'number' || !Number.isFinite(elapsedMinutes) || elapsedMinutes < 0) {
    throw new Error('Elapsed absence minutes must be a finite non-negative number.');
  }
  const curve = (curves || loadLocationDangerDefinition().arrivalProbabilityByRating)[normalizedRating];
  if (normalizedRating === 1) return 0;
  return curve.cap * (1 - (2 ** (-elapsedMinutes / curve.halfLifeMinutes)));
}

function selectDangerSource({ wildRating, factionRating, random = Math.random } = {}) {
  const wildWeight = normalizeLegacyInteger(wildRating, 1, 'Wild danger rating') - 1;
  const factionWeight = normalizeLegacyInteger(factionRating, 1, 'Faction danger rating') - 1;
  if (wildWeight < 0 || factionWeight < 0) {
    throw new Error('Danger source weights cannot be negative.');
  }
  const totalWeight = wildWeight + factionWeight;
  if (totalWeight <= 0) return null;
  const roll = random();
  if (typeof roll !== 'number' || !Number.isFinite(roll) || roll < 0 || roll >= 1) {
    throw new Error('Danger source random value must be in [0, 1).');
  }
  return roll < (wildWeight / totalWeight) ? 'wild' : 'faction';
}

module.exports = {
  FACTION_DANGER_MATRIX,
  calculateArrivalProbability,
  loadLocationDangerDefinition,
  normalizeLegacyInteger,
  resolveAntagonismBand,
  resolveEffectiveLocationDanger,
  resolveFactionDangerRating,
  selectDangerSource,
  validateLocationDangerDefinition
};
