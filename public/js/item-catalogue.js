(function () {
    'use strict';

    const PAGE_SIZE = 60;
    const unclassified = '__unclassified__';
    const node = (tag, className = '', text) => {
        const element = document.createElement(tag);
        element.className = className;
        if (text !== undefined) element.textContent = String(text);
        return element;
    };
    const title = value => String(value).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
    const itemType = data => data.itemTypeDetail || data.type || '';

    class ItemCataloguePanel {
        constructor(root, { renderEffects, prepareEffects }) {
            this.root = root;
            this.renderEffects = renderEffects;
            this.prepareEffects = prepareEffects;
            this.controls = Object.fromEntries([
                'Search', 'Rarity', 'Type', 'Refresh', 'Status', 'Browser', 'List',
                'Detail', 'Back', 'Count', 'Previous', 'Next', 'Page'
            ].map(name => [name, root.querySelector(`#itemCatalogue${name}`)]));
            if (Object.values(this.controls).some(control => !control) || typeof renderEffects !== 'function' || typeof prepareEffects !== 'function') {
                throw new Error('Item Catalogue requires its native controls and shared effect renderer.');
            }
            this.disposed = false;
            this.listeners = new AbortController();
            const listenerOptions = { signal: this.listeners.signal };
            this.listView = new window.AIRPG_WIDGETS.CollectionView(this.controls.List);
            this.mode = 'definitions';
            this.data = null;
            this.entries = [];
            this.selectedId = null;
            this.variantRarity = null;
            this.page = 0;
            this.request = 0;
            this.abort = null;
            this.modeButtons = [...root.querySelectorAll('[data-catalogue-mode]')];
            for (const button of this.modeButtons) button.addEventListener('click', () => this.run(() => {
                this.mode = button.dataset.catalogueMode;
                this.selectedId = null;
                this.variantRarity = null;
                this.page = 0;
                this.root.classList.remove('is-detail-open');
                this.buildFilters();
                this.filter();
            }), listenerOptions);
            for (const name of ['Search', 'Rarity', 'Type']) this.controls[name].addEventListener(name === 'Search' ? 'input' : 'change', () => this.run(() => {
                this.page = 0;
                this.variantRarity = null;
                this.filter();
            }), listenerOptions);
            this.controls.Refresh.addEventListener('click', () => this.activate(), listenerOptions);
            this.controls.Previous.addEventListener('click', () => { this.page -= 1; this.run(() => this.renderList()); }, listenerOptions);
            this.controls.Next.addEventListener('click', () => { this.page += 1; this.run(() => this.renderList()); }, listenerOptions);
            this.controls.Back.addEventListener('click', () => this.back(), listenerOptions);
            root.addEventListener('keydown', event => {
                const editable = event.target.closest('input, textarea, select, [contenteditable="true"]');
                if (event.key === 'Escape' && !editable && this.selectedId) {
                    event.preventDefault();
                    this.back();
                }
            }, listenerOptions);
            document.addEventListener('keydown', event => {
                if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey
                    || event.target.closest('input, textarea, select, [contenteditable="true"]')
                    || document.querySelector('dialog[open], .modal:not([hidden])') || !this.visible()) return;
                event.preventDefault();
                this.root.classList.remove('is-detail-open');
                this.controls.Search.focus();
            }, listenerOptions);
            window.addEventListener('airpg:game-state-changed', () => {
                this.reset();
                if (this.visible()) this.activate();
            }, listenerOptions);
            window.addEventListener('pagehide', event => { if (!event.persisted) this.destroy(); }, listenerOptions);
        }

        visible() { return !this.disposed && !this.root.closest('[hidden]'); }

        run(action) {
            if (this.disposed) return;
            try { action(); }
            catch (error) { this.report(error); }
        }

        report(error) {
            if (this.disposed) return;
            console.error('Item Catalogue failed:', error);
            this.data = null;
            this.entries = [];
            this.selectedId = null;
            this.variantRarity = null;
            this.root.classList.remove('is-detail-open');
            this.listView.clear();
            this.clearDetail();
            this.controls.Status.textContent = `Could not display the catalogue: ${error.message}. Use Refresh to try again.`;
            this.controls.Browser.hidden = true;
            window.AIRPG_PAGE_FEEDBACK.showError(error, { returnFocus: this.controls.Refresh });
        }

        reset() {
            if (this.disposed) return;
            this.request += 1;
            this.abort?.abort();
            this.abort = null;
            this.data = null;
            this.entries = [];
            this.selectedId = null;
            this.variantRarity = null;
            this.page = 0;
            this.root.classList.remove('is-detail-open');
            this.listView.clear();
            this.clearDetail();
            this.controls.Browser.hidden = true;
            this.setLoading(false);
            this.controls.Status.textContent = 'Load or start a game to browse its item catalogue.';
        }

        async activate() {
            if (this.disposed) return;
            const request = ++this.request;
            this.abort?.abort();
            if (window.__AIRPG_GAME_LOADED__ !== true) { this.reset(); return; }
            const abort = new AbortController();
            this.abort = abort;
            this.setLoading(true);
            this.controls.Browser.hidden = true;
            this.controls.Status.textContent = 'Loading item catalogue…';
            try {
                const response = await fetch('/api/item-catalogue', { cache: 'no-store', signal: abort.signal });
                const data = await response.json();
                if (this.disposed || request !== this.request) return;
                if (!response.ok || data.success !== true) {
                    if (data.code === 'GAME_NOT_LOADED') { this.reset(); return; }
                    const error = new Error(data.error || `Item catalogue request failed (HTTP ${response.status}).`);
                    if (data.stack) error.stack = data.stack;
                    throw error;
                }
                this.validate(data);
                await this.prepareEffects(data, abort.signal);
                if (this.disposed || request !== this.request) return;
                if (this.data?.generation !== data.generation) {
                    this.selectedId = null;
                    this.variantRarity = null;
                    this.page = 0;
                    this.root.classList.remove('is-detail-open');
                }
                this.data = data;
                this.buildFilters();
                this.filter();
            } catch (error) {
                if (!this.disposed && request === this.request) this.report(error);
            } finally {
                if (!this.disposed && request === this.request) {
                    this.setLoading(false);
                    this.abort = null;
                }
            }
        }

        setLoading(loading) {
            for (const control of [this.controls.Refresh, this.controls.Search, this.controls.Rarity, this.controls.Type, ...this.modeButtons]) control.disabled = loading;
        }

        validate(data) {
            if (!Number.isInteger(data.generation) || !Array.isArray(data.definitions)
                || !Array.isArray(data.families) || !Array.isArray(data.rarityDefinitions)) {
                throw new Error('Item catalogue response requires a generation and definition, family and rarity arrays.');
            }
            for (const collection of ['definitions', 'families']) {
                const ids = new Set();
                for (const record of data[collection]) {
                    const item = collection === 'definitions' ? record.blueprint : record;
                    if (typeof record.id !== 'string' || ids.has(record.id) || !item?.name
                        || (collection === 'definitions' && typeof item.description !== 'string')
                        || (collection === 'families' && (!Array.isArray(record.variants) || !record.variants.length
                            || !Array.isArray(record.rarities) || !record.rarities.length
                            || record.rarities.some(rarity => !record.variants.some(variant => variant.rarity === rarity))))) {
                        throw new Error(`Item catalogue ${collection} contains an invalid or duplicate definition.`);
                    }
                    ids.add(record.id);
                }
            }
        }

        records() { return this.data ? this.data[this.mode] : []; }
        variants(record) { return this.mode === 'families' ? record.variants : [record.blueprint]; }
        rarityLabel(key) { return this.data?.rarityDefinitions.find(entry => entry.key === key)?.label || (key ? title(key) : 'Unclassified'); }

        color(element, key) {
            const color = this.data.rarityDefinitions.find(entry => entry.key === key)?.color;
            if (color) {
                element.style.setProperty('--item-catalogue-rarity', color);
                element.classList.add('item-catalogue__rarity');
            }
        }

        options(select, values, allLabel, label = title) {
            const selected = select.value;
            const all = node('option', '', allLabel); all.value = '';
            select.replaceChildren(all);
            for (const value of values) { const option = node('option', '', label(value)); option.value = value; select.append(option); }
            if (values.includes(selected)) select.value = selected;
        }

        buildFilters() {
            for (const button of this.modeButtons) {
                const active = button.dataset.catalogueMode === this.mode;
                button.classList.toggle('active', active);
                button.setAttribute('aria-pressed', String(active));
            }
            const records = this.records().flatMap(record => this.variants(record));
            const rarities = new Set(records.map(record => record.rarity || unclassified));
            const ordered = this.data ? this.data.rarityDefinitions.map(entry => entry.key) : [];
            this.options(this.controls.Rarity, [...ordered.filter(key => rarities.delete(key)), ...[...rarities].sort()], 'All rarities', key => this.rarityLabel(key === unclassified ? null : key));
            this.options(this.controls.Type, [...new Set(records.map(itemType).filter(Boolean))].sort(), 'All item types');
        }

        filter() {
            if (!this.data) return;
            this.entries = this.records().filter(record => this.variants(record).some(item => this.matchesVariant(item)))
                .sort((a, b) => (a.name || a.blueprint.name).localeCompare(b.name || b.blueprint.name) || a.id.localeCompare(b.id));
            if (!this.entries.some(entry => entry.id === this.selectedId)) {
                this.selectedId = null;
                this.variantRarity = null;
                this.root.classList.remove('is-detail-open');
            }
            if (this.page * PAGE_SIZE >= this.entries.length) this.page = 0;
            this.controls.Status.textContent = this.entries.length ? '' : this.records().length
                ? 'No entries match these filters. Try a different search or rarity.'
                : this.mode === 'families' ? 'No standard families have been saved in this game yet.' : 'No item definitions have been remembered in this game yet.';
            this.controls.Browser.hidden = this.entries.length === 0;
            this.renderList();
            this.renderDetail();
        }

        matchesVariant(item) {
            const words = this.controls.Search.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
            const rarity = this.controls.Rarity.value;
            const type = this.controls.Type.value;
            const text = [item.name, item.description, item.shortDescription, item.properties, itemType(item)].join(' ').toLocaleLowerCase();
            return words.every(word => text.includes(word)) && (!type || itemType(item) === type)
                && (!rarity || (item.rarity || unclassified) === rarity);
        }

        renderList() {
            if (this.disposed) return;
            const start = this.page * PAGE_SIZE;
            const count = this.entries.length;
            const noun = this.mode === 'families' ? (count === 1 ? 'family' : 'families') : (count === 1 ? 'definition' : 'definitions');
            this.controls.Count.textContent = `${count} ${noun}`;
            this.controls.Page.textContent = count ? `${start + 1}–${Math.min(start + PAGE_SIZE, count)} of ${count}` : '';
            this.controls.Previous.disabled = this.page === 0;
            this.controls.Next.disabled = start + PAGE_SIZE >= count;
            this.listView.render({ items: this.entries.slice(start, start + PAGE_SIZE), keepVisibleWhenEmpty: true, renderItem: record => {
                const listeners = new AbortController();
                const family = this.mode === 'families';
                const item = family ? record.variants[0] : record.blueprint;
                const button = window.AIRPG_WIDGETS.createCollectionEntry({ document, tagName: 'button', className: 'item-catalogue__entry' }); button.type = 'button';
                button.dataset.catalogueId = record.id;
                button.setAttribute('aria-pressed', String(record.id === this.selectedId));
                const name = node('strong', '', record.name || item.name);
                this.color(name, item.rarity);
                button.append(name, node('span', 'item-catalogue__entry-meta', family
                    ? `${this.rarityLabel(record.minimumRarity)} – ${this.rarityLabel(record.maximumRarity)}`
                    : `${this.rarityLabel(item.rarity)}${item.level !== undefined ? ` · Recorded level ${item.level}` : ''}`));
                if (itemType(item)) button.append(node('span', 'item-catalogue__entry-type', title(itemType(item))));
                button.addEventListener('click', () => this.run(() => {
                    this.selectedId = record.id;
                    this.variantRarity = null;
                    this.root.classList.add('is-detail-open');
                    this.renderList();
                    this.renderDetail();
                    this.controls.Detail.querySelector('h4').focus();
                }), { signal: listeners.signal });
                return { element: button, dispose: () => listeners.abort() };
            } });
        }

        back() {
            this.root.classList.remove('is-detail-open');
            const button = [...this.controls.List.querySelectorAll('[data-catalogue-id]')].find(entry => entry.dataset.catalogueId === this.selectedId);
            button?.focus();
        }

        table(parent, captionText, rows) {
            if (!rows.length) return;
            const region = node('div', 'data-table-scroll');
            region.tabIndex = 0; region.setAttribute('role', 'region'); region.setAttribute('aria-label', captionText);
            const table = node('table', 'data-table');
            table.append(node('caption', '', captionText));
            const head = node('tr');
            for (const text of ['Attribute', 'Bonus']) { const cell = node('th', '', text); cell.scope = 'col'; head.append(cell); }
            const thead = node('thead'); thead.append(head); table.append(thead);
            const body = node('tbody');
            for (const bonus of rows) {
                const row = node('tr'); const name = node('th', '', title(bonus.attribute)); name.scope = 'row';
                row.append(name, node('td', bonus.bonus > 0 ? 'positive' : bonus.bonus < 0 ? 'negative' : '', `${bonus.bonus > 0 ? '+' : ''}${bonus.bonus}`)); body.append(row);
            }
            table.append(body); region.append(table); parent.append(region);
        }

        clearDetail() {
            this.variantView?.destroy();
            this.variantView = null;
            this.controls.Detail.replaceChildren();
        }

        renderDetail() {
            if (this.disposed) return;
            this.clearDetail();
            const detail = this.controls.Detail;
            const record = this.entries.find(entry => entry.id === this.selectedId);
            if (!record) { detail.replaceChildren(node('p', 'item-catalogue__notice', 'Select an entry to inspect its definition.')); return; }
            const family = this.mode === 'families';
            if (family && !record.rarities.includes(this.variantRarity)) this.variantRarity = record.variants.find(variant => this.matchesVariant(variant)).rarity;
            const item = family ? record.variants.find(variant => variant.rarity === this.variantRarity) : record.blueprint;
            const heading = node('h4', '', item.name); heading.tabIndex = -1; this.color(heading, item.rarity);
            detail.replaceChildren(heading);
            detail.append(node('p', 'item-catalogue__kind', `${this.rarityLabel(item.rarity)} · ${family ? 'Standard family' : 'Observed definition'}`));
            if (family) {
                detail.append(node('p', 'item-catalogue__notice', `Allowed rarities: ${this.rarityLabel(record.minimumRarity)} – ${this.rarityLabel(record.maximumRarity)}. Canonical variants reused when new items are generated.`));
                const variants = node('div', 'item-catalogue__variants'); variants.id = 'itemCatalogueVariant'; variants.setAttribute('role', 'group'); variants.setAttribute('aria-label', 'Rarity variant');
                this.variantView = new window.AIRPG_WIDGETS.CollectionView(variants);
                this.variantView.render({ items: record.rarities, keepVisibleWhenEmpty: true, renderItem: rarity => {
                    const listeners = new AbortController();
                    const button = node('button', `story-tools-tab-button${rarity === this.variantRarity ? ' active' : ''}`, this.rarityLabel(rarity)); button.type = 'button'; button.dataset.rarity = rarity;
                    button.setAttribute('aria-pressed', String(rarity === this.variantRarity));
                    this.color(button, rarity);
                    button.addEventListener('click', () => this.run(() => {
                        this.variantRarity = rarity;
                        this.renderDetail();
                        [...detail.querySelectorAll('[data-rarity]')].find(entry => entry.dataset.rarity === rarity).focus();
                    }), { signal: listeners.signal });
                    return { element: button, dispose: () => listeners.abort() };
                } });
                detail.append(variants);
            }
            detail.append(node('p', 'item-catalogue__description', item.description));
            const facts = node('dl', 'item-catalogue__facts');
            for (const [label, value] of [
                ['Recorded level', family ? undefined : item.level], ['Item type', itemType(item)],
                ['Equipment slot', item.slot], ['Value', item.value], ['Weight', item.weight], ['Properties', item.properties],
                ['Loose ammunition type', item.ammoType],
                ['Charge mode', item.chargePool?.mode], ['Charge capacity', item.chargePool?.capacity],
                ['Charge unit', item.chargePool?.unit],
                ['Starting charge', item.chargePool ? (item.chargePool.initialAmount ?? 'Unknown') : undefined],
                ['Compatible ammunition type', item.chargePool?.ammoType],
                ['Charge cost per use', item.chargePool?.costPerUse]
            ]) {
                if (value === undefined || value === null || value === '') continue;
                facts.append(node('dt', '', label), node('dd', '', typeof value === 'string' && ['Equipment slot', 'Item type'].includes(label) ? title(value) : value));
            }
            detail.append(facts);
            this.table(detail, family ? 'Base attribute bonuses' : 'Recorded attribute bonuses', (family ? item.unscaledAttributeBonuses : item.attributeBonuses) || []);
            detail.append(node('p', 'item-catalogue__notice', family
                ? 'Base bonuses are scaled for level and rarity when an item is created.'
                : `Stats belong to the recorded item${item.level !== undefined ? ` at level ${item.level}` : ''}. A remembered definition does not indicate current ownership.`));
            const effects = node('div');
            const caused = Array.isArray(item.causeStatusEffects) ? item.causeStatusEffects : [
                ...(item.causeStatusEffectOnTarget ? [{ ...item.causeStatusEffectOnTarget, applyToTarget: true }] : []),
                ...(item.causeStatusEffectOnEquipper ? [{ ...item.causeStatusEffectOnEquipper, applyToEquipper: true }] : [])
            ];
            effects.innerHTML = this.renderEffects(item.statusEffects || [], 'Intrinsic effects')
                + this.renderEffects(caused.filter(effect => effect.applyToTarget), 'Inflicted effects')
                + this.renderEffects(caused.filter(effect => effect.applyToEquipper), 'Equipper effects', { durationLabel: 'While equipped' })
                + (item.techniqueGrants?.length ? this.renderEffects([{ name: 'Granted techniques', techniqueGrants: item.techniqueGrants }], 'Techniques') : '');
            detail.append(effects);
            const flags = ['isContainer', 'isVehicle', 'isCraftingStation', 'isProcessingStation', 'isHarvestable', 'isSalvageable', 'requiresCheckToOpen'].filter(key => item[key] === true);
            if (flags.length) detail.append(node('p', 'item-catalogue__notice', flags.map(key => title(key.replace(/^is/, ''))).join(' · ')));
            const disclosure = node('details', 'item-catalogue__definition');
            disclosure.append(node('summary', '', 'Definition details'), node('pre', '', JSON.stringify({ id: record.id, ...item }, null, 2)));
            detail.append(disclosure);
        }
        destroy() {
            if (this.disposed) return;
            this.disposed = true;
            ++this.request;
            this.abort?.abort();
            this.listeners.abort();
            try { this.listView.destroy(); }
            finally { this.clearDetail(); }
        }
    }

    window.ItemCataloguePanel = ItemCataloguePanel;
})();
