# Sequential IDs, selected crafting quantities and ability-attachment batches

## Requested result

- Replace remaining application-generated UUIDs with category-plus-sequential-integer identities, preserving existing named domain IDs.
- Render item stacks in What changed as `**3x** Iron Ingot`; use bullets when a message contains multiple distinct item types.
- Allow craft/process inputs to select multiple units through the existing quantity dialog, with authoritative quantity-aware prompts and consumption.
- Add a TinyBrain ability-attachment batch that supplies the complete catalogue outline once, then authors abilities sequentially in the same conversation.
- Do not restart the game or execute migration during implementation.

## Confirmed compatibility decisions

The user approved retaining the UUID required by the installed ComfyUI API solely at its external prompt-ID boundary. Application IDs remain sequential, with explicit wire-ID translation for queueing, progress, history and cancellation. Other provider-assigned IDs remain opaque external data.

New allocation changes do not automatically rewrite historical IDs. The user requested extending the existing `/migrate_ids` command for explicit historical UUID migration. Its native scope is the currently loaded game. Independent Story libraries and bound-Story migration require coordinated library changes; the existing explicit unsupported-binding guard remains, with documentation identifying that boundary. No command is run by development verification.

## Implementation boundaries

Operational counters must survive server restart and old-save rollback without ID reuse, and must coordinate browser tabs/clients and independent processes. Reuse the shared IdGenerator entry point, backed by durable category range reservations outside game saves; allocation inside a reserved range is in memory. Gaps after abandoned ranges are acceptable. Corrupt/unavailable/exhausted storage fails explicitly rather than creating random fallback IDs. Tests use isolated counter storage.

Browser allocation uses server-owned ranges. New allocation capabilities and crafting quantities must be gated so disk-read resources do not require unsupported behavior from the still-running server. New Story IDs use category integers; validators continue accepting actual historical IDs. ComfyUI is the sole application-generated UUID protocol exception.

During implementation, explicitly gated existing browser generators remain solely for the already-running old server, whose render context has no sequential-ID capability. A new server always enables sequential IDs; bootstrap/refill failure under that capability never chooses legacy generation. Remove the old-runtime transition branches after a user-authorized restart has installed the new capability.

Craft/process slots retain the original Thing identity and selected quantity, without splitting or consuming inventory during selection. Use the existing quantity modal with cancellation and originating session/slot freshness checks. Requests and deduplication keys include quantities. Validate positive safe integers and current availability before rolls and before mutation. Consumption XML identifies the exact selected Thing and consumed quantity; reject unselected/over-selected consumption. Harvest, salvage and location-modification retain their existing contracts. Output stack counts remain intact. Preservation reporting uses selected minus actually consumed units.

The updated backend supplies a quantity capability for the UI and a quantity-mode flag for prompt rendering; an old running server retains the original request and response shape until restart.

## Sequential ability-attachment batch

This additional user request follows the quantity implementation. Use the existing native TinyBrain runner and strict per-ability catalogue-selection/attachment parsers. Supply the actor/authoring facts and full discipline outline once per run, then select and author each known ability in order. Retry only the current checkpoint while retaining accepted earlier drafts, with one queue reservation/log/progress group. Empty catalogues and batches do not ask known-empty questions. Do not require the model to repeat known actor/ability IDs.

Owned ability sets retain combined detached validation and atomic application, with no catalogue/status installation on a later failure. Pending mutually exclusive ability options share a conversation but remain independently previewed and never apply together. Single-ability editor generation, stored option drafts, captured revision pins and the no-generation draftsByAbilityId path retain their contracts. Standard configuration retains its existing supported flow. Earlier abilities' output is not evidence that another ability grants those capabilities. The registered `ability_attachments` family and `generateAbilityAttachmentDraftBatch` implement this contract. Cumulative owned previews use the matching prefix of the original captured baseline; terminal preview/application still checks the full original baseline.

