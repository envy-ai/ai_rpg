# barter-currency-formula

`utils/barter-currency-formula.js` shares merchant-currency formula validation and scaling between configuration loading and the barter API. It uses the native [FormulaEvaluator](../classes/FormulaEvaluator.md) and required `formulas.barter.currency_multiplier` string; the shipped default is `1 + (level / 3)`.

- `resolveBarterCurrencyFormula(config)` returns the trimmed required formula, without a runtime default.
- `evaluateBarterCurrencyMultiplier(config, level, { formulaEvaluator })` validates the NPC's authoritative finite level of at least 1, permits only the `level` variable, compiles through the shared evaluator, and requires a finite non-negative result. Native evaluator functions remain available. Syntax, unknown-variable/function and evaluation errors retain their cause and identify the configuration path.
- `validateBarterCurrencyFormula(config, options)` evaluates at level 1 for startup/reload validation and returns the normalized formula. Actual NPC levels are checked during a currency refresh, since a formula valid at level 1 can fail elsewhere.
- `scaleBarterCurrency(baseCurrency, multiplier)` requires an unscaled non-negative safe integer baseline and a finite non-negative multiplier. The product must be finite and its whole-unit value must remain a safe integer. It returns the product without extra rounding or clamping; `Player.setCurrency()` performs the established round-down.

Each fresh merchant baseline is scaled once during initial or daily barter-stock refresh. The pricing prompt estimates the baseline independently of NPC level and the current stored balance; it does not perform formula arithmetic. Ordinary repricing/haggling, actual trade transfers, existing saved funds and NPC generation funds retain their existing behavior. Formula configuration is re-read per refresh, so normal live reload/merged overrides apply without a separate cache.

Formula evaluation happens before the pricing prompt, and product validation happens before changing currency. Existing stock-refresh ordering and stock mutation behavior are unchanged.
