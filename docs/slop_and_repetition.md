# Slop Checking & Repetition Busting

Quick refresher on where these systems live and how they're wired.

## Repetition busting (player action prose)

### What it does
- Default is ON (`config.default.yaml` sets `repetition_buster: true`), but it can be toggled in config.
- When `config.repetition_buster` is enabled, the player-action prompt runs a multi-step self-correction flow and outputs `<finalProse>...</finalProse>`. The server enforces a `requiredRegex` and extracts `finalProse` for player-action prompts (used for player actions and NPC narratives).
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
4. Analyze the second draft for issues, then output final prose inside `<finalProse>...</finalProse>` without introducing new content.

### Detection logic
- Overlap detection uses `Utils.findKgramOverlap(prior, response, { k: 6 })`.
- Token normalization lowercases, strips punctuation as word breaks (except apostrophes), and removes common words and contractions before k-gram matching (`COMMON_WORDS` in `Utils.js`).
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
- When repetition_buster is on, the server extracts `<finalProse>` from the model output for any `player-action` prompt.

## Slop checking + slop remover

### What it does
- Detects "slop words" (based on ppm thresholds) and repeated 3+-grams from recent prose history.
- If either are found, it calls the **slop remover** prompt to rewrite the text while preserving meaning.
- Results are logged and displayed as a 🧹 insight icon in the chat UI.

### Detection logic
- Slop words:
  - Source: `defs/slopwords.yaml`
  - Analyzer: `server.js` → `analyzeSlopwordsForText()` computes ppm against the provided text.
  - `api.js` → `getFilteredSlopWords()` runs the analyzer on combined slop history + current response, then filters to words present in the current response.
  - Slop history segments include `player-action`, `npc-action`, `quest-reward`, and `random-event` chat entries.
- Repeated n-grams:
  - `api.js` → `collectSlopNgrams()`, which combines two scans using `Utils.findKgramOverlaps()`.
  - Base scan: `minK: 3` across the last 20 slop history segments.
  - Supplemental scan: `minK: 6` across the last 80 assistant prose-like entries (`player-action`, `npc-action`, `quest-reward`, `random-event`, or null type).
  - Merges results and prunes contained n-grams via `Utils.pruneContainedKgrams()`.
  - Uses the same punctuation stripping + `COMMON_WORDS` filtering as repetition detection.

### Slop remover flow
- Entry point: `api.js` → `applySlopRemoval(prose, { returnDiagnostics })`.
- Prompt: `prompts/slop-remover.xml.njk`.
- Prompt inputs:
  - `storyText` (last 5 prose entries + last 5 player entries, merged chronologically)
  - `textToEdit` (current response)
  - `slopWords`
  - `slopNgrams`
- Output must be plain text (no XML). The server retries up to 3 times and can extend to 5 when parse failures occur.
- After each attempt, the server re-checks for remaining slop words and n-grams; if it hits max attempts, it logs and allows remaining slop.
- Diagnostics (`slopWords` + `slopNgrams`) are attached to the response and recorded in chat history.

### Where it runs
- Player action prose (after LLM response): `api.js` → main player-action flow
- NPC action text (planned action shown in chat): `api.js` → NPC turn handling
- NPC narrative prose: `api.js` → NPC turn handling
- Random event narrative: `api.js` → random event flow
- Quest reward prose: `Events.js` → quest reward flow
- Crafting narrative text: `api.js` → craft flow

### UI + logging
- Chat insight icon: 🧹, rendered from `public/js/chat.js`.
- Slop removal records:
  - `api.js` → `recordSlopRemovalEntry()` stores an attachment with type `slop-remover`.
  - Attachments are visible as tooltip details (slop words + repeated n-grams).
- LLM logs for slop remover: `logs/*_slop_remover_*.log`.

### Config switches
- `config.slop_buster`: enables the slop removal pipeline.

## Primary code map
- Detection utilities: `Utils.js`
  - `COMMON_WORDS`
  - `findKgramOverlap()` / `findKgramOverlaps()` / `pruneContainedKgrams()`
- Debug helper: `scripts/ngram_checker.js` (standalone k-gram overlap checker using the same normalization)
- Slop words config: `defs/slopwords.yaml`
- Slop analyzer: `server.js` → `analyzeSlopwordsForText()`
- Slop removal + n-gram detection: `api.js` → `getFilteredSlopWords()`, `collectRepeatedNgrams()`, `buildSlopContextText()`, `applySlopRemoval()`
- Repetition buster prompt: `prompts/_includes/player-action.njk`
- UI insights: `public/js/chat.js` (🧹 icon)
