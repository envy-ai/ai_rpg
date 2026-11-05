import { createField, setFieldState, bindSecretToggle } from '../src/field.js';
import { OtherEntry } from '../src/other-entry.js';
import { CollectionView } from '../src/collection-view.js';

export function mountConditionalFields(parent) {
    const document = parent.ownerDocument;
    const section = document.createElement('section');
    section.id = 'conditional-fields-example';
    section.innerHTML = `<h2>Conditional native controls</h2><label><input id="conditional-master" type="checkbox" checked>Allow custom edits</label>`;
    const choice = createField({ document, label: 'Entry choice', type: 'select', id: 'conditional-choice' });
    for (const value of ['Known', 'Other']) {
        const option = document.createElement('option');
        option.value = option.textContent = value;
        choice.input.append(option);
    }
    const custom = createField({ document, label: 'Custom entry', value: 'Retained custom text', id: 'conditional-custom' });
    const secret = createField({ document, label: 'Example secret', type: 'password', value: 'Example text', id: 'conditional-secret' });
    const reveal = document.createElement('button');
    reveal.type = 'button';
    reveal.id = 'conditional-reveal';
    const provider = createField({ document, label: 'Required when shown', value: 'Retained provider text', id: 'conditional-required' });
    const show = document.createElement('label');
    show.innerHTML = '<input id="conditional-show" type="checkbox" checked>Show provider field';
    const count = createField({ document, label: 'Available numbers', type: 'select', id: 'conditional-count' });
    for (const value of ['2', '5']) {
        const option = document.createElement('option');
        option.value = option.textContent = value;
        count.input.append(option);
    }
    const dependent = createField({ document, label: 'Choose a number', type: 'select', id: 'conditional-dependent' });
    section.append(choice.field, custom.field, secret.field, reveal, show, provider.field, count.field, dependent.field);
    parent.append(section);
    const master = section.querySelector('#conditional-master');
    const shown = section.querySelector('#conditional-show');
    const listeners = new document.defaultView.AbortController();
    const other = new OtherEntry(choice.input, custom.input, { otherValue: 'Other', enabled: master.checked });
    const disposeSecret = bindSecretToggle(secret.input, reveal, { onChange: visible => {
        reveal.textContent = visible ? 'Hide secret' : 'Show secret';
        reveal.setAttribute('aria-label', reveal.textContent);
    } });
    const numbers = new CollectionView(dependent.input);
    const populate = () => {
        const previous = dependent.input.value;
        const values = Array.from({ length: Number(count.input.value) }, (_, index) => String(index + 1));
        const available = values.includes(previous);
        numbers.render({ items: available ? values : ['', ...values], keepVisibleWhenEmpty: true, renderItem: value => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value || 'Choose an available number';
            option.disabled = !value;
            return option;
        } });
        dependent.input.value = available ? previous : '';
    };
    const updateProvider = () => {
        setFieldState(provider.field, { visible: shown.checked });
        setFieldState(provider.input, { required: shown.checked });
    };
    master.addEventListener('change', () => other.setEnabled(master.checked), { signal: listeners.signal });
    shown.addEventListener('change', updateProvider, { signal: listeners.signal });
    count.input.addEventListener('change', populate, { signal: listeners.signal });
    updateProvider();
    populate();
    return () => { listeners.abort(); other.destroy(); disposeSecret(); numbers.destroy(); };
}
