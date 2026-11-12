# ImageWorkflowPresetStore

`ImageWorkflowPresetStore` owns the config-independent YAML persistence used by
the Image Generation and Image Edit preset controls.

The root `image-workflow-presets.yaml` file contains separate `generation` and
`edit` mappings. `load()` validates that file and returns both mappings; a
missing file represents a new empty store. `savePreset()` validates the mode,
name, and settings, protects existing names unless overwrite is explicit,
removes generation-only resolution data from edit presets, backs up an existing
store, and rewrites the shared YAML.

Optional `loras` entries are validated on writes through
`normalizeImageWorkflowLoras`: `{ name, strength }` entries require a nonblank
filename and finite numeric strength, with no numeric bounds. Older saved strings
are accepted at strength `1` and written as explicit objects. Invalid entries
raise `INVALID_PRESET` with the offending `settings.loras[index]` field and the
original validation error as cause; no file write occurs.

This store is deliberately independent of `config.yaml`, startup config
overrides, session `/reload_config` overrides, world saves, and world-profile
settings. Consequently, all saved presets remain visible after switching any
of those configuration layers.
