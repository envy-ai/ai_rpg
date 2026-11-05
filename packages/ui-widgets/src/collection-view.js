/** Presentation of already-selected records; filtering, formatting and actions belong to callers. */
export class CollectionView {
    constructor(root, { empty = null, count = null, modeClasses = {}, classNames = {}, disposeContent = null } = {}) {
        const view = root?.ownerDocument?.defaultView;
        if (!view || !(root instanceof view.HTMLElement)) throw new TypeError('CollectionView requires an HTML root.');
        for (const element of [empty, count]) if (element && element.ownerDocument !== root.ownerDocument) throw new TypeError('CollectionView elements must belong to its document.');
        Object.assign(this, { root, empty, count, modeClasses, classNames, disposeContent });
        this.entries = [];
        this.destroyed = false;
    }

    assertAlive() { if (this.destroyed) throw new Error('CollectionView has been destroyed. Create a new owner before rendering.'); }

    clear() { this.assertAlive(); this.releaseContent(); }

    releaseContent() {
        if (this.clearing) return;
        this.clearing = true;
        const root = this.root;
        const disposeContent = this.disposeContent;
        const entries = this.entries;
        this.entries = [];
        const errors = [];
        for (const entry of entries) { try { entry.dispose?.(); } catch (error) { errors.push(error); } }
        try { disposeContent?.(root); } catch (error) { errors.push(error); }
        root.replaceChildren();
        this.clearing = false;
        if (errors.length === 1) throw errors[0];
        if (errors.length) throw new AggregateError(errors, 'CollectionView entry disposal failed.', { cause: errors[0] });
    }

    render({ items, totalCount = items?.length, countText = '', emptyText = '', mode = 'list', columns = [], showHeaders = false, renderItem, keepVisibleWhenEmpty = false } = {}) {
        this.assertAlive();
        if (this.clearing) throw new Error('CollectionView cannot render during entry disposal.');
        if (!Array.isArray(items) || typeof renderItem !== 'function') throw new TypeError('CollectionView.render requires items and a renderItem function.');
        this.clear();
        this.assertAlive();
        const { root, empty, count, classNames, modeClasses } = this;
        const document = root.ownerDocument;
        root.dataset.viewMode = mode;
        for (const [className, modes] of Object.entries(modeClasses)) root.classList.toggle(className, modes.includes(mode));
        if (count) {
            count.dataset.visibleCount = String(items.length);
            count.dataset.totalCount = String(totalCount);
            count.textContent = countText;
        }
        root.hidden = !items.length && !keepVisibleWhenEmpty;
        root.style.display = '';
        if (empty) {
            empty.hidden = items.length > 0;
            empty.style.display = items.length ? 'none' : 'block';
            if (!items.length) empty.textContent = emptyText;
        }
        if (!items.length) return items;
        let target = root;
        if (mode === 'table') {
            const table = document.createElement('table');
            table.className = classNames.table || 'collection-table';
            const group = document.createElement('colgroup');
            for (const column of columns) {
                const col = document.createElement('col');
                col.className = column.colClass || '';
                group.append(col);
            }
            table.append(group);
            if (showHeaders) {
                const head = document.createElement('thead');
                head.className = classNames.head || '';
                const row = document.createElement('tr');
                row.className = classNames.headerRow || '';
                for (const column of columns) {
                    const cell = document.createElement('th');
                    cell.className = column.headerClass || '';
                    cell.scope = 'col';
                    cell.textContent = column.label || '';
                    if (column.hiddenHeader) cell.setAttribute('aria-hidden', 'true');
                    row.append(cell);
                }
                head.append(row);
                table.append(head);
            }
            target = document.createElement('tbody');
            target.className = classNames.body || '';
            table.append(target);
            root.append(table);
        }
        for (const item of items) {
            const built = renderItem(item, { mode });
            if (built === null || built === undefined) continue; // An explicit renderer may omit a record.
            const element = built.element || built;
            if (!(element instanceof document.defaultView.HTMLElement) || element.ownerDocument !== document) throw new TypeError('CollectionView renderItem must return an HTML element or {element, dispose}.');
            if (built.dispose !== undefined && typeof built.dispose !== 'function') throw new TypeError('CollectionView entry dispose must be a function.');
            this.entries.push({ element, dispose: built.dispose });
            target.append(element);
        }
        return items;
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        try { this.releaseContent(); }
        finally {
            this.root = this.empty = this.count = this.entries = this.disposeContent = this.modeClasses = this.classNames = null;
        }
    }
}

/** Shared native entry chrome; callers retain their card/table content and schema. */
export function createCollectionEntry({ document, tagName = 'div', className = '', focusable = false, label = null, dataset = {} } = {}) {
    if (!document?.defaultView) throw new TypeError('createCollectionEntry requires a browser document.');
    const root = document.createElement(tagName);
    root.className = className;
    if (focusable) root.tabIndex = 0;
    if (label !== null) root.setAttribute('aria-label', label);
    for (const [key, value] of Object.entries(dataset)) if (value !== undefined && value !== null) root.dataset[key] = String(value);
    return root;
}
