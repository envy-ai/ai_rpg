# Mod-Only Defs Overlays Design

## Goal

Allow enabled mods to provide `defs/*.yaml` files that do not exist in the root `defs/` directory. The loader treats the missing root file as an empty base definition and merges enabled mod files in the existing deterministic mod order.

## Behavior

- Root definition files continue to load and merge with matching mod overlays exactly as before.
- A mod-only definition file such as `mods/nsfw-boost/defs/sexual_traits.yaml` is considered a valid definition file during overlay validation.
- Validation still reads and parses every enabled mod YAML file and still checks structural merge compatibility when multiple sources define the same filename.
- No empty placeholder file is created under root `defs/`.
- Disabled mods do not contribute filenames or values.

## Tradeoff

This removes the old typo guard where every mod definition filename had to match a root filename. A misspelled mod-only filename is now treated as a new definition file. That matches the desired behavior and keeps mods able to own private definition files.

