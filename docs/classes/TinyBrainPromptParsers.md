# TinyBrainPromptParsers

`TinyBrainPromptParsers.js` contains strict, side-effect-free parsers for staged prompt checkpoints and final responses. Every returned value is JSON-serializable so `TinyBrainPromptRunner` can retain it in render state without carrying DOM nodes or game objects.

Generic parsers cover revision decisions, allowlisted character selections, narrative travel scope, exact XML roots, and exact outcome acknowledgements. Domain parsers validate quest-reward coverage, game-intro XML, turn/move prose, craft/location results, checked-container results, while-away updates, scheduled-event results, and scheduled-event interruption rewrites.

The higher-risk parsers enforce cross-stage invariants:

- quest reward coverage must have every original index exactly once and can be checked against the original reward strings;
- craft and location-modification output can be required to echo the mechanically selected duration exactly;
- a container final must name the exact single check tool that ran;
- each while-away candidate checkpoint must use the candidate's exact name, and the final response cannot change staged character updates, arrivals, or item/scenery moves;
- a scheduled-event final must preserve its approved hidden summary and omit player prose for offscreen events;
- an interruption rewrite may change player-facing prose fields only; its root, hidden notes, time data, travel destinations, vehicle data, and every other non-prose XML field must remain equivalent.

Malformed XML, duplicate/unknown values, missing required fields, and invariant drift throw descriptive parser errors. The runner retries the same checkpoint without applying domain mutations.
