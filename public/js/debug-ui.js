/* Debug presentation only: save/image requests and job cadence remain page-owned. */
(() => {
    'use strict';
    function init() {
        const { BusyButton, StatusSurface, ProgressMeter, CollectionView, SnapshotList, ImageFrame } = window.AIRPG_WIDGETS;
        const listeners = new AbortController();
        const timers = new Set();
        let disposed = false, recentRequest = 0, savesRequest = 0;
        const byId = id => document.getElementById(id);
        const node = (tag, text, style = '') => {
            const element = document.createElement(tag);
            if (text !== undefined) element.textContent = text;
            element.style.cssText = style;
            return element;
        };
        function later(callback, delay) {
            const timer = setTimeout(() => { timers.delete(timer); if (!disposed) callback(); }, delay);
            timers.add(timer);
        }
        function report(error, returnFocus) {
            if (disposed) return;
            console.error(error);
            window.AIRPG_PAGE_FEEDBACK.showError(error, { returnFocus });
        }
        async function request(url, options) {
            const response = await fetch(url, options);
            const result = await response.json();
            if (!response.ok || !result.success) {
                const error = new Error(result.error || `Request failed: HTTP ${response.status}`);
                if (result.stack) error.stack = result.stack;
                throw error;
            }
            return result;
        }
        const jsonPost = payload => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
        const form = byId('imageGenForm');
        const submit = form.querySelector('button[type="submit"]');
        const imageBusy = new BusyButton(submit, { busyClass: '' });
        const portraitButton = byId('regeneratePortrait');
        const portraitBusy = portraitButton ? new BusyButton(portraitButton, { busyClass: '' }) : null;
        const saveStatus = new StatusSurface(byId('saveStatus'), { hideMode: 'display' });
        const imageStatusRoot = byId('imageGenStatus');
        const imageText = node('span');
        const imageExtra = node('span');
        imageStatusRoot.replaceChildren(imageText, imageExtra);
        const imageStatus = new StatusSurface(imageStatusRoot, { textElement: imageText, hideMode: 'display' });
        let meter = null;
        function setSaveStatus(message, state = 'info') {
            if (disposed) return;
            saveStatus.update({ text: message, state });
            const palette = { success: ['40, 167, 69', '#28a745'], error: ['220, 53, 69', '#dc3545'], info: ['0, 123, 255', '#007bff'] }[state];
            Object.assign(byId('saveStatus').style, { background: `rgba(${palette[0]}, 0.3)`, border: `1px solid ${palette[1]}`, color: '#ffffff' });
        }
        function setImageStatus(lines, state = 'info') {
            if (disposed) return;
            meter?.destroy(); meter = null;
            imageExtra.replaceChildren();
            imageStatus.update({ text: lines[0], state });
            for (const line of lines.slice(1)) imageExtra.append(node('br'), document.createTextNode(line));
            const palette = { success: ['72, 187, 120', '#48bb78'], error: ['245, 101, 101', '#f56565'], info: ['102, 126, 234', '#667eea'] }[state];
            Object.assign(imageStatusRoot.style, { background: `rgba(${palette[0]}, 0.3)`, border: `1px solid ${palette[1]}`, color: '#ffffff' });
        }
        function imageFrame(parent, src, alt, margin) {
            const host = node('div'); parent.append(host);
            const frame = new ImageFrame(host);
            const image = frame.show({ src, alt, loading: 'eager', onImage: element => { element.style.cssText = `width: 100%; border-radius: 4px; margin-bottom: ${margin}px;`; }, onError: () => host.replaceChildren(image) });
            return frame;
        }
        const results = [];
        const resultsView = new SnapshotList(byId('imageGenResults'), {
            key: item => item.id,
            create(item) {
                const card = node('div', undefined, 'background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); border-radius: 8px; padding: 15px; text-align: center; margin-bottom: 15px;');
                const frame = imageFrame(card, item.url, 'Generated image', 10);
                const details = node('div', undefined, 'color: rgba(255,255,255,0.8); font-size: 12px;');
                details.append(node('div', item.payload.prompt, 'margin-bottom: 5px; font-weight: bold;'), node('div', `${item.payload.width}×${item.payload.height} | Seed: ${item.payload.seed}`));
                const linkRow = node('div', undefined, 'margin-top: 5px;');
                const link = node('a', 'View Full Size', 'color: #667eea; text-decoration: none;');
                link.href = item.url; link.target = '_blank'; linkRow.append(link); details.append(linkRow); card.append(details);
                return { element: card, dispose: () => frame.destroy() };
            }, update() {}
        });
        const recentView = new CollectionView(byId('recentImages'));
        async function loadRecentImages() {
            const ticket = ++recentRequest;
            try {
                const result = await request('/api/images');
                if (disposed || ticket !== recentRequest) return;
                // Preserve the existing empty-response policy; only populated snapshots replace cards.
                if (!result.images.length) return;
                recentView.render({ items: result.images.slice(0, 6), renderItem(item) {
                    const entryListeners = new AbortController();
                    const card = node('div', undefined, 'background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; padding: 10px; text-align: center; cursor: pointer;');
                    card.role = 'button'; card.tabIndex = 0; card.setAttribute('aria-label', `Use image settings: ${item.prompt}`);
                    const frame = imageFrame(card, item.images[0].url, 'Recent image', 8);
                    const details = node('div', undefined, 'color: rgba(255,255,255,0.7); font-size: 11px;');
                    details.append(node('div', `${item.prompt.substring(0, 30)}...`, 'margin-bottom: 3px; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;'), node('div', `${item.width}×${item.height}`));
                    card.append(details);
                    const choose = () => {
                        if (disposed) return;
                        for (const key of ['prompt', 'width', 'height', 'seed']) byId(key).value = item[key];
                        byId('negative_prompt').value = item.negative_prompt || '';
                    };
                    card.addEventListener('click', choose, { signal: entryListeners.signal });
                    card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); } }, { signal: entryListeners.signal });
                    return { element: card, dispose() { entryListeners.abort(); frame.destroy(); } };
                } });
                byId('recentImages').style.display = 'grid';
            } catch (error) { report(error, form); }
        }
        function finishImage() { if (!disposed) imageBusy.setBusy(false, { disabled: false, content: '🎨 Generate Image' }); }
        function trackJobProgress(jobId, payload) {
            let attempts = 0, completed = false, lastError = null;
            async function checkProgress() {
                if (disposed) return;
                ++attempts;
                try {
                    const result = await request(`/api/jobs/${jobId}`);
                    if (disposed) return;
                    const job = result.job;
                    setImageStatus([`🎨 Job: ${jobId}`, `📊 Status: ${job.status} (${job.progress}%)`, `💬 ${job.message}`]);
                    const bar = node('div', undefined, 'width: 100%; background: rgba(0,0,0,0.3); border-radius: 4px; margin: 10px 0;');
                    const fill = node('div', undefined, 'background: #667eea; height: 8px; border-radius: 4px; transition: width 0.3s;');
                    bar.append(fill); imageExtra.append(bar, node('small', `Attempt ${attempts}/60`, 'opacity: 0.7;'));
                    meter = new ProgressMeter(bar, { fill }); meter.update({ fraction: job.progress / 100 });
                    if (job.status === 'completed') {
                        completed = true;
                        setImageStatus(['✅ Image generated successfully!', `Job: ${jobId}`, `⏱️ Processing time: ${Math.round((new Date(job.completedAt) - new Date(job.createdAt)) / 1000)}s`], 'success');
                        if (result.result && result.result.images.length) {
                            results.push({ id: String(results.length + 1), url: result.result.images[0].url, payload });
                            resultsView.render(results); void loadRecentImages();
                        }
                    } else if (job.status === 'failed' || job.status === 'timeout') {
                        completed = true;
                        const error = new Error(result.error || job.status); if (result.stack) error.stack = result.stack;
                        setImageStatus([`❌ Generation failed: ${error.message}`], 'error'); report(error, submit);
                    }
                } catch (error) {
                    if (disposed) return;
                    imageExtra.append(node('br'), node('small', `⚠️ Status check failed: ${error.message}`, 'color: #f56565;'));
                    if (lastError !== error.stack) { lastError = error.stack; report(error, submit); }
                }
                if (!completed && attempts < 60) later(checkProgress, 2000);
                else if (!completed) {
                    completed = true;
                    const error = new Error('Job tracking timed out after 60 attempts');
                    setImageStatus([`❌ ${error.message}`], 'error'); report(error, submit);
                }
                if (completed) finishImage();
            }
            later(checkProgress, 1000);
        }
        byId('randomSeedBtn').addEventListener('click', () => { byId('seed').value = Math.floor(Math.random() * 1000000); }, { signal: listeners.signal });
        form.addEventListener('submit', async event => {
            event.preventDefault();
            if (disposed) return;
            const data = new FormData(form);
            const payload = { prompt: data.get('prompt'), width: parseInt(data.get('width')), height: parseInt(data.get('height')), seed: parseInt(data.get('seed')), negative_prompt: data.get('negative_prompt') || undefined, async: true };
            setImageStatus(['🎨 Submitting image generation job...']);
            imageBusy.setBusy(true, { disabled: false, busyContent: '⏳ Processing...' });
            try {
                const result = await request('/api/generate-image', jsonPost(payload));
                if (disposed) return;
                if (!result.jobId) throw new Error('Image submission did not return a jobId.');
                setImageStatus([`🎨 Job queued: ${result.jobId}`, `⏳ ${result.message}`]);
                trackJobProgress(result.jobId, payload);
            } catch (error) { if (!disposed) { setImageStatus([`❌ Request failed: ${error.message}`], 'error'); report(error, submit); finishImage(); } }
        }, { signal: listeners.signal });
        const savesEmpty = node('p', 'No saves found', 'color: #ffffff;'); savesEmpty.hidden = true;
        byId('savesList').after(savesEmpty);
        const savesView = new CollectionView(byId('savesList'), { empty: savesEmpty });
        function fail(error, prefix, control) { if (!disposed) { setSaveStatus(`❌ ${prefix}: ${error.message}`, 'error'); report(error, control); } }
        async function loadSaves() {
            const ticket = ++savesRequest;
            setSaveStatus('Loading saves list...');
            try {
                const result = await request('/api/saves');
                if (disposed || ticket !== savesRequest) return;
                savesView.render({ items: result.saves, emptyText: 'No saves found', renderItem(save) {
                    const entryListeners = new AbortController();
                    const card = node('div', undefined, 'background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); border-radius: 5px; padding: 15px; margin: 10px 0; color: #ffffff;');
                    const row = node('div', undefined, 'display: flex; justify-content: space-between; align-items: center;');
                    const info = node('div'); info.append(node('h4', `${save.playerName} (Level ${save.playerLevel})`, 'margin: 0 0 5px 0;'), node('p', new Date(save.timestamp).toLocaleString(), 'margin: 0; font-size: 12px; opacity: 0.8;'), node('p', `Save: ${save.saveName}`, 'margin: 5px 0 0 0; font-size: 12px;'));
                    const actions = node('div');
                    for (const [label, colors, action] of [['📂 Load', '#007bff, #6f42c1', loadSave], ['🗑️ Delete', '#dc3545, #c82333', deleteSave]]) {
                        const button = node('button', label, `background: linear-gradient(135deg, ${colors}); color: white; border: none; padding: 8px 15px; border-radius: 3px; cursor: pointer;${label === '📂 Load' ? ' margin-right: 5px;' : ''}`);
                        button.type = 'button'; button.addEventListener('click', () => void action(save.saveName), { signal: entryListeners.signal }); actions.append(button);
                    }
                    row.append(info, actions); card.append(row);
                    return { element: card, dispose: () => entryListeners.abort() };
                } });
                byId('savesContainer').style.display = 'block'; setSaveStatus(`📂 Found ${result.count} save(s)`, 'success');
            } catch (error) { if (!disposed && ticket === savesRequest) fail(error, 'Failed to load saves', byId('loadSavesBtn')); }
        }
        async function loadSave(saveName) {
            if (disposed) return;
            setSaveStatus(`Loading save: ${saveName}...`);
            try {
                const clientId = window.AIRPG_CLIENT_ID || (window.localStorage ? window.localStorage.getItem('airpg:clientId') : null);
                const result = await request('/api/load', jsonPost({ saveName, clientId }));
                if (disposed) return;
                setSaveStatus(`✅ ${result.message}`, 'success'); later(() => window.location.reload(), 2000);
            } catch (error) { fail(error, 'Load failed', byId('loadSavesBtn')); }
        }
        async function deleteSave(saveName) {
            if (disposed || !window.confirm(`Are you sure you want to delete save: ${saveName}?`)) return;
            setSaveStatus(`Deleting save: ${saveName}...`);
            try {
                const result = await request(`/api/save/${saveName}`, { method: 'DELETE' });
                if (disposed) return;
                setSaveStatus(`✅ ${result.message}`, 'success'); void loadSaves();
            } catch (error) { fail(error, 'Delete failed', byId('loadSavesBtn')); }
        }
        byId('saveGameBtn').addEventListener('click', async () => {
            setSaveStatus('Saving game...');
            try { const result = await request('/api/save', jsonPost()); if (!disposed) setSaveStatus(`✅ ${result.message}`, 'success'); }
            catch (error) { fail(error, 'Save failed', byId('saveGameBtn')); }
        }, { signal: listeners.signal });
        byId('loadSavesBtn').addEventListener('click', () => void loadSaves(), { signal: listeners.signal });
        window.regeneratePlayerPortrait = async playerId => {
            if (disposed) return;
            portraitBusy.setBusy(true, { disabled: false, busyContent: '🔄 Generating...' });
            try {
                const result = await request(`/api/players/${playerId}/portrait`, { method: 'POST' });
                if (disposed) return;
                setSaveStatus(`✅ ${result.message}`, 'success'); later(() => window.location.reload(), 3000);
            } catch (error) { fail(error, 'Portrait generation failed', portraitButton); }
            finally { if (!disposed) portraitBusy.setBusy(false, { disabled: false }); }
        };
        window.checkImageStatus = async imageId => {
            if (disposed) return;
            try {
                const result = await request(`/api/jobs/${imageId}`);
                if (disposed) return;
                setSaveStatus(`📊 Image Status: ${result.job.status} - ${result.job.message}`);
                if (result.job.status === 'completed') later(() => window.location.reload(), 1000);
            } catch (error) { fail(error, 'Status check failed', portraitButton); }
        };
        window.addEventListener('pagehide', event => {
            if (event.persisted || disposed) return;
            disposed = true; ++recentRequest; ++savesRequest; listeners.abort();
            for (const timer of timers) clearTimeout(timer); timers.clear();
            meter?.destroy(); imageBusy.destroy(); portraitBusy?.destroy(); imageStatus.destroy(); saveStatus.destroy();
            recentView.destroy(); savesView.destroy(); resultsView.destroy();
        }, { signal: listeners.signal });
        void loadRecentImages();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
