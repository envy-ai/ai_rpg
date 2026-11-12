(() => {
    'use strict';
    const widgets = () => window.AIRPG_WIDGETS;
    const scalar = input => input.value.trim();
    function validateEffect(effect, path = 'statusEffect') {
        if (!effect || typeof effect !== 'object' || Array.isArray(effect)) throw new TypeError(`${path} must be an object containing its effect fields.`);
        for (const key of ['attributes', 'skills', 'needBars', 'needBarMaximums']) {
            if (effect[key] === undefined || effect[key] === null) continue;
            if (!Array.isArray(effect[key])) throw new TypeError(`${path}.${key} must be an array of modifier records. Supply an empty array when there are no modifiers.`);
            effect[key].forEach((entry, index) => {
                if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new TypeError(`${path}.${key}[${index}] must be a modifier record with its identity and numeric values.`);
            });
        }
    }

    const StatusEffectFields = {
        populate(fields, effect = {}) {
            for (const [key, input] of Object.entries(fields)) {
                if (input) input.value = effect[key] === undefined || effect[key] === null ? '' : String(effect[key]);
            }
        },
        read(fields, original = {}, path = 'statusEffect') {
            const effect = structuredClone(original);
            for (const key of ['name', 'description']) {
                if (!fields[key]) continue;
                const value = scalar(fields[key]);
                if (value) effect[key] = value;
                else delete effect[key];
            }
            if (fields.duration) {
                const value = scalar(fields.duration);
                if (value) effect.duration = Number.isFinite(Number(value)) ? Number(value) : value;
                else delete effect.duration;
            }
            if (fields.maxHealthPercent) {
                if (fields.maxHealthPercent.validity.badInput) throw new Error(`${path}.maxHealthPercent must be a finite percentage. Enter a signed number or clear the field.`);
                const value = scalar(fields.maxHealthPercent);
                if (!value) delete effect.maxHealthPercent;
                else {
                    const numeric = Number(value);
                    if (!Number.isFinite(numeric)) throw new Error(`${path}.maxHealthPercent must be a finite percentage. Enter a signed number or clear the field.`);
                    effect.maxHealthPercent = numeric;
                }
            }
            return effect;
        }
    };

    class ModifierEditor {
        constructor({ getOptions, normalizeNeedBarKey = value => value, allowNeedBars = false, allowNeedBarMaximums = true } = {}) {
            if (typeof getOptions !== 'function') throw new TypeError('ModifierEditor requires a getOptions function.');
            this.getOptions = getOptions;
            this.normalizeNeedBarKey = normalizeNeedBarKey;
            this.allowNeedBars = allowNeedBars;
            this.allowNeedBarMaximums = allowNeedBarMaximums;
            this.bindings = new WeakMap();
            this.rowListeners = new WeakMap();
        }

        buildOptions(select) {
            const document = select.ownerDocument;
            select.replaceChildren();
            const blank = document.createElement('option');
            blank.value = '';
            blank.textContent = this.allowNeedBars ? 'Select attribute, skill, or need bar' : 'Select attribute or skill';
            select.append(blank);
            const options = this.getOptions();
            for (const [key, label, prefix] of [['attributes', 'Attributes', 'attr'], ['skills', 'Skills', 'skill'], ...(this.allowNeedBars ? [['needBars', 'Need Bars (per minute)', 'need']] : []), ...(this.allowNeedBarMaximums ? [['needBars', 'Maximum Need Capacity (%)', 'needmax']] : [])]) {
                const values = options[key] || [];
                if (!Array.isArray(values)) throw new TypeError(`ModifierEditor options.${key} must be an array.`);
                if (!values.length) continue;
                const group = document.createElement('optgroup');
                group.label = label;
                for (const entry of values) {
                    if (prefix === 'needmax' && String(entry.key).toLowerCase() === 'health') continue;
                    const option = document.createElement('option');
                    option.value = `${prefix}:${entry.key}`;
                    option.textContent = entry.label || entry.key;
                    group.append(option);
                }
                select.append(group);
            }
        }

        createRow(initial = null, document = window.document) {
            const row = document.createElement('div');
            row.className = 'thing-modifier-row';
            const targetField = widgets().createField({ document, label: 'Modifier target', type: 'select', className: 'form-group thing-modifier-field thing-modifier-target-field', inputClass: 'thing-modifier-select' });
            const select = targetField.input;
            this.buildOptions(select);
            const fixedField = widgets().createField({ document, label: 'Fixed modifier', type: 'number', className: 'form-group thing-modifier-field', inputClass: 'thing-modifier-value', step: 'any', placeholder: 'Fixed +/-' });
            const input = fixedField.input;
            const percentField = widgets().createField({ document, label: 'Percentage modifier', type: 'number', className: 'form-group thing-modifier-field', inputClass: 'thing-modifier-percent', step: 'any', placeholder: 'Percent +/-' });
            const percent = percentField.input;
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'npc-edit-remove-btn';
            remove.textContent = 'Remove';
            remove.dataset.repeaterAction = 'remove';
            row.append(targetField.field, fixedField.field, percentField.field, remove);
            let selection = '';
            if (initial?.attribute) selection = `attr:${initial.attribute}`;
            else if (initial?.skill) selection = `skill:${initial.skill}`;
            else if (initial?.name && initial.needBarMaximum && this.allowNeedBarMaximums) selection = `needmax:${this.normalizeNeedBarKey(initial.name)}`;
            else if (initial?.name && this.allowNeedBars) selection = `need:${this.normalizeNeedBarKey(initial.name)}`;
            if (selection && !Array.from(select.options).some(option => option.value === selection)) {
                const unavailable = document.createElement('option');
                unavailable.value = selection;
                unavailable.textContent = `${selection.slice(selection.indexOf(':') + 1)} (unavailable)`;
                unavailable.dataset.unavailable = 'true';
                select.append(unavailable);
            }
            select.value = selection;
            if (Number.isFinite(initial?.modifier)) input.value = initial.modifier;
            else if (Number.isFinite(initial?.delta)) input.value = initial.delta;
            if (Number.isFinite(initial?.percentModifier ?? initial?.percentDelta)) percent.value = initial.percentModifier ?? initial.percentDelta;
            const syncPercent = () => {
                const rate = select.value.startsWith('need:');
                const maximum = select.value.startsWith('needmax:');
                input.disabled = maximum;
                fixedField.field.hidden = maximum;
                fixedField.field.querySelector('label').textContent = rate ? 'Fixed units per minute' : 'Fixed modifier';
                percentField.field.querySelector('label').textContent = rate ? 'Percentage points per minute' : maximum ? 'Maximum capacity change (%)' : 'Percentage modifier';
                percent.hidden = false;
                percentField.field.hidden = false;
                percent.disabled = false;
            };
            const listeners = new document.defaultView.AbortController();
            select.addEventListener('change', syncPercent, { signal: listeners.signal });
            this.rowListeners.set(row, listeners);
            syncPercent();
            return row;
        }

        bind(root) {
            let binding = this.bindings.get(root);
            if (!binding) {
                binding = new (widgets().Repeater)(root, {
                    onChange: ({ action, row }) => {
                        if (action === 'remove') this.releaseRow(row);
                    }
                });
                this.bindings.set(root, binding);
            }
            return binding;
        }

        releaseRow(row) {
            this.rowListeners.get(row)?.abort();
            this.rowListeners.delete(row);
        }

        add(root, initial = null) {
            return this.bind(root).add(this.createRow(initial, root.ownerDocument), { notify: false });
        }

        renderList(root, entries = []) {
            if (!Array.isArray(entries)) throw new TypeError('ModifierEditor entries must be an array.');
            this.clear(root);
            (entries.length ? entries : [null]).forEach(entry => this.add(root, entry));
        }

        collect(root, path = 'modifiers') {
            const result = { attributes: [], skills: [], ...(this.allowNeedBars ? { needBars: [] } : {}), ...(this.allowNeedBarMaximums ? { needBarMaximums: [] } : {}) };
            Array.from(root.children).forEach((row, index) => {
                const rowPath = `${path}[${index}]`;
                for (const selector of ['.thing-modifier-value', '.thing-modifier-percent']) {
                    const input = row.querySelector(selector);
                    if (!input.disabled && input.validity.badInput) throw new Error(`${rowPath} modifier and percentage must be finite numbers. Enter signed numbers or clear the unused field.`);
                }
                const selection = row.querySelector('.thing-modifier-select').value;
                const fixedInput = row.querySelector('.thing-modifier-value');
                const fixedRaw = fixedInput.disabled ? '' : scalar(fixedInput);
                const percentageRaw = scalar(row.querySelector('.thing-modifier-percent'));
                if (!selection && !fixedRaw && !percentageRaw) return;
                const divider = selection.indexOf(':');
                const type = selection.slice(0, divider);
                const key = selection.slice(divider + 1);
                if (!selection || divider < 1 || !key) throw new Error(`${rowPath}.target is required. Select an attribute, skill${this.allowNeedBars ? ', or need bar' : ''}, or remove this row.`);
                const fixed = fixedRaw ? Number(fixedRaw) : null;
                const percentage = percentageRaw ? Number(percentageRaw) : null;
                if (type === 'need' && this.allowNeedBars) {
                    if (fixed === null && percentage === null) throw new Error(`${rowPath} requires delta or percentDelta. Enter a fixed units-per-minute amount, a percentage rate, or both.`);
                    if ((fixed !== null && !Number.isFinite(fixed)) || (percentage !== null && !Number.isFinite(percentage))) throw new Error(`${rowPath}.delta and percentDelta must be finite numbers. Enter signed numbers or clear the unused component.`);
                    result.needBars.push({ name: key, delta: fixed ?? 0, ...(percentage === null ? {} : { percentDelta: percentage }) });
                    return;
                }
                if (type === 'needmax' && this.allowNeedBarMaximums) {
                    if (percentage === null || !Number.isFinite(percentage)) throw new Error(`${rowPath}.percentModifier requires a finite percentage. Enter a signed maximum capacity change, or remove this row.`);
                    result.needBarMaximums.push({ name: key, percentModifier: percentage });
                    return;
                }
                if (!['attr', 'skill'].includes(type)) throw new Error(`${rowPath}.target has unsupported kind "${type}". Select an attribute or skill${this.allowNeedBars ? ' or a need bar' : ''}.`);
                if (fixed === null && percentage === null) throw new Error(`${rowPath} requires a fixed modifier, a percentage modifier, or both. Enter a signed number or remove this row.`);
                if ((fixed !== null && !Number.isFinite(fixed)) || (percentage !== null && !Number.isFinite(percentage))) throw new Error(`${rowPath} modifier and percentage must be finite numbers. Enter signed numbers or clear the unused field.`);
                result[type === 'attr' ? 'attributes' : 'skills'].push({
                    [type === 'attr' ? 'attribute' : 'skill']: key,
                    ...(fixed !== null ? { modifier: fixed } : {}),
                    ...(percentage !== null ? { percentModifier: percentage } : {})
                });
            });
            return result;
        }

        clear(root) {
            Array.from(root.children).forEach(row => this.releaseRow(row));
            this.bind(root).clear();
        }

        destroy(root) {
            Array.from(root.children).forEach(row => this.releaseRow(row));
            this.bindings.get(root)?.destroy();
            this.bindings.delete(root);
        }
    }

    class StatusEffectEditor {
        constructor(root, { modifiers, editableName = false } = {}) {
            if (!(modifiers instanceof ModifierEditor)) throw new TypeError('StatusEffectEditor requires a ModifierEditor.');
            this.root = root;
            this.modifiers = modifiers;
            this.editableName = editableName;
            this.rows = new Map();
            this.destroyed = false;
            this.repeater = new (widgets().Repeater)(root, {
                onChange: ({ action, row }) => {
                    if (action === 'remove') this.releaseRow(row);
                }
            });
        }

        assertAlive() {
            if (this.destroyed) throw new Error('StatusEffectEditor has been destroyed. Create a new instance to remount.');
        }

        add(effect = {}) {
            this.assertAlive();
            validateEffect(effect);
            const document = this.root.ownerDocument;
            const row = document.createElement('div');
            row.className = 'thing-edit-row thing-edit-status-row';
            row.__statusEffectData = structuredClone(effect);
            const fields = {};
            const input = (key, type, className, label, placeholder = label) => {
                const field = widgets().createField({ document, label, type, className: `form-group status-effect-field status-effect-field--${key}`, inputClass: className, rows: 2 });
                field.input.placeholder = placeholder;
                field.input.setAttribute('aria-label', placeholder);
                fields[key] = field.input;
                return field.field;
            };
            if (this.editableName) {
                const name = input('name', 'text', 'thing-edit-status-name', 'Name (optional)');
                fields.name.autocomplete = 'off';
                row.append(name);
            }
            row.append(input('description', 'textarea', 'thing-edit-status-description', 'Description'));
            row.append(input('duration', 'text', 'thing-edit-status-duration', 'Duration', 'e.g. 4 hours, 15 minutes or 1d11h30m'));
            const maxHealth = widgets().createField({ document, label: 'Maximum health bonus (%)', className: 'form-group status-effect-field status-effect-field--max-health', inputClass: 'thing-edit-status-max-health-percent', type: 'number', step: 'any' });
            fields.maxHealthPercent = maxHealth.input;
            row.append(maxHealth.field);
            StatusEffectFields.populate(fields, {
                ...effect,
                description: effect.description || effect.text || (this.editableName ? '' : effect.name) || ''
            });
            const modifierRoot = document.createElement('div');
            modifierRoot.className = 'thing-modifier-list';
            const add = document.createElement('button');
            add.type = 'button';
            add.className = 'npc-edit-add-btn';
            add.textContent = 'Add Modifier';
            const listeners = new document.defaultView.AbortController();
            add.addEventListener('click', () => this.modifiers.add(modifierRoot), { signal: listeners.signal });
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'npc-edit-remove-btn';
            remove.textContent = 'Remove';
            remove.dataset.repeaterAction = 'remove';
            row.append(modifierRoot, add, remove);
            this.rows.set(row, { fields, modifierRoot, listeners });
            this.repeater.add(row, { notify: false });
            this.modifiers.renderList(modifierRoot, [
                ...(effect.attributes || []).map(entry => ({ attribute: entry.attribute || entry.name, modifier: entry.modifier, percentModifier: entry.percentModifier })),
                ...(effect.skills || []).map(entry => ({ skill: entry.skill || entry.name, modifier: entry.modifier, percentModifier: entry.percentModifier })),
                ...(this.modifiers.allowNeedBars ? (effect.needBars || []).map(entry => ({ name: entry.name || entry.bar, delta: entry.delta, percentDelta: entry.percentDelta })) : []),
                ...(this.modifiers.allowNeedBarMaximums ? (effect.needBarMaximums || []).map(entry => ({ name: entry.name, percentModifier: entry.percentModifier, needBarMaximum: true })) : [])
            ]);
            return row;
        }

        render(effects = []) {
            this.assertAlive();
            if (!Array.isArray(effects)) throw new TypeError('StatusEffectEditor effects must be an array.');
            effects.forEach((effect, index) => validateEffect(effect, `statusEffects[${index}]`));
            this.clear();
            (effects.length ? effects : [{}]).forEach(effect => this.add(effect));
        }

        collect() {
            this.assertAlive();
            const effects = [];
            Array.from(this.root.children).forEach((row, index) => {
                const { fields, modifierRoot } = this.rows.get(row);
                const description = scalar(fields.description);
                const name = fields.name ? scalar(fields.name) : '';
                if (!description && !(this.editableName && name)) return;
                const path = `statusEffects[${index}]`;
                const effect = StatusEffectFields.read(fields, row.__statusEffectData, path);
                effect.description = description || name;
                Object.assign(effect, this.modifiers.collect(modifierRoot, `${path}.modifiers`));
                effects.push(effect);
            });
            return effects;
        }

        releaseRow(row) {
            const data = this.rows.get(row);
            if (!data) return;
            data.listeners.abort();
            this.modifiers.destroy(data.modifierRoot);
            this.rows.delete(row);
        }

        clear() {
            this.assertAlive();
            Array.from(this.rows.keys()).forEach(row => this.releaseRow(row));
            this.repeater.clear();
        }

        destroy() {
            if (this.destroyed) return;
            this.clear();
            this.repeater.destroy();
            this.root = this.modifiers = this.repeater = this.rows = null;
            this.destroyed = true;
        }
    }

    Object.assign(window, { ModifierEditor, StatusEffectEditor, StatusEffectFields });
})();
