# AbilityAttachmentsEditor

`public/js/ability-attachments.js` exposes `window.AbilityAttachmentsEditor.open({actorId,abilityId,trigger,onApplied})` for an existing saved player or NPC ability. It loads the current attachment draft and optimistic concurrency token from `GET /api/players/:actorId/abilities/:abilityId/attachments`, alongside the character's technique catalogue and formula-variable context. The native dialog restores trigger focus on close, supports Escape and shared Ctrl/Cmd+Enter submission, prevents dismissal during requests, and shows original server stacks through `AIRPG_PAGE_FEEDBACK` while retaining a failed draft.

The dialog and form compose the existing `.techniques-dialog` and
`.techniques-form` chrome, including readable dark inputs, centered placement,
focus outlines and an independently scrolling body with reachable footer actions.

The form edits permanent `statusEffects`, each with name, description, fixed and percentage attribute/skill modifiers, optional `maxHealthPercent`, and nested `techniqueEntries`. Each technique entry references a catalogue definition or provides an editable new candidate and optional new discipline. New custom mechanics reuse `TechniqueMechanicsEditor.editor`; generated healing recipes have structured recipe fields. The form fixes ability-effect duration at `-1` and does not expose need-bar rates or trigger automation.

**Generate attachments** calls `POST .../generate` and replaces only the local draft and expected token. **Apply attachments** sends the edited `{draft,expected}` through `PUT .../attachments`; only a successful response invokes `onApplied` and closes. The containing character editor stores the returned `ability.statusEffects` in its existing row so an ordinary later character save does not discard the newly applied fields.
