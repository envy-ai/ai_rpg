# TinyBrainResultBuilders

`TinyBrainResultBuilders.js` assembles terminal TinyBrain XML when every remaining field is already known from parsed checkpoints, authoritative game state, or completed tool calls. These builders run through `llmresult(...)`; they do not send another completion merely to make the model repeat accepted prose or fixed mechanics.

The shared approved-prose selector uses the `revision_decision` checkpoint. If revision was unnecessary, it selects the closest preceding parsed prose draft. If revision was requested, it selects the parsed revised draft that follows the decision. Builder-bound drafts use `player_action_required_prose`, so a model response containing an XML wrapper cannot be mistaken for prose and nested into assembled XML. Legacy dummy draft values remain readable for existing callers and focused compatibility tests. The selector fails explicitly if the expected draft or decision is missing.

Local builders currently cover:

- ordinary no-travel `turnResult` prose for NPC actions and non-travel random/creative actions;
- game-intro XML;
- quest-reward prose plus authoritative indexed reward-coverage rows;
- while-away prose plus already parsed character, arrival, and item/scenery update XML;
- scheduled-event results, including the literal no-event result and approved summary/player prose branches;
- scheduled-event interruption rewrites by replacing only the direct player-facing prose node in the original `turnResult`;
- craft and location-modification results, combining approved prose and model-supplied reasoning/effect prose with authoritative durations;
- checked-container results, combining approved prose and timing/permanence judgments with the one successful check invocation's authoritative tool name and success result;
- scene summaries, combining each validated assigned-range checkpoint into `<scenes>` and appending a fixed final following-scene marker that the established downstream parser uses to close the last completed scene and then discards.

Builders XML-escape ordinary text, use split-safe CDATA for prose, and validate the authoritative inputs they consume. Downstream domain parsers remain responsible for validating the assembled result at API boundaries. Movement-shaped interruption XML is intentionally excluded by the caller; the local interruption builder accepts only `turnResult`.

`TinyBrainPromptRunner` supplies each builder with immutable parsed assignments, ordered checkpoint/value records, the template context, and successful accumulated tool invocations. This lets a builder preserve an accepted draft or tool outcome without requiring an exact-copy model response.
