# XML actual-EOS guard and staged Strata terminal metadata

Extend the existing xml_closing_tag_guard, without a new user flag, to reject an
observed EOS while XML has an open-element stack or pending markup. Keep plain
output, closed XML, explicit non-EOS termination and native tool turns unchanged.
Choose a valid non-EOS alternative at the exact raw response end and use existing
assistant-prefill continuation; never manufacture visible EOS text or repair XML.

## Protocol and provenance

Stage the exact installed Terminal 0.1.49.2 serve/server.py and termination_trace.py
under tmp/xml-eos-guard-backend/serve, not the older logprob-control checkout.
base-receipt.json pins installed SHA-256; deployment-receipt.json and server.patch
pin/review the finished payload. The trace module remains byte-identical. No
installed write, runtime controls or restart belongs to this coding task.

Requested logprobs gain choice.logprobs.terminal with reason, actual sampled EOS
record and all raw top alternatives, plus stop_token_ids. Content records remain
unchanged. Final non-EOS causes carry explicit reason without an invented EOS
sample. Reset samples per recovery pass and final MCP leg; cancellation supersedes
prior EOS. Preserve finish_reason, usage, tracing and unrequested API behavior.

## Client boundaries

The scanner reports open names and pending lexical markup, including an initial
partial root. Terminal inspection skips native tool turns and plain/complete XML.
Incomplete XML with an unknown/missing stop cause reports an explicit diagnostic;
a generic finish_reason stop is never treated as proof of EOS. Actual EOS metadata
must have valid stop identity, finite scores and alternatives. Exclude every stop
ID and chat/control token when selecting an append branch.

EOS/prose branches and length/fallback continuations share the original finite
positive output cap. Count generated samples/EOS, reconcile reported completion
usage and charge branch attempts. EOS round trips are also limited to the effective
retry allowance plus one (shared validated retry parser), independently of normal
retry consumption. Ordinary validation/network/user retries reset their new budget
and EOS-generation state; continuations do not. Missing original token budget or
exhausted limits fail explicitly. Strict final XML/domain validation remains.

## Verification

Use scanner/controller fixtures, mocked standard/TinyBrain streaming and chunked
client calls, and a Python MockEngine HTTP fixture importing the staged server.
Verify no-logprob response equivalence, trace EOS/limit records, terminal metadata,
partial roots, append-only branching, missing metadata, non-EOS stops, native tools,
cancellation/MCP precedence, retry budgets and explicit exhaustion. All test runs
use the required 16 GiB/no-swap scope. No real model/GPU is needed.

The final backend delta is also retained durably in
patches/strata-terminal-logprobs.patch; docs/strata_terminal_logprobs_patch.md pins
base/target hashes and reproduction notes. The full backend remains staged only.

## Completed evidence

- Existing affected shared regression batch passed 38/38.
- Focused scanner/controller and standard/scoped stream/nonstream EOS tests passed;
  the semantic retry regression confirms fresh max_tokens 100 then 100 while EOS
  continuation retains its reduced budget.
- Opt-in staged Python MockEngine HTTP tests passed streaming/nonstream metadata,
  unrequested-path equivalence, EOS/limit trace, native tool and cancellation cases.
  Direct MCP fixtures confirm earlier EOS cannot leak into final limit/cancel legs.
- JavaScript syntax and staged Python compile checks passed. Durable patch dry-run
  and application to an isolated verified base reproduced the exact target hash.
- Installed base/trace hashes remain unchanged; no backend installation, game or
  Strata restart, real model/GPU generation or runtime control occurred here.
