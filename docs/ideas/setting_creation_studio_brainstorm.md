# Setting Creation Studio Brainstorm

This document expands the setting creation studio idea from `user_experience_improvement_brainstorm.md`. It is a brainstorm, not an implementation spec. The core premise is a guided, previewable, validation-heavy authoring experience for settings that brings together the current settings manager, new-game defaults, AI fill-missing flows, factions, skills, prompt guidance, image style, calendars, and startup conditions.

## Current setup

The current setting creation flow is split across two major surfaces.

### `/settings`

The settings manager already supports:

- A master-detail library/editor layout.
- Search and sort by setting metadata.
- Selection actions: edit, apply, clone, delete.
- Tabbed editor sections: Basics, New Game Defaults, Factions, Character Options, Prompt Guidance, Image Prefixes.
- Basic identity fields such as name, description, theme, genre, tone, difficulty, starting location type, classes, and races.
- New-game defaults such as player defaults, starting currency, starting location generation instructions, default skills, faction count, and faction drafts.
- Settings-local faction editor with assets, relations, reputation tiers, pre-generation, and AI fill-missing.
- Prompt guidance fields such as writing style, character generation instructions, base-context preamble, and custom slop words.
- Image prompt prefixes for characters, locations, items, and scenery.
- AI fill-missing for settings, with optional user instructions and optional image input.
- Persistence, clone, rename-as-new-id, apply, and delete behavior.

`config.yaml` also currently contains an ad hoc unified tonal scale in prompt instructions. It uses notation like `I#-G#-S#-F#` for Idealism, Grit, Seriousness, and Focus. That scale has worked well enough that it should become first-class setting data rather than remaining buried in global prompt text.

### `/new-game`

The new-game page already supports:

- Player name, description, class, race, level, start time, starting currency, and starting location instructions.
- Attribute and skill allocation with formula-derived pools.
- Skills sourced from the active setting's `defaultExistingSkills`.
- Saved new-game form configurations.
- Default starting location instructions inherited from the active setting.
- Generation progress events after submission.

### Server/model support

Current server and model support includes:

- `SettingInfo` fields for identity, prompt/style guidance, image prefixes, defaults, skills, factions, custom slop words, classes, and races.
- Settings APIs for CRUD, apply, save/load, AI fill-missing, faction fill-missing, and faction pre-generation.
- New-game APIs for form settings save/load and game generation.
- New-game setup that uses active-setting faction defaults, default faction count, default skills, world calendar generation, starting location instructions, and player startup defaults.

## Core problem

The current setup is powerful but field-oriented. A user has to know which fields matter, which fields feed prompts, which fields affect new-game generation, which fields are optional, and what a coherent setting should contain. AI fill-missing helps, but it is mostly a form completion operation. It does not yet feel like a guided setting design process with previews, quality checks, generation dry-runs, or a clear path from concept to playable world.

The studio idea is to turn setting creation into a structured workflow:

- Start with a concept.
- Expand it into a coherent setting profile.
- Configure play defaults and rule expectations.
- Generate and review factions, skills, prompt guidance, image style, calendar assumptions, and starting situation.
- Validate coherence.
- Preview generated outputs.
- Save, version, apply, and start a game with confidence.

## Goals

- Make settings easier to create, understand, reuse, and improve.
- Preserve the existing `SettingInfo` model where it already fits.
- Unify `/settings` and `/new-game` concepts without removing either surface immediately.
- Make AI assistance visible, reviewable, and field-specific.
- Give users previews before committing to a new game.
- Reduce broken or incoherent new-game starts.
- Support both quick creation and expert editing.
- Keep settings setting-agnostic, not genre-locked.
- Provide validation that catches missing or contradictory setup before world generation.
- Support future optional rules modules such as tactical battles, journey risk, survival, factions, or mystery clues.

## Non-goals

