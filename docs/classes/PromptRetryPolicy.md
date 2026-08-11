# PromptRetryPolicy

`PromptRetryPolicy.js` converts the configured count of retries after an initial response into a total prompt-attempt limit.

`resolveConfiguredPromptMaxAttempts(aiConfig, { fallbackMaxAttempts })` returns `aiConfig.retryAttempts + 1`. An absent configured value uses the supplied positive fallback total, which defaults to three attempts. Invalid configured or fallback counts throw; values are not clamped.

Location item/scenery generation uses this helper for strict XML validation. It therefore retries malformed generated XML through the same `ai.retryAttempts` budget as staged prompt parsers instead of using an unrelated hard three-attempt ceiling. Every attempt still has to pass the strict thing parser; exhausting the configured budget throws the last validation error.

`runPromptWithParseRetries(...)` keeps completion and structured parsing inside one bounded attempt loop. Only parser rejection advances this loop: transport/completion failures remain the completion client's responsibility. Before another attempt, the rejected assistant response and a caller-supplied correction instruction are appended to a private working transcript. An optional attempt callback can log both accepted and rejected outputs. No caller-owned state is changed by the helper.

Barter pricing uses both helpers. Every returned `<barterPrices>` response is logged and must pass strict XML, semantic item-reference validation, and the pass-specific effective generated-stock count bounds before merchant currency, generated stock, offers, sessions, or merchant replies can change. Haggle pricing requires exactly zero new seeds. An invalid haggle response therefore retries only pricing; it does not duplicate the player offer, create a merchant reply from rejected XML, or add stock.

Craft success-degree prompts also use `runPromptWithParseRetries(...)`. The selected result level must exist and its `<itemsConsumed>` multiset must resolve against the separately selected input Things before consumption, output instantiation, time advancement, narrative generation, or history mutation. Repeating a name because one selected Thing has stack count greater than one is invalid: the action's existing mechanics consume at most one unit from each selected Thing. Every rejected and accepted degree response is prompt-logged with its attempt number and validation result.
