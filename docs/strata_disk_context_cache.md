# Strata disk context cache for AI RPG

Status: implementation proposal, verified against the installed source on Shodan on 2026-11-06. This document adds no runtime behavior. No model, server, profile, or configuration was started, stopped, or changed to prepare it.

Use Strata's existing session-file API to retain expensive contexts on an SSD and explicitly restore the right context before sending the next full chat request. Start with saves at deliberate session-switch/suspend boundaries, rather than writing several gigabytes after every small helper prompt. Keep normal in-memory prefix reuse for continuing requests. Disk snapshots are disposable acceleration data; AI RPG's game saves, messages, images, and tool-execution receipts remain authoritative.

## Verified deployment and storage

| Item | Observed configuration or evidence |
| --- | --- |
| AI RPG checkout | `/home/bart/ai_rpg`; inspected revision `a9ede351051ca0e044cd041855d0b9fe9f69fbae`, with substantial existing local changes. Source line references below describe the working files as inspected. |
| Default AI target | `config.yaml:41-45` selects the remote OpenAI-compatible GLM backend. The Strata settings below are a named profile, not proof of the current live backend. |
| AI RPG Strata profile | `config.yaml.strata-davidau:41-66`: local endpoint `http://127.0.0.1:8080/v1/chat/completions`, exact model `qwen3.8-flash-next-davidau-turbo-brilliance-iq3_s-plain`, native runtime profile `davidau-iq3-s-ram`, shared-prefix hints enabled, router slot cache disabled. |
| Saved Strata profile | `/home/bart/.config/strata/profiles/davidau-iq3-s-ram.json:1-6` points to `/home/bart/.local/share/strata/install/strata-davidau-iq3_s-plain-ram.json`. |
| Engine settings | Saved run config lines 1-50: `--kv int8`, `--max-context 131072`, `--conversation-cache-mib 4096`, `--conversation-cache-min-free-mib 16384`, `parallel: 1`, `vram_elastic: true`. `ram_standby` is false despite the profile name. No `slot_save_path`, session-space override, or save-reclaim option is configured. |
| Existing RAM limits | AI RPG profile lines 55-58 sets `memory_max_mib: 90112`, `memlock_mib: 98304`, `shm_size_mib: 61440`. Snapshot allocations must fit actual host and runtime containment limits. |
| Terminal/API | Terminal `0.1.49.2`, bundle commit `dfa3f4025c9f1bc4af8cee201b20a2d223061813`. Installed `serve/server.py` SHA-256: `d475bbd4583e932c30f4cc7ee059d1ba4ab3751c98ac091db15c7d905b384992`. This includes local API patches; a stock release label alone is insufficient identity. |
| Native engine | `/home/bart/.local/share/strata/custom/ram-standby-pr2-20261026-sm89/strata`; SHA-256 `ab91e02212bcaee5ddc819e1a651e5120cea3fbdfd8e2659e086188a0aadf9a7`. Build manifest source commit `b6286b60ad54a883ef2374059343c3e1bdc0d677`, matching the available source checkout. `CMakeLists.txt:11,23` sets engine version `0.1.48`. Terminal and engine version numbers differ. |
| Home filesystem | Read-only `findmnt`, `df`, and `lsblk` inspection: `/home/bart` resolves to `/dev/sdb3`, ext4, on rotational `ST12000VN0008-2YS101`; about 268 GiB available, 98% used at inspection. A cache under `~/.cache` would use that disk. |
| SSD candidate | `/c` is XFS on `/dev/nvme1n1p3`, Samsung SSD 980 PRO 2TB, about 375 GiB available at inspection. Proposed cache root: `/c/ai_rpg-cache/strata-contexts`. This directory was not created. Capacity and permissions must be checked again at implementation. |

The previously discussed **3-4 GiB at 128K tokens is an estimated parked RAM footprint**, not a measured serialized file size. Historical run-log lines 98623 and 98702 report `snapshot_bytes=1278168292` at 45,024 tokens and `1759434384` at 61,027 tokens. Those are RAM-cache observations, not disk writes. Disk stores fewer checkpoints and has its own layout, so extrapolating these values into a file-size or restore-time guarantee would be incorrect. [R1, R2, R3, R8]

