import { BusyButton, StatusSurface, NoticeHost } from '../src/index.js';

export function mountSurfaces(parent) {
    const document = parent.ownerDocument;
    const section = document.createElement('section');
    section.id = 'surfaces-specimen';
    section.innerHTML = `<h2>Owned busy, status and notice surfaces</h2>
        <button id="surface-action" type="button">Native action</button>
        <button id="surface-busy-start" type="button">Start busy</button>
        <button id="surface-busy-end" type="button">End busy</button>
        <label><input id="surface-blocked" type="checkbox"> Current host blocks action</label>
        <button id="surface-rename" type="button">Change content outside owner</button>
        <p id="surface-status" role="status"></p>
        <button id="surface-status-info" type="button">Expiring status</button>
        <button id="surface-status-error" type="button">Persistent status</button>
        <button id="surface-notice" type="button">Show notice</button>
        <button id="surface-dismiss" type="button">Dismiss latest notice</button>
        <button id="surface-destroy" type="button">Destroy owners</button>`;
    const noticesRoot = document.createElement('div');
    noticesRoot.id = 'surface-notices'; noticesRoot.setAttribute('aria-live', 'polite');
    parent.append(section); document.body.append(noticesRoot);
    const byId = id => section.querySelector(`#${id}`);
    const events = new document.defaultView.AbortController();
    const busy = new BusyButton(byId('surface-action'));
    const status = new StatusSurface(byId('surface-status'), { stateAttribute: 'data-state' });
    const notices = new NoticeHost(noticesRoot);
    let latest = null;
    let destroyed = false;
    const disabled = () => byId('surface-blocked').checked;
    byId('surface-busy-start').addEventListener('click', () => busy.setBusy(true, { disabled: disabled(), busyContent: 'Working…' }), { signal: events.signal });
    byId('surface-busy-end').addEventListener('click', () => busy.setBusy(false, { disabled: disabled() }), { signal: events.signal });
    byId('surface-blocked').addEventListener('change', () => busy.setIdleState({ disabled: disabled() }), { signal: events.signal });
    byId('surface-rename').addEventListener('click', () => { byId('surface-action').textContent = 'Changed by current host'; }, { signal: events.signal });
    byId('surface-status-info').addEventListener('click', () => status.update({ text: 'This status expires after one second.', state: 'info', autoHideMs: 1000 }), { signal: events.signal });
    byId('surface-status-error').addEventListener('click', () => status.update({ text: 'This newer status stays visible.', state: 'error' }), { signal: events.signal });
    byId('surface-notice').addEventListener('click', () => { latest = notices.show('Portable transient notice.', { kind: 'success' }); }, { signal: events.signal });
    byId('surface-dismiss').addEventListener('click', () => latest?.dismiss(), { signal: events.signal });
    const destroy = () => {
        if (destroyed) return; destroyed = true;
        events.abort(); busy.destroy(); status.destroy(); notices.destroy(); noticesRoot.remove();
        for (const control of section.querySelectorAll('button,input')) control.disabled = true;
    };
    byId('surface-destroy').addEventListener('click', destroy, { signal: events.signal });
    status.update({ text: 'Ready.', state: 'info' });
    return destroy;
}
