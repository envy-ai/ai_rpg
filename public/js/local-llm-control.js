(() => {
    'use strict';
    function init() {
        const button = document.getElementById('appHeaderLocalLlmToggle');
        const header = button?.closest('.app-header');
        if (!button || !header) return;
        let current = null;
        let pending = false;
        let revision = 0;
        let timer;
        let closed = false;
        let lastError = null;
        function showError(error, force = false) {
            const signature = error.stack || error.message;
            if (!force && signature === lastError) return;
            lastError = signature;
            window.AIRPG_PAGE_FEEDBACK.showError(error);
        }
        function apply(status) {
            current = status;
            button.hidden = !status.configured;
            header.classList.toggle('app-header--local-llm', Boolean(status.configured));
            if (!status.configured) return;
            const busy = pending || ['waiting', 'starting', 'stopping'].includes(status.state);
            const enabled = status.nextEnabled;
            const action = enabled ? 'Turn on' : 'Turn off';
            const visibleState = pending && !['starting', 'stopping'].includes(status.state) ? 'waiting' : status.state;
            const stateLabel = visibleState[0].toUpperCase() + visibleState.slice(1);
            button.dataset.state = visibleState;
            button.disabled = busy;
            button.setAttribute('aria-busy', String(busy));
            button.setAttribute('aria-pressed', String(status.desiredOn));
            button.setAttribute('aria-label', `Local LLM: ${stateLabel}. ${status.state === 'error' ? 'Retry: ' : ''}${action}.`);
            button.title = button.getAttribute('aria-label');
            button.querySelector('.app-header-local-llm__status').textContent = stateLabel;
            if (status.error) {
                const error = new Error(status.error.message);
                error.stack = status.error.stack || error.stack;
                showError(error);
            } else lastError = null;
        }
        async function request(options) {
            const response = await fetch('/api/local-llm', options);
            const result = await response.json();
            if (!response.ok || !result.success) {
                if (result.status) apply(result.status);
                const error = new Error(result.error || `Local LLM request failed: HTTP ${response.status}`);
                error.stack = result.stack || error.stack;
                throw error;
            }
            return result;
        }
        async function refresh() {
            const observedRevision = revision;
            try {
                const status = await request();
                if (observedRevision === revision) apply(status);
            } catch (error) {
                if (observedRevision === revision) {
                    if (current?.configured) apply({ ...current, state: 'error', error: { message: error.message, stack: error.stack } });
                    else showError(error);
                }
            } finally { if (!closed) timer = setTimeout(refresh, 2000); }
        }
        button.addEventListener('click', async () => {
            if (!current?.configured || pending) return;
            const enabled = current.nextEnabled;
            pending = true;
            revision += 1;
            apply({ ...current, state: 'waiting', error: null });
            try {
                const status = await request({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
                pending = false;
                revision += 1;
                apply(status);
            } catch (error) {
                pending = false;
                revision += 1;
                apply({ ...current, state: 'error', error: { message: error.message, stack: error.stack } });
            }
        });
        window.addEventListener('pagehide', () => { closed = true; clearTimeout(timer); });
        void refresh();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
