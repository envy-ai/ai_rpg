(() => {
    'use strict';
    // Page-local demand cache. Loading another save reloads Play and drops these identities/jobs.
    const records = new Map();
    const owners = new WeakMap();
    const pendingHosts = new Set();
    const subscriptions = new AbortController();
    let pageDisposed = false;
    const keyOf = (type, id) => `${type}:${id}`;
    const element = (tag, className, text) => {
        const item = document.createElement(tag);
        if (className) item.className = className;
        if (text !== undefined) item.textContent = text;
        return item;
    };
    const report = error => {
        console.error('Action image failed:', error);
        if (!pageDisposed) window.AIRPG_PAGE_FEEDBACK.showError(error);
    };
    const render = (host, options, imageId, force = false) => window.renderEntityImage({
        element: host, entityType: options.entityType, entityId: options.entityId,
        imageId, altText: options.name, placeholderIcon: '✦',
        placeholderClass: 'action-image-placeholder', enableLightbox: true,
        propagateError: true, force
    });
    const observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.unobserve(entry.target);
            pendingHosts.delete(entry.target);
            const state = entry.target.__actionImage;
            if (state.disposed || pageDisposed) continue;
            const { options, record } = state;
            if (!record.promise) {
                record.promise = render(entry.target, options, record.imageId).then(result => {
                    record.imageId = result?.imageId || record.imageId;
                    return result;
                }).catch(error => { record.error = error; report(error); return null; });
            } else {
                record.promise.then(() => {
                    if (state.disposed || pageDisposed || !entry.target.isConnected) return;
                    if (record.imageId) render(entry.target, options, record.imageId).catch(report);
                    else if (record.error) entry.target.title = record.error.message;
                });
            }
        }
    });
    function getRecord(options) {
        const key = keyOf(options.entityType, options.entityId);
        if (!records.has(key)) records.set(key, { imageId: options.imageId || null, imagePrompt: options.imagePrompt || '', promise: null });
        const record = records.get(key);
        if (options.imageId && !record.imageId) record.imageId = options.imageId;
        if (options.imagePrompt && !record.imagePrompt) record.imagePrompt = options.imagePrompt;
        return record;
    }
    async function regenerate(options, record, extra = {}) {
        if (record.regenerating) return record.regenerating;
        record.error = null;
        const manager = window.AIRPG?.imageManager;
        if (!manager) throw new Error('Image generation manager is unavailable.');
        record.regenerating = manager.ensureImage({ entityType: options.entityType, entityId: options.entityId, existingImageId: record.imageId, force: true, ...extra });
        record.promise = record.regenerating.catch(error => { record.error = error; return null; });
        try {
            const result = await record.regenerating;
            record.imageId = result?.imageId || record.imageId;
            const hosts = document.querySelectorAll('.action-image-host');
            for (const host of hosts) {
                if (!pageDisposed && !host.__actionImage?.disposed && host.__actionImage?.record === record && record.imageId) await render(host, options, record.imageId);
            }
            return result;
        } catch (error) { record.error = error; throw error; }
        finally { record.regenerating = null; }
    }
    function create(options) {
        if (pageDisposed) throw new Error('Action images belong to a disposed page. Create them in the active page.');
        if (!['ability', 'technique', 'discipline', 'favor'].includes(options?.entityType) || !options.entityId) throw new Error('An action icon requires an ability, technique, discipline or favor identity.');
        const record = getRecord(options);
        const wrapper = element('div', 'action-image');
        const host = element('div', 'action-image-host');
        host.dataset.imageLazy = 'true';
        host.dataset.imageEntityType = options.entityType;
        host.dataset.imageEntityId = options.entityId;
        host.dataset.imagePlaceholder = '✦';
        host.dataset.imagePlaceholderClass = 'action-image-placeholder';
        host.__actionImage = { options, record, disposed: false };
        host.append(element('span', 'action-image-placeholder', '✦'));
        wrapper.append(host);
        const menu = element('details', 'action-image-menu');
        const toggle = element('summary', '', '•••');
        toggle.setAttribute('aria-label', `Image options for ${options.name}`);
        const actions = element('div', 'action-image-menu-actions');
        const listeners = new AbortController();
        const owner = { wrapper, host, listeners, popup: null };
        owners.set(wrapper, owner);
        owners.set(host, owner);
        const add = (label, handler) => {
            const control = element('button', '', label);
            control.type = 'button';
            control.addEventListener('click', async event => {
                event.stopPropagation();
                control.disabled = true;
                try { await handler(); }
                catch (error) { report(error); }
                finally { if (!host.__actionImage.disposed) control.disabled = false; }
            }, { signal: listeners.signal });
            actions.append(control);
        };
        add('Regenerate image', () => regenerate(options, record));
        add('Use saved prompt', () => regenerate(options, record, { useExistingPrompt: true }));
        add('Edit image prompt…', () => {
            const isCurrent = () => !pageDisposed;
            if (!isCurrent()) return;
            const submitHandler = prompt => regenerate(options, record, { prompt });
            if (record.imagePrompt) {
                window.openEntityImagePromptModal({ ...options, entityName: options.name, prompt: record.imagePrompt, submitHandler });
                return;
            }
            return window.openEditableImagePromptForEntity({ ...options, entityName: options.name, submitHandler, isCurrent });
        });
        const editEntity = options.entityType === 'technique' ? options.onEditTechnique
            : options.entityType === 'discipline' ? options.onEditDiscipline : undefined;
        if (typeof editEntity === 'function') {
            add(`Edit ${options.entityType}…`, async () => {
                const isCurrent = () => !pageDisposed && !host.__actionImage.disposed && wrapper.isConnected;
                if (!isCurrent()) return;
                try { await editEntity({ signal: listeners.signal, isCurrent, returnFocus: toggle }); }
                catch (error) { if (!listeners.signal.aborted && isCurrent()) throw error; }
            });
        }
        menu.append(toggle, actions);
        owner.popup = window.AIRPG_WIDGETS.PopupDismissal.bind(menu, { trigger: toggle });
        wrapper.append(menu);
        observer.observe(host);
        pendingHosts.add(host);
        return wrapper;
    }
    function release(wrapper) {
        const owner = owners.get(wrapper);
        if (!owner) return;
        owners.delete(owner.wrapper);
        owners.delete(owner.host);
        owner.host.__actionImage.disposed = true;
        const errors = [];
        for (const dispose of [
            () => owner.listeners.abort(),
            () => observer.unobserve(owner.host),
            () => pendingHosts.delete(owner.host),
            () => owner.popup?.destroy(),
            () => window.AIRPG_WIDGETS.ImageFrame.destroyWithin(owner.host)
        ]) {
            try { dispose(); } catch (error) { errors.push(error); }
        }
        if (errors.length === 1) throw errors[0];
        if (errors.length) throw new AggregateError(errors, 'Action image disposal failed.', { cause: errors[0] });
    }
    function destroyWithin(root) {
        if (!root?.querySelectorAll) throw new TypeError('ActionImages.destroyWithin requires a DOM subtree.');
        const errors = [];
        for (const wrapper of [root, ...root.querySelectorAll('.action-image')]) {
            try { release(wrapper); } catch (error) { errors.push(error); }
        }
        if (errors.length === 1) throw errors[0];
        if (errors.length) throw new AggregateError(errors, 'Action image subtree disposal failed.', { cause: errors[0] });
    }
    window.addEventListener('image:prompt-updated', event => {
        const detail = event.detail || {};
        const record = records.get(keyOf(detail.entityType, detail.entityId));
        if (record) record.imagePrompt = detail.imagePrompt;
    }, { signal: subscriptions.signal });
    window.addEventListener('image:updated', event => {
        const detail = event.detail || {};
        const record = records.get(keyOf(detail.entityType, detail.entityId));
        if (record && detail.imageId) record.imageId = detail.imageId;
    }, { signal: subscriptions.signal });
    // Release the same native icon owner when any existing caller removes its subtree.
    const detachObserver = new MutationObserver(records => {
        for (const record of records) for (const node of record.removedNodes) {
            if (node.nodeType === 1 && !node.isConnected) destroyWithin(node);
        }
        for (const host of pendingHosts) if (!host.isConnected) release(host);
    });
    detachObserver.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('pagehide', event => {
        if (event.persisted) return;
        pageDisposed = true;
        subscriptions.abort();
        observer.disconnect();
        detachObserver.disconnect();
        const errors = [];
        for (const dispose of [...Array.from(pendingHosts, host => () => release(host)), () => destroyWithin(document.documentElement)]) {
            try { dispose(); } catch (error) { errors.push(error); }
        }
        if (errors.length === 1) throw errors[0];
        if (errors.length) throw new AggregateError(errors, 'Action image page disposal failed.', { cause: errors[0] });
    });
    window.ActionImages = { create, destroyWithin };
})();
