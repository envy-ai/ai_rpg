# Setting Creation Studio Brainstorm

This archive/design note expands the setting creation studio idea from
`user_experience_improvement_brainstorm.md`. It is not an implementation spec.
It records the rationale for a guided, previewable, validation-heavy authoring
experience for world profiles while reflecting the current World Profiles and
New Game implementation.

The current project already implements many pieces that an eventual studio would
use: reusable `SettingInfo` world profiles, the `/settings` World Profiles
editor, AI fill-missing flows, setting-local faction drafts, structured calendar
drafts, per-setting unified tonal scales, custom slop words, image prompt
prefixes, and New Game defaults. The remaining studio idea is mainly about
workflow, critique, validation, previews, staged AI edits, and a clearer handoff
from concept to playable game.

## Current Foundation

### World Profiles UI

`/settings` is the current authoring surface. It is a master/detail editor with
a world-profile library on the left and an editor on the right. The library
supports search, sort, and selection actions such as edit, apply, clone, and
delete. The editor has a sticky action bar for clear, create/update, and
auto-fill blank fields.

Current editor tabs are:

- Basics.
- New Game Defaults.
- Tone Scale.
- Factions.
- Character Options.
- Prompt Guidance.
- Optional mod-owned tabs.
- Calendar.
- Image Prefixes.

The editor persists successful creates/updates through the settings API and
applies the saved profile as the active world profile.

### SettingInfo Model

`SettingInfo` is the current world-profile model. It stores:

- Identity and world description fields.
- Currency, prompt guidance, writing style, and base-context preamble fields.
- Image prompt prefixes for characters, locations, items, and scenery.
- New-game defaults such as player defaults, starting level, starting currency,
  default starting-location instructions, available classes, available races,
  and `defaultExistingSkills`.
- Hide/perception selectors for current stealth-related mechanics.
- Setting-local faction draft count and faction draft data.
- Structured `calendarDefinition` drafts.
- Per-setting `unifiedTonalScale` selections.
- `customSlopWords`.
- Namespaced `modSettings`.

The active setting is used at runtime, saved under `setting.json`, and restored
when a save is loaded.

### Current AI Assistance

The current settings APIs already support useful authoring operations:

- `POST /api/settings/fill-missing` fills blank profile fields, accepts optional
  user instructions, accepts optional image input, preserves user-provided
  values, and can append setting-specific skills when requested.
- `POST /api/settings/factions/generate` returns setting-local faction drafts.
- `POST /api/settings/factions/fill-missing` fills one setting-local faction
  draft with sibling drafts as valid relation targets.
- `POST /api/settings/calendar/generate` returns a structured calendar draft.
- `GET /api/settings/calendar/default` returns the built-in Gregorian-style
  calendar draft.

These operations are field or section helpers, not a complete guided studio.
They should remain available even if a higher-level studio workflow is added.

### Current New Game Integration

`/new-game` requires an active setting. It uses active-setting data for player
defaults, class/race options, starting level, starting currency, starting
location instructions, available skill definitions, faction setup, and calendar
setup.

Faction setup loads active-setting `defaultFactions` first, up to the resolved
target count. `defaultFactionCount` controls the target when set; draft count and
config count are fallbacks. A target count of `0` disables faction setup.

Calendar setup uses the active setting's stored `calendarDefinition` when
present. Without a stored calendar draft, new-game setup runs calendar generation
and falls back to the built-in Gregorian-style calendar if generation fails. The
New Game form supports a one-based starting month/day and a start hour from `0`
through `23`, defaulting to the first day of the first month at hour `9`. Stored
calendar drafts provide month names and exact day counts in the form; otherwise
the month controls use ordinal placeholders until generation.

Saved New Game form profiles remain separate from settings. This is useful
because one world profile can support multiple protagonists and starts.

### Current Unified Tonal Scale

The unified tonal scale is first-class project data rather than only an
ad hoc prompt block. Current behavior:

- `defs/unified_tonal_scale.yaml` defines the shared axes.
- `UnifiedTonalScale.js` loads and validates the definition, generates half-step
  options, normalizes selections, and renders prompt markdown.
