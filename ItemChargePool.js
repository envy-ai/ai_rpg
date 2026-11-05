'use strict';

const absent = value => value === undefined || value === null || (typeof value === 'string' && !value.trim());
function number(value, path) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${path} must be a finite nonnegative number; supply zero or a positive numeric value.`);
    return value;
}
function normalizeAmmoType(value, path = 'ammoType') {
    if (absent(value)) return undefined;
    if (typeof value !== 'string') throw new Error(`${path} must be a compatibility key string; use the same exact key for ammunition and its weapon.`);
    return value.trim().normalize('NFC').toLowerCase();
}
function normalizePool(value, { count = 1, path = 'chargePool', template = false } = {}) {
    if (value === undefined || value === null) return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object with mode, amount, capacity and unit.`);
    const allowed = new Set(['mode', 'amount', 'capacity', 'unit', 'initialAmount', 'ammoType', 'costPerUse']);
    for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${path}.${key} is unknown; use mode, amount, capacity, unit, initialAmount, ammoType or costPerUse.`);
    if (!['discrete', 'continuous'].includes(value.mode)) throw new Error(`${path}.mode must be discrete or continuous.`);
    if (count !== 1) throw new Error(`${path} requires count 1; charged items must remain individual records.`);
    if (typeof value.unit !== 'string' || !value.unit.trim()) throw new Error(`${path}.unit is required.`);
    const pool = { mode: value.mode, capacity: number(value.capacity, `${path}.capacity`), unit: value.unit.trim() };
    if (!template) pool.amount = number(value.amount, `${path}.amount`);
    else if (Object.prototype.hasOwnProperty.call(value, 'amount')) throw new Error(`${path}.amount is live instance state; omit it from templates and declare initialAmount for fresh copies.`);
    for (const key of ['initialAmount', 'costPerUse']) if (!absent(value[key])) pool[key] = number(value[key], `${path}.${key}`);
    const ammoType = normalizeAmmoType(value.ammoType, `${path}.ammoType`);
    if (ammoType !== undefined) {
        if (pool.mode !== 'discrete') throw new Error(`${path}.ammoType supports discrete ammunition only; omit it for continuous charge.`);
        pool.ammoType = ammoType;
    }
    for (const key of ['capacity', 'amount', 'initialAmount', 'costPerUse']) {
        if (pool[key] === undefined) continue;
        if (pool.mode === 'discrete' && !Number.isSafeInteger(pool[key])) throw new Error(`${path}.${key} must be a safe integer for discrete pools; use continuous mode for decimal charge.`);
        if (['amount', 'initialAmount'].includes(key) && pool[key] > pool.capacity) throw new Error(`${path}.${key} exceeds capacity ${pool.capacity}; supply a value from 0 through capacity.`);
    }
    return pool;
}
// Convert the numeric inputs' decimal spellings to a common integer scale. This
// avoids binary subtraction residue while retaining the ordinary number API.
function decimalParts(value) {
    if (!Number.isFinite(value)) throw new Error('Charge arithmetic requires finite numeric values.');
    const [mantissa, exponentText = '0'] = String(value).split('e');
    const fraction = (mantissa.split('.')[1] || '').length;
    const exponent = Number(exponentText) - fraction;
    return { coefficient: BigInt(mantissa.replace('.', '')), exponent };
}
function add(a, b) {
    const left = decimalParts(a), right = decimalParts(b);
    const exponent = Math.min(left.exponent, right.exponent);
    const coefficient = left.coefficient * 10n ** BigInt(left.exponent - exponent) + right.coefficient * 10n ** BigInt(right.exponent - exponent);
    const result = Number(`${coefficient}e${exponent}`);
    if (!Number.isFinite(result)) throw new Error('Charge arithmetic overflowed; use a smaller finite value.');
    return result;
}
function validatePayment(pool, amount, path = 'charge payment') {
    number(amount, `${path}.amount`);
    if (pool.mode === 'discrete' && !Number.isSafeInteger(amount)) throw new Error(`${path}.amount must be a safe integer for discrete pools; supply a whole number of ${pool.unit}.`);
    return amount;
}
function templateFrom(pool) {
    if (!pool) return undefined;
    const result = { ...pool }; delete result.amount;
    return normalizePool(result, { template: true });
}
function materialize(pool) {
    if (!pool) return undefined;
    const template = templateFrom(pool);
    if (template.initialAmount === undefined) throw new Error('chargePool.initialAmount is required to create a fresh item from a template; declare its starting charge explicitly.');
    return normalizePool({ ...template, amount: template.initialAmount });
}
function parseXml(parent) {
    const children = element => Array.from(element.childNodes || []).filter(child => child.nodeType === 1);
    const one = (element, tag) => {
        const matches = children(element).filter(child => (child.tagName || child.nodeName) === tag);
        if (matches.length > 1) throw new Error(`Thing XML ${tag} occurs more than once; supply one element.`);
        return matches[0];
    };
    const ammoNode = one(parent, 'ammoType');
    if (ammoNode && children(ammoNode).length) throw new Error('ammoType must contain a plain compatibility key; remove nested elements.');
    const ammoType = normalizeAmmoType(ammoNode?.textContent);
    const poolNode = one(parent, 'chargePool');
    if (!poolNode) return { ammoType };
    const value = {};
    const seen = new Set();
    for (const child of children(poolNode)) {
        const key = child.tagName || child.nodeName;
        if (seen.has(key)) throw new Error(`chargePool.${key} occurs more than once; supply one element.`);
        seen.add(key);
        if (children(child).length) throw new Error(`chargePool.${key} must be a scalar XML element; remove nested children.`);
        const text = child.textContent.trim();
        if (!text && ['initialAmount', 'costPerUse', 'ammoType'].includes(key)) continue;
        value[key] = ['amount', 'capacity', 'initialAmount', 'costPerUse'].includes(key) ? (text ? Number(text) : undefined) : text;
    }
    return { ammoType, chargePool: normalizePool(value) };
}
module.exports = { normalizePool, normalizeAmmoType, validatePayment, add, subtract: (a, b) => add(a, -b), templateFrom, materialize, parseXml };
