(function (root, factory) {
    const exported = factory();
    if (typeof module === 'object' && module.exports) module.exports = exported;
    else root.ItemSummaryPresentation = exported;
})(typeof window === 'undefined' ? globalThis : window, function () {
    'use strict';

    function snapshot(item) {
        if (!item || typeof item !== 'object') throw new Error('Item summary snapshot requires an actual item record.');
        const name = typeof item.name === 'string' ? item.name : '';
        if (!name.trim()) throw new Error('Item summary snapshot requires the actual nonempty item name.');
        return { itemId: typeof item.itemId === 'string' ? item.itemId : typeof item.id === 'string' ? item.id : null,
            name, rarity: typeof item.rarity === 'string' && item.rarity.trim() ? item.rarity.trim() : null };
    }

    function compose(parts) {
        if (!Array.isArray(parts)) throw new Error('Item summary composition requires text/item parts.');
        let text = '';
        const mentions = [];
        for (const part of parts) {
            if (typeof part === 'string') { text += part; continue; }
            const item = snapshot(part?.item);
            if (part.quantity !== undefined && (!Number.isSafeInteger(part.quantity) || part.quantity < 1)) throw new Error('Item summary quantity must be a positive safe integer.');
            if (part.quantity > 1) text += `**${part.quantity}x** `;
            const start = text.length;
            text += item.name;
            mentions.push({ start, end: text.length, ...item });
        }
        const leading = text.length - text.trimStart().length;
        text = text.trim();
        const itemMentions = mentions.map(mention => ({ ...mention, start: mention.start - leading, end: mention.end - leading }));
        return { text, metadata: { itemMentions } };
    }

    function normalizeMentions(text, mentions) {
        if (typeof text !== 'string' || !Array.isArray(mentions)) return [];
        const normalized = [];
        for (const mention of [...mentions].sort((a, b) => (a?.start ?? -1) - (b?.start ?? -1))) {
            if (!mention || !Number.isSafeInteger(mention.start) || !Number.isSafeInteger(mention.end)
                || mention.start < 0 || mention.end <= mention.start || mention.end > text.length
                || typeof mention.name !== 'string' || text.slice(mention.start, mention.end) !== mention.name
                || (normalized.length && mention.start < normalized[normalized.length - 1].end)) continue;
            normalized.push({ start: mention.start, end: mention.end, name: mention.name,
                itemId: typeof mention.itemId === 'string' ? mention.itemId : null,
                rarity: typeof mention.rarity === 'string' && mention.rarity.trim() ? mention.rarity.trim() : null });
        }
        return normalized;
    }

    function rarityClass(rarity, definitions) {
        if (typeof rarity !== 'string' || !Array.isArray(definitions)) return '';
        const key = rarity.trim().toLowerCase();
        const entry = definitions.find(definition => String(definition?.key || definition?.label || '').trim().toLowerCase() === key);
        if (!entry) return '';
        return `rarity-${key.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown'}`;
    }

    function normalizeEntityMentions(text, refs, itemMentions = []) {
        const mentions = normalizeMentions(text, itemMentions).map(mention => ({ ...mention, type: 'thing' }));
        if (typeof text !== 'string' || !Array.isArray(refs)) return mentions;
        const named = refs.filter(ref => typeof ref?.name === 'string' && ref.name.trim())
            .sort((a, b) => b.name.length - a.name.length);
        for (const ref of named) {
            const isItem = ['thing', 'item', 'scenery'].includes(ref.type);
            if (isItem && itemMentions.some(mention => mention?.name === ref.name)) continue;
            const sameNameItems = named.filter(other => ['thing', 'item', 'scenery'].includes(other.type) && other.name === ref.name);
            const rarities = new Set(sameNameItems.map(other => typeof other.rarity === 'string' ? other.rarity.trim().toLowerCase() : ''));
            // A name-only reference cannot assign different qualities to two
            // same-name stacks. Exact persisted item ranges above take priority.
            const rarity = isItem && rarities.size === 1 ? ref.rarity : null;
            let start = text.indexOf(ref.name);
            while (start !== -1) {
                const end = start + ref.name.length;
                const touchesWord = (/^[\p{L}\p{N}_]/u.test(ref.name) && /[\p{L}\p{N}_]$/u.test(text.slice(0, start)))
                    || (/[\p{L}\p{N}_]$/u.test(ref.name) && /^[\p{L}\p{N}_]/u.test(text.slice(end)));
                if (!touchesWord && !mentions.some(mention => start < mention.end && end > mention.start)) {
                    mentions.push({ start, end, name: ref.name, type: isItem ? 'thing' : ref.type,
                        itemId: isItem && sameNameItems.length === 1 ? ref.id : null, rarity });
                }
                start = text.indexOf(ref.name, end);
            }
        }
        return mentions.sort((a, b) => a.start - b.start);
    }

    function newExitEntityRefs(metadata) {
        if (!metadata || typeof metadata !== 'object') return [];
        const refs = [
            ['location', 'originLocation'], ['region', 'originRegion'],
            ['location', 'destinationLocation'], ['region', 'destinationRegion']
        ].flatMap(([type, prefix]) => typeof metadata[`${prefix}Name`] === 'string' && metadata[`${prefix}Name`].trim()
            ? [{ type, id: metadata[`${prefix}Id`]
                || (prefix === 'destinationLocation' && metadata.destinationKind !== 'region' ? metadata.destinationId : null)
                || (prefix === 'destinationRegion' && metadata.destinationKind === 'region' ? metadata.destinationId : null)
                || null, name: metadata[`${prefix}Name`] }] : []);
        const destinationType = metadata.destinationKind === 'region' ? 'region' : 'location';
        if (typeof metadata.destinationName === 'string' && metadata.destinationName.trim()
            && !refs.some(ref => ref.type === destinationType && ref.name === metadata.destinationName)) {
            refs.push({ type: destinationType, id: metadata.destinationId || null, name: metadata.destinationName });
        }
        return refs;
    }

    function renderEntityRefs(target, refs, rarityDefinitions) {
        if (!Array.isArray(refs) || !refs.length) return;
        const document = target.ownerDocument;
        const walker = document.createTreeWalker(target, 4);
        const nodes = [];
        const protectedMentions = [];
        let text = '';
        let node;
        while ((node = walker.nextNode())) {
            const start = text.length;
            text += node.data;
            const protectedItem = node.parentElement?.closest('.item-summary-name, .summary-entity-name');
            if (protectedItem) protectedMentions.push({ start, end: text.length, name: node.data });
            nodes.push({ node, start, end: text.length, protectedItem });
        }
        const mentions = normalizeEntityMentions(text, refs, protectedMentions)
            .filter(mention => !protectedMentions.some(protectedMention => protectedMention.start === mention.start && protectedMention.end === mention.end));
        // Match visible text only: Markdown links and HTML attributes retain
        // their original destinations, and existing inline markup stays intact.
        for (const entry of nodes) {
            if (entry.protectedItem) continue;
            const overlapping = mentions.filter(mention => mention.start < entry.end && mention.end > entry.start);
            if (!overlapping.length) continue;
            const fragment = document.createDocumentFragment();
            let position = 0;
            for (const mention of overlapping) {
                const start = Math.max(0, mention.start - entry.start);
                const end = Math.min(entry.node.data.length, mention.end - entry.start);
                fragment.appendChild(document.createTextNode(entry.node.data.slice(position, start)));
                const span = document.createElement('span');
                span.className = [mention.type === 'thing' ? 'item-summary-name' : 'summary-entity-name',
                    rarityClass(mention.rarity, rarityDefinitions)].filter(Boolean).join(' ');
                span.textContent = entry.node.data.slice(start, end);
                if (mention.itemId) span.dataset.itemId = mention.itemId;
                if (mention.rarity) span.dataset.rarity = mention.rarity;
                fragment.appendChild(span);
                position = end;
            }
            fragment.appendChild(document.createTextNode(entry.node.data.slice(position)));
            entry.node.replaceWith(fragment);
        }
    }

    function composeRow(parts, entityRefs = []) {
            const composed = compose(parts);
            const refs = [...entityRefs];
            for (const part of parts) if (part && typeof part === 'object' && part.item) {
                const item = snapshot(part.item);
                const type = part.type || 'thing';
                if (!refs.some(ref => ref.type === type && ref.id === item.itemId && ref.name === item.name && ref.rarity === item.rarity)) refs.push({ type, id: item.itemId, name: item.name, rarity: item.rarity });
            }
            return { ...composed, description: composed.text, entityRefs: refs };
        }

    function composeEvent(eventType, entry, options = {}) {
        const safeSummaryName = options.safeName || (value => /^(?:the )?player$/i.test(String(value || '').trim()) ? 'You' : String(value || 'Someone').trim());
        const safeSummaryItem = options.safeText || ((value, fallback = 'an item') => String(value || fallback).trim());
        const summaryEntityRef = (type, { name }) => [{ type, id: null, name }];
            if (!entry || typeof entry !== 'object') return null;
            if (eventType === 'alter_item' && entry.itemBefore && entry.itemAfter) {
                const renamed = entry.itemBefore.name !== entry.itemAfter.name;
                const parts = renamed
                    ? [{ item: entry.itemBefore, quantity: entry.itemBefore.quantity ?? entry.quantity ?? 1 }, ' changed to ', { item: entry.itemAfter, quantity: entry.itemAfter.quantity ?? entry.quantity ?? 1 }]
                    : [{ item: entry.itemAfter, quantity: entry.itemAfter.quantity ?? entry.quantity ?? 1 }, ' was altered permanently'];
                const description = entry.changeDescription || entry.description;
                if (description) parts.push(` (${description})`);
                parts.push('.');
                return [{ icon: '🛠️', ...composeRow(parts), category: 'inventory', sourceType: eventType }];
            }
            if (!Array.isArray(entry.itemSnapshots) || !entry.itemSnapshots.length) return null;
            const supported = ['consume_item', 'drop_item', 'pick_up_item', 'harvest_gather', 'put_item_in_container', 'remove_item_from_container', 'item_appear', 'scenery_appear', 'transfer_item'];
            if (!supported.includes(eventType)) return null;
            return entry.itemSnapshots.map(snapshot => {
                const item = { item: snapshot, quantity: snapshot.quantity ?? 1, type: eventType === 'scenery_appear' ? 'scenery' : 'thing' };
                const actor = safeSummaryName(entry.harvester || entry.character || entry.actor || entry.name || entry.giver);
                let actorRefs = summaryEntityRef('npc', { name: actor });
                const containerActor = entry.character ? safeSummaryName(entry.character) : null;
                const container = entry.containerSnapshot ? { item: entry.containerSnapshot } : safeSummaryItem(entry.containerName || entry.container, 'a container');
                const source = entry.sourceSnapshot ? { item: entry.sourceSnapshot } : safeSummaryItem(entry.source, '');
                let parts;
                let icon = '📦';
                if (eventType === 'consume_item') { parts = [item, ' was consumed or destroyed.']; icon = '🧪'; }
                else if (eventType === 'drop_item') parts = [`${actor} dropped `, item, '.'];
                else if (eventType === 'pick_up_item') { parts = [`${actor} picked up `, item, '.']; icon = '🎒'; }
                else if (eventType === 'harvest_gather') { parts = [`${actor} harvested `, item, ...(source ? [' from ', source] : []), '.']; icon = '🌾'; }
                else if (eventType === 'put_item_in_container') { parts = containerActor ? [`${containerActor} put `, item, ' into ', container, '.'] : [item, ' was placed into ', container, '.']; actorRefs = containerActor ? summaryEntityRef('npc', { name: containerActor }) : []; icon = '📥'; }
                else if (eventType === 'remove_item_from_container') { parts = containerActor ? [`${containerActor} removed `, item, ' from ', container, '.'] : [item, ' was removed from ', container, '.']; actorRefs = containerActor ? summaryEntityRef('npc', { name: containerActor }) : []; icon = '📤'; }
                else if (eventType === 'transfer_item') { parts = [`${safeSummaryName(entry.giver)} gave `, item, ` to ${safeSummaryName(entry.receiver)}.`]; actorRefs = [...summaryEntityRef('npc', { name: safeSummaryName(entry.giver) }), ...summaryEntityRef('npc', { name: safeSummaryName(entry.receiver) })]; icon = '🔄'; }
                else { parts = [item, ' appeared in the scene.']; icon = '✨'; }
                return { icon, ...composeRow(parts, ['consume_item', 'item_appear', 'scenery_appear'].includes(eventType) ? [] : actorRefs), category: ['item_appear', 'scenery_appear'].includes(eventType) ? 'location_world' : 'inventory', sourceType: eventType };
            });
        }

    function sourceMentions(text, row) {
        const exact = normalizeMentions(text, row?.metadata?.itemMentions);
        const literalRefs = Array.isArray(row?.entityRefs)
            ? row.entityRefs.filter(ref => typeof ref?.name === 'string' && /[\\`*_[\]<>]/.test(ref.name)) : [];
        if (!literalRefs.length) return exact.map(mention => ({ ...mention, type: 'thing' }));
        // Protect authored names containing Markdown/HTML syntax before parsing,
        // while leaving link destinations, image attributes and HTML attributes
        // to the existing Markdown renderer. Ordinary names match visible DOM.
        const nonBody = [...text.matchAll(/\]\([^\n]*?\)|<[^>\n]*>|!\[[^\]\n]*\]|^ {0,3}\[[^\]\n]+\]:[^\n]*/gm)];
        return normalizeEntityMentions(text, literalRefs, exact).filter(mention =>
            exact.some(item => item.start === mention.start && item.end === mention.end)
            || !nonBody.some(match => mention.start >= match.index
                && mention.start < match.index + match[0].length
                && !(match[0].startsWith('<') && mention.start === match.index)));
    }

    function render(target, row, { renderText, rarityDefinitions = [] } = {}) {
        if (typeof renderText !== 'function') throw new Error('Item summary rendering requires the existing text/Markdown renderer.');
        const text = typeof row?.text === 'string' ? row.text : '';
        const mentions = sourceMentions(text, row);
        if (!mentions.length) { renderText(target, text); renderEntityRefs(target, row?.entityRefs, rarityDefinitions); return; }
        let prefix = '\uE000AIRPGITEM';
        while (text.includes(prefix)) prefix += 'Z';
        const suffix = '\uE001';
        let tokenized = '';
        let position = 0;
        mentions.forEach((mention, index) => {
            tokenized += text.slice(position, mention.start) + prefix + index + suffix;
            position = mention.end;
        });
        tokenized += text.slice(position);
        renderText(target, tokenized);
        const document = target.ownerDocument;
        const walker = document.createTreeWalker(target, 4);
        const nodes = [];
        let node;
        let fullText = '';
        while ((node = walker.nextNode())) {
            nodes.push({ node, start: fullText.length, end: fullText.length + node.data.length });
            fullText += node.data;
        }
        // Range replacement also handles Markdown renderers which split a
        // token across adjacent text nodes or inline elements.
        for (let index = mentions.length - 1; index >= 0; index--) {
            const token = prefix + index + suffix;
            const start = fullText.indexOf(token);
            if (start < 0) throw new Error('Item summary renderer did not preserve an explicit item-name token.');
            const end = start + token.length;
            const first = nodes.find(entry => start >= entry.start && start < entry.end);
            const last = nodes.find(entry => end > entry.start && end <= entry.end);
            const range = document.createRange();
            range.setStart(first.node, start - first.start);
            range.setEnd(last.node, end - last.start);
            const span = document.createElement('span');
            const className = rarityClass(mentions[index].rarity, rarityDefinitions);
            span.className = [mentions[index].type === 'thing' ? 'item-summary-name' : 'summary-entity-name', className].filter(Boolean).join(' ');
            span.textContent = mentions[index].name;
            if (mentions[index].itemId) span.dataset.itemId = mentions[index].itemId;
            if (mentions[index].rarity) span.dataset.rarity = mentions[index].rarity;
            range.deleteContents();
            range.insertNode(span);
        }
        renderEntityRefs(target, row?.entityRefs, rarityDefinitions);
    }

    return { snapshot, compose, composeRow, composeEvent, normalizeMentions, normalizeEntityMentions, newExitEntityRefs, rarityClass, render };
});
