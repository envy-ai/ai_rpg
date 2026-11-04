'use strict';
(() => {
    const evaluator = typeof module !== 'undefined' && module.exports ? require('./formula-evaluator.js') : window.FormulaEvaluator;
    const finite = (value, label) => {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
        return value;
    };
    function keyFor(binding) {
        if (binding.kind === 'level') return 'level';
        if (!['skill', 'attribute'].includes(binding.kind)) throw new Error(`Unsupported technique formula source ${binding.kind}.`);
        const name = evaluator.normalizeVariableKey(binding.name);
        return binding.kind === 'skill' ? `skill_${name}` : `attribute_${name}_modifier`;
    }
    function catalog(actor) {
        if (!actor) throw new Error('Technique formula variables require an actor.');
        const rows = [{ key: 'level', label: 'Level', kind: 'level', value: finite(actor.level, 'Actor level') }];
        const skills = actor.getSkills();
        const names = skills instanceof Map ? [...skills.keys()] : Object.keys(skills);
        for (const name of names) rows.push({ key: keyFor({ kind: 'skill', name }), label: `${name} rank`, kind: 'skill', name, value: finite(actor.getSkillValue(name), `Skill ${name}`) });
        for (const name of actor.getAttributeNames()) rows.push({ key: keyFor({ kind: 'attribute', name }), label: `${name} modifier`, kind: 'attribute', name, value: finite(actor.getAttributeModifier(name), `Attribute ${name} modifier`) });
        const seen = new Map();
        for (const row of rows) {
            if (seen.has(row.key)) throw new Error(`Technique formula variable ${row.key} is ambiguous: ${seen.get(row.key)} and ${row.label}. The conflicting actor facts require data repair; do not invent replacement names in the formula.`);
            seen.set(row.key, row.label);
        }
        return rows;
    }
    function isCanonical(key) {
        return key === 'level' || /^skill_[a-z0-9]+(?:_[a-z0-9]+)*$/.test(key) || /^attribute_[a-z0-9]+(?:_[a-z0-9]+)*_modifier$/.test(key);
    }
    function resolveBinding(binding, actor, label) {
        if (binding.kind === 'level') return finite(actor.level, `${label} level`);
        const skills = binding.kind === 'skill' ? actor.getSkills() : null;
        const names = binding.kind === 'skill' ? (skills instanceof Map ? [...skills.keys()] : Object.keys(skills)) : actor.getAttributeNames();
        const matches = names.filter(name => name.toLowerCase() === binding.name.toLowerCase());
        if (matches.length !== 1) throw new Error(`${label}: actor ${matches.length ? 'has ambiguous' : 'has no'} ${binding.kind} ${binding.name}. Select an unambiguous actual ${binding.kind} from: ${names.join(", ") || "none"}.`);
        return finite(binding.kind === 'skill' ? actor.getSkillValue(matches[0]) : actor.getAttributeModifier(matches[0]), label);
    }
    function resolve(formula, actor, bindings = {}, label = 'amount') {
        const variables = evaluator.collectVariables(formula);
        const automatic = variables.some(key => !Object.hasOwn(bindings, key)) ? new Map(catalog(actor).map(row => [row.key, row.value])) : new Map();
        const inputs = Object.create(null);
        for (const key of variables) {
            if (Object.hasOwn(bindings, key)) inputs[key] = resolveBinding(bindings[key], actor, `${label} variable ${key}`);
            else {
                if (!automatic.has(key)) throw new Error(`${label}: unknown formula variable ${key}. Use an available variable for this character: ${[...automatic.keys()].join(", ")}. Resource names and property access are not formula variables.`);
                inputs[key] = automatic.get(key);
            }
        }
        return { ...inputs };
    }
    // Replace identifiers in one pass so an old alias named "level" keeps its saved source.
    function canonicalize(formula, bindings = {}) {
        return formula.replace(/[A-Za-z_][A-Za-z0-9_.]*/g, (key, offset, source) => {
            if (/^\s*\(/.test(source.slice(offset + key.length))) return key;
            return Object.hasOwn(bindings, key) ? keyFor(bindings[key]) : key;
        });
    }
    const api = { catalog, keyFor, isCanonical, resolve, canonicalize };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.TechniqueFormulaVariables = api;
})();
