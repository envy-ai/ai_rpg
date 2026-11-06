import { Tabs, TabList, PointerDrag } from '../src/index.js';

/** Retained panels, a late extension tab and button-only native selection. */
export function mountNavigation(parent) {
    const document = parent.ownerDocument;
    const listeners = new document.defaultView.AbortController();
    const section = document.createElement('section');
    section.id = 'navigation-example';
    section.innerHTML = `<h2>Navigation and layout</h2>
        <div id="navigation-tabs"><button id="navigation-tab-first">First</button><button id="navigation-tab-last">Last</button></div>
        <div id="navigation-panel-first">The first panel retains this <input aria-label="Retained panel draft" value="Draft text"></div>
        <div id="navigation-panel-last">The last panel remains the same native node.</div>
        <button id="navigation-register">Register extension tab</button><button id="navigation-release" disabled>Dispose extension owner</button>
        <p id="navigation-events"></p>
        <div id="navigation-groups"><button id="navigation-choice-left">Left pane</button><button id="navigation-choice-right">Right pane</button></div>
        <p id="navigation-selection">left</p>
        <div class="navigation-resize-demo"><div id="navigation-resize-pane">Resize this pane</div><button id="navigation-resize-handle" type="button" role="separator" aria-label="Resize example pane" aria-orientation="vertical">↔</button></div>`;
    parent.append(section);
    const byId = id => section.querySelector(`#${id}`);
    let count = 0;
    const tabs = new Tabs({
        tabs: ['first', 'last'].map(id => ({ id, button: byId(`navigation-tab-${id}`), panel: byId(`navigation-panel-${id}`) })),
        onActivate: (id, { changed, source }) => { byId('navigation-events').textContent = `${++count}: ${id}, changed=${changed}, source=${source}`; }
    });
    let disposeExtension = null;
    byId('navigation-register').addEventListener('click', () => {
        const button = document.createElement('button');
        button.id = 'navigation-tab-extension';
        button.textContent = 'Extension';
        byId('navigation-tabs').append(button);
        const panel = document.createElement('div');
        panel.id = 'navigation-panel-extension';
        panel.textContent = 'The extension owner supplies this panel.';
        byId('navigation-panel-last').after(panel);
        const unregister = tabs.add({ id: 'extension', button, panel });
        disposeExtension = () => { unregister(); button.remove(); panel.remove(); disposeExtension = null; };
        byId('navigation-register').disabled = true;
        byId('navigation-release').disabled = false;
    }, { signal: listeners.signal });
    byId('navigation-release').addEventListener('click', () => {
        disposeExtension();
        byId('navigation-register').disabled = false;
        byId('navigation-release').disabled = true;
    }, { signal: listeners.signal });
    const selection = new TabList({
        items: ['left', 'right'].map(id => ({ id, button: byId(`navigation-choice-${id}`) })),
        onActivate: id => { byId('navigation-selection').textContent = id; }
    });
    const pane = byId('navigation-resize-pane');
    const handle = byId('navigation-resize-handle');
    let startX;
    let startWidth;
    const drag = new PointerDrag(pane, handle, {
        capturePointer: true,
        onDragStart: (_, event) => { startX = event.clientX; startWidth = pane.getBoundingClientRect().width; },
        writePosition: (_, event) => { pane.style.width = `${startWidth + event.clientX - startX}px`; }
    });
    handle.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
        event.preventDefault();
        if (event.key === 'Home') pane.style.removeProperty('width');
        else pane.style.width = `${pane.getBoundingClientRect().width + (event.key === 'ArrowRight' ? 24 : -24)}px`;
    }, { signal: listeners.signal });
    return () => {
        listeners.abort();
        disposeExtension?.();
        tabs.destroy();
        selection.destroy();
        drag.destroy();
        section.remove();
    };
}