- Do not replace all freeform setting fields with rigid forms.
- Do not require a long wizard for users who already know what they want.
- Do not make AI-generated settings auto-apply without review.
- Do not silently "fix" invalid settings.
- Do not make setting authoring depend on image generation.
- Do not combine server config, per-game config overrides, and settings into one confusing editor.
- Do not require every future mechanics idea to be implemented before the studio is useful.

## Studio modes

### Quick start

For users who want a game fast:

- Enter a short concept.
- Pick or infer genre/tone/difficulty.
- Let AI draft the rest.
- Review a short summary.
- Start a game.

This mode should still expose warnings before generation if major fields are missing.

### Guided studio

A step-by-step workspace:

1. Concept.
2. World identity.
3. Player options.
4. Starting situation.
5. Skills and abilities assumptions.
6. Factions.
7. Prompt guidance.
8. Universal tone scales.
9. Image style.
10. Calendar/time.
11. Rules modules.
12. Preview and validation.
13. Save/apply/start.

Each step can be skipped, manually edited, or AI-assisted.

### Expert editor

The current field-based settings editor remains useful. Expert mode should preserve direct access to all fields and raw-ish advanced sections such as prompt preamble, image prefixes, custom slop words, and faction drafts.

### Iteration mode

For existing settings:

- Analyze a setting.
- Show coherence issues.
- Suggest improvements.
- Preview changed prompts/generation.
- Save as a new version or update the current setting.

## Suggested studio sections

### 1. Concept brief

Capture:

- One-sentence pitch.
- Genre and subgenres.
- Tone.
- Themes.
- Player fantasy.
- Expected scale: local, regional, global, cosmic, personal.
- Conflict style: exploration, mystery, survival, political, tactical, social, horror, heroic, comedic, tragic.
- Inspiration notes.
- Hard exclusions.

AI can use this as the source brief for field generation.

### 2. World identity

Maps mostly to existing fields:

- Name.
- Description.
- Theme.
- Genre.
- Tone.
- Difficulty.
- Currency name/plural.
- Currency value notes.
- Writing style notes.
- Base-context preamble.

Potential enhancement:

- Show a generated "setting card" preview that summarizes what the LLM will understand about the world.

### 3. Play defaults

Maps to:

- Default player name/description.
- Player starting level.
- Default starting currency.
- Available classes.
- Available races.
- Starting location type.
- Start-time expectations.

Potential enhancement:

- Clarify which defaults are just placeholders and which affect generation.
- Allow multiple starting templates per setting.

### 4. Starting situation

Current field:

- `defaultStartingLocation`

Studio expansion:

- Starting region concept.
- Starting location concept.
- Why the player is there.
- Immediate threat/opportunity.
- Nearby safe place.
- Nearby danger.
- Region exits/stubs.
- Starting NPC expectations.
- Starting items/resources.
- Whether the opening is calm, urgent, mysterious, or dangerous.

The current multiline starting-location template can remain the raw advanced representation.

### 5. Skills and character options

Current fields:

- `defaultExistingSkills`
- `availableClasses`
- `availableRaces`
- character generation instructions

Studio expansion:

- Skill categories.
- Setting-specific skill suggestions.
- Warnings for too many/too few skills.
- Duplicate/near-duplicate skill detection.
- Attribute association preview if skill metadata exists or can be generated.
- Class/race recommendations.
- Optional "no race/class assumptions" mode for modern or grounded settings.

### 6. Factions

Current features are already strong:

- `defaultFactionCount`
- `defaultFactions`
- pre-generate factions
- fill selected faction
- relation and reputation tiers

Studio expansion:

- Faction role coverage: authority, underworld, labor, religion, science, rebels, locals, outsiders, monsters, corporations, noble houses, families, cults, etc.
- Conflict map preview.
- Duplicate-role warnings.
- Reputation tier consistency checks.
- Starting-region faction relevance.
- "Player-facing importance" flags.
- Faction hooks and first-contact ideas.

### 7. Prompt guidance

Current fields:

- writing style notes
- base-context preamble
- character generation instructions
- custom slop words

Studio expansion:

