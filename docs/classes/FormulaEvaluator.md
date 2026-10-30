# FormulaEvaluator

`public/js/formula-evaluator.js` is the restricted arithmetic evaluator shared by server code and browser formula previews. It exports `compile(expression, customFunctions?)`, `collectVariables(expression)`, and `normalizeVariableKey(value)`.

Formulas accept decimal numbers, variables, function calls, parentheses, binary `+`, `-`, `*`, `/`, and `^`, and unary `+` and `-`. Unary plus preserves its operand: `+3`, `+level`, `+(level + 2)`, and `1 + +2` are valid. Unary minus retains its existing negation and precedence behavior. Expression syntax permits recursive unary operators; strict scalar numeric fields have their own single-sign grammar.

`compile` returns a function accepting a variable map. Variable values and the final result must be finite; invalid syntax, unknown variables/functions, and non-finite results throw. Built-ins are `abs`, `round`, `floor`, `ceil`, `min`, `max`, and `clamp`. `collectVariables` traverses the same parsed expression, including unary operands.
