# Slop Checking & Repetition Busting

Reference for the systems that reduce repeated phrasing, configured slop words, configured n-grams, regex matches, and overused trope patterns in generated visible prose.

## Repetition Busting

### Runtime Behavior

- `config.default.yaml` enables `repetition_buster: true`. The switch can be disabled in runtime config.
- `config.repetition_buster_mode` is passed into the prompt template; implemented prompt modes are `glm` and `kimi`, with `glm` as the default config value.
- When `config.repetition_buster` is enabled, player-action, creative-mode action, NPC action narrative, and random-event prose paths request XML prose roots instead of plain prose.
- The required action XML roots are `<turnResult>`, `<moveTurnResult>`, and `<rejected>`. `LLMClient.chatCompletion(...)` receives `requiredRegex: playerActionProseRegex` for action XML requests.
- The parser extracts the last complete requested XML root with `Utils.extractFinalXmlRootBlock(...)`. Draft analysis text or earlier draft XML roots are ignored.
- Malformed player-action XML is repaired through the `xml-fix` prompt once before the parser fails the turn with a clear error.

### Prompt Shape

- Attack prose uses `<turnResult>` only, with visible prose inside a direct `<prose>` child. The attack branch performs draft, analysis, second draft, final analysis, and final output while enforcing attack outcome details.
- Non-attack player-action prose can return either `<turnResult>` or `<moveTurnResult>`.
- Non-attack player-action prompts can return `<rejected>...</rejected>` for incomplete player actions or attempts to control other characters without enough in-world justification. Rejected actions are stored as excluded-from-base-context responses and do not continue into normal slop removal, event checks, or response storage.
- `<turnResult>` requires a direct `<prose>` child for the visible story text. Nested `<hidden>...</hidden>` note blocks inside `<prose>` are preserved in place, and direct child `<hidden>...</hidden>` siblings are appended to the parsed final prose. Direct child `<timePassed>` metadata is parsed into minutes and excluded from visible prose.
- `<moveTurnResult>` contains optional `<vehicleInfo>`, optional `<playerDestination>`, and at least one of `<originProse>`, `<betweenProse>`, or `<destinationProse>`.

### Travel Prose Handling

- Parsed travel prose combines visible origin, between, and destination prose for the chat entry.
- Hidden notes are preserved in extracted prose but stripped from event-check segment text.
- Travel prose segments remove leading indentation at paragraph starts before storage and processing.
- Origin and destination event checks can run separately when player travel creates a meaningful origin/destination split. Active vehicle contexts process the combined prose at the onboard location while still preserving player-destination movement handling.
- Player-destination `<travelTime>` values are parsed as generated exit durations and normalized by the shared duration helpers. A generated origin exit receives that duration; generated return exits copy the same duration. Existing exits keep their stored travel time.
- Vehicle travel metadata can start or retarget timed trips, update vehicle state, and request client location refreshes when vehicle movement or due arrivals affect visible state.

### Repetition Detection Without Prompt XML

- When `config.repetition_buster` is disabled for the main chat player-action route, the server still checks the response against recent prose history.
- `findRecentProseEntries(30)` gathers recent assistant entries with no type or `type: "player-action"`.
- `Utils.findKgramOverlap(prior, response, { k: 6 })` detects overlap after token normalization.
- If overlap is detected, the route logs the offending k-gram, re-renders the player-action prompt with repetition busting forced on, and reruns the model. NPC turns do not use this rerun path.

### Token Normalization

- K-gram matching lowercases text, treats punctuation as word breaks except apostrophes, removes `COMMON_WORDS`, and removes tokenized NPC names and aliases by default.
- Modal verbs such as `could` and `would` are retained because they are not in `COMMON_WORDS`.
- Configured n-grams and custom multi-token slop entries use the same token normalization but do not exclude NPC names while defining entries.

### Key Files

- Prompt templates:
  - `prompts/_includes/player-action.njk`
  - `prompts/_includes/creative-mode-action.njk`
  - `prompts/_includes/random-event.njk`
  - `prompts/_includes/travel-prose.njk`
- Parser and route flow:
  - `api.js` -> `playerActionProseRegex`
  - `api.js` -> `extractPlayerActionXmlPayload(...)`
  - `api.js` -> `parsePlayerActionProseFromXml(...)`
  - `api.js` -> `repairMalformedPlayerActionXml(...)`
  - `api.js` -> `renderPlayerActionPrompt(forceRepetitionBuster)`
  - `api.js` -> `runActionNarrativeForActor(...)`
  - `api.js` -> `runmoveTurnResultEventChecks(...)`
- K-gram utilities:
  - `Utils.normalizeKgramTokens(...)`
  - `Utils.findKgramOverlap(...)`
  - `Utils.findKgramOverlaps(...)`
  - `Utils.pruneContainedKgrams(...)`

### Config

- `config.repetition_buster`: enables action XML self-correction and final prose extraction.
- `config.repetition_buster_mode`: selects prompt-mode text for the repetition-buster prompt.
- `config.ai.dialogue_repetition_penalty`: passed to the LLM backend as `repetition_penalty` when the value is finite and greater than zero.

