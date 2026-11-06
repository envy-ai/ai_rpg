(() => {
    'use strict';
    const session = document.getElementById('log-session');
    const filter = document.getElementById('log-filter');
    const list = document.getElementById('log-files');
    const count = document.getElementById('log-count');
    const filename = document.getElementById('log-filename');
    const metadata = document.getElementById('log-metadata');
    const content = document.getElementById('log-content');
    const lines = document.getElementById('log-lines');
    const errorDialog = document.getElementById('log-error');
    const errorLifecycle = new window.AIRPG_WIDGETS.NativeDialog(errorDialog);
    const gutter = new window.AIRPG_WIDGETS.TextGutter(content, lines);
    const fileChoices = new window.AIRPG_WIDGETS.CollectionView(list);
    const listeners = new AbortController();
    const options = { signal: listeners.signal };
    let disposed = false;
    let files = [];
    let selectedName = null;
    let listRequest = null;
    let fileRequest = null;

    // The active Tools styling remains, but the menu should not cover the viewer on arrival.
    document.querySelector('.app-tools-menu').open = false;

    function reportError(error) {
        if (disposed) return;
        document.getElementById('log-error-details').textContent = error.stack || String(error);
        if (!errorDialog.open) errorLifecycle.whenClosed().then(() => {
            if (!disposed && !errorDialog.open) errorLifecycle.open();
        });
    }

    async function request(url, signal) {
        const response = await fetch(url, { signal, cache: 'no-store' });
        const data = await response.json();
        if (!response.ok || !data.success) {
            const error = new Error(data.error || `Log request failed (HTTP ${response.status}).`);
            if (data.stack) error.stack += `\n\nServer backtrace:\n${data.stack}`;
            throw error;
        }
        return data;
    }

    function clearReader(message) {
        fileRequest?.abort();
        selectedName = null;
        filename.textContent = 'Select a log file';
        metadata.textContent = message;
        gutter.setText('');
    }

    function markSelection() {
        for (const button of list.querySelectorAll('button')) {
            const active = button.dataset.filename === selectedName;
            button.classList.toggle('active', active);
            if (active) button.setAttribute('aria-current', 'true');
            else button.removeAttribute('aria-current');
        }
    }

    async function selectFile(file) {
        if (disposed) return;
        clearReader('Loading log…');
        selectedName = file.name;
        filename.textContent = file.name;
        markSelection();
        const controller = new AbortController();
        fileRequest = controller;
        try {
            const query = new URLSearchParams({ session: session.value, name: file.name });
            const data = await request(`/api/log-viewer/file?${query}`, controller.signal);
            if (disposed || controller.signal.aborted) return;
            const lineCount = gutter.setText(data.file.content, { resetScroll: true });
            metadata.textContent = `Created: ${new Date(data.file.createdAt).toLocaleString()} · ${data.file.size.toLocaleString()} bytes · ${lineCount.toLocaleString()} lines`;
        } catch (error) {
            if (disposed || controller.signal.aborted) return;
            metadata.textContent = 'Unable to load this log.';
            reportError(error);
        }
    }

    function renderFiles() {
        if (disposed) return;
        const terms = filter.value.toLowerCase().split(/\s+/).filter(Boolean);
        const visible = files.filter(file => terms.every(term => file.name.toLowerCase().includes(term)));
        count.textContent = `${visible.length} / ${files.length} files`;
        fileChoices.render({
            items: visible,
            keepVisibleWhenEmpty: true,
            renderItem: file => {
                const entryListeners = new AbortController();
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'story-tools-page-button log-viewer__file';
                button.dataset.filename = file.name;
                const name = document.createElement('span');
                name.textContent = file.name;
                const date = document.createElement('time');
                date.dateTime = file.createdAt;
                date.textContent = new Date(file.createdAt).toLocaleString();
                button.append(name, date);
                button.addEventListener('click', () => selectFile(file), { signal: entryListeners.signal });
                return { element: button, dispose: () => entryListeners.abort() };
            }
        });
        if (!visible.length) {
            clearReader(files.length ? 'No filenames match your filter.' : 'No files in this session.');
        } else if (!visible.some(file => file.name === selectedName)) {
            selectFile(visible[0]);
        }
        markSelection();
    }

    async function loadFiles() {
        if (disposed) return;
        listRequest?.abort();
        clearReader('Loading files…');
        files = [];
        fileChoices.clear();
        count.textContent = 'Loading…';
        const controller = new AbortController();
        listRequest = controller;
        try {
            const data = await request(`/api/log-viewer/files?${new URLSearchParams({ session: session.value })}`, controller.signal);
            if (disposed || controller.signal.aborted) return;
            files = data.files;
            renderFiles();
        } catch (error) {
            if (disposed || controller.signal.aborted) return;
            count.textContent = 'Unable to load files';
            metadata.textContent = 'Unable to load files. Use Refresh to retry.';
            reportError(error);
        }
    }

    filter.addEventListener('input', renderFiles, options);
    session.addEventListener('change', loadFiles, options);
    document.getElementById('log-refresh').addEventListener('click', loadFiles, options);
    window.addEventListener('pagehide', event => {
        if (event.persisted) return;
        disposed = true;
        listeners.abort();
        listRequest?.abort();
        fileRequest?.abort();
        const errors = [];
        for (const owner of [errorLifecycle, fileChoices, gutter]) {
            try { owner.destroy(); }
            catch (error) { errors.push(error); }
        }
        if (errors.length === 1) throw errors[0];
        if (errors.length) throw new AggregateError(errors, 'Log Viewer cleanup failed.', { cause: errors[0] });
    }, options);
    loadFiles();
})();