## Three distinct mechanisms

1. **Live prefix/checkpoint reuse:** Strata reuses matching leading tokens in its current conversation. AI RPG's `strata_prefix: { messages: K }` marks a stable prefix boundary; it does not save a file.
2. **Automatic parked conversations in RAM:** the engine parks/reuses independent contexts within its host-memory budget. The saved 4096 MiB budget and default four parked entries are independent limits, not four active generation slots. These entries are not persistent across restarts.
3. **Explicit disk sessions:** a client asks to save the currently held conversation or restore a named file. The current API has exactly one addressed slot, **0**. It provides no disk LRU, automatic persistence of RAM evictions, background disk tier, erase action, or named live-session routing. Implement any disk catalogue/retention in AI RPG, explicitly. [R4, R5, R8]

Saving copies the held engine state into a file; it does **not** unload the model, free the live context, or clear the parked RAM cache. Restoring replaces the live conversation and does **not** park the outgoing one. Save outgoing A before restoring B if A needs to remain recoverable. Existing parked entries can still exist; they are not a substitute for this explicit outgoing-save contract. [R5, R8]

The file contains token/image identity, running recurrent state, QSA K/V through the held context, draft K/V, and at most one selected checkpoint. It is not a chat export or an AI RPG save. **This installed custom build selects the deepest pinned checkpoint if any are pinned; otherwise it selects the deepest checkpoint.** The general DETAILS.md prose says “deepest”; the native function `session_deepest_checkpoint()` is more specific. AI RPG already pins a stable prefix, so test branching reuse at that boundary. Earlier edits can require substantial prefill again because the complete checkpoint chain is not on disk. [R6, R8]

## Enable the native API later

These are future configuration steps, not changes made by this document. Keep activation and any restart under the existing runtime owner's normal approval and lifecycle procedure; do not launch another engine manually.

1. Create a private, real SSD-backed directory owned by the user running Strata and AI RPG. Example layout:

   ```text
   /c/ai_rpg-cache/strata-contexts/
     sessions/       # Strata's slot_save_path; flat opaque .bin names
     manifests/      # AI RPG metadata and committed catalogue pointers
   ```

   Use mode 0700 for both directories and 0600 for manifest files. Check the mount, ownership, free space, and parent permissions. Keep this outside the repo, public files, game-save exports, model directories, and `/dev/shm` (which consumes RAM and is not durable SSD storage).

2. Add this **top-level key to the saved Strata run JSON**, preserving its other settings:

   ```json
   "slot_save_path": "/c/ai_rpg-cache/strata-contexts/sessions"
   ```

   This is a fragment, not a replacement JSON file. The server also accepts `--slot-save-path DIR` as a **server** argument. Do not put that server flag into the native engine's `args` list. A JSON relative path resolves against the config's `cwd`; use an absolute path here to avoid ambiguity. Startup creates a missing directory with mode 0700 but does not repair permissions on an existing one. [R4]

3. Preserve `parallel: 1`, positive prompt caching (default `--prompt-cache 6` in this engine), and the compatible single-engine setup. Session files are unsupported with `--batch`/parallel requests, `--layer-split`, `--peer-device`, or `--prompt-cache 0`. RAM conversation parking itself may be disabled without disabling disk sessions. [R5, R8]

