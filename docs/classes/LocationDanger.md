# Location danger calculations

`LocationDanger.js` is the canonical calculation and definition boundary for wild danger, faction danger, and the capped arrival probability used by hostile replenishment. The numeric inputs are deliberately absent from ordinary storyteller base context.

## Persisted inputs and effective wild danger

- `Location.dangerLevel` is an unbounded finite integer. Missing or null legacy values become `1`.
- `Region.dangerModifier` is an unbounded finite integer. Missing or null legacy values become `0`.
- `Faction.violenceLevel` remains an integer from `1` through `5`. Missing or null legacy values become `1`.
- `resolveEffectiveLocationDanger(location)` adds the stored location base to the immediate owning region's modifier, then clamps only that sum to `1..5`. It returns the base, modifier, raw sum, effective value, region id, and `effective - 1` wild contribution. It never rewrites either model.

Parent-region modifiers are not aggregated. A location contributes faction danger only through its explicit `controllingFactionId`; regional control is not inferred.

## Definitions and faction matrix

`defs/location_danger.yaml` is loaded through `DefinitionLoader.loadMergedDefinitionFile()`, so enabled mods can override individual merged definition values. Startup and config/definition reload validate all five standing thresholds, their strict descending order, every curve, the rating-1 null half-life/zero cap, positive higher-rating half-lives, and strictly increasing probability caps.

Standing uses strict below comparisons. Exact `-20`, `-40`, `-60`, and `-80` boundaries remain in the less severe band. `resolveFactionDangerRating(...)` combines that band with violence through this rating matrix:

| Antagonism / violence | 1 | 2 | 3 | 4 | 5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Non-hostile | 1 | 1 | 1 | 1 | 1 |
| Dislikes | 1 | 1 | 1 | 1 | 2 |
| Unfriendly | 1 | 1 | 2 | 3 | 4 |
| Hostile | 1 | 2 | 3 | 4 | 5 |
| Severe enemy | 1 | 2 | 4 | 5 | 5 |
| Extermination | 1 | 3 | 4 | 5 | 5 |

A rating contributes `rating - 1`. Missing faction standing is neutral; a present non-finite standing is invalid.

## Arrival probability

The effective curve rating is the greater of effective wild danger and faction danger. For elapsed minutes `t`, configured half-life `h`, and cap `c`, `calculateArrivalProbability(...)` returns `c * (1 - 2^(-t/h))`. Rating 1 is always zero. Current defaults are:

| Rating | Half-life | Cap |
| ---: | ---: | ---: |
| 1 | none | 0% |
| 2 | 30 days | 25% |
| 3 | 7 days | 50% |
| 4 | 2 days | 67% |
| 5 | 12 hours | 80% |

After a successful presence roll, `selectDangerSource(...)` weights wild and faction by their respective `rating - 1` contributions. The total arrival probability does not stack the contributions.