- `SettingInfo.unifiedTonalScale` stores per-setting selections and optional
  comments.
- The World Profiles Tone Scale tab renders merged axes from the definition.
- If any axis is selected, every axis must have a selected numeric level before
  saving.
- Empty selections render no tonal-scale prompt block.
- Rendered prompt text includes the full scale definitions plus the selected
  story notation and selected meaning table.
- `buildSettingPromptContext(...)` exposes the rendered block as
  `setting.unifiedTonalScalePrompt`.
- Current prompt templates insert that block in base-context, generic prompt
  without context, and slop-remover prompts before global extra system
  instructions.

`config.yaml` still contains legacy or profile-specific tonal text in some
global instruction fields, but the structured setting-level path is the YAML
definition plus `SettingInfo.unifiedTonalScale`.

## Core Problem

The current setup is powerful but still field-oriented. A user has to know which
fields matter, which fields feed prompts, which fields affect new-game
generation, which fields are optional, and what a coherent setting should
contain. AI fill-missing helps, but it mostly completes form fields. It does not
yet provide a guided path from concept to playable world with staged AI edits,
quality checks, generation previews, or readiness review.

The studio idea is to turn setting creation into a structured workflow:

- Start with a concept.
- Expand it into a coherent setting profile.
- Configure play defaults and rule expectations.
- Generate and review factions, skills, prompt guidance, image style, calendar
  assumptions, and starting situation.
- Validate coherence.
- Preview generated outputs without mutating live world state.
- Save, apply, and start a game with confidence.

## Goals

- Make settings easier to create, understand, reuse, and improve.
- Preserve the existing `SettingInfo` model where it already fits.
- Build on `/settings` and `/new-game` instead of replacing them prematurely.
- Make AI assistance visible, reviewable, and field-specific.
- Give users previews before committing to a new game.
- Reduce broken or incoherent new-game starts.
- Support both quick creation and expert editing.
- Keep settings setting-agnostic rather than genre-locked.
- Provide validation that catches missing or contradictory setup before world
  generation.
- Leave room for future optional rules modules such as tactical battles, journey
  risk, survival, factions, trade, or mystery clues.

## Non-Goals

- Do not replace all freeform setting fields with rigid forms.
- Do not require a long wizard for users who already know what they want.
- Do not auto-apply AI-generated settings without review.
- Do not silently fix invalid settings.
- Do not make setting authoring depend on image generation.
- Do not combine server config, per-game config overrides, and world profiles
  into one confusing editor.
- Do not require every future mechanics idea to exist before the studio is
  useful.

## Proposed Studio Modes

### Quick Start

For users who want a game fast:

- Enter a short concept.
- Pick or infer genre, tone, and difficulty.
- Let AI draft the rest.
- Review a compact summary and readiness warnings.
- Apply the setting and continue to New Game.

This mode should still show blocking errors and major warnings before world
generation.

### Guided Studio

A step-by-step workspace:

1. Concept.
2. World identity.
3. Player options.
4. Starting situation.
5. Skills and ability assumptions.
6. Factions.
7. Prompt guidance.
8. Tone scale.
9. Image style.
10. Calendar and time.
11. Rules modules.
12. Preview and validation.
13. Save, apply, and start.

Each step can be skipped, manually edited, or AI-assisted.

### Expert Editor

The current field-based World Profiles editor remains useful. Expert mode should
preserve direct access to all persisted fields and advanced sections such as
base-context preamble, image prefixes, custom slop words, mod settings, calendar
structure, and faction drafts.

### Iteration Mode

For existing settings:

- Analyze a profile.
- Show coherence issues.
- Suggest improvements.
- Preview changed prompts and generated samples.
- Save as a variant or update the current setting.

## Proposed Studio Sections

### 1. Concept Brief

Capture:

- One-sentence pitch.
- Genre and subgenres.
- Tone and themes.
- Player fantasy.
- Expected scale: personal, local, regional, global, cosmic.
- Conflict style: exploration, mystery, survival, political, tactical, social,
  horror, heroic, comedic, tragic.
