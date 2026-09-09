# PlayerActionTinyBrainResult

`PlayerActionTinyBrainResult.js` converts the parsed terminal state of the non-attack TinyBrain player-action program into canonical `<turnResult>` or `<moveTurnResult>` XML. The LLM supplies small non-XML answers; this module is the only writer of the final result XML on that path.

## Inputs

`buildPlayerActionTinyBrainResult({ assignments, templateContext })` accepts JSON-safe named checkpoint assignments and the immutable prompt-context snapshot. It validates:

- player movement: `none`, `destination`, `inside_vehicle`, or `disembark`;
- vehicle decision: `unchanged`, `depart`, `stop`, `redirect`, or `stop_for_exit`;
- the state-dependent combinations permitted by the current vehicle;
- required player/vehicle destinations and their authoritative, programmatic, or parsed duration objects;
- exact non-party accompanying-character names or aliases selected from the movement-origin allowlist;
- at least one unique travel prose scope and non-empty prose for every selected scope;
- required normal prose, elapsed-time reasoning, and a duration of at least one minute.

Committed exit-button travel is supplied in `templateContext.playerActionTravelDestination`, together with the server-computed `templateContext.playerActionTravelMovementKind`. The movement kind must be `destination` when the player is off-vehicle and `disembark` when `currentVehicle` exists; a missing or contradictory value fails explicitly. This context value replaces the otherwise required `movementKind` parser assignment. Authoritative destinations include canonical location/region ids and names. For model-selected and committed destinations, the builder uses `PlayerActionDestinationContext` to canonicalize an existing location and reuse an authoritative or graph-resolved duration. A non-null programmatic value, including `0`, replaces the duration checkpoint; a parsed duration is required only when no program duration exists and is rejected if both sources are present. `templateContext.playerActionAccompanyingCharacters` supplies canonical names and aliases only for living non-party NPCs at the movement origin. When that allowlist is empty, the program skips the character question and supplies an empty selection locally. Living party members are omitted from the selection because the shared movement executor always carries them automatically. Vehicle names always come from `templateContext.currentVehicle.name`.

## Vehicle Rules

An underway vehicle continuing its recorded route while the player remains aboard produces a normal turn. The program derives that unchanged outcome locally rather than asking the model to repeat it; the same applies to disembarking when the vehicle is not underway. Moving inside or disembarking produces a move turn with player destination metadata but no `<vehicleInfo>`. A departure, stop, or redirect while the player otherwise remains aboard produces a move turn with canonical vehicle metadata; stopping uses `0 minutes` and no new destination. `stop_for_exit` preserves the existing disembark contract and does not emit a mechanical vehicle update.

For `depart` and `redirect`, the dedicated `player_action_vehicle_destination` checkpoint parser performs the fixed-route semantic check before the result builder runs. Vehicles with no configured route retain unrestricted destination parsing. A fixed-route answer must match exactly one canonical allowed location name/id with a compatible region, or an allowed pending-region entry; it is canonicalized on success and retried in place on off-route, ambiguous, or structurally incomplete context. The checkpoint anchors the first syntactically complete destination in retry-local parser state. A retry may repair representation without changing that normalized destination, but it cannot replace an off-route request with a different allowed stop; an impossible off-route request therefore exhausts the checkpoint and fails without mutation. The builder retains its independent state-combination and required-field validation as a second boundary.

## Serialization

Prose and hidden notes use safely split CDATA so XML metacharacters and literal `]]>` text cannot break the document. Metadata uses XML text escaping. Empty optional elements are omitted.

Normal results contain prose, optional direct hidden notes, and required time reasoning/duration. Move results contain only applicable vehicle/player destinations and selected origin/between/destination prose. A player move also contains `<accompanyingCharacters>` with zero or more canonical non-party `<name>` children. An accepted alias is normalized before XML assembly and is never serialized as an alias. Party members are not serialized in that element; the executor derives them from authoritative party membership. Optional move hidden notes are a direct `<hidden>` child; player-action parsing appends that tag to stored combined prose without placing it inside event-scoped travel prose.

Movement between locations inside a region vehicle serializes a player destination normally because the destination remains inside the vehicle region. Movement between distinct narrated areas of a single-location vehicle does not serialize `<playerDestination>`, travel time, or accompanying characters: it retains the authoritative vehicle location and emits only scoped movement prose. This prevents an onboard booth/seat/deck area from becoming an unrelated world location and preserves the active vehicle route.

The resulting XML follows the established `/api/chat` parse, scheduled-event, slop-removal, travel-event, history, and client-response paths.
