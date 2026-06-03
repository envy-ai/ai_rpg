# Need Bar: Lust Mod

`mods/need-bar-lust` is a hybrid mod. Its `defs/` overlays add the sexual satisfaction need bar and related slop-word tuning, while `mod.js` registers player-action prompt guidance for lust-driven NPC initiative.

## Definitions
- `defs/need_bars.yaml` adds the `sex` need bar, labeled `Sexual Satisfaction`, with aliases for libido/lust/sex.
- The bar is active for the player, party members, and non-party NPCs.
- `defs/slopwords.yaml` adds the configured slopword rule for the mod's content domain.

## Runtime Hook
- `mod.js` registers two `scope.registerPlayerActionPromptStep(...)` entries with `step: 1`.
- The server numbers those prompt steps automatically, starting at `1g` among mod-provided stage-1 player-action prompt steps.