4. Optional native engine settings belong in the run config's existing `args` list:

   | Argument | Installed behavior / initial recommendation |
   | --- | --- |
   | `--session-min-free-mib N` | Default 4096 MiB reserve after the complete new file. Keep a meaningful reserve; this is a preflight, not a quota or reserved space. |
   | `--session-max-file-mib N` | Default 0, unlimited. Bounds one serialized SAVE before file I/O. Choose a limit from measured files and workload; it is not a total directory quota. |
   | `--session-save-reclaim` | Off by default. On low-RAM SAVE admission, releases reconstructible retained K/V, oldest unpinned parked entries, then eligible unpinned checkpoints. Keeps pinned/selected checkpoints and the existing RAM floor. It can reduce later reuse, and reclaimed caches stay released even if SAVE later fails. Evaluate separately; do not enable silently. |

   SAVE needs temporary host allocations even though K/V is streamed into the file. RESTORE stages and validates a host image before transfer. Both use the saved **16 GiB free-RAM floor**; SSD capacity alone does not guarantee admission. With reclaim enabled, the API can wait up to 30 seconds and retry up to three times only for qualifying unpublished SAVE-memory refusals on the same engine. That wait is outside `save_ms`. [R5, R6, R7, R8]

5. At the next authorized startup, verify the effective target, ownership, model, API patch identity, and “slot save/restore on” log. Do not infer enablement from a profile name. `/v1/status` and the saved config serve different purposes; neither claims this proposal is currently active. [R4, R10]

## HTTP how-to

After enablement, with the correct model already loaded and all other clients quiesced, these are the actual installed endpoints. They are at the server root, **not `/v1/slots`**. The filename is server-local beneath `slot_save_path`; it is not an upload/download path and may not include a directory. Reuse the effective target's authentication headers. The example assumes an authorized local API that needs no additional header; add its configured Authorization header if required. No calls below were executed for this document.

```bash
# SAVE the complete context the engine currently holds.
curl --silent --show-error --fail-with-body \
  -H 'Content-Type: application/json' \
  --data '{"filename":"game_17-main-r42.bin"}' \
  'http://127.0.0.1:8080/slots/0?action=save'

# Later, RESTORE that same file; this replaces the live slot.
curl --silent --show-error --fail-with-body \
  -H 'Content-Type: application/json' \
  --data '{"filename":"game_17-main-r42.bin"}' \
  'http://127.0.0.1:8080/slots/0?action=restore'
```

SAVE returns `id_slot`, `filename`, `n_saved`, `n_written`, and `timings.save_ms`; RESTORE returns `id_slot`, `filename`, `n_restored`, `n_read`, and `timings.restore_ms`. Validate slot 0, exact filename, nonnegative numeric counts/timing, and file bytes against the candidate manifest. Record client wall time too. The API body does not select a model: validate the configured server/model before the operation. Host, API-key, Origin, and JSON content-type checks apply. Plain filenames are limited to 200 UTF-8 bytes and reject path separators, drive/stream syntax, leading dots, trailing dots/spaces, control characters, and Windows device names. [R4]

After RESTORE, send the normal request to `/v1/chat/completions` with the full intended `messages`, original images if any, tool definitions/results, and normal sampling options. The client must retain those; sending only the new user turn does not reconstruct the cached prefix. Exact token-prefix agreement governs reuse. A request may reuse the selected checkpoint and prefill a tail rather than reuse every `n_restored` token. Changing earlier world state, system text, tool exposure, template rendering, or history order can break reuse. Do not pad, omit current facts, or fabricate an assistant turn merely to match a cache. [R8, R9]

## Proposed AI RPG integration

This section specifies new work. No Strata disk-cache controller or configuration option is added by this document.

### Reuse the existing boundaries

- `LLMClient.applySharedPrefixCachePolicy()` (`LLMClient.js:1889-1918`, invoked at 7265-7271) already operates on the final request messages. Keep that policy and the internal section/stable boundary expansion; derive cache identity from the actual normalized request, not a raw template or prompt label alone.
- `LLMClient.withExclusiveModelLifecycle()` (2745-2754), request gate acquisition/readiness/ComfyUI cleanup (7708-7744), and `ImageGenerationModelLifecycle.run()` (65-74) provide existing ordering contracts. Integrate disk operations with those contracts rather than adding a separate lock that images and manual toggles bypass.
- `StrataRuntime` owns exact runtime/profile readiness and shutdown. A cache operation must check the same effective endpoint/model and owned runtime identity. It must never start a manually disabled model, silently adopt an external runtime, or bypass pre-prompt image cleanup.
- The current `router_slot_cache_enabled` path is for **llama.cpp model switching**. `LlamaCppRouterClient.restoreSlotCacheIfPresent()` deletes a file after restoring it (335-355); its default directory is `/dev/shm`. Do not enable that flag for this feature or reuse its storage/consumption policy unchanged. Reuse suitable HTTP validation patterns, with a Strata-specific contract and durable lifecycle. [R9, R10, R11]