## Slop Checking And Slop Removal

### Runtime Behavior

- `config.default.yaml` enables `slop_buster: true`.
- The slop pipeline checks visible prose for configured slop words, configured regex names, configured n-grams, and repeated n-grams from prose history.
- When anything is detected, `applySlopRemoval(...)` asks the slop-remover prompt to rewrite the prose while preserving meaning, paragraph breaks, and hidden-note blocks.
- Detection ignores `<hidden>...</hidden>` text when deciding whether visible prose needs cleanup. The rewrite prompt asks the model to preserve hidden blocks exactly.
- Call sites that request and record diagnostics store them as `type: "slop-remover"` chat entries and render them in the chat UI with the broom insight.

### Slop History

- Slop word, configured n-gram, and positive-ppm regex analysis checks combined slop history plus the current visible prose, then filters results to matches present in the current prose.
- Slop history entry types are:
  - `player-action`
  - `npc-action`
  - `quest-reward`
  - `random-event`
  - `while-you-were-away-player`
- Assistant prose-like history for supplemental repeated n-gram detection includes assistant entries with a null type plus the slop history entry types.
- The slop-remover context prompt uses the last 5 assistant prose-like entries and last 5 player entries, merged back into chronological order.

### Slop Words

- Source: `defs/slopwords.yaml` -> `slopwords`.
- Analyzer: `server.js` -> `analyzeSlopwordsForText(...)`.
- Tokens are lowercased words with apostrophes retained.
- Thresholds are parts per million over the analyzed text. Individual entries can use numeric ppm values or `default`.
- Active setting `customSlopWords` entries with one token are treated as slop words and use the configured default ppm threshold.
- `api.js` -> `getFilteredSlopWords(...)` returns only flagged words that are also present in the current prose.

### Configured N-Grams

- Source: `defs/slopwords.yaml` -> `ngrams`.
- Analyzer: `server.js` -> `analyzeConfiguredNgramsForText(...)`.
- Thresholds use `ngram_default` unless an entry supplies a numeric ppm or `default`.
- Active setting `customSlopWords` entries with multiple tokens are normalized as configured n-grams and use `ngram_default`.
- `api.js` -> `getFilteredConfiguredNgrams(...)` filters flagged n-grams to those present in current prose and prunes contained n-grams.

### Configured Regexes

- Source: `defs/slopwords.yaml` -> `regexes`, an array of `{ pattern, name, ppm }` entries.
- Patterns use JavaScript `/pattern/flags` literal syntax. Duplicate names, invalid flags, invalid regexes, and malformed entries throw.
- YAML double-quoted backspace characters produced by `\b` are converted back to regex word-boundary escapes before compilation.
- Matching strips all `*` characters from checked text before applying regexes.
- Regex detection reports configured `name` values, not raw patterns.
- `ppm: 0` regex entries are checked directly against the current prose. Positive-ppm regex entries are analyzed against combined slop history plus current prose, then filtered through current-prose matching.

### Repeated N-Grams

- Entry point: `api.js` -> `collectSlopNgrams(...)`.
- Base scan: `collectRepeatedNgrams(prose, { minK: 3, maxEntries: 20 })` over recent slop history.
- Supplemental scan: `collectRepeatedNgrams(prose, { minK: 6, segments: getRecentAssistantProseHistorySegments(80) })`.
- Configured n-grams from `getFilteredConfiguredNgrams(...)` are merged with repetition-based n-grams.
- `Utils.pruneContainedKgrams(...)` removes shorter n-grams contained inside longer matches.

### Slop Remover Prompt

- Entry point: `api.js` -> `applySlopRemoval(prose, { returnDiagnostics, baseContextOverride })`.
- Standalone template: `prompts/slop-remover.xml.njk`.
- Cached/base-context template path: `prompts/base-context.xml.njk` with `promptType: "slop-remover"`, which includes `prompts/_includes/slop-remover.njk`.
- On the cached/base-context path, the request serializes the same canonical tool schema as every other non-generic base-context prompt so tool definitions do not cause an early prefix-cache divergence. The base-context end marker becomes a user-message boundary immediately before slop-specific instructions, and `Do not make tool calls.` starts that new message. Slop removal still uses direct completion rather than a tool loop.
- Player-action slop removal captures the parsed player-action system prompt and rendered generation-prefix text through the base-context end marker. The slop prompt reuses those exact strings and appends a freshly rendered slop-remover include after the marker. This avoids cloning live config, mod field validators, or other executable objects and preserves the exact text already sent for the player action. Other slop-removal callers omit the override and continue to prepare their current base context normally.
- Prompt inputs include:
  - `systemPromptPrefix` resolved for `slop_remover`
  - normalized setting context
  - `config`
  - `storyText`
  - `textToEdit`
  - `slopWords`
  - `slopRegexes`
  - `slopNgrams`
  - `forbiddenTropes`
