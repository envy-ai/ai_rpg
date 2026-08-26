# ImageWorkflowPresetStore

`ImageWorkflowPresetStore` owns the config-independent YAML persistence used by
the Image Generation and Image Edit preset controls.

The root `image-workflow-presets.yaml` file contains separate `generation` and
`edit` mappings. `load()` validates that file and returns both mappings; a
missing file represents a new empty store. `savePreset()` validates the mode,
name, and settings, protects existing names unless overwrite is explicit,
removes generation-only resolution data from edit presets, backs up an existing
store, and rewrites the shared YAML.

This store is deliberately independent of `config.yaml`, startup config
overrides, session `/reload_config` overrides, world saves, and world-profile
settings. Consequently, all saved presets remain visible after switching any
of those configuration layers.
