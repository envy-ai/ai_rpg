(() => {
    'use strict';
    // Page-local demand cache. Loading another save reloads Play and drops these identities/jobs.
    const records = new Map();
    const keyOf = (type, id) => `${type}:${id}`;
    const element = (tag, className, text) => {
        const item = document.createElement(tag);
        if (className) item.className = className;
        if (text !== undefined) item.textContent = text;
        return item;
    };
    const report = error => {
        console.error('Action image failed:', error);
        window.AIRPG_PAGE_FEEDBACK.showError(error);
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
            const { options, record } = entry.target.__actionImage;
            if (!record.promise) {
                record.promise = render(entry.target, options, record.imageId).then(result => {
                    record.imageId = result?.imageId || record.imageId;
                    return result;
                }).catch(error => { record.error = error; report(error); return null; });
            } else {
                record.promise.then(() => {
                    if (!entry.target.isConnected) return;
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
                if (host.__actionImage?.record === record && record.imageId) await render(host, options, record.imageId);
            }
            return result;
        } catch (error) { record.error = error; throw error; }
        finally { record.regenerating = null; }
    }
    function create(options) {
        if (!['ability', 'technique', 'discipline'].includes(options?.entityType) || !options.entityId) throw new Error('An action icon requires an ability, technique or discipline identity.');
        const record = getRecord(options);
        const wrapper = element('div', 'action-image');
        const host = element('div', 'action-image-host');
        host.dataset.imageLazy = 'true';
        host.dataset.imageEntityType = options.entityType;
        host.dataset.imageEntityId = options.entityId;
        host.dataset.imagePlaceholder = '✦';
        host.dataset.imagePlaceholderClass = 'action-image-placeholder';
        host.__actionImage = { options, record };
        host.append(element('span', 'action-image-placeholder', '✦'));
        wrapper.append(host);
        const menu = element('details', 'action-image-menu');
        const toggle = element('summary', '', '•••');
        toggle.setAttribute('aria-label', `Image options for ${options.name}`);
        const actions = element('div', 'action-image-menu-actions');
        const add = (label, handler) => {
            const control = element('button', '', label);
            control.type = 'button';
            control.addEventListener('click', async event => {
                event.stopPropagation();
                control.disabled = true;
                try { await handler(); }
                catch (error) { report(error); }
                finally { control.disabled = false; }
            });
            actions.append(control);
        };
        add('Regenerate image', () => regenerate(options, record));
        add('Use saved prompt', () => regenerate(options, record, { useExistingPrompt: true }));
        add('Edit image prompt…', () => {
            const submitHandler = prompt => regenerate(options, record, { prompt });
            if (record.imagePrompt) {
                window.openEntityImagePromptModal({ ...options, entityName: options.name, prompt: record.imagePrompt, submitHandler });
                return;
            }
            return window.openEditableImagePromptForEntity({ ...options, entityName: options.name, submitHandler });
        });
        menu.append(toggle, actions);
        window.AIRPG_WIDGETS.PopupDismissal.bind(menu, { trigger: toggle });
        wrapper.append(menu);
        observer.observe(host);
        return wrapper;
    }
    window.addEventListener('image:prompt-updated', event => {
        const detail = event.detail || {};
        const record = records.get(keyOf(detail.entityType, detail.entityId));
        if (record) record.imagePrompt = detail.imagePrompt;
    });
    window.addEventListener('image:updated', event => {
        const detail = event.detail || {};
        const record = records.get(keyOf(detail.entityType, detail.entityId));
        if (record && detail.imageId) record.imageId = detail.imageId;
    });
    // Release detached, never-visible observations as lists are replaced.
    new MutationObserver(() => {
        for (const host of pendingHosts) if (!host.isConnected) { observer.unobserve(host); pendingHosts.delete(host); }
    }).observe(document.documentElement, { childList: true, subtree: true });
    const pendingHosts = new Set();
    window.ActionImages = { create: options => {
        const wrapper = create(options);
        pendingHosts.add(wrapper.firstElementChild);
        return wrapper;
    } };
})();
