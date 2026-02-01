# API Routes From `api.js`

This is the high-level index for every Express route registered in `api.js`. The detailed, low-level reference lives in `docs/api/` and is intended to give an accurate picture of request/response shapes and variants without scanning the source.

## How This Reference Is Organized
- High-level index (this file): quick map of endpoints by domain.
- Low-level docs (`docs/api/`): per-domain route specs, sorted by path, with response variants and edge cases.
- Common shapes: shared payloads such as `NpcProfile`, `LocationResponse`, `ActionResolution`, etc.

## Low-Level Index
- `docs/api/common.md` - shared payload shapes and conventions
- `docs/api/serialization.md` - legacy pointer to shared shapes
- `docs/api/attributes.md` - duplicate `/api/attributes` definitions
- `docs/api/chat.md` - chat endpoints
- `docs/api/crafting.md` - crafting/salvage/harvest
- `docs/api/game.md` - new game, save/load, summaries, short-description backfill
- `docs/api/images.md` - image generation and job tracking
- `docs/api/locations.md` - locations, exits, stubs, map data, player move
- `docs/api/map.md` - legacy pointer to map endpoints
- `docs/api/lorebooks.md` - lorebook management
- `docs/api/npcs.md` - NPC CRUD and state
- `docs/api/players.md` - player CRUD, party, gear
- `docs/api/quests.md` - quest edits/confirmations
- `docs/api/regions.md` - region CRUD and generation
- `docs/api/settings.md` - setting CRUD and AI fill-missing
- `docs/api/things.md` - items/scenery CRUD and inventory transfers
- `docs/api/misc.md` - feature flags, health check, slash commands, prompt cancel, config test

## Duplicate / Legacy Notes
- Duplicate route: `GET /api/attributes` is defined twice. Express binds the first definition (attribute definitions + generation methods). The later definition is unreachable until the duplication is removed; both behaviors are documented in `docs/api/attributes.md`.
- Legacy behavior: `POST /api/generate-image` includes a legacy sync mode when `async=false`. See `docs/api/images.md`.

## Conventions
- Most JSON responses include a `success` boolean. Some endpoints do not (noted in the low-level docs).
- Error responses typically follow `{ success: false, error: string }`, but a few endpoints return `{ error }` without `success`.
