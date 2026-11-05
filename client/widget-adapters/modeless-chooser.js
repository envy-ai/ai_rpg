import { ModelessChooser as PortableChooser } from '../../packages/ui-widgets/src/index.js';

class ModelessChooser extends PortableChooser {
    constructor({ insert, ...options }) {
        super({
            ...options, onChoose: insert, formatChoice: name => `[${name}]`, choiceLabel: name => `Insert ${name}`,
            returnFocus: () => document.getElementById('messageInput'),
            canDismiss: () => !document.querySelector('dialog:modal, .modal[aria-modal="true"]:not([hidden])')
        });
    }
    close({ refocusInput = false, focusReturn = refocusInput } = {}) { return super.close({ focusReturn }); }
}

window.AIRPG_WIDGETS = window.AIRPG_WIDGETS || {};
window.AIRPG_WIDGETS.ModelessChooser = ModelessChooser;
