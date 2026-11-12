'use strict';

function resolveDamageEffectivenessMultiplier(rating) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        throw new Error('damageEffectiveness must be an integer from 1 through 5. Assess the actual attack against the current target.');
    }
    return [0, 0.5, 1, 2, 3][rating - 1];
}

function applyDamageEffectiveness(amount, rating) {
    if (!Number.isFinite(amount) || amount < 0) throw new Error('Damage before effectiveness must be a finite non-negative amount.');
    const multiplier = resolveDamageEffectivenessMultiplier(rating);
    const scaled = amount * multiplier;
    if (!Number.isFinite(scaled)) throw new Error('Damage after effectiveness must remain finite. Correct the damage amount or formula.');
    return { preEffectiveness: amount, effectivenessMultiplier: multiplier,
        finalDamage: multiplier === 0.5 ? Math.ceil(scaled) : scaled };
}

module.exports = { resolveDamageEffectivenessMultiplier, applyDamageEffectiveness };