- Inspiration notes.
- Hard exclusions.

AI can use this as the source brief for field generation. This is not currently
a persisted first-class field.

### 2. World Identity

Maps mostly to existing fields:

- Name.
- Description.
- Theme.
- Genre.
- Tone.
- Difficulty.
- Currency name and plural.
- Currency value notes.
- Writing style notes.
- Base-context preamble.

Potential enhancement:

- Show a generated setting-card preview summarizing what prompts will understand
  about the world.

### 3. Play Defaults

Maps to existing fields:

- Default player name and description.
- Player starting level.
- Default starting currency.
- Available classes.
- Available races.
- Starting location type.
- Start-time expectations through the New Game form.

Potential enhancements:

- Clarify which defaults are placeholders and which affect generation.
- Support named start profiles linked to a setting while keeping standalone New
  Game form saves.

### 4. Starting Situation

Current raw field:

- `defaultStartingLocation`.

Studio expansion:

- Starting region concept.
- Starting location concept.
- Why the player is there.
- Immediate threat or opportunity.
- Nearby safe place.
- Nearby danger.
- Region exits and stubs.
- Starting NPC expectations.
- Starting items or resources.
- Opening pressure: calm, urgent, mysterious, or dangerous.

The existing multiline starting-location instructions can remain the advanced
representation.

### 5. Skills And Character Options

Current fields:

- `defaultExistingSkills`.
- `availableClasses`.
- `availableRaces`.
- `characterGenInstructions`.
- Hide/perception attribute and skill selectors.

Studio expansion:

- Skill categories.
- Setting-specific skill suggestions.
- Warnings for too many or too few skills.
- Duplicate or near-duplicate skill detection.
- Attribute association preview if skill metadata exists or can be generated.
- Class/race recommendations.
- Optional no-class or no-race framing for modern or grounded settings.

### 6. Factions

Current features are already substantial:

- `defaultFactionCount`.
- `defaultFactions`.
- Pre-generate factions.
- Fill selected faction.
- Assets, relations, tags, goals, and reputation tiers.

Studio expansion:

- Faction role coverage: authority, underworld, labor, religion, science,
  rebels, locals, outsiders, monsters, corporations, noble houses, families,
  cults, and similar roles.
- Conflict map preview.
- Duplicate-role warnings.
- Reputation tier consistency checks.
- Starting-region faction relevance.
- Player-facing importance flags.
- Faction hooks and first-contact ideas.

### 7. Prompt Guidance

Current fields:

- Writing style notes.
- Base-context preamble.
- Character generation instructions.
- Custom slop words.
- Mod settings that affect prompts.

Studio expansion:

- Separate guidance into player-facing tone, GM behavior, content boundaries,
  genre tropes, and anti-tropes.
- Show where guidance appears in prompt context.
- Validate that base-context preamble stays concise enough for prompt use.
- Warn when guidance contradicts the selected tone scale or other profile
  fields.
- Suggest slop words based on genre and user preference.

### 8. Tone Scale

Current implementation provides the shared axes and per-setting selections. A
studio layer should focus on making that behavior easier to reason about:

- Show compact notation such as `I4-G2-S3-F2-U3`.
- Show all axis levels with selected levels highlighted.
- Show the exact prompt block that will be injected.
- Generate a short "what this means for this setting" explanation.
- Highlight contradictions, such as grave seriousness plus prompt guidance
  requesting constant jokes.
- Explain that blank tone-scale selections currently omit the tonal-scale prompt
  block rather than applying a hidden default.

Potential future decisions:

- Whether to make a complete tone-scale selection required for all saved
  settings.
- Whether to inject the rendered block into more prompt types, such as
  region/location/NPC generation and event-check prompts.
- Whether global config should retain legacy tonal text once structured
  per-setting selections are widely used.

### 9. Image Style

Current fields:

- Character image prompt prefix.
- Location image prompt prefix.
- Item image prompt prefix.
- Scenery image prompt prefix.

