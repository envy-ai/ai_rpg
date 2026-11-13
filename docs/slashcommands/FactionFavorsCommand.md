# FactionFavorsCommand

`/faction_favors generate [faction="Faction Name"]` generates favors for factions that have at least one reputation tier above 0 but no favors yet, using `prompts/faction-favors-generator.xml.njk`. With `faction`, only that faction is considered.

It runs the same background job that loading an older save queues automatically (`generateMissingFactionFavors` in `api.js`). The reply lists the factions that received favors, or says that none needed them. Factions that gained favors elsewhere while the prompt ran are left unchanged. Unknown faction names and an unknown action throw. Favors must be enabled (`faction_favors.enabled`).
