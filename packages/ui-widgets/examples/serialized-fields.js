import { createField, serializeField } from '../src/field.js';

export function mountSerializedFields(parent) {
    const document = parent.ownerDocument;
    const section = document.createElement('section');
    section.id = 'serialized-fields-example';
    section.innerHTML = '<h2>Native field HTML round trip</h2><p>Serialize current controls without changing their reset defaults.</p>';
    const number = createField({ document, label: 'Number', type: 'number', value: 1, id: 'serialized-field-number' });
    const text = createField({ document, label: 'Text', type: 'textarea', value: 'Original text', id: 'serialized-field-text' });
    const checked = createField({ document, label: 'Enabled', type: 'checkbox', id: 'serialized-field-checked' });
    const choice = createField({ document, label: 'Choice', type: 'select', id: 'serialized-field-choice' });
    for (const value of ['zero', 'other']) {
        const option = document.createElement('option');
        option.value = option.textContent = value;
        choice.input.append(option);
    }
    number.input.value = '0';
    text.input.value = '\nText with <tags>, "quotes" & an ampersand.';
    checked.input.checked = false;
    choice.input.value = 'other';
    const fields = [number, text, checked, choice];
    const action = document.createElement('button');
    action.type = 'button';
    action.id = 'serialized-field-read';
    action.textContent = 'Serialize and read back';
    const result = document.createElement('output');
    result.id = 'serialized-field-values';
    const markup = document.createElement('pre');
    markup.id = 'serialized-field-markup';
    const read = () => {
        const html = fields.map(serializeField).join('');
        const template = document.createElement('template');
        template.innerHTML = html;
        const values = Array.from(template.content.querySelectorAll('input,textarea,select'), input => input.type === 'checkbox' ? input.checked : input.value);
        result.textContent = JSON.stringify(values);
        markup.textContent = html;
    };
    const listeners = new document.defaultView.AbortController();
    action.addEventListener('click', read, { signal: listeners.signal });
    section.append(...fields.map(control => control.field), action, result, markup);
    parent.append(section);
    read();
    return () => listeners.abort();
}
