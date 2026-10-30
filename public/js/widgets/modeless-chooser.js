(() => {
    'use strict';
    const instances = new Set();
    class ModelessChooser {
        constructor({ root, title, closeButton, insert }) {
            if (!root || !title || !closeButton || typeof insert !== 'function') throw new Error('ModelessChooser requires a shell, title, close button and insertion callback.');
            Object.assign(this, { root, title, insert });
            root.classList.add('modeless-chooser');
            root.setAttribute('aria-labelledby', title.id);
            closeButton.addEventListener('click', () => this.close({ refocusInput: true }));
            instances.add(this);
        }
        get isOpen() { return !this.root.hidden; }
        open(title) {
            for (const other of instances) if (other !== this) other.close();
            this.origin = document.activeElement;
            this.title.textContent = title;
            this.root.hidden = false;
            this.root.setAttribute('aria-hidden', 'false');
            (this.root.querySelector('[data-chooser-choice]') || this.root.querySelector('.modal__close'))?.focus({ preventScroll: true });
        }
        close({ refocusInput = false } = {}) {
            if (!this.isOpen) return;
            this.root.hidden = true;
            this.root.setAttribute('aria-hidden', 'true');
            this.root.dispatchEvent(new CustomEvent('chooser:closed'));
            if (refocusInput) document.getElementById('messageInput')?.focus();
            else if (this.root.contains(document.activeElement)) this.origin?.focus?.({ preventScroll: true });
        }
        choice(control, name) {
            control.dataset.chooserChoice = name;
            control.setAttribute('aria-label', `Insert ${name}`);
            control.addEventListener('click', () => this.insert(`[${name}]`));
            return control;
        }
    }
    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        if (document.querySelector('dialog[open], .modal[aria-modal="true"]:not([hidden])')) return;
        for (const chooser of instances) if (chooser.isOpen) {
            event.preventDefault();
            chooser.close({ refocusInput: true });
            break;
        }
    });
    window.AIRPG_WIDGETS = window.AIRPG_WIDGETS || {};
    window.AIRPG_WIDGETS.ModelessChooser = ModelessChooser;
})();
