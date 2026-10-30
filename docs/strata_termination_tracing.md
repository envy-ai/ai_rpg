# Strata termination tracing

This local diagnostic distinguishes model EOS, matched stop strings, token caps,
generation guards and interrupted requests when the OpenAI finish reason alone
is ambiguous. It does not change generation settings or repair malformed XML.

The tracing source is the isolated Strata branch
`debug/termination-trace-20261028` in
`/home/bart/tmp/codex/strata-termination-trace-20261028`, based on the installed
RAM-standby API source (local commit `2f02a980`). The original checkout remains unchanged. The patch is
Python-only; it does not replace the GPU engine, tokenizer or model weights.

## Records and correlation

Enable the backend with `STRATA_TERMINATION_TRACE_PATH` set to an absolute file
path whose parent exists. The local diagnostic destination is
`/home/bart/ai_rpg/logs/strata-termination.jsonl`. Without the variable, the normal
generation path remains in use. Invalid paths fail at startup. Records append;
do not delete logs manually.

One `strata_termination_trace` record describes each shared `Service.run` leg.
MCP calls or retries can produce several legs for one HTTP response. Match its
`responseId` to `providerResponseId` in the game's
`logs/completion-timing-YYYY-MM-DD.jsonl`, then use that completion row's prompt
label, completion ID and attempt to locate the owning prompt log. Raw provider
IDs are captured as HTTP/SSE metadata arrives, including when later parsing fails;
missing IDs remain null and CLI synthetic IDs are excluded. UTC times, model
and token counts provide additional evidence for older records without IDs.

Useful backend fields:

| Field | Meaning |
| --- | --- |
| `terminationReason` | Observed EOS, stop match, token limit, guard, interruption, or explicitly unknown engine completion. |
| `terminalTokenId`, `effectiveStopIds` | The actual terminal EOS token when observed and the configured token-stop identities. |
| `stopSource`, `stopList`, `matchedStopIndex` | Effective stop-string source, ordered SHA-256/length entries, and the matched entry. Stop strings themselves are not logged. |
| `maxNew`, `contextTokens`, `outputTokens` | Resolved output cap, context size, and observed completion count. |
| `engineDoneFinish` | Engine-reported completion status; it is not treated as proof of EOS. |
| `rawTokenTail`, `rawTokenSha256` | Last eight numeric token IDs and digest of all observed raw IDs. |
| `rawTextChars`, `rawTextSha256` | Decoded text count and digest before service parsing. |
| `contentChars`, `contentSha256`, `reasoningChars`, `reasoningSha256` | Counts and digests of emitted answer/reasoning events, including parser-finalization output. |
| `parserStateBeforeFinish`, `parserStateAfterFinish` | Parser state around finalization; adjacent buffer and detokenizer fields show withheld tails. |

The trace excludes prompt text, generated text, headers and credentials.
`STRATA_DEBUG=1` is a separate switch that prints raw content and is unnecessary.
Content digests describe service events; later format/tool processing or the
game's trimming/think-tag removal can change the final client text. An earlier
segment's EOS is not reported as the final cause after generation recovery.

## Deployment and verification

Deploy only the tested `serve/server.py` and `serve/termination_trace.py` into
the installed Terminal API after checking its original source hash. Retain a
backup and a deployment receipt. Enable the environment variable through the
managed Strata service, preserve its RAM/memlock limits and launch configuration,
and use the runtime coordinator for an authorized idle restart. Do not run a
second engine alongside the RAM-resident service.

The local activation uses
`/etc/systemd/system/strata-davidau-ram.service.d/90-termination-trace.conf`.
Its verified deployment receipt and protected rollback snapshots are under
`/home/bart/tmp/codex/strata-termination-trace-owner/activation-20261028T005702Z`.
Activation retained the existing engine/configuration, `ram_standby: false`,
elastic VRAM handoff, and managed memory/memlock limits. Live readiness and a
small non-game request produced token-limit and observed-EOS (`248046`) traces.

Disabling the environment variable returns to the normal path on the next
Strata restart. Restoring the backed-up server and removing the tracing module
is a separate code rollback. An upstream Terminal upgrade may replace local
patches; verify them before assuming tracing remains active.

