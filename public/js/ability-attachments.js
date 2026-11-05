(() => {
    'use strict';

    const copy = value => structuredClone(value);
    const element = (tag, className = '', text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    };
    const action = (text, callback, className = 'btn btn-secondary') => {
        const button = element('button', className, text);
        button.type = 'button';
        button.addEventListener('click', callback);
        return button;
    };
    const field = (parent, labelText, value = '', type = 'text') => {
        const label = element('label', 'form-group');
        label.append(element('span', '', labelText));
        const control = element(type === 'textarea' ? 'textarea' : 'input');
        if (type !== 'textarea') control.type = type;
        if (type === 'number') control.step = 'any';
        control.value = value ?? '';
        label.append(control);
        parent.append(label);
        return control;
    };
    const select = (parent, labelText, options, value) => {
        const label = element('label', 'form-group');
        label.append(element('span', '', labelText));
        const control = element('select');
        for (const [optionValue, optionLabel] of options) {
            const option = element('option', '', optionLabel);
            option.value = optionValue;
            control.append(option);
        }
        control.value = value ?? '';
        label.append(control);
        parent.append(label);
        return control;
    };
    const number = (control, label) => {
        if (control.value.trim() === '' || !Number.isFinite(Number(control.value))) throw new Error(`${label} must be a finite number.`);
        return Number(control.value);
    };
    const text = (control, label) => {
        const value = control.value.trim();
        if (!value) throw new Error(`${label} is required.`);
        return value;
    };
    async function request(url, body, method = 'GET') {
        const response = await fetch(url, {
            method,
            ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        });
        const result = await response.json();
        if (!response.ok || result.success === false) {
            const error = new Error(result.error || `Attachment request failed: HTTP ${response.status}.`);
            if (result.stack) error.stack = result.stack;
            throw error;
        }
        return result;
    }

    function modifiers(parent, title, values, identity, magnitude) {
        const group = element('fieldset', 'ability-attachments-subsection');
        group.append(element('legend', '', title));
        const list = element('div', 'ability-attachments-list');
        group.append(list);
        parent.append(group);
        const rows = new Map();
        function add(value = {}) {
            const row = element('div', 'ability-attachments-modifier');
            const name = field(row, identity === 'attribute' ? 'Attribute' : 'Skill', value[identity] || '');
            const amount = field(row, 'Fixed modifier', value[magnitude] ?? '', 'number');
            const percent = field(row, 'Percent modifier (%)', value.percentModifier ?? '', 'number');
            row.append(action('Remove', () => { rows.delete(row); row.remove(); }));
            list.append(row);
            rows.set(row, () => {
                if (!amount.value.trim() && !percent.value.trim()) throw new Error(`${identity} modifier requires a fixed or percentage value.`);
                return { [identity]: text(name, identity), ...(amount.value.trim() ? { [magnitude]: number(amount, 'Fixed modifier') } : {}), ...(percent.value.trim() ? { percentModifier: number(percent, 'Percent modifier') } : {}) };
            });
        }
        for (const value of values || []) add(value);
        group.append(action(`Add ${identity} modifier`, () => add()));
        return () => [...rows.values()].map(read => read());
    }

    function techniqueEntry(parent, value, context, remove) {
        const row = element('fieldset', 'ability-attachments-technique');
        row.append(element('legend', '', 'Granted technique'));
        const mode = select(row, 'Technique source', [['existing', 'Existing world technique'], ['new', 'New world technique']], value?.candidate ? 'new' : 'existing');
        const body = element('div');
        row.append(body, action('Remove technique', remove));
        parent.append(row);
        let readBody;
        function render() {
            body.replaceChildren();
            if (mode.value === 'existing') {
                const catalogue = context.catalog || [];
                const entries = catalogue.map(entry => [entry.id, `${entry.name} · ${entry.id}`]);
                if (value?.techniqueId && !catalogue.some(entry => entry.id === value.techniqueId)) {
                    entries.unshift([value.techniqueId, `Unknown technique · ${value.techniqueId}`]);
                }
                entries.unshift(['', 'Choose a technique…']);
                const technique = select(body, 'World technique', entries, value?.techniqueId || '');
                const revision = field(body, 'Definition revision', value?.definitionRevision ?? '', 'number');
                const hint = element('p', 'npc-edit-hint', 'Leave revision blank to use the latest saved definition.');
                body.append(hint);
                readBody = () => ({ techniqueId: text(technique, 'World technique'), ...(revision.value.trim() ? { definitionRevision: number(revision, 'Definition revision') } : {}) });
                return;
            }
            const candidate = value?.candidate || {};
            const name = field(body, 'Technique name', candidate.name || '');
            const description = field(body, 'Description', candidate.description || '', 'textarea');
            const semanticKey = field(body, 'Semantic identity', candidate.semanticKey || '');
            const aliases = field(body, 'Aliases (one per line)', (candidate.aliases || []).join('\n'), 'textarea');
            const uniqueLabel = element('label', 'techniques-checkbox');
            const unique = element('input');
            unique.type = 'checkbox';
            unique.checked = candidate.unique === true;
            uniqueLabel.append(unique, document.createTextNode('Unique technique'));
            body.append(uniqueLabel);

            const disciplineOptions = [['', 'Choose a discipline…'], ...context.disciplines.map(entry => [entry.id, `${entry.name} · ${entry.id}`]), ['__new__', 'Create a new discipline…']];
            const discipline = select(body, 'Discipline', disciplineOptions, value?.candidateDiscipline ? '__new__' : candidate.disciplineId || '');
            const disciplineFields = element('div');
            body.append(disciplineFields);
            let readDiscipline;
            function renderDiscipline() {
                disciplineFields.replaceChildren();
                if (discipline.value !== '__new__') { readDiscipline = () => undefined; return; }
                const source = value?.candidateDiscipline || {};
                const disciplineName = field(disciplineFields, 'New discipline name', source.name || '');
                const disciplineDescription = field(disciplineFields, 'New discipline description', source.description || '', 'textarea');
                const publicLabel = element('label', 'techniques-checkbox');
                const publicAccess = element('input');
                publicAccess.type = 'checkbox';
                publicAccess.checked = source.publicAccess === true;
                publicLabel.append(publicAccess, document.createTextNode('Public access'));
                disciplineFields.append(publicLabel);
                const readRequirements = window.TechniqueMechanicsEditor.requirementsEditor(disciplineFields, 'Discipline access requirements', source.accessRequirements || []);
                readDiscipline = () => ({ name: text(disciplineName, 'Discipline name'), description: text(disciplineDescription, 'Discipline description'), publicAccess: publicAccess.checked, accessRequirements: readRequirements() });
            }
            discipline.addEventListener('change', renderDiscipline);
            renderDiscipline();

            const revision = candidate.revisions?.[0] || { revision: 1, target: { kind: 'self', allowDead: false }, check: { kind: 'automatic' }, costs: [], effects: [], acquisitionRequirements: [], useRequirements: [] };
            let readRevision;
            if (revision.recipe) {
                const mechanics = element('div', 'ability-attachments-mechanics');
                body.append(mechanics);
                readRevision = window.TechniqueMechanicsEditor.recipeEditor(mechanics, revision, context);
            } else {
                const mechanics = element('div', 'ability-attachments-mechanics');
                body.append(mechanics);
                readRevision = window.TechniqueMechanicsEditor.editor(mechanics, revision, context.formulaVariables, context);
            }
            readBody = () => {
                const selectedDiscipline = text(discipline, 'Discipline');
                const candidateDiscipline = readDiscipline();
                return { candidate: { name: text(name, 'Technique name'), description: text(description, 'Technique description'), semanticKey: text(semanticKey, 'Semantic identity'), aliases: aliases.value.split(/\r?\n/).map(item => item.trim()).filter(Boolean), unique: unique.checked, ...(selectedDiscipline === '__new__' ? {} : { disciplineId: selectedDiscipline }), revisions: [readRevision()] }, ...(candidateDiscipline ? { candidateDiscipline } : {}) };
            };
        }
        mode.addEventListener('change', render);
        render();
        return { row, read: () => ({ ...(value?.id ? { id: value.id } : {}), ...(value?.provenance ? { provenance: copy(value.provenance) } : {}), ...readBody() }) };
    }

    function effectEditor(parent, effect, context, remove) {
        const row = element('fieldset', 'ability-attachments-effect');
        row.append(element('legend', '', 'Permanent effect'));
        const name = field(row, 'Effect name', effect.name || '');
        const description = field(row, 'Description', effect.description || '', 'textarea');
        const health = field(row, 'Maximum health bonus (%)', effect.maxHealthPercent ?? '', 'number');
        row.append(element('p', 'npc-edit-hint', 'For example, 20 grants +20% maximum health. Leave blank for no health change.'));
        const readAttributes = modifiers(row, 'Attribute modifiers', effect.attributes || [], 'attribute', 'modifier');
        const readSkills = modifiers(row, 'Skill modifiers', effect.skills || [], 'skill', 'modifier');
        const grants = element('fieldset', 'ability-attachments-subsection');
        grants.append(element('legend', '', 'Techniques granted by this effect'));
        const list = element('div', 'ability-attachments-list');
        grants.append(list);
        const entries = new Map();
        function add(value) {
            const entry = techniqueEntry(list, value, context, () => { entries.delete(entry.row); entry.row.remove(); });
            entries.set(entry.row, entry.read);
        }
        for (const value of effect.techniqueEntries || []) add(value);
        grants.append(action('Add technique', () => add({})));
        row.append(grants, action('Remove effect', remove));
        parent.append(row);
        return { row, read: () => ({ ...(effect.id ? { id: effect.id } : {}), name: text(name, 'Effect name'), description: text(description, 'Effect description'), duration: -1, attributes: readAttributes(), skills: readSkills(), ...(health.value.trim() ? { maxHealthPercent: number(health, 'Maximum health bonus') } : {}), techniqueEntries: [...entries.values()].map(read => read()) }) };
    }

    class AbilityAttachmentsEditor {
        static async open({ actorId, abilityId, trigger, onApplied }) {
            if (!actorId || !abilityId) throw new Error('Choose a saved ability before editing attachments.');
            if (!window.TechniqueMechanicsEditor) throw new Error('The structured technique editor is unavailable.');
            const path = `/api/players/${encodeURIComponent(actorId)}/abilities/${encodeURIComponent(abilityId)}/attachments`;
            const [baseline, techniques] = await Promise.all([
                request(path), request(`/api/techniques?actor=${encodeURIComponent(actorId)}&catalog=true`)
            ]);
            const context = techniques;
            const dialog = element('dialog', 'modal__dialog techniques-dialog ability-attachments-dialog');
            dialog.setAttribute('aria-label', `Edit attachments for ${baseline.ability?.name || 'ability'}`);
            const header = element('header', 'modal__header');
            header.append(element('h2', '', `${baseline.ability?.name || 'Ability'} · attachments`));
            const close = action('×', () => lifecycle.close(), 'modal__close');
            close.setAttribute('aria-label', 'Close attachment editor');
            header.append(close);
            const form = element('form', 'techniques-form ability-attachments-form');
            form.noValidate = true;
            const body = element('div', 'modal__body ability-attachments-body');
            body.append(element('p', 'npc-edit-hint', 'Permanent effects and their granted techniques belong to this ability. Generate replaces this editor draft; changes take effect only when you apply them.'));
            const generate = action('Generate attachments', async () => {
                try {
                    setPending(true, 'Generating a draft…');
                    const generated = await request(`${path}/generate`, {}, 'POST');
                    expected = generated.expected;
                    render(generated.draft);
                    status.textContent = 'Generated draft ready to review. Apply attachments to save it.';
                } catch (error) {
                    fail(error, generate);
                } finally { setPending(false); }
            });
            body.append(generate);
            const effects = element('div', 'ability-attachments-list');
            body.append(effects);
            const addEffect = action('Add permanent effect', () => add({ name: '', description: '', duration: -1, attributes: [], skills: [], techniqueEntries: [] }));
            body.append(addEffect);
            const status = element('p', 'ability-attachments-status');
            status.setAttribute('role', 'status');
            status.setAttribute('aria-live', 'polite');
            const footer = element('footer', 'modal__footer');
            const cancel = action('Cancel', () => lifecycle.close());
            const save = element('button', 'btn btn-primary', 'Apply attachments');
            save.type = 'submit';
            footer.append(cancel, save);
            form.append(body, status, footer);
            dialog.append(header, form);
            document.body.append(dialog);
            const lifecycle = new window.AIRPG_WIDGETS.NativeDialog(dialog, { returnFocus: trigger, removeOnClose: true });
            let expected = baseline.expected;
            let pending = false;
            let rows = new Map();
            function setPending(value, message = '') {
                pending = value;
                lifecycle.setPending(value);
                for (const control of dialog.querySelectorAll('button,input,textarea,select')) control.disabled = value;
                if (message) status.textContent = message;
            }
            function fail(error, returnFocus) {
                console.error('Ability attachment operation failed:', error);
                status.textContent = error.message;
                window.AIRPG_PAGE_FEEDBACK.showError(error, { returnFocus });
            }
            function add(effect) {
                const entry = effectEditor(effects, effect, context, () => { rows.delete(entry.row); entry.row.remove(); });
                rows.set(entry.row, entry.read);
            }
            function render(draft) {
                effects.replaceChildren();
                rows = new Map();
                for (const effect of draft.statusEffects || []) add(effect);
            }
            render(baseline.draft);
            form.addEventListener('submit', async event => {
                event.preventDefault();
                if (pending) return;
                try {
                    const draft = { statusEffects: [...rows.values()].map(read => read()) };
                    setPending(true, 'Applying attachments…');
                    const result = await request(path, { draft, expected }, 'PUT');
                    onApplied?.(result);
                    dialog.close();
                } catch (error) {
                    fail(error, save);
                } finally { if (dialog.open) setPending(false); }
            });
            lifecycle.open();
            return dialog;
        }
    }
    window.AbilityAttachmentsEditor = AbilityAttachmentsEditor;
})();
