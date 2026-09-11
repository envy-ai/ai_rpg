(function initMobileAdventureNavigation() {
    'use strict';

    const mobileQuery = window.matchMedia('(max-width: 540px)');

    function parseLeadingCount(element) {
        if (!element) throw new Error('Mobile Adventure count source is missing.');
        if (element.dataset.visibleCount !== undefined) {
            const count = Number(element.dataset.visibleCount);
            if (!Number.isInteger(count) || count < 0) throw new Error(`Invalid mobile Adventure count: ${element.dataset.visibleCount}`);
            return count;
        }
        const match = String(element?.textContent || '').match(/\d+/);
        if (!match) throw new Error(`Mobile Adventure count source #${element.id} has no numeric count.`);
        return Number(match[0]);
    }

    function init() {
        const root = document.querySelector('body > .container');
        const header = root?.querySelector('.app-header');
        const globalTabBar = root?.querySelector('.tab-bar');
        const adventurePanel = document.getElementById('tab-adventure');
        const adventureContent = adventurePanel?.querySelector('.adventure-content');
        const primaryNav = document.getElementById('mobileAdventurePrimaryNav');
        const locationSubnav = document.getElementById('mobileAdventureLocationSubnav');
        const playerSubnav = document.getElementById('mobileAdventurePlayerSubnav');
        const dock = document.getElementById('promptProgressDock');
        const chatLog = document.getElementById('chatLog');

        if (!root || !header || !globalTabBar || !adventurePanel || !adventureContent
            || !primaryNav || !locationSubnav || !playerSubnav || !dock) {
            throw new Error('Mobile Adventure navigation requires the Play header, tabs, Adventure panel, and prompt dock.');
        }

        const dockHome = {
            parent: dock.parentNode,
            nextSibling: dock.nextSibling
        };
        const state = {
            primary: 'location',
            location: 'general',
            player: 'player'
        };
        let frame = null;

        function isAdventureActive() {
            return !adventurePanel.hidden && adventurePanel.classList.contains('active');
        }

        function setSelected(buttons, attribute, value) {
            buttons.forEach(button => {
                const selected = button.dataset[attribute] === value;
                button.classList.toggle('is-active', selected);
                button.setAttribute('aria-selected', String(selected));
                button.tabIndex = selected ? 0 : -1;
            });
        }

        function measure() {
            frame = null;
            if (!mobileQuery.matches) {
                root.style.removeProperty('--mobile-play-header-height');
                root.style.removeProperty('--mobile-play-global-tabs-height');
                root.style.removeProperty('--mobile-play-primary-nav-height');
                root.style.removeProperty('--mobile-play-subnav-height');
                root.style.removeProperty('--mobile-play-dock-height');
                return;
            }

            const adventureActive = isAdventureActive();
            const activeSubnav = state.primary === 'location'
                ? locationSubnav
                : state.primary === 'player-party' ? playerSubnav : null;
            root.style.setProperty('--mobile-play-header-height', `${header.getBoundingClientRect().height}px`);
            root.style.setProperty('--mobile-play-global-tabs-height', `${globalTabBar.getBoundingClientRect().height}px`);
            root.style.setProperty('--mobile-play-primary-nav-height', `${adventureActive ? primaryNav.getBoundingClientRect().height : 0}px`);
            root.style.setProperty('--mobile-play-subnav-height', `${adventureActive && activeSubnav ? activeSubnav.getBoundingClientRect().height : 0}px`);
            root.style.setProperty('--mobile-play-dock-height', `${dock.getBoundingClientRect().height}px`);
        }

        function scheduleMeasure() {
            if (frame !== null) return;
            frame = window.requestAnimationFrame(measure);
        }

        function syncNavigation() {
            const adventureActive = isAdventureActive();
            root.classList.toggle('mobile-play-navigation-active', mobileQuery.matches);
            root.classList.toggle('mobile-play-adventure-active', mobileQuery.matches && adventureActive);
            adventureContent.dataset.mobileAdventurePane = state.primary;
            adventureContent.dataset.mobileLocationPane = state.location;
            adventureContent.dataset.mobilePlayerPane = state.player;

            setSelected(Array.from(primaryNav.querySelectorAll('[data-mobile-adventure-pane]')), 'mobileAdventurePane', state.primary);
            setSelected(Array.from(locationSubnav.querySelectorAll('[data-mobile-location-pane]')), 'mobileLocationPane', state.location);
            setSelected(Array.from(playerSubnav.querySelectorAll('[data-mobile-player-pane]')), 'mobilePlayerPane', state.player);

            locationSubnav.hidden = !adventureActive || state.primary !== 'location';
            playerSubnav.hidden = !adventureActive || state.primary !== 'player-party';
            primaryNav.hidden = !adventureActive;
            scheduleMeasure();
        }

        function activate(group, value, { focus = false } = {}) {
            const changed = state[group] !== value;
            state[group] = value;
            if (group === 'location' && value === 'npcs') {
                adventureContent.querySelector('.location-npcs')?.setAttribute('open', '');
            } else if (group === 'location' && value === 'things') {
                adventureContent.querySelector('.location-things')?.setAttribute('open', '');
            }
            syncNavigation();
            const selector = group === 'primary'
                ? `[data-mobile-adventure-pane="${value}"]`
                : group === 'location'
                    ? `[data-mobile-location-pane="${value}"]`
                    : `[data-mobile-player-pane="${value}"]`;
            if (focus) document.querySelector(selector)?.focus();
            if (changed) window.scrollTo(0, 0);
            if (group === 'primary' && value === 'chat') {
                window.requestAnimationFrame(() => {
                    if (chatLog) chatLog.scrollTop = chatLog.scrollHeight;
                });
            }
        }

        function bindTablist(nav, group, attributeName, datasetKey) {
            const buttons = Array.from(nav.querySelectorAll(`[${attributeName}]`));
            buttons.forEach(button => {
                button.addEventListener('click', () => activate(group, button.dataset[datasetKey]));
                button.addEventListener('keydown', event => {
                    const current = buttons.indexOf(button);
                    let next = null;
                    if (event.key === 'ArrowRight') next = buttons[(current + 1) % buttons.length];
                    if (event.key === 'ArrowLeft') next = buttons[(current - 1 + buttons.length) % buttons.length];
                    if (event.key === 'Home') next = buttons[0];
                    if (event.key === 'End') next = buttons[buttons.length - 1];
                    if (!next) return;
                    event.preventDefault();
                    activate(group, next.dataset[datasetKey], { focus: true });
                });
            });
        }

        function updateCounts() {
            const values = {
                npcs: Array.from(document.querySelectorAll('#locationNPCs > .entity-card'))
                    .filter(card => !card.hidden && getComputedStyle(card).display !== 'none').length,
                items: parseLeadingCount(document.getElementById('locationItemsCount')),
                scenery: parseLeadingCount(document.getElementById('locationSceneryCount')),
                party: parseLeadingCount(document.getElementById('chatPartyCount')),
                trackers: parseLeadingCount(document.getElementById('chatTrackersCount'))
            };
            Object.entries(values).forEach(([name, value]) => {
                root.querySelectorAll(`[data-mobile-count="${name}"]`).forEach(element => {
                    element.textContent = String(value);
                });
            });
        }

        function syncResponsiveMode() {
            if (mobileQuery.matches) {
                if (dock.parentNode !== root) root.appendChild(dock);
            } else if (dock.parentNode !== dockHome.parent) {
                const reference = dockHome.nextSibling?.parentNode === dockHome.parent ? dockHome.nextSibling : null;
                dockHome.parent.insertBefore(dock, reference);
            }
            syncNavigation();
            updateCounts();
        }

        bindTablist(primaryNav, 'primary', 'data-mobile-adventure-pane', 'mobileAdventurePane');
        bindTablist(locationSubnav, 'location', 'data-mobile-location-pane', 'mobileLocationPane');
        bindTablist(playerSubnav, 'player', 'data-mobile-player-pane', 'mobilePlayerPane');

        const countTargets = [
            document.getElementById('locationNPCs'),
            document.getElementById('locationItemsCount'),
            document.getElementById('locationSceneryCount'),
            document.getElementById('chatPartyCount'),
            document.getElementById('chatTrackersCount')
        ].filter(Boolean);
        const countObserver = new MutationObserver(updateCounts);
        countTargets.forEach(target => countObserver.observe(target, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: target.id === 'locationNPCs',
            attributeFilter: target.id === 'locationNPCs' ? ['hidden', 'class', 'style'] : undefined
        }));

        new MutationObserver(syncNavigation).observe(adventurePanel, {
            attributes: true,
            attributeFilter: ['class', 'hidden']
        });

        const resizeObserver = new ResizeObserver(scheduleMeasure);
        [header, globalTabBar, primaryNav, locationSubnav, playerSubnav, dock].forEach(element => resizeObserver.observe(element));
        new MutationObserver(scheduleMeasure).observe(dock, {
            attributes: true,
            attributeFilter: ['class', 'hidden'],
            childList: true,
            subtree: true
        });

        mobileQuery.addEventListener('change', syncResponsiveMode);
        window.addEventListener('resize', scheduleMeasure);
        syncResponsiveMode();
    }

    function run() {
        try {
            init();
        } catch (error) {
            console.error('Mobile Adventure navigation failed to initialize.', error);
            window.alert(error?.stack || error?.message || String(error));
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run, { once: true });
    } else {
        run();
    }
}());
