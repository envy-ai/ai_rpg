# Slop Checking & Repetition Busting

Quick refresher on where these systems live and how they're wired.

## Repetition busting (player action prose)

### What it does
- Default is ON (`config.default.yaml` sets `repetition_buster: true`), but it can be toggled in config.
- When `config.repetition_buster` is enabled, the player-action prompt runs a multi-step self-correction flow and outputs either `<finalProse>...</finalProse>` or `<travelProse>...</travelProse>`. The server enforces a `requiredRegex` and extracts the prose for player-action prompts (used for player actions and NPC narratives).
- If `config.repetition_buster` is **disabled**, the server still checks for repetition against recent prose. When overlap is detected, it re-renders the player-action prompt with repetition_buster forced on and re-asks the model.

### Full step list (current prompt)
1. Draft Response: generate a preliminary response following `config.prose_length`, strictly adhering to `success_or_failure`.
2. Analysis and planning (any format), including:
   - Repetitive patterns
   - Meaningless profundity
   - Character omniscience
   - Treknobabble
   - Continuity and logic
   - Forgotten party members
   - Aggro
   - Emotional thesis statements
   - "Everybody checking in"
   - Success or failure adherence
   - Remaining guidelines
3. Write a second draft based on the analysis.
4. Analyze the second draft for issues, then output final prose inside `<finalProse>...</finalProse>` without introducing new content. If the prompt requests travel prose, emit `<travelProse>` with `originProse`, `betweenProse`, and/or `destinationProse` instead.

### Detection logic
- Overlap detection uses `Utils.findKgramOverlap(prior, response, { k: 6 })`.
- Token normalization lowercases, strips punctuation as word breaks (except apostrophes), and removes common words/contractions plus NPC name and alias tokens before k-gram matching (`COMMON_WORDS` in `Utils.js`). Modal verbs `could`/`would` and their contractions are intentionally retained.
- The server logs the offending overlap when detected.

### Key files / functions
- Prompt template: `prompts/_includes/player-action.njk` (`config.repetition_buster` block)
- Prompt render + auto-rerun logic:
  - `api.js` → player action flow
  - `renderPlayerActionPrompt(forceRepetitionBuster)`
  - `runActionNarrativeForActor()` (NPC narrative also uses the player-action prompt)
  - `requiredRegex` + `<finalProse>` extraction
- K-gram utilities: `Utils.findKgramOverlap`, `Utils.findKgramOverlaps` in `Utils.js`

### Config switches
- `config.repetition_buster`: toggles the multi-step prompt + `<finalProse>` output (default true in `config.default.yaml`).
- `config.ai.dialogue_repetition_penalty`: passed to the LLM request as `repetition_penalty`.

### Notes
- The rerun is only triggered for `player-action` responses (not NPC turns).
- When repetition_buster is on, the server extracts `<finalProse>` or builds prose from `<travelProse>` for any `player-action` prompt, and logs the parsed XML as JSON for debugging. Random-event prompts use the same parser when repetition_buster is enabled.
- If `<travelProse>` is returned, the server runs event checks on the origin and destination prose separately (move events suppressed), moves the player to the destination between them, and emits separate event summaries (applies to player-action and random-event flows).
- Travel prose segments are normalized to remove leading indentation at paragraph starts before processing.
- Attack prose uses the same repetition-buster flow (the attack branch of `prompts/_includes/player-action.njk` now includes the `<finalProse>` instructions).

## Slop checking + slop remover

### What it does
- Detects "slop words" (based on ppm thresholds) and repeated 3+-grams from recent prose history.
- If either are found, it calls the **slop remover** prompt to rewrite the text while preserving meaning.
- Results are logged and displayed as a 🧹 insight icon in the chat UI.

### Detection logic
- Slop words:
  - Source: `defs/slopwords.yaml`
  - Analyzer: `server.js` → `analyzeSlopwordsForText()` computes ppm against the provided text.
  - Active-setting additions: `currentSetting.customSlopWords` entries with a single token are added as slop words (using `default` ppm threshold).
  - `api.js` → `getFilteredSlopWords()` runs the analyzer on combined slop history + current response, then filters to words present in the current response.
  - Slop history segments include `player-action`, `npc-action`, `quest-reward`, and `random-event` chat entries.
