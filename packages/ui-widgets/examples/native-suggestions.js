import { NativeSuggestions } from '../src/native-suggestions.js';
import { createField } from '../src/field.js';

export function mountNativeSuggestions(parent) {
    const document = parent.ownerDocument;
    const section = document.createElement('section');
    section.id = 'native-suggestions-example';
    section.innerHTML = `<h2>Existing native suggestions</h2><p>Type a fruit name. Enter chooses the first match; Escape or leaving the input hides suggestions.</p>`;
    const field = createField({ document, label: 'Fruit search', type: 'search', id: 'native-suggestion-search' });
    const root = document.createElement('div');
    root.id = 'native-suggestion-list';
    const output = document.createElement('output');
    output.id = 'native-suggestion-choice';
    const error = document.createElement('pre');
    error.id = 'native-suggestion-error';
    error.setAttribute('role', 'alert');
    const actions = document.createElement('p');
    actions.className = 'specimen-actions';
    actions.innerHTML = `<button type="button" id="native-suggestion-hide">Hide suggestions</button><button type="button" id="native-suggestion-destroy">Destroy owner</button><button type="button" id="native-suggestion-mount" disabled>Mount owner</button>`;
    section.append(field.field, root, actions, output, error);
    parent.append(section);
    const button = id => section.querySelector(`#native-suggestion-${id}`);
    const listeners = new document.defaultView.AbortController();
    let owner;
    const mount = () => {
        owner = new NativeSuggestions(field.input, root, {
            getMatches: query => ['Apple', 'Apricot', 'Banana', 'Pear'].filter(value => value.toLowerCase().includes(query.toLowerCase())),
            renderOption: value => {
                const item = document.createElement('button');
                item.type = 'button';
                item.textContent = value;
                return item;
            },
            onChoose: value => { output.textContent = value; },
            onError: cause => { error.textContent = cause.stack || cause.message; }
        });
        button('mount').disabled = true;
        button('destroy').disabled = button('hide').disabled = false;
    };
    const destroy = () => {
        owner.destroy();
        button('mount').disabled = false;
        button('destroy').disabled = button('hide').disabled = true;
    };
    button('hide').addEventListener('click', () => owner.hide(), { signal: listeners.signal });
    button('destroy').addEventListener('click', destroy, { signal: listeners.signal });
    button('mount').addEventListener('click', mount, { signal: listeners.signal });
    mount();
    return () => { owner.destroy(); listeners.abort(); };
}
