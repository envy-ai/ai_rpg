'use strict';

/**
 * Shared helpers for the Location and Region classes. Both classes keep their
 * private fields, timestamp conventions (Date object vs ISO string), and small
 * behavioral deltas (return values, region propagation); these helpers only
 * share the identical validation/normalization/list logic, parameterized by
 * the class label used in error messages.
 */

const VehicleInfo = require('./VehicleInfo.js');

function normalizeWeatherExposure(value, fieldName) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    if (typeof value === 'boolean') {
        return value ? 'yes' : 'no';
    }
    if (typeof value === 'string') {
        const lowered = value.trim().toLowerCase();
        if (!lowered) {
            return null;
        }
        if (['true', '1', 'yes'].includes(lowered)) {
            return 'yes';
        }
        if (['false', '0', 'no'].includes(lowered)) {
            return 'no';
        }
        if (lowered === 'sheltered' || lowered === 'outside') {
            return 'sheltered';
        }
    }
    throw new Error(`${fieldName} must be "yes", "no", "sheltered", true, false, or null (legacy "outside" is also accepted).`);
}

function normalizeVehicleInfo(vehicleInfo = null, label) {
    if (vehicleInfo === null || vehicleInfo === undefined) {
        return null;
    }
    if (vehicleInfo instanceof VehicleInfo) {
        return VehicleInfo.fromJSON(vehicleInfo.toJSON());
    }
    if (typeof vehicleInfo !== 'object' || Array.isArray(vehicleInfo)) {
        throw new Error(`${label} vehicleInfo must be an object, VehicleInfo instance, or null`);
    }
    return VehicleInfo.fromJSON(vehicleInfo);
}

/**
 * Validate a lastVisitedTime assignment. Returns null or a non-negative
 * number; throws with the class-specific message otherwise.
 */
function coerceLastVisitedTime(value, label) {
    if (value === null || value === undefined) {
        return null;
    }
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) {
        throw new Error(`${label} lastVisitedTime must be a non-negative number or null`);
    }
    return num;
}

function minutesSinceLastVisit(lastVisitedTime, currentTime = null, label) {
    if (lastVisitedTime === null) {
        return null;
    }
    let referenceTime;
    if (currentTime === null || currentTime === undefined) {
        const Globals = require('./Globals.js');
        referenceTime = Globals.elapsedTime;
    } else {
        referenceTime = Number(currentTime);
    }
    if (!Number.isFinite(referenceTime)) {
        throw new Error(`${label} minutesSinceLastVisit reference time must be a finite number`);
    }
    return referenceTime - lastVisitedTime;
}

/**
 * Append a random event string to the list. Returns true when appended.
 */
function pushRandomEvent(list, event) {
    if (typeof event !== 'string') {
        return false;
    }
    const trimmed = event.trim();
    if (!trimmed) {
        return false;
    }
    list.push(trimmed);
    return true;
}

/**
 * Remove a random event by integer index or exact (trimmed) string match.
 * Returns true when an entry was removed.
 */
function removeRandomEvent(list, event) {
    if (!event) {
        return false;
    }

    if (typeof event === 'number' && Number.isInteger(event)) {
        if (event >= 0 && event < list.length) {
            list.splice(event, 1);
            return true;
        }
        return false;
    }
    if (typeof event === 'string') {
        const trimmed = event.trim();
        const index = list.findIndex(entry => entry === trimmed);
        if (index !== -1) {
            list.splice(index, 1);
            return true;
        }
    }
    return false;
}

/**
 * Shared copy semantics for characterConcepts/enemyConcepts accessors.
 */
function copyConceptList(list) {
    return [...list];
}

function normalizeConceptList(concepts) {
    return Array.isArray(concepts) ? [...concepts] : [];
}

module.exports = {
    normalizeWeatherExposure,
    normalizeVehicleInfo,
    coerceLastVisitedTime,
    minutesSinceLastVisit,
    pushRandomEvent,
    removeRandomEvent,
    copyConceptList,
    normalizeConceptList
};