An exclusive transaction must cover **outgoing save, incoming restore, the intended completion, and the decision to save/mark the resulting state**. The server FIFO serializes each HTTP operation separately; it does not make a multi-call transaction atomic. Another client can otherwise generate between RESTORE and the intended completion, or between a completion and SAVE, causing the wrong context to be saved.

Implement this at the transport/lifecycle admission boundary. Do not wrap public `chatCompletion()` inside `withExclusiveModelLifecycle()` unchanged: `chatCompletion()` already acquires that gate and can deadlock trying to reacquire it. Likewise, do not upgrade a held shared lease in place. Provide a deliberate already-owned transport path or equivalent single acquisition, keeping cancellation, queue reservations, progress, managed readiness, and image ordering intact. Capture the effective target before waiting and revalidate its lifecycle revision before mutation. Nested prompts/tool loops must release their transport ownership before an independent nested prompt needs the gate; executable game/tool mutations and replay receipts stay outside speculative cache recovery. [R9-R11]

### Choose useful context identities

Initially support a small number of explicit logical contexts, such as a game's main conversation and deliberately retained long helper runs. A prompt label, model name, browser tab, or player display name alone is not a context identity. A single game turn runs many different helpers and changes current world data. Blindly restoring “the game's last file” before every helper may add I/O while producing no useful shared prefix.

Proposed identity: existing persisted game/save ID + branch/load generation + logical conversation ID + a compatible prefix identity. Allocate any new IDs through the project's existing `IdGenerator` convention. Use opaque safe filenames containing a revision, e.g. `game_17-main-r42.bin`; never derive paths from model/player/world names or raw prompt text. Namespace different backend/model/installation identities separately in the manifest/catalogue, while keeping the Strata sessions directory flat.

A sidecar manifest should record:

| Group | Proposed fields / purpose |
| --- | --- |
| Ownership | Manifest schema version, cache revision, game/save/branch IDs, logical context ID, created/last-used times, state (`pending`, `committed`, `uncertain`, `invalid`). |
| Artifact | Exact plain filename, byte length, SHA-256, response token count, completion outcome, client save wall time and engine timing. Compute a full file hash once when publishing, not on every continuing token. |
| Backend | Effective server identity/endpoint, exact model, saved profile/config digest, Terminal/API hash, native engine hash/version/source commit. Runtime instance identity is useful diagnostics; a new instance alone must not invalidate an otherwise compatible restart snapshot. |
| Numeric identity | Model bundle revision/digests; effective K/V format, context/rope/control-vector/arithmetic settings and relevant environment; source config plus resolved overrides. Keep secrets out of the manifest. |
| Prompt identity | Tokenizer/chat-template revision, system and tool-schema identity, canonical normalized message/image identity and digest of the prefix intended for reuse, pin boundary, message/history revision, prompt/mod revision where relevant. Keep full authoritative messages in their normal store. |

The engine already checks model/config fingerprints, but AI RPG should be more conservative: its model fingerprint samples size and the first/last MiB of model inputs, and its config fingerprint uses an engine version string rather than the binary hash. A same-version custom binary change or same-size mid-file weight edit can evade those checks. Establish full model identity at installation/change time; do not rehash tens of gigabytes for every prompt. Tokenizer/template/tool changes may pass binary compatibility while destroying prefix reuse, so track application-level identity too. [R5, R8]

