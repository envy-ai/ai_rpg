# Mod-Only Defs Overlays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow mod `defs/*.yaml` files to be valid even when root `defs/` has no matching file.

**Architecture:** Keep all behavior inside `DefinitionLoader.js`. Validation will build the known filename set from root definitions plus enabled mod definitions, then call `loadMergedDefinitionFile(...)` for each validated filename so YAML parse and structural merge errors still surface.

**Tech Stack:** Node.js, `node:test`, `js-yaml`, existing mod discovery helpers.

---

### Task 1: Regression Test

**Files:**
- Modify: `tests/definition_overlays.test.js`

- [ ] Add a test that creates a temp game dir with no root `defs/sexual_traits.yaml`, writes `mods/example/defs/sexual_traits.yaml`, runs `validateDefinitionOverlays(...)`, and verifies `loadMergedDefinitionFile(...)` returns the mod value.

- [ ] Run:

```bash
node --test tests/definition_overlays.test.js
```

Expected before implementation: fail because validation rejects the unknown overlay filename.

### Task 2: Loader Change

**Files:**
- Modify: `DefinitionLoader.js`

- [ ] Update `validateDefinitionOverlays(...)` so mod YAML filenames are added to `knownDefinitionFiles` before validation rejects anything.

- [ ] Keep `loadMergedDefinitionFile({ baseDir, filename })` as the final validation pass for each filename.

- [ ] Run:

```bash
node --test tests/definition_overlays.test.js
```

Expected after implementation: pass.

### Task 3: Docs And Verification

**Files:**
- Modify: `docs/modding.md`
- Modify: `docs/classes/ModLoader.md`
- Modify: `docs/README.md`

- [ ] Update docs to describe mod-only definitions.

- [ ] Run:

```bash
node --check DefinitionLoader.js
node --test tests/definition_overlays.test.js tests/mod_npc_needs_overlay.test.js
```

Expected: syntax check exits 0 and tests pass.

