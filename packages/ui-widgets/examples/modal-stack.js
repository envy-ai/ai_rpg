import { ModalStack } from '../src/index.js';

export function mountModalStack(parent) {
    const document = parent.ownerDocument;
    const section = document.createElement('section');
    section.id = 'modal-stack-specimen';
    section.innerHTML = `<h2>Explicit custom modal ownership</h2><p>These custom surfaces share a backdrop; closing a sibling retains the other owner's backdrop and scroll lock. Application callbacks own their dismissal policy.</p><button type="button" id="custom-modal-open">Open custom surface</button><p id="custom-modal-status" role="status">Both surfaces closed.</p>`;
    const backdrop = document.createElement('div');
    backdrop.className = 'specimen-modal-backdrop';
    backdrop.id = 'custom-modal-backdrop';
    backdrop.hidden = true;
    const first = document.createElement('section');
    first.className = 'specimen-custom-modal';
    first.id = 'custom-modal-first';
    first.hidden = true;
    first.setAttribute('role', 'dialog');
    first.setAttribute('aria-label', 'First custom surface');
    first.innerHTML = '<h3>First custom surface</h3><button type="button" id="custom-modal-nested">Open sibling surface</button><button type="button" id="custom-modal-first-close">Close first surface</button>';
    const second = document.createElement('section');
    second.className = 'specimen-custom-modal specimen-custom-modal--second';
    second.id = 'custom-modal-second';
    second.hidden = true;
    second.setAttribute('role', 'dialog');
    second.setAttribute('aria-label', 'Second custom surface');
    second.innerHTML = '<h3>Second custom surface</h3><button type="button" id="custom-modal-second-close">Close second surface</button>';
    parent.append(section);
    document.body.append(backdrop, first, second);
    const stack = new ModalStack({ document, lockClass: 'specimen-modal-open' });
    stack.register(first, { backdrop });
    stack.register(second, { backdrop });
    const listeners = new document.defaultView.AbortController();
    const status = section.querySelector('#custom-modal-status');
    const show = (root, visible) => {
        stack.setVisible(root, visible);
        status.textContent = `${first.hidden ? 'First closed' : 'First open'}; ${second.hidden ? 'second closed' : 'second open'}.`;
    };
    section.querySelector('#custom-modal-open').addEventListener('click', () => show(first, true), { signal: listeners.signal });
    first.querySelector('#custom-modal-nested').addEventListener('click', () => show(second, true), { signal: listeners.signal });
    first.querySelector('#custom-modal-first-close').addEventListener('click', () => show(first, false), { signal: listeners.signal });
    second.querySelector('#custom-modal-second-close').addEventListener('click', () => show(second, false), { signal: listeners.signal });
    return () => {
        listeners.abort();
        stack.destroy();
        for (const root of [section, backdrop, first, second]) root.remove();
    };
}