Invalidate or decline restore on incompatible model/build/settings/format, changed tokenizer/template/prompt semantics, wrong game branch, a missing artifact, byte/hash mismatch, or untrusted origin of the file. An append-only continuation can reuse an older revision; a changed suffix can still reuse a known unchanged pinned prefix. Verify that relationship rather than demanding equality of the entire future request. Changing sampling temperature or seed alone is not an engine file incompatibility, but exact future output is never guaranteed. Persist the reason for a miss/invalidation. [R8]

### Safe lifecycle and publication

1. **Select:** resolve the effective AI configuration. Only an explicitly enabled, matching Strata capability can use disk sessions. Remote GLM, CLI bridges, unrelated prompt overrides, and disabled local models preserve their current behavior.
2. **Admit:** reserve the normal prompt/lifecycle transaction and drain the previous owner. Verify identity/readiness and complete existing ComfyUI cleanup. Require a single owner for this server's session operations; additional apps/CLI clients must use the same broker or remain quiesced. An in-process mutex cannot protect against them.
3. **Park outgoing A:** if A has advanced and needs persistence, save A while it is still the known live owner. Create a durable pending manifest and a **new revision filename**; do not overwrite the last committed revision. SAVE is legal only after a complete held state exists, not midway through streaming or after an ambiguous failed generation. Keep A's ordinary message history regardless of cache outcome.
4. **Publish A:** on verified HTTP 200, check the returned filename/slot/counts, inspect the regular file at the expected server-local path, verify size/hash, then atomically publish/fsync the new manifest/catalogue pointer. Retain the old committed revision until the new record is durable. A crash between snapshot creation and manifest commit leaves an orphan, not an automatically trusted cache hit. On separate hosts, do not assume the game process can inspect the server's filesystem; that requires a trusted storage helper/contract.
5. **Load B:** if B is already the known live context, avoid disk work. Otherwise choose a committed compatible snapshot, revalidate the unchanged reusable prefix, RESTORE it, and only on success record B as live. If B has no eligible snapshot, send its full normal request for cold prefill under the explicit miss policy below. Before restoring, do not assume A was preserved automatically.
6. **Run:** send B's complete current messages through the existing transport, retaining retries/validation, tool permissions, progress/cancellation, and game-side receipts. A restored snapshot never proves that a tool was executed or that a game mutation committed.
7. **Retain:** mark the resulting live state/revision accurately. Save at explicit switch/suspend, before an authorized planned stop, or another measured checkpoint policy; avoid full writes for unadvanced identical state. A browser disconnect is not necessarily the end of a server-owned game context. Abrupt death may lose the most recent cache revision; normal game saves remain recoverable.
8. **Retire:** only after publication and outside active use, remove application-owned obsolete revisions according to an explicit disk budget/retention policy. Protect live, pending, committed-current, and in-flight artifacts. Reconcile stale pending/orphan files on startup or deliberate maintenance, not by continuous polling. No native disk eviction or erase API performs this work.

Use an application budget that includes committed files, retained previous revisions, pending saves, and hashing/metadata work. A SAVE uses a new temporary file before publication; replacing a 3 GiB file still requires space for the full new 3 GiB file plus reserve while the old one exists. If retaining two revisions for N contexts, budget roughly `2 * N * measured_file_bytes`, plus in-flight work and disk reserve. Do not use the engine's 4096 MiB RAM-cache budget as a disk budget. [R4, R5, R8]

## Failures and cold prefill

The proposed cache-miss recovery is an explicit performance policy, not implemented behavior. A missing or deliberately invalidated cache can use the normal full-message request, recording a visible/diagnostic cold-prefill reason. Preserve the original error and the project's existing persistent error UI with stack/cause for failed cache operations. Never turn permission errors, I/O failures, readiness failures, or partial restore into silent success.