- Separate guidance into player-facing tone, GM behavior, content boundaries, genre tropes, and anti-tropes.
- Show how guidance appears in base context or image prompts.
- Validate that base-context preamble follows expected concise bracketed style.
- Warn when guidance contradicts other fields.
- Suggest slop words based on genre and user preference.

### 8. Universal tone scales

The universal tone scales from `config.yaml` should become real setting fields. These are stronger than a freeform `tone` string because they define a shared tonal coordinate system and explain what adjacent or opposite settings mean.

Prototype axes from the current config:

#### Idealism: how the universe treats hope

| Level | Name | Description |
|-------|------|-------------|
| 1 | Grimdark | Hope is a trap. Good people lose. Virtue is punished or mocked. |
| 2 | Cynical | Systems are corrupt. Small victories possible but costly. Trust is weakness. |
| 3 | Mixed | Good struggles. Sometimes wins, sometimes pays. World is compromised but not hopeless. |
| 4 | Hopeful | Virtue usually rewarded. Darkness is beatable. Effort and courage matter. |
| 5 | Idealistic | Good triumphs. People are redeemable. The universe validates hope. |

#### Grit: how the world looks and feels

| Level | Name | Description |
|-------|------|-------------|
| 1 | Pristine | Clean, bright, stylized. Adventure-ready. Consequences are aesthetic. |
| 2 | Polished | Mostly appealing with realistic touches. Wear shows but does not overwhelm. |
| 3 | Lived-in | Realistic decay and consequence. Bodies leave stains. History accumulates. |
| 4 | Grimy | Oppressive atmosphere. Decay visible everywhere. Survival is messy. |
| 5 | Brutal | Everything is broken, dirty, dying. The world itself is hostile. |

#### Seriousness: how heavily content is treated

| Level | Name | Description |
|-------|------|-------------|
| 1 | Farce | Nothing is serious, including stakes. Rule of Funny overrides all. |
| 2 | Comic Relief | Stakes are real but humor is very frequent. Comedy serves the story and does not undermine it. |
| 3 | Balanced | Equal weight to light and heavy moments. Tonal shifts are deliberate. |
| 4 | Sober | Humor is rare and pointed. Most content carries weight. |
| 5 | Grave | Everything is serious. No relief. Consequences are absolute. |

#### Focus: adventure vs. romance

| Level | Name | Description |
|-------|------|-------------|
| 1 | Adventure-Dominant | Plot drives everything. Romance is absent or incidental. Action, exploration, and external conflict are primary. |
| 2 | Adventure-Heavy | Romance exists as subplot or character flavor. The adventure is the main story; relationships develop alongside it. Characters are designed around being interesting, independent people rather than romantic interests for the player character. |
| 3 | Balanced | Adventure and romance receive roughly equal weight. Either can drive a scene. Combat and intimacy both matter. |
| 4 | Romance-Heavy | Adventure serves as backdrop for relationship development. The love story is the story. |
| 5 | Romance-Dominant | Pure relationship focus. Adventure is minimal window dressing for intimate encounters. |

Studio behavior:

- Let each setting choose values on each axis, including decimal values when useful, such as `3.5`.
- Show the compact notation, such as `I4-G2-S3-F2`, as a setting summary.
- Let users edit per-level descriptions or define custom axes later, but start with the universal built-in scale.
- Generate a short "what this means for this setting" summary for each selected axis.
- Highlight contradictions, such as `Grave` seriousness with prompt guidance asking for constant jokes.
- Keep the existing freeform `tone` field as a natural-language label, but derive prompt-facing tonal guidance from the scales.

Prompt contract:

- Prompts should include the full scale definitions, not only the selected values.
- The selected values should be called out separately after the full scale.
- The full scale matters because the narrator needs to know what *not* to do: for example, `Focus 2` means avoid `Focus 4-5` romance-dominant assumptions, not merely "include some adventure."
- The scale block should be available to narrator prompts, event/narrative prompts, NPC generation, region/location generation, and any prompt where tone drift is likely.
- Prompt templates should avoid duplicating stale hardcoded scale text; they should render from setting data.
- If no setting-level tone scale exists, use a default universal scale rather than silently omitting tonal guidance.

