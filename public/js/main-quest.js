(() => {
    'use strict';

    const state = {
        data: null,
        starting: false,
        offerDismissedThisPage: false,
        offerTimer: null
    };
    const dom = {};

    const element = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    };

    const reportError = (error) => {
        console.error('Main quest error:', error);
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

    function cacheDom() {
        dom.section = document.getElementById('mainQuestSection');
        dom.history = document.getElementById('mainQuestHistory');
        dom.historyList = document.getElementById('mainQuestHistoryList');
        dom.modal = document.getElementById('mainQuestOfferModal');
        dom.form = document.getElementById('mainQuestOfferForm');
        dom.title = document.getElementById('mainQuestOfferTitle');
        dom.description = document.getElementById('mainQuestOfferDescription');
        dom.modes = document.getElementById('mainQuestOfferModes');
        dom.previousTitle = document.getElementById('mainQuestOfferPreviousTitle');
        dom.goal = document.getElementById('mainQuestOfferGoal');
        dom.later = document.getElementById('mainQuestOfferLaterBtn');
        dom.start = document.getElementById('mainQuestOfferStartBtn');
        dom.close = document.getElementById('mainQuestOfferCloseBtn');
        return Boolean(dom.section && dom.modal && dom.form);
    }

    // ----- Offer popup -----------------------------------------------------

    function pageIsIdle() {
        const chat = window.AIRPG_CHAT;
        if (!chat) return false;
        if (chat.pendingRequests?.size) return false;
        if (chat.pendingQuestOffers?.size) return false;
        if (typeof window.isPlayerAbilitySelectionBlockingGameplay === 'function'
            && window.isPlayerAbilitySelectionBlockingGameplay()) return false;
        if (document.querySelector('.modal[aria-hidden="false"]')) return false;
        // Wait until the opening scene (or any story) is on screen.
        return Boolean(document.querySelector('#chatLog .ai-message, .chat-log .ai-message'));
    }

    function offerIsDue() {
        const data = state.data;
        return Boolean(data?.enabled && data.gameLoaded && data.offer?.state === 'pending' && !data.active
            && !state.starting && !state.offerDismissedThisPage);
    }

    function scheduleOfferCheck() {
        if (state.offerTimer) return;
        const tick = () => {
            state.offerTimer = null;
            if (!offerIsDue()) return;
            if (pageIsIdle()) {
                openOffer();
                return;
            }
            state.offerTimer = window.setTimeout(tick, 2000);
        };
        state.offerTimer = window.setTimeout(tick, 1500);
    }

    function setModalVisible(visible) {
        window.AIRPG_MODAL_STACK.setVisible(dom.modal, visible);
        dom.modal.classList.toggle('is-open', visible);
        window.AIRPG_MODAL_STACK.sync();
    }

    function openOffer({ manual = false } = {}) {
        const data = state.data;
        if (!data?.enabled || !data.gameLoaded) return;
        const followUp = Boolean(data.offer?.followUpOf) || Boolean(data.history?.length);
        dom.title.textContent = data.offer?.followUpOf ? 'A new main quest?' : 'Main quest';
        dom.description.textContent = data.offer?.followUpOf
            ? `"${data.previousTitle || 'Your main quest'}" has concluded. Start another main quest: a sequel that continues its threads, something new, or let the story decide. Play continues either way.`
            : 'The main quest is an optional storyline that runs alongside free play. The world reacts if you ignore it, but you are never forced to follow it, and you can abandon it at any time.';
        dom.modes.hidden = !followUp;
        if (dom.previousTitle) dom.previousTitle.textContent = data.previousTitle || data.history?.[0]?.title || 'the last main quest';
        const sequelOption = dom.modes.querySelector('input[value="sequel"]');
        if (sequelOption) sequelOption.disabled = !followUp;
        dom.goal.value = '';
        dom.start.disabled = false;
        dom.later.textContent = manual ? 'Cancel' : 'Not now';
        dom.later.dataset.manual = manual ? 'true' : 'false';
        setModalVisible(true);
        window.setTimeout(() => dom.goal.focus(), 0);
    }

    async function declineOffer() {
        const manual = dom.later.dataset.manual === 'true';
        setModalVisible(false);
        state.offerDismissedThisPage = true;
        if (manual || state.data?.offer?.state !== 'pending') return;
        try {
            await fetchJson('/api/main-quest/decline', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
            await refresh();
        } catch (error) {
            reportError(error);
        }
    }

    async function submitOffer(event) {
        event.preventDefault();
        const goal = dom.goal.value.trim();
        const body = goal ? { goal } : {};
        if (!dom.modes.hidden) {
            body.mode = dom.modes.querySelector('input[name="mainQuestMode"]:checked')?.value || 'auto';
        }
        dom.start.disabled = true;
        try {
            await fetchJson('/api/main-quest/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            state.starting = true;
            setModalVisible(false);
            render();
        } catch (error) {
            dom.start.disabled = false;
            reportError(error);
        }
    }

    // ----- Quest panel -----------------------------------------------------

    function renderActiveCard(active) {
        const card = element('article', 'main-quest-card');
        const header = element('div', 'main-quest-card__header');
        header.append(element('span', 'main-quest-card__label', 'Main quest'), element('h3', 'main-quest-card__title', active.title));
        card.append(header);
        card.append(element('p', 'main-quest-card__premise', active.premise));
        if (active.currentStage) {
            const stage = element('div', 'main-quest-card__stage');
            stage.append(element('strong', '', 'Current goal: '), document.createTextNode(active.currentStage.objective || active.currentStage.title));
            card.append(stage);
        }
        if (active.pressure) {
            card.append(element('p', 'main-quest-card__pressure', active.pressure));
        }
        if (active.completedStages?.length) {
            const done = element('details', 'main-quest-card__progress');
            done.append(element('summary', '', `Progress so far (${active.completedStages.length})`));
            const list = element('ul');
            for (const stage of active.completedStages) {
                list.append(element('li', '', stage.outcome ? `${stage.title}: ${stage.outcome}` : stage.title));
            }
            done.append(list);
            card.append(done);
        }
        const actions = element('div', 'main-quest-card__actions');
        const abandon = element('button', 'quest-abandon-button', 'Abandon main quest');
        abandon.type = 'button';
        abandon.addEventListener('click', () => abandonMainQuest(abandon));
        actions.append(abandon);
        card.append(actions);
        return card;
    }

    function renderStartCard(data) {
        const card = element('div', 'main-quest-card main-quest-card--empty');
        if (state.starting) {
            card.append(element('p', 'main-quest-card__starting', 'The main quest is being written. It will appear here shortly; you can keep playing.'));
            return card;
        }
        card.append(element('p', 'main-quest-card__premise', data.history?.length
            ? 'No main quest is active. You can start another whenever you like.'
            : 'No main quest is active. Start one to add an optional storyline to your game.'));
        const button = element('button', 'btn btn-primary btn-sm', 'Start main quest');
        button.type = 'button';
        button.addEventListener('click', () => openOffer({ manual: true }));
        card.append(button);
        return card;
    }

    function renderHistory(history) {
        dom.historyList.replaceChildren();
        dom.history.hidden = !history?.length;
        for (const entry of history || []) {
            const item = element('div', `main-quest-history-item main-quest-history-item--${entry.status}`);
            item.append(element('strong', '', entry.title), element('span', 'main-quest-history-item__status', entry.status === 'completed' ? 'Completed' : 'Abandoned'));
            if (entry.reachedEnding) item.append(element('p', '', entry.reachedEnding));
            dom.historyList.append(item);
        }
    }

    function render() {
        const data = state.data;
        if (!data || !data.enabled || !data.gameLoaded) {
            dom.section.hidden = true;
            dom.history.hidden = true;
            return;
        }
        dom.section.hidden = false;
        dom.section.replaceChildren(data.active ? renderActiveCard(data.active) : renderStartCard(data));
        renderHistory(data.history);
    }

    async function abandonMainQuest(button) {
        const title = state.data?.active?.title || 'the main quest';
        const confirmed = window.confirm(`Abandon "${title}"? Its stage quest is removed and its deadlines stop, but the people and factions involved stay in the world and the story continues from where it is. You can start a new main quest later.`);
        if (!confirmed) return;
        button.disabled = true;
        try {
            const data = await fetchJson('/api/main-quest/abandon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
            applyState(data);
            await window.refreshQuestPanel?.();
        } catch (error) {
            button.disabled = false;
            reportError(error);
        }
    }

    // ----- State -------------------------------------------------------------

    function applyState(data) {
        state.data = {
            enabled: data.enabled !== false,
            gameLoaded: data.gameLoaded === true,
            offer: data.offer || { state: 'declined', followUpOf: null },
            active: data.active || null,
            history: Array.isArray(data.history) ? data.history : [],
            previousTitle: data.previousTitle || null
        };
        if (state.data.active) state.starting = false;
        render();
        if (offerIsDue()) scheduleOfferCheck();
    }

    async function refresh() {
        try {
            applyState(await fetchJson('/api/main-quest'));
        } catch (error) {
            reportError(error);
        }
    }

    function handleRealtime(type, payload) {
        if (type === 'main_quest_updated') {
            if (payload?.reason === 'starting') state.starting = true;
            if (payload?.reason === 'ending-reached') state.offerDismissedThisPage = false;
            if (payload?.state) applyState(payload.state);
            if (payload?.reason !== 'starting' && payload?.reason !== 'checked') window.refreshQuestPanel?.();
        } else if (type === 'main_quest_error') {
            state.starting = false;
            if (payload?.state) applyState(payload.state);
            const error = new Error(`Main quest ${payload?.action || 'update'} failed: ${payload?.message || 'unknown error'}`);
            if (payload?.stack) error.stack = payload.stack;
            reportError(error);
        }
    }

    function init() {
        if (!cacheDom()) return;
        window.AIRPG_MODAL_STACK.register(dom.modal);
        window.AIRPG_MODAL_STACK.configure(dom.modal, {
            onDismiss: () => declineOffer(),
            escape: 'dismiss',
            dismissOnBackdrop: false,
            trapFocus: true
        });
        dom.form.addEventListener('submit', submitOffer);
        dom.later.addEventListener('click', () => declineOffer());
        dom.close.addEventListener('click', () => declineOffer());
        refresh();
    }

    window.AIRPG_MAIN_QUEST = { refresh, openOffer: () => openOffer({ manual: true }), handleRealtime };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
