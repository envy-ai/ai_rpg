# PromptRetryPolicy

`PromptRetryPolicy.js` converts the configured count of retries after an initial response into a total prompt-attempt limit.

`resolveConfiguredPromptMaxAttempts(aiConfig, { fallbackMaxAttempts })` returns `aiConfig.retryAttempts + 1`. An absent configured value uses the supplied positive fallback total, which defaults to three attempts. Invalid configured or fallback counts throw; values are not clamped.

Standard location item/scenery generation uses these helpers for one strict root/XML/count/rarity/whole-Thing validation conversation with exact error feedback. Inner completion XML validation is disabled to avoid nested blind retries, while exhausted transport errors propagate directly. The TinyBrain `location_things_generation` family instead gives its roster checkpoint and final expansion stage their own `ai.retryAttempts + 1` parser budgets; final failure preserves the approved roster for correction. Both paths require complete validation before batch creation. See [LocationThingGenerationPlan](LocationThingGenerationPlan.md).

Player level-up option generation also uses this configured total when a response yields too few nonexcluded unique cards. The generator can request only the remaining number on later attempts; if the budget is exhausted while a selection submit is automatically opening the next missing level, the player-selection mutation is rolled back instead of returning an error with partially committed abilities, declines, or drafts.

The raw level-up completion adapter disables inner XML validation and propagates
transport errors. Its two callers retain their existing outer budgets and own
strict response parsing, uniqueness and level/target checks. They retain exact
correction feedback and complete attempt logs. Player partial cards stay local;
NPC progression rolls/rebalancing and ability setters run only after acceptance.
NPC required-addition mode retains three attempts, optional mode one, with empty
optional results valid. Each logical conversation has one failure reporter;
actual corrections increment its validation counter.
Their manual correction messages also use [XmlRetryFeedback](XmlRetryFeedback.md)
for an unclosed `<npcs>` root, while keeping their separate validation budgets
and exact parser errors.

Shared NPC generation also preflights the entire parsed draft batch before
acceptance: faction resolution, registered Player inputs and supplied starting
needs use detached normalization. Invalid later drafts cannot leave earlier
Player registrations behind. Construction, learning, placement and other world
mutations remain outside response correction.

`runPromptWithParseRetries(...)` keeps completion and structured parsing inside one bounded attempt loop. Parser rejection advances this loop; transport/completion retry budgets remain the completion client's responsibility, and terminal completion errors propagate by default. An optional `getCorrectableCompletionResponse(error)` callback can return a rejected response string to charge an explicitly selected model-output completion failure to this same outer budget, or `null` to propagate the original error. Explicit cancellation always propagates before that callback. Invalid callback return types fail with the completion error as cause. Rejected completion output never reaches the domain parser.

Explicitly marked fatal host execution/preparation errors also propagate without consuming parser corrections, even through a cause wrapper or a configured correctable-completion callback. Ordinary model XML and domain parser errors remain retryable under their existing budgets. Item-family template preparation uses this boundary for both standard and TinyBrain location/inventory generation.

By default, before another attempt, the rejected assistant response and a caller-supplied correction instruction are appended to a private working transcript. An optional attempt callback can log both accepted and rejected outputs; its `messages` snapshot includes the effective correction conversation, and `phase` distinguishes `completion` rejection from ordinary `validation`. Audit records identify completion-guard retries separately from parser retries. No caller-owned state is changed by the helper.

Parsers using [ResponseValidation](ResponseValidation.md) can supply up to three actual independent problems in one rejection. Shared retry feedback displays that numbered list even when a caller's instruction omitted the error text. The helper still invokes the parser once per response, retains the final rejection as its exhaustion error cause, and does not manufacture later problems for fail-fast parsers.

When strict XML parsing rejects an unclosed root, the shared [XmlRetryFeedback](XmlRetryFeedback.md) helper keeps the caller's exact error feedback and asks the model to close every open tag and write `DONE` after the root. A missing or wrong root, mismatched closing tag, or domain error keeps the caller's ordinary instruction. The policy never repairs the rejected response or changes its attempt budget.

If a correction receives exactly the same response as the preceding rejected attempt, shared retry feedback also appends the quoted insanity sentence documented in [XmlRetryFeedback](XmlRetryFeedback.md). Equality preserves whitespace, compares only consecutive failures, and resets with each new retry conversation. Both retained-response and fresh-original-message correction modes use the same comparison.

