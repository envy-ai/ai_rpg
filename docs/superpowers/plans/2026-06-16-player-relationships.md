# Player Relationships Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Git commit steps are intentionally omitted because this repo's AGENTS.md forbids git operations unless the user explicitly asks.

**Goal:** Persist sparse semantic relationship labels between characters on `Player`.

**Architecture:** Add `relationships` as a normalized private `Map` on `Player`, expose cloned object snapshots through model/status/client serializers, and allow existing NPC field update tools to replace the map. Keep this separate from numeric dispositions and faction standings.

**Tech Stack:** Node.js, built-in `node:test`, CommonJS model files, existing chat tool runtime.

---

## File Structure

- Modify `Player.js`: private state, normalization, accessors, mutators, save/load/status serialization.
- Modify `server.js`: include `relationships` in `serializeNpcForClient(...)`.
- Modify `chat_tool_calls.js`: add `relationships` to the character allowlist and object-field normalization.
- Add `tests/player.relationships.test.js`: model persistence and validation coverage.
- Modify `tests/chat_tool_update_character_fields.test.js`: chat-tool mutation coverage.
- Modify `docs/classes/Player.md`, `docs/api/players.md`, and `docs/README.md`: document the field and surfaces.

## Tasks

### Task 1: Add Failing Model Tests

- [ ] Create `tests/player.relationships.test.js` with tests that construct a `Player` with relationships, assert `getRelationships()`, `getRelationship(...)`, `getStatus()`, `toJSON()`, and `fromJSON(...)`, verify returned maps are clones, verify `setRelationship(...)` and `removeRelationship(...)`, and assert labels over six words throw.

- [ ] Run `node --test tests/player.relationships.test.js`.

Expected result before implementation: failure because `getRelationships` is not defined or `relationships` is absent.

### Task 2: Add Failing Chat Tool Test

- [ ] Update `tests/chat_tool_update_character_fields.test.js` so `makeNpc()` has relationship helpers.

- [ ] Add a test where `updateCharacterFields` sets `{ relationships: { "char-ally": "old rival" } }` and assert the stub receives that map and reports `relationships` in `updatedFields`.

- [ ] Run `node --test tests/chat_tool_update_character_fields.test.js`.

Expected result before implementation: failure with `unsupported_field` for `relationships`.

### Task 3: Implement Player Relationships

- [ ] Add `#relationships = new Map()` to `Player`.

- [ ] Add static normalization helpers that accept `Map` or plain object input, trim keys and labels, reject invalid values, reject labels with more than six words, and reject self-references when an owner id is known.

- [ ] Initialize from `options.relationships` after `#id` is assigned.

- [ ] Add `relationships`, `getRelationships()`, `getRelationship(...)`, `setRelationships(...)`, `setRelationship(...)`, and `removeRelationship(...)`.

- [ ] Include `relationships` in `getStatus()`, `toJSON()`, and `fromJSON(...)`.

- [ ] Run `node --test tests/player.relationships.test.js`.

Expected result after implementation: pass.

### Task 4: Expose Through Client Serializer And Tools

- [ ] Update `server.js` `serializeNpcForClient(...)` to include a cloned `relationships` object when available.

- [ ] Add `relationships` to `UPDATE_CHARACTER_FIELD_NAMES` and `UPDATE_OBJECT_FIELD_NAMES_BY_TYPE.character` in `chat_tool_calls.js`.

- [ ] Add `relationships` to the object-field map normalization set.

- [ ] In `makeUpdateCharacterFieldOperations(...)`, validate that `targetNpc.setRelationships` exists and apply the normalized map through it.

- [ ] Run `node --test tests/chat_tool_update_character_fields.test.js`.

Expected result after implementation: pass.

### Task 5: Documentation And Verification

- [ ] Update `docs/classes/Player.md` with key state, accessors, instance API, serialization, and notes for `relationships`.

- [ ] Update `docs/api/players.md` to note `NpcProfile.relationships`.

- [ ] Update `docs/README.md` if needed to reflect updated Player documentation wording.

- [ ] Run focused verification:

```bash
node --test tests/player.relationships.test.js tests/chat_tool_update_character_fields.test.js
node --check Player.js
node --check server.js
node --check chat_tool_calls.js
```

Expected result: all commands exit 0.
