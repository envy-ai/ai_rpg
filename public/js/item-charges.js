(function () {
    'use strict';

    const dialog = document.getElementById('itemChargeReloadDialog');
    if (!dialog) return;
    const form = document.getElementById('itemChargeReloadForm');
    const title = document.getElementById('itemChargeReloadTitle');
    const summary = document.getElementById('itemChargeReloadSummary');
    const sources = document.getElementById('itemChargeReloadSources');
    const search = document.getElementById('itemChargeReloadSearch');
    const slot = document.getElementById('itemChargeReloadSlot');
    const amount = document.getElementById('itemChargeReloadAmount');
    const unit = document.getElementById('itemChargeReloadUnit');
    const hint = document.getElementById('itemChargeReloadHint');
    const preview = document.getElementById('itemChargeReloadPreview');
    const status = document.getElementById('itemChargeReloadStatus');
    const submit = document.getElementById('itemChargeReloadSubmit');
    const cancel = document.getElementById('itemChargeReloadCancel');
    const close = document.getElementById('itemChargeReloadClose');
    const listeners = new AbortController();
    const events = { signal: listeners.signal };
    const sourceView = new window.AIRPG_WIDGETS.CollectionView(sources);
    const statusView = new window.AIRPG_WIDGETS.StatusSurface(status, { stateAttribute: 'data-kind' });
    let state = null;
    let generation = 0;
    let disposed = false;
    const lifecycle = new window.AIRPG_WIDGETS.NativeDialog(dialog, { onClose: () => {
        if (disposed) return;
        lifecycle.setPending(false);
        if (!state) return; // An owned close already retired its state before queued close processing.
        generation++;
        state = null;
        sourceView.clear();
    } });

    const numberText = value => String(value);
    const newOperationId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    const unitLabel = pool => pool.unit || (pool.mode === 'discrete' ? 'rounds' : 'charge');
    const errorText = error => `${error.message || error}${error.stack ? `\n${error.stack}` : ''}`;
    function setStatus(message, kind = '') {
        statusView.update({ text: message, state: kind });
    }
    function available(source) { return Number(source.count); }
    function compatible(source) {
        return !state.options.chargePool.ammoType || source.ammoType === state.options.chargePool.ammoType;
    }
    function selectedSource() { return state?.options?.sources?.find(source => source.id === state.selectedId); }
    function resetOperation() { if (state && !state.busy) state.operationId = null; }
    function updatePreview() {
        if (disposed || !state?.options) return;
        const pool = state.options.chargePool;
        const source = selectedSource();
        const raw = amount.value.trim();
        const value = Number(raw);
        const capacityAvailable = Number(state.options.capacityAvailable);
        const valid = Boolean(source && compatible(source) && raw && Number.isFinite(value) && value > 0
            && Number.isSafeInteger(value)
            && value <= available(source) && value <= capacityAvailable);
        submit.disabled = state.busy || !valid;
        hint.textContent = source ? `Up to ${numberText(Math.min(available(source), capacityAvailable))} ${unitLabel(pool)} fit.` : 'Select compatible ammunition.';
        preview.textContent = valid
            ? `${state.item.name}: ${numberText(Number(pool.amount) + value)} / ${numberText(pool.capacity)} ${unitLabel(pool)}. Loose ammunition: ${numberText(available(source) - value)} remaining.`
            : 'Choose a source and enter an amount to preview the load.';
        submit.textContent = valid ? `Load ${numberText(value)} ${unitLabel(pool)}` : 'Load ammunition';
    }
    function renderSources() {
        if (disposed || !state?.options) return;
        const owner = state;
        const query = search.value.trim().toLowerCase();
        const matches = owner.options.sources.filter(source => source.name.toLowerCase().includes(query));
        sourceView.render({ items: matches, keepVisibleWhenEmpty: true, renderItem: source => {
            const lifetime = new AbortController();
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'item-charge-reload__source';
            button.dataset.ammoId = source.id;
            button.setAttribute('aria-pressed', String(source.id === owner.selectedId));
            button.disabled = !compatible(source) || available(source) <= 0 || owner.busy;
            const name = document.createElement('strong');
            name.textContent = source.name;
            const detail = document.createElement('span');
            detail.textContent = `${numberText(available(source))} available${compatible(source) ? '' : ' · Incompatible'}`;
            button.append(name, detail);
            button.addEventListener('click', () => {
                if (!disposed && state === owner && !owner.busy) select(source.id);
            }, { signal: lifetime.signal });
            button.draggable = !button.disabled;
            button.addEventListener('dragstart', event => {
                if (disposed || state !== owner || owner.busy) { event.preventDefault(); return; }
                event.dataTransfer.setData('text/plain', source.id);
            }, { signal: lifetime.signal });
            return { element: button, dispose: () => lifetime.abort() };
        } });
        if (!matches.length) {
            const empty = document.createElement('p');
            empty.textContent = 'No ammunition stacks match.';
            sources.append(empty);
        }
    }
    function select(id) {
        if (disposed || !state?.options || state.busy) return;
        state.selectedId = id;
        resetOperation();
        const source = selectedSource();
        slot.textContent = source ? `${source.name} · Selected` : 'Drag ammunition here or select a stack';
        renderSources();
        const maximum = source ? Math.min(available(source), Number(state.options.capacityAvailable)) : 0;
        amount.value = maximum > 0 ? String(maximum) : '';
        updatePreview();
    }
    function closeDialog() {
        if (disposed || state?.busy) return;
        generation++;
        if (dialog.open) lifecycle.close();
        state = null;
        sourceView.clear();
    }
    async function openDialog(item, { trigger = document.activeElement, onSuccess = null, ammoId = null } = {}) {
        if (disposed) throw new Error('Reload dialog owner has been disposed.');
        if (!item?.id || item.chargePool?.mode !== 'discrete') throw new Error('Reload requires a discrete ammunition item.');
        if (state?.busy) throw new Error('A reload is already in progress.');
        if (state || dialog.open) closeDialog();
        const thisGeneration = ++generation;
        await lifecycle.whenClosed();
        if (disposed || generation !== thisGeneration) return;
        const owner = { item, trigger, onSuccess, selectedId: null, operationId: null, busy: false, options: null };
        state = owner;
        title.textContent = `Reload ${item.name || 'item'}`;
        summary.textContent = `${item.name}: ${numberText(item.chargePool.amount)} / ${numberText(item.chargePool.capacity)} ${unitLabel(item.chargePool)}`;
        sourceView.clear();
        slot.textContent = 'Drag ammunition here or select a stack';
        search.value = '';
        amount.value = '';
        search.disabled = false;
        amount.disabled = false;
        slot.setAttribute('aria-disabled', 'false');
        form.removeAttribute('aria-busy');
        cancel.disabled = false;
        close.disabled = false;
        submit.disabled = true;
        setStatus('Loading ammunition…');
        lifecycle.open({ initialFocus: search, returnFocus: trigger });
        try {
            const response = await fetch(`/api/things/${encodeURIComponent(item.id)}/reload-options`);
            const result = await response.json();
            if (disposed || generation !== thisGeneration || state !== owner) return;
            if (!response.ok) {
                const error = new Error(result?.error || 'Failed to load ammunition options.');
                if (result?.stack) error.stack = result.stack;
                throw error;
            }
            if (!result?.chargePool || !Array.isArray(result.sources)) throw new Error('Reload options response is incomplete.');
            owner.options = result;
            owner.item = { ...item, chargePool: result.chargePool };
            summary.textContent = `${item.name}: ${numberText(result.chargePool.amount)} / ${numberText(result.chargePool.capacity)} ${unitLabel(result.chargePool)}${result.chargePool.ammoType ? ` · ${result.chargePool.ammoType}` : ''}`;
            unit.textContent = unitLabel(result.chargePool);
            amount.step = '1';
            setStatus('');
            renderSources();
            const initial = result.sources.find(source => source.id === ammoId && compatible(source));
            if (initial) select(initial.id);
            else updatePreview();
        } catch (error) {
            if (disposed || generation !== thisGeneration || state !== owner) return;
            console.error('Failed to load reload options:', error);
            setStatus(errorText(error), 'error');
            window.AIRPG_PAGE_FEEDBACK.showError(error, { returnFocus: search });
        }
    }
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (disposed || !state?.options || state.busy) return;
        updatePreview();
        if (submit.disabled) return;
        const owner = state;
        const source = selectedSource();
        const value = Number(amount.value);
        owner.operationId ||= newOperationId();
        owner.busy = true;
        lifecycle.setPending(true);
        submit.disabled = true;
        cancel.disabled = true;
        close.disabled = true;
        search.disabled = true;
        amount.disabled = true;
        slot.setAttribute('aria-disabled', 'true');
        form.setAttribute('aria-busy', 'true');
        sources.querySelectorAll('button').forEach(button => { button.disabled = true; });
        setStatus('Loading ammunition…');
        try {
            const response = await fetch(`/api/things/${encodeURIComponent(owner.item.id)}/reload`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ammoItemId: source.id, amount: value, operationId: owner.operationId })
            });
            const result = await response.json();
            if (!response.ok || !result?.success) {
                const error = new Error(result?.error || 'Reload failed.');
                if (result?.stack) error.stack = result.stack;
                throw error;
            }
            if (disposed) return;
            if (state === owner) {
                owner.busy = false;
                lifecycle.setPending(false);
                closeDialog();
            }
            // Committed success remains page-owned if an explicit native close opened another dialog.
            await owner.onSuccess?.(result);
            if (disposed) return;
            document.dispatchEvent(new Event('inventory:updated'));
            window.dispatchEvent(new CustomEvent('techniques:refresh'));
        } catch (error) {
            if (disposed) return;
            console.error('Reload operation failed:', error);
            if (state === owner) setStatus(errorText(error), 'error');
            window.AIRPG_PAGE_FEEDBACK.showError(error);
        } finally {
            if (!disposed && state === owner) {
                owner.busy = false;
                lifecycle.setPending(false);
                cancel.disabled = false;
                close.disabled = false;
                search.disabled = false;
                amount.disabled = false;
                slot.setAttribute('aria-disabled', 'false');
                form.removeAttribute('aria-busy');
                renderSources();
                updatePreview();
            }
        }
    }, events);
    search.addEventListener('input', () => { if (state?.options && !state.busy) renderSources(); }, events);
    amount.addEventListener('input', () => { if (state?.busy) return; resetOperation(); updatePreview(); }, events);
    slot.addEventListener('dragover', event => { if (!state?.busy) event.preventDefault(); }, events);
    slot.addEventListener('drop', event => {
        if (state?.busy) return;
        event.preventDefault();
        const id = event.dataTransfer.getData('text/plain');
        if (state?.options?.sources?.some(source => source.id === id && compatible(source))) select(id);
    }, events);
    cancel.addEventListener('click', closeDialog, events);
    close.addEventListener('click', closeDialog, events);
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); }, events);
    dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(); }, events);
    window.addEventListener('pagehide', event => {
        if (event.persisted) return;
        disposed = true;
        generation++;
        state = null;
        listeners.abort();
        const errors = [];
        for (const owner of [sourceView, statusView, lifecycle]) {
            try { owner.destroy(); } catch (error) { errors.push(error); }
        }
        if (errors.length === 1) throw errors[0];
        if (errors.length) throw new AggregateError(errors, 'Reload dialog cleanup failed.', { cause: errors[0] });
    }, events);
    window.AIRPG_ITEM_CHARGES = { openReload: openDialog };
})();