| Result | Proposed handling |
| --- | --- |
| `400` invalid filename/slot/action | Programming/configuration error: stop the affected operation with the exact error; fix the caller. |
| `400`, engine `error.kind: invalid` for corrupt/incompatible file | Do not reuse that artifact. Retain diagnostic metadata and quarantine/invalidate it without overwriting a known-good revision. Native validation refusals occur before device writes. An explicitly reported cache miss may then cold-prefill from authoritative messages. |
| `404` missing file | Record catalogue/file inconsistency, mark a miss, and cold-prefill under the configured policy. Do not invent a replacement snapshot record. |
| `501` disabled API or parallel mode | Feature/capability configuration error. Do not repeatedly retry or pretend disk caching is available. |
| `503` memory or model not loaded | Inspect typed cause and existing runtime state. Preserve the RAM floor and manual-off intent. Defer/abort the cache operation; do not start or unload models to obtain space. Cold prefill itself may also need RAM. |
| `507` storage | Retain previous committed files; surface disk/reserve/quota details. Apply only the agreed application-owned retention policy or wait for operator action. |
| `500` I/O or engine failure | Preserve the error. A validation/read refusal leaves live state intact; a transfer failure after device writes ends the native engine rather than use partial state. Reverify runtime readiness/ownership through the existing manager before any later prompt; never label the previous context live by assumption. |
| SAVE `error.published: true` | The new bytes have replaced the destination but its directory flush failed; an error does not mean “no file written.” Mark this candidate uncertain, keep the older committed revision under its different name, and do not publish the new catalogue pointer automatically. Reconcile explicitly before reuse. |
| Timeout, connection loss, cancellation after dispatch | Outcome can be uncertain: the server may still finish SAVE/RESTORE. Do not blindly retry or dispatch another context switch. Hold/stop new mutations until completion/state is reconciled; if that cannot be established, surface the uncertainty and require recovery through the normal lifecycle. A file's existence alone does not prove that a particular RESTORE completed. |

The native writer uses an exclusive hidden temporary file, flushes file bytes, renames to the requested name, and flushes the parent directory on POSIX. An unpublished failure keeps the old destination; a published failure cannot restore it. Some filesystems reject directory flush as unsupported and log that limitation. These details motivate new revision names and an independent manifest commit. [R4, R5, R7, R8]

Session contents are sensitive: token IDs are recoverable conversation data and the binary holds model state. There is no encryption or authenticity guarantee in the format's corruption hash. Restore only files written by this trusted installation/user. Do not accept arbitrary uploaded session binaries. Keep the cache directory private, enforce filename/ownership/regular-file checks, avoid links and unexpected mounts, and apply the same access restrictions to manifests, exports, backups, and diagnostics. The native reader rejects symbolic links and multiple hard links, but that is not a substitute for a trusted directory. Existing saved server binding is `0.0.0.0`; protect its API access, including slot operations, using the project's intended authentication and network controls. [R4, R8]

## Capacity and latency: measure the useful path

The source's historical benchmark is **not Shodan or this DavidAU/INT8 deployment**: RTX 4070 Ti 12 GB, Ryzen 9 5900X, 64 GB RAM, NVMe ext4, IQ3_XXS, engine 0.1.38, 63,025 tokens. It reports about 1.20 GB on disk, 0.65 s save, and 1.05 s restore into a new process; these were single runs. Use it as feasibility evidence, not an SLA or a linear 128K prediction. [R8]

Illustrative transfer arithmetic only: if a measured file were 3-4 GiB, at a sustained 500 MiB/s its bytes alone would take about 6.1-8.2 seconds each way; at 1000 MiB/s, about 3.1-4.1 seconds. Saving A and restoring B generally adds both costs. Real capture, fingerprints, parsing/hash validation, host/device transfer, filesystem flush, queueing, optional reclamation, and remaining prefill add time. A vendor SSD headline or warmed page-cache copy is not a restore measurement.

On Linux this engine tries direct I/O in 16 MiB blocks where supported, with buffered fallback; `STRATA_SESSION_BUFFERED=1` forces buffered I/O. Record the actual mount/device and I/O mode. Compare normal runs and contention with game saves/model reads; do not clear the machine's global page cache for a benchmark. Measure the current XFS SSD path separately from the rotational home path if that comparison is useful. [R8]