## Work ownership and order

1. Coordinator: confirm scope, review allocator/migration and quantity contracts, maintain this plan, integrate and decide completion.
2. UUID implementation agent: allocator, browser ranges, UUID callsites, ComfyUI mapping, Story validators, explicit migration and focused documentation.
3. Crafting implementation agent: native quantity modal integration, request/deduplication, quantity-aware backend/prompts, What changed formatting and focused documentation.
4. Test agent: independent Node and browser regressions; coordinate shared fixtures/contracts with both implementers.
5. Review implementation, resolve meaningful failures, syntax-check changed sources and compile any modified SCSS. Leave the live server and game state untouched.

Shared files such as server.js, api.js, views/index.njk, Events.js and public/js/chat.js require coordinated narrow patches, not overwriting another agent's changes.

## Acceptance and verification

- Durable sequential uniqueness across fresh processes, imports, server restart, save rollback and multiple browser clients; no application-generated UUID path outside the approved ComfyUI wire adapter.
- ComfyUI translation preserves preassigned cancellation and matching progress/history without real image generation.
- Historical records still load; explicit migration remaps exact structured identities/references transactionally, preserves prose and usable assets, and supports backup, rollback and idempotence.
- Quantity modal supports native desktop, keyboard and mobile assignment, cancellation and stale-session cases.
- Exact partial/full consumption, invalid/duplicate/stale selections, same-name distinct sources, no-prose preservation and output stacks are tested without model calls or live game mutation.
- What changed formatting verifies single versus multiple item types and quantity emphasis using real summary/render paths.
- All test commands run in the required systemd 16 GB/no-swap scope; browser commands use the user manager. Artifacts and temporary configuration go in `tmp`.

## Status

All four requested changes are implemented and verified. Passing related Node suites cover crafting/drawer/allocator (93), ability attachment batching (53), sequential callsites (149), and the final affected load/migration/charge/technique suite (71), plus a targeted saved-cursor regression. These suite counts overlap and are not a unique total. Two isolated Chromium checks cover the native quantity dialog and server-owned sequential browser bootstrap. Altered JavaScript passed syntax checks; view templates and YAML compiled/parsed without activating the server. Migration verification exercises real charge/technique replay without repeat effects, unchanged image-file resolution, receipt-notification deduplication, old-save ID preservation, and remapped housekeeping/scene cursors. No restart, migration command execution or live game mutation occurred. Restart and migration execution remain unauthorized.

## Sequential allocator implementation choices

- Operational ranges live outside saves in `runtime-id-leases/` (`AIRPG_ID_STORE_DIR` for isolated tests/independent installations); Docker Compose persists a dedicated volume. Exclusive fsynced 1024-integer lease files avoid locks and per-ID disk writes. Abandoned ranges and aborted migration preparation leave documented gaps.
- Native load abandons unused local ranges and reserves incoming exact numeric identities through explicit namespaces; already named domain IDs are not parsed as operational categories. Ordinary game replacement reloads pages to discard browser pools. Existing writers retain their single-live-game-server boundary; no distributed concurrent import coordination is claimed.
- Browser pools bootstrap from explicit new-runtime capability data and refill asynchronously at low-water without polling or per-ID requests. The existing UUID/random generators remain only in clearly marked **OLD-RUNTIME TRANSITION** branches for the actual old running server. True-capability failures throw and never enter those branches. Remove them after an authorized restart and confirmation that old pages are gone.
- Internal Comfy prompt IDs are sequential, with their required opaque wire UUID preassigned before POST and translated for cancellation, progress and history. Other provider-assigned IDs remain opaque.
- Explicit current-game migration maps domain UUIDs to numeric prefixes, preserves existing canonical names/numbers, maps canonical chat/request aliases once, preserves actual image filenames/URLs and original charge replay hash scopes, and retains the existing independent-Story guard. The command is not executed during implementation.
