# FactionHousekeepingState

`normalizeFactionHousekeepingState(value = null)` returns an isolated normalized `{ factionPlans, lastReviewedTurnId, lastReviewedTurnTimestamp }` snapshot for [FactionHousekeepingService](FactionHousekeepingService.md). Missing state in older saves produces an empty plan list and null boundary. Present invalid records throw rather than being silently replaced.

Plans contain unique actual `factionRef` IDs, nonblank text `role`, `plan`, and `awarenessConstraints`, plus at least one nonblank `nextSteps` entry. Draft references are not accepted in saved state. Boundary values are null or a nonblank turn ID and valid timestamp. The module imports no runtime dependencies; `Globals` uses it for getters/setters and `Utils` persists its result in save metadata.
