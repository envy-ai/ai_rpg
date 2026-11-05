/** Native top-layer dialogs own keys ahead of background custom/modeless surfaces. */
export function nativeDialogOwnsKeys(document, ...ownedElements) {
    const focused = document.activeElement?.closest?.('dialog:modal');
    const open = focused || [...document.querySelectorAll('dialog:modal')].at(-1);
    return Boolean(open && !ownedElements.some(element => element && open.contains(element)));
}

/** Apply a caller-selected focus boundary without selecting a new host policy. */
export function trapFocus(event, { document, controls, preventEmpty = true }) {
    if (!controls.length) { if (preventEmpty) event.preventDefault(); return; }
    const first = controls[0], last = controls[controls.length - 1];
    if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
    }
}
