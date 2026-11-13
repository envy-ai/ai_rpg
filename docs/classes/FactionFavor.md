# FactionFavor

`FactionFavor.js` validates the favors stored on a [Faction](Faction.md). It is a normalizer module, not a registry: favors live inside their faction record and are saved with it in `factions.json`. Design background: [faction_favors_brainstorm.md](../ideas/faction_favors_brainstorm.md).

## Favor record

| Field | Rule |
|---|---|
| `id` | `favor_...` from `IdGenerator.next('favor', name)` when registered. Supplied ids are kept and reserved. Detached drafts (`register: false`) may have no id. |
| `name` | Required, unique within the faction (case-insensitive). |
| `shortDescription` | Required one sentence; used in the compact base-context row and favor menus. |
| `description` | Required full text; shown in the Factions tab and in the `<favorActivation>` block. |
| `minThreshold` | Must equal the `threshold` of one of the faction's tiers above 0. |
| `cooldownMinutes` | Positive whole minutes. Input may instead be `cooldown`: whole minutes or a duration string parsed by `Utils.parseDurationToMinutes` (hours/days/minutes; weeks are not accepted). |
| `requiresTarget` | Boolean; `"true"`/`"false"` strings accepted from XML. |
| `targetPrompt` | Required when `requiresTarget` is true; blank otherwise. |
| `presence` | `anywhere` (default) or `faction-presence`. |
| `effect` | `null` or `{ type, params }` validated by [FactionFavorEffectRegistry](FactionFavorEffectRegistry.md). `type: "none"` normalizes to `null`. |
| `imageId`, `imagePrompt` | Icon presentation metadata; blank by default. |

Errors name the faction, favor and field and list the valid values, for example `Faction "Ashen Guild" favor "Safe Lodging".minThreshold 40 does not match a reputation tier above 0. Valid thresholds: 20, 60.`

For `grant-item`, optional `effect.params.contentsSource: 'target'` requires `requiresTarget: true` and a nonblank `targetPrompt`. The activated target becomes a pending container-content seed, hydrated before the cooldown is recorded. Fixed-item favors continue to omit `contentsSource`.

## API

- `normalizeFavor(raw, { tiers, factionName, index, register })`
- `normalizeFavorList(value, { tiers, factionName, register })`: validates every favor and rejects duplicate ids or names.
- `cloneFavor(favor)`: deep copy used by `Faction` getters.
- `PRESENCE_VALUES`

[FactionFavorXml](../../FactionFavorXml.js) parses the `<favors>` XML returned by the base-context favor generation prompt: `parseFavorDraftsFromFactionNode` reads drafts without validation; `parseFavorsFromFactionNode` validates them against a faction's tiers and strips ids and image fields.