With a real `metadataLabel`, the helper owns one `PromptFailureReporter` scope of kind `parse_retry` around the whole conversation. Same-label inner completions join it, so parser exhaustion reports even when every completion returned successfully, and recoverable parser attempts emit no terminal notification. `validationRetries` increments centrally only when the rejected response actually advances to a correction after its attempt callback and retry instruction succeed; caller attempt callbacks must not increment the same correction again. Explicit cancellation (including an explicit cancellation in an exception's cause chain) propagates immediately without another parse attempt or failure notification. Optional `signal` also identifies intentionally aborted caller work to the reporter. Unlabelled generic helper uses retain the existing audit/return/error contract without inventing an `unknown` prompt notification; all production callers provide their real label. Existing same-label outer scopes that wrap multiple completions use `parse_retry` rather than the direct-completion kind.

Optional `metadataLabel`, `stage`, `parser` and `logPath` identify this validation conversation in [PromptAuditLog](PromptAuditLog.md). Production callers supply their real completion labels. Actual rejected responses are counted before any correction; accepted parsing explicitly marks that stage recovered. Audit instrumentation does not change retry budgets, returned values or error causes.

Character inventory generation uses its effective `inventory_generation_<Name>`
retry configuration for strict complete XML, item kinds, barter-stock counts,
whole-Thing/mod validation and final scaled candidate preparation. It logs every
accepted/rejected response with the full correction transcript. Inner XML retries
are disabled and transport errors propagate directly; item commits and attachment
remain outside the feedback loop.

Container contents and main location generation use the same outer-feedback
contract for all response-owned checks and detached candidate preparation. Shared
NPC generation also owns strict root parsing rather than nesting completion XML
retries. Item and banned-NPC rename conversations validate complete replacement
batches before applying setters; corrections preserve their existing total pass
limits. Pure direct response parsers instead use `LLMClient.responseValidator`
with `responseValidationRetryFeedback`, keeping one existing completion budget.

Starting-region generation and pending-region expansion use
`retainRejectedResponse: false`: each correction starts from the original
messages, including any image reference, and adds the exact parser error plus
an instruction to generate fresh complete region XML. Large malformed outputs
are logged without being reintroduced into the next prompt. Pure validation
precedes Region construction and location/exit instantiation.

Barter pricing uses both helpers. Every returned `<barterPrices>` response is logged and must pass strict XML, semantic item-reference validation, and the pass-specific effective generated-stock count bounds before merchant currency, generated stock, offers, sessions, or merchant replies can change. Haggle pricing requires exactly zero new seeds. An invalid haggle response therefore retries only pricing; it does not duplicate the player offer, create a merchant reply from rejected XML, or add stock.

Both start and haggle pricing explicitly select `barter-prices.schema.xml`.
Barter opts into correction only for marked model XML-guard response failures
with a complete `rejectedResponse` snapshot. Valid-budget exhaustion, repeated
forced prefixes and exhausted XML alternatives can request a fresh full response
within the existing `ai.retryAttempts + 1` outer limit. Each correction starts
from the original pricing messages plus the exact error, without retaining the
failed partial XML. Logs preserve that full stitched output and the effective
correction messages. Cancellation, transport failures, invalid schema/configuration,
provider EOS metadata and internal guard failures remain terminal to this outer
conversation. Existing missing-root completion correction remains owned by
LLMClient; no retry or continuation limits are increased.

Craft success-degree prompts also use `runPromptWithParseRetries(...)`. The selected result level must exist; craft/process consumed source IDs and positive quantities must resolve within the separately selected units, while salvage/harvest consumption names must match the selected target without repetition. These checks precede consumption, output instantiation, time advancement, narrative generation and history mutation.

Mode-specific named schemas preserve omitted fields inherited from the accepted
base outcome, partial canonical output items and active mod fields. Marked XML
guard response failures with a full `rejectedResponse` use the same fresh-response
policy as barter: original messages plus exact correction, within the existing
`ai.retryAttempts + 1` outer budget. The rejected stitched XML is logged rather
than retained in the next prompt. Attempt logs include effective messages,
completion-versus-parser rejection phase, accepted output and linked log paths.
Cancellation and unmarked completion errors remain terminal, with original
details and causes; existing missing-root handling and continuation limits remain.
