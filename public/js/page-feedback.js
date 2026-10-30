'use strict';
(() => {
    class PageFeedbackController {
        constructor() { this.jobs = new Map(); this.jobScopes = new Map(); this.entries = []; this.dialogs = new Set(); this.socket = null; this.closed = false; }
        dialog(title, text, { returnFocus = document.activeElement, content = null } = {}) {
            if (content !== null && !(content instanceof Node)) throw new TypeError('Dialog content must be a DOM node.');
            const previous = returnFocus;
            const previousId = previous?.id;
            const dialog = document.createElement('dialog'); dialog.className = 'page-feedback-dialog';
            dialog.setAttribute('aria-label', title);
            const heading = document.createElement('h2'); heading.textContent = title;
            const body = document.createElement('pre'); body.textContent = text;
            const close = document.createElement('button'); close.className = 'btn'; close.type = 'button'; close.textContent = 'Close';
            close.addEventListener('click', () => dialog.close());
            if (content !== null) {
                dialog.classList.add('page-feedback-dialog--content', 'modal__dialog');
                const header = document.createElement('header'); header.className = 'modal__header';
                const dismiss = document.createElement('button'); dismiss.className = 'modal__close'; dismiss.type = 'button'; dismiss.textContent = '×'; dismiss.setAttribute('aria-label', 'Close');
                dismiss.addEventListener('click', () => dialog.close());
                header.append(heading, dismiss);
                const container = document.createElement('div'); container.className = 'modal__body'; container.append(content);
                const footer = document.createElement('footer'); footer.className = 'modal__footer';
                close.className = 'btn btn-secondary'; footer.append(close);
                dialog.append(header, container, footer);
            } else dialog.append(heading, body, close);
            document.body.append(dialog); this.dialogs.add(dialog);
            dialog.addEventListener('close', () => {
                this.dialogs.delete(dialog); dialog.remove();
                const trigger = previous?.isConnected ? previous : previousId ? document.getElementById(previousId) : null;
                trigger?.focus();
            }, { once: true });
            dialog.showModal(); close.focus(); return dialog;
        }
        showError(error, options) {
            if (error?.promptFailure) return window.AIRPG_PROMPT_WINDOWS.showFailure(error.promptFailure);
            const message = typeof error === 'string' ? error : error?.stack || error?.error || error?.message || String(error);
            return this.dialog('Operation stopped', message, options);
        }
        async promptAction(id, action, clientId = null) {
            if (typeof id !== 'string' || !id || !['cancel','retry'].includes(action)) throw new Error('Invalid prompt action.');
            const response = await fetch(`/api/prompts/${encodeURIComponent(id)}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(clientId ? { clientId } : {}) });
            const result = await response.json();
            if (!response.ok || !result.success) { const error = new Error(result.error || `Prompt action failed: HTTP ${response.status}`); error.stack = result.stack || error.stack; error.code = result.code; if (result.promptFailure) error.promptFailure = result.promptFailure; throw error; }
            return result;
        }
        validateJobScope(scope) {
            if (typeof scope !== 'string' || !scope.trim()) throw new Error('Job owner scope must be a nonempty name.');
        }
        validateJob(job) {
            if (typeof job?.id !== 'string' || !job.id) throw new Error('Job identity missing.');
            if (typeof job.status !== 'string' || !job.status) throw new Error('Job status missing.');
            if (job.promptIds !== undefined && (!Array.isArray(job.promptIds) || job.promptIds.some(id => typeof id !== 'string' || !id))) throw new Error('Job prompt identities must be an array of nonempty strings.');
        }
        setJobs(scope, jobs) {
            this.validateJobScope(scope);
            if (!Array.isArray(jobs)) throw new Error('Job scope snapshot must be an array.');
            const snapshot = new Map();
            const seen = new Set();
            for (const job of jobs) {
                this.validateJob(job);
                if (seen.has(job.id)) throw new Error(`Duplicate job identity in scope "${scope}".`);
                seen.add(job.id);
                if (['queued', 'running', 'pause-requested'].includes(job.status)) snapshot.set(job.id, { ...job, ownerScope: scope });
            }
            if (snapshot.size) this.jobScopes.set(scope, snapshot);
            else this.jobScopes.delete(scope);
            this.renderJobScopes();
        }
        trackJob(job, scope = job?.ownerScope ?? 'default') {
            this.validateJobScope(scope);
            this.validateJob(job);
            const snapshot = new Map(this.jobScopes.get(scope));
            if (['queued', 'running', 'pause-requested'].includes(job.status)) snapshot.set(job.id, { ...job, ownerScope: scope });
            else snapshot.delete(job.id);
            if (snapshot.size) this.jobScopes.set(scope, snapshot);
            else this.jobScopes.delete(scope);
            this.renderJobScopes();
        }
        renderJobScopes() {
            this.jobs.clear();
            for (const snapshot of this.jobScopes.values()) for (const job of snapshot.values()) {
                const previous = this.jobs.get(job.id);
                this.jobs.set(job.id, previous ? { ...job, promptIds: [...new Set([...(previous.promptIds || []), ...(job.promptIds || [])])] } : job);
            }
            this.render();
        }
        ownedPromptIds() { return new Set([...this.jobs.values()].flatMap(job => job.promptIds || [])); }
        groupFailure(payload) {
            const owned = this.ownedPromptIds();
            const matches = this.entries.filter(entry => owned.has(entry.id) && entry.progressGroupId === payload.progressGroupId);
            if (!owned.has(payload.promptId) && !matches.length) return;
            if (!Array.isArray(payload.failedResponses)) throw new Error('Invalid owned prompt failure response.');
            this.entries = this.entries.map(entry => matches.includes(entry) ? { ...entry, failedResponses: payload.failedResponses, responseFailed: !payload.promptId || entry.id === payload.promptId } : entry);
            this.render();
        }
        mount() { if (document.getElementById('chatForm') || document.querySelector('script[src="/js/chat.js"]')) return; this.dock = document.createElement('aside'); this.dock.className = 'page-feedback-progress prompt-progress-dock'; this.dock.setAttribute('aria-live','polite'); this.dock.setAttribute('aria-label','AI prompt activity'); document.body.append(this.dock); this.render(); this.connect(); window.addEventListener('pagehide', () => { this.closed = true; this.socket?.close(); }); }
        connect() { if (this.closed) return; const id=`feedback-${Date.now()}-${Math.random().toString(36).slice(2)}`; this.socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?clientId=${encodeURIComponent(id)}`); this.socket.addEventListener('message', event => { try { const payload=JSON.parse(event.data); if(payload.type==='prompt_progress'){this.entries=payload.entries||[];this.render();}else if(payload.type==='prompt_progress_cleared'){this.entries=[];this.render();}else if(payload.type==='prompt_progress_group_failure')this.groupFailure(payload);else if(payload.type==='prompt_failed')window.AIRPG_PROMPT_WINDOWS.showFailure(payload); } catch(error){this.showError(error);} }); this.socket.addEventListener('close',()=>{if(!this.closed)setTimeout(()=>this.connect(),2000);}); }
        render() { if(!this.dock)return; this.dock.replaceChildren();const owned=this.ownedPromptIds();const entries=this.entries.filter(e=>owned.has(e.id)); for(const job of this.jobs.values()){const status=document.createElement('p');status.textContent=`${job.label || job.kind || 'Outline work'} · ${job.status === 'pause-requested' ? 'Pausing after this step' : job.status}`;this.dock.append(status);} for(const entry of entries){const row=document.createElement('div');row.className='page-feedback-progress__row';const label=document.createElement('span');label.textContent=`${entry.label||'Prompt'} · ${entry.receivedCount??entry.bytes??0} characters`;row.append(label);for(const action of ['view','cancel','retry']){const button=document.createElement('button');button.className='btn';button.type='button';button.textContent=action[0].toUpperCase()+action.slice(1);button.addEventListener('click',async()=>{if(action==='view'){this.dialog(entry.label||'Prompt',`${entry.promptText||''}\n\n${entry.previewText||''}${entry.failedResponses?.length ? `\n\nEarlier invalid responses:\n${entry.failedResponses.join('\n\n')}` : ''}`);return;}button.disabled=true;try{await this.promptAction(entry.id,action);}catch(error){this.showError(error);}finally{button.disabled=false;}});row.append(button);}this.dock.append(row);}this.dock.hidden=!this.jobs.size&&!entries.length; }
    }
    window.PageFeedbackController = PageFeedbackController;
    window.AIRPG_PAGE_FEEDBACK = new PageFeedbackController();
    document.addEventListener('DOMContentLoaded',()=>window.AIRPG_PAGE_FEEDBACK.mount());
})();
