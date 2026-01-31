# Slop Checking & Repetition Busting

Quick refresher on where these systems live and how they’re wired.

## Repetition busting (player action prose)

### What it does
- If `config.repetition_buster` is enabled, the player-action prompt asks the model to write a draft, analyze repetition, brainstorm, then output `<finalProse>...</finalProse>`. The server extracts `finalProse` and uses it as the response.
- If `config.repetition_buster` is **disabled**, the server still checks for repetition against recent prose. When overlap is detected, it re-renders the player-action prompt **with** repetition_buster enabled and re-asks the model.

### Detection logic
- Overlap detection uses `Utils.findKgramOverlap(prior, response, { k: 6 })`.
- Token normalization removes common words and contractions before k-gram matching (`COMMON_WORDS` in `Utils.js`).
- The server logs the offending overlap when detected.

### Key files / functions
- Prompt template: `prompts/_includes/player-action.njk` (`config.repetition_buster` block)
- Prompt render + auto-rerun logic:
  - `api.js` → player action flow
  - `renderPlayerActionPrompt(forceRepetitionBuster)`
  - After initial LLM response: repetition detection and forced re-run
- K-gram utilities: `Utils.findKgramOverlap`, `Utils.findKgramOverlaps` in `Utils.js`

### Config switches
- `config.repetition_buster`: toggles the full 4-step prompt + `<finalProse>` output.
- `config.ai.dialogue_repetition_penalty`: passed to the LLM request as `repetition_penalty`.

### Notes
- The rerun is only triggered for `player-action` responses (not NPC turns).
- When repetition_buster is on, the server extracts `<finalProse>` from the model output.

## Slop checking + slop remover

### What it does
- Detects “slop words” (based on ppm thresholds) and repeated 4+-grams from recent prose.
- If either are found, it calls the **slop remover** prompt to rewrite the text while preserving meaning.
- Results are logged and displayed as a 🧹 insight icon in the chat UI.

### Detection logic
- Slop words:
  - Source: `defs/slopwords.yaml`
  - Analyzer: `server.js` → `analyzeSlopwordsForText()`
  - `api.js` → `getFilteredSlopWords()` filters the analyzer output to only words present in the current response.
- Repeated n-grams:
  - `api.js` → `collectRepeatedNgrams()`
  - Uses `Utils.findKgramOverlaps(segment, prose, { minK: 4 })` across last 20 prose entries.
  - Uses the same `COMMON_WORDS` filtering as repetition detection.

### Slop remover flow
- Entry point: `api.js` → `applySlopRemoval(prose, { returnDiagnostics })`.
- Prompt: `prompts/slop-remover.xml.njk`.
- Prompt inputs:
  - `storyText` (recent prose + player entries)
  - `textToEdit` (current response)
  - `slopWords`
  - `slopNgrams`
- Output must be plain text (no XML); server retries up to 3 times.
- Diagnostics (`slopWords` + `slopNgrams`) are attached to the response and recorded in chat history.

### Where it runs
- Player action prose (after LLM response): `api.js` → main player-action flow
- NPC turns: `api.js` → NPC turn handling
- Crafting narrative text: `api.js` → craft flow
- Some user inputs (e.g., chat action text) may be passed through slop removal when enabled

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
  - `findKgramOverlap()` / `findKgramOverlaps()`
- Slop words config: `defs/slopwords.yaml`
- Slop analyzer: `server.js` → `analyzeSlopwordsForText()`
- Slop remover + n-gram detection: `api.js` → `applySlopRemoval()`, `collectRepeatedNgrams()`
- Repetition buster prompt: `prompts/_includes/player-action.njk`
- UI insights: `public/js/chat.js` (🧹 icon)
