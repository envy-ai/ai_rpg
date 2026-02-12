Original prompt: Add a faction dropdown to the Region edit modal.

- Reviewed docs and existing region edit modal wiring.
- Found existing region faction select markup and JS wiring already present.
- Implementing a robustness tweak to ensure faction options are always refreshed when opening the region modal.
- Updated `views/index.njk` region edit modal faction select to include `name="controllingFactionId"`.
- Region edit modal now force-refreshes faction options on open and awaits faction select population before applying selected region faction.
- Updated docs: `docs/ui/pages.md` and `docs/README.md`.
- Validation: `npm run test:e2e:headless` failed because Playwright webServer exited early from config.
- Added defensive controlling-faction reconciliation for region-entry stub expansion in `server.js`:
  - Unknown stub/region faction ids are ignored with warnings (no hard throw).
  - Generated region `<controllingFaction>` conflicts no longer abort expansion; stub/existing values are enforced.
  - Existing saved region controlling faction now wins when conflicting with derived value, with warning logs.
- Updated docs: `docs/server_llm_notes.md`, `docs/README.md`.