Studio expansion:

- Unified art direction brief.
- Per-category overrides.
- Style presets or text swatches.
- Negative guidance.
- Composition preferences.
- Setting-specific visual motifs.
- Preview prompt examples.

Image generation itself can stay optional.

### 10. Calendar And Time

Current behavior:

- World profiles can persist a structured `calendarDefinition`.
- The settings page has a structured calendar editor.
- The settings API can generate a calendar draft or return a default
  Gregorian-style draft.
- New-game setup uses the stored calendar when present, otherwise generates one
  and falls back to the built-in Gregorian-style calendar.
- The New Game form chooses a start hour.

Studio expansion:

- Calendar preference summary: Gregorian, custom, inherit from setting, or no
  strong preference.
- Season names and descriptions.
- Holiday expectations.
- Day/night tone and lighting descriptions.
- Starting date/time defaults beyond a single hour.
- Warnings when the concept implies Earth-like assumptions but calendar guidance
  is missing.

### 11. Rules Modules

Future-facing but useful as studio metadata or prompt guidance:

- Survival and journey risk.
- Tactical battles.
- Faction operations.
- Relationship arcs.
- Mystery clue tracking.
- Horror stress or sanity.
- Trade and economy.
- Vehicles.
- Downtime projects.

The first version does not need active mechanics for each module. The useful
part is declaring what kinds of systems should matter in this setting.

### 12. Preview And Validation

This is the most important studio addition.

Preview examples:

- Base setting card.
- Unified tone-scale prompt block and selected notation.
- Base-context preamble.
- Starting location generation instructions.
- Sample starting region outline.
- Sample NPC concept.
- Sample item or scenery prompt.
- Sample faction summary.
- Sample opening situation.
- Skill list coverage.
- Image prompt examples.

Validation examples:

- Missing required fields.
- Too little description for AI generation.
- Contradictory tone, theme, genre, or difficulty.
- Contradictory tone-scale selections and prompt guidance.
- Empty or baseline-only skills.
- Invalid faction relations.
- Duplicate faction names or roles.
- Missing reputation tiers.
- Starting location instructions too vague.
- Base-context preamble too verbose.
- Image prefixes empty when image generation is likely enabled.
- Custom slop words malformed.
- Empty class/race lists in settings that appear to expect them.
- Calendar references that are invalid or inconsistent.

Validation should show errors, warnings, and suggestions separately.

## AI Assistance Model

### Field-Level Fill

Current fill-missing behavior should remain:

- Fill blank fields.
- Use optional user instructions.
- Use optional image input.
- Preserve user-provided values.
- Optionally augment default skills.

### Section-Level Generation

The studio could add section-specific AI:

- Generate factions from a concept.
- Generate a skill list.
- Generate image style.
- Generate starting situation.
- Generate prompt guidance.
- Generate or revise calendar assumptions.

Section generation should explain what changed and allow accept/reject per
field.

### Whole-Setting Draft

Given a concept brief, draft a full setting. The result should be staged for
review, not directly saved over an existing setting.

### Critique Pass

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
- Calendar assumptions that do not match the setting.

Critique should produce suggestions, not direct edits unless the user requests
applying them.

### Preview Generation

Use AI to generate samples without mutating world state:

- Example opening paragraph.
- Example generated location.
- Example NPC.
- Example faction conflict.
- Example random event.

These should be dry-run previews and must not create live world objects.

## Data Model Ideas

Already implemented and should be reused:

- `unifiedTonalScale`.
- `calendarDefinition`.
- `defaultFactions`.
- `defaultFactionCount`.
- `customSlopWords`.
- `modSettings`.
- New-game default fields.
- Image prompt prefix fields.

Potential additions for a future studio:

- `conceptBrief`.
- `hardExclusions`.
- `startingSituationNotes`.
- `ruleModulePreferences`.
- `artDirection`.
- `validationNotes`.
- `studioVersion`.
- `settingVersion`.
- `parentSettingId`.
- `previewArtifacts`.
- `namedStartProfiles`.

