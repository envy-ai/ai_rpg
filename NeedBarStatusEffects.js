/** Detached, keyed need-level authoring. Runtime projections never allocate IDs. */
const clone = value => structuredClone(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
function object(value, path) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${path} must be a keyed object. Use stable names as keys rather than a list.`);
    return value;
}
function keys(value, allowed, path) {
    object(value, path);
    for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${path}.${key} is unsupported. Valid fields: ${allowed.join(', ')}.`);
}
function number(value, path) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${path} must be a finite number. Supply a signed numeric value.`);
    return value;
}
function text(value, path) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${path} is required.`);
    return value.trim();
}
function modifiers(source, singular, path) {
    if (source === undefined) return [];
    return Object.entries(object(source, path)).map(([identity, entry]) => {
        const entryPath = `${path}.${identity}`;
        keys(entry, ['modifier', 'percent_modifier'], entryPath);
        if (!own(entry, 'modifier') && !own(entry, 'percent_modifier')) throw new Error(`${entryPath} requires modifier or percent_modifier; supply a fixed number, a percentage, or both.`);
        return { [singular]: text(identity, entryPath), ...(own(entry, 'modifier') ? { modifier: number(entry.modifier, `${entryPath}.modifier`) } : {}), ...(own(entry, 'percent_modifier') ? { percentModifier: number(entry.percent_modifier, `${entryPath}.percent_modifier`) } : {}) };
    });
}
function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        for (const child of Object.values(value)) deepFreeze(child);
        Object.freeze(value);
    }
    return value;
}
function compile(source, { path }) {
    if (source === undefined) return [];
    const StatusEffect = require('./StatusEffect.js');
    return Object.entries(object(source, path)).flatMap(([key, config]) => {
        const entryPath = `${path}.${key}`;
        text(key, entryPath);
        keys(config, ['enabled', 'name', 'description', 'attributes', 'skills', 'need_bars', 'need_bar_maximums', 'max_health_percent'], entryPath);
        if (config.enabled !== undefined && typeof config.enabled !== 'boolean') throw new TypeError(`${entryPath}.enabled must be true or false.`);
        if (config.enabled === false) return [];
        const needBars = config.need_bars === undefined ? [] : Object.entries(object(config.need_bars, `${entryPath}.need_bars`)).map(([name, value]) => {
            const ratePath = `${entryPath}.need_bars.${name}`;
            keys(value, ['delta', 'percent_delta'], ratePath);
            if (!own(value, 'delta') && !own(value, 'percent_delta')) throw new Error(`${ratePath} requires delta or percent_delta; supply fixed units per minute, a signed percentage rate, or both.`);
            return { name: text(name, ratePath), delta: own(value, 'delta') ? number(value.delta, `${ratePath}.delta`) : 0, ...(own(value, 'percent_delta') ? { percentDelta: number(value.percent_delta, `${ratePath}.percent_delta`) } : {}) };
        });
        const needBarMaximums = config.need_bar_maximums === undefined ? [] : Object.entries(object(config.need_bar_maximums, `${entryPath}.need_bar_maximums`)).map(([name, value]) => {
            const maximumPath = `${entryPath}.need_bar_maximums.${name}`;
            keys(value, ['percent_modifier'], maximumPath);
            return { name: text(name, maximumPath), percentModifier: number(value.percent_modifier, `${maximumPath}.percent_modifier`) };
        });
        const effect = new StatusEffect({ register: false, name: text(config.name, `${entryPath}.name`), description: text(config.description, `${entryPath}.description`), attributes: modifiers(config.attributes, 'attribute', `${entryPath}.attributes`), skills: modifiers(config.skills, 'skill', `${entryPath}.skills`), needBars, needBarMaximums, maxHealthPercent: config.max_health_percent === undefined ? 0 : number(config.max_health_percent, `${entryPath}.max_health_percent`), duration: -1 });
        return [deepFreeze({ key, ...effect.toJSON() })];
    });
}
function validateReferences(definitions, { attributes, skills } = {}) {
    const needChoices = Object.values(definitions).flatMap(bar => [bar.id, bar.name]);
    const needNames = new Set(needChoices.map(name => name.toLowerCase()));
    const attributeChoices = attributes ? Object.entries(attributes).flatMap(([id, definition]) => [id, definition?.label || id]) : null;
    const attributeNames = attributeChoices && new Set(attributeChoices.map(name => name.toLowerCase()));
    const skillChoices = skills ? (skills instanceof Map ? [...skills.entries()].flatMap(([id, skill]) => [id, skill?.name || id]) : Array.isArray(skills) ? skills.map(skill => skill?.name || skill) : Object.entries(skills).flatMap(([id, skill]) => [id, skill?.name || id])) : null;
    const skillNames = skillChoices && new Set(skillChoices.map(name => String(name).toLowerCase()));
    for (const bar of Object.values(definitions)) for (const threshold of bar.effectThresholds) for (const effect of threshold.statusEffects || []) {
        const path = `need_bars.${bar.id}.effect_thresholds.${threshold.threshold}.status_effects.${effect.key}`;
        for (const [field, authoredField] of [['needBars', 'need_bars'], ['needBarMaximums', 'need_bar_maximums']]) for (const entry of effect[field]) {
            const healthAllowed = field === 'needBars';
            if (!(healthAllowed && entry.name.toLowerCase() === 'health') && !needNames.has(entry.name.toLowerCase())) throw new Error(`${path}.${authoredField}.${entry.name} names an unknown need. Use a defined need: ${[...new Set(needChoices), ...(healthAllowed ? ['Health'] : [])].join(', ')}.`);
        }
        for (const [field, identity, available, choices] of [['attributes', 'attribute', attributeNames, attributeChoices], ['skills', 'skill', skillNames, skillChoices]]) {
            if (available) for (const entry of effect[field]) if (!available.has(entry[identity].toLowerCase())) throw new Error(`${path}.${field}.${entry[identity]} is unknown. Use a canonical ${identity}: ${[...new Set(choices)].join(', ')}.`);
        }
    }
}
function project(actorId, bar, threshold, activeNeedNames) {
    return (threshold?.statusEffects || []).map(template => {
        const { key, ...effect } = clone(template);
        const inactiveNeedBarTargets = [...new Set([...effect.needBars, ...effect.needBarMaximums].map(entry => entry.name).filter(name => name.toLowerCase() !== 'health' && !activeNeedNames.has(name.toLowerCase())))];
        return deepFreeze({ ...effect, id: `need_status:${actorId}:${bar.id}:${threshold.threshold}:${key}`, source: 'need-bar', needBarSource: { barId: bar.id, barName: bar.name, threshold: threshold.threshold, key, levelName: threshold.name }, inactiveNeedBarTargets });
    });
}
module.exports = { compile, validateReferences, project, deepFreeze, clone };
