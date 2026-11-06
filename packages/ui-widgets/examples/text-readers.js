import { updateSelectableText, TextGutter, FollowScroll } from '../src/index.js';

export function mountTextReaders(parent) {
    const document = parent.ownerDocument;
    const section = document.createElement('section');
    section.id = 'text-readers-example';
    section.innerHTML = `<h2>Literal text readers</h2>
        <p>Select text in the output, then stream an update without replacing its text node.</p>
        <label><input id="text-reader-follow" type="checkbox" checked>Follow streamed output</label>
        <button id="text-reader-append">Append output</button>
        <pre id="text-reader-output"></pre>
        <label for="text-reader-source">Literal source text</label>
        <textarea id="text-reader-source" rows="3" spellcheck="false"></textarea>
        <button id="text-reader-apply">Display source</button>
        <div class="text-reader-gutter-layout"><pre id="text-reader-gutter" aria-hidden="true"></pre><textarea id="text-reader-content" aria-label="Read-only literal text" readonly wrap="off" spellcheck="false"></textarea></div>
        <p id="text-reader-lines" role="status"></p>
        <button id="text-reader-destroy">Destroy reader bindings</button>`;
    parent.append(section);
    const byId = id => section.querySelector(`#${id}`);
    const events = new document.defaultView.AbortController();
    const output = byId('text-reader-output');
    const followCheckbox = byId('text-reader-follow');
    const follow = new FollowScroll(output, {
        isFollowing: () => followCheckbox.checked,
        canScroll: () => !FollowScroll.hasSelection(output)
    });
    const gutter = new TextGutter(byId('text-reader-content'), byId('text-reader-gutter'));
    let count = 0;
    const append = () => {
        const previousText = output.textContent;
        const appendedText = `Streamed literal line ${++count}: <example> & text\n`;
        const nextText = previousText + appendedText;
        updateSelectableText(output, nextText, { previousText, appendedText, nextText });
        follow.request();
    };
    const apply = () => {
        const count = gutter.setText(byId('text-reader-source').value, { resetScroll: true });
        byId('text-reader-lines').textContent = `${count} lines`;
    };
    byId('text-reader-source').value = '<literal> & text\nSecond line\n';
    byId('text-reader-append').addEventListener('click', append, { signal: events.signal });
    byId('text-reader-apply').addEventListener('click', apply, { signal: events.signal });
    followCheckbox.addEventListener('change', () => { if (followCheckbox.checked) follow.request(); }, { signal: events.signal });
    let destroyed = false;
    const destroy = () => {
        if (destroyed) return;
        destroyed = true;
        events.abort();
        follow.destroy();
        gutter.destroy();
        for (const control of section.querySelectorAll('button,input')) control.disabled = true;
    };
    byId('text-reader-destroy').addEventListener('click', destroy, { signal: events.signal });
    for (let index = 0; index < 12; index++) append();
    apply();
    return destroy;
}
