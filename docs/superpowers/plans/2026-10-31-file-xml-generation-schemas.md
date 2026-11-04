# File-backed XML generation schemas

Add named editable XML schema files and a generic loader/compiler to the existing
live token guard. Required exactly once is the default, optional permits omission,
multiple permits 1+, optional+multiple permits 0+, and siblings are unordered.
Leaves describe model-written text. Reject unknown children/singleton duplicates/
wrong nesting and early closes, keeping final XML/domain validation unchanged.

Try sampled alternatives first. Only alternative exhaustion permits tag-only
synthetic prefixes: reconstruct the prefix at rejected/pending markup start,
force the first missing required opening tag in schema order or matching close,
and resume the model. Preserve caps/cancellation, finite force rounds and explicit
logging; never fabricate sampled IDs/probabilities or semantic values.

The initial real rollout covers inventory, single Thing, container contents and
location standard/TinyBrain planning/final stages with separate named wrappers.
Core layouts live in schemas/xml; active Modules/Implants layouts live in named
mod fragments and canonical registry descriptors verify them. Keep allowed empty
batches/status containers and formerly optional fields. No backend changes,
installed writes, runtime controls, game reload or model calls belong to this task.

## CDATA steering

Generated CDATA delimiters are pseudo-stack frames: balanced unrestricted inner
XML-like tags cannot close outer frames or satisfy outer schema requirements.
The real ]]> delimiter wins even inside inner quotes/comments; incomplete inner
tags must rewind before deterministic closure. Literal nested CDATA opening text
does not create another real region. Literal comparisons remain text. Close
obligations proceed through inner tags, CDATA end and outer element. Schema-only
input CDATA remains literal definition text. Nonempty CDATA obeys enclosing
child-only container rules; empty/whitespace remains valid.

## Verification

Use named-file compiler fixtures, scanner/cardinality/CDATA fixtures, mocked
stream/nonstream and direct/scoped client calls, bounded forcing/EOS/cancellation
cases and actual pilot adapter handoff checks. Run tests under the required
16 GiB/no-swap scope; use no live model or runtime/service control.

## Completed verification

Focused file/compiler/scanner/controller/direct-scope/stream-nonstream/pilot
adapter tests passed 23/23; shared closing/live/EOS regressions passed 53/53 under
the required 16 GiB/no-swap limit. Coverage includes real Modules registry fragment
composition, empty/single batches, separate TinyBrain roster/final handoff, CDATA
balancing/container restrictions, alternatives-first/forced prefixes, budgets and
cancellation. Changed JavaScript syntax checks pass. No live models, services,
installed backend files or configuration were changed by this task.

The prior EOS backend extension is already installed and verified (successful
receipt tmp/strata-eos-deploy-20261031T182642Z/deployment-receipt.json). This rollout
requires only the next authorized game-code restart, not another backend patch.