Potential UI:

- Four sliders or segmented controls with labels and descriptions visible at every level.
- A compact notation preview.
- A full-scale preview showing all levels, with selected levels highlighted.
- A "narrator prompt preview" showing exactly what will be injected into prompts.
- A warning when freeform prompt guidance contradicts the selected scale.

### 9. Image style

Current fields:

- Character image prompt prefix.
- Location image prompt prefix.
- Item image prompt prefix.
- Scenery image prompt prefix.

Studio expansion:

- Unified art direction brief.
- Per-category overrides.
- Style swatches or text presets.
- Negative guidance.
- Composition preferences.
- Setting-specific visual motifs.
- Preview prompt examples.

Image generation itself can stay optional.

### 10. Calendar and time

Current behavior:

- New-game setup generates a calendar via LLM.
- Earth-like settings are instructed to use Gregorian.
- Fallback Gregorian calendar exists.
- New-game page chooses a start hour.

Studio expansion:

- Calendar preference: Gregorian, custom, inherit from setting, no strong preference.
- Season names/descriptions.
- Holiday expectations.
- Day/night tone and light descriptions.
- Starting date/time defaults.
- Warnings when setting concept implies Earth but calendar guidance is missing.

Potential future field:

- A setting-level calendar draft that new-game can use before falling back to generation.

### 11. Rules modules

Future-facing but valuable as a studio concept:

- Survival/journey risk.
- Tactical battles.
- Faction operations.
- Relationship arcs.
- Mystery clue tracking.
- Horror stress/sanity.
- Trade/economy.
- Vehicles.
- Downtime projects.

For now, this can be metadata or guidance rather than active mechanics. The important thing is to let a setting declare what kinds of systems should matter.

### 12. Preview and validation

The most important studio addition.

Preview examples:

- Base setting card.
- Universal tone scale block and selected notation.
- Base-context preamble.
- Starting location generation instructions.
- Sample starting region outline.
- Sample NPC concept.
- Sample item/scenery prompt.
- Sample faction summary.
- Sample opening situation.
- Skill list coverage.
- Image prompt examples.

Validation examples:

- Missing required fields.
- Too little description for AI generation.
- Contradictory tone/theme/difficulty.
- Contradictory universal tone scale and prompt guidance.
- Missing tone-scale selection when the setting expects structured tone guidance.
- Empty or baseline-only skills.
- Invalid faction relations.
- Duplicate faction names.
- Missing reputation tiers.
- Starting location instructions too vague.
- Base-context preamble too verbose.
- Image prefixes empty when image generation is likely enabled.
- Custom slop words malformed.
- Class/race lists empty when the setting expects them.

Validation should show errors, warnings, and suggestions separately.

## AI assistance model

### Field-level fill

Current fill-missing behavior is useful and should remain:

- Fill blank fields.
- Use optional user instructions.
- Use optional image input.
- Preserve user-provided values.

### Section-level generation

The studio could add section-specific AI:

- Generate factions from concept.
- Generate skill list.
- Generate image style.
- Generate starting situation.
- Generate prompt guidance.
- Generate calendar draft.

Section generation should explain what changed and allow accept/reject per field.

### Whole-setting draft

Given a concept brief, draft a full setting. The result should be staged for review, not directly saved over an existing setting.

### Critique pass

Ask AI to critique a setting for:

- Missing pieces.
- Contradictions.
- Generic language.
- Overloaded skills.
- Weak starting situation.
- Faction gaps.
- Image style inconsistency.
- Genre drift.
- Tone-scale drift or contradictions.

Critique should produce suggestions, not direct edits unless the user requests applying them.

### Preview generation

Use AI to generate samples without mutating world state:

