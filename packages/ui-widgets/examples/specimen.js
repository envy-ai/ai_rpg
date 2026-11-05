import { SearchableSelect, createPopupDismissal } from '../src/index.js';

const options = ['forest fp16.safetensors', 'forest fp8.safetensors', 'ocean fp8.safetensors'];
const byId = id => document.getElementById(id);
let single;
let multiple;
let disabled = false;
let changeCounts = { single: 0, multi: 0 };

function display(kind, value) {
    byId(`${kind}-value`).textContent = Array.isArray(value) ? value.join(', ') || '(none)' : value || '(none)';
}

function mount() {
    disabled = false;
    changeCounts = { single: 0, multi: 0 };
    for (const kind of ['single', 'multi']) byId(`${kind}-events`).textContent = '0';
    const onChange = kind => value => {
        display(kind, value);
        byId(`${kind}-events`).textContent = String(++changeCounts[kind]);
    };
    single = new SearchableSelect(byId('single-select'), { options, value: options[0], onChange: onChange('single') });
    multiple = new SearchableSelect(byId('multi-select'), { options, multiple: true, value: [options[1]], onChange: onChange('multi') });
    display('single', single.getValue());
    display('multi', multiple.getValue());
    byId('toggle-disabled').textContent = 'Disable choices';
    for (const id of ['toggle-disabled', 'rerender-options', 'destroy-selects']) byId(id).disabled = false;
    byId('mount-selects').disabled = true;
    byId('widget-status').textContent = 'Choices mounted.';
}

byId('toggle-disabled').addEventListener('click', () => {
    disabled = !disabled;
    single.setDisabled(disabled);
    multiple.setDisabled(disabled);
    byId('toggle-disabled').textContent = disabled ? 'Enable choices' : 'Disable choices';
    byId('widget-status').textContent = disabled ? 'Choices disabled.' : 'Choices enabled.';
});
byId('rerender-options').addEventListener('click', () => {
    single.setOptions([...options, 'mountain fp16.safetensors']);
    multiple.setOptions([...options, 'mountain fp16.safetensors']);
    byId('widget-status').textContent = 'Options refreshed; query, value and disabled state retained.';
});
byId('destroy-selects').addEventListener('click', () => {
    single.destroy();
    multiple.destroy();
    for (const id of ['toggle-disabled', 'rerender-options', 'destroy-selects']) byId(id).disabled = true;
    byId('mount-selects').disabled = false;
    byId('widget-status').textContent = 'Choices destroyed. Mount to create fresh instances.';
});
byId('mount-selects').addEventListener('click', mount);

const popups = createPopupDismissal({ document });
popups.bind(byId('popup-one'));
popups.bind(byId('popup-two'));
for (const action of document.querySelectorAll('.popup-action')) action.addEventListener('click', () => {
    byId('popup-status').textContent = `${action.textContent} selected.`;
});
const dialog = byId('action-dialog');
byId('popup-dialog-trigger').addEventListener('click', () => dialog.showModal());
byId('dialog-close').addEventListener('click', () => dialog.close());
window.addEventListener('pagehide', () => {
    single.destroy();
    multiple.destroy();
    popups.destroy();
}, { once: true });

mount();
document.body.dataset.ready = 'true';
