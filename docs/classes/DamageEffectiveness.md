# DamageEffectiveness

`resolveDamageEffectivenessMultiplier(rating)` accepts an integer 1–5 and returns ordinary attack multipliers 0, 0.5, 1, 2 or 3. `applyDamageEffectiveness(amount, rating)` requires finite nonnegative damage, applies that multiplier once, and rounds half effectiveness up as ordinary attacks do. Nonfinite scaled damage rejects. The result records `preEffectiveness`, `effectivenessMultiplier` and `finalDamage`.

Ordinary API attacks share the multiplier mapping; [TechniqueService](TechniqueService.md#current-target-damage-effectiveness) uses both helpers after [current-target assessment](TechniqueDamageEffectiveness.md). Presentation-only nearest-integer rounding is separate in [TechniqueReport](TechniqueReport.md).
