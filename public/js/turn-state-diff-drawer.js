(function (global) {
    'use strict';

    let drawerIdCounter = 0;

    const CATEGORY_LABELS = {
        time: 'Time',
        travel: 'Travel',
        character: 'Character',
        needs: 'Needs',
        inventory: 'Inventory',
        npc_party: 'NPCs',
        quest_reward: 'Quests',
        disposition: 'Dispositions',
        faction_relationship: 'Factions',
        location_world: 'World',
        status: 'Status',
        other: 'Other'
    };

    const CATEGORY_ORDER = [
        'travel',
        'time',
        'character',
        'needs',
        'inventory',
        'npc_party',
        'quest_reward',
        'disposition',
        'faction_relationship',
        'location_world',
        'status',
        'other'
    ];

    function isObject(value) {
        return value !== null && typeof value === 'object';
    }

    function normalizeString(value) {
        if (value === null || value === undefined) {
            return '';
        }
        return String(value).trim();
    }

    function normalizeEntityRefs(entityRefs) {
        if (!Array.isArray(entityRefs)) {
            return [];
        }
        return entityRefs
            .map(ref => {
                if (!isObject(ref)) {
                    return null;
                }
                const type = normalizeString(ref.type).toLowerCase();
                const id = normalizeString(ref.id);
                const name = normalizeString(ref.name);
                if (!type || (!id && !name)) {
                    return null;
                }
                return { type, id: id || null, name: name || null };
            })
            .filter(Boolean);
    }

    function isTurnDiffEntry(entry) {
        if (!isObject(entry)) {
            return false;
        }
        return entry.type === 'event-summary' || entry.type === 'status-summary';
    }

    function parseContentItems(entry) {
        const content = normalizeString(entry && entry.content);
        if (!content) {
            return [];
        }

        const title = normalizeString(entry.summaryTitle);
        const lines = content
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean);

        if (!lines.length) {
            return [];
        }

        return lines
            .filter((line, index) => !(index === 0 && title && line === title))
            .map(line => ({
                icon: '*',
                text: line.replace(/^\s*[-*]\s+/, '').trim()
            }))
            .filter(item => item.text);
    }

    function normalizeEntryItems(entry) {
        if (!isTurnDiffEntry(entry)) {
            return [];
        }

        const sourceItems = Array.isArray(entry.summaryItems) && entry.summaryItems.length
            ? entry.summaryItems
            : parseContentItems(entry);

        return sourceItems
            .map(item => {
                if (!isObject(item)) {
                    const text = normalizeString(item);
                    return text ? { icon: '*', text } : null;
                }

                const text = normalizeString(item.text || item.summary || item.description || item.content);
                if (!text) {
                    return null;
                }

                return {
                    icon: normalizeString(item.icon) || '*',
                    text,
                    category: normalizeString(item.category),
                    severity: normalizeString(item.severity),
                    sourceType: normalizeString(item.sourceType),
                    entityRefs: normalizeEntityRefs(item.entityRefs),
                    entryType: entry.type,
                    summaryTitle: normalizeString(entry.summaryTitle)
                };
            })
            .filter(Boolean);
    }

    function normalizeTurnDiffEntries(entries) {
        if (!Array.isArray(entries)) {
            return [];
        }

        return entries
            .filter(isTurnDiffEntry)
            .flatMap(entry => normalizeEntryItems(entry).map(item => ({
                ...item,
                category: categorizeTurnDiffItem(item, entry),
                severity: inferSeverity(item, entry)
            })));
    }

    function includesAny(text, terms) {
        return terms.some(term => text.includes(term));
    }

    function categorizeTurnDiffItem(item, entry) {
        const explicitCategory = normalizeString(item && item.category);
        if (explicitCategory && CATEGORY_LABELS[explicitCategory]) {
            return explicitCategory;
        }

        if (entry && entry.type === 'status-summary') {
            return 'status';
        }

        return 'other';
    }

    function inferSeverity(item, entry) {
        const explicitSeverity = normalizeString(item && item.severity).toLowerCase();
        if (explicitSeverity === 'critical' || explicitSeverity === 'important' || explicitSeverity === 'normal') {
            return explicitSeverity;
        }

        const text = [
            item && item.text,
            item && item.summaryTitle,
            entry && entry.summaryTitle
        ].map(value => normalizeString(value).toLowerCase()).join(' ');

        if (includesAny(text, ['killed', 'incapacitated', 'dead'])) {
            return 'critical';
        }
        if (includesAny(text, [
            'damage',
            'healed',
            'quest objective complete',
            'finished quest',
            'joined the party',
            'left the party',
            'reputation with',
            'travelled',
            'traveled',
            'new exit'
        ])) {
            return 'important';
        }

        return 'normal';
    }

    function summarizeTurnDiff(entries) {
        const rows = normalizeTurnDiffEntries(entries);
        const categoryCounts = new Map();
        let severity = 'normal';

        rows.forEach(row => {
            categoryCounts.set(row.category, (categoryCounts.get(row.category) || 0) + 1);
            if (row.severity === 'critical') {
                severity = 'critical';
            } else if (row.severity === 'important' && severity !== 'critical') {
                severity = 'important';
            }
        });

        const categories = CATEGORY_ORDER
            .filter(category => categoryCounts.has(category))
            .map(category => ({
                category,
                label: CATEGORY_LABELS[category] || CATEGORY_LABELS.other,
                count: categoryCounts.get(category)
            }));

        return {
            rows,
            total: rows.length,
            categories,
            severity,
            defaultOpen: severity === 'critical' || severity === 'important'
        };
    }

    function entrySignature(entry) {
        if (!isTurnDiffEntry(entry)) {
            return '';
        }

        const itemText = normalizeEntryItems(entry)
            .map(item => `${item.icon}:${item.text}`)
            .join('|');

        return [
            normalizeString(entry.id),
            normalizeString(entry.type),
            normalizeString(entry.summaryTitle),
            itemText || normalizeString(entry.content)
        ].join('::');
    }

    function dedupeEntries(entries) {
        const seen = new Set();
        const deduped = [];
        (Array.isArray(entries) ? entries : []).forEach(entry => {
            const signature = entrySignature(entry);
            if (!signature || seen.has(signature)) {
                return;
            }
            seen.add(signature);
            deduped.push(entry);
        });
        return deduped;
    }

    function appendText(target, text, options) {
        if (options && typeof options.renderText === 'function') {
            options.renderText(target, text);
            return;
        }
        target.textContent = text;
    }

    function createCategoryChip(categoryInfo) {
        const chip = document.createElement('span');
        chip.className = 'turn-diff-drawer__category-chip';
        chip.dataset.category = categoryInfo.category;
        chip.textContent = categoryInfo.count > 1
            ? `${categoryInfo.label} ${categoryInfo.count}`
            : categoryInfo.label;
        return chip;
    }

    function createDrawer(entries, options = {}) {
        const summary = summarizeTurnDiff(entries);
        if (!summary.total) {
            return null;
        }

        const open = typeof options.open === 'boolean' ? options.open : summary.defaultOpen;
        const drawer = document.createElement('section');
        drawer.className = `turn-diff-drawer turn-diff-drawer--${summary.severity}`;
        drawer.dataset.severity = summary.severity;

        const bodyId = `turn-diff-drawer-body-${++drawerIdCounter}`;

        const header = document.createElement('div');
        header.className = 'turn-diff-drawer__header';

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'turn-diff-drawer__toggle';
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggle.setAttribute('aria-controls', bodyId);
        toggle.setAttribute('aria-label', `What changed, ${summary.total} item${summary.total === 1 ? '' : 's'}`);

        const toggleLabel = document.createElement('span');
        toggleLabel.className = 'turn-diff-drawer__toggle-label';
        toggleLabel.textContent = `What changed (${summary.total})`;
        toggle.appendChild(toggleLabel);

        const severity = document.createElement('span');
        severity.className = 'turn-diff-drawer__severity';
        severity.textContent = summary.severity === 'critical'
            ? 'Critical'
            : summary.severity === 'important'
                ? 'Important'
                : '';
        if (!severity.textContent) {
            severity.hidden = true;
        }
        toggle.appendChild(severity);
        header.appendChild(toggle);

        const chips = document.createElement('div');
        chips.className = 'turn-diff-drawer__categories';
        summary.categories.slice(0, 3).forEach(categoryInfo => {
            chips.appendChild(createCategoryChip(categoryInfo));
        });
        header.appendChild(chips);

        const body = document.createElement('div');
        body.className = 'turn-diff-drawer__body';
        body.id = bodyId;
        body.hidden = !open;

        summary.categories.forEach(categoryInfo => {
            const groupRows = summary.rows.filter(row => row.category === categoryInfo.category);
            if (!groupRows.length) {
                return;
            }

            const group = document.createElement('section');
            group.className = 'turn-diff-drawer__group';
            group.dataset.category = categoryInfo.category;

            const heading = document.createElement('h4');
            heading.className = 'turn-diff-drawer__group-title';
            heading.textContent = categoryInfo.label;
            group.appendChild(heading);

            const list = document.createElement('ul');
            list.className = 'turn-diff-drawer__list';
            groupRows.forEach(row => {
                const item = document.createElement('li');
                item.className = `turn-diff-drawer__row turn-diff-drawer__row--${row.severity}`;

                const icon = document.createElement('span');
                icon.className = 'turn-diff-drawer__icon';
                icon.setAttribute('aria-hidden', 'true');
                icon.textContent = row.icon || '*';
                item.appendChild(icon);

                const text = document.createElement('span');
                text.className = 'turn-diff-drawer__text';
                appendText(text, row.text, options);
                item.appendChild(text);

                list.appendChild(item);
            });

            group.appendChild(list);
            body.appendChild(group);
        });

        toggle.addEventListener('click', () => {
            const expanded = toggle.getAttribute('aria-expanded') === 'true';
            toggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
            body.hidden = expanded;
        });

        drawer.appendChild(header);
        drawer.appendChild(body);
        drawer.__turnDiffEntries = dedupeEntries(entries);
        return drawer;
    }

    function appendDrawer(parentElement, entries, options = {}) {
        if (!parentElement || !Array.isArray(entries) || !entries.length) {
            return null;
        }

        const existingDrawer = parentElement.querySelector(':scope > .turn-diff-drawer');
        const existingEntries = existingDrawer && Array.isArray(existingDrawer.__turnDiffEntries)
            ? existingDrawer.__turnDiffEntries
            : [];
        const existingToggle = existingDrawer
            ? existingDrawer.querySelector('.turn-diff-drawer__toggle')
            : null;
        const existingOpen = existingToggle
            ? existingToggle.getAttribute('aria-expanded') === 'true'
            : undefined;
        const combinedEntries = dedupeEntries(existingEntries.concat(entries));
        const drawer = createDrawer(combinedEntries, {
            ...options,
            open: typeof existingOpen === 'boolean' ? existingOpen : options.open
        });

        if (!drawer) {
            return null;
        }

        if (existingDrawer) {
            existingDrawer.replaceWith(drawer);
        } else {
            parentElement.appendChild(drawer);
        }
        parentElement.classList.add('message--has-turn-diff');
        return drawer;
    }

    global.TurnStateDiffDrawer = {
        isTurnDiffEntry,
        normalizeTurnDiffEntries,
        categorizeTurnDiffItem,
        summarizeTurnDiff,
        createDrawer,
        appendDrawer
    };
})(window);
