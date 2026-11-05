import { AnchoredPopup, NativeDialog } from '../src/index.js';

export function mountAnchoredPopup(parent) {
    const document = parent.ownerDocument;
    const section = document.createElement('section');
    section.id = 'anchored-popup-specimen';
    section.innerHTML = '<h2>Anchored popup and portal</h2><button id="anchored-popup-trigger" type="button" aria-expanded="false">Open popup</button><div id="anchored-popup-menu" class="specimen-anchored-popup" hidden><button id="anchored-popup-dialog-action" type="button">Open native detail dialog</button></div><p id="anchored-popup-status" role="status">Popup closed.</p>';
    parent.append(section);
    const trigger = section.querySelector('#anchored-popup-trigger');
    const root = section.querySelector('#anchored-popup-menu');
    const status = section.querySelector('#anchored-popup-status');
    const dialog = document.createElement('dialog');
    dialog.id = 'anchored-popup-dialog';
    dialog.setAttribute('aria-label', 'Popup detail');
    dialog.innerHTML = '<p>The popup closed and returned focus before this dialog opened.</p><input aria-label="Popup detail field"><button type="button">Close detail</button>';
    document.body.append(dialog);
    const native = new NativeDialog(dialog, { returnFocus: trigger });
    const listeners = new document.defaultView.AbortController();
    const popup = new AnchoredPopup(root, {
        trigger, portalTarget: document.body,
        position: () => {
            const rect = trigger.getBoundingClientRect();
            root.style.left = `${rect.left}px`;
            root.style.top = `${rect.bottom + 6}px`;
        },
        onOpen: () => { status.textContent = 'Popup open in the body portal.'; },
        onClose: ({ reason }) => { status.textContent = `Popup closed (${reason}); its original parent is restored.`; }
    });
    trigger.addEventListener('click', () => {
        if (popup.isOpen) popup.close({ restoreFocus: true });
        else popup.open();
    }, { signal: listeners.signal });
    root.querySelector('button').addEventListener('click', () => native.open({ initialFocus: dialog.querySelector('input') }), { signal: listeners.signal });
    dialog.querySelector('button').addEventListener('click', () => native.close(), { signal: listeners.signal });
    return () => {
        listeners.abort();
        popup.destroy();
        native.destroy();
        dialog.remove();
        section.remove();
    };
}
