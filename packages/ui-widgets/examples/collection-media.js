import { CollectionView, createCollectionEntry, ImageFrame, Lightbox } from '../src/index.js';

const sampleImage = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="#315c80"/><circle cx="120" cy="80" r="42" fill="#b8e4ee"/></svg>')}`;

export function mountCollectionMedia(parent) {
    const document = parent.ownerDocument;
    const section = document.createElement('section');
    section.id = 'collection-media-specimen';
    section.innerHTML = `<h2>Collection and image lifetimes</h2>
        <label>Presentation <select id="collection-mode"><option>list</option><option>grid</option><option>small-grid</option><option>table</option></select></label>
        <button type="button" id="collection-empty">Toggle empty</button>
        <button type="button" id="collection-render">Render</button>
        <p id="collection-count"></p><div id="collection-root" class="collection-view"></div><p id="collection-empty-state" hidden>No records.</p>
        <p>Disposed entries: <output id="collection-disposed">0</output></p>
        <button type="button" id="media-show">Open image and details</button>
        <button type="button" id="media-details">Open details only</button>
        <button type="button" id="media-destroy">Destroy owners</button>
        <p id="media-status" role="status"></p>`;
    const root = document.createElement('div');
    root.id = 'sample-lightbox';
    root.className = 'image-lightbox';
    root.hidden = true;
    root.tabIndex = -1;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Image viewer');
    root.innerHTML = `<div class="image-lightbox__inner"><button class="image-lightbox__close" type="button" aria-label="Close viewer">×</button><div class="image-lightbox__actions" hidden></div><div class="image-lightbox__media"><img class="image-lightbox__image" alt="" hidden><p class="image-lightbox__caption" hidden></p></div><div class="image-lightbox__details" hidden></div></div>`;
    parent.append(section);
    document.body.append(root);
    const byId = id => section.querySelector(`#${id}`);
    const part = name => root.querySelector(`.image-lightbox__${name}`);
    const listeners = new document.defaultView.AbortController();
    const lightbox = new Lightbox(root, {
        inner: part('inner'), media: part('media'), image: part('image'), caption: part('caption'),
        details: part('details'), actions: part('actions'), closeButton: part('close'),
        onError: error => { byId('media-status').textContent = `${error.message}\n${error.stack}`; }
    });
    let disposed = 0;
    let isEmpty = false;
    let destroyed = false;
    const view = new CollectionView(byId('collection-root'), {
        empty: byId('collection-empty-state'), count: byId('collection-count'),
        disposeContent: element => ImageFrame.destroyWithin(element)
    });
    const records = [{ name: 'First record' }, { name: 'Second record' }];
    const render = () => {
        const mode = byId('collection-mode').value;
        view.render({
            items: isEmpty ? [] : records, totalCount: records.length,
            countText: `${isEmpty ? 0 : records.length} of ${records.length} records`, emptyText: 'No visible records.', mode,
            showHeaders: true, columns: [{ label: 'Preview' }, { label: 'Name' }],
            renderItem: item => {
                const element = createCollectionEntry({ document, tagName: mode === 'table' ? 'tr' : 'div', className: 'sample-collection-entry' });
                const imageHost = document.createElement(mode === 'table' ? 'td' : 'div');
                imageHost.className = 'sample-image-frame';
                const label = document.createElement(mode === 'table' ? 'td' : 'span');
                label.textContent = item.name;
                element.append(imageHost, label);
                ImageFrame.attach(imageHost).show({ src: sampleImage, alt: item.name, placeholderHtml: '<span>Image unavailable</span>', onImage: image => {
                    const binding = lightbox.bind(image, { src: sampleImage, alt: item.name, detailsHtml: `<p>${item.name}</p>` });
                    return () => binding.destroy();
                } });
                return { element, dispose: () => { byId('collection-disposed').textContent = String(++disposed); } };
            }
        });
    };
    const show = source => lightbox.show({ src: source ? sampleImage : null, detailsHtml: '<h3>Portable media</h3><p>Details and actions are caller supplied.</p>', trigger: byId(source ? 'media-show' : 'media-details'), actions: [{ id: 'sample-action', label: 'Complete action', handler: async () => { byId('media-status').textContent = 'Action completed.'; } }] });
    const destroy = () => {
        if (destroyed) return;
        destroyed = true;
        view.destroy();
        lightbox.destroy();
        for (const button of section.querySelectorAll('button,select')) button.disabled = true;
        byId('media-status').textContent = 'Collection and media owners destroyed.';
    };
    byId('collection-mode').addEventListener('change', render, { signal: listeners.signal });
    byId('collection-render').addEventListener('click', render, { signal: listeners.signal });
    byId('collection-empty').addEventListener('click', () => { isEmpty = !isEmpty; render(); }, { signal: listeners.signal });
    byId('media-show').addEventListener('click', () => show(true), { signal: listeners.signal });
    byId('media-details').addEventListener('click', () => show(false), { signal: listeners.signal });
    byId('media-destroy').addEventListener('click', destroy, { signal: listeners.signal });
    render();
    return () => { destroy(); listeners.abort(); root.remove(); };
}
