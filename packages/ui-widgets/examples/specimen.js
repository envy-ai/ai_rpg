import { SearchableSelect, createPopupDismissal, NativeDialog, FloatingTooltip } from '../src/index.js';
import { mountRepeatedControls } from './repeated-controls.js';
import { mountModelessWindows } from './modeless-windows.js';
import { mountModalStack } from './modal-stack.js';
import { mountAnchoredPopup } from './anchored-popup.js';

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
const native = new NativeDialog(byId('native-dialog'), {
    onClose: () => {
        byId('native-pending').checked = false;
        native.setPending(false);
        byId('native-status').textContent = 'Dialog closed; focus returned to its trigger.';
    }
});
byId('native-open').addEventListener('click', () => {
    native.open({ initialFocus: byId('native-field') });
    byId('native-status').textContent = 'Dialog open.';
});
byId('native-close').addEventListener('click', () => native.close());
byId('native-pending').addEventListener('change', event => native.setPending(event.target.checked));

const tooltip = new FloatingTooltip(byId('specimen-tooltip'), { scrollTargets: [byId('tooltip-scroll-area')] });
const tooltipContent = {
    'tooltip-text-trigger': { content: '<strong>Plain text remains text.</strong>' },
    'tooltip-rich-trigger': { content: '<strong>Structured detail</strong><p>This markup is explicitly supplied by the caller.</p>', allowHTML: true },
    'tooltip-long-trigger': { content: Array.from({ length: 12 }, (_, index) => `<p>Detail row ${index + 1}</p>`).join(''), allowHTML: true },
    'tooltip-scroll-trigger': { content: 'Scrolling this region dismisses its tooltip.' }
};
for (const [id, { content, allowHTML }] of Object.entries(tooltipContent)) {
    const trigger = byId(id);
    const show = event => {
        const rect = trigger.getBoundingClientRect();
        const point = event.type === 'focus' ? { clientX: rect.left, clientY: rect.bottom } : event;
        tooltip.show(content, point, { allowHTML });
    };
    trigger.addEventListener('mouseenter', show);
    trigger.addEventListener('focus', show);
    trigger.addEventListener('mousemove', event => tooltip.move(event));
    trigger.addEventListener('mouseleave', () => tooltip.hide({ defer: true }));
    trigger.addEventListener('blur', () => tooltip.hide({ defer: true }));
}
window.addEventListener('pagehide', () => {
    single.destroy();
    multiple.destroy();
    popups.destroy();
    native.destroy();
    tooltip.destroy();
    disposeRepeatedControls();
    disposeModelessWindows();
    disposeModalStack();
    disposeAnchoredPopup();
}, { once: true });

mount();
const disposeRepeatedControls = mountRepeatedControls(document.querySelector('main'));
const disposeModelessWindows = mountModelessWindows(document.querySelector('main'));
const disposeModalStack = mountModalStack(document.querySelector('main'));
const disposeAnchoredPopup = mountAnchoredPopup(document.querySelector('main'));
document.body.dataset.ready = 'true';
