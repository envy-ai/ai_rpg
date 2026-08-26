'use strict';

function normalizeLocationWeatherExposure(value, fieldName = 'location hasWeather') {
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

function resolveExplicitLocationWeatherExposure(location) {
    if (!location || typeof location !== 'object') {
        return null;
    }
    const label = location.id || location.name || 'unknown';
    const details = typeof location.getDetails === 'function' ? location.getDetails() : location;
    const candidates = [
        [location.hasWeather, `location "${label}" hasWeather`],
        [details?.hasWeather, `location "${label}" details.hasWeather`],
        [location.stubMetadata?.hasWeather ?? details?.stubMetadata?.hasWeather, `location "${label}" stubMetadata.hasWeather`],
        [location.stubMetadata?.locationHasWeather ?? details?.stubMetadata?.locationHasWeather, `location "${label}" stubMetadata.locationHasWeather`],
        [location.generationHints?.hasWeather ?? details?.generationHints?.hasWeather, `location "${label}" generationHints.hasWeather`]
    ];
    for (const [value, fieldName] of candidates) {
        const normalized = normalizeLocationWeatherExposure(value, fieldName);
        if (normalized) {
            return normalized;
        }
    }
    return null;
}

function normalizePlaceName(value) {
    return typeof value === 'string'
        ? value.trim().toLowerCase().replace(/\s+/g, ' ')
        : '';
}

function resolveEffectiveLocationWeatherExposure(location, { region = null } = {}) {
    const explicit = resolveExplicitLocationWeatherExposure(location);
    if (explicit) {
        return explicit;
    }

    const locationName = normalizePlaceName(location?.name);
    const regionName = normalizePlaceName(region?.name || location?.region?.name);
    if (locationName.endsWith(' exterior')) {
        return 'yes';
    }
    if (locationName.endsWith(' interior') || regionName.endsWith(' interior')) {
        return 'no';
    }
    return 'yes';
}

module.exports = {
    normalizeLocationWeatherExposure,
    resolveExplicitLocationWeatherExposure,
    resolveEffectiveLocationWeatherExposure
};
