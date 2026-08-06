const fs = require("fs");
const path = require("path");

let randomWordCache = null;

function addEvalFilter(env) {
    if (!env || typeof env.addFilter !== "function") {
        throw new Error("addEvalFilter requires a Nunjucks environment.");
    }
    if (typeof env.renderString !== "function") {
        throw new Error("addEvalFilter requires an environment with renderString.");
    }

    env.addFilter("eval", function (str, locals = undefined) {
        const template = str === undefined || str === null ? "" : String(str);
        const baseContext = this && this.ctx && typeof this.ctx === "object"
            ? this.ctx
            : {};

        if (locals !== undefined && (locals === null || typeof locals !== "object")) {
            throw new Error("eval filter locals must be an object when provided.");
        }

        const renderContext = locals === undefined
            ? baseContext
            : { ...baseContext, ...locals };

        return env.renderString(template, renderContext);
    });
}

function loadRandomWords() {
    if (randomWordCache) {
        return randomWordCache;
    }

    const wordsPath = path.join(__dirname, "data", "words.txt");
    const fileContent = fs.readFileSync(wordsPath, "utf8");
    const words = fileContent
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

    if (words.length === 0) {
        throw new Error(`Random word list is empty: ${wordsPath}`);
    }

    randomWordCache = words;
    return randomWordCache;
}

function addRandomWordGlobal(env) {
    if (!env || typeof env.addGlobal !== "function") {
        throw new Error("addRandomWordGlobal requires a Nunjucks environment.");
    }

    env.addGlobal("randomword", function () {
        const words = loadRandomWords();
        const index = Math.floor(Math.random() * words.length);
        return words[index];
    });
}

function addLocationInfoGlobal(env, { getLocations } = {}) {
    if (!env || typeof env.addGlobal !== "function") {
        throw new Error("addLocationInfoGlobal requires a Nunjucks environment.");
    }
    if (typeof getLocations !== "function") {
        throw new Error("addLocationInfoGlobal requires a getLocations function.");
    }

    env.addGlobal("getLocationInfo", function (name, id = null) {
        if (typeof name !== "string" || !name.trim()) {
            throw new Error("getLocationInfo requires a non-empty location name.");
        }
        if (id !== null && id !== undefined && (typeof id !== "string" || !id.trim())) {
            throw new Error("getLocationInfo location id must be a non-empty string when provided.");
        }

        const locations = getLocations();
        if (!Array.isArray(locations)) {
            throw new Error("getLocationInfo location provider must return an array.");
        }

        const normalizedName = name.trim();
        const normalizedNameLower = normalizedName.toLowerCase();
        const normalizedId = typeof id === "string" ? id.trim() : null;
        let matches;

        if (normalizedId) {
            matches = locations.filter(location => location?.id === normalizedId);
            if (matches.length === 1) {
                const matchedName = typeof matches[0]?.name === "string" ? matches[0].name.trim() : "";
                if (matchedName.toLowerCase() !== normalizedNameLower) {
                    throw new Error(
                        `getLocationInfo destination id "${normalizedId}" is named "${matchedName || "unknown"}", not "${normalizedName}".`
                    );
                }
            }
        } else {
            const namedLocations = locations.filter(location => (
                typeof location?.name === "string" && location.name.trim()
            ));
            const exactMatches = namedLocations.filter(location => (
                location.name.trim().toLowerCase() === normalizedNameLower
            ));
            matches = exactMatches.length > 0
                ? exactMatches
                : namedLocations.filter(location => (
                    location.name.toLowerCase().includes(normalizedNameLower)
                ));
        }

        if (matches.length === 0) {
            throw new Error(`getLocationInfo could not find location "${normalizedName}"${normalizedId ? ` (${normalizedId})` : ""}.`);
        }
        if (matches.length > 1) {
            const candidateLabels = matches.map(location => (
                `${location.name || "unnamed"} (${location.id || "no id"})`
            ));
            throw new Error(
                `getLocationInfo location "${normalizedName}" is ambiguous: ${candidateLabels.join(", ")}.`
            );
        }

        const location = matches[0];
        const locationName = typeof location?.name === "string" ? location.name.trim() : "";
        if (!locationName) {
            throw new Error(`getLocationInfo matched a location without a name for "${normalizedName}".`);
        }

        const descriptionCandidates = [
            location.description,
            location.stubMetadata?.stubDescription,
            location.stubMetadata?.blueprintDescription,
            location.shortDescription,
            location.stubMetadata?.stubShortDescription,
            location.stubMetadata?.shortDescription
        ];
        const description = descriptionCandidates.find(value => (
            typeof value === "string" && value.trim()
        ));
        if (!description) {
            throw new Error(`getLocationInfo location "${locationName}" is missing its description.`);
        }

        return {
            name: locationName,
            description: description.trim()
        };
    });
}

module.exports = {
    addEvalFilter,
    addLocationInfoGlobal,
    addRandomWordGlobal,
};
