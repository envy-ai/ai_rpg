# PlayerActionDestinationContext

`PlayerActionDestinationContext.js` performs read-only prompt-time resolution for staged TinyBrain player-action destinations. It lets the live prompt use canonical destination facts before final prose is written without invoking location generation or mutating visits, routes, NPCs, or world time.

## Resolution

`resolvePlayerActionDestinationContext(destination, options)` accepts a location/region destination and optional authoritative `locationId`, `regionId`, and `travelTimeMinutes` fields. Resolution order is:

1. exact authoritative location id, with supplied name/region consistency checks;
2. exact location name inside an exact region;
3. an exact globally unique location name when no region is supplied;
4. an explicit unresolved result when the location does not exist.

Ambiguous names and stale authoritative ids throw. The resolver never fuzzy-matches and never creates a location or region.

`assertPlayerActionDestinationAvailable(destination, options)` checks the separate creation-name boundary. Region-only travel reserves no ordinary location name. For a supplied location, existing reuse in the requested region runs first, preserving saved locations even when their names collide with a region. This lookup uses the creator's deterministic `normalizeDuplicateName` semantics (case, whitespace and leading `The`), pending region names/IDs and `originalName`/`targetRegionName` aliases, plus native stub metadata and live/pending region location-ID membership. Ambiguous matches throw; there is no fuzzy matching. Existing child stubs remain reusable before their parent region is live, without changing the prompt snapshot's unresolved status or inventing destination facts. Only a destination requiring a new location calls [LocationCreationNameGuard](LocationCreationNameGuard.md) against all live and pending regions. A location existing in another region does not exempt a newly requested location. An otherwise unresolved location/region pair with identical names retains the movement executor's existing region-only interpretation. This read-only validator accepts injected `locations`, `regions`, and `pendingRegionStubs` collections for isolated callers; production obtains pending records from the guard's configured provider.

`assertPlayerActionDestinationChangesLocation(destination, options)` is a separate
guard for model-selected player movement. It compares the resolved canonical ID
against the captured `originLocationId`, using that same normalized existing/stub
reuse lookup. Exact IDs, case/whitespace variants and leading `The` cannot turn
the origin into a distinct destination. Region-only requests use the native
recorded entrance, then first resolvable region member, when that identity is
already known. Unknown/new destinations and unresolved pending entries remain
allowed; ambiguous lookups remain errors. No location is generated or visited.
Without a supplied origin there is no identity comparison; a supplied origin ID
missing from the registry fails explicitly rather than using the player's later
location. Duration is irrelevant: a zero-minute route to a different ID remains
valid. Same-origin rejection uses code
`PLAYER_ACTION_DESTINATION_SAME_LOCATION` and names the canonical location/ID,
with correction to a supported different destination or staying here.

Resolved snapshots contain canonical location/region identity, the recorded short description, the best recorded full or stub description, prior-visit data, visible NPC names, canonical exit summaries, and programmatic travel time. NPC names include living, non-hidden, non-party NPCs physically assigned to the destination and are deduplicated and sorted. Exit summaries are direction-sorted JSON-safe records containing the canonical destination name/region plus any recorded description and travel time. Missing descriptions use the explicit prompt fact `No description recorded.` rather than triggering another model call.

`resolvePlayerActionDestinationPreviewContext(...)` uses the same read-only resolution but returns an unresolved snapshot for an ambiguous name-only lookup. The pre-draft checkpoint therefore never guesses between same-named locations; the later mechanical destination checkpoint can still supply a region and resolve strictly.

An authoritative non-negative travel duration wins. Otherwise, when an origin id is supplied, the resolver calls `Location.findShortestTravelTimeMinutes()`. Any non-null integer is resolved, including `0`; a missing route remains `null`. Duration text uses `Utils.formatMinutesAsDuration()`.

The returned object and nested NPC/duration values are frozen JSON-safe snapshots. Tests may inject location, region, player, and travel-time providers through `options`; production uses the canonical class indexes.

## Revisit timing

For `visited: true` destinations with a finite `lastVisitedTime`, the snapshot stores minutes elapsed at prompt time. `formatPlayerActionDestinationAbsence(context, travelDuration?)` adds the effective trip duration and returns the exact expected-arrival interval. A legacy visited location without a prior timestamp returns no interval, so the timed change-planning checkpoint is skipped rather than inventing elapsed time.

## Prompt integration

The prompt environment exposes:

- `resolvePlayerActionDestinationContext(destination, originLocationId, currentWorldMinutes)`;
- `resolvePlayerActionDestinationPreviewContext(destination, originLocationId, currentWorldMinutes)`;
- `formatPlayerActionDestinationAbsence(destinationContext, travelDuration)`.

Before drafting, `player-action.tinybrain.njk` asks for an exact destination location name or `N/A` at a no-tools checkpoint. If that name uniquely resolves, the next live prompt segment provides its canonical identity, short description, full description, currently present visible NPCs, and exits. A missing or ambiguous destination injects no fabricated context. This early answer is advisory drafting context only; the later movement branch still determines the actual mechanical destination after the draft. When the early answer selected a destination, that later question repeats it and says `NONE` is valid only when revision removed the travel entirely, not merely when prose substituted a descriptive landmark such as a shelter for the canonical name. The strict resolver is called again immediately after that parsed destination becomes available, or immediately after selecting committed travel. A resolved graph duration suppresses the model duration checkpoint. For timestamped revisits with `DESTINATION` prose scope, the prompt shows the expected absence and comma-separated present NPC list before asking for a parsed Markdown change list.

The mechanical player destination is selected by an XML `player_action_destination_decision` checkpoint immediately after movement selection and before vehicle selection. Its parser receives the captured origin and calls both creation-name and same-origin validators before accepting travel. A rejected collision or same-origin answer can therefore be corrected within that checkpoint's existing retry budget. Same-origin feedback offers an actual different destination or the exact `stay` XML branch. Staying derives effective movement `none` before vehicle and prose branches are chosen. Accepted earlier mechanics, tool receipts and committed-travel destinations are preserved; no draft or resolution checkpoint is replayed.

`PlayerActionTinyBrainResult.js` resolves the same destination again before local XML assembly. It canonicalizes the destination and uses the same programmatic duration, rejecting a contradictory parsed duration. This keeps the prompt facts and downstream `<moveTurnResult>` mechanics aligned.

The builder independently applies the same-origin guard to model-selected player
destinations, including direct assignment callers. The standard main
player-action response validator uses the same guard and captured origin inside
its existing completion retry boundary, with valid `turnResult`/vehicle-only
correction guidance. Vehicle destinations and authoritative committed travel
are excluded; generic availability resolution is unchanged.
