let nextFieldId = 1;

/** Build a native labeled field; validation and serialization remain caller-owned. */
export function createField({ document = globalThis.document, label, className = '', inputClass = '', type = 'text', value = '', rows = 2, placeholder = '', step, id } = {}) {
    if (!document?.createElement) throw new TypeError('createField requires a browser document.');
    if (typeof label !== 'string') throw new TypeError('createField requires a label string.');
    const field = document.createElement('div');
    field.className = className;
    const labelElement = document.createElement('label');
    labelElement.textContent = label;
    const input = document.createElement(type === 'textarea' || type === 'select' ? type : 'input');
    if (type === 'textarea') input.rows = rows;
    else if (type !== 'select') input.type = type;
    input.className = inputClass;
    input.id = id || `ui-field-${nextFieldId++}`;
    labelElement.htmlFor = input.id;
    if (placeholder) input.setAttribute('placeholder', placeholder);
    if (step !== undefined) input.setAttribute('step', String(step));
    input.value = value === null || value === undefined ? '' : String(value);
    field.append(labelElement, input);
    return { field, input, label: labelElement };
}

/** Serialize one native field's live state without changing its reset defaults. */
export function serializeField({ field, input } = {}) {
    const document = field?.ownerDocument;
    const view = document?.defaultView;
    if (!view || !(field instanceof view.HTMLElement) || input?.ownerDocument !== document) throw new TypeError('serializeField requires a field and native control in the same document.');
    if (!(input instanceof view.HTMLInputElement || input instanceof view.HTMLTextAreaElement || input instanceof view.HTMLSelectElement)) throw new TypeError('serializeField requires an HTML input, textarea or select.');
    const controls = field.querySelectorAll('input, textarea, select');
    if (controls.length !== 1 || controls[0] !== input) throw new TypeError('serializeField requires exactly one owned native control inside its field.');
    if (input instanceof view.HTMLInputElement && (input.type === 'file' || input.indeterminate)) throw new Error('serializeField cannot represent a file selection or indeterminate checkbox in HTML. Keep that live control instead.');
    if (input instanceof view.HTMLSelectElement && !input.multiple && input.options.length && input.selectedIndex === -1) throw new Error('serializeField cannot preserve an unselected single select in HTML. Add an explicit blank or current-value option before serializing.');
    const clone = field.cloneNode(true);
    const control = clone.querySelector('input, textarea, select');
    if (input instanceof view.HTMLTextAreaElement) {
        // The HTML parser consumes one immediate leading newline in textarea content.
        control.defaultValue = input.value.startsWith('\n') ? `\n${input.value}` : input.value;
    } else if (input instanceof view.HTMLSelectElement) {
        Array.from(control.options).forEach((option, index) => { option.defaultSelected = input.options[index].selected; });
    } else {
        control.setAttribute('value', input.value);
        if (input.type === 'checkbox' || input.type === 'radio') control.toggleAttribute('checked', input.checked);
    }
    return clone.outerHTML;
}
