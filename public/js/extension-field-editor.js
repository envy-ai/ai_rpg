(() => {
    'use strict';

    /** App-owned scalar mod descriptors; registry rules and special fields stay adapters. */
    class ExtensionFieldEditor {
        constructor(root, { idPrefix, inputClass, inputTypeFor, getValue = (record, field) => record[field.fieldName] } = {}) {
            if (!root?.ownerDocument || typeof idPrefix !== 'string' || typeof inputClass !== 'string' || typeof inputTypeFor !== 'function') throw new TypeError('ExtensionFieldEditor requires a root, idPrefix, inputClass and inputTypeFor callback.');
            Object.assign(this, { root, idPrefix, inputClass, inputTypeFor, getValue });
            this.fields = new Map();
            this.destroyed = false;
        }

        assertAlive() {
            if (this.destroyed) throw new Error('ExtensionFieldEditor has been destroyed. Create a new editor to remount.');
        }

        static formatValue(value, path = 'mod field') {
            if (value === undefined || value === null) return '';
            if (typeof value !== 'object') return String(value);
            const formatted = JSON.stringify(value);
            if (formatted === undefined) throw new TypeError(`${path} cannot be represented as JSON. Supply a serializable field value.`);
            return formatted;
        }

        static readValue(input, field) {
            const path = field.fieldName;
            const label = field.edit?.label || path;
            const type = typeof field.type === 'string' ? field.type.trim().toLowerCase() : 'string';
            if (type === 'boolean') return Boolean(input.checked);
            if (input.validity.badInput) throw new Error(`${path} (${label}) must contain a valid ${type}. Correct the value before saving.`);
            const value = input.value.trim();
            if (!value) return null;
            if (type === 'number' || type === 'integer') {
                const numeric = Number(value);
                if (type === 'integer' ? !Number.isInteger(numeric) : !Number.isFinite(numeric)) throw new Error(`${path} (${label}) must be ${type === 'integer' ? 'an integer' : 'a finite number'}. Enter a signed numeric value or clear this optional field.`);
                return numeric;
            }
            if (type === 'array' || type === 'object') {
                let parsed;
                try { parsed = JSON.parse(value); }
                catch (cause) { throw new Error(`${path} (${label}) must be a valid JSON ${type}. Correct the JSON syntax: ${cause.message}`, { cause }); }
                const valid = type === 'array' ? Array.isArray(parsed) : parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
                if (!valid) throw new Error(`${path} (${label}) must be a JSON ${type}. Supply ${type === 'array' ? 'an array, including [] for an empty array' : 'an object, including {} for an empty object'}, or clear this optional field.`);
                return parsed;
            }
            return value;
        }

        render(fields, record, { createSpecial = null } = {}) {
            this.assertAlive();
            if (!Array.isArray(fields)) throw new TypeError('ExtensionFieldEditor fields must be an array of registered descriptors.');
            const names = new Set();
            for (const field of fields) {
                if (typeof field?.fieldName !== 'string' || !field.fieldName.trim() || names.has(field.fieldName.trim())) throw new TypeError('ExtensionFieldEditor descriptors require unique nonempty fieldName values.');
                names.add(field.fieldName.trim());
            }
            this.clear();
            const document = this.root.ownerDocument;
            for (const field of fields) {
                const special = createSpecial?.(field, record);
                if (special !== null && special !== undefined) {
                    const view = document.defaultView;
                    if (!(special instanceof view.HTMLElement) || special.ownerDocument !== document) throw new TypeError(`${field.fieldName} special editor must return an element in the editor document.`);
                    this.root.append(special);
                    continue;
                }
                const fieldName = field.fieldName.trim();
                const edit = field.edit || {};
                const type = this.inputTypeFor(field);
                if (!['text', 'textarea', 'number', 'checkbox'].includes(type)) throw new Error(`${fieldName} has unsupported native input type "${type}". Use text, textarea, number or checkbox.`);
                const raw = this.getValue(record, field);
                const value = raw === undefined ? field.defaultValue : raw;
                const { field: wrapper, input } = window.AIRPG_WIDGETS.createField({
                    document,
                    label: edit.label || fieldName,
                    type,
                    id: `${this.idPrefix}${fieldName}`,
                    className: type === 'textarea' ? 'npc-edit-field npc-edit-field--wide' : 'npc-edit-field',
                    inputClass: this.inputClass,
                    value: ExtensionFieldEditor.formatValue(value, fieldName),
                    rows: 2,
                    placeholder: type === 'checkbox' ? '' : edit.placeholder || ''
                });
                if (type === 'checkbox') input.checked = Boolean(value);
                input.dataset.fieldName = fieldName;
                input.dataset.fieldType = field.type || 'string';
                if (edit.description) {
                    const hint = document.createElement('p');
                    hint.className = 'npc-edit-hint';
                    hint.textContent = edit.description;
                    wrapper.append(hint);
                }
                this.fields.set(fieldName, { input, descriptor: field });
                this.root.append(wrapper);
            }
        }

        collect() {
            this.assertAlive();
            const values = {};
            for (const [name, { input, descriptor }] of this.fields) {
                if (!this.root.contains(input)) throw new Error(`${name} input was removed from its extension editor. Render the registered fields again before saving.`);
                values[name] = ExtensionFieldEditor.readValue(input, descriptor);
            }
            return values;
        }

        clear() {
            this.assertAlive();
            window.AIRPG_WIDGETS.ReaderRows.destroyWithin(this.root);
            this.fields.clear();
            this.root.replaceChildren();
        }

        destroy() {
            if (this.destroyed) return;
            this.clear();
            this.root = this.fields = this.inputTypeFor = this.getValue = null;
            this.destroyed = true;
        }
    }

    window.ExtensionFieldEditor = ExtensionFieldEditor;
})();
