# PlayerActionTinyBrainResult

`PlayerActionTinyBrainResult.js` converts the parsed terminal state of the non-attack TinyBrain player-action program into canonical `<turnResult>` or `<moveTurnResult>` XML. The LLM supplies small non-XML answers; this module is the only writer of the final result XML on that path.

## Inputs

`buildPlayerActionTinyBrainResult({ assignments, templateContext })` accepts JSON-safe named checkpoint assignments and the immutable prompt-context snapshot. It validates:

- player movement: `none`, `destination`, `inside_vehicle`, or `disembark`;
- vehicle decision: `unchanged`, `depart`, `stop`, `redirect`, or `stop_for_exit`;
- the state-dependent combinations permitted by the current vehicle;
- required player/vehicle destinations and parsed duration objects;
- exact accompanying-character names or aliases selected from the movement-origin allowlist;
- at least one unique travel prose scope and non-empty prose for every selected scope;
- required normal prose, elapsed-time reasoning, and a duration of at least one minute.

Committed exit-button travel is supplied in `templateContext.playerActionTravelDestination`, together with the server-computed `templateContext.playerActionTravelMovementKind`. The movement kind must be `destination` when the player is off-vehicle and `disembark` when `currentVehicle` exists; a missing or contradictory value fails explicitly. This context value replaces the otherwise required `movementKind` parser assignment, while the authoritative location, region, and stored travel minutes replace model-authored player destination fields. `templateContext.playerActionAccompanyingCharacters` supplies canonical names and aliases for living party members and living NPCs at the movement origin. Vehicle names always come from `templateContext.currentVehicle.name`.

## Vehicle Rules

An underway vehicle continuing its recorded route while the player remains aboard produces a normal turn. Moving inside or disembarking produces a move turn with player destination metadata but no `<vehicleInfo>`. A departure, stop, or redirect while the player otherwise remains aboard produces a move turn with canonical vehicle metadata; stopping uses `0 minutes` and no new destination. `stop_for_exit` preserves the existing disembark contract and does not emit a mechanical vehicle update.

## Serialization

Prose and hidden notes use safely split CDATA so XML metacharacters and literal `]]>` text cannot break the document. Metadata uses XML text escaping. Empty optional elements are omitted.

Normal results contain prose, optional direct hidden notes, and required time reasoning/duration. Move results contain only applicable vehicle/player destinations and selected origin/between/destination prose. A player move also contains `<accompanyingCharacters>` with zero or more canonical `<name>` children. An accepted alias is normalized before XML assembly and is never serialized as an alias. Optional move hidden notes are a direct `<hidden>` child; player-action parsing appends that tag to stored combined prose without placing it inside event-scoped travel prose.

The resulting XML follows the established `/api/chat` parse, scheduled-event, slop-removal, travel-event, history, and client-response paths.
