import { Repeater } from './repeater.js';

/** Editable ordered text rows with native drag handles and Alt+Arrow reordering. */
export class OrderedTextList {
    constructor(root, { values = [], rows = 2, itemLabel = 'entry', rowClass = '', inputClass = '', handleClass = '', removeClass = '', maintainEmptyRow = true, onChange = null } = {}) {
        if (!Array.isArray(values) || values.some(value => typeof value !== 'string')) throw new TypeError('OrderedTextList values must be an array of strings.');
        this.root = root;
        this.options = { rows, itemLabel, rowClass, inputClass, handleClass, removeClass, maintainEmptyRow };
        this.onChange = onChange;
        this.destroyed = false;
        this.repeater = new Repeater(root, {
            onChange: () => this.onChange?.(),
            onInput: () => this.onChange?.(),
            emptyRow: maintainEmptyRow ? () => this.createRow('') : null
        });
        root.setAttribute('role', 'list');
        this.setValues(values);
    }

    assertAlive() {
        if (this.destroyed) throw new Error('OrderedTextList has been destroyed. Create a new instance to remount.');
    }

    createRow(value = '') {
        this.assertAlive();
        if (typeof value !== 'string') throw new TypeError('OrderedTextList row values must be strings.');
        const document = this.root.ownerDocument;
        const { rows, itemLabel, rowClass, inputClass, handleClass, removeClass } = this.options;
        const row = document.createElement('div');
        row.className = rowClass;
        row.setAttribute('role', 'listitem');
        const handle = document.createElement('button');
        handle.type = 'button';
        handle.className = handleClass;
        handle.setAttribute('aria-label', `Reorder ${itemLabel}`);
        handle.title = 'Drag or press Alt+Up/Down to reorder';
        handle.textContent = '≡';
        handle.draggable = true;
        handle.dataset.repeaterHandle = '';
        const input = document.createElement('textarea');
        input.className = inputClass;
        input.rows = rows;
        input.value = value;
        input.setAttribute('aria-label', itemLabel);
        input.dataset.orderedTextValue = '';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = removeClass;
        remove.textContent = 'Delete';
        remove.setAttribute('aria-label', `Delete ${itemLabel}`);
        remove.dataset.repeaterAction = 'remove';
        row.append(handle, input, remove);
        return row;
    }

    add(value = '', { focus = false, notify = true } = {}) {
        this.assertAlive();
        const row = this.repeater.add(this.createRow(value), { notify });
        if (focus) row.querySelector('textarea').focus();
        return row;
    }

    setValues(values) {
        this.assertAlive();
        if (!Array.isArray(values) || values.some(value => typeof value !== 'string')) throw new TypeError('OrderedTextList values must be an array of strings.');
        this.repeater.clear();
        const entries = values.length || !this.options.maintainEmptyRow ? values : [''];
        entries.forEach(value => this.add(value, { notify: false }));
    }

    getValues({ trim = false, omitEmpty = false } = {}) {
        this.assertAlive();
        const values = Array.from(this.root.children, row => {
            const value = row.querySelector('[data-ordered-text-value]').value;
            return trim ? value.trim() : value;
        });
        return omitEmpty ? values.filter(value => value.length > 0) : values;
    }

    clear() {
        this.assertAlive();
        this.repeater.clear();
    }

    destroy() {
        if (this.destroyed) return;
        this.repeater.destroy();
        this.root = this.options = this.onChange = this.repeater = null;
        this.destroyed = true;
    }
}
