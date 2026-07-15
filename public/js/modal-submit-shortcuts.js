(function initializeModalSubmitShortcuts(globalScope) {
    'use strict';

    const CONTROL_SELECTOR = 'input, textarea, select, [contenteditable="true"]';
    const DIALOG_SELECTOR = '.modal, .chat-edit-modal, .quest-confirmation, .npc-selection-modal, .player-input-request-panel';
    const EXPLICIT_SUBMIT_ATTRIBUTE = 'data-ctrl-enter-submit';
    const installedDocuments = new WeakSet();

    function isCtrlEnterShortcut(event) {
        return Boolean(
            event
            && !event.defaultPrevented
            && !event.isComposing
            && event.key === 'Enter'
            && (event.ctrlKey || event.metaKey)
        );
    }

    function findDialogRoot(control) {
        return control?.closest?.(DIALOG_SELECTOR)
            || control?.closest?.('[role="dialog"]')
            || null;
    }

    function findSubmitControls(form) {
        return Array.from(form?.elements || []).filter((element) => {
            const tagName = String(element?.tagName || '').toLowerCase();
            const type = String(element?.type || '').toLowerCase();
            return (tagName === 'button' && (!type || type === 'submit'))
                || (tagName === 'input' && (type === 'submit' || type === 'image'));
        });
    }

    function isActionAvailable(action) {
        return Boolean(
            action
            && !action.disabled
            && action.getAttribute?.('aria-disabled') !== 'true'
        );
    }

    function submitFormFromShortcut(event, form) {
        const submitControls = findSubmitControls(form);
        const submitter = submitControls.find(isActionAvailable) || null;
        if (submitControls.length > 0 && !submitter) {
            return false;
        }
        if (typeof form?.requestSubmit !== 'function') {
            throw new Error('Modal Ctrl+Enter submission requires HTMLFormElement.requestSubmit().');
        }

        event.preventDefault();
        event.stopPropagation();
        if (submitter) {
            form.requestSubmit(submitter);
        } else {
            form.requestSubmit();
        }
        return true;
    }

    function resolveExplicitAction(control, dialogRoot) {
        const owner = control?.closest?.(`[${EXPLICIT_SUBMIT_ATTRIBUTE}]`);
        if (!owner) {
            return null;
        }

        const selector = String(owner.getAttribute?.(EXPLICIT_SUBMIT_ATTRIBUTE) || '').trim();
        if (!selector) {
            throw new Error(`${EXPLICIT_SUBMIT_ATTRIBUTE} requires a non-empty action selector.`);
        }

        let action = null;
        try {
            action = dialogRoot?.querySelector?.(selector) || null;
        } catch (error) {
            throw new Error(`Invalid ${EXPLICIT_SUBMIT_ATTRIBUTE} selector "${selector}": ${error.message}`);
        }
        if (!action) {
            throw new Error(`Unable to find modal Ctrl+Enter action "${selector}".`);
        }
        return action;
    }

    function activateExplicitAction(event, action) {
        if (!isActionAvailable(action)) {
            return false;
        }
        if (typeof action.click !== 'function') {
            throw new Error('Modal Ctrl+Enter action must be a clickable element.');
        }

        event.preventDefault();
        event.stopPropagation();
        action.click();
        return true;
    }

    function handleModalCtrlEnter(event) {
        if (!isCtrlEnterShortcut(event)) {
            return false;
        }

        const control = event.target?.closest?.(CONTROL_SELECTOR) || null;
        if (!control || control.disabled || control.readOnly) {
            return false;
        }

        const dialogRoot = findDialogRoot(control);
        if (!dialogRoot) {
            return false;
        }

        const explicitAction = resolveExplicitAction(control, dialogRoot);
        if (explicitAction) {
            return activateExplicitAction(event, explicitAction);
        }

        const form = control.form || control.closest?.('form') || null;
        if (!form) {
            return false;
        }
        return submitFormFromShortcut(event, form);
    }

    function install(doc = globalScope?.document) {
        if (!doc || typeof doc.addEventListener !== 'function') {
            throw new Error('Modal Ctrl+Enter shortcuts require a document with addEventListener().');
        }
        if (installedDocuments.has(doc)) {
            return;
        }
        installedDocuments.add(doc);
        doc.addEventListener('keydown', handleModalCtrlEnter);
    }

    const api = Object.freeze({
        handleModalCtrlEnter,
        install,
        isCtrlEnterShortcut
    });

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (globalScope) {
        globalScope.AIRPGModalSubmitShortcuts = api;
        if (globalScope.document) {
            install(globalScope.document);
        }
    }
})(typeof window !== 'undefined' ? window : globalThis);
