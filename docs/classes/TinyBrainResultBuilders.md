# TinyBrainResultBuilders

`TinyBrainResultBuilders.js` assembles terminal TinyBrain XML when every remaining field is already known from parsed checkpoints, authoritative game state, or completed tool calls. These builders run through `llmresult(...)`; they do not send another completion merely to make the model repeat accepted prose or fixed mechanics.

The shared approved-prose selector uses the `revision_decision` checkpoint. If revision was unnecessary, it selects the closest preceding parsed prose draft. If revision was requested, it selects the parsed revised draft that follows the decision. Builder-bound drafts use `player_action_required_prose`, so a model response containing an XML wrapper cannot be mistaken for prose and nested into assembled XML. Legacy dummy draft values remain readable for existing callers and focused compatibility tests. The selector fails explicitly if the expected draft or decision is missing. The shared prose audit defaults to required revisions; only optional while-away prose enables `tinyBrainOptionalProseRevision`, allowing its revised draft to return parsed `N/A` (`null`). That builder alone opts into the approved-prose selector's `allowEmpty` option, so an accepted empty revision replaces the original draft and omits `<proseForPlayer>` instead of reusing redundant prose. Missing checkpoints still fail, and required bare-arrival narration and other families keep their nonempty contract.

Local builders currently cover:

- ordinary no-travel `turnResult` prose for NPC actions and non-travel random/creative actions;
- game-intro XML;
- quest-reward prose plus authoritative indexed reward-coverage rows;
- while-away prose plus already parsed listed-character, individually selected arrival, and item/scenery update XML;
- scheduled-event results, including the literal no-event result and approved summary/player prose branches;
- scheduled-event interruption rewrites by replacing only the direct player-facing prose node in the original `turnResult`;
- craft and location-modification results, combining approved prose and model-supplied reasoning/effect prose with authoritative durations;
- checked-container results, combining approved prose and timing/permanence judgments with the one successful server-executed check plan's authoritative resolver name and success result;
- scene summaries, combining each validated assigned-range checkpoint into `<scenes>` and appending a fixed final following-scene marker that the established downstream parser uses to close the last completed scene and then discards.

Builders XML-escape ordinary text, use split-safe CDATA for prose, and validate the authoritative inputs they consume. Downstream domain parsers remain responsible for validating the assembled result at API boundaries. Movement-shaped interruption XML is intentionally excluded by the caller; the local interruption builder accepts only `turnResult`.

While-away explicitly validates the builder's complete canonical XML and resolves every requested destination after the staged run, before applying need-bar changes, NPC/item moves, or storing history. `llmresult` does not invoke a final-model `finalParser`; callers must not rely on that callback to populate application state. Accepted candidate/arrival/item blocks remain preserved by construction, with checkpoint-local correction unchanged. Missing validated application state raises an explicit invariant error rather than becoming an empty update list.

The while-away builder requires explicit `templateContext.whileYouWereAwayNpcs` and `whileAwayArrivalCandidateNames` arrays. A nonempty additional roster produces one `allowed_character_selection` assignment named `whileAwayArrivalNames`, followed by one parsed `while_away_arrival_update` per selected name. With an empty roster, both selection and arrival-update stages are omitted locally. The builder checks that listed updates and selected arrival updates each cover their expected names exactly once and rejects unknown/duplicate/missing selections or updates. Empty selection contributes no additional updates. It consumes each parser's `{ xml, name }` value directly and never requests a final XML copy from the model.

`TinyBrainPromptRunner` supplies each builder with immutable parsed assignments, ordered checkpoint/value records, the template context, and successful accumulated tool invocations. This lets a builder preserve an accepted draft or tool outcome without requiring an exact-copy model response.
