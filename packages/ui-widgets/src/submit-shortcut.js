import { nativeDialogOwnsKeys } from './overlay-context.js';

const owners = new WeakMap();
const CONTROL_SELECTOR = 'input, textarea, select, [contenteditable="true"]';
const ACTION_ATTRIBUTE = 'data-ctrl-enter-submit';

/** One delegated native form/explicit-action shortcut owner for a document. */
export class SubmitShortcut {
    constructor({ document, dialogSelector = 'dialog, [role="dialog"]', canHandle = null, onError = null } = {}) {
        const view = document?.defaultView;
        if (!view || document.nodeType !== view.Node.DOCUMENT_NODE) throw new TypeError('SubmitShortcut requires a browser document.');
        if (typeof dialogSelector !== 'string' || !dialogSelector.trim()) throw new TypeError('SubmitShortcut.dialogSelector must be a nonempty selector.');
        if (canHandle !== null && typeof canHandle !== 'function' || onError !== null && typeof onError !== 'function') throw new TypeError('SubmitShortcut callbacks must be functions or null.');
        document.createElement('div').matches(dialogSelector);
        if (owners.has(document)) throw new Error('SubmitShortcut document already has an owner. Destroy it before binding again.');
        Object.assign(this, { document, dialogSelector, canHandle, onError });
        this.destroyed = false;
        this.listeners = new view.AbortController();
        owners.set(document, this);
        document.addEventListener('keydown', event => {
            const onError = this.onError;
            try { this.handle(event); }
            catch (error) { if (onError) onError(error); else throw error; }
        }, { signal: this.listeners.signal });
    }

    static isShortcut(event) {
        return Boolean(event && !event.defaultPrevented && !event.isComposing && event.key === 'Enter' && (event.ctrlKey || event.metaKey));
    }

    available(action) {
        return Boolean(action && !action.matches(':disabled') && action.getAttribute('aria-disabled') !== 'true');
    }

    handle(event) {
        if (this.destroyed) throw new Error('SubmitShortcut has been destroyed. Create a new owner before handling keys.');
        if (!SubmitShortcut.isShortcut(event)) return false;
        const control = event.target?.closest?.(CONTROL_SELECTOR);
        if (!control || control.ownerDocument !== this.document || control.matches(':disabled') || control.readOnly) return false;
        if (nativeDialogOwnsKeys(this.document, control)) return false;
        const dialog = control.closest(this.dialogSelector);
        const allowed = this.canHandle ? this.canHandle(control, dialog, event) : true;
        if (this.destroyed) return false;
        if (typeof allowed !== 'boolean') throw new TypeError('SubmitShortcut.canHandle must return true or false.');
        if (!allowed) return false;
        const form = control.form || control.closest('form');
        const explicitOwner = control.closest(`[${ACTION_ATTRIBUTE}]`);
        if (explicitOwner) {
            const selector = String(explicitOwner.getAttribute(ACTION_ATTRIBUTE) || '').trim();
            if (!selector) throw new Error(`${ACTION_ATTRIBUTE} requires a non-empty action selector.`);
            let action;
            try { action = (dialog || form || this.document).querySelector(selector); }
            catch (error) { throw new Error(`Invalid ${ACTION_ATTRIBUTE} selector "${selector}": ${error.message}`, { cause: error }); }
            if (!action) throw new Error(`Unable to find explicit Ctrl+Enter action "${selector}".`);
            if (!this.available(action)) return false;
            if (typeof action.click !== 'function') throw new Error('Modal Ctrl+Enter action must be a clickable element.');
            event.preventDefault();
            event.stopPropagation();
            action.click();
            return true;
        }
        if (!dialog || !form) return false;
        const submitControls = Array.from(form.elements).filter(element => {
            const name = element.tagName.toLowerCase();
            const type = element.type?.toLowerCase();
            return name === 'button' && (!type || type === 'submit') || name === 'input' && ['submit', 'image'].includes(type);
        });
        const submitter = submitControls.find(element => this.available(element));
        if (submitControls.length && !submitter) return false;
        if (typeof form.requestSubmit !== 'function') throw new Error('Modal Ctrl+Enter submission requires HTMLFormElement.requestSubmit().');
        event.preventDefault();
        event.stopPropagation();
        if (submitter) form.requestSubmit(submitter);
        else form.requestSubmit();
        return true;
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.listeners.abort();
        owners.delete(this.document);
        this.document = this.listeners = this.canHandle = this.onError = this.dialogSelector = null;
    }
}