- `defs/slopwords.yaml` -> `forbidden_tropes` is prompt context only. It does not participate in detection, retry decisions, or stored diagnostics unless the rewritten text also triggers a configured detector.
- The prompt must return `<editedText>...</editedText>`. The parser extracts the final complete XML block, parses it with `Utils.parseXmlDocumentStrict(...)`, and requires non-empty edited text.
- `LLMClient.chatCompletion(...)` uses `metadataLabel: "slop_remover"`, `validateXML: true`, and `validateXMLStrict: true`.
- Attempts start from `config.slop_remover_base_attempts`. The checked-in default config is `1`; if the setting is absent, the code fallback is `2`. Parse failures can extend the loop up to 5 attempts.
- After each successful parse, the server re-checks visible prose for remaining slop words, regex names, and n-grams. Remaining detections are included in the next attempt. At the attempt limit, the server logs a warning and allows the response with remaining slop.
- With `returnDiagnostics: true`, the result includes `{ text, slopWords, slopRegexes, slopNgrams, ran }`.

### Where Slop Removal Runs

- Main `/api/chat` player-action and creative-mode action prose after action XML parsing, scheduled-event interruption rewrites, and rejected-action handling.
- Random-event narrative prose.
- NPC turn planned action text shown in chat.
- NPC turn final narrative prose.
- Quest reward prose in `Events.js`.
- Crafting, processing, salvage, and harvest narrative prose.
- Location modification narrative prose.
- Checked container open-attempt prose.
- Game intro prose.
- Scheduled-event visible prose (`scheduled-event-prose`) when the player is present and visible prose is not suppressed.
- While-you-were-away visible reunion prose (`while-you-were-away-player`).

### Explicit Bypasses

- `/api/chat` question actions beginning with `?` bypass slop removal.
- `/api/chat` generic and no-context prompt actions beginning with `@`, `@@`, `@@@`, or `\` bypass slop removal.
- Hidden-only prose does not trigger slop removal because detection checks visible prose after hidden-note stripping.

### UI And Logging

- Slop diagnostics are recorded by `api.js` -> `recordSlopRemovalEntry(...)` as `type: "slop-remover"` attachment entries.
- The client renders slop diagnostics through `public/js/chat.js` with the broom insight and tooltip sections for slop words, regex names, and repeated n-grams.
- Slop remover prompt logs use `LLMClient.logPrompt(...)` with `prefix: "slop_remover"` and `metadataLabel: "slop_remover"`.
- Log files use the `logs/*_slop_remover_*.log` naming pattern.

## Primary Code Map

- Definitions and thresholds: `defs/slopwords.yaml`.
- Config defaults: `config.default.yaml`.
- Slop analyzers:
  - `server.js` -> `loadSlopwordConfig(...)`
  - `server.js` -> `analyzeSlopwordsForText(...)`
  - `server.js` -> `analyzeConfiguredNgramsForText(...)`
  - `server.js` -> `analyzeSlopRegexesForText(...)`
  - `server.js` -> `findSlopRegexesInText(...)`
- Slop route helpers:
  - `api.js` -> `getFilteredSlopWords(...)`
  - `api.js` -> `getFilteredSlopRegexes(...)`
  - `api.js` -> `getFilteredConfiguredNgrams(...)`
  - `api.js` -> `collectRepeatedNgrams(...)`
  - `api.js` -> `collectSlopNgrams(...)`
  - `api.js` -> `buildSlopContextText(...)`
  - `api.js` -> `applySlopRemoval(...)`
  - `api.js` -> `recordSlopRemovalEntry(...)`
- Repetition and XML helpers:
  - `Utils.js` -> `extractFinalXmlRootBlock(...)`
  - `Utils.js` -> `extractFinalXmlBlockFromResponse(...)`
  - `Utils.js` -> `parseXmlDocumentStrict(...)`
  - `Utils.js` -> k-gram helpers listed above
- Debug helper: `scripts/ngram_checker.js`.
- UI rendering: `public/js/chat.js`.

## Reference Tests

- `tests/api.player_action_rejection.test.js`: action XML root extraction, `<rejected>` flow, `<timePassed>` extraction, and scheduled-event rewrite order before slop removal.
- `tests/utils.xml.test.js`: final XML root/block extraction helpers.
- `tests/api.slop_regex_filter.test.js`: zero-ppm regex filtering against current prose.
- `tests/server.slop_regexes.test.js`: regex literal parsing, word-boundary handling, asterisk stripping, and regex-name reporting.
- `tests/slop_remover_forbidden_tropes_prompt.test.js`: forbidden-trope prompt rendering.
- `tests/api.prompt_uses_caching_paths.test.js`: standalone versus base-context slop-remover template selection.
- `tests/api.while_you_were_away_helpers.test.js`: visible while-you-were-away slop-removal attachment behavior.
- `tests/api.vehicle_travel_prose_timing.test.js`: travel-prose vehicle timing and event-check splitting behavior.
- `tests/api.travel_prose_destination.test.js`: structured travel-prose destination resolution behavior.
