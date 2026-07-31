# Need Bar: Lust Mod

`mods/need-bar-lust` is a defs-only mod. Its `defs/` overlay contributes a sexual-satisfaction need bar. Optional sexually proactive player-action guidance belongs to the separate `mods/nsfw-boost` runtime mod.

## Enablement

The mod has no `config.json`, presets, public assets, or mod-owned prompt templates. Mod discovery treats missing enablement flags as enabled, so the mod is active unless runtime config disables it with `mods.need-bar-lust.enabled: false`.

When enabled, its defs overlay participates in the normal alphabetical definition merge. The mod has no `mod.js` runtime hooks.

## Need-Bar Definition

`defs/need_bars.yaml` defines the `sex` need bar:

- Display name: `Sexual Satisfaction`
- Audience: player, party NPCs, and non-party NPCs
- Related attribute: `charisma`
- Icon/color: `💋`, `#FF69B4`
- Range and starting value: `0` to `1000`, starting at `1000`
- Passive drift: `change_per_minute: -0.3`
- Scaling: `relative_to_level: false`

Higher values mean the character is sexually satisfied. Lower values mean increasing arousal, frustration, or desperation. The mod's trigger lists follow that meaning: `increase` entries restore or satisfy the bar, while `decrease` entries represent turn-ons, teasing, aphrodisiacs, abstinence, or other arousal sources.

The bar overrides magnitude values for event-driven need updates:

| Direction | Small | Medium | Large |
| --- | ---: | ---: | ---: |
| `increase` | `100` | `250` | `700` |
| `decrease` | `10` | `50` | `150` |

`fill_completely` maps to a full restore. The shared need-bar event pipeline also accepts `all` / `full`-style magnitudes for min/max adjustments.

Effect thresholds are:

| Value | Name |
| ---: | --- |
| `0` | Desperate |
| `10` | Frustrated |
| `250` | Horny |
| `400` | Aroused |
| `600` | Content |
| `1000` | Sated |

Each threshold includes a prompt sentence used by `Player.getNeedSentencePromptContext()`. These sentences enter base context for the player, present NPCs, and party members when the bar is active.

The YAML contains an `aliases` list (`libido`, `lust`, `sex`), but `Player.#buildNeedBarDefinition()` does not copy aliases into runtime need-bar definitions. Runtime lookup matches the id (`sex`) and, in `Player#setNeedBarValue()`, the display name (`Sexual Satisfaction`); slash commands and event prompts should use the id.

The bar also includes `while_you_were_away_prompt_notes`. The while-away prompt receives those notes as bar-specific offscreen guidance for NPCs with or without willing partners nearby, plus a random-event instruction for solitary sexual release.

## Runtime Behavior

The shared need-bar runtime handles this defs-only bar. `mods/nsfw-boost` separately registers the `lustAdvance`, `takeTheLead`, and `descriptiveness` player-action prompt steps, including checkpoint-sized `tinyBrainText` variants.

General need-bar handling applies to this bar:

- `Player.applyStatusEffectNeedBarsToAll()` applies passive `change_per_minute` drift and status-effect deltas against world minutes.
- `prepareBasePromptContext()` exposes active actor bars and threshold sentences in base context.
- `Events._runNeedBarEventChecks()` runs the dedicated need-bar prompt when need-bar definitions exist.
- Parsed need-bar prompt entries are injected into the `needbar_change` event path.
- The `needbar_change` handler calls `actor.applyNeedBarChange(...)`, which applies the configured per-bar magnitudes, updates thresholds, and returns `needBarChanges` metadata with id, name, icon, color, reason, previous value, new value, and delta.

## UI And Commands

Because the `sex` bar applies to every actor audience, it appears anywhere active need bars are rendered unless an NPC has that bar disabled through per-character applicability:

- The player card renders need bars with icons.
- Party and NPC portrait stacks render compact need bars.
- The Needs modal can edit active need-bar values for the player or a character.
- The NPC edit modal exposes applicability checkboxes for NPC-storable need bars. Disabling a bar removes it from that NPC; re-enabling it restores the stored value at `100`.
- `/needbars list` includes `sex`, and `/needbars set|add|subtract sex ...` mutates stored bars for the selected target set.

HTTP routes use the same model methods:

- `PUT /api/player/needs`
- `PUT /api/npcs/:id/needs`
- `PUT /api/npcs/:id` for `needBarApplicability` on NPCs

Need-bar values and applicability persist in `Player.toJSON()` as `needBars`, `needBarApplicability`, and `needBarRatesAppliedAt`.

## Relevant Coverage

Current behavior is covered through shared mod and need-bar tests rather than a dedicated lust-mod test:

- `tests/definition_overlays.test.js`: defs overlays and enablement precedence.
- `tests/mod_extension_hooks.test.js`: NSFW Boost player-action prompt step registration, tiny-brain text, numbering, ordering, and duplicate validation.
- `tests/events.need_bar_prompt.test.js`: dedicated need-bar prompt parsing, `needBarChanges` metadata, icon preservation, and trigger buckets.
- `tests/player.need_bar_audience.test.js`: audience filtering, stored versus active bars, passive drift, and per-bar magnitude overrides.
- `tests/player.need_bar_applicability.test.js`: per-NPC applicability persistence and re-enable value behavior.
- `tests/mod_npc_needs_overlay.test.js`: enabled need-bar overlays and runtime definition reload behavior.
