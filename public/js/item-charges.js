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
    let state = null;
    let generation = 0;
    let lifecycle = null;

    const numberText = value => String(value);
    const newOperationId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    const unitLabel = pool => pool.unit || (pool.mode === 'discrete' ? 'rounds' : 'charge');
    const errorText = error => `${error.message || error}${error.stack ? `\n${error.stack}` : ''}`;
    function setStatus(message, kind = '') {
        status.textContent = message;
        status.dataset.kind = kind;
        status.hidden = !message;
    }
    function available(source) {
        return Number(source.count);
    }
    function compatible(source) {
        return !state.options.chargePool.ammoType || source.ammoType === state.options.chargePool.ammoType;
    }
    function selectedSource() {
        return state?.options?.sources?.find(source => source.id === state.selectedId);
    }
    function resetOperation() {
        if (state && !state.busy) state.operationId = null;
    }
    function updatePreview() {
        if (!state?.options) return;
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
        sources.replaceChildren();
        const query = search.value.trim().toLowerCase();
        const matches = state.options.sources.filter(source => source.name.toLowerCase().includes(query));
        if (!matches.length) {
            const empty = document.createElement('p');
            empty.textContent = 'No ammunition stacks match.';
            sources.append(empty);
        }
        for (const source of matches) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'item-charge-reload__source';
            button.dataset.ammoId = source.id;
            button.setAttribute('aria-pressed', String(source.id === state.selectedId));
            button.disabled = !compatible(source) || available(source) <= 0 || state.busy;
            const name = document.createElement('strong');
            name.textContent = source.name;
            const detail = document.createElement('span');
            detail.textContent = `${numberText(available(source))} available${compatible(source) ? '' : ' · Incompatible'}`;
            button.append(name, detail);
            button.addEventListener('click', () => select(source.id));
            button.draggable = !button.disabled;
            button.addEventListener('dragstart', event => event.dataTransfer.setData('text/plain', source.id));
            sources.append(button);
        }
    }
    function select(id) {
        if (state.busy) return;
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
        if (state?.busy) return;
        generation++;
        if (dialog.open) lifecycle.close();
        state = null;
    }
    async function openDialog(item, { trigger = document.activeElement, onSuccess = null, ammoId = null } = {}) {
        if (!item?.id || item.chargePool?.mode !== 'discrete') throw new Error('Reload requires a discrete ammunition item.');
        lifecycle ||= new window.AIRPG_WIDGETS.NativeDialog(dialog);
        if (state?.busy) throw new Error('A reload is already in progress.');
        if (dialog.open) closeDialog();
        const thisGeneration = ++generation;
        await lifecycle.whenClosed();
        if (generation !== thisGeneration) return;
        state = { item, trigger, onSuccess, selectedId: null, operationId: null, busy: false, options: null };
        title.textContent = `Reload ${item.name || 'item'}`;
        summary.textContent = `${item.name}: ${numberText(item.chargePool.amount)} / ${numberText(item.chargePool.capacity)} ${unitLabel(item.chargePool)}`;
        sources.replaceChildren();
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
            if (!response.ok) {
                const error = new Error(result.error || 'Failed to load ammunition options.');
                if (result.stack) error.stack = result.stack;
                throw error;
            }
            if (generation !== thisGeneration) return;
            if (!result?.chargePool || !Array.isArray(result.sources)) throw new Error('Reload options response is incomplete.');
            state.options = result;
            state.item = { ...item, chargePool: result.chargePool };
            summary.textContent = `${item.name}: ${numberText(result.chargePool.amount)} / ${numberText(result.chargePool.capacity)} ${unitLabel(result.chargePool)}${result.chargePool.ammoType ? ` · ${result.chargePool.ammoType}` : ''}`;
            unit.textContent = unitLabel(result.chargePool);
            amount.step = '1';
            setStatus('');
            renderSources();
            const initial = result.sources.find(source => source.id === ammoId && compatible(source));
            if (initial) select(initial.id);
            else updatePreview();
        } catch (error) {
            if (generation === thisGeneration) setStatus(errorText(error), 'error');
        }
    }
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (!state?.options || state.busy) return;
        updatePreview();
        if (submit.disabled) return;
        const source = selectedSource();
        const value = Number(amount.value);
        state.operationId ||= newOperationId();
        state.busy = true;
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
            const response = await fetch(`/api/things/${encodeURIComponent(state.item.id)}/reload`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ammoItemId: source.id, amount: value, operationId: state.operationId })
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                const error = new Error(result.error || 'Reload failed.');
                if (result.stack) error.stack = result.stack;
                throw error;
            }
            const callback = state.onSuccess;
            state.busy = false;
            lifecycle.setPending(false);
            closeDialog();
            await callback?.(result);
            document.dispatchEvent(new Event('inventory:updated'));
            window.dispatchEvent(new CustomEvent('techniques:refresh'));
        } catch (error) {
            if (state) setStatus(errorText(error), 'error');
            window.AIRPG_PAGE_FEEDBACK?.showError(error);
        } finally {
            if (state) {
                state.busy = false;
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
    });
    search.addEventListener('input', () => { if (state?.options && !state.busy) renderSources(); });
    amount.addEventListener('input', () => { if (state?.busy) return; resetOperation(); updatePreview(); });
    slot.addEventListener('dragover', event => { if (!state?.busy) event.preventDefault(); });
    slot.addEventListener('drop', event => {
        if (state?.busy) return;
        event.preventDefault();
        const id = event.dataTransfer.getData('text/plain');
        if (state?.options?.sources?.some(source => source.id === id && compatible(source))) select(id);
    });
    cancel.addEventListener('click', closeDialog);
    close.addEventListener('click', closeDialog);
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
    dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(); });
    window.AIRPG_ITEM_CHARGES = { openReload: openDialog };
})();