These should not be added casually. Many can start as derived UI state or
optional metadata until a concrete implementation needs persistence.

## API Ideas

Current endpoints that can power a first studio layer:

- `POST /api/settings/fill-missing`.
- `POST /api/settings/factions/generate`.
- `POST /api/settings/factions/fill-missing`.
- `GET /api/settings/calendar/default`.
- `POST /api/settings/calendar/generate`.
- `POST /api/settings`.
- `PUT /api/settings/:id`.
- `POST /api/settings/:id/clone`.
- `POST /api/settings/:id/save`.
- `POST /api/settings/:id/apply`.
- `POST /api/new-game/settings/save`.
- `POST /api/new-game/settings/load`.
- `GET /api/new-game/settings/saves`.

Possible future endpoints:

- `POST /api/settings/studio/draft`.
- `POST /api/settings/studio/critique`.
- `POST /api/settings/studio/validate`.
- `POST /api/settings/studio/preview/tone-scale`.
- `POST /api/settings/studio/preview/start-location`.
- `POST /api/settings/studio/preview/npc`.
- `POST /api/settings/studio/preview/faction-conflict`.
- `POST /api/settings/studio/section/:sectionName/fill`.

## UI Ideas

### Studio Workspace

Possible layout:

- Left: setting library and version/history list.
- Center: current studio step or editor.
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
- Tone.
- Images.
- Calendar.
- Preview.

Each step shows completion state and validation count.

### Expert Field Mode

Expert mode shows the current tabbed editor style and every persisted field.
This preserves fast editing for advanced users.

### Diff And Accept/Reject

AI generation should produce a diff:

- Added.
- Changed.
- Unchanged.
- Needs review.

Users can accept or reject by field or by section.

### Preview Panel

The preview panel can show:

- Sample generated text.
- Prompt snippets.
- Field-derived summaries.
- Faction relationship map.
- Skill list warnings.
- New-game readiness checklist.

### Start Game Handoff

When a setting validates cleanly, the studio can hand off to `/new-game` with:

- Applied setting.
- Pre-filled player defaults.
- Starting situation.
- Recommended start time.
- Optional saved New Game form profile.

## Validation And Quality Checks

### Structural Validation

Current model/API validation already covers much of this:

- Required name.
- Numeric defaults.
- Faction ids, names, relations, and tiers.
- String lists.
- Calendar shape.
- Tone-scale selection shape and prompt-render validation.
- Mod-settings object shape.
- Settings persistence.

### Coherence Validation

Possible studio checks:

- Theme, genre, and tone are not empty.
- Description is long enough to guide generation.
- Difficulty has gameplay meaning.
- Starting location instructions include region, summary, locations or rooms, and
  exits.
- Skill list has enough breadth.
- Faction count matches faction drafts or intentionally leaves room for
  generated factions.
- Factions have distinct names and roles.
- Prompt guidance does not contradict tone, genre, or tone-scale selections.
- Image prefixes agree with art direction.
- Calendar expectations match the setting concept.

### Readiness State

A readiness indicator can be useful if it stays explanatory:

- Ready to start.
- Usable with warnings.
- Needs attention.
- Invalid.

Avoid opaque numeric scores. Show concrete findings.

## Versioning And Reuse

Useful workflows:

- Clone a setting as a new variant.
- Save versions with notes.
- Compare current draft to saved version.
- Export/import setting JSON.
- Mark favorites.
- Track which saves used which setting id/version.

Clone and rename-as-new-id behavior already exists and can inform versioning,
but users need clearer intent: rename, clone, fork, update current, or save a
new version.

## Integration With New Game

The studio should reduce duplication with `/new-game`, not hide the player setup
workflow.

Possible handoff:

- Apply setting and configure player.
- Start with defaults.
- Save this player start profile.
- Preview opening setup first.

New Game saved form configurations remain useful because the same setting can
support multiple protagonists or starts.

## Error Handling Principles

- Invalid AI output should fail with a visible error and logged prompt.
- Section generation should preserve user-provided fields unless explicitly
  replacing them.
