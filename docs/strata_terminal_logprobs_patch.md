# Strata terminal-logprob metadata patch

Status: installed and real EOS metadata verified during the approved 2026-10-31
restart. The successful receipt is
`tmp/strata-eos-deploy-20261031T182642Z/deployment-receipt.json`; installed API hash
matches the target below. File-schema support requires no further backend patch,
only an authorized game-code restart.

The durable patch is [patches/strata-terminal-logprobs.patch](../patches/strata-terminal-logprobs.patch).
It extends the installed custom Terminal 0.1.49.2 API, including its existing
sampled-logprob and termination-trace work. It is not based on the older
`strata-logprobs-control` checkout. No native binary, tokenizer/model bundle,
profile, credentials, RAM/memlock limit or tracing environment changes are needed.

| File | Required SHA-256 |
| --- | --- |
| Installed base `serve/server.py` | `28ec9b283d3d3b639e631ab117e261daebd0085de3775cbe855c559e86f34de6` |
| Patched target `serve/server.py` | `d475bbd4583e932c30f4cc7ee059d1ba4ab3751c98ac091db15c7d905b384992` |
| Unchanged `serve/termination_trace.py` | `c8bf615f823779776298920fe50eea31e86847a2828dcd924319637bf3657c24` |

## Reproduction and deployment

The inspected installation root is
`/home/bart/.local/share/strata/terminal/0.1.49.2`. Verify both base hashes before
using this patch. A differing base requires review/rebasing; do not replace it
with a full older server file. Copy the verified base files to an isolated staged
root containing `serve/`, then apply the durable patch there with `patch -p1`.
Use `patch --dry-run -p1` first, compile the Python files, and verify the patched
target hash above. The tested review payload lives in
`tmp/xml-eos-guard-backend`, with base/deployment receipts and the same diff.
Only the small patch is retained as durable backend source in this repository.

The runtime coordinator owns any installed write and authorized restart.
Immediately before deployment, recheck the installed base hashes, retain a backup
and deployment receipt, and deploy only the reviewed server patch. The trace module
remains unchanged. Coordinate the backend metadata extension and new game-side
code; do not start a second engine or disturb the existing owned runtime, saved
profile or resource containment during verification.

## Wire behavior

Only requested logprobs gain `choice.logprobs.terminal`. Actual EOS metadata has
`reason: "eos_token"`, `sample` (id/token/bytes/logprob/top_logprobs), and every
`stop_token_ids` identity. It is separate from visible `logprobs.content`, so EOS
is never fabricated as generated text. All requested raw alternatives are kept;
unrepresentable UTF-8 has null token text plus raw bytes. Other observed terminal
causes have explicit reason without an invented EOS sample. Final cancellation
supersedes earlier EOS, including MCP cancellation; recovery/next legs replace
older terminal samples. Existing finish reasons, usage, trace and no-logprob
responses retain their behavior.

[XmlClosingTagGuard](classes/XmlClosingTagGuard.md#actual-eos-with-incomplete-xml)
uses the sample only for incomplete XML, skips native tool turns, and performs an
append-only branch within output and retry-derived round budgets. Old providers
without metadata still accept plain/closed XML, but cannot silently classify an
ambiguous stop for incomplete XML.

## Verification

The installed sources remain untouched during coding. Scanner/controller and
mocked client tests run without a model. The opt-in staged backend probe uses an
inert scripted MockEngine and the installed Python dependencies; it starts no GPU
or production Strata service:

```bash
systemd-run --wait --collect --pipe -p MemoryMax=16G -p MemorySwapMax=0 \
  -p "WorkingDirectory=$PWD" env STRATA_EOS_STAGED_PROBE=1 \
  node --test tests/strata_eos_metadata_integration.test.js
```

It checks streaming/nonstream metadata, no-logprob equivalence, token-limit/EOS
tracing, native tools and cancellation/MCP precedence. Ordinary runs skip the
probe when the staged payload/local dependency prerequisites are unavailable.
