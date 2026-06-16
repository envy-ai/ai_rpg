# API Route Reference

This is the high-level index for the project's HTTP API documentation. Most `/api/*` routes are registered by `api.js` through `registerApiRoutes(scope)`. `server.js` also defines `/api/game-config-override`, which is documented with the game lifecycle routes.

## How This Reference Is Organized
- High-level index: this file maps endpoint groups to the detailed domain docs.
- Domain docs: `docs/api/` files describe request/response shapes, variants, and edge cases.
- Shared shapes: `docs/api/common.md` defines payloads such as `NpcProfile`, `LocationResponse`, and `ActionResolution`.

## Domain Index
- `docs/api/common.md` - shared payload shapes and conventions
- `docs/api/serialization.md` - compatibility pointer to shared shapes
- `docs/api/attributes.md` - duplicate `/api/attributes` definitions
- `docs/api/chat.md` - chat endpoints
- `docs/api/crafting.md` - crafting/salvage/harvest
- `docs/api/game.md` - new game, save/load, active calendar editing, per-game config overrides, summaries, short-description processing, mod manager, and pending post-restart load APIs
- `docs/api/factions.md` - factions CRUD, relations, and player standings
- `docs/api/images.md` - image generation, weather/lighting location variants, and job tracking
- `docs/api/locations.md` - locations, exits, stubs, map data, player move
- `docs/api/map.md` - compatibility pointer to map endpoints
- `docs/api/lorebooks.md` - lorebook management
- `docs/api/mystery-boxes.md` - mystery-box editor routes
- `docs/api/mystery-threads.md` - mystery-thread editor routes
- `docs/api/npcs.md` - NPC CRUD, state, equipment, teleport, and barter sessions
- `docs/api/players.md` - player CRUD, party, gear
- `docs/api/quests.md` - quest edits/confirmations
- `docs/api/regions.md` - region CRUD and generation
- `docs/api/scene-summaries.md` - Story Tools scene-summary editor routes
- `docs/api/settings.md` - setting CRUD, AI fill-missing, faction defaults, and world-profile calendar drafts
- `docs/api/things.md` - items/scenery CRUD and inventory transfers
- `docs/api/misc.md` - feature flags, health check, slash commands, prompt cancellation/retry, config test

## Compatibility Notes
- Duplicate route: `GET /api/attributes` is defined twice. Express binds the first definition (attribute definitions + generation methods). The later definition is unreachable until the duplication is removed; both behaviors are documented in `docs/api/attributes.md`.
- Image generation compatibility: `POST /api/generate-image` supports synchronous responses when `async=false`; the code marks that mode as legacy. Prefer the async image job routes documented in `docs/api/images.md`.

## Conventions
- Most JSON responses include a `success` boolean. Some endpoints do not (noted in the low-level docs).
- Error responses typically follow `{ success: false, error: string }`, but a few endpoints return `{ error }` without `success`.
