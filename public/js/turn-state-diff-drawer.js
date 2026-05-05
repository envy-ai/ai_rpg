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

    const SEVERITY_RANK = {
        critical: 0,
        important: 1,
        normal: 2
    };

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

    function normalizeMetadata(metadata) {
        if (!isObject(metadata) || Array.isArray(metadata)) {
            return null;
        }
        try {
            return JSON.parse(JSON.stringify(metadata));
        } catch (error) {
            return null;
        }
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
                    metadata: normalizeMetadata(item.metadata),
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
            .flatMap((entry, entryIndex) => normalizeEntryItems(entry).map((item, itemIndex) => ({
                ...item,
                category: categorizeTurnDiffItem(item, entry),
                severity: inferSeverity(item, entry),
                originalOrder: (entryIndex * 10000) + itemIndex
            })))
            .sort(compareTurnDiffRows)
            .map(row => {
                const { originalOrder, ...publicRow } = row;
                return publicRow;
            });
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

    function compareTurnDiffRows(a, b) {
        const aRank = SEVERITY_RANK[a && a.severity] ?? SEVERITY_RANK.normal;
        const bRank = SEVERITY_RANK[b && b.severity] ?? SEVERITY_RANK.normal;
        if (aRank !== bRank) {
            return aRank - bRank;
        }
        return (a && a.originalOrder ? a.originalOrder : 0) - (b && b.originalOrder ? b.originalOrder : 0);
    }

    function isElapsedTimeRow(row) {
        const category = normalizeString(row && row.category).toLowerCase();
        if (category !== 'time') {
            return false;
        }

        const sourceType = normalizeString(row && row.sourceType).toLowerCase();
        if (sourceType === 'time_passed') {
            return true;
        }

        const icon = normalizeString(row && row.icon);
        const text = normalizeString(row && row.text).toLowerCase();
        return icon === '⏳' && /\bpassed\.?$/.test(text);
    }

    function formatElapsedTimeRow(row) {
        const icon = normalizeString(row && row.icon);
        const text = normalizeString(row && row.text);
        if (!text) {
            return icon;
        }
        if (icon && text.startsWith(icon)) {
            return text;
        }
        return [icon, text].filter(Boolean).join(' ');
    }

    function summarizeTurnDiff(entries) {
        const rows = normalizeTurnDiffEntries(entries);
        const elapsedTimeRows = rows.filter(isElapsedTimeRow);
        const bodyRows = rows.filter(row => !isElapsedTimeRow(row));
        const categoryCounts = new Map();
        let severity = 'normal';

        bodyRows.forEach(row => {
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
            bodyRows,
            elapsedTimeRows,
            elapsedTimeText: elapsedTimeRows.map(formatElapsedTimeRow).filter(Boolean).join(' · '),
            total: rows.length,
            changeCount: bodyRows.length,
            categories,
            severity,
            defaultOpen: bodyRows.length > 0 && (severity === 'critical' || severity === 'important')
        };
    }

    function entrySignature(entry) {
        if (!isTurnDiffEntry(entry)) {
            return '';
        }

        const itemText = normalizeEntryItems(entry)
            .map(item => `${item.icon}:${item.text}:${JSON.stringify(item.metadata || null)}`)
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

    function safeClassToken(value) {
        return normalizeString(value)
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'entity';
    }

    function dispatchEntitySelectedEvent(target, ref, row) {
        if (!target || !ref || !ref.id) {
            return;
        }
        if (typeof global.CustomEvent !== 'function') {
            throw new Error('CustomEvent is required for turn diff entity selection.');
        }

        target.dispatchEvent(new global.CustomEvent('airpg:turn-diff-entity-selected', {
            bubbles: true,
            detail: {
                type: ref.type,
                id: ref.id,
                name: ref.name,
                category: row.category,
                severity: row.severity,
                sourceType: row.sourceType || null,
                text: row.text
            }
        }));
    }

    function createEntityChip(ref, row) {
        const isClickable = Boolean(ref && ref.id);
        const chip = document.createElement(isClickable ? 'button' : 'span');
        const typeToken = safeClassToken(ref && ref.type);
        chip.className = [
            'turn-diff-drawer__entity-chip',
            `turn-diff-drawer__entity-chip--${typeToken}`,
            isClickable ? 'turn-diff-drawer__entity-chip--clickable' : ''
        ].filter(Boolean).join(' ');
        chip.dataset.entityType = ref.type;
        if (ref.id) {
            chip.dataset.entityId = ref.id;
        }
        if (ref.name) {
            chip.dataset.entityName = ref.name;
        }
        chip.textContent = ref.name || ref.id;

        if (isClickable) {
            chip.type = 'button';
            chip.setAttribute('aria-label', `Select ${ref.type} ${ref.name || ref.id}`);
            chip.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                dispatchEntitySelectedEvent(chip, ref, row);
            });
        }

        return chip;
    }

    function createEntityList(row) {
        const refs = normalizeEntityRefs(row && row.entityRefs);
        if (!refs.length) {
            return null;
        }

        const list = document.createElement('span');
        list.className = 'turn-diff-drawer__entity-list';
        refs.forEach(ref => {
            list.appendChild(createEntityChip(ref, row));
        });
        return list;
    }

    function normalizeNewExitMetadata(row) {
        const metadata = row && row.metadata && typeof row.metadata === 'object'
            ? row.metadata.newExitDiscovered
            : null;
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
            return null;
        }

        const normalized = {};
        [
            'label',
            'destinationKind',
            'originLocationId',
            'originLocationName',
            'originRegionId',
            'originRegionName',
            'destinationId',
            'destinationName',
            'destinationLocationName',
            'destinationRegionId',
            'destinationRegionName',
            'exitId'
        ].forEach(key => {
            const text = normalizeString(metadata[key]);
            normalized[key] = text || null;
        });

        if (!normalized.originRegionId && !normalized.originLocationId && !normalized.destinationId && !normalized.exitId) {
            return null;
        }

        return normalized;
    }

    function createNewExitPill(row) {
        const metadata = normalizeNewExitMetadata(row);
        if (!metadata) {
            return null;
        }
        const label = normalizeString(
            metadata.destinationLocationName
            || metadata.destinationName
            || metadata.destinationRegionName
            || metadata.label
        ) || 'Map';
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'turn-diff-drawer__new-exit-pill';
        pill.textContent = `🗺️ ${label}`;
        pill.title = 'Open this exit on the map';
        pill.setAttribute('aria-label', `Open ${label} on the map`);
        pill.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            if (typeof global.CustomEvent !== 'function') {
                throw new Error('CustomEvent is required for new exit summary navigation.');
            }
            pill.dispatchEvent(new global.CustomEvent('airpg:new-exit-summary-selected', {
                bubbles: true,
                detail: metadata
            }));
        });
        return pill;
    }

    function createStandardRow(row, options) {
        const item = document.createElement('li');
        item.className = `turn-diff-drawer__row turn-diff-drawer__row--${row.severity}`;
        item.dataset.category = row.category;
        item.dataset.severity = row.severity;
        if (row.sourceType) {
            item.dataset.sourceType = row.sourceType;
        }

        const icon = document.createElement('span');
        icon.className = 'turn-diff-drawer__icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = row.icon || '*';
        item.appendChild(icon);

        const main = document.createElement('span');
        main.className = 'turn-diff-drawer__row-main';

        const text = document.createElement('span');
        text.className = 'turn-diff-drawer__text';
        appendText(text, row.text, options);
        main.appendChild(text);

        const newExitPill = createNewExitPill(row);
        if (newExitPill) {
            main.appendChild(newExitPill);
        }

        const entityList = createEntityList(row);
        if (entityList) {
            main.appendChild(entityList);
        }

        item.appendChild(main);
        return item;
    }

    function normalizeDispositionChange(row) {
        if (!row) {
            return null;
        }

        const metadata = row.metadata && typeof row.metadata === 'object'
            ? row.metadata.dispositionChange
            : null;
        const text = normalizeString(row.text);
        const parsed = text.match(/^(.+?)'s\s+(.+?)\s+disposition\s+Δ\s+([+-]?\d+)/i);
        const npcName = normalizeString(metadata && metadata.npcName) || (parsed ? normalizeString(parsed[1]) : 'Someone');
        const npcId = normalizeString(metadata && metadata.npcId) || null;
        const typeLabel = normalizeString(metadata && metadata.typeLabel) || (parsed ? normalizeString(parsed[2]) : 'Disposition');
        const metadataDelta = Number(metadata && metadata.delta);
        const parsedDelta = parsed ? Number(parsed[3]) : NaN;
        const delta = Number.isFinite(metadataDelta)
            ? metadataDelta
            : (Number.isFinite(parsedDelta) ? parsedDelta : null);
        if (Number.isFinite(delta) && delta === 0) {
            return null;
        }
        const icon = normalizeString(metadata && metadata.icon) || normalizeString(row.icon) || '💞';

        return {
            npcId,
            npcName,
            typeLabel,
            icon,
            delta,
            row
        };
    }

    function compareDispositionSeverity(currentSeverity, rowSeverity) {
        const currentRank = SEVERITY_RANK[currentSeverity] ?? SEVERITY_RANK.normal;
        const rowRank = SEVERITY_RANK[rowSeverity] ?? SEVERITY_RANK.normal;
        return rowRank < currentRank ? rowSeverity : currentSeverity;
    }

    function groupDispositionRows(rows) {
        const groups = new Map();
        (Array.isArray(rows) ? rows : []).forEach(row => {
            const change = normalizeDispositionChange(row);
            if (!change) {
                return;
            }
            const key = change.npcId || change.npcName.toLowerCase();
            if (!groups.has(key)) {
                groups.set(key, {
                    npcName: change.npcName,
                    changes: [],
                    severity: row.severity || 'normal'
                });
            }
            const group = groups.get(key);
            group.changes.push(change);
            group.severity = compareDispositionSeverity(group.severity, row.severity || 'normal');
        });
        return Array.from(groups.values()).filter(group => group.changes.length);
    }

    function createDispositionRows(rows, options) {
        const groups = groupDispositionRows(rows);
        if (!groups.length) {
            return null;
        }

        const list = document.createElement('div');
        list.className = 'turn-diff-drawer__disposition-list';

        groups.forEach(group => {
            const details = document.createElement('details');
            details.className = `turn-diff-drawer__disposition-row turn-diff-drawer__row--${group.severity}`;
            details.dataset.category = 'disposition';
            details.dataset.severity = group.severity;

            const summary = document.createElement('summary');
            summary.className = 'turn-diff-drawer__disposition-summary';

            const name = document.createElement('strong');
            name.className = 'turn-diff-drawer__disposition-name';
            name.textContent = group.npcName;
            summary.appendChild(name);
            summary.appendChild(document.createTextNode(': '));

            const pills = document.createElement('span');
            pills.className = 'turn-diff-drawer__disposition-pills';
            group.changes.forEach(change => {
                if (!Number.isFinite(change.delta) || change.delta === 0) {
                    return;
                }
                const pill = document.createElement('span');
                pill.className = 'turn-diff-drawer__disposition-pill';
                pill.title = change.typeLabel;
                pill.setAttribute('aria-label', `${change.typeLabel} ${change.delta > 0 ? 'increased' : 'decreased'} by ${Math.abs(Math.round(change.delta))}`);
                const sign = change.delta > 0 ? '+' : '';
                pill.textContent = `${change.icon}${sign}${Math.round(change.delta)}`;
                pills.appendChild(pill);
            });
            summary.appendChild(pills);
            details.appendChild(summary);

            const body = document.createElement('div');
            body.className = 'turn-diff-drawer__disposition-details';
            const detailList = document.createElement('ul');
            detailList.className = 'turn-diff-drawer__disposition-detail-list';

            group.changes.forEach(change => {
                const detailItem = document.createElement('li');
                detailItem.className = 'turn-diff-drawer__disposition-detail';

                const icon = document.createElement('span');
                icon.className = 'turn-diff-drawer__icon';
                icon.setAttribute('aria-hidden', 'true');
                icon.textContent = change.icon || '💞';
                detailItem.appendChild(icon);

                const main = document.createElement('span');
                main.className = 'turn-diff-drawer__row-main';

                const text = document.createElement('span');
                text.className = 'turn-diff-drawer__text';
                appendText(text, change.row.text, options);
                main.appendChild(text);

                const entityList = createEntityList(change.row);
                if (entityList) {
                    main.appendChild(entityList);
                }

                detailItem.appendChild(main);
                detailList.appendChild(detailItem);
            });

            body.appendChild(detailList);
            details.appendChild(body);
            list.appendChild(details);
        });

        return list;
    }

    function normalizeNeedBarChange(row) {
        if (!row) {
            return null;
        }

        const metadata = row.metadata && typeof row.metadata === 'object'
            ? row.metadata.needBarChange
            : null;
        const text = normalizeString(row.text);
        const parsed = text.match(/^(.+?)'s\s+(.+?)\s+(?:(?:small|medium|large|fill|all)\s+)?(?:increase|decrease|changed|raise|lower|restore|drain)\b.*?(?:Δ\s+([+-]?\d+(?:\.\d+)?))?/i);
        const firstRef = Array.isArray(row.entityRefs) ? row.entityRefs.find(ref => ref && ref.type === 'npc') : null;
        const actorName = normalizeString(metadata && metadata.actorName)
            || normalizeString(firstRef && firstRef.name)
            || (parsed ? normalizeString(parsed[1]) : 'Unknown');
        const actorId = normalizeString(metadata && metadata.actorId)
            || normalizeString(firstRef && firstRef.id)
            || null;
        const needBarName = normalizeString(metadata && metadata.needBarName)
            || (parsed ? normalizeString(parsed[2]) : 'Need Bar');
        const icon = normalizeString(metadata && metadata.icon) || normalizeString(row.icon) || '🧪';
        const metadataDelta = Number(metadata && metadata.delta);
        const parsedDeltaText = parsed ? normalizeString(parsed[3]) : '';
        let deltaText = normalizeString(metadata && metadata.deltaText) || parsedDeltaText;
        if (!deltaText && Number.isFinite(metadataDelta) && metadataDelta !== 0) {
            deltaText = `${metadataDelta > 0 ? '+' : ''}${Math.round(metadataDelta)}`;
        }
        if (deltaText === '+0' || deltaText === '-0' || deltaText === '0') {
            deltaText = '';
        }

        return {
            actorId,
            actorName,
            needBarName,
            icon,
            deltaText,
            row
        };
    }

    function groupNeedRows(rows) {
        const groups = new Map();
        (Array.isArray(rows) ? rows : []).forEach(row => {
            const change = normalizeNeedBarChange(row);
            if (!change) {
                return;
            }
            const key = change.actorId || change.actorName.toLowerCase();
            if (!groups.has(key)) {
                groups.set(key, {
                    actorName: change.actorName,
                    changes: [],
                    severity: row.severity || 'normal'
                });
            }
            const group = groups.get(key);
            group.changes.push(change);
            group.severity = compareDispositionSeverity(group.severity, row.severity || 'normal');
        });
        return Array.from(groups.values()).filter(group => group.changes.length);
    }

    function createNeedRows(rows, options) {
        const groups = groupNeedRows(rows);
        if (!groups.length) {
            return null;
        }

        const list = document.createElement('div');
        list.className = 'turn-diff-drawer__need-list';

        groups.forEach(group => {
            const details = document.createElement('details');
            details.className = `turn-diff-drawer__need-row turn-diff-drawer__row--${group.severity}`;
            details.dataset.category = 'needs';
            details.dataset.severity = group.severity;

            const summary = document.createElement('summary');
            summary.className = 'turn-diff-drawer__need-summary';

            const name = document.createElement('strong');
            name.className = 'turn-diff-drawer__need-name';
            name.textContent = group.actorName;
            summary.appendChild(name);
            summary.appendChild(document.createTextNode(': '));

            const pills = document.createElement('span');
            pills.className = 'turn-diff-drawer__need-pills';
            group.changes.forEach(change => {
                const pill = document.createElement('span');
                pill.className = 'turn-diff-drawer__need-pill';
                pill.title = change.needBarName;
                pill.setAttribute('aria-label', change.deltaText
                    ? `${change.needBarName} changed by ${change.deltaText}`
                    : `${change.needBarName} changed`);
                pill.textContent = `${change.icon}${change.deltaText || ''}`;
                pills.appendChild(pill);
            });
            summary.appendChild(pills);
            details.appendChild(summary);

            const body = document.createElement('div');
            body.className = 'turn-diff-drawer__need-details';
            const detailList = document.createElement('ul');
            detailList.className = 'turn-diff-drawer__need-detail-list';

            group.changes.forEach(change => {
                const detailItem = document.createElement('li');
                detailItem.className = 'turn-diff-drawer__need-detail';

                const icon = document.createElement('span');
                icon.className = 'turn-diff-drawer__icon';
                icon.setAttribute('aria-hidden', 'true');
                icon.textContent = change.icon || '🧪';
                detailItem.appendChild(icon);

                const main = document.createElement('span');
                main.className = 'turn-diff-drawer__row-main';

                const text = document.createElement('span');
                text.className = 'turn-diff-drawer__text';
                appendText(text, change.row.text, options);
                main.appendChild(text);

                const entityList = createEntityList(change.row);
                if (entityList) {
                    main.appendChild(entityList);
                }

                detailItem.appendChild(main);
                detailList.appendChild(detailItem);
            });

            body.appendChild(detailList);
            details.appendChild(body);
            list.appendChild(details);
        });

        return list;
    }

    function createDrawer(entries, options = {}) {
        const summary = summarizeTurnDiff(entries);
        if (!summary.total) {
            return null;
        }

        const hasBodyRows = summary.changeCount > 0;
        const open = hasBodyRows && (typeof options.open === 'boolean' ? options.open : summary.defaultOpen);
        const drawer = document.createElement('section');
        drawer.className = [
            'turn-diff-drawer',
            `turn-diff-drawer--${summary.severity}`,
            hasBodyRows ? '' : 'turn-diff-drawer--empty'
        ].filter(Boolean).join(' ');
        drawer.dataset.severity = summary.severity;

        const bodyId = `turn-diff-drawer-body-${++drawerIdCounter}`;

        const header = document.createElement('div');
        header.className = 'turn-diff-drawer__header';

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'turn-diff-drawer__toggle';
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggle.setAttribute('aria-controls', bodyId);
        toggle.setAttribute('aria-label', `What changed, ${summary.changeCount} item${summary.changeCount === 1 ? '' : 's'}`);
        if (!hasBodyRows) {
            toggle.disabled = true;
            toggle.setAttribute('aria-disabled', 'true');
        }

        const toggleLabel = document.createElement('span');
        toggleLabel.className = 'turn-diff-drawer__toggle-label';
        toggleLabel.textContent = `What changed (${summary.changeCount})`;
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

        if (summary.elapsedTimeText) {
            const elapsedTime = document.createElement('span');
            elapsedTime.className = 'turn-diff-drawer__elapsed-time';
            elapsedTime.textContent = summary.elapsedTimeText;
            header.appendChild(elapsedTime);
        }

        const body = document.createElement('div');
        body.className = 'turn-diff-drawer__body';
        body.id = bodyId;
        body.hidden = !open;

        summary.categories.forEach(categoryInfo => {
            const groupRows = summary.bodyRows.filter(row => row.category === categoryInfo.category);
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

            const dispositionRows = categoryInfo.category === 'disposition'
                ? createDispositionRows(groupRows, options)
                : null;
            if (dispositionRows) {
                group.appendChild(dispositionRows);
            } else {
                const needRows = categoryInfo.category === 'needs'
                    ? createNeedRows(groupRows, options)
                    : null;
                if (needRows) {
                    group.appendChild(needRows);
                } else {
                    const list = document.createElement('ul');
                    list.className = 'turn-diff-drawer__list';
                    groupRows.forEach(row => {
                        list.appendChild(createStandardRow(row, options));
                    });
                    group.appendChild(list);
                }
            }
            body.appendChild(group);
        });

        toggle.addEventListener('click', () => {
            if (!hasBodyRows || toggle.disabled) {
                return;
            }
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
        isElapsedTimeRow,
        createDrawer,
        appendDrawer,
        createEntityList
    };
})(window);
