(() => {
    'use strict';
    const instances = new WeakMap();
    const activePanels = new Set();
    const clone = value => JSON.parse(JSON.stringify(value));
    const node = (tag, className, text) => {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    };
    const button = (text, action, primary = false) => {
        const control = node('button', `btn ${primary ? 'btn-primary' : 'btn-secondary'}`, text);
        control.type = 'button';
        control.addEventListener('click', action);
        return control;
    };
    const report = (error, returnFocus) => {
        console.error('Technique operation failed:', error);
        window.AIRPG_PAGE_FEEDBACK.showError(error, { returnFocus });
    };
    async function request(url, body, method = 'POST', signal) {
        const response = await fetch(url, { method: body === undefined ? 'GET' : method, signal,
            headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        const result = await response.json();
        if (!response.ok || result.success === false) {
            const error = new Error(result.error || `Technique request failed: HTTP ${response.status}.`);
            if (result.stack) error.stack = result.stack;
            throw error;
        }
        return result;
    }
    let catalogueRequest = 0;
    let acceptedCatalogueRequest = 0;
    window.TechniqueCatalogue = Object.freeze({
        async load(actorId, { signal } = {}) {
            const serial = ++catalogueRequest;
            const query = new URLSearchParams({ catalog: 'true' });
            if (actorId !== undefined) {
                if (typeof actorId !== 'string' || !actorId.trim()) throw new Error('Technique catalogue refresh requires a character ID.');
                query.set('actor', actorId);
            }
            const response = await fetch(`/api/techniques?${query}`, { cache: 'no-store', signal });
            const result = await response.json();
            if (!response.ok || result?.success === false || result?.error || (actorId !== undefined && result?.actorId !== actorId)) {
                const error = new Error(result?.error || `Technique catalogue request failed: HTTP ${response.status}.`);
                if (result?.stack) error.stack = result.stack;
                throw error;
            }
            if (!Array.isArray(result.catalog)) throw new Error('Technique catalogue response must contain definitions.');
            const ids = new Set();
            for (const definition of result.catalog) {
                if (typeof definition?.id !== 'string' || !definition.id.trim()
                    || typeof definition.name !== 'string' || !definition.name.trim()
                    || ids.has(definition.id)) throw new Error('Technique catalogue contains an invalid or duplicate identity.');
                ids.add(definition.id);
            }
            // A delayed panel request must not replace a more recent accepted snapshot.
            if (serial > acceptedCatalogueRequest) {
                acceptedCatalogueRequest = serial;
                window.dispatchEvent(new CustomEvent('techniques:catalogue', { detail: { catalog: result.catalog } }));
            }
            return result;
        }
    });
    function field(parent, labelText, initial = '', type = 'text') {
        const group = node('label', 'form-group');
        group.append(node('span', '', labelText));
        const input = node(type === 'textarea' ? 'textarea' : 'input');
        if (type !== 'textarea') input.type = type;
        if (type === 'number') input.step = 'any';
        input.value = initial ?? '';
        group.append(input);
        parent.append(group);
        return input;
    }
    function choice(parent, labelText, options, initial, onChange) {
        const group = node('div', 'form-group');
        group.append(node('span', '', labelText));
        const root = node('div');
        root.dataset.label = labelText;
        group.append(root);
        parent.append(group);
        return new window.AIRPG_WIDGETS.SearchableSelect(root, {
            options, value: initial, emptyLabel: 'Choose…', onChange
        });
    }
    function required(input) {
        input.required = true;
        return input;
    }
    function section(parent, title) {
        const box = node('fieldset', 'techniques-editor-section');
        box.append(node('legend', '', title));
        parent.append(box);
        return box;
    }
    function finite(input, label) {
        if (input.value.trim() === '' || !Number.isFinite(Number(input.value))) throw new Error(`${label} must be a finite number.`);
        return Number(input.value);
    }
    function selected(control, label) {
        const value = control.getValue();
        if (!value) throw new Error(`Choose ${label}.`);
        return value;
    }
    function rowsEditor(parent, title, values, create) {
        const box = section(parent, title);
        const list = node('div', 'techniques-rows');
        box.append(list);
        const readers = new Map();
        function add(value) {
            const row = node('div', 'techniques-editor-row');
            const content = node('div', 'techniques-editor-row-content');
            const read = create(content, value);
            row.append(content, button('Remove', () => { readers.delete(row); row.remove(); }));
            readers.set(row, read);
            list.append(row);
        }
        for (const value of values || []) add(value);
        box.append(button(`Add ${title.toLowerCase().replace(/s$/, '')}`, () => add(undefined)));
        return () => [...readers.values()].map(read => read());
    }
    function showFormulaVariables(expression, variables, trigger) {
        const start = expression.selectionStart ?? expression.value.length;
        const end = expression.selectionEnd ?? start;
        const content = node('div');
        content.append(node('p', '', 'Use these variables directly in a formula. Values are recalculated for the acting character at use time.'));
        const scroll = node('div', 'data-table-scroll');
        scroll.tabIndex = 0;
        scroll.setAttribute('role', 'region');
        scroll.setAttribute('aria-label', 'Available formula variables');
        const table = node('table', 'data-table');
        const caption = node('caption', '', 'Current character values');
        const head = node('thead');
        const headings = node('tr');
        for (const label of ['Variable', 'Source', 'Current value', 'Action']) {
            const th = node('th', '', label); th.scope = 'col'; headings.append(th);
        }
        head.append(headings);
        const body = node('tbody');
        let dialog;
        let inserted = false;
        for (const variable of variables) {
            const row = node('tr');
            const name = node('th'); name.scope = 'row'; name.append(node('code', '', variable.key));
            const action = node('td');
            const insert = button('Insert', () => {
                expression.setRangeText(variable.key, start, end, 'end');
                expression.dispatchEvent(new Event('input', { bubbles: true }));
                inserted = true;
                dialog.close();
            });
            insert.setAttribute('aria-label', `Insert ${variable.key}`);
            action.append(insert);
            row.append(name, node('td', '', variable.label), node('td', '', String(variable.value)), action);
            body.append(row);
        }
        table.append(caption, head, body); scroll.append(table); content.append(scroll);
        content.append(node('p', '', 'Insert uses the formula cursor position. Escape closes this dialog.'));
        dialog = window.AIRPG_PAGE_FEEDBACK.dialog('Available formula variables', '', { content, returnFocus: trigger });
        dialog.addEventListener('close', () => { if (inserted && expression.isConnected) expression.focus(); }, { once: true });
    }
    function amountEditor(parent, label, value = 0, variables = []) {
        const box = section(parent, label);
        let formulaMode = typeof value === 'object';
        const body = node('div', 'techniques-editor-grid');
        let read;
        const mode = choice(box, `${label} mode`, ['Fixed', 'Formula'], formulaMode ? 'Formula' : 'Fixed', () => render());
        box.append(body);
        function render() {
            body.replaceChildren();
            formulaMode = mode.getValue() === 'Formula';
            if (!formulaMode) {
                const input = field(body, label, typeof value === 'number' ? value : '', 'number');
                read = () => finite(input, label);
            } else {
                const expression = required(field(body, 'Formula', window.TechniqueFormulaVariables.canonicalize(value?.formula || '', value?.bindings), 'text'));
                const available = button('Available variables', event => showFormulaVariables(expression, variables, event.currentTarget));
                available.title = 'Show current character variables (Alt+V in this formula)';
                body.append(available, node('p', '', 'Variables are bound automatically. Use +, −, *, /, ^ and abs, round, floor, ceil, min, max.'));
                expression.addEventListener('keydown', event => {
                    if (event.altKey && event.key.toLowerCase() === 'v') { event.preventDefault(); available.click(); }
                });
                read = () => {
                    const formula = expression.value.trim();
                    const known = new Set(variables.map(variable => variable.key));
                    for (const key of window.FormulaEvaluator.collectVariables(formula)) if (!known.has(key)) throw new Error(`${label}: unknown formula variable ${key}. Choose Available variables.`);
                    return { formula };
                };
            }
        }
        render();
        return () => read();
    }
    const requirementKinds = ['level', 'skill', 'attribute', 'discipline', 'technique', 'equippedItem', 'equipmentType', 'evidence', 'ability', 'status', 'class', 'race', 'alive'];
    function requirementsEditor(parent, title, values) {
        return rowsEditor(parent, title, values, (root, value = {}) => {
            const kind = choice(root, 'Requirement', requirementKinds, value.kind || 'alive');
            const name = field(root, 'Name / stable ID (except level or alive)', value.name || value.id || '');
            const minimum = field(root, 'Minimum (level, skill or attribute)', value.minimum ?? '', 'number');
            const present = choice(root, 'Presence', ['Required', 'Must be absent'], value.present === false ? 'Must be absent' : 'Required');
            return () => {
                const type = selected(kind, 'requirement kind');
                return { kind: type,
                    ...(['skill', 'attribute', 'equipmentType', 'ability', 'status', 'class', 'race'].includes(type) ? { name: name.value.trim() } : {}),
                    ...(['discipline', 'technique', 'equippedItem', 'evidence'].includes(type) ? { id: name.value.trim() } : {}),
                    ...(['level', 'skill', 'attribute'].includes(type) ? { minimum: finite(minimum, 'Requirement minimum') } : {}),
                    ...(present.getValue() === 'Must be absent' ? { present: false } : {}) };
            };
        });
    }
    function checkEditor(parent, value, optional = false) {
        const box = section(parent, optional ? 'Effect check' : 'Check');
        const mode = choice(box, 'Check kind', [...(optional ? ['Inherit technique check'] : []), 'automatic', 'attack', 'skill', 'opposed'], value?.kind || (optional ? 'Inherit technique check' : 'automatic'));
        const fields = node('div', 'techniques-editor-grid');
        box.append(fields);
        const inputs = {};
        for (const [key, label] of Object.entries({ skill: 'Skill', attribute: 'Attribute', opposedSkill: 'Opposed skill', opposedAttribute: 'Opposed attribute', attackType: 'Attack type', damageType: 'Damage type', toughnessAttribute: 'Target toughness attribute (weapon attacks)', defense: 'Defense', description: 'Description' })) {
            inputs[key] = field(fields, label, value?.[key] ?? '');
        }
        const damageEffectiveness = field(fields, 'Damage effectiveness (1–5; weapon attacks)', value?.damageEffectiveness ?? '', 'number');
        const difficulty = choice(fields, 'Difficulty', ['Trivial', 'Easy', 'Medium', 'Hard', 'Very Hard', 'Legendary'], value?.difficulty || 'Medium');
        function sync() {
            const kind = mode.getValue();
            fields.hidden = kind === 'automatic' || kind === 'Inherit technique check';
            difficulty.root.closest('.form-group').hidden = kind !== 'skill';
        }
        box.addEventListener('searchable-select-change', sync);
        sync();
        return () => {
            const kind = selected(mode, 'check kind');
            if (kind === 'Inherit technique check') return undefined;
            if (kind === 'automatic') return { kind };
            const result = { kind };
            for (const [key, input] of Object.entries(inputs)) if (input.value.trim()) result[key] = input.value.trim();
            if (damageEffectiveness.value.trim()) result.damageEffectiveness = finite(damageEffectiveness, 'Damage effectiveness');
            if (kind === 'skill') result.difficulty = selected(difficulty, 'difficulty');
            return result;
        };
    }
    function costsEditor(parent, title, values, variables) {
        return rowsEditor(parent, title, values, (root, value = { resource: 'health', amount: 0 }) => {
            const resource = choice(root, 'Resource', ['health', 'need', 'charge'], value.resource);
            const needId = field(root, 'Need bar ID (need costs only)', value.needId || '');
            const direction = choice(root, 'Need payment direction', ['Configured direction', 'increase', 'decrease'], value.direction || 'Configured direction');
            const binding = choice(root, 'Charge item binding', ['grantingItem', 'ownedItem'], value.binding || 'grantingItem');
            const itemId = field(root, 'Owned item ID (ownedItem only)', value.itemId || '');
            const perTarget = node('label', 'techniques-checkbox');
            const perTargetInput = node('input'); perTargetInput.type = 'checkbox'; perTargetInput.checked = value.perTarget === true;
            perTarget.append(perTargetInput, document.createTextNode('Pay this amount for each selected target'));
            root.append(perTarget);
            const readAmount = amountEditor(root, 'Amount', value.amount, variables);
            function sync() {
                const kind = resource.getValue();
                needId.closest('.form-group').hidden = kind !== 'need';
                direction.root.closest('.form-group').hidden = kind !== 'need';
                binding.root.closest('.form-group').hidden = kind !== 'charge';
                itemId.closest('.form-group').hidden = kind !== 'charge' || binding.getValue() !== 'ownedItem';
            }
            root.addEventListener('searchable-select-change', sync);
            sync();
            return () => {
                const chargeBinding = resource.getValue() === 'charge' ? selected(binding, 'charge binding') : null;
                if (chargeBinding === 'ownedItem' && !itemId.value.trim()) throw new Error('Owned item ID is required for an ownedItem charge cost. Enter the charged item ID or choose grantingItem.');
                return { resource: selected(resource, 'resource'), amount: readAmount(), ...(perTargetInput.checked ? { perTarget: true } : {}),
                    ...(resource.getValue() === 'need' ? { needId: needId.value.trim(), ...(direction.getValue() === 'Configured direction' ? {} : { direction: selected(direction, 'payment direction') }) } : {}),
                    ...(chargeBinding ? { binding: chargeBinding, ...(chargeBinding === 'ownedItem' ? { itemId: itemId.value.trim() } : {}) } : {}) };
            };
        });
    }
    function optionalAmountEditor(parent, label, value, variables) {
        const toggle = node('label', 'techniques-checkbox');
        const enabled = node('input');
        enabled.type = 'checkbox';
        enabled.checked = value !== undefined;
        toggle.append(enabled, document.createTextNode(`Include ${label.toLowerCase()}`));
        const body = node('div');
        parent.append(toggle, body);
        const read = amountEditor(body, label, value ?? 0, variables);
        const sync = () => { body.hidden = !enabled.checked; };
        enabled.addEventListener('change', sync);
        sync();
        return () => enabled.checked ? read() : undefined;
    }
    function templateEditor(parent, value = {}, context = {}) {
        const root = section(parent, 'Creature template');
        const name = required(field(root, 'Creature name', value.name || ''));
        const description = required(field(root, 'Description', value.description || '', 'textarea'));
        const shortDescription = field(root, 'Short description', value.shortDescription || '');
        const actorClass = field(root, 'Class', value.class || '');
        const race = field(root, 'Race', value.race || '');
        const gender = field(root, 'Gender', value.gender || '');
        const level = field(root, 'Level', value.level ?? 1, 'number');
        const health = field(root, 'Health (optional)', value.health ?? '', 'number');
        const attributes = rowsEditor(root, 'Attributes', Object.entries(value.attributes || {}).map(([name, amount]) => ({ name, amount })), (holder, row = {}) => {
            const names = (context.attributes || []).map(entry => entry.name);
            const stat = choice(holder, 'Attribute', names, row.name || names[0] || '');
            const amount = field(holder, 'Value', row.amount ?? 0, 'number');
            return () => [selected(stat, 'template attribute'), finite(amount, 'Template attribute value')];
        });
        const skills = rowsEditor(root, 'Skills', Object.entries(value.skills || {}).map(([name, amount]) => ({ name, amount })), (holder, row = {}) => {
            const names = (context.skills || []).map(entry => entry.name);
            const stat = choice(holder, 'Skill', names, row.name || names[0] || '');
            const amount = field(holder, 'Rank', row.amount ?? 0, 'number');
            return () => [selected(stat, 'template skill'), finite(amount, 'Template skill rank')];
        });
        return () => {
            const entries = (read, label) => {
                const rows = read();
                if (new Set(rows.map(([key]) => key)).size !== rows.length) throw new Error(`${label} has duplicate names. Choose each name once.`);
                return Object.fromEntries(rows);
            };
            return { name: name.value.trim(), description: description.value.trim(),
                ...(shortDescription.value.trim() ? { shortDescription: shortDescription.value.trim() } : {}),
                ...(actorClass.value.trim() ? { class: actorClass.value.trim() } : {}),
                ...(race.value.trim() ? { race: race.value.trim() } : {}),
                ...(gender.value.trim() ? { gender: gender.value.trim() } : {}), level: finite(level, 'Template level'),
                ...(health.value.trim() ? { health: finite(health, 'Template health') } : {}),
                attributes: entries(attributes, 'Template attributes'), skills: entries(skills, 'Template skills') };
        };
    }
    function effectsEditor(parent, values, variables, context = {}) {
        return rowsEditor(parent, 'Effects', values, (root, value = { id: `effect-${Date.now()}`, kind: 'healing', amount: 0 }) => {
            const id = required(field(root, 'Stable effect ID', value.id));
            const type = choice(root, 'Effect', ['healing', 'damage', 'buff', 'debuff', 'teleport', 'summon', 'resurrection'], value.kind);
            const body = node('div');
            root.append(body);
            const readCheck = checkEditor(root, value.check, true);
            let readBody;
            function render() {
                body.replaceChildren();
                const kind = type.getValue();
                if (kind === 'healing' || kind === 'damage') {
                    if (kind === 'damage') {
                        const mode = choice(body, 'Damage mode', ['technique', 'weapon'], value.damageMode || 'technique', () => renderDamage());
                        const damageBody = node('div'); body.append(damageBody);
                        const renderDamage = () => {
                            damageBody.replaceChildren();
                            if (mode.getValue() === 'weapon') {
                                const multiplier = amountEditor(damageBody, 'Multiplier', value.multiplier ?? 1, variables);
                                const bonus = amountEditor(damageBody, 'Bonus', value.bonus ?? 0, variables);
                                readBody = () => ({ damageMode: 'weapon', multiplier: multiplier(), bonus: bonus() });
                            } else {
                                const amount = amountEditor(damageBody, 'Amount', value.amount ?? 0, variables);
                                readBody = () => ({ damageMode: 'technique', amount: amount() });
                            }
                        };
                        renderDamage();
                    } else { const amount = amountEditor(body, 'Amount', value.amount ?? 0, variables); readBody = () => ({ amount: amount() }); }
                } else if (kind === 'teleport') {
                    const destinations = context.utilityContext?.destinations || [];
                    const labels = new Map(destinations.map(entry => [`${entry.name} · ${entry.id}`, entry.id]));
                    const destination = choice(body, 'Destination (optional; choose at use time if empty)', [...labels.keys()], [...labels].find(([, id]) => id === value.destinationId)?.[0] || '');
                    readBody = () => destination.getValue() ? { destinationId: labels.get(destination.getValue()) } : {};
                } else if (kind === 'summon') {
                    const mode = choice(body, 'Summon source', ['existing', 'template'], value.summonMode || 'template');
                    const lifetime = field(body, 'Lifetime in world minutes', value.lifetimeMinutes ?? 3, 'number');
                    const actors = new Map((context.utilityContext?.summonActors || []).map(entry => [`${entry.name} · ${entry.id}`, entry.id]));
                    const templates = new Map((context.utilityContext?.summonTemplates || []).map(entry => [`${entry.name} · ${entry.id}`, entry.id]));
                    const actor = choice(body, 'Existing actor (optional; choose at use time if empty)', [...actors.keys()], [...actors].find(([, id]) => id === value.actorId)?.[0] || '');
                    const source = choice(body, 'Template source', ['Saved template', 'Author inline template', 'Choose at use time'], value.template ? 'Author inline template' : value.templateId ? 'Saved template' : 'Choose at use time');
                    const template = choice(body, 'Saved template', [...templates.keys()], [...templates].find(([, id]) => id === value.templateId)?.[0] || '');
                    const inline = node('div'); body.append(inline);
                    const readInline = templateEditor(inline, value.template || {}, context.balanceAuthoring || {});
                    const sync = () => {
                        actor.root.closest('.form-group').hidden = mode.getValue() !== 'existing';
                        source.root.closest('.form-group').hidden = mode.getValue() !== 'template';
                        template.root.closest('.form-group').hidden = mode.getValue() !== 'template' || source.getValue() !== 'Saved template';
                        inline.hidden = mode.getValue() !== 'template' || source.getValue() !== 'Author inline template';
                        for (const control of inline.querySelectorAll('input,textarea,select,button')) control.disabled = inline.hidden;
                    };
                    body.addEventListener('searchable-select-change', sync); sync();
                    readBody = () => ({ summonMode: selected(mode, 'summon source'), lifetimeMinutes: finite(lifetime, 'Summon lifetime'),
                        ...(mode.getValue() === 'existing' ? (actor.getValue() ? { actorId: actors.get(actor.getValue()) } : {})
                            : source.getValue() === 'Author inline template' ? { template: readInline() }
                            : source.getValue() === 'Saved template' ? { templateId: templates.get(selected(template, 'saved template')) } : {}) });
                } else if (kind === 'resurrection') {
                    const health = amountEditor(body, 'Restored health', value.health ?? 1, variables);
                    readBody = () => ({ health: health() });
                } else {
                    const status = value.status || {};
                    const name = required(field(body, 'Status name', status.name || ''));
                    const description = required(field(body, 'Status description', status.description || '', 'textarea'));
                    const duration = field(body, 'Duration in world minutes (-1 permanent)', status.duration ?? 10, 'number');
                    const stacking = choice(body, 'Repeated use', ['refresh', 'stack'], value.stacking || 'refresh');
                    const refresh = choice(body, 'Refresh policy', ['stronger', 'replace', 'reject'], value.refreshPolicy || 'stronger');
                    const potency = field(body, 'Comparison potency (optional)', value.potency ?? '', 'number');
                    const readHealthPercent = optionalAmountEditor(body, 'Maximum health percent', status.maxHealthPercent, variables);
                    const readers = {};
                    for (const [key, identity, magnitude, label] of [['attributes', 'attribute', 'modifier', 'Attribute modifiers'], ['skills', 'skill', 'modifier', 'Skill modifiers'], ['needBars', 'name', 'delta', 'Need rate modifiers']]) {
                        readers[key] = rowsEditor(body, label, status[key], (holder, entry = {}) => {
                            const name = required(field(holder, identity === 'name' ? 'Need name' : identity, entry[identity] || ''));
                            const amount = amountEditor(holder, magnitude, entry[magnitude] ?? 0, variables);
                            const percent = key === 'needBars' ? null : optionalAmountEditor(holder, 'Percent modifier', entry.percentModifier, variables);
                            return () => {
                                const percentModifier = percent?.();
                                return { [identity]: name.value.trim(), [magnitude]: amount(), ...(percentModifier === undefined ? {} : { percentModifier }) };
                            };
                        });
                    }
                    readBody = () => {
                        const maxHealthPercent = readHealthPercent();
                        return { status: { name: name.value.trim(), description: description.value.trim(), duration: finite(duration, 'Duration'), ...Object.fromEntries(Object.entries(readers).map(([key, read]) => [key, read()])), ...(maxHealthPercent === undefined ? {} : { maxHealthPercent }), ...(status.techniqueGrants === undefined ? {} : { techniqueGrants: structuredClone(status.techniqueGrants) }) }, stacking: selected(stacking, 'stacking policy'), refreshPolicy: selected(refresh, 'refresh policy'), ...(potency.value.trim() ? { potency: finite(potency, 'Potency') } : {}) };
                    };
                }
            }
            root.addEventListener('searchable-select-change', event => { if (event.target === type.root) render(); });
            render();
            return () => {
                const check = readCheck();
                return { id: id.value.trim(), kind: selected(type, 'effect kind'), ...readBody(), ...(check ? { check } : {}) };
            };
        });
    }
    const formatAmount = value => typeof value === 'number' ? String(value) : window.TechniqueFormulaVariables.canonicalize(value?.formula || '?', value?.bindings);
    const formatCosts = costs => (costs || []).map(cost => {
        if (cost.resource === 'charge') return `${formatAmount(cost.amount)} ${cost.unit || (cost.mode === 'discrete' ? 'rounds' : 'charge')} from ${cost.itemId || (cost.binding === 'grantingItem' ? 'granting item' : 'owned item')}${cost.perTarget ? ' per target' : ''}`;
        return `${formatAmount(cost.amount)} ${cost.resource === 'health' ? 'health' : cost.needId}${cost.direction ? ` (${cost.direction})` : ''}${cost.perTarget ? ' per target' : ''}`;
    }).join(' + ') || 'None';
    const sourceLabel = source => source.sourceKind === 'learned' ? 'Learned'
        : source.sourceKind === 'status' ? `${source.abilityName ? `Ability ${source.abilityName} · ` : ''}Status ${source.statusName || source.sourceStatusName || source.statusId || source.sourceStatusId || source.sourceId}`
        : `Equipment ${source.itemName || source.itemId || source.sourceId}`;
    const describeStatusModifiers = status => [
        ...['attributes', 'skills', 'needBars'].flatMap(key => (status?.[key] || []).map(modifier => {
            const values = [];
            if (modifier.modifier !== undefined || modifier.delta !== undefined) values.push(formatAmount(modifier.modifier ?? modifier.delta));
            if (modifier.percentModifier !== undefined) values.push(`${formatAmount(modifier.percentModifier)}%`);
            return `${modifier.attribute || modifier.skill || modifier.name} ${values.join(' and ')}`;
        })),
        ...(status?.maxHealthPercent === undefined ? [] : [`Maximum health ${formatAmount(status.maxHealthPercent)}%`]),
        ...(status?.techniqueGrants?.length ? [`Grants ${status.techniqueGrants.length} technique${status.techniqueGrants.length === 1 ? '' : 's'}`] : [])
    ].join(', ');
    const formatRequirement = value => `${value.present === false ? 'No ' : ''}${value.kind}${value.name || value.id ? `: ${value.name || value.id}` : ''}${value.minimum !== undefined ? ` ≥ ${value.minimum}` : ''}`;
    const effectSummary = effect => {
        if (effect.kind === 'damage' && effect.damageMode === 'weapon') return `weapon damage × ${formatAmount(effect.multiplier)} + ${formatAmount(effect.bonus)} before defenses`;
        if (['healing', 'damage'].includes(effect.kind)) return `${effect.kind}: ${formatAmount(effect.amount)}`;
        if (effect.kind === 'teleport') return `teleport to ${effect.destinationId || 'destination selected at use'}`;
        if (effect.kind === 'summon') return `summon ${effect.actorId || effect.templateId || effect.template?.name || `${effect.summonMode} selected at use`} for ${effect.lifetimeMinutes} world minutes`;
        if (effect.kind === 'resurrection') return `resurrection: restore ${formatAmount(effect.health)} health`;
        return `${effect.kind}: ${effect.status?.name} (${effect.status?.duration} min; ${effect.stacking || 'refresh'}; ${effect.refreshPolicy || 'stronger'}); ${describeStatusModifiers(effect.status)}`;
    };
    function describeMechanics(parent, mechanics, source) {
        const list = node('dl', 'techniques-mechanics');
        const add = (label, text) => list.append(node('dt', '', label), node('dd', '', text));
        add('Effects', (mechanics.effects || []).map(effectSummary).join('; '));
        add('Cost', `${formatCosts(source?.costs || mechanics.costs)}${source?.requiresWeaponSelection ? ' + selected weapon ammunition/charge (see use preview)' : ''}`);
        add('Failed attempt', `${formatCosts(source?.failureCosts || mechanics.failureCosts || mechanics.costs)}${source?.requiresWeaponSelection ? ' + selected weapon ammunition/charge (see use preview)' : ''}`);
        add('Targets', mechanics.target?.kind || 'self');
        add('Check', Object.entries(mechanics.check || { kind: 'automatic' }).map(([key, value]) => key === 'kind' ? value : `${key}: ${value}`).join('; '));
        add('Requires', (mechanics.useRequirements || []).map(formatRequirement).join('; ') || 'No additional requirements');
        add('Learning requires', (mechanics.acquisitionRequirements || []).map(formatRequirement).join('; ') || 'Discipline access');
        parent.append(list);
    }
    function legacyRecipeEditor(parent, revision, context) {
        const recipe = revision.recipe;
        const recipeId = recipe.recipeId || (recipe.kind ? `standard-${recipe.kind}` : 'standard-healing');
        if (!['standard-healing', 'standard-damage'].includes(recipeId)) throw new Error(`Unsupported single-component recipe ${recipeId}. Use Standard components for mixed/status recipes.`);
        const authoring = context.balanceAuthoring;
        if (!authoring) throw new Error('The server did not supply recipe authoring choices. Refresh the character before editing this pending recipe.');
        const box = section(parent, `${recipeId === 'standard-healing' ? 'Healing' : 'Damage'} recipe`);
        box.append(node('p', '', 'The engine calculates effect strength and configured resource cost from these actual character choices.'));
        const skill = choice(box, 'Scaling skill', authoring.skills.map(row => row.name), recipe.skillName || '');
        const attribute = choice(box, 'Scaling attribute', authoring.attributes.map(row => row.name), recipe.attributeName || '');
        const resource = choice(box, 'Resource profile', authoring.resourceProfiles.map(row => row.resourceProfileId), recipe.resourceProfileId || '');
        const effectId = required(field(box, 'Stable effect ID', recipe.effectId || (recipeId === 'standard-healing' ? 'restore' : 'strike')));
        const target = revision.target ? choice(parent, 'Targets', ['self', 'single'], revision.target.kind) : null;
        const check = revision.check ? checkEditor(parent, revision.check) : null;
        const learning = revision.acquisitionRequirements ? requirementsEditor(parent, 'Learning prerequisites', revision.acquisitionRequirements) : null;
        const use = revision.useRequirements ? requirementsEditor(parent, 'Use prerequisites', revision.useRequirements) : null;
        return () => ({ revision: revision.revision, recipe: { recipeId, skillName: selected(skill, 'scaling skill'), attributeName: selected(attribute, 'scaling attribute'), resourceProfileId: selected(resource, 'resource profile'), effectId: effectId.value.trim() },
            ...(target ? { target: { kind: selected(target, 'target kind'), allowDead: false } } : {}),
            ...(check ? { check: check() } : {}),
            ...(learning ? { acquisitionRequirements: learning() } : {}),
            ...(use ? { useRequirements: use() } : {}) });
    }
    function recipeEditor(parent, revision, context) {
        if (revision.recipe && !Array.isArray(revision.recipe.components) && ['standard-healing', 'standard-damage', 'healing', 'damage'].includes(revision.recipe.recipeId || revision.recipe.kind) && revision.target?.kind !== 'area') return legacyRecipeEditor(parent, revision, context);
        const authoring = context.balanceAuthoring;
        if (!authoring?.resourceProfiles?.length || !authoring?.skills?.length) throw new Error('No applicable standard recipe is available for this character. Choose Custom mechanics.');
        parent.append(node('p', '', `Each component costs its configured resource amount per selected target; every target receives full strength. Status baseline: ±${authoring.status.standard.fixedMagnitude} point or ±${authoring.status.standard.percentMagnitude}% for ${authoring.status.standard.durationMinutes} world minutes.`));
        const target = choice(parent, 'Targets', ['self', 'single', 'area'], revision.target?.kind || 'self');
        const readCheck = checkEditor(parent, revision.check || { kind: 'automatic' });
        const previous = revision.recipe?.components || revision.balance?.selections?.components || [{ ...revision.recipe, kind: revision.recipe?.kind || ({ 'standard-buff': 'buff', 'standard-debuff': 'debuff', 'standard-damage': 'damage' }[revision.recipe?.recipeId] || 'healing') }];
        const components = rowsEditor(parent, 'Components', previous, (holder, value = {}) => {
            const kind = choice(holder, 'Component', authoring.availableRecipeKinds, value.kind || authoring.availableRecipeKinds[0]);
            const effectId = required(field(holder, 'Stable effect ID', value.effectId || `${value.kind || 'effect'}_${Date.now()}`));
            const skill = choice(holder, 'Scaling skill', authoring.skills.map(row => row.name), value.skillName || '');
            const profile = choice(holder, 'Resource profile', authoring.resourceProfiles.map(row => row.resourceProfileId), value.resourceProfileId || '');
            const attribute = choice(holder, 'Scaling attribute', authoring.attributes.map(row => row.name), value.attributeName || '');
            const statusKind = choice(holder, 'Status stat kind', ['attribute', 'skill'], value.statusStatKind || 'attribute');
            const statusName = choice(holder, 'Affected stat', [...authoring.attributes, ...authoring.skills].map(row => row.name), value.statusStatName || '');
            const modifierKind = choice(holder, 'Status modifier', ['fixed', 'percent'], value.statusModifierKind || 'fixed');
            const statusTitle = field(holder, 'Status name', value.statusName || '');
            const description = field(holder, 'Status description', value.statusDescription || '', 'textarea');
            const sync = () => {
                const status = ['buff', 'debuff'].includes(kind.getValue());
                attribute.root.closest('.form-group').hidden = status;
                for (const control of [statusKind, statusName, modifierKind]) control.root.closest('.form-group').hidden = !status;
                for (const input of [statusTitle, description]) input.closest('.form-group').hidden = !status;
                const names = (statusKind.getValue() === 'attribute' ? authoring.attributes : authoring.skills).map(row => row.name);
                statusName.setOptions(names);
                if (statusName.getValue() && !names.includes(statusName.getValue())) statusName.setValue('');
            };
            holder.addEventListener('searchable-select-change', event => { if (event.target === kind.root || event.target === statusKind.root) sync(); }); sync();
            return () => {
                const type = selected(kind, 'component kind');
                return { kind: type, effectId: effectId.value.trim(), skillName: selected(skill, 'scaling skill'), resourceProfileId: selected(profile, 'resource profile'),
                    ...(['buff', 'debuff'].includes(type) ? { statusStatKind: selected(statusKind, 'status stat kind'), statusStatName: selected(statusName, 'affected stat'), statusModifierKind: selected(modifierKind, 'status modifier'), statusName: statusTitle.value.trim(), statusDescription: description.value.trim() } : { attributeName: selected(attribute, 'scaling attribute') }) };
            };
        });
        const learning = requirementsEditor(parent, 'Learning prerequisites', revision.acquisitionRequirements);
        const use = requirementsEditor(parent, 'Use prerequisites', revision.useRequirements);
        return () => ({ revision: revision.revision, target: { kind: selected(target, 'target kind'), allowDead: false }, check: readCheck(), recipe: { recipeId: 'standard-components', components: components() }, acquisitionRequirements: learning(), useRequirements: use() });
    }
    function editor(parent, mechanics, variables, context = {}) {
        if (!Array.isArray(variables)) throw new Error('The server did not supply the character’s formula variable catalogue.');
        const target = choice(parent, 'Targets', ['self', 'single', 'area'], mechanics.target?.kind || 'self');
        const readCheck = checkEditor(parent, mechanics.check);
        const readEffects = effectsEditor(parent, mechanics.effects, variables, context);
        const readCosts = costsEditor(parent, 'Costs', mechanics.costs, variables);
        const override = node('label', 'techniques-checkbox');
        const checkbox = node('input');
        checkbox.type = 'checkbox';
        checkbox.checked = mechanics.failureCosts !== undefined;
        override.append(checkbox, document.createTextNode('Use a different failed-attempt cost (empty means free failure)'));
        parent.append(override);
        const failure = node('fieldset', 'techniques-failure-costs');
        parent.append(failure);
        const readFailure = costsEditor(failure, 'Failure costs', mechanics.failureCosts || [], variables);
        failure.hidden = !checkbox.checked;
        failure.disabled = !checkbox.checked;
        checkbox.addEventListener('change', () => {
            failure.hidden = !checkbox.checked;
            failure.disabled = !checkbox.checked;
        });
        const readLearning = requirementsEditor(parent, 'Learning prerequisites', mechanics.acquisitionRequirements);
        const readUse = requirementsEditor(parent, 'Use prerequisites', mechanics.useRequirements);
        return () => { const effects = readEffects(); return { revision: mechanics.revision, target: { kind: selected(target, 'target kind'), allowDead: effects.length > 0 && effects.every(effect => effect.kind === 'resurrection') }, check: readCheck(), effects, costs: readCosts(), ...(checkbox.checked ? { failureCosts: readFailure() } : {}), acquisitionRequirements: readLearning(), useRequirements: readUse() }; };
    }
    window.TechniqueMechanicsEditor = { editor, recipeEditor, requirementsEditor };
    class TechniquesPanel {
        static mount(root, actor) {
            if (!root || !actor?.id) return null;
            let panel = instances.get(root);
            if (!panel) { panel = new TechniquesPanel(root); instances.set(root, panel); }
            if (panel.actor?.id !== actor.id) panel.sources.clear();
            panel.actor = actor;
            panel.load();
            return panel;
        }
        constructor(root) {
            this.root = root;
            this.root.classList.add('techniques-panel');
            this.version = 0;
            this.sources = new Map();
            activePanels.add(this);
        }
        async load() {
            const version = ++this.version;
            const actorId = this.actor.id;
            this.controller?.abort();
            this.controller = new AbortController();
            this.root.replaceChildren(node('h3', '', 'Techniques'), node('p', 'npc-view-empty', 'Loading techniques…'));
            try {
                const data = await window.TechniqueCatalogue.load(actorId, { signal: this.controller.signal });
                if (version !== this.version || actorId !== this.actor.id || !this.root.isConnected) return;
                if (!Array.isArray(data.catalog)) throw new Error('Technique catalogue is missing from the character view response.');
                this.data = data;
                this.render();
            } catch (error) {
                if (error.name === 'AbortError' || version !== this.version) return;
                this.root.replaceChildren(node('h3', '', 'Techniques'), node('p', 'techniques-error', error.message), button('Retry', () => this.load()));
                report(error, this.root);
            }
        }
        render() {
            const data = this.data;
            this.root.replaceChildren();
            const header = node('div', 'techniques-actions');
            header.append(node('h3', '', 'Techniques'), button('Learn technique', () => this.learn()), button('Create technique', () => this.edit()), button('Edit catalogue revision', () => this.editCatalogue()), button('Save summon template', () => this.template()), button('Edit discipline', () => this.access()), button('New discipline', () => this.discipline()));
            this.root.append(header);
            if (typeof window.submitTechniqueTurn !== 'function') {
                const help = node('p', 'npc-view-ability-card-description', 'Use techniques as ordinary turns on the Play page. ');
                const link = node('a', '', 'Open Play');
                link.href = '/';
                help.append(link);
                this.root.append(help);
            }
            const groups = new Map();
            for (const technique of data.techniques || []) {
                const name = technique.disciplineName || data.disciplines?.find(entry => entry.id === technique.disciplineId)?.name || technique.disciplineId;
                if (!groups.has(technique.disciplineId)) groups.set(technique.disciplineId, { name, techniques: [] });
                groups.get(technique.disciplineId).techniques.push(technique);
            }
            if (!groups.size) this.root.append(node('p', 'npc-view-empty', 'No techniques learned yet. Your actions, training, and discoveries can unlock them automatically. Describe a specific move in chat; the game will define it when appropriate. The editing controls are optional.'));
            for (const [disciplineId, { name, techniques }] of groups) {
                const heading = node('div', 'techniques-actions techniques-discipline-heading');
                if (window.ActionImages && window.renderEntityImage) heading.append(window.ActionImages.create({ entityType: 'discipline', entityId: disciplineId, ...data.disciplineIcons?.[disciplineId], name }));
                heading.append(node('h4', '', name));
                this.root.append(heading);
                const cards = node('div', 'npc-view-ability-cards techniques-cards');
                for (const technique of techniques) cards.append(this.card(technique));
                this.root.append(cards);
            }
        }
        card(technique) {
            const card = node('article', 'npc-view-ability-card techniques-card');
            const header = node('div', 'npc-view-ability-card-header');
            header.append(node('h5', 'npc-view-ability-card-name', technique.name));
            const badges = node('div', 'techniques-actions');
            if (technique.learned) badges.append(node('span', 'techniques-badge', 'Learned'));
            if (technique.sources.some(source => source.sourceKind === 'equipment')) badges.append(node('span', 'techniques-badge', 'Equipment access'));
            if (technique.sources.some(source => source.sourceKind === 'status')) badges.append(node('span', 'techniques-badge', 'Status grant'));
            header.append(badges);
            if (window.ActionImages && window.renderEntityImage) card.append(window.ActionImages.create({ entityType: 'technique', entityId: technique.techniqueId, imageId: technique.imageId, imagePrompt: technique.imagePrompt, name: technique.name }));
            card.append(header, node('p', 'npc-view-ability-card-description', technique.description));
            const details = node('div');
            const actions = node('div', 'techniques-actions');
            let source;
            const preference = this.sources.get(technique.techniqueId) || technique.selectedSourceId;
            let sourceChoice;
            const sourceLabels = new Map(technique.sources.map(entry => [`${sourceLabel(entry)} · definition ${entry.definitionRevision}${entry.personalRevision ? ` · personal ${entry.personalRevision}` : ''} · ${entry.sourceId}`, entry]));
            function renderSource(label) {
                source = sourceLabels.get(label);
                details.replaceChildren();
                if (!source) {
                    details.append(node('p', 'techniques-unavailable', 'Choose an explicit source to see its costs and use it.'));
                } else {
                    this.sources.set(technique.techniqueId, source.sourceId);
                    describeMechanics(details, source.mechanics, source);
                    details.append(node('p', source.available ? 'techniques-available' : 'techniques-unavailable', source.available ? (source.requiresWeaponSelection ? 'Choose an equipped weapon for exact costs.' : 'Available') : `Unavailable: ${(source.blockers || []).join('; ')}`));
                }
                actions.replaceChildren();
                const learned = technique.sources.find(entry => entry.sourceKind === 'learned');
                if (learned) {
                    actions.append(button(`Edit ${this.data.actorName || this.actor.name || 'character'}’s learned revision`, () => this.edit(technique, learned)));
                    actions.append(button('Reset / rebase personal revision', () => this.reset(technique, learned)));
                }
                if (this.data.catalog?.some(entry => entry.id === technique.techniqueId)) actions.append(button('Edit catalogue revision', () => this.edit(technique, null, { catalogue: true })));
                const use = button('Use', () => this.use(technique, source), true);
                use.disabled = !source?.available || !this.data.canUse || typeof window.submitTechniqueTurn !== 'function';
                if (!this.data.canUse) use.title = 'Only the current player can submit technique turns.';
                if (!window.submitTechniqueTurn) use.title = 'Open Play to use techniques in a turn.';
                actions.append(use);
            }
            if (technique.sources.length > 1) {
                sourceChoice = choice(card, 'Executable source', [...sourceLabels.keys()], [...sourceLabels].find(([, entry]) => entry.sourceId === preference)?.[0] || '', label => renderSource.call(this, label));
            }
            card.append(details, actions);
            renderSource.call(this, sourceChoice ? sourceChoice.getValue() : [...sourceLabels.keys()][0]);
            return card;
        }
        dialog(title, submitLabel, build, submit, { focusCancel = false, onSuccess } = {}) {
            this.dialogNode?.close();
            const actorId = this.actor.id;
            const origin = document.activeElement;
            const dialog = node('dialog', 'modal__dialog techniques-dialog');
            dialog.setAttribute('aria-label', title);
            dialog.setAttribute('role', 'dialog');
            const header = node('header', 'modal__header');
            const close = button('×', () => lifecycle.close());
            close.className = 'modal__close';
            close.setAttribute('aria-label', 'Close');
            header.append(node('h2', '', title), close);
            const form = node('form', 'techniques-form');
            const body = node('div', 'modal__body');
            const status = node('p', 'techniques-status');
            status.setAttribute('role', 'status');
            const footer = node('footer', 'modal__footer');
            const cancel = button('Cancel', () => lifecycle.close());
            const save = node('button', 'btn btn-primary', submitLabel);
            save.type = 'submit';
            footer.append(cancel, save);
            form.append(body, status, footer);
            dialog.append(header, form);
            document.body.append(dialog);
            this.dialogNode = dialog;
            const lifecycle = new window.AIRPG_WIDGETS.NativeDialog(dialog, {
                returnFocus: origin, removeOnClose: true,
                onClose: () => { if (this.dialogNode === dialog) this.dialogNode = null; }
            });
            const read = build(body);
            let pending = false;
            form.addEventListener('submit', async event => {
                event.preventDefault();
                if (pending) return;
                let disabledStates;
                try {
                    if (actorId !== this.actor.id) throw new Error('The inspected character changed. Reopen this editor for the intended character.');
                    const value = read();
                    pending = true;
                    lifecycle.setPending(true);
                    disabledStates = new Map([...dialog.querySelectorAll('button,input,select,textarea')].map(control => [control, control.disabled]));
                    for (const control of disabledStates.keys()) control.disabled = true;
                    status.textContent = 'Submitting…';
                    const result = await submit(value, actorId);
                    dialog.close();
                    if (onSuccess) await onSuccess(result);
                    else {
                        const global = result?.disciplinesChanged === true || Boolean(result?.definition);
                        if (!global) await this.load();
                        window.dispatchEvent(new CustomEvent('techniques:changed', { detail: { actorId, global } }));
                    }
                } catch (error) {
                    status.textContent = error.message;
                    report(error, save);
                } finally {
                    pending = false;
                    if (!lifecycle.destroyed) lifecycle.setPending(false);
                    if (disabledStates) for (const [control, disabled] of disabledStates) control.disabled = disabled;
                }
            });
            lifecycle.open({ initialFocus: focusCancel ? cancel : null });
            return dialog;
        }
        edit(technique, source, { catalogue = false } = {}) {
            const personal = Boolean(source);
            const definition = catalogue ? this.data.catalog.find(entry => entry.id === technique.techniqueId) : null;
            if (catalogue && !definition) throw new Error(`Catalogue definition ${technique.techniqueId} is unavailable. Refresh the character view.`);
            const mechanics = personal ? clone(source.mechanics) : catalogue ? clone(definition.revisions.at(-1)) : { revision: 1, target: { kind: 'self', allowDead: false }, check: { kind: 'automatic' }, costs: [], effects: [{ id: 'effect-1', kind: 'healing', amount: 1 }], acquisitionRequirements: [], useRequirements: [] };
            if (personal) mechanics.revision = source.personalRevision + 1;
            if (catalogue) mechanics.revision = definition.revisions.length + 1;
            let readMechanics;
            this.dialog(personal ? `Edit ${technique.name} — ${this.data.actorName || this.actor.name}` : catalogue ? `Edit catalogue — ${technique.name}` : 'Create world technique', personal ? 'Save personal revision' : catalogue ? 'Append catalogue revision' : 'Create technique', body => {
                body.append(node('p', '', personal ? 'Changes apply only to this character’s learned mechanics. Equipped item grants retain their pinned versions.' : catalogue ? 'This appends a shared catalogue revision. Existing owners retain their pinned base until explicitly rebased.' : 'Creates a catalogue definition. Learn it separately after confirming discipline access and prerequisites.'));
                let name, description, identity, discipline, unique;
                if (!personal && !catalogue) {
                    name = required(field(body, 'Name'));
                    description = required(field(body, 'Description', '', 'textarea'));
                    identity = required(field(body, 'Semantic identity (stable description of the action)'));
                    discipline = choice(body, 'Discipline', this.data.disciplines.map(entry => `${entry.name} · ${entry.id}`), '');
                    unique = choice(body, 'Scope', ['Shared world technique', 'Unique technique'], 'Shared world technique');
                }
                const mechanicsBody = node('div');
                if (mechanics.balance) {
                    const renderMechanics = mode => {
                        mechanicsBody.replaceChildren();
                        if (mode === 'Custom mechanics') {
                            const custom = clone(mechanics);
                            delete custom.balance;
                            readMechanics = editor(mechanicsBody, custom, this.data.formulaVariables, this.data);
                        } else {
                            mechanicsBody.append(node('p', '', 'Healing and resource costs follow this technique’s saved balance rules. Skill and level are recalculated when used. Choose Custom mechanics to author an independent personal revision.'));
                            describeMechanics(mechanicsBody, mechanics, source);
                            readMechanics = () => clone(mechanics);
                        }
                    };
                    choice(body, 'Balance mode', ['Managed balance', 'Custom mechanics'], 'Managed balance', renderMechanics);
                    body.append(mechanicsBody);
                    renderMechanics('Managed balance');
                } else {
                    const standard = this.data.balanceAuthoring?.resourceProfiles?.length && this.data.balanceAuthoring?.availableRecipeKinds?.length;
                    if (standard) {
                        const mode = choice(body, 'Authoring mode', ['Standard recipe', 'Custom mechanics'], mechanics.recipe ? 'Standard recipe' : catalogue || personal ? 'Custom mechanics' : 'Standard recipe');
                        body.append(mechanicsBody);
                        const render = () => { mechanicsBody.replaceChildren(); readMechanics = mode.getValue() === 'Standard recipe' ? recipeEditor(mechanicsBody, mechanics, this.data) : editor(mechanicsBody, mechanics, this.data.formulaVariables, this.data); };
                        mode.root.addEventListener('searchable-select-change', render); render();
                    } else { body.append(mechanicsBody); readMechanics = editor(mechanicsBody, mechanics, this.data.formulaVariables, this.data); }
                }
                const reason = required(field(body, 'Reason / source for this change', '', 'textarea'));
                const preview = node('div', 'techniques-preview');
                let previewVersion = 0;
                const invalidatePreview = () => { previewVersion++; preview.replaceChildren(); };
                body.addEventListener('input', invalidatePreview);
                body.addEventListener('searchable-select-change', invalidatePreview);
                preview.setAttribute('aria-live', 'polite');
                body.append(button('Calculate preview', async event => {
                    const trigger = event.currentTarget;
                    try {
                        const value = readMechanics();
                        const version = ++previewVersion;
                        const actorId = this.actor.id;
                        const result = await request('/api/techniques/preview', { actorId: this.actor.id, mechanics: value });
                        if (!preview.isConnected || version !== previewVersion || actorId !== this.actor.id) return;
                        preview.replaceChildren(node('strong', '', 'Calculated preview — recalculated again at use time'));
                        describeMechanics(preview, result.mechanics || value, result);
                    } catch (error) { report(error, trigger); }
                }), preview);
                return () => {
                    const provenance = { kind: 'editor', reason: reason.value.trim() };
                    const value = readMechanics();
                    if (personal) return { mechanics: value, provenance, ...(mechanics.balance && !value.balance ? { convertToCustom: true } : {}) };
                    if (catalogue) return { mechanics: value, expectedCatalogRevision: definition.revisions.length, ...(mechanics.balance && !value.balance ? { convertToCustom: true } : {}) };
                    const label = selected(discipline, 'discipline');
                    const disciplineId = this.data.disciplines.find(entry => `${entry.name} · ${entry.id}` === label)?.id;
                    if (!disciplineId) throw new Error('Selected discipline is unavailable.');
                    return { name: name.value.trim(), description: description.value.trim(), semanticKey: identity.value.trim(), disciplineId, aliases: [], unique: unique.getValue() === 'Unique technique', provenance, revisions: [value] };
                };
            }, (value, actorId) => personal ? request(`/api/techniques/${encodeURIComponent(technique.techniqueId)}/personal`, { ...value, actorId }, 'PUT') : catalogue ? request(`/api/techniques/${encodeURIComponent(technique.techniqueId)}/catalog`, { ...value, actorId }, 'PUT') : request('/api/techniques/catalog', { ...value, actorId }));
        }
        reset(technique, source) {
            let definition = this.data.catalog?.find(entry => entry.id === technique.techniqueId);
            if (!definition) throw new Error(`Catalogue definition ${technique.techniqueId} is missing. Refresh before reviewing a reset.`);
            let latest = definition.revisions.length;
            let pinned = source.definitionRevision;
            let personalRevision = source.personalRevision;
            const operationId = `editor:${crypto.randomUUID()}`;
            let reviewed = null;
            this.dialog(`Reset / rebase — ${technique.name}`, 'Apply reviewed change', body => {
                const context = node('p', '', `${this.data.actorName || this.actor.name} · definition ${pinned} · personal ${personalRevision}. Only this character’s learned copy changes.`);
                body.append(context);
                const mode = choice(body, 'Operation', latest > pinned ? ['Reset to pinned base', 'Rebase to catalogue revision'] : ['Reset to pinned base'], 'Reset to pinned base');
                let revisions = new Map(definition.revisions.map((entry, index) => [`Revision ${index + 1}`, index + 1]));
                const revision = choice(body, 'Catalogue revision', [...revisions.keys()].filter(label => revisions.get(label) > pinned), `Revision ${latest}`);
                const comparison = node('div', 'techniques-reset-comparison');
                const warning = node('p', 'techniques-reset-warning', 'Personal changes will be replaced. Acquisition evidence and personal history remain; a new history entry records this change.');
                const reason = required(field(body, 'Reason for this change', '', 'textarea'));
                const preview = button('Review before and after', async event => {
                    const trigger = event.currentTarget;
                    const targetDefinitionRevision = mode.getValue() === 'Reset to pinned base' ? pinned : revisions.get(selected(revision, 'catalogue revision'));
                    const params = { actorId: this.actor.id, expectedDefinitionRevision: pinned, expectedPersonalRevision: personalRevision, expectedCatalogRevision: latest, targetDefinitionRevision };
                    try {
                        const serial = ++version;
                        const response = await request(`/api/techniques/${encodeURIComponent(technique.techniqueId)}/personal-reset/preview`, params);
                        if (serial !== version || !comparison.isConnected || response.actorId !== this.actor.id) return;
                        reviewed = { ...params, response };
                        comparison.replaceChildren();
                        for (const [heading, mechanics] of [['Current personal', response.before], ['Selected base after change', response.after]]) {
                            const card = node('section', 'techniques-reset-card');
                            card.append(node('h3', '', heading));
                            describeMechanics(card, mechanics, mechanics);
                            comparison.append(card);
                        }
                        comparison.append(node('p', '', `Personal revision ${response.fromPersonalRevision} → ${response.toPersonalRevision}. Definition revision ${response.fromDefinitionRevision} → ${response.toDefinitionRevision}.`));
                    } catch (error) { reviewed = null; report(error, trigger); }
                });
                let version = 0;
                const invalidate = () => { ++version; reviewed = null; comparison.replaceChildren(node('p', '', 'Review required for the current selection.')); };
                const refresh = button('Refresh actor and catalogue', async event => {
                    try {
                        const result = await window.TechniqueCatalogue.load(this.actor.id);
                        const updated = result.catalog.find(entry => entry.id === technique.techniqueId);
                        const learned = result.techniques.find(entry => entry.techniqueId === technique.techniqueId)?.sources.find(entry => entry.sourceKind === 'learned');
                        if (!updated || !learned) throw new Error('The learned technique or catalogue definition is no longer available. Close this review and inspect the actor.');
                        this.data = result;
                        definition = updated;
                        latest = updated.revisions.length;
                        pinned = learned.definitionRevision;
                        personalRevision = learned.personalRevision;
                        mode.setOptions(latest > pinned ? ['Reset to pinned base', 'Rebase to catalogue revision'] : ['Reset to pinned base']);
                        if (latest === pinned) mode.setValue('Reset to pinned base');
                        context.textContent = `${result.actorName} · definition ${pinned} · personal ${personalRevision}. Only this character’s learned copy changes.`;
                        revisions = new Map(updated.revisions.map((entry, index) => [`Revision ${index + 1}`, index + 1]));
                        revision.setOptions([...revisions.keys()].filter(label => revisions.get(label) > pinned));
                        revision.setValue(`Revision ${latest}`);
                        revision.root.closest('.form-group').hidden = mode.getValue() !== 'Rebase to catalogue revision';
                        invalidate();
                    } catch (error) { report(error, event.currentTarget); }
                });
                mode.root.addEventListener('searchable-select-change', () => { revision.root.closest('.form-group').hidden = mode.getValue() !== 'Rebase to catalogue revision'; invalidate(); });
                revision.root.addEventListener('searchable-select-change', invalidate);
                revision.root.closest('.form-group').hidden = true;
                body.append(refresh, preview, comparison, warning);
                invalidate();
                return () => {
                    if (!reviewed) throw new Error('Review the current reset or rebase selection before applying it.');
                    if (!reason.value.trim()) throw new Error('Enter a reason for this personal reset or rebase.');
                    const { response: ignored, ...params } = reviewed;
                    return { ...params, operationId, provenance: { kind: 'editor', reason: reason.value.trim() } };
                };
            }, (value) => request(`/api/techniques/${encodeURIComponent(technique.techniqueId)}/personal-reset`, value), { focusCancel: true });
        }
        editCatalogue() {
            const catalog = this.data.catalog || [];
            if (!catalog.length) throw new Error('The catalogue is empty. Create a technique first.');
            const labels = new Map(catalog.map(entry => [`${entry.name} · ${entry.id}`, entry]));
            this.dialog('Choose catalogue technique', 'Edit selected revision', body => {
                const pick = choice(body, 'Technique', [...labels.keys()], '');
                return () => labels.get(selected(pick, 'catalogue technique'));
            }, async definition => definition, { onSuccess: definition => this.edit({ techniqueId: definition.id, name: definition.name }, null, { catalogue: true }) });
        }
        template() {
            this.dialog('Save summon template', 'Save template', body => {
                const saved = node('div', 'techniques-preview');
                body.append(saved);
                request(`/api/techniques/summon-templates?actorId=${encodeURIComponent(this.actor.id)}`).then(result => {
                    if (saved.isConnected) saved.replaceChildren(node('p', '', `Saved templates: ${result.templates.map(entry => `${entry.name} · ${entry.id}`).join(', ') || 'none'}`));
                }).catch(error => report(error, saved));
                return templateEditor(body, {}, this.data.balanceAuthoring);
            }, (value, actorId) => request('/api/techniques/summon-templates', { actorId, ...value }));
        }
        learn() {
            const catalog = this.data.catalog || [];
            this.dialog('Learn catalogue technique', 'Learn technique', body => {
                body.append(node('p', '', 'Learning grants durable knowledge to this character. Discipline access and learning prerequisites are checked by the server.'));
                if (!catalog.length) body.append(node('p', '', 'The world catalogue is empty. Close this dialog and create a technique first.'));
                const definitions = catalog.filter(entry => !this.data.techniques.some(known => known.techniqueId === entry.id && known.learned));
                const labels = new Map(definitions.map(entry => [`${entry.name} · ${entry.id}`, entry]));
                const details = node('div');
                const select = choice(body, 'Technique', [...labels.keys()], '', value => {
                    details.replaceChildren();
                    const definition = labels.get(value);
                    if (definition) {
                        details.append(node('p', '', definition.description));
                        describeMechanics(details, definition.revisions[definition.revisions.length - 1]);
                    }
                });
                body.append(details);
                const reason = required(field(body, 'How this character acquired the technique', '', 'textarea'));
                return () => {
                    const definition = labels.get(selected(select, 'technique'));
                    return { techniqueId: definition.id, definitionRevision: definition.revisions.length, provenance: { kind: 'editor', reason: reason.value.trim() } };
                };
            }, (value, actorId) => request(`/api/techniques/${encodeURIComponent(value.techniqueId)}/learn`, { actorId, definitionRevision: value.definitionRevision, provenance: value.provenance }));
        }
        discipline() {
            this.dialog('Create discipline', 'Create discipline', body => {
                const name = required(field(body, 'Name'));
                const description = required(field(body, 'Description / acquisition rules', '', 'textarea'));
                const access = choice(body, 'Access', ['Explicit character access', 'Public access'], 'Explicit character access');
                const readRequirements = requirementsEditor(body, 'Access prerequisites', []);
                const reason = required(field(body, 'Source / reason', '', 'textarea'));
                return () => ({ name: name.value.trim(), description: description.value.trim(), publicAccess: access.getValue() === 'Public access', accessRequirements: readRequirements(), provenance: { kind: 'editor', reason: reason.value.trim() } });
            }, value => request('/api/techniques/disciplines', value));
        }
        access() {
            const data = this.data;
            if (!data.disciplineEditContext) {
                report(new Error('The server did not supply the discipline editor baseline. Refresh the character after updating the server.'), this.root);
                return;
            }
            const previous = clone(data.disciplineAccess || []);
            const expected = clone(data.disciplineEditContext);
            const disciplines = [...data.disciplines].sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
            const labels = new Map(disciplines.map(entry => [`${entry.name} · ${entry.id}`, entry.id]));
            const originals = new Map(disciplines.map(entry => [entry.id, entry]));
            const drafts = new Map(disciplines.map(entry => [entry.id, { id: entry.id, name: entry.name, description: entry.description }]));
            this.dialog(`Edit discipline — ${data.actorName || this.actor.name}`, 'Save discipline changes', body => {
                const shared = section(body, 'Shared discipline details');
                shared.append(node('p', '', 'Names and descriptions are shared by all characters. Renaming keeps the discipline’s identity, techniques and access rules. Selector labels show saved names until you save.'));
                let currentId = disciplines[0]?.id || null;
                const select = choice(shared, 'Discipline to edit', [...labels.keys()], [...labels.keys()][0] || '', label => {
                    keepDraft();
                    currentId = labels.get(label) || null;
                    showDraft();
                });
                const name = required(field(shared, 'Name'));
                const description = required(field(shared, 'Description', '', 'textarea'));
                const keepDraft = () => {
                    if (currentId) drafts.set(currentId, { id: currentId, name: name.value, description: description.value });
                };
                const showDraft = () => {
                    const draft = drafts.get(currentId);
                    name.value = draft?.name || '';
                    description.value = draft?.description || '';
                    name.disabled = description.disabled = !draft;
                };
                showDraft();
                if (!disciplines.length) shared.append(node('p', '', 'No disciplines exist yet. Create one before editing its name or description.'));
                const access = section(body, `Explicit access for ${data.actorName || this.actor.name}`);
                access.append(node('p', '', 'Access changes apply only to this character. A skill’s presence alone does not qualify a character. Removing explicit access does not delete learned techniques or change public access or prerequisites.'));
                const root = node('div');
                root.dataset.label = 'Accessible disciplines';
                access.append(node('p', '', 'Accessible disciplines'), root);
                const accessSelect = new window.AIRPG_WIDGETS.SearchableSelect(root, {
                    multiple: true, options: [...labels.keys()],
                    value: [...labels].filter(([, id]) => previous.some(entry => entry.disciplineId === id)).map(([label]) => label),
                    onChange: () => updateReason()
                });
                const reason = field(access, 'Reason / source of newly granted access', '', 'textarea');
                const updateReason = () => {
                    const addsAccess = accessSelect.getValue().some(label => !previous.some(entry => entry.disciplineId === labels.get(label)));
                    reason.required = addsAccess;
                    reason.disabled = !addsAccess;
                    reason.parentElement.hidden = !addsAccess;
                };
                updateReason();
                return () => {
                    // The current select value is read only through the widget, like the access picker.
                    if (select.getValue() && !labels.has(select.getValue())) throw new Error('Choose a valid discipline.');
                    keepDraft();
                    const edits = [...drafts.values()].map(draft => ({ ...draft, name: draft.name.trim(), description: draft.description.trim() })).filter(draft => {
                        const original = originals.get(draft.id);
                        return draft.name !== original.name || draft.description !== original.description;
                    });
                    for (const edit of edits) if (!edit.name || !edit.description) throw new Error(`Name and description are required for discipline ${edit.id}.`);
                    return { edits, accessIds: accessSelect.getValue().map(label => labels.get(label)), ...(reason.required ? { accessReason: reason.value.trim() } : {}), expected };
                };
            }, (value, actorId) => request('/api/techniques/disciplines', { actorId, ...value }, 'PUT'));
        }
        use(technique, source) {
            if (!source) throw new Error('Choose a technique source first.');
            this.dialog(`Use ${technique.name}`, 'Use technique', body => {
                body.append(node('p', '', `${this.data.actorName || this.actor.name} · ${source.sourceKind} · definition ${source.definitionRevision}${source.personalRevision ? ` · personal ${source.personalRevision}` : ''}`));
                describeMechanics(body, source.mechanics, source);
                const targetKind = source.mechanics.target.kind;
                const resurrection = source.mechanics.effects.some(effect => effect.kind === 'resurrection');
                const weaponEffect = source.mechanics.effects.some(effect => effect.kind === 'damage' && effect.damageMode === 'weapon');
                let weapon;
                const weapons = new Map((this.data.weaponItems || []).map(entry => [`${entry.name} · ${entry.itemId}`, entry.itemId]));
                if (weaponEffect) {
                    if (!weapons.size) body.append(node('p', 'techniques-unavailable', 'Equip a weapon before using this technique.'));
                    weapon = choice(body, 'Equipped weapon', [...weapons.keys()], weapons.size === 1 ? [...weapons.keys()][0] : '');
                    body.append(node('p', '', 'Weapon multiplier and bonus apply before defenses. Normal ammunition or charge is paid once.'));
                }
                let targets;
                const labels = new Map((this.data.targets || []).filter(entry => Boolean(entry.isDead) === resurrection).map(entry => [`${entry.name} · ${entry.id}`, entry.id]));
                if (targetKind !== 'self') {
                    const root = node('div');
                    root.dataset.label = resurrection ? 'Dead character at this scene' : targetKind === 'area' ? 'Targets' : 'Target';
                    body.append(node('p', '', root.dataset.label), root);
                    targets = new window.AIRPG_WIDGETS.SearchableSelect(root, { multiple: targetKind === 'area', options: [...labels.keys()], emptyLabel: 'Choose target…' });
                }
                const selectors = new Map();
                for (const effect of source.mechanics.effects) {
                    const context = this.data.utilityContext || {};
                    let entries, label, key;
                    if (effect.kind === 'teleport' && !effect.destinationId) { entries = context.destinations || []; label = 'Teleport destination'; key = 'destinationId'; }
                    else if (effect.kind === 'summon' && effect.summonMode === 'existing' && !effect.actorId) { entries = context.summonActors || []; label = 'Existing actor to summon'; key = 'actorId'; }
                    else if (effect.kind === 'summon' && effect.summonMode === 'template' && !effect.templateId && !effect.template) { entries = context.summonTemplates || []; label = 'Saved creature template'; key = 'templateId'; }
                    if (!key) continue;
                    const choices = new Map(entries.map(entry => [`${entry.name} · ${entry.id}`, entry.id]));
                    const control = choice(body, `${label} · ${effect.id}`, [...choices.keys()], '');
                    selectors.set(effect.id, { control, choices, key });
                }
                if (resurrection) body.append(node('p', '', 'Only an existing dead character at this scene is eligible. Other statuses, inventory and XP are preserved.'));
                const intention = field(body, 'Intention / action details', `I use ${technique.name}.`, 'textarea');
                intention.required = true;
                const preview = node('div', 'techniques-use-preview');
                preview.setAttribute('aria-live', 'polite');
                let reviewed = null;
                let serial = 0;
                const readUse = () => {
                    const values = targetKind === 'self' ? [] : targets.getValue();
                    const targetIds = targetKind === 'self' ? [this.actor.id] : (Array.isArray(values) ? values : [values]).filter(Boolean).map(label => labels.get(label));
                    if (!targetIds.length) throw new Error('Choose at least one target.');
                    if (targetIds.some(id => !id)) throw new Error('Choose a valid target at this scene.');
                    const utilitySelections = {};
                    for (const [effectId, { control, choices, key }] of selectors) utilitySelections[effectId] = { [key]: choices.get(selected(control, `${key} for ${effectId}`)) };
                    return { actorId: this.actor.id, sourceId: source.sourceId, targetIds,
                        ...(weaponEffect ? { weaponItemId: weapons.get(selected(weapon, 'equipped weapon')) } : {}),
                        ...(selectors.size ? { utilitySelections } : {}) };
                };
                const invalidate = () => { ++serial; reviewed = null; preview.replaceChildren(node('p', '', 'Calculate the current cost preview before using this technique.')); };
                body.addEventListener('input', invalidate);
                body.addEventListener('searchable-select-change', invalidate);
                const previewButton = button('Calculate cost preview', async event => {
                    const trigger = event.currentTarget;
                    try {
                        const selection = readUse();
                        const version = ++serial;
                        const result = await request(`/api/techniques/${encodeURIComponent(technique.techniqueId)}/use-preview`, selection);
                        if (!preview.isConnected || version !== serial || this.actor.id !== selection.actorId) return;
                        reviewed = { selection, result };
                        preview.replaceChildren(node('h3', '', `Cost preview · ${result.targetIds.length} target${result.targetIds.length === 1 ? '' : 's'}`));
                        const rows = node('div', 'techniques-cost-rows');
                        for (const cost of result.costs || []) {
                            const row = node('div', 'techniques-cost-row');
                            const parts = (cost.calculations || []).map(calculation => calculation.perTarget ? `${calculation.unitAmount} × ${calculation.targetCount}` : String(calculation.amount));
                            row.append(node('strong', '', cost.resource === 'health' ? 'Health' : cost.resource === 'charge' ? `${cost.itemId} charge/ammunition` : cost.needId || cost.key), node('span', '', parts.join(' + ')), node('strong', '', String(cost.amount)));
                            rows.append(row);
                        }
                        preview.append(rows, node('p', 'techniques-cost-total', (result.costs || []).map(cost => `${cost.amount} ${cost.resource === 'health' ? 'health' : cost.resource === 'charge' ? 'charge/ammunition' : cost.needId || cost.key}`).join(' + ') || 'No resource cost'));
                        preview.append(node('p', '', `Failed attempt: ${(result.failureCosts || []).map(cost => `${cost.amount} ${cost.resource === 'health' ? 'health' : cost.resource === 'charge' ? 'charge/ammunition' : cost.needId || cost.key}`).join(' + ') || 'no resource cost'}.`));
                        if (result.weaponItemId) preview.append(node('p', '', `Exact weapon: ${result.weapon?.name || result.weaponItemId}. Normal ammunition or charge is paid once.`));
                        if (targetKind === 'area') preview.append(node('p', '', 'Every selected target receives the full effect strength.'));
                        preview.append(node('p', '', 'Execution checks the source, targets and resources again.'));
                    } catch (error) { reviewed = null; report(error, trigger); }
                });
                body.append(previewButton, preview);
                invalidate();
                return () => {
                    const selection = readUse();
                    if (!reviewed || JSON.stringify(reviewed.selection) !== JSON.stringify(selection)) throw new Error('Calculate the current cost preview before using this technique.');
                    return { message: intention.value.trim(), techniqueUse: { ...selection, techniqueId: technique.techniqueId, definitionRevision: source.definitionRevision, ...(source.personalRevision ? { personalRevision: source.personalRevision } : {}) } };
                };
            }, value => window.submitTechniqueTurn(value));
        }
    }
    class TechniqueSidebar {
        constructor({ root, grid, chooser }) {
            Object.assign(this, { root, grid, chooser });
            this.revision = 0;
            this.disciplineId = null;
            this.fingerprint = null;
            this.chooser.root.addEventListener('chooser:closed', () => { for (const control of this.root.querySelectorAll('[data-discipline-id]')) control.setAttribute('aria-expanded', 'false'); });
            this.root.addEventListener('click', event => {
                const control = event.target.closest('[data-discipline-id]');
                if (control) this.open(control.dataset.disciplineId);
            });
            for (const name of ['techniques:refresh', 'techniques:changed']) window.addEventListener(name, event => {
                if (event.detail?.global || !event.detail?.actorId || event.detail.actorId === this.actor?.id) this.refresh();
            });
            document.addEventListener('inventory:updated', () => this.refresh());
            document.addEventListener('keydown', event => {
                if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.key.toLowerCase() !== 't') return;
                if (document.activeElement?.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('dialog[open], .modal[aria-modal="true"]:not([hidden])')) return;
                const controls = [...this.root.querySelectorAll('[data-discipline-id]')];
                if (!controls.length) return;
                event.preventDefault();
                const index = controls.findIndex(control => control.dataset.disciplineId === this.disciplineId);
                this.open(controls[this.chooser.isOpen ? (index + 1) % controls.length : 0].dataset.disciplineId);
            });
        }
        updateActor(actor) {
            const changedActor = actor?.id !== this.actor?.id;
            this.actor = actor;
            // Costs and eligibility depend on these actor facts. Identical sidebar repaints do not fetch.
            const fingerprint = JSON.stringify([actor?.id, actor?.level, actor?.health, actor?.currentHealth, actor?.maxHealth, actor?.isDead, actor?.isDisabled, actor?.dead, actor?.disabled, actor?.attributes, actor?.skills, actor?.needBars, actor?.statusEffects, actor?.gear, actor?.inventory, actor?.techniques, actor?.disciplineAccess, actor?.class, actor?.race]);
            if (fingerprint === this.fingerprint) return;
            this.fingerprint = fingerprint;
            if (changedActor) {
                this.controller?.abort();
                this.data = null;
                this.disciplineId = null;
                this.root.replaceChildren();
                this.chooser.close();
            }
            this.refresh();
        }
        refresh() {
            ++this.revision;
            clearTimeout(this.timer);
            if (!this.actor?.id) return;
            this.timer = setTimeout(() => this.load(), 80);
        }
        async load() {
            if (!this.actor?.id) return;
            if (this.loading) { this.queued = true; return; }
            this.loading = true;
            this.queued = false;
            const revision = this.revision;
            const actorId = this.actor.id;
            this.controller = new AbortController();
            this.root.setAttribute('aria-busy', 'true');
            try {
                const data = await window.TechniqueCatalogue.load(actorId, { signal: this.controller.signal });
                if (revision !== this.revision || actorId !== this.actor?.id) return;
                if (data.actorId !== actorId || !Array.isArray(data.techniques) || !Array.isArray(data.catalog)) throw new Error('Technique response does not match the current player.');
                this.data = data;
                this.render();
            } catch (error) {
                if (error.name === 'AbortError' || revision !== this.revision || actorId !== this.actor?.id) return;
                this.root.replaceChildren(button('Retry techniques', () => this.refresh()));
                this.grid.replaceChildren(node('p', 'techniques-error', error.message));
                report(error, this.root);
            } finally {
                this.loading = false;
                this.root.removeAttribute('aria-busy');
                if (this.queued || revision !== this.revision) { clearTimeout(this.timer); this.timer = setTimeout(() => this.load(), 80); }
            }
        }
        render() {
            const groups = new Map();
            for (const entry of this.data.techniques) {
                if (!groups.has(entry.disciplineId)) groups.set(entry.disciplineId, { name: entry.disciplineName || entry.disciplineId, entries: [] });
                groups.get(entry.disciplineId).entries.push(entry);
            }
            this.groups = new Map([...groups].sort(([, a], [, b]) => a.name.localeCompare(b.name)));
            const focused = document.activeElement?.dataset?.disciplineId;
            this.root.replaceChildren();
            for (const [id, group] of this.groups) {
                const row = node('div', 'chat-player-discipline-row');
                row.append(window.ActionImages.create({ entityType: 'discipline', entityId: id, ...this.data.disciplineIcons?.[id], name: group.name }));
                const control = button('', () => {});
                control.className = 'chat-player-action-button chat-player-discipline-button';
                control.dataset.disciplineId = id;
                control.setAttribute('aria-haspopup', 'dialog');
                control.setAttribute('aria-controls', this.chooser.root.id);
                control.setAttribute('aria-expanded', String(this.chooser.isOpen && id === this.disciplineId));
                control.title = `${group.entries.length} technique${group.entries.length === 1 ? '' : 's'} · T opens/cycles disciplines`;
                control.append(node('span', 'chat-player-action-label', group.name), node('span', 'techniques-badge', String(group.entries.length)));
                row.append(control);
                this.root.append(row);
                if (focused === id) control.focus({ preventScroll: true });
            }
            if (this.chooser.isOpen) {
                if (!this.groups.has(this.disciplineId)) { this.chooser.close(); this.disciplineId = null; }
                else this.renderCards();
            }
        }
        open(id) {
            if (!this.groups?.has(id)) return;
            this.disciplineId = id;
            this.renderCards();
            this.chooser.open(this.groups.get(id).name);
            for (const control of this.root.querySelectorAll('[data-discipline-id]')) control.setAttribute('aria-expanded', String(control.dataset.disciplineId === id));
        }
        renderCards() {
            const group = this.groups.get(this.disciplineId);
            const activeName = document.activeElement?.dataset?.chooserChoice;
            this.grid.replaceChildren();
            for (const technique of [...group.entries].sort((a, b) => a.name.localeCompare(b.name))) {
                const card = node('article', 'npc-view-ability-card player-techniques-card action-card');
                card.append(window.ActionImages.create({ entityType: 'technique', entityId: technique.techniqueId, imageId: technique.imageId, imagePrompt: technique.imagePrompt, name: technique.name }));
                const content = node('button', 'action-card-content');
                content.type = 'button';
                this.chooser.choice(content, technique.name);
                const header = node('div', 'npc-view-ability-card-header');
                header.append(node('span', 'npc-view-ability-card-name', technique.name));
                const source = technique.sources.find(entry => entry.sourceId === technique.selectedSourceId);
                if (source) header.append(node('span', 'techniques-badge technique-cost', formatCosts(source.costs || source.mechanics.costs)));
                content.append(header, node('p', 'npc-view-ability-card-description', technique.description));
                const provenance = technique.sources.map(sourceLabel).join(' · ');
                content.append(node('p', 'technique-source', provenance));
                if (source) {
                    const effects = (source.mechanics.effects || []).map(effectSummary).join('; ');
                    content.append(node('p', 'technique-effect', `Effect · ${effects}`));
                    if (technique.sources.length > 1) content.append(node('p', 'technique-source', `Default source: ${sourceLabel(source)}`));
                    content.append(node('p', source.available ? 'technique-availability' : 'technique-availability techniques-unavailable', source.available ? 'Available from this source' : `Unavailable: ${(source.blockers || []).join('; ')}`));
                } else {
                    for (const candidate of technique.sources) {
                        const label = sourceLabel(candidate);
                        const effects = (candidate.mechanics.effects || []).map(effectSummary).join('; ');
                        content.append(node('p', 'technique-effect', `${label} · Cost: ${formatCosts(candidate.costs || candidate.mechanics.costs)} · Effect: ${effects}`));
                        if (!candidate.available) content.append(node('p', 'technique-availability techniques-unavailable', `${label}: ${(candidate.blockers || []).join('; ')}`));
                    }
                    content.append(node('p', 'technique-availability techniques-unavailable', `Source selection required: ${(technique.blockers || []).join('; ') || 'grants have different mechanics'}. Describe the intended source in your action or choose one in View.`));
                }
                card.append(content);
                this.grid.append(card);
                if (activeName === technique.name) content.focus({ preventScroll: true });
            }
        }
    }
    window.TechniqueSidebar = TechniqueSidebar;
    window.TechniquesPanel = TechniquesPanel;
    window.addEventListener('techniques:changed', event => {
        if (event.detail?.global) for (const panel of activePanels) if (panel.root.isConnected) panel.load();
    });
    window.addEventListener('techniques:refresh', () => { for (const panel of activePanels) if (panel.root.isConnected) panel.load(); });
})();
