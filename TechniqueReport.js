'use strict';

/** Presentation copy only. Canonical receipts and applied health remain exact. */
function projectTechniqueReceiptReport(receipt) {
    const reported = JSON.parse(JSON.stringify(receipt));
    if (Object.hasOwn(reported, 'reportedTotals')) return reported;
    const healthEffects = (receipt.effects || []).filter(effect => effect.success && ['damage', 'healing'].includes(effect.kind));
    reported.reportedTotals = {
        damage: Math.round(healthEffects.filter(effect => effect.kind === 'damage').reduce((sum, effect) => sum + effect.amount, 0)),
        healing: Math.round(healthEffects.filter(effect => effect.kind === 'healing').reduce((sum, effect) => sum + effect.amount, 0)),
        healthDelta: Math.round(healthEffects.reduce((sum, effect) => sum + effect.delta, 0))
    };
    for (const effect of reported.effects || []) if (effect.success && ['damage', 'healing'].includes(effect.kind)) {
        effect.amount = Math.round(effect.amount);
        effect.delta = Math.round(effect.delta);
        if (effect.calculation) effect.calculation.amount = Math.round(effect.calculation.amount);
        if (effect.damageCalculation) effect.damageCalculation.finalDamage = Math.round(effect.damageCalculation.finalDamage);
        if (effect.weapon) effect.weapon.finalDamage = Math.round(effect.weapon.finalDamage);
    }
    return reported;
}

module.exports = { projectTechniqueReceiptReport };