- Configured ngrams:
  - Source: `defs/slopwords.yaml` → `ngrams` (with per-entry ppm or `default`, using `ngram_default`).
  - Analyzer: `server.js` → `analyzeConfiguredNgramsForText()` computes ppm over normalized tokens.
  - Active-setting additions: `currentSetting.customSlopWords` entries with multiple tokens are normalized and added as configured ngrams (using `ngram_default` ppm threshold).
  - Normalization matches overlap detection (`Utils.normalizeKgramTokens`): lowercase, punctuation stripping, common-word removal, and NPC name/alias token removal while retaining `could`/`would` variants.
  - `api.js` → `getFilteredConfiguredNgrams()` runs analyzer on combined slop history + current response, then filters to ngrams present in the current response.
- Repeated n-grams:
  - `api.js` → `collectSlopNgrams()`, which combines two scans using `Utils.findKgramOverlaps()`.
  - Base scan: `minK: 3` across the last 20 slop history segments.
  - Supplemental scan: `minK: 6` across the last 80 assistant prose-like entries (`player-action`, `npc-action`, `quest-reward`, `random-event`, or null type).
  - Merges repetition-based ngrams with configured-PPM ngrams and prunes contained n-grams via `Utils.pruneContainedKgrams()`.
  - Uses the same punctuation stripping + `COMMON_WORDS` filtering as repetition detection.

### Slop remover flow
- Entry point: `api.js` → `applySlopRemoval(prose, { returnDiagnostics })`.
- Prompt: `prompts/slop-remover.xml.njk`.
- Prompt inputs:
  - `storyText` (last 5 prose entries + last 5 player entries, merged chronologically)
  - `textToEdit` (current response)
  - `slopWords`
  - `slopNgrams`
- Output must be plain text (no XML). The server retries up to `config.slop_remover_base_attempts` (default `2`) and can extend to 5 when parse failures occur.
- After each attempt, the server re-checks for remaining slop words and n-grams; if it hits max attempts, it logs and allows remaining slop.
- Diagnostics (`slopWords` + `slopNgrams`) are attached to the response and recorded in chat history.

### Where it runs
- Player action prose (after LLM response): `api.js` → main player-action flow
- NPC action text (planned action shown in chat): `api.js` → NPC turn handling
- NPC narrative prose: `api.js` → NPC turn handling
- Random event narrative: `api.js` → random event flow
- Quest reward prose: `Events.js` → quest reward flow
- Crafting narrative text: `api.js` → craft flow
- Game intro prose (`<introProse>`): `api.js` → `runGameIntroPrompt` (new-game intro and `/game_intro` slash command path)

### Explicit bypasses
- `/api/chat` question actions (`?`) bypass slop-remover processing.
- `/api/chat` generic prompt actions (`@`, `@@`, `@@@`) bypass slop-remover processing.

### UI + logging
- Chat insight icon: 🧹, rendered from `public/js/chat.js`.
- Slop removal records:
  - `api.js` → `recordSlopRemovalEntry()` stores an attachment with type `slop-remover`.
  - Attachments are visible as tooltip details (slop words + repeated n-grams).
- LLM logs for slop remover: `logs/*_slop_remover_*.log`.

### Config switches
- `config.slop_buster`: enables the slop removal pipeline.
- `config.slop_remover_base_attempts`: base number of slop-remover rewrite attempts (`>= 1`, default `2`).
- `defs/slopwords.yaml`:
  - `default` for slop words.
  - `ngram_default` for configured ngrams.
  - `slopwords` and `ngrams` maps support per-entry numeric ppm or `default`.

## Primary code map
- Detection utilities: `Utils.js`
  - `COMMON_WORDS`
  - `findKgramOverlap()` / `findKgramOverlaps()` / `pruneContainedKgrams()`
- Debug helper: `scripts/ngram_checker.js` (standalone k-gram overlap checker using the same normalization)
- Slop words config: `defs/slopwords.yaml`
- Slop analyzers: `server.js` → `analyzeSlopwordsForText()`, `analyzeConfiguredNgramsForText()`
- Slop removal + n-gram detection: `api.js` → `getFilteredSlopWords()`, `getFilteredConfiguredNgrams()`, `collectRepeatedNgrams()`, `collectSlopNgrams()`, `buildSlopContextText()`, `applySlopRemoval()`
- Repetition buster prompt: `prompts/_includes/player-action.njk`
- UI insights: `public/js/chat.js` (🧹 icon)