For representative 32K, 64K, and near-128K contexts, record:

- Exact backend/profile/model/binary identity, actual prompt/held token count, tools/pin boundary, K/V settings, concurrent workload, RAM/cgroup headroom, and selected storage mount.
- Actual `stat` file bytes plus `n_written`/`n_read`, engine `save_ms`/`restore_ms`, client wall times including queue/reclaim, hash/manifest publication time, and maximum transient RAM.
- End-to-end switch-to-first-token and completion latency: save outgoing + restore incoming + remaining prefill + generation. Also measure same-live-context reuse and cold full-prefill baselines. Use the backend's actual reuse/usage diagnostics rather than assuming `n_restored` equals tokens reused by the next prompt.
- Several independent runs, median and tail/range, first-restore and repeated-restore conditions. Include disk-space growth, daily bytes written from the proposed save cadence, and an intentional no-advance case that should avoid redundant writes.

Enable automatic switch-time saving only when this full path wins for the workload. A short helper sharing an already-live pinned prefix may be faster without any disk switch. Keep instrumentation bounded and behind an explicit diagnostic mode; disable detailed prompt/file logging after qualification.

## Implementation and validation handoff

1. Add an explicitly opt-in Strata disk-session capability/configuration with strict effective-target validation. Keep the default and remote backend unchanged. Implement a narrow Strata session HTTP client, conservative manifest/catalogue, and serialized lifecycle integration described above. Preserve existing llama.cpp slot-cache semantics.
2. With mocks and private temporary files, verify save/restore response validation, prefix identities, endpoint overrides, manual-off/readiness guards, A-save/B-restore ordering, parallel callers, nested prompts, and image/toggle exclusion. Demonstrate no gate reacquisition deadlock and no wrong-context save between a completion and its snapshot.
3. Exercise unpublished save failure, `published: true`, missing/corrupt/incompatible files, permission/storage/RAM refusal, timeout after dispatch, manifest failure/crash between publication steps, and cleanup protection of in-flight/current revisions. A cache failure must not repeat a game tool or overwrite an authoritative save.
4. Only in a separately authorized real-model window, qualify a private test conversation: full prefill A, save A, run distinct B, restore A, continue with A's full messages, and inspect actual prefix reuse. Repeat across a clean same-build restart, with the pinned-prefix branch behavior, an invalidated suffix, and a corrupt **copy** of a test file. Never corrupt or overwrite a live/production snapshot. Do not demand byte-identical later output: source documentation explicitly disclaims exact replay across restarts.
5. Collect the capacity/latency matrix above before choosing retention limits, save cadence, maximum file size, or reclaim enablement. Deployment acceptance is correct conversation identity and game state, reliable error handling, bounded storage, and measured benefit. This document performs no runtime qualification.

Project test commands must follow `/home/bart/AGENTS.md` containment: wrap non-browser tests once with `systemd-run --wait --collect --pipe -p MemoryMax=16G -p MemorySwapMax=0 -p "WorkingDirectory=$PWD" <test-command>`; browser tests use its user-scope form. These are instructions for future implementation checks. Documentation-only validation here checks saved bytes, Markdown structure/links, and source references; it does not run tests, contact a model, or restart a service.

## Source map and limits

Line references are pinned to the working files inspected on 2026-11-06; recheck after edits or upgrades. Installed absolute links are intended for Shodan. No runtime SAVE/RESTORE, 128K snapshot, cache feature implementation, or SSD benchmark was executed. The code findings are static analysis.

