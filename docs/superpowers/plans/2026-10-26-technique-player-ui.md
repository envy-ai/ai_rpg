# Technique player UI and icons

Status: implemented and deployed, 2026-10-26.

## Scope and acceptance

- Add one discipline button below the player's View/Abilities/Skills/Inventory row for each discipline represented by learned or equipped techniques. Refresh from authoritative character technique data; a discipline with no techniques gets no button.
- Open a modeless, themed technique list using the existing ability-card and dialog patterns. Show names, descriptions, costs and effects, retaining access/blocker information. Clicking or keyboard-activating a technique inserts `[Technique Name]` at the chat cursor, like abilities and skills; it does not cast immediately.
- Show character technique attempts in the existing expandable check-results history with recorded formulas, variable values, resolved amounts and actual applied effects/costs. Show a distinct learned-technique notice. Receipts are authoritative and replay must not duplicate log entries or mutations.
- Add ability and technique icons through the existing image prompt/job pipeline, with separate prompt-writing templates, configurable instructions and image prefixes. Persist images and their prompts, support existing regeneration paths, and request icons as their cards become visible rather than generating an entire historical catalogue.
- Reuse existing controls, modal lifecycle, typography, colors and accessible keyboard behavior; compile changed SCSS. Legacy saves without icons or enhanced receipt display metadata must load without inventing historical results.

## Sequence and boundaries

1. Inspect existing sidebar, ability/skill lists, check-results, receipts and image configuration. Generate a visual mockup grounded in the existing UI.
2. Implement receipt-based history and learning notices, and image target/prompt/persistence support independently.
3. Compose the discipline list and shared icon display with existing UI primitives; integrate authoritative refreshes and image jobs.
4. Verify server contracts, replay/persistence, click/cursor/keyboard behavior, stale response handling, mobile layout and error presentation using isolated fixtures.
5. Update focused documentation/index, save the running game before any authorized restart, retain the independent LLM server, and restart without loading a save if needed.

## Material implementation constraints

- Presentation/icon changes must not alter immutable mechanics, catalogue pins or personal revisions.
- History must use committed snapshots, not evaluate formulas against later character state. Older receipts expose only information actually recorded.
- Learning notices cover real acquisitions, not load-time hydration or duplicate receipt replay.
- Image target identities must unambiguously distinguish character abilities and shared technique definitions. Failed prompt/render work must surface a real error and must not cause a regeneration loop.
- Tests run with the required 16 GB memory/no-swap systemd limits; artifacts stay under `tmp`.

## Delivery and verification

- `TechniqueSidebar` adds discipline buttons and uses the shared `ModelessChooser` with abilities and skills. Click/Enter/Space inserts a bracketed name; T opens/cycles disciplines, A/S retain their existing shortcuts and Escape closes. Distinct equipped versions each show their costs/effects when source selection is required.
- Committed technique receipts capture names, formulas, inputs and resolved/applied results for the existing expandable check-results renderer. New learning receives a distinct notice. Known notification failures can retry independently of mechanics; successful replay and hydration do not repeat notices. Hidden/offscreen NPC activity is filtered.
- `ActionImages` reuses the shared image manager and renderer for lazy icons, prompt editing and explicit regeneration. `ActionIconTarget` validates stable ability/technique identities and stale runtime lifetimes. Saved artwork is separate from mechanical revisions and fingerprints.
- Nine browser cases passed in `tests/e2e/techniques-panel-editor.spec.js`; the affected chooser case was checked again after final keyboard/layout fixture changes. The technique baseline passed 53 cases and the focused service suite passed 28 cases including the new notification-retry and icon-persistence coverage. The final affected ability/image regression run passed 37 cases. These suites overlap; counts are per run, not a combined total. All used the required memory/no-swap limits.
- Altered JavaScript and inline template scripts passed syntax checks; YAML and Nunjucks parsed, and the authoritative main SCSS was compiled. Desktop/mobile screenshots and browser reports are under `tmp/techniques-ui-review/`. Render transport was exercised with fixtures, without requesting live LLM/image generations for tests.
- Saved the current, user-created Practiced Restoration game before restarting, with the manifest at `tmp/technique-player-ui-pre-restart-save.json`. Restarted only the game server (PID 597052); the independent LLM remained PID 2072980. Both returned HTTP 200, new UI assets/markup were served and the pre-restart save appeared in the save list. No save was loaded automatically and no technique balance was changed.
