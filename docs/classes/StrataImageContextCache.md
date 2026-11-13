# StrataImageContextCache

`StrataImageContextCache.js` retains one held Strata conversation across an image
batch through the native session-file API. It preserves ordinary full text
requests and shared-prefix policy. It implements only the image handoff portion
of the broader [disk-cache proposal](../strata_disk_context_cache.md).

Enable it on the effective `image_prompt_generation` AI profile:

```yaml
ai:
  image_generation_handoff:
    provider: strata
    mode: elastic
  strata_context_cache_directory: /c/tmp
```

The target must configure `ai.strata_runtime` with matching endpoint/model and
verified ownership. `ai.strata_context_cache_directory` defaults to `/tmp` in
`config.default.yaml` and when omitted; explicit null disables snapshots. The path
preference enables no capability by itself: it is unused without managed elastic
Strata, including unmanaged and `ram_standby` handoffs. The named Strata profile
selects `/c/tmp`. The former nested handoff path field is not accepted.

The directory must already exist and resolve without symbolic links. It must be
owned by root or the AI RPG user and accessible to the game for reading, writing
and traversal. Group/other-writable directories require the sticky bit, permitting
normal `/tmp` mode 1777; private user-owned directories such as mode 0700 are also
accepted. No directory permissions are changed. Both AI RPG and Strata must see
the same directory. Snapshot files remain private and owned by the game user.

The saved native run JSON must independently set top-level `slot_save_path` to
that exact directory. This is a server setting, not a native engine argument.
Its activation requires an authorized restart. HTTP status does not expose the
save directory; actual local snapshot validation detects a mismatch before
rendering. Disabled API, missing file, wrong size, and permissions failures are
reported explicitly.

The lifecycle holds one existing exclusive gate across save, GPU shrink, the
whole image batch, ComfyUI cleanup, GPU reserve restoration, and disk restoration.
Cancelled or failed renders still attempt recovery, preserving all independent
errors. Restoration neither reacquires the gate nor starts a model. A manually
switched-off model retains the existing render-only path.

The client uses root `POST /slots/0?action=save|restore` with `{filename}` and the
captured effective headers. Reverse-proxy prefixes are preserved. Before each
operation it verifies managed owner/instance/host/API start identity and the
loaded exact model. It validates slot, filename, positive integer token/byte
counts and nonnegative timing. The local artifact must be a private regular
file owned by the game user with the exact returned size. Recovery additionally
requires unchanged device, inode, size and modification time and matching
restored token/byte counts.

Only the installed typed native refusal `HTTP 400`, `error.kind: "invalid"`,
`error.message: "no complete session to save"`, without `published: true`, means
no held snapshot exists. The lifecycle logs that explicit outcome and continues.
Every other refusal blocks rendering. Once SAVE is dispatched, image cancellation
does not abort that bounded request, allowing its acknowledgement to determine
whether recovery is needed. Recovery ignores a cancelled image signal and uses
bounded requests. Original errors remain in causes or an AggregateError.

Each lifecycle allocates one filename through
`IdGenerator.nextSequential('strata_image_cache')`. Successful verified restore
deletes only that artifact. Failed restore or ambiguous save retains it. An
existing file blocks a subsequent SAVE at that filename, with an explicit
recovery/removal instruction, preventing stale-file acceptance and unlimited
failure accumulation during a live process. No startup replay or scanning is
performed; crash artifacts remain for explicit cleanup. Game saves and logs are
never deleted. External API clients must remain quiescent during the transaction;
the in-process gate cannot serialize independent callers.

The constructor supports injected `httpClient`, `fileSystem` (`fs.promises`
methods), `uid`, `ensureRuntimeReady`, `filename`, `signal`, and `timeoutMs`
(default 600000; the lifecycle passes the effective connection timeout). The client
also defaults `contextCacheDirectory` to `/tmp`.
`save()` returns `{saved: true, filename, tokens, bytes}` or
`{saved: false, reason: 'no_complete_session'}`. `hasSavedSnapshot` records a
verified snapshot. `restore()` requires that receipt and consumes it only after
successful recovery and artifact removal.
