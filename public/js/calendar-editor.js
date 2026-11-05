(() => {
    'use strict';
    let nextSeasonId = 1;
    const specifications = {
        months: [
            ['name', 'Name', 'month-name'],
            ['lengthDays', 'Length Days', 'month-length', { type: 'number' }],
            ['seasonName', 'Season', 'month-season']
        ],
        weekdays: [['name', 'Weekday', 'weekday-name']],
        times: [
            ['timeOfDay', 'Time', 'time-of-day', { type: 'number', step: '0.25', placeholder: '6' }],
            ['description', 'Light Description', 'time-description', { textarea: true, rows: 2, wide: true }]
        ],
        seasons: [
            ['name', 'Name', 'season-name'],
            ['startMonth', 'Start Month', 'season-start-month'],
            ['startDay', 'Start Day', 'season-start-day', { type: 'number' }],
            ['dayLengthMinutes', 'Day Length Minutes', 'season-day-length', { type: 'number', placeholder: 'Optional' }],
            ['description', 'Description', 'season-description', { textarea: true, wide: true }],
            ['vegetationDescription', 'Vegetation Description', 'season-vegetation-description', { textarea: true, wide: true, placeholder: 'Two sentences describing visible seasonal vegetation changes.' }],
            ['interiorDescription', 'Interior Description', 'season-interior-description', { textarea: true, wide: true, placeholder: 'Two sentences describing visible seasonal changes inside enclosed spaces.' }]
        ],
        holidays: [
            ['name', 'Name', 'holiday-name'],
            ['month', 'Month', 'holiday-month'],
            ['day', 'Day', 'holiday-day', { type: 'number', placeholder: 'Optional' }],
            ['description', 'Description', 'holiday-description', { textarea: true, rows: 2, wide: true }]
        ]
    };
    const singular = { months: 'month', weekdays: 'weekday', seasons: 'season', holidays: 'holiday', times: 'time' };

    function validateRow(kind, value, path = `calendar.${kind}`) {
        if (kind === 'weekdays' ? typeof value !== 'string' : !value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${path} requires ${kind === 'weekdays' ? 'a weekday name string' : 'an object containing its calendar fields'}.`);
        if (kind === 'seasons' && value.timeDescriptions !== undefined) {
            if (!Array.isArray(value.timeDescriptions)) throw new TypeError(`${path}.timeDescriptions must be an array of time-description records. Supply an empty array when there are none.`);
            value.timeDescriptions.forEach((entry, index) => validateRow('times', entry, `${path}.timeDescriptions[${index}]`));
        }
    }

    /** Application calendar structure; hosts retain references, validation and commits. */
    class CalendarEditor {
        constructor({ yearInput, lists, prefix, createField, createActions, setupRow = null, onChange = null, onInput = null, seasonTabs = null, ensureSeason = false, ensureTime = false, layout = {} } = {}) {
            if (!yearInput?.ownerDocument || typeof prefix !== 'string' || !prefix || typeof createField !== 'function' || typeof createActions !== 'function') throw new TypeError('CalendarEditor requires yearInput, prefix, createField and createActions.');
            this.document = yearInput.ownerDocument;
            for (const kind of ['months', 'weekdays', 'seasons', 'holidays']) {
                if (!lists?.[kind] || lists[kind].ownerDocument !== this.document) throw new TypeError(`CalendarEditor lists.${kind} requires an element in the year input document.`);
            }
            Object.assign(this, { yearInput, lists, prefix, createField, createActions, setupRow, onChange, onInput, seasonTabs, ensureSeason, ensureTime, layout });
            this.rows = new Map();
            this.repeaters = new Map();
            this.tabs = null;
            this.activeSeason = null;
            this.destroyed = false;
            for (const [kind, root] of Object.entries(lists)) this.bind(root, kind);
        }

        assertAlive() {
            if (this.destroyed) throw new Error('CalendarEditor has been destroyed. Create a new instance to remount.');
        }

        bind(root, kind) {
            let repeater = this.repeaters.get(root);
            if (!repeater) {
                repeater = new window.AIRPG_WIDGETS.Repeater(root, {
                    onInput: event => this.onInput?.(event),
                    onChange: change => {
                        const oldIndex = this.rows.get(change.row)?.index;
                        if (change.action === 'remove') this.releaseRow(change.row);
                        if (kind === 'seasons') {
                            if (!root.children.length && this.ensureSeason) this.add('seasons', {}, { notify: false });
                            const preferred = change.action === 'remove'
                                ? root.children[oldIndex > 0 ? oldIndex - 1 : 0]
                                : change.row;
                            this.refreshSeasonTabs(preferred);
                        }
                        this.onChange?.({ kind, ...change });
                    }
                });
                this.repeaters.set(root, repeater);
            }
            return repeater;
        }

        add(kind, value, { root = this.lists[kind], focus = false, notify = true } = {}) {
            this.assertAlive();
            if (!specifications[kind]) throw new Error(`Unknown calendar row kind "${kind}". Use months, weekdays, seasons, holidays or times.`);
            if (!root) throw new Error(`Calendar ${kind} rows require a list root.`);
            const entry = value === undefined ? (kind === 'weekdays' ? '' : {}) : value;
            validateRow(kind, entry);
            const data = kind === 'weekdays' ? { name: entry } : entry;
            const row = this.document.createElement(kind === 'seasons' && this.seasonTabs ? 'section' : 'div');
            row.className = kind === 'seasons' && this.seasonTabs
                ? `${this.prefix}-season-panel`
                : `${this.prefix}-row ${this.prefix}-${singular[kind]}-row`;
            const fields = {};
            const pieces = {};
            const listeners = new this.document.defaultView.AbortController();
            for (const [key, defaultLabel, suffix, options = {}] of specifications[kind]) {
                const label = this.layout.labels?.[`${kind}.${key}`] || defaultLabel;
                const fieldOptions = {
                    ...options,
                    signal: listeners.signal,
                    ...(options.textarea ? { rows: options.rows || this.layout.textareaRows || 2 } : {}),
                    ...(options.wide ? { fieldClass: kind === 'times' && this.layout.timeDescriptionClass ? this.layout.timeDescriptionClass : `${this.prefix}-field-wide` } : {})
                };
                let initial = data[key];
                if (initial === undefined || initial === null) initial = key === 'startDay' ? 1 : '';
                const field = this.createField(kind, key, label, `${this.prefix}-${suffix}`, initial, fieldOptions);
                const view = this.document.defaultView;
                if (!(field?.field instanceof view.HTMLElement) || field.field.ownerDocument !== this.document || !(field.input instanceof view.HTMLElement) || field.input.ownerDocument !== this.document) throw new TypeError(`Calendar ${kind}.${key} field factory must return {field, input} native elements in the editor document.`);
                fields[key] = field.input;
                pieces[key] = field.field;
            }
            const order = this.layout.order?.[kind] || specifications[kind].map(([key]) => key);
            const record = { kind, fields, listeners, index: root.children.length, timeRoot: null };
            this.rows.set(row, record);
            const actions = this.createActions(kind);
            if (!(actions instanceof this.document.defaultView.HTMLElement) || actions.ownerDocument !== this.document) throw new TypeError(`Calendar ${kind} actions factory must return a native element in the editor document.`);
            if (kind === 'seasons') {
                const basics = this.document.createElement('div');
                basics.className = `${this.prefix}-season-basics`;
                basics.append(...order.map(key => pieces[key]));
                if (this.seasonTabs) {
                    const header = this.document.createElement('div');
                    header.className = `${this.prefix}-season-panel-header`;
                    const title = this.document.createElement('h4');
                    title.textContent = data.name || `Season ${root.children.length + 1}`;
                    actions.className = `${this.prefix}-season-actions`;
                    header.append(title, actions);
                    row.append(header);
                    record.title = title;
                    record.tabId = `calendar-season-${nextSeasonId++}`;
                    fields.name.addEventListener('input', () => this.updateSeasonLabels(), { signal: listeners.signal });
                }
                const timeSection = this.document.createElement(this.layout.timeSectionTag || 'div');
                timeSection.className = `${this.prefix}-time-section`;
                const header = this.document.createElement('div');
                header.className = this.layout.timeHeaderClass || `${this.prefix}-time-header`;
                const heading = this.document.createElement(this.layout.timeHeadingTag || 'h4');
                heading.textContent = this.layout.timeHeading || 'Light Descriptions';
                const add = this.document.createElement('button');
                add.type = 'button';
                add.className = this.layout.addTimeClass || 'btn btn-secondary small';
                add.textContent = 'Add Time';
                const timeRoot = this.document.createElement('div');
                timeRoot.className = `${this.prefix}-list ${this.prefix}-time-list`;
                record.timeRoot = timeRoot;
                this.bind(timeRoot, 'times');
                add.addEventListener('click', () => this.add('times', { timeOfDay: 0, description: '' }, { root: timeRoot, focus: true }), { signal: listeners.signal });
                header.append(heading, add);
                timeSection.append(header, timeRoot);
                row.append(basics, timeSection);
                if (!this.seasonTabs) row.append(actions);
                const times = data.timeDescriptions || [];
                if (!Array.isArray(times)) throw new TypeError('Calendar season.timeDescriptions must be an array.');
                const entries = times.length || !this.ensureTime ? times : [{ timeOfDay: 0, description: '' }];
                entries.forEach(entry => this.add('times', entry, { root: timeRoot, notify: false }));
            } else {
                row.append(...order.map(key => pieces[key]), actions);
            }
            this.bind(root, kind).add(row, { notify: false });
            this.setupRow?.(kind, row, fields, data, listeners.signal);
            if (kind === 'seasons') this.refreshSeasonTabs(row);
            if (focus) fields[specifications[kind][0][0]].focus();
            if (notify) this.onChange?.({ kind, action: 'add', row });
            return row;
        }

        updateSeasonLabels() {
            if (!this.seasonTabs) return;
            Array.from(this.lists.seasons.children).forEach((row, index) => {
                const data = this.rows.get(row);
                const label = data.fields.name.value.trim() || `Season ${index + 1}`;
                data.title.textContent = label;
                data.tab.textContent = label;
            });
        }

        refreshSeasonTabs(preferred = this.activeSeason) {
            if (!this.seasonTabs) return;
            this.tabs?.destroy();
            this.tabs = null;
            this.seasonTabs.replaceChildren();
            const rows = Array.from(this.lists.seasons.children);
            if (!rows.length) {
                this.activeSeason = null;
                return;
            }
            const selected = rows.includes(preferred) ? preferred : rows[0];
            const tabs = rows.map((row, index) => {
                const data = this.rows.get(row);
                data.index = index;
                const button = this.document.createElement('button');
                button.type = 'button';
                button.className = `${this.prefix}-season-tab`;
                button.dataset.seasonIndex = String(index);
                row.dataset.seasonIndex = String(index);
                if (this.layout.seasonIdPrefix) {
                    button.id = `${this.layout.seasonIdPrefix}Tab${index}`;
                    row.id = `${this.layout.seasonIdPrefix}Panel${index}`;
                }
                button.textContent = data.fields.name.value.trim() || `Season ${index + 1}`;
                data.title.textContent = button.textContent;
                data.tab = button;
                this.seasonTabs.append(button);
                return { id: data.tabId, button, panel: row };
            });
            this.activeSeason = selected;
            this.tabs = new window.AIRPG_WIDGETS.Tabs({
                tabs,
                initialId: this.rows.get(selected).tabId,
                activeClass: 'is-active',
                onChange: id => { this.activeSeason = rows.find(row => this.rows.get(row).tabId === id); }
            });
        }

        selectSeason(index) {
            this.assertAlive();
            const row = this.lists.seasons.children[index];
            if (!row) throw new Error(`Calendar season index ${index} does not exist. Select a displayed season.`);
            this.activeSeason = row;
            this.tabs.activate(this.rows.get(row).tabId);
        }

        readRow(row) {
            const data = this.rows.get(row);
            const result = Object.fromEntries(Object.entries(data.fields).map(([key, input]) => [key, input.value.trim()]));
            if (data.kind === 'weekdays') return result.name;
            if (data.kind === 'seasons') result.timeDescriptions = Array.from(data.timeRoot.children, child => this.readRow(child));
            return result;
        }

        readDraft() {
            this.assertAlive();
            return {
                yearName: this.yearInput.value.trim(),
                ...Object.fromEntries(Object.entries(this.lists).map(([kind, root]) => [kind, Array.from(root.children, row => this.readRow(row))]))
            };
        }

        load(definition = null) {
            this.assertAlive();
            if (definition !== null && (typeof definition !== 'object' || Array.isArray(definition))) throw new TypeError('CalendarEditor definition must be an object or null.');
            for (const kind of Object.keys(this.lists)) {
                if (definition?.[kind] !== undefined && !Array.isArray(definition[kind])) throw new TypeError(`Calendar definition.${kind} must be an array.`);
                (definition?.[kind] || []).forEach((entry, index) => validateRow(kind, entry, `calendar.${kind}[${index}]`));
            }
            this.clear();
            this.yearInput.value = definition?.yearName || '';
            for (const kind of ['seasons', 'months', 'weekdays', 'holidays']) {
                const entries = definition?.[kind] || [];
                if (kind === 'seasons' && !entries.length && this.ensureSeason) this.add(kind, {}, { notify: false });
                else entries.forEach(entry => this.add(kind, entry, { notify: false }));
            }
            this.refreshSeasonTabs(this.lists.seasons.firstElementChild);
        }

        releaseRow(row) {
            const data = this.rows.get(row);
            if (!data) return;
            data.listeners.abort();
            if (data.timeRoot) {
                Array.from(data.timeRoot.children).forEach(child => this.releaseRow(child));
                this.repeaters.get(data.timeRoot).destroy();
                this.repeaters.delete(data.timeRoot);
            }
            this.rows.delete(row);
        }

        clear() {
            this.assertAlive();
            this.tabs?.destroy();
            this.tabs = null;
            this.seasonTabs?.replaceChildren();
            this.activeSeason = null;
            for (const root of Object.values(this.lists)) {
                Array.from(root.children).forEach(row => this.releaseRow(row));
                this.repeaters.get(root).clear();
            }
        }

        destroy() {
            if (this.destroyed) return;
            this.clear();
            this.repeaters.forEach(repeater => repeater.destroy());
            this.repeaters.clear();
            this.rows.clear();
            this.yearInput = this.lists = this.document = this.createField = this.createActions = this.setupRow = this.onChange = this.onInput = this.seasonTabs = this.layout = null;
            this.destroyed = true;
        }
    }
    window.CalendarEditor = CalendarEditor;
})();
