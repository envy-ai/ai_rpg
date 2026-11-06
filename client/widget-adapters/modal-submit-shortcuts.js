import { SubmitShortcut } from '../../packages/ui-widgets/src/submit-shortcut.js';

const binding = new SubmitShortcut({
    document,
    dialogSelector: 'dialog, [role="dialog"], .modal, .chat-edit-modal, .quest-confirmation, .npc-selection-modal, .player-input-request-panel',
    canHandle: (control, dialog, event) => {
        if (control.closest('dialog:modal')) return true;
        const stack = window.AIRPG_MODAL_STACK;
        const top = stack.top;
        return (!top || top.contains(control)) && stack.canHandleKeys(dialog || control, event);
    },
    onError: error => {
        console.error('Modal submission shortcut failed:', error);
        window.AIRPG_PAGE_FEEDBACK.showError(error);
    }
});
const api = Object.freeze({
    handleModalCtrlEnter: event => binding.handle(event),
    isCtrlEnterShortcut: SubmitShortcut.isShortcut
});
window.AIRPGModalSubmitShortcuts = api;
const dispose = event => {
    if (event.persisted) return;
    window.removeEventListener('pagehide', dispose);
    binding.destroy();
    if (window.AIRPGModalSubmitShortcuts === api) delete window.AIRPGModalSubmitShortcuts;
};
window.addEventListener('pagehide', dispose);
