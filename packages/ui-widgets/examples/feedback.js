import { ActionGroup, SnapshotList, ProgressMeter, ProgressMirrors, FollowScroll } from '../src/index.js';

export function mountFeedback(parent) {
    const document = parent.ownerDocument;
    const section = document.createElement('section');
    section.id = 'feedback-specimen';
    section.innerHTML = `<h2>Snapshot feedback and follow scrolling</h2>
        <button id="feedback-context" type="button">Context import</button><button id="feedback-update" type="button">Update snapshot</button><button id="feedback-zero" type="button">Explicit zero</button><button id="feedback-clear" type="button">Clear rows</button>
        <div id="feedback-rows"></div><p id="feedback-action-result" role="status"></p>
        <div id="feedback-mirror"></div>
        <label><input id="feedback-follow" type="checkbox" checked> Follow output</label>
        <button id="feedback-append" type="button">Append output</button>
        <pre id="feedback-output" class="sample-feedback-output"></pre>
        <button id="feedback-destroy" type="button">Destroy feedback owners</button>`;
    parent.append(section);
    const byId = id => section.querySelector(`#${id}`);
    const events = new document.defaultView.AbortController();
    let fraction = 0;
    let context = false;
    let destroyed = false;
    const mirrors = new ProgressMirrors({ document });
    const rows = new SnapshotList(byId('feedback-rows'), {
        create: () => {
            const row = document.createElement('div');
            const label = document.createElement('p');
            const bar = document.createElement('div'); bar.className = 'progress-meter';
            const fill = document.createElement('div'); fill.className = 'progress-meter__fill'; bar.append(fill);
            const buttons = document.createElement('div'); buttons.className = 'action-group';
            row.append(label, bar, buttons);
            const meter = new ProgressMeter(bar, { contextClass: 'progress-meter--context' });
            const actions = new ActionGroup(buttons, { onAction: async (action, { button }) => {
                actions.setPending([action], true);
                await new Promise(resolve => document.defaultView.setTimeout(resolve, 100));
                if (actions.destroyed) return;
                byId('feedback-action-result').textContent = `${action} completed`;
                actions.setPending([action], false);
                button.focus();
            } });
            row.feedback = { label, meter, actions };
            return { element: row, dispose: () => { meter.destroy(); actions.destroy(); } };
        },
        update: (row, snapshot) => {
            row.feedback.label.textContent = snapshot.label;
            row.feedback.meter.update({ fraction: snapshot.fraction, context: snapshot.context });
            row.feedback.actions.update([{ id: 'view', label: 'View' }, { id: 'retry', label: 'Retry' }]);
        }
    });
    const render = () => {
        rows.render([{ id: 'sample', label: `${context ? 'Context import' : 'Response'} ${Math.round(fraction * 100)}%`, fraction, context }]);
        mirrors.update([byId('feedback-mirror')], { active: true, fraction, context });
    };
    const follow = new FollowScroll(byId('feedback-output'), { canScroll: ({ force }) => force || (byId('feedback-follow').checked && !FollowScroll.hasSelection(byId('feedback-output'))), isFollowing: () => byId('feedback-follow').checked });
    let lines = 0;
    const append = () => { byId('feedback-output').textContent += `Output line ${++lines}\n`; follow.request(); };
    byId('feedback-context').addEventListener('click', () => { context = true; fraction = 0.6; render(); }, { signal: events.signal });
    byId('feedback-update').addEventListener('click', () => { context = false; fraction = fraction === 0 ? 0.5 : 0.75; render(); }, { signal: events.signal });
    byId('feedback-zero').addEventListener('click', () => { context = false; fraction = 0; render(); }, { signal: events.signal });
    byId('feedback-clear').addEventListener('click', () => { rows.clear(); mirrors.update([], { active: false }); }, { signal: events.signal });
    byId('feedback-append').addEventListener('click', append, { signal: events.signal });
    byId('feedback-follow').addEventListener('change', () => { if (byId('feedback-follow').checked) follow.request({ force: true }); }, { signal: events.signal });
    const destroy = () => {
        if (destroyed) return; destroyed = true;
        rows.destroy(); mirrors.destroy(); follow.destroy(); events.abort();
        for (const control of section.querySelectorAll('button,input')) control.disabled = true;
    };
    byId('feedback-destroy').addEventListener('click', destroy, { signal: events.signal });
    render(); for (let index = 0; index < 20; index++) append();
    return destroy;
}