- Example opening paragraph.
- Example generated location.
- Example NPC.
- Example faction conflict.
- Example random event.

These should be dry-run previews and must not create live world objects.

## Data model ideas

Existing `SettingInfo` covers much of the required data. Potential additions for later:

- `conceptBrief`
- `hardExclusions`
- `toneScales`
- `toneScaleSelections`
- `toneScaleSummary`
- `toneScalePromptPolicy`
- `ruleModulePreferences`
- `calendarPreference`
- `calendarDraft`
- `startingSituationNotes`
- `artDirection`
- `validationNotes`
- `studioVersion`
- `settingVersion`
- `parentSettingId`
- `previewArtifacts`

These should not be added casually. Many can start as derived UI state or optional metadata until a concrete implementation needs persistence.

## API ideas

Possible future endpoints:

- `POST /api/settings/studio/draft`
- `POST /api/settings/studio/critique`
- `POST /api/settings/studio/validate`
- `POST /api/settings/studio/tone-scales/preview`
- `POST /api/settings/studio/preview/start-location`
- `POST /api/settings/studio/preview/npc`
- `POST /api/settings/studio/preview/faction-conflict`
- `POST /api/settings/studio/section/:sectionName/fill`

Current endpoints can still power much of the first version:

- `POST /api/settings/fill-missing`
- `POST /api/settings/factions/generate`
- `POST /api/settings/factions/fill-missing`
- `POST /api/settings`
- `PUT /api/settings/:id`
- `POST /api/settings/:id/apply`
- `POST /api/new-game/settings/save`
- `POST /api/new-game/settings/load`

## UI ideas

### Studio workspace

Possible layout:

- Left: setting library and version/history list.
- Center: current studio step/editor.
- Right: validation, preview, AI suggestions, and changed fields.

### Stepper

A stepper helps casual users:

- Concept.
- World.
- Player.
- Start.
- Skills.
- Factions.
- Guidance.
- Images.
- Calendar.
- Preview.

Each step shows completion state and validation count.

### Expert field mode

Expert mode shows the current tabbed editor style and every persisted field. This preserves fast editing for advanced users.

### Diff and accept/reject

AI generation should produce a diff:

- Added.
- Changed.
- Unchanged.
- Needs review.

Users can accept/reject by field or by section.

### Preview panel

The preview panel can show:

- Sample generated text.
- Prompt snippets.
- Field-derived summaries.
- Faction relationship map.
- Skill list warnings.
- New-game readiness checklist.

### Start game handoff

When a setting validates cleanly, the studio can hand off to `/new-game` with:

- Applied setting.
- Pre-filled player defaults.
- Starting situation.
- Recommended start time.
- Optional saved new-game form profile.

## Validation and quality checks

### Structural validation

Already mostly model-backed:

- Required name.
- Numeric defaults.
- Faction ids/names/relations.
- String lists.
- Settings persistence.

### Coherence validation

Possible checks:

- Theme/genre/tone are not empty.
- Description is long enough to guide generation.
- Difficulty has gameplay meaning.
- Starting location instructions include region, summary, locations/rooms, and exits.
- Skill list has enough breadth.
- Faction count matches faction drafts or intentionally leaves room for generated factions.
- Factions have distinct names and roles.
- Prompt guidance does not contradict tone/genre.
- Image prefixes agree with art direction.

### Readiness score

A readiness indicator can be useful if it stays explanatory:

- Ready to start.
- Usable with warnings.
- Needs attention.
- Invalid.

Avoid opaque numeric scores. Show concrete findings.

## Versioning and reuse

Useful workflows:

- Clone setting as new variant.
- Save versions with notes.
- Compare current draft to saved version.
- Export/import setting JSON.
- Mark favorites.
- Track which saves used which setting id/version.

Rename-as-new-id already exists and can inform versioning, but users need clearer intent: rename, clone, fork, update current.

## Integration with new-game form

The studio should reduce duplication with `/new-game`, not hide the player setup workflow.

Possible handoff:

