import { Tabs } from '../src/tabs.js';
import { Repeater, createRowActions } from '../src/repeater.js';
import { OrderedTextList } from '../src/ordered-text-list.js';
import { createField } from '../src/field.js';
import { NumberRange } from '../src/number-range.js';

export function mountRepeatedControls(parent) {
    const document = parent.ownerDocument;
    const section = document.createElement('section');
    section.id = 'repeated-controls';
    section.setAttribute('aria-labelledby', 'repeated-heading');
    section.innerHTML = `
        <h2 id="repeated-heading">Tabs and editable controls</h2>
        <div id="sample-tablist" class="specimen-actions" aria-label="Example sections">
            <button id="sample-tab-first" type="button" class="active">First</button>
            <button id="sample-tab-disabled" type="button" disabled>Unavailable</button>
            <button id="sample-tab-last" type="button">Last</button>
        </div>
        <div id="sample-panel-first"><p>First panel keeps its native field and draft when switching tabs.</p></div>
        <div id="sample-panel-disabled" hidden>Unavailable panel.</div>
        <div id="sample-panel-last" hidden><p>Last panel.</p></div>
        <p>Selected tab: <output id="sample-tab-value">first</output></p>
        <div class="specimen-columns">
            <section aria-labelledby="text-list-heading">
                <h3 id="text-list-heading">Ordered text</h3>
                <p>Drag a handle or focus it and use Alt+Up/Down.</p>
                <div id="sample-text-list" class="sample-text-list"></div>
                <button id="sample-text-add" type="button">Add text</button>
                <p>Values: <output id="sample-text-values"></output></p>
            </section>
            <section aria-labelledby="repeater-heading">
                <h3 id="repeater-heading">Structured rows</h3>
                <div id="sample-repeater"></div>
                <button id="sample-repeater-add" type="button">Add row</button>
                <p>Row changes: <output id="sample-row-events">0</output></p>
            </section>
        </div>
        <h3>Paired native range and number</h3>
        <div id="sample-range-fields" class="specimen-actions"></div>
        <p>Value: <output id="sample-range-value">25</output></p>
        <p class="specimen-actions">
            <button id="sample-range-disable" type="button">Disable pair</button>
            <button id="sample-controls-destroy" type="button">Destroy controls</button>
            <button id="sample-controls-mount" type="button" disabled>Mount controls</button>
        </p>
        <p id="sample-controls-status" role="status">Controls mounted.</p>`;
    parent.append(section);
    const byId = id => section.querySelector(`#${id}`);
    const draft = createField({ document, label: 'Retained draft', id: 'sample-draft', className: 'sample-field' });
    byId('sample-panel-first').append(draft.field);
    const rangeField = createField({ document, label: 'Amount slider', type: 'range', value: 25, id: 'sample-range', className: 'sample-field' });
    const numberField = createField({ document, label: 'Amount number', type: 'number', value: 25, id: 'sample-number', className: 'sample-field' });
    rangeField.input.min = numberField.input.min = '0';
    rangeField.input.max = numberField.input.max = '100';
    byId('sample-range-fields').append(rangeField.field, numberField.field);
    const events = new document.defaultView.AbortController();
    let tabs;
    let text;
    let repeater;
    let pair;
    let disabled = false;
    let rowEvents = 0;
    let nextRow = 1;
    const showText = () => { byId('sample-text-values').textContent = text.getValues().join(' | '); };
    const addRow = () => {
        const row = document.createElement('div');
        row.className = 'sample-repeater-row';
        const field = createField({ document, label: `Row ${nextRow++}`, value: '', className: 'sample-field' });
        row.append(field.field, createRowActions(document, { className: 'specimen-actions' }));
        repeater.add(row);
        return row;
    };
    const mount = () => {
        tabs = new Tabs({
            tabs: ['first', 'disabled', 'last'].map(id => ({ id, button: byId(`sample-tab-${id}`), panel: byId(`sample-panel-${id}`) })),
            onChange: id => { byId('sample-tab-value').textContent = id; }
        });
        byId('sample-tab-value').textContent = tabs.activeId;
        text = new OrderedTextList(byId('sample-text-list'), {
            values: ['First entry', 'Second entry'],
            itemLabel: 'example entry',
            rowClass: 'sample-text-row',
            onChange: showText
        });
        showText();
        byId('sample-repeater').replaceChildren();
        rowEvents = 0;
        nextRow = 1;
        repeater = new Repeater(byId('sample-repeater'), {
            onChange: () => { byId('sample-row-events').textContent = String(++rowEvents); }
        });
        addRow();
        pair = new NumberRange(rangeField.input, numberField.input, {
            onChange: value => { byId('sample-range-value').textContent = String(value); }
        });
        pair.setValue(25);
        pair.setDisabled(false);
        disabled = false;
        byId('sample-range-disable').textContent = 'Disable pair';
        for (const id of ['sample-text-add', 'sample-repeater-add', 'sample-range-disable', 'sample-controls-destroy']) byId(id).disabled = false;
        byId('sample-controls-mount').disabled = true;
        byId('sample-controls-status').textContent = 'Controls mounted.';
    };
    const destroy = () => {
        tabs.destroy();
        text.destroy();
        repeater.destroy();
        pair.destroy();
        for (const id of ['sample-text-add', 'sample-repeater-add', 'sample-range-disable', 'sample-controls-destroy']) byId(id).disabled = true;
        byId('sample-controls-mount').disabled = false;
        byId('sample-controls-status').textContent = 'Controls destroyed. Mount creates fresh instances.';
    };
    byId('sample-text-add').addEventListener('click', () => text.add('', { focus: true }), { signal: events.signal });
    byId('sample-repeater-add').addEventListener('click', () => addRow().querySelector('input').focus(), { signal: events.signal });
    byId('sample-range-disable').addEventListener('click', () => {
        disabled = !disabled;
        pair.setDisabled(disabled);
        byId('sample-range-disable').textContent = disabled ? 'Enable pair' : 'Disable pair';
    }, { signal: events.signal });
    byId('sample-controls-destroy').addEventListener('click', destroy, { signal: events.signal });
    byId('sample-controls-mount').addEventListener('click', mount, { signal: events.signal });
    mount();
    return () => {
        destroy();
        events.abort();
    };
}
