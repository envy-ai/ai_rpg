(() => {
    'use strict';

    const STATUS_LABELS = {
        available: 'Available',
        cooldown: 'Recharging',
        'needs-presence': 'Needs presence',
        locked: 'Locked'
    };

    const state = {
        favors: [],
        enabled: true,
        selected: null,
        requestId: 0,
        pending: false
    };

    const element = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    };

    const reportError = error => {
        console.error('Faction favor error:', error);
        window.AIRPG_PAGE_FEEDBACK?.showError(error);
    };

    async function fetchJson(url, options = {}) {
        const response = await fetch(url, { cache: 'no-store', ...options });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data?.success === false) {
            const error = new Error(data?.error || `Request failed: HTTP ${response.status}.`);
            if (data?.stack) error.stack = data.stack;
            throw error;
        }
        return data;
    }

    async function loadFavors({ includeLocked = false } = {}) {
        const data = await fetchJson(`/api/player/favors${includeLocked ? '?includeLocked=true' : ''}`);
        return { enabled: data.enabled !== false, favors: Array.isArray(data.favors) ? data.favors : [] };
    }

    async function regenerateFavor(row, { isCurrent }) {
        const confirmed = window.confirm(`Replace "${row.favor.name}" from ${row.faction.name} with a newly generated favor at the same tier? Its cooldown carries over and its icon is regenerated.`);
        if (!confirmed || !isCurrent()) return;
        const data = await fetchJson(`/api/factions/${encodeURIComponent(row.faction.id)}/favors/${encodeURIComponent(row.favor.id)}/regenerate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        window.ActionImages?.forget('favor', row.favor.id);
        window.refreshFactions?.();
        await refresh();
        return data;
    }

    function createIcon(row) {
        if (window.ActionImages && window.renderEntityImage && row.favor?.id) {
            return window.ActionImages.create({
                entityType: 'favor',
                entityId: row.favor.id,
                imageId: row.favor.imageId || null,
                imagePrompt: row.favor.imagePrompt || '',
                name: row.favor.name,
                extraActions: [{ label: 'Regenerate favor…', handler: context => regenerateFavor(row, context) }]
            });
        }
        return element('span', 'favor-icon-placeholder', '✦');
    }

    function describeStatus(row) {
        if (row.status === 'cooldown' && row.readyIn) return `Ready in ${row.readyIn}`;
        if (row.status === 'locked') return `Requires ${row.tierLabel}`;
        return STATUS_LABELS[row.status] || row.status;
    }

    function buildFavorCard(row, { onSelect = null, showFaction = true } = {}) {
        const card = element('div', `favor-card favor-card--${row.status}`);
        card.setAttribute('role', 'listitem');
        const icon = element('div', 'favor-card__icon');
        icon.append(createIcon(row));
        const copy = element('div', 'favor-card__copy');
        copy.append(element('div', 'favor-card__name', row.favor.name));
        if (showFaction) copy.append(element('div', 'favor-card__faction', row.faction.name));
        copy.append(element('div', 'favor-card__summary', row.favor.shortDescription));
        const meta = element('div', 'favor-card__meta');
        meta.append(element('span', `favor-card__status favor-card__status--${row.status}`, describeStatus(row)));
        meta.append(element('span', 'favor-card__cooldown', `Recharge: ${row.cooldown}`));
        copy.append(meta);
        if (row.reason && row.status !== 'available') {
            copy.title = row.reason;
        }
        card.append(icon, copy);
        if (onSelect) {
            const use = element('button', 'btn btn-primary btn-sm favor-card__use', 'Use');
            use.type = 'button';
            use.disabled = row.status !== 'available';
            if (row.reason && use.disabled) use.title = row.reason;
            use.setAttribute('aria-label', `Use ${row.favor.name}`);
            use.addEventListener('click', () => {
                Promise.resolve().then(() => onSelect(row)).catch(reportError);
            });
            card.append(use);
        }
        return card;
    }

    // ----- Factions tab status list -----

    function clearStatusList(container) {
        if (!container) return;
        if (window.ActionImages) window.ActionImages.destroyWithin(container);
        container.replaceChildren();
    }

    async function renderFactionStatusList(container, factionId) {
        const requestId = ++state.requestId;
        const { enabled, favors } = await loadFavors({ includeLocked: true });
        if (requestId !== state.requestId || !container.isConnected) return;
        clearStatusList(container);
        if (!enabled) {
            container.append(element('p', 'help-text', 'Faction favors are disabled in the configuration.'));
            return;
        }
        const rows = favors.filter(row => row.faction.id === factionId);
        if (!rows.length) {
            container.append(element('p', 'faction-favor-empty', 'This faction has no favors yet.'));
            return;
        }
        for (const row of rows) {
            container.append(buildFavorCard(row, {
                showFaction: false,
                onSelect: row.status === 'available' ? selected => openMenu({ select: selected.favor.id }) : null
            }));
        }
    }

    // ----- Chat favor menu -----

    const dom = {};

    function cacheDom() {
        dom.button = document.getElementById('favorMenuButton');
        dom.buttonRow = document.getElementById('chatPlayerFavorActions');
        dom.buttonLabel = document.getElementById('favorMenuButtonLabel');
        dom.modal = document.getElementById('favorMenuModal');
        dom.close = document.getElementById('favorMenuCloseBtn');
        dom.list = document.getElementById('favorMenuList');
        dom.empty = document.getElementById('favorMenuEmpty');
        dom.form = document.getElementById('favorUseForm');
        dom.title = document.getElementById('favorUseTitle');
        dom.description = document.getElementById('favorUseDescription');
        dom.targetGroup = document.getElementById('favorUseTargetGroup');
        dom.targetLabel = document.getElementById('favorUseTargetLabel');
        dom.target = document.getElementById('favorUseTarget');
        dom.destinationGroup = document.getElementById('favorUseDestinationGroup');
        dom.destination = document.getElementById('favorUseDestination');
        dom.cancel = document.getElementById('favorUseCancelBtn');
        dom.submit = document.getElementById('favorUseSubmitBtn');
        return Boolean(dom.modal && dom.list && dom.form);
    }

    function setModalVisible(visible) {
        window.AIRPG_MODAL_STACK.setVisible(dom.modal, visible);
        dom.modal.classList.toggle('is-open', visible);
        window.AIRPG_MODAL_STACK.sync();
        if (!visible) dom.button?.focus();
    }

    function renderMenuList() {
        clearStatusList(dom.list);
        dom.list.hidden = false;
        dom.form.hidden = true;
        dom.empty.hidden = state.favors.length > 0;
        for (const row of state.favors) {
            dom.list.append(buildFavorCard(row, { onSelect: selectFavor }));
        }
    }

    async function selectFavor(row) {
        state.selected = row;
        dom.title.textContent = `${row.favor.name} — ${row.faction.name}`;
        dom.description.textContent = row.favor.description;
        dom.target.value = '';
        dom.targetGroup.hidden = !row.favor.requiresTarget;
        dom.target.required = Boolean(row.favor.requiresTarget);
        dom.target.placeholder = row.favor.targetPrompt || '';
        dom.targetLabel.textContent = row.favor.targetPrompt || 'Target';
        dom.destinationGroup.hidden = true;
        dom.destination.replaceChildren();
        dom.destination.required = false;
        if (row.favor.effect?.type === 'fast-travel') {
            const data = await fetchJson(`/api/factions/${encodeURIComponent(row.faction.id)}/favors/${encodeURIComponent(row.favor.id)}/fast-travel-targets`);
            const targets = Array.isArray(data.targets) ? data.targets : [];
            if (!targets.length) {
                throw new Error(`${row.faction.name} controls no visited location you could travel to.`);
            }
            for (const target of targets) {
                const option = element('option', '', target.regionName ? `${target.name} (${target.regionName})` : target.name);
                option.value = target.id;
                option.dataset.name = target.name;
                option.dataset.regionName = target.regionName || '';
                dom.destination.append(option);
            }
            dom.destinationGroup.hidden = false;
            dom.destination.required = true;
        }
        dom.list.hidden = true;
        dom.empty.hidden = true;
        dom.form.hidden = false;
        (row.favor.requiresTarget ? dom.target : dom.submit).focus();
    }

    function buildActionText(row, target) {
        const base = `I call in a favor from ${row.faction.name}: ${row.favor.name}.`;
        return target ? `${base} ${target}` : base;
    }

    async function submitFavor(event) {
        event.preventDefault();
        const row = state.selected;
        if (!row || state.pending) return;
        const target = dom.target.value.trim();
        if (row.favor.requiresTarget && !target) {
            dom.target.focus();
            return;
        }
        const favorActivation = { favorId: row.favor.id };
        if (target) favorActivation.target = target;
        const actionText = buildActionText(row, target);
        state.pending = true;
        dom.submit.disabled = true;
        try {
            setModalVisible(false);
            if (row.favor.effect?.type === 'fast-travel') {
                const option = dom.destination.selectedOptions[0];
                if (!option) throw new Error('Choose a destination.');
                favorActivation.fastTravelLocationId = option.value;
                if (typeof window.performFavorFastTravel !== 'function') {
                    throw new Error('Map travel is unavailable; cannot use a fast-travel favor.');
                }
                await window.performFavorFastTravel({
                    destinationId: option.value,
                    destinationName: option.dataset.name,
                    destinationRegionName: option.dataset.regionName || null,
                    actionText,
                    favorActivation
                });
            } else {
                if (typeof window.activateTab === 'function') window.activateTab('adventure');
                await window.AIRPG_CHAT.dispatchAutomatedMessage(actionText, { favorActivation });
            }
        } catch (error) {
            reportError(error);
        } finally {
            state.pending = false;
            dom.submit.disabled = false;
            refresh();
        }
    }

    async function openMenu({ select = null } = {}) {
        if (!cacheDom()) return;
        try {
            const { favors } = await loadFavors();
            state.favors = favors;
            renderMenuList();
            setModalVisible(true);
            const preselected = select ? favors.find(row => row.favor.id === select && row.status === 'available') : null;
            if (preselected) {
                await selectFavor(preselected);
            } else {
                dom.close?.focus();
            }
        } catch (error) {
            reportError(error);
        }
    }

    async function refresh() {
        if (!cacheDom() || !dom.button) return;
        try {
            const { enabled, favors } = await loadFavors();
            state.enabled = enabled;
            state.favors = favors;
            const visible = enabled && favors.length > 0;
            if (dom.buttonRow) dom.buttonRow.hidden = !visible;
            const available = favors.filter(row => row.status === 'available').length;
            const label = available ? `Favors (${available})` : 'Favors';
            if (dom.buttonLabel) dom.buttonLabel.textContent = label;
            dom.button.setAttribute('aria-label', available ? `Favors, ${available} available` : 'Favors');
        } catch (error) {
            // No game loaded yet: the endpoint returns 404 until a player exists.
            if (dom.buttonRow) dom.buttonRow.hidden = true;
            if (!/No current player/.test(error.message)) reportError(error);
        }
    }

    function init() {
        if (!cacheDom()) return;
        window.AIRPG_MODAL_STACK.register(dom.modal);
        dom.button?.addEventListener('click', () => openMenu());
        dom.close?.addEventListener('click', () => setModalVisible(false));
        dom.cancel?.addEventListener('click', () => renderMenuList());
        dom.form.addEventListener('submit', submitFavor);
        window.AIRPG_MODAL_STACK.configure(dom.modal, {
            onDismiss: () => setModalVisible(false),
            escape: 'dismiss',
            dismissOnBackdrop: true,
            trapFocus: true
        });
        refresh();
    }

    window.AIRPG_FACTION_FAVORS = {
        refresh,
        openMenu,
        renderFactionStatusList,
        clearStatusList
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