- "Apply setting and configure player."
- "Start with defaults."
- "Save this player start profile."
- "Preview opening setup first."

New-game saved form configs remain useful because the same setting can support multiple protagonists or starts.

## Error handling principles

- Invalid AI output should fail with a visible error and logged prompt.
- Section generation should preserve user-provided fields unless explicitly replacing them.
- Validation should block only true errors; warnings should be reviewable.
- Preview generation should not mutate live settings unless accepted.
- Starting a game should still fail loudly if strict lifecycle validation fails.
- No fallback setting should be silently substituted.

## Testing ideas

Unit-level:

- Setting validation rules.
- Universal tone scale validation and prompt rendering.
- Section payload normalization.
- Faction draft validation.
- Skill list parsing.
- Diff generation for AI suggestions.
- Readiness summary construction.

Integration:

- Draft setting from concept.
- Fill missing fields with image input.
- Generate factions and apply to setting.
- Validate incomplete setting.
- Save/apply setting.
- Handoff to new-game form.
- Start new game from studio-authored setting.

Playwright:

- Create setting through guided flow.
- Switch to expert mode.
- Generate/fill section.
- Accept/reject AI changes.
- Pre-generate factions.
- View validation/readiness panel.
- Apply setting and navigate to new game.
- Confirm mobile layout remains usable.

Fixtures:

- Minimal valid setting.
- Empty/incomplete setting.
- Setting with universal tone scales.
- Faction-heavy setting.
- Modern no-class/no-race setting.
- Earth-like setting.
- Custom-calendar setting.
- Image-style-heavy setting.

## Rollout options

### Slice 1: Readiness and preview panel

Add validation/readiness and preview summaries to the existing settings editor.

Pros:
- Builds on current UI.
- Gives immediate value.

Cons:
- Does not yet feel like a studio.

### Slice 2: Guided concept-to-setting draft

Add a concept brief and whole-setting draft flow that stages AI-generated fields for review.

Pros:
- Big improvement for new users.

Cons:
- Needs diff/accept UI.

### Slice 3: Section-level studio tabs

Turn existing tabs into studio sections with validation, suggestions, and previews.

Pros:
- Preserves current structure while improving guidance.

Cons:
- More UI complexity.

### Slice 4: New-game handoff

Let users apply a validated setting and move into `/new-game` with defaults and optional saved form profile.

Pros:
- Connects authoring to play.

Cons:
- Needs careful state handoff and confirmation.

### Slice 5: Versions, exports, and advanced previews

Add setting versions, compare, import/export, and dry-run generated samples.

Pros:
- Strong reuse and iteration support.

Cons:
- More persistence and UI work.

## Strong first implementation candidate

The strongest first feature would likely be a studio-style readiness and preview panel inside the existing settings editor:

- Analyze current setting fields.
- Show errors, warnings, and suggestions.
- Preview setting card, universal tone scale prompt block, starting instructions, skills, factions, prompt guidance, and image style.
- Offer targeted "fill this section" actions.
- Do not change the persistence model.
- Do not alter `/new-game` yet.

This validates the studio direction while reusing the current settings manager and avoiding a large route/UI rewrite.

## Open questions for a future spec

1. Should the studio replace `/settings` or become a mode within it?
2. Should setting versions be first-class, or should clone/rename-as-new-id remain the versioning mechanism?
3. Should calendar drafts be persisted on settings or generated only during new game?
4. Should rules modules be real config fields or prompt guidance at first?
5. Should AI whole-setting draft overwrite blank fields only or stage a full proposed setting?
6. Should preview generation use forced dry-run prompts that never mutate world state?
7. Should new-game saved form settings be attached to settings as named starts?
8. How should modern settings represent empty class/race lists without looking incomplete?
9. Should image input guide only AI fill-missing, or become a persistent visual reference for the setting?
10. Which validations should block starting a game versus warn only?
11. Should universal tone scales be editable globally, per setting, or both?
12. Which prompt types must receive the full tone scale block in version one?
