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
