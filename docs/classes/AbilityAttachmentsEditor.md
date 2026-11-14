# AbilityAttachmentsEditor

`public/js/ability-attachments.js` exposes `window.AbilityAttachmentsEditor.open({actorId,abilityId,trigger,onApplied})` for an existing saved player or NPC ability. It loads the current attachment draft and optimistic concurrency token from `GET /api/players/:actorId/abilities/:abilityId/attachments`, alongside the character's technique catalogue and formula-variable context. The native dialog restores trigger focus on close, supports Escape and shared Ctrl/Cmd+Enter submission, prevents dismissal during requests, and shows original server stacks through `AIRPG_PAGE_FEEDBACK` while retaining a failed draft.

The dialog and form compose the existing `.techniques-dialog` and
`.techniques-form` chrome, including readable dark inputs, centered placement,
focus outlines and an independently scrolling body with reachable footer actions.
Its visibility, pending Escape/close guard, transient-root removal and trigger
restoration now delegate to [NativeDialog](NativeDialog.md); attachment requests,
optimistic token, failed draft retention and disabled controls remain local.

The form edits permanent `statusEffects`, each with name, description, fixed and percentage attribute/skill modifiers, optional `maxHealthPercent`, optional `needBarMaximums`, and nested `techniqueEntries`. Each technique entry references a catalogue definition or provides an editable new candidate and optional new discipline. New custom mechanics reuse `TechniqueMechanicsEditor.editor` with the full actor authoring context, including utility and template choices. Raw single-component healing/damage recipes and v2 mixed/status component recipes reuse `TechniqueMechanicsEditor.recipeEditor`; it preserves pending v1 selector proposals while offering actual skill, attribute and resource-profile choices. The form fixes ability-effect duration at `-1` and does not expose need-bar rates or trigger automation.
New candidate forms omit the retired `unique` field; saved legacy metadata is
not an authoring choice or an ownership gate.
`Player.fromJSON` removes this inert field from saved pending ability attachment
candidate drafts in memory before later preview/application. It leaves the
saved file, candidate IDs, mechanics and other draft fields untouched; new
authoring still rejects a supplied `candidate.unique` field.

**Generate attachments** calls `POST .../generate` and replaces only the local draft and expected token. **Apply attachments** sends the edited `{draft,expected}` through `PUT .../attachments`; only a successful response invokes `onApplied` and closes. The containing character editor stores the returned `ability.statusEffects` in its existing row so an ordinary later character save does not discard the newly applied fields.

The maximum-capacity editor preserves an unchanged effect's optional `needBarMaximums` shape: an omitted field stays omitted, and an explicit empty array remains empty. Adding entries emits the populated array; removing all entries from a populated effect emits `[]` to clear them.

Scalar modifier groups, granted techniques and permanent effects share portable [ReaderRows](ReaderRows.md) with the technique mechanics editor. Reader order follows the current DOM, explicit removal releases owned listeners/nested groups, generated draft replacement clears the old ownership, and native close destroys it. Existing fields, validators, recipe/formula branches, optimistic tokens and serialized attachment data remain unchanged. Add buttons use their group's lifetime signal, so retained detached controls cannot mutate an already closed editor.
