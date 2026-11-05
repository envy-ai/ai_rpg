let nextFieldId = 1;
const secretToggleOwners = new WeakMap();

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

/** Apply explicit native field state; predicates and value ownership stay with callers. */
export function setFieldState(element, state, { visibility = 'hidden', display = 'block' } = {}) {
    const view = element?.ownerDocument?.defaultView;
    if (!view || !(element instanceof view.HTMLElement)) throw new TypeError('setFieldState requires an HTML element.');
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new TypeError('setFieldState requires an object containing explicit visible, disabled or required booleans.');
    if (!['hidden', 'display'].includes(visibility) || typeof display !== 'string' || !display) throw new TypeError('setFieldState visibility must be hidden or display, with a nonempty display value.');
    for (const key of Object.keys(state)) {
        if (!['visible', 'disabled', 'required'].includes(key) || typeof state[key] !== 'boolean') throw new TypeError(`setFieldState.${key} must be a supported boolean: visible, disabled or required. Supply true or false.`);
        if (key !== 'visible' && !(key in element)) throw new TypeError(`setFieldState.${key} is unsupported by this native element. Apply it to a compatible form control.`);
    }
    if (Object.hasOwn(state, 'visible')) {
        if (visibility === 'hidden') element.hidden = !state.visible;
        else element.style.display = state.visible ? display : 'none';
    }
    if (Object.hasOwn(state, 'disabled')) element.disabled = state.disabled;
    if (Object.hasOwn(state, 'required')) element.required = state.required;
}

/** Bind a native password/text reveal button; the host supplies icon/name presentation. */
export function bindSecretToggle(input, button, { onChange } = {}) {
    const view = input?.ownerDocument?.defaultView;
    if (!view || !(input instanceof view.HTMLInputElement) || !(button instanceof view.HTMLButtonElement) || button.ownerDocument !== input.ownerDocument || !['password', 'text'].includes(input.type)) throw new TypeError('bindSecretToggle requires a password/text input and button in the same document.');
    if (typeof onChange !== 'function') throw new TypeError('bindSecretToggle requires an onChange callback for the button icon and accessible name.');
    if (secretToggleOwners.has(input) || secretToggleOwners.has(button)) throw new Error('Secret toggle controls already have an owner. Dispose it before binding again.');
    const listeners = new view.AbortController();
    const sync = () => {
        const shown = input.type === 'text';
        button.setAttribute('aria-pressed', String(shown));
        if (input.id) button.setAttribute('aria-controls', input.id);
        onChange(shown);
    };
    secretToggleOwners.set(input, listeners);
    secretToggleOwners.set(button, listeners);
    try { sync(); }
    catch (error) {
        secretToggleOwners.delete(input);
        secretToggleOwners.delete(button);
        listeners.abort();
        throw error;
    }
    button.addEventListener('click', () => {
        input.type = input.type === 'password' ? 'text' : 'password';
        sync();
    }, { signal: listeners.signal });
    return () => {
        listeners.abort();
        if (secretToggleOwners.get(input) === listeners) secretToggleOwners.delete(input);
        if (secretToggleOwners.get(button) === listeners) secretToggleOwners.delete(button);
    };
}
