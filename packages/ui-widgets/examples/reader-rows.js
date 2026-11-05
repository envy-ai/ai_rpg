import { ReaderRows } from '../src/reader-rows.js';
import { createField } from '../src/field.js';

export function mountReaderRows(parent) {
    const document = parent.ownerDocument;
    const section = document.createElement('section');
    section.id = 'reader-rows-example';
    section.innerHTML = `<h2>Rows with owned readers</h2>
        <p>Rows keep caller-owned fields and validation. Read follows the current DOM order.</p>
        <div id="reader-rows-list"></div>
        <p class="specimen-actions">
            <button id="reader-row-add" type="button">Add row</button>
            <button id="reader-row-read" type="button">Read rows</button>
            <button id="reader-row-reverse" type="button">Reverse rows</button>
            <button id="reader-row-destroy" type="button">Destroy row owner</button>
            <button id="reader-row-mount" type="button" disabled>Mount row owner</button>
        </p>
        <p>Values: <output id="reader-row-values"></output></p>
        <p>Disposed rows: <output id="reader-row-disposed">0</output></p>
        <p id="reader-row-status" role="status">Rows mounted.</p>`;
    parent.append(section);
    const byId = id => section.querySelector(`#${id}`);
    const root = byId('reader-rows-list');
    const listeners = new document.defaultView.AbortController();
    let rows;
    let disposed = 0;
    const add = value => {
        const row = document.createElement('div');
        row.className = 'reader-row';
        const field = createField({ document, label: 'Entry text', value, className: 'reader-row-field' });
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = 'Remove row';
        row.append(field.field, remove);
        rows.add(row, () => field.input.value, {
            removeButton: remove,
            dispose: () => { byId('reader-row-disposed').textContent = String(++disposed); }
        });
        return field.input;
    };
    const mount = () => {
        root.replaceChildren();
        rows = new ReaderRows(root);
        add('First row');
        add('Second row');
        for (const id of ['reader-row-add', 'reader-row-read', 'reader-row-reverse', 'reader-row-destroy']) byId(id).disabled = false;
        byId('reader-row-mount').disabled = true;
        byId('reader-row-status').textContent = 'Rows mounted.';
        byId('reader-row-values').textContent = rows.read().join(' | ');
    };
    const destroy = () => {
        rows.destroy();
        for (const id of ['reader-row-add', 'reader-row-read', 'reader-row-reverse', 'reader-row-destroy']) byId(id).disabled = true;
        byId('reader-row-mount').disabled = false;
        byId('reader-row-status').textContent = 'Row owner destroyed. Retained Remove buttons have no owned listeners.';
    };
    byId('reader-row-add').addEventListener('click', () => add('').focus(), { signal: listeners.signal });
    byId('reader-row-read').addEventListener('click', () => { byId('reader-row-values').textContent = rows.read().join(' | '); }, { signal: listeners.signal });
    byId('reader-row-reverse').addEventListener('click', () => {
        root.append(...Array.from(root.children).reverse());
        byId('reader-row-values').textContent = rows.read().join(' | ');
    }, { signal: listeners.signal });
    byId('reader-row-destroy').addEventListener('click', destroy, { signal: listeners.signal });
    byId('reader-row-mount').addEventListener('click', mount, { signal: listeners.signal });
    mount();
    return () => { destroy(); listeners.abort(); };
}