- Validation should block only true errors; warnings should be reviewable.
- Preview generation should not mutate live settings unless accepted.
- Starting a game should still fail loudly if strict lifecycle validation fails.
- No fallback setting should be silently substituted.

## Testing Ideas

Unit-level:

- Setting validation rules.
- Unified tone-scale validation and prompt rendering.
- Calendar draft validation.
- Section payload normalization.
- Faction draft validation.
- Skill list parsing.
- Diff generation for AI suggestions.
- Readiness summary construction.

Integration:

- Draft setting from concept.
- Fill missing fields with image input.
- Generate factions and apply them to a setting.
- Generate and save a calendar draft.
- Validate incomplete setting.
- Save/apply setting.
- Handoff to New Game form.
- Start a game from a studio-authored setting.

Playwright:

- Create setting through guided flow.
- Switch to expert mode.
- Generate/fill section.
- Accept/reject AI changes.
- Pre-generate factions.
- View validation/readiness panel.
- Apply setting and navigate to New Game.
- Confirm mobile layout remains usable.

Fixtures:

- Minimal valid setting.
- Empty/incomplete setting.
- Setting with unified tone-scale selections.
- Faction-heavy setting.
- Modern no-class/no-race setting.
- Earth-like setting.
- Custom-calendar setting.
- Image-style-heavy setting.

## Rollout Options

### Slice 1: Readiness And Preview Panel

Add validation/readiness and preview summaries to the existing World Profiles
editor.

Pros:

- Builds on current UI.
- Gives immediate value.
- Does not require a new persistence model.

Cons:

- Still is not a full studio.

### Slice 2: Guided Concept-To-Setting Draft

Add a concept brief and whole-setting draft flow that stages AI-generated fields
for review.

Pros:

- Big improvement for new users.

Cons:

- Needs diff/accept UI.

### Slice 3: Section-Level Studio Tabs

Turn existing tabs into studio sections with validation, suggestions, and
previews.

Pros:

- Preserves current structure while improving guidance.

Cons:

- More UI complexity.

### Slice 4: New Game Handoff

Let users apply a validated setting and move into `/new-game` with defaults and
optional saved form profile.

Pros:

- Connects authoring to play.

Cons:

- Needs careful state handoff and confirmation.

### Slice 5: Versions, Exports, And Advanced Previews

Add setting versions, compare, import/export, and dry-run generated samples.

Pros:

- Strong reuse and iteration support.

Cons:

- More persistence and UI work.

## Strong First Implementation Candidate

The strongest first feature remains a studio-style readiness and preview panel
inside the existing World Profiles editor:

- Analyze current setting fields.
- Show errors, warnings, and suggestions.
- Preview setting card, tone-scale prompt block, starting instructions, skills,
  factions, prompt guidance, calendar summary, and image style.
- Offer targeted fill-this-section actions.
- Reuse current settings, factions, calendar, and fill-missing APIs.
- Do not change the persistence model.
- Do not alter `/new-game` yet.

This validates the studio direction while reusing the current settings manager
and avoiding a large route/UI rewrite.

## Open Questions For A Future Spec

1. Should the studio replace `/settings` or become a mode within it?
2. Should setting versions be first-class, or should clone/rename-as-new-id
   remain the versioning mechanism?
3. Should named New Game starts be attached to settings, remain separate saved
   form settings, or support both?
4. Should rules modules be real config fields or prompt guidance at first?
5. Should AI whole-setting draft overwrite blank fields only or stage a full
   proposed setting?
6. Should preview generation use forced dry-run prompts that never mutate world
   state?
7. How should modern settings represent empty class/race lists without looking
   incomplete?
8. Should image input guide only AI fill-missing, or become a persistent visual
   reference for the setting?
9. Which validations should block starting a game versus warn only?
10. Should complete tone-scale selections become required for all settings?
11. Should tone-scale prompt injection expand beyond the current base/generic
    prompt and slop-remover paths?
12. Should legacy tonal text in global config be removed once per-setting tone
    scale usage is mature?