Mocked backend tests cover EOS, split stop matches, limits/guards, interrupted
requests, final parser tails, recovery segments, invalid paths and disabled-path
event equivalence. These tests do not establish a cause for historical failures;
a new live trace must capture the failing request.

## Captured startup reproduction, 2026-10-28

The ordinary New Game API was run with world profile
`Luminex Online: The Infinite Strata` and saved form
`2026-10-24T21-14-01-832Z_Exis-lvl-3-2026-10-24`, without changing its fields or
sampling settings. Existing settings-load/apply and new-game APIs were sufficient;
no launch arguments were added.

`inventory_generation_Tessa` reproduced the original missing closing-root symptom
on all seven attempts. Each response contained four complete items and no
`</items>`. Observed EOS token `248046` ended each generation after 1,706–1,851
of 20,000 allowed tokens. Stop strings were absent, parser buffers were empty,
and detokenization had no pending text. Raw decoded, emitted and application-log
hashes matched on every attempt. Final response ID:
`chatcmpl-0dfa0c81e9db4b5db62b98b0` (backend trace line 72).

`inventory_generation_Seven` first ended with `<items>` instead of `</items>`.
It generated four complete items and selected EOS token `248046` after 1,921
tokens, against a resolved cap of 20,000. There was no stop string. Its raw decoded,
service-emitted and application-logged SHA-256 values were identical. The next
response differed only by the missing slash and passed validation. The final raw
token sequence changed from token `27` to `510` at that position before EOS,
confirming a different generated token rather than a slash removed downstream.
Failed response ID: `chatcmpl-9c383d09f1734ecea88d35ad`; accepted retry:
`chatcmpl-d6d60c8d58ea41ef9e706533`.

NPC skill assignment in the same start also exhausted seven attempts with a
missing `</npcs>` root. The final output had three complete `<npc>` children and
selected EOS after 528 of 20,000 allowed tokens, with no stop string. Again the
decoded, emitted and application payload hashes matched. Final response ID:
`chatcmpl-1f04e857b6fa40aa8ebe4c88`.

These captured failures originate in generated XML. They do not show transport
truncation or parser tail loss. The historical PyraCore/Thistle failures predate
backend tracing and cannot be matched retrospectively to raw token evidence.
The original parser still rejects malformed XML; no auto-repair was added.
Local evidence is in
`tmp/strata-generation-investigation/tessa-inventory-omission.json`,
`confirmed-inventory-omission.json` and `confirmed-root-omission.json` in that
same directory. The optional archived PyraCore replay was prepared
but not sent because the ordinary startup reproduced the failure class.

The start returned HTTP 200 after about 20 minutes 32 seconds, with 101 completion
records matched to 101 backend traces. Exis is level 3 at Gate Plaza; ability
selection remains pending and the intro is deferred. The initialized world was
saved as
`2026-10-28T01-28-32-483Z_Luminex_Online_The_Infinite_Strata-Exis-Gate_Plaza-char_1-mvrfr74z`.
The NPC skill-assignment and Tessa inventory failures remained recorded; success
of the overall start does not mean every optional generation succeeded.
After saving, app image jobs, global ComfyUI jobs and Strata
`activity.in_flight` were all zero. Saved initial repertoires were empty in this
run, so the discipline-access override's standard/TinyBrain/rollback behavior is
verified by its mocked tests rather than this live start.

## DONE suffix experiment

At the user's request, one isolated replay used Tessa's first logged two-message
conversation with this instruction appended to the final user message:

> After the final closing XML tag \</items>, write DONE on a separate line. Do not stop before writing both \</items> and DONE.

The replay returned a complete, strictly valid `<items>...</items>` document
followed by a terminal `DONE` on its own line. Response ID:
`chatcmpl-2865c0d03ad248a99ccbd002`. Strata observed EOS token `248046` after
2,200 of 20,000 allowed tokens, with no stop strings. Decoded, emitted and
received text hashes matched. The expected trailing marker was checked separately
from strict XML validation; no malformed XML was repaired or applied to the game.

This is one successful replay using reconstructed HTTP settings, not a captured
original wire request or a reliability measurement. Its payload, provenance,
complete SSE response and correlated trace are retained under
`tmp/strata-generation-investigation/tessa-done-20261028`.
