(function () {
    'use strict';

    function initAppHeader() {
        const header = document.querySelector('.app-header');
        const toggle = document.getElementById('appHeaderMenuToggle');
        const panel = document.getElementById('appHeaderMobilePanel');
        const scrim = header?.querySelector('.app-header__scrim');
        const primaryAction = document.getElementById('appHeaderPrimaryAction');
        if (!header || !toggle || !panel || !scrim) return;

        const mobileQuery = window.matchMedia('(max-width: 540px)');
        const isOpen = () => header.classList.contains('is-menu-open');

        function setOpen(open, { restoreFocus = false } = {}) {
            const shouldOpen = Boolean(open && mobileQuery.matches);
            header.classList.toggle('is-menu-open', shouldOpen);
            toggle.setAttribute('aria-expanded', String(shouldOpen));
            toggle.querySelector('.app-header-menu-toggle__label').textContent = shouldOpen ? 'Close' : 'Menu';
            scrim.hidden = !shouldOpen;
            document.documentElement.classList.toggle('app-header-menu-open', shouldOpen);
            if (!shouldOpen) {
                header.querySelector('.app-tools-menu')?.removeAttribute('open');
                if (restoreFocus && document.body.contains(toggle)) toggle.focus();
            }
        }

        function syncGameLoaded(loaded) {
            const isLoaded = loaded === true;
            window.__AIRPG_GAME_LOADED__ = isLoaded;
            header.dataset.gameLoaded = String(isLoaded);
            if (!primaryAction) return;
            const action = isLoaded ? 'save' : 'load';
            primaryAction.dataset.action = action;
            primaryAction.title = isLoaded ? 'Save Current Game' : 'Load Saved Game';
            primaryAction.setAttribute('aria-label', isLoaded ? 'Save Current Game' : 'Load Saved Game');
            primaryAction.querySelector('.app-header-action__label').textContent = isLoaded ? 'Save' : 'Load';
            const icon = primaryAction.querySelector('.app-header-icon');
            icon.classList.toggle('app-header-icon--save', isLoaded);
            icon.classList.toggle('app-header-icon--load', !isLoaded);
            syncPrimaryActionStatus();
        }

        function syncPrimaryActionStatus() {
            if (!primaryAction) return;
            const targetId = primaryAction.dataset.action === 'save' ? 'saveGameBtn' : 'loadGameBtn';
            const target = document.getElementById(targetId);
            if (!target) return;
            primaryAction.disabled = target.disabled;
            const sourceLabel = target.querySelector('.app-header-action__label');
            if (sourceLabel) primaryAction.querySelector('.app-header-action__label').textContent = sourceLabel.textContent;
        }

        window.setAirpgGameLoaded = syncGameLoaded;
        syncGameLoaded(window.__AIRPG_GAME_LOADED__ === true || header.dataset.gameLoaded === 'true');
        ['saveGameBtn', 'loadGameBtn'].forEach(id => {
            const button = document.getElementById(id);
            if (!button) return;
            new MutationObserver(syncPrimaryActionStatus).observe(button, {
                attributes: true,
                attributeFilter: ['disabled'],
                childList: true,
                subtree: true
            });
        });
        toggle.addEventListener('click', () => setOpen(!isOpen()));
        scrim.addEventListener('click', () => setOpen(false, { restoreFocus: true }));
        panel.addEventListener('click', event => {
            if (event.target.closest('a[href], #saveGameBtn, #loadGameBtn')) setOpen(false);
        });
        primaryAction?.addEventListener('click', () => {
            const targetId = primaryAction.dataset.action === 'save' ? 'saveGameBtn' : 'loadGameBtn';
            setOpen(false);
            document.getElementById(targetId)?.click();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && isOpen()) {
                event.preventDefault();
                setOpen(false, { restoreFocus: true });
                return;
            }
            if (event.key === 'Tab' && isOpen()) {
                const focusable = [toggle, ...panel.querySelectorAll('a[href], summary, button:not(:disabled)')]
                    .filter(element => element.offsetParent !== null);
                if (!focusable.length) return;
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
        });
        mobileQuery.addEventListener('change', event => {
            if (!event.matches) {
                setOpen(false);
                const toolsMenu = header.querySelector('.app-tools-menu.is-active');
                if (toolsMenu) toolsMenu.setAttribute('open', '');
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAppHeader, { once: true });
    } else {
        initAppHeader();
    }
}());
