import { NativeDialog, SubmitShortcut } from '../src/index.js';

export function mountSubmitShortcut(parent) {
    const document = parent.ownerDocument;
    const listeners = new document.defaultView.AbortController();
    const section = document.createElement('section');
    section.id = 'submit-shortcut-example';
    section.innerHTML = `<h2>Native submission shortcuts</h2>
        <button id="shortcut-open">Open native form</button>
        <dialog id="shortcut-dialog" aria-labelledby="shortcut-title"><h3 id="shortcut-title">Native validation</h3>
          <form id="shortcut-form"><label for="shortcut-name">Required name</label><input id="shortcut-name" required>
            <label for="shortcut-readonly">Read-only text</label><textarea id="shortcut-readonly" readonly>Ctrl/Cmd+Enter leaves this unchanged.</textarea>
            <button id="shortcut-save" type="submit">Save</button><button id="shortcut-close" type="button">Close</button></form>
        </dialog>
        <form id="shortcut-explicit-form"><label for="shortcut-explicit">Explicit page action · Ctrl/Cmd+Enter</label>
          <textarea id="shortcut-explicit" data-ctrl-enter-submit="#shortcut-apply">Ordinary page forms require an explicit target.</textarea>
          <button id="shortcut-apply" type="button">Apply</button></form>
        <p id="shortcut-result" role="status">0 saves · 0 actions</p><pre id="shortcut-error"></pre>
        <button id="shortcut-destroy">Destroy shortcut binding</button>`;
    parent.append(section);
    const byId = id => section.querySelector(`#${id}`);
    const shortcut = new SubmitShortcut({ document, onError: error => { byId('shortcut-error').textContent = error.stack; } });
    const dialog = new NativeDialog(byId('shortcut-dialog'));
    let saves = 0;
    let actions = 0;
    const render = () => { byId('shortcut-result').textContent = `${saves} saves · ${actions} actions`; };
    byId('shortcut-open').addEventListener('click', () => dialog.open({ initialFocus: byId('shortcut-name') }), { signal: listeners.signal });
    byId('shortcut-close').addEventListener('click', () => dialog.close(), { signal: listeners.signal });
    byId('shortcut-form').addEventListener('submit', event => { event.preventDefault(); saves++; render(); }, { signal: listeners.signal });
    byId('shortcut-explicit-form').addEventListener('submit', event => event.preventDefault(), { signal: listeners.signal });
    byId('shortcut-apply').addEventListener('click', () => { actions++; render(); }, { signal: listeners.signal });
    byId('shortcut-destroy').addEventListener('click', () => {
        shortcut.destroy();
        byId('shortcut-destroy').disabled = true;
    }, { signal: listeners.signal });
    return () => { listeners.abort(); shortcut.destroy(); dialog.destroy(); section.remove(); };
}
