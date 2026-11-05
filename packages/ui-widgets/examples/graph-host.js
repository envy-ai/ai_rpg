import { GraphHost } from '../src/index.js';

export function mountGraphHost(parent) {
    const document = parent.ownerDocument;
    const section = document.createElement('section');
    section.id = 'graph-host-specimen';
    section.innerHTML = `<h2>Injected graph-host lifecycle</h2><p>This engine is supplied by the example. The library owns its viewport/resources without knowing a graph engine or topology.</p>
        <button type="button" id="graph-mount">Mount / replace engine</button>
        <button type="button" id="graph-status">Show empty state</button>
        <button type="button" id="graph-clear">Clear graph</button>
        <button type="button" id="graph-destroy">Destroy owner</button>
        <div id="graph-host-root" class="sample-graph-host"></div>
        <p>Active generation: <output id="graph-generation">0</output>; active node clicks: <output id="graph-clicks">0</output></p>
        <pre id="graph-events" aria-live="polite"></pre>`;
    parent.append(section);
    const byId = id => section.querySelector(`#${id}`);
    let generation = 0;
    let clicks = 0;
    const events = [];
    const record = value => { events.push(value); byId('graph-events').textContent = events.join('\n'); };
    const host = new GraphHost(byId('graph-host-root'), {
        createEngine: root => {
            const id = ++generation;
            const node = document.createElement('button');
            node.type = 'button';
            node.id = 'graph-node';
            node.textContent = `Engine ${id} node`;
            root.append(node);
            record(`create ${id}`);
            return { id, node, destroy() { record(`destroy ${id}`); } };
        }, statusClasses: { status: 'sample-graph-status' }
    });
    const mount = () => {
        const engine = host.mount();
        host.own(() => record(`resource ${engine.id}`));
        host.listen(engine.node, 'click', () => { byId('graph-clicks').textContent = String(++clicks); });
        host.defer(() => record(`deferred ${engine.id}`));
        byId('graph-generation').textContent = String(engine.id);
    };
    const listeners = new document.defaultView.AbortController();
    byId('graph-mount').addEventListener('click', mount, { signal: listeners.signal });
    byId('graph-status').addEventListener('click', () => host.status('No graph records.', { kind: 'empty' }), { signal: listeners.signal });
    byId('graph-clear').addEventListener('click', () => host.clear(), { signal: listeners.signal });
    byId('graph-destroy').addEventListener('click', () => {
        host.destroy();
        for (const button of section.querySelectorAll('button')) button.disabled = true;
    }, { signal: listeners.signal });
    mount();
    return () => { listeners.abort(); host.destroy(); };
}