- **R1 — AI RPG profiles:** [Strata named configuration](../config.yaml.strata-davidau), lines 11, 41-66; [default configuration](../config.yaml), lines 41-45. Existing files were read without changing their selected backend.
- **R2 — Saved installation:** [profile pointer](/home/bart/.config/strata/profiles/davidau-iq3-s-ram.json), lines 1-6; [saved run config](/home/bart/.local/share/strata/install/strata-davidau-iq3_s-plain-ram.json), lines 1-56 and final `ram_standby` setting.
- **R3 — Build identity:** [custom build manifest](/home/bart/.local/share/strata/custom/ram-standby-pr2-20261026-sm89/BUILD-LOCAL.json), lines 1-17; Terminal [VERSION](/home/bart/.local/share/strata/terminal/0.1.49.2/VERSION) and [COMMIT](/home/bart/.local/share/strata/terminal/0.1.49.2/COMMIT); matching source [CMakeLists.txt](/home/bart/tmp/codex/strata-ram-standby-pr2/src/CMakeLists.txt), lines 11, 23. Actual installed API/native hashes were computed; the custom build directory's older `server.py` is not the active installed API source.
- **R4 — Installed Python API:** [serve/server.py](/home/bart/.local/share/strata/terminal/0.1.49.2/serve/server.py), lines 421-435 (typed errors), 2533-2625 (engine exchange/failure), 3956-3992 (paths), 4232-4298 (slot contract), 7309-7317 (routing), 8702-8704 and 9071-9080 (enablement).
- **R5 — Native implementation:** [src/program/generate.cpp](/home/bart/tmp/codex/strata-ram-standby-pr2/src/src/program/generate.cpp), lines 726-749 (defaults), 9405-9477 (identity), 12065-12302 (save/restore restrictions, RAM floor, replacement and failures). Source checkout HEAD `b6286b60ad54a883ef2374059343c3e1bdc0d677`, matching BUILD-LOCAL.json; the cited native source files had no local modifications at inspection.
- **R6 — File implementation:** [src/core/conversation_file.cpp](/home/bart/tmp/codex/strata-ram-standby-pr2/src/src/core/conversation_file.cpp), lines 79 onward (block I/O), 350-369 (safe open), 462-510 (publish/flush), 1051-1057 (space), 1132-1161 (pinned checkpoint selection and SAVE allocation estimate).
- **R7 — Optional reclaim wait:** [installed serve/session_save_retry.py](/home/bart/.local/share/strata/terminal/0.1.49.2/serve/session_save_retry.py), lines 12-14 and 35-83. This does not provide a general-purpose retry policy for AI RPG.
- **R8 — Matching source documentation and historical evidence:** [local DETAILS.md](/home/bart/tmp/codex/strata-ram-standby-pr2/src/docs/DETAILS.md), lines 1180-1319 (RAM parking), 1321-1457 (disk API, compatibility, format, failures and benchmark); [saved run log](/home/bart/.local/share/strata/install/strata-davidau-iq3_s-plain-ram.log), lines 98623 and 98702 (RAM snapshots). The [current upstream reference](https://github.com/Niko1221/Strata/blob/main/docs/DETAILS.md#session-files-disk) is useful orientation but changes over time; installed native/API source wins where it differs.
- **R9 — Prompt policy and transport:** [LLMClient.js](../LLMClient.js), lines 1856-1918, 2745-2754, 2993-3023, 7262-7271, 7708-7744; [LLMClient documentation](classes/LLMClient.md), lines 184-196 (message boundaries, tool exposure and pinned prefix). Files contain unrelated local edits; reread before implementation.
- **R10 — Runtime/image lifecycle:** [StrataRuntime documentation](classes/StrataRuntime.md), especially ownership, readiness and shutdown; [ImageGenerationModelLifecycle.js](../ImageGenerationModelLifecycle.js), lines 58-74; [lifecycle documentation](classes/ImageGenerationModelLifecycle.md); [installed API patch notes](strata_terminal_logprobs_patch.md), lines 1-22.
- **R11 — Existing llama.cpp cache:** [LlamaCppRouterClient.js](../LlamaCppRouterClient.js), lines 16, 250-365, and [router client documentation](classes/LlamaCppRouterClient.md). Its delete-after-restore behavior and model-switch trigger are separate from this proposal.

Only this new document is created. The existing documentation index and unrelated working files are left intact under the documentation-only/new-file scope of this request; a future implementation can add the index entry with its normal documentation update.
