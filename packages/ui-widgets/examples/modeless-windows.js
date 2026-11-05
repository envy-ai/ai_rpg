import { ModelessChooser, FloatingWindow } from '../src/index.js';

export function mountModelessWindows(parent) {
    const document = parent.ownerDocument;
    const section = document.createElement('section');
    section.id = 'modeless-window-specimen';
    section.innerHTML = `<h2>Modeless choices and floating windows</h2>
        <p>The composer stays usable while a chooser or window is open.</p>
        <label>Composer <textarea id="modeless-composer" rows="2"></textarea></label>
        <div class="specimen-actions"><button type="button" id="modeless-open-one">First chooser</button><button type="button" id="modeless-open-two">Second chooser</button><button type="button" id="floating-window-open">Open floating window</button></div>
        <p id="modeless-choice-status" role="status">No choice selected.</p>`;
    parent.append(section);
    const composer = section.querySelector('#modeless-composer');
    const status = section.querySelector('#modeless-choice-status');
    const listeners = new document.defaultView.AbortController();
    const choosers = [];
    const roots = [];
    const windows = new Set();
    for (const [index, label] of [[1, 'First'], [2, 'Second']]) {
        const root = document.createElement('aside');
        root.className = 'specimen-chooser';
        root.id = `modeless-chooser-${index}`;
        root.hidden = true;
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'false');
        root.innerHTML = `<section><h3 id="modeless-title-${index}">${label} choices</h3><button type="button" class="specimen-chooser-close">Close chooser</button><div class="specimen-chooser-choices"><button type="button">Forest</button><button type="button">Ocean</button></div></section>`;
        document.body.append(root);
        roots.push(root);
        const chooser = new ModelessChooser({
            root, title: root.querySelector('h3'), closeButton: root.querySelector('.specimen-chooser-close'),
            returnFocus: composer,
            onChoose: value => { composer.value = value; status.textContent = `Selected ${value}.`; }
        });
        choosers.push(chooser);
        for (const control of root.querySelectorAll('.specimen-chooser-choices button')) chooser.choice(control, control.textContent);
        section.querySelector(`#modeless-open-${index === 1 ? 'one' : 'two'}`).addEventListener('click', () => chooser.open(`${label} choices`), { signal: listeners.signal });
    }
    let windowCount = 0;
    section.querySelector('#floating-window-open').addEventListener('click', () => {
        const instance = FloatingWindow.create({
            document, ariaLabel: `Example window ${++windowCount}`,
            onClose: () => { const root = instance.root; instance.destroy(); root.remove(); windows.delete(instance); }
        });
        const { root, title, subtitle, content } = instance.elements;
        root.classList.add('specimen-floating-window');
        root.style.left = `${40 + ((windowCount - 1) % 4) * 24}px`;
        root.style.top = `${70 + ((windowCount - 1) % 4) * 24}px`;
        title.textContent = `Window ${windowCount}`;
        subtitle.textContent = 'Drag the header; Escape closes the focused window.';
        const input = document.createElement('input');
        input.setAttribute('aria-label', `Window ${windowCount} field`);
        content.append(input);
        document.body.append(root);
        windows.add(instance);
        input.focus();
    }, { signal: listeners.signal });
    return () => {
        listeners.abort();
        for (const chooser of choosers) chooser.destroy();
        for (const root of roots) root.remove();
        for (const instance of windows) { const root = instance.root; instance.destroy(); root.remove(); }
        windows.clear();
        section.remove();
    };
}
