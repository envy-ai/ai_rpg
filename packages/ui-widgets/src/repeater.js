/** Own direct row ordering/removal through delegated actions; row contents remain local. */
export class Repeater {
    constructor(root, { onChange = null, onInput = null, emptyRow = null } = {}) {
        const view = root?.ownerDocument?.defaultView;
        if (!view || !(root instanceof view.HTMLElement)) throw new TypeError('Repeater requires an HTML root.');
        this.root = root;
        this.onChange = onChange;
        this.onInput = onInput;
        this.emptyRow = emptyRow;
        this.destroyed = false;
        this.dragged = null;
        this.listeners = new view.AbortController();
        const signal = this.listeners.signal;
        root.dataset.repeaterRoot = '';
        const ownEvent = event => event.target.closest('[data-repeater-root]') === root;
        root.addEventListener('click', event => {
            if (!ownEvent(event)) return;
            const action = event.target.closest('[data-repeater-action]');
            const row = this.findRow(action);
            if (!row || action.disabled) return;
            event.preventDefault();
            if (action.dataset.repeaterAction === 'remove') this.remove(row);
            else if (action.dataset.repeaterAction === 'up') this.move(row, -1);
            else if (action.dataset.repeaterAction === 'down') this.move(row, 1);
        }, { signal });
        root.addEventListener('input', event => {
            if (ownEvent(event) && this.findRow(event.target)) this.onInput?.(event);
        }, { signal });
        root.addEventListener('keydown', event => {
            if (!ownEvent(event) || !event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
            const handle = event.target.closest('[data-repeater-handle]');
            const row = this.findRow(handle);
            if (!row) return;
            event.preventDefault();
            this.move(row, event.key === 'ArrowUp' ? -1 : 1);
            handle.focus();
        }, { signal });
        root.addEventListener('dragstart', event => {
            if (!ownEvent(event)) return;
            const handle = event.target.closest('[data-repeater-handle]');
            const row = this.findRow(handle);
            if (!row) return;
            this.dragged = row;
            row.classList.add('dragging');
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', 'repeater-row');
        }, { signal });
        root.addEventListener('dragover', event => {
            if (!this.dragged || !ownEvent(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            const target = this.findRow(event.target);
            if (target === this.dragged) return;
            const bounds = target?.getBoundingClientRect();
            const before = target && event.clientY < bounds.top + bounds.height / 2 ? target : target?.nextElementSibling || null;
            if (before === this.dragged || this.dragged.nextElementSibling === before) return;
            root.insertBefore(this.dragged, before);
            this.onChange?.({ action: 'move', row: this.dragged });
        }, { signal });
        root.addEventListener('drop', event => {
            if (!this.dragged) return;
            event.preventDefault();
            this.finishDrag();
        }, { signal });
        root.addEventListener('dragend', () => this.finishDrag(), { signal });
    }

    assertAlive() {
        if (this.destroyed) throw new Error('Repeater has been destroyed. Create a new instance to remount.');
    }

    findRow(element) {
        if (!element || element === this.root) return null;
        let row = element;
        while (row && row.parentElement !== this.root) row = row.parentElement;
        return row;
    }

    add(row, { notify = true } = {}) {
        this.assertAlive();
        const view = this.root.ownerDocument.defaultView;
        if (!(row instanceof view.HTMLElement) || row.ownerDocument !== this.root.ownerDocument) throw new TypeError('Repeater.add requires an HTML row in the root document.');
        this.root.append(row);
        if (notify) this.onChange?.({ action: 'add', row });
        return row;
    }

    remove(row) {
        this.assertAlive();
        if (row.parentElement !== this.root) throw new Error('Repeater.remove requires a direct child row.');
        const focusInside = row.contains(this.root.ownerDocument.activeElement);
        const neighbor = row.nextElementSibling || row.previousElementSibling;
        if (this.dragged === row) this.finishDrag();
        row.remove();
        if (!this.root.children.length && this.emptyRow) this.add(this.emptyRow(), { notify: false });
        if (focusInside) (neighbor || this.root.firstElementChild)?.querySelector('input,textarea,select,button')?.focus();
        this.onChange?.({ action: 'remove', row });
    }

    move(row, delta) {
        this.assertAlive();
        if (row.parentElement !== this.root) throw new Error('Repeater.move requires a direct child row.');
        if (delta !== -1 && delta !== 1) throw new TypeError('Repeater.move delta must be -1 or 1.');
        const sibling = delta === -1 ? row.previousElementSibling : row.nextElementSibling;
        if (!sibling) return false;
        if (delta === -1) this.root.insertBefore(row, sibling);
        else this.root.insertBefore(sibling, row);
        this.onChange?.({ action: 'move', row });
        return true;
    }

    clear() {
        this.assertAlive();
        this.finishDrag();
        this.root.replaceChildren();
    }

    finishDrag() {
        this.dragged?.classList.remove('dragging');
        this.dragged = null;
    }

    destroy() {
        if (this.destroyed) return;
        this.finishDrag();
        this.listeners.abort();
        delete this.root.dataset.repeaterRoot;
        this.root = this.onChange = this.onInput = this.emptyRow = this.listeners = null;
        this.destroyed = true;
    }
}

/** Build portable native reorder/remove buttons for a Repeater row. */
export function createRowActions(document, { className = '', buttonClass = '', removeClass = '', removeLabel = 'Remove', upLabel = 'Up', downLabel = 'Down', upClass = '', downClass = '' } = {}) {
    const actions = document.createElement('div');
    actions.className = className;
    for (const [action, label] of [['up', upLabel], ['down', downLabel], ['remove', removeLabel]]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `${buttonClass} ${action === 'remove' ? removeClass : action === 'up' ? upClass : downClass}`.trim();
        button.dataset.repeaterAction = action;
        button.textContent = label;
        actions.append(button);
    }
    return actions;
}
