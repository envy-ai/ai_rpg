const { DOMParser } = require('xmldom');
const Thing = require('./Thing.js');

class Events {
    static initialize(deps = {}) {
        this.deps = { ...deps };
        if (!this.deps.getEventPromptTemplates) {
            this.deps.getEventPromptTemplates = () => [];
        }
        this.DEFAULT_STATUS_DURATION = deps.defaultStatusDuration ?? 3;
        this.MAJOR_STATUS_DURATION = deps.majorStatusDuration ?? 5;

        this._entryParsers = {
            attack_damage: raw => this.splitSemicolonEntries(raw).map(entry => {
                const [attacker, target] = this.extractArrowParts(entry, 2);
                if (!attacker || !target) {
                    return null;
                }
                return { attacker, target };
            }).filter(Boolean),
            consume_item: raw => this.splitSemicolonEntries(raw).map(entry => {
                const [user, item] = this.extractArrowParts(entry, 2);
                if (!user || !item) {
                    return null;
                }
                return { user, item };
            }).filter(Boolean),
            death_incapacitation: raw => this.splitSemicolonEntries(raw),
            drop_item: raw => this.splitSemicolonEntries(raw).map(entry => {
                const [character, item] = this.extractArrowParts(entry, 2);
                if (!character || !item) {
                    return null;
                }
                return { character, item };
            }).filter(Boolean),
            heal_recover: raw => this.splitSemicolonEntries(raw).map(entry => {
                const [healer, recipient, effect] = this.extractArrowParts(entry, 3);
                if (!recipient) {
                    return null;
                }
                return { healer, recipient, effect };
            }).filter(Boolean),
            item_appear: raw => this.splitSemicolonEntries(raw),
            alter_item: raw => this.splitSemicolonEntries(raw).map(entry => {
                if (!entry) {
                    return null;
                }

                const segments = entry
                    .split(/->/)
                    .map(part => part.trim())
                    .filter(Boolean);

                if (!segments.length) {
                    return null;
                }

                const originalName = segments[0] || null;
                const newName = segments.length > 1 ? segments[1] : segments[0];
                const changeDescription = segments.length > 2 ? segments.slice(2).join(' -> ') : '';

                if (!originalName && !newName) {
                    return null;
                }

                return {
                    originalName: originalName ? originalName.trim() : null,
                    newName: newName ? newName.trim() : null,
                    changeDescription: changeDescription ? changeDescription.trim() : ''
                };
            }).filter(Boolean),
            move_location: raw => this.splitSemicolonEntries(raw),
            new_exit_discovered: raw => this.splitSemicolonEntries(raw).map(entry => {
                if (!entry) {
                    return null;
                }

                const trimmed = entry.trim();
                if (!trimmed) {
                    return null;
                }

                const [typeRaw, nameRaw, descriptionRaw] = this.extractArrowParts(trimmed, 3);
                if (typeRaw && nameRaw && descriptionRaw) {
                    const kind = typeRaw.trim().toLowerCase();
                    const name = nameRaw.trim();
                    const description = descriptionRaw.trim();

                    if (['location', 'region'].includes(kind) && name && description) {
                        return {
                            kind,
                            name,
                            description,
                            raw: trimmed
                        };
                    }
                }

                return {
                    kind: 'location',
                    name: trimmed,
                    description: trimmed,
                    raw: trimmed,
                    fallback: true
                };
            }).filter(Boolean),
            npc_arrival_departure: raw => this.splitSemicolonEntries(raw).map(entry => {
                if (!entry) {
                    return null;
                }

                const segments = entry
                    .split(/->/)
                    .map(part => part.trim())
                    .filter(part => part.length > 0);

                let name = null;
                let action = null;
                let destination = null;

                if (segments.length === 1) {
                    const match = segments[0].match(/^(?<name>.+?)\s+(?<action>arrived|left)$/i);
                    if (!match) {
                        return null;
                    }
                    name = match.groups.name.trim();
                    action = match.groups.action.trim().toLowerCase();
                } else {
                    const firstSegment = segments[0];
                    const match = firstSegment.match(/^(?<name>.+?)\s+(?<action>arrived|left)$/i);

                    if (match) {
                        name = match.groups.name.trim();
                        action = match.groups.action.trim().toLowerCase();
                        destination = segments.slice(1).join(' -> ').trim() || null;
                    } else {
                        name = firstSegment.trim();
                        if (!name || segments.length < 2) {
                            return null;
                        }

                        const actionCandidate = segments[1]?.trim().toLowerCase();
                        if (actionCandidate === 'arrived' || actionCandidate === 'left') {
                            action = actionCandidate;
                            const destinationSegments = segments.slice(2).join(' -> ').trim();
                            destination = destinationSegments || null;
                        } else {
                            const remainder = segments.slice(1).join(' -> ').trim();
                            if (!remainder) {
                                return null;
                            }
                            const remainderMatch = remainder.match(/^(arrived|left)(?:\s+(.*))?$/i);
                            if (!remainderMatch) {
                                return null;
                            }
                            action = remainderMatch[1].trim().toLowerCase();
                            destination = remainderMatch[2] ? remainderMatch[2].trim() : null;
                        }
                    }
                }

                if (!name || !action) {
                    return null;
                }

                return {
                    name,
                    action,
                    destination: destination || null
                };
            }).filter(Boolean),
            party_change: raw => this.splitSemicolonEntries(raw).map(entry => {
                if (!entry) {
                    return null;
                }

                let name = null;
                let action = null;

                const arrowParts = this.extractArrowParts(entry, 2);
                if (arrowParts.length === 2) {
                    [name, action] = arrowParts;
                } else {
                    const match = entry.match(/^(.*?)(?:\s+(joined|left))$/i);
                    if (match) {
                        name = match[1];
                        action = match[2];
                    }
                }

                if (!name || !action) {
                    return null;
                }

                return {
                    name: name.trim(),
                    action: action.trim().toLowerCase()
                };
            }).filter(Boolean),
            pick_up_item: raw => this.splitSemicolonEntries(raw).map(entry => {
                const [name, item] = this.extractArrowParts(entry, 2);
                if (!name || !item) {
                    return null;
                }
                return {
                    name: name.trim(),
                    item: item.trim()
                };
            }).filter(Boolean),
            status_effect_change: raw => this.splitSemicolonEntries(raw).map(entry => {
                const [entity, description, action] = this.extractArrowParts(entry, 3);
                if (!entity || !description || !action) {
                    return null;
                }
                return { entity, description, action: action.trim().toLowerCase() };
            }).filter(Boolean),
            transfer_item: raw => this.splitSemicolonEntries(raw).map(entry => {
                const [giver, item, receiver] = this.extractArrowParts(entry, 3);
                if (!item) {
                    return null;
                }
                return { giver, item, receiver };
            }).filter(Boolean),
            currency: raw => {
                if (this.isNoEventAnswer(raw)) {
                    return null;
                }
                const value = this.extractNumericValue(raw);
                return Number.isFinite(value) ? value : null;
            },
            experience_check: raw => this.splitSemicolonEntries(raw).map(entry => {
                if (!entry) {
                    return null;
                }
                const parts = entry.split(/->/);
                const scorePart = parts[0] ? parts[0].trim() : entry.trim();
                const reasonPart = parts.length > 1 ? parts.slice(1).join('->').trim() : '';
                const amount = this.extractNumericValue(scorePart);
                if (!Number.isFinite(amount)) {
                    return null;
                }
                return {
                    amount,
                    reason: reasonPart
                };
            }).filter(Boolean),
            environmental_status_damage: raw => this.splitSemicolonEntries(raw).map(entry => {
                if (!entry) {
                    return null;
                }

                const segments = entry
                    .split(/->/)
                    .map(part => part.trim())
                    .filter(Boolean);

                if (!segments.length) {
                    return null;
                }

                const name = segments[0];
                if (!name) {
                    return null;
                }

                let effectType = 'damage';
                let severityIndex = 1;
                if (segments.length >= 4) {
                    effectType = segments[1].toLowerCase();
                    severityIndex = 2;
                }

                let severity = segments[severityIndex] || '';
                if (!severity) {
                    severity = 'medium';
                }
                const normalizedSeverity = String(severity).trim().toLowerCase().split(/\s+/)[0] || 'medium';

                const reasonSegments = segments.slice(severityIndex + 1);
                const reason = reasonSegments.length ? reasonSegments.join(' -> ').trim() : '';

                const normalizedEffect = effectType && typeof effectType === 'string'
                    ? effectType.trim().toLowerCase()
                    : 'damage';

                return {
                    name,
                    effect: normalizedEffect,
                    severity: normalizedSeverity,
                    reason
                };
            }).filter(Boolean),
            defeated_enemy: raw => this.splitSemicolonEntries(raw),
            needbar_change: raw => this.splitSemicolonEntries(raw).map(entry => {
                const parts = this.extractArrowParts(entry, 4);
                if (parts.length < 4) {
                    return null;
                }

                const [characterRaw, barRaw, directionRaw, magnitudeRaw, ...rest] = parts;
                const character = characterRaw ? String(characterRaw).trim() : '';
                const needBar = barRaw ? String(barRaw).trim() : '';
                if (!character || !needBar) {
                    return null;
                }

                const directionCandidate = directionRaw ? String(directionRaw).trim().toLowerCase() : '';
                let direction = null;
                if (['increase', 'gain', 'raise', 'restore', 'boost', 'refill'].includes(directionCandidate)) {
                    direction = 'increase';
                } else if (['decrease', 'reduce', 'lower', 'drain', 'drop', 'deplete'].includes(directionCandidate)) {
                    direction = 'decrease';
                }
                if (!direction) {
                    direction = 'increase';
                }

                const magnitudeCandidate = magnitudeRaw ? String(magnitudeRaw).trim().toLowerCase() : '';
                let magnitude = null;
                if (['small', 'minor', 'light'].includes(magnitudeCandidate)) {
                    magnitude = 'small';
                } else if (['large', 'major', 'big', 'heavy'].includes(magnitudeCandidate)) {
                    magnitude = 'large';
                } else if (['all', 'fill', 'full', 'max', 'maximum'].includes(magnitudeCandidate)) {
                    magnitude = 'all';
                } else {
                    magnitude = magnitudeCandidate || 'small';
                }

                const reason = rest.length ? rest.join(' -> ').trim() : null;

                return {
                    character,
                    needBar,
                    direction,
                    magnitude,
                    reason: reason && reason.toLowerCase() !== 'n/a' ? reason : null
                };
            }).filter(Boolean)
        };

        this._handlers = {
            attack_damage: (entries, context) => this.handleAttackDamageEvents(entries, context),
            consume_item: (entries, context) => this.handleConsumeItemEvents(entries, context),
            death_incapacitation: (entries, context) => this.handleDeathEvents(entries, context),
            drop_item: (entries, context) => this.handleDropItemEvents(entries, context),
            heal_recover: (entries, context) => this.handleHealEvents(entries, context),
            item_appear: (entries, context) => this.handleItemAppearEvents(entries, context),
            alter_item: (entries, context) => this.handleAlterItemEvents(entries, context),
            move_location: (entries, context) => this.handleMoveLocationEvents(entries, context),
            new_exit_discovered: (entries, context) => this.handleNewExitEvents(entries, context),
            npc_arrival_departure: (entries, context) => this.handleNpcArrivalDepartureEvents(entries, context),
            party_change: (entries, context) => this.handlePartyChangeEvents(entries, context),
            pick_up_item: (entries, context) => this.handlePickUpItemEvents(entries, context),
            status_effect_change: (entries, context) => this.handleStatusEffectChangeEvents(entries, context),
            transfer_item: (entries, context) => this.handleTransferItemEvents(entries, context),
            currency: (entries, context) => this.handleCurrencyEvents(entries, context),
            experience_check: (entries, context) => this.handleExperienceCheckEvents(entries, context),
            environmental_status_damage: (entries, context) => this.handleEnvironmentalStatusDamageEvents(entries, context),
            defeated_enemy: (entries, context) => this.handleDefeatedEnemyEvents(entries, context),
            needbar_change: (entries, context) => this.handleNeedBarChangeEvents(entries, context)
        };
    }

    static get config() {
        const { getConfig, config } = this.deps;
        return typeof getConfig === 'function' ? getConfig() : config;
    }

    static get currentPlayer() {
        const { getCurrentPlayer, currentPlayer } = this.deps;
        return typeof getCurrentPlayer === 'function' ? getCurrentPlayer() : currentPlayer;
    }

    static get players() {
        return this.deps.players;
    }

    static get things() {
        return this.deps.things;
    }

    static get regions() {
        return this.deps.regions;
    }

    static get gameLocations() {
        return this.deps.gameLocations;
    }

    static cleanEventResponseText(text) {
        if (!text || typeof text !== 'string') {
            return '';
        }
        return text.replace(/\*/g, '').trim();
    }

    static isNoEventAnswer(raw) {
        if (!raw || typeof raw !== 'string') {
            return true;
        }
        const normalized = raw.trim().toLowerCase();
        if (!normalized) {
            return true;
        }
        return normalized === 'n/a' || normalized === 'na' || normalized === 'none' || normalized === 'nothing';
    }

    static splitSemicolonEntries(raw) {
        if (!raw || this.isNoEventAnswer(raw)) {
            return [];
        }
        return raw
            .split(/;/)
            .map(entry => entry.trim())
            .filter(entry => entry.length > 0 && !this.isNoEventAnswer(entry));
    }

    static sanitizeMetadataObject(meta) {
        if (!meta || typeof meta !== 'object') {
            return {};
        }
        const cleaned = { ...meta };
        for (const key of Object.keys(cleaned)) {
            const value = cleaned[key];
            if (
                value === undefined ||
                value === null ||
                (typeof value === 'string' && !value.trim())
            ) {
                delete cleaned[key];
            }
        }
        return cleaned;
    }

    static roundAwayFromZero(value) {
        if (!Number.isFinite(value) || value === 0) {
            return 0;
        }
        return value > 0 ? Math.ceil(value) : Math.floor(value);
    }

    static clampLevel(value, fallback = 1) {
        const base = Number.isFinite(value) ? value : (Number.isFinite(fallback) ? fallback : 1);
        return Math.max(1, Math.min(20, Math.round(base)));
    }

    static normalizeThingType(raw, fallback = 'item') {
        const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
        if (normalized === 'scenery') {
            return 'scenery';
        }
        if (normalized === 'item') {
            return 'item';
        }
        return fallback || 'item';
    }

    static scaleAttributeBonusesForItem(rawBonuses, { level = 1, rarity = null } = {}) {
        if (!Array.isArray(rawBonuses) || !rawBonuses.length) {
            return [];
        }

        const normalized = [];
        for (const entry of rawBonuses) {
            if (!entry) {
                continue;
            }

            let attribute = null;
            let bonusValue = null;

            if (typeof entry === 'string') {
                attribute = entry.trim();
            } else if (typeof entry === 'object') {
                if (typeof entry.attribute === 'string') {
                    attribute = entry.attribute.trim();
                } else if (typeof entry.name === 'string') {
                    attribute = entry.name.trim();
                }

                const bonusRaw = entry.bonus ?? entry.value;
                const parsed = Number(bonusRaw);
                if (Number.isFinite(parsed)) {
                    bonusValue = parsed;
                }
            }

            if (!attribute) {
                continue;
            }

            if (!Number.isFinite(bonusValue)) {
                const fallbackBonus = Number(entry?.bonus ?? entry?.value);
                if (Number.isFinite(fallbackBonus)) {
                    bonusValue = fallbackBonus;
                } else {
                    bonusValue = 0;
                }
            }

            normalized.push({
                attribute,
                bonus: bonusValue
            });
        }

        if (!normalized.length) {
            return [];
        }

        const effectiveLevel = Number.isFinite(level) && level > 0 ? level : 1;
        const rarityMultiplier = Thing.getRarityAttributeMultiplier(rarity);
        const effectiveMultiplier = Number.isFinite(rarityMultiplier) && rarityMultiplier > 0 ? rarityMultiplier : 1;
        const factor = 0.5 * effectiveLevel * effectiveMultiplier;

        return normalized.map(({ attribute, bonus }) => {
            const scaled = bonus * factor;
            const rounded = this.roundAwayFromZero(scaled);
            const clamped = Math.max(-20, Math.min(20, rounded));
            return { attribute, bonus: clamped };
        });
    }

    static buildThingPromptSnapshot(thing, { fallbackName = 'Unknown Item' } = {}) {
        if (!thing) {
            return {
                name: fallbackName,
                description: 'No description available.',
                itemOrScenery: 'item',
                type: 'item',
                slot: [],
                rarity: Thing.getDefaultRarityLabel(),
                value: '',
                weight: '',
                relativeLevel: 0,
                attributeBonuses: [],
                causeStatusEffect: null,
                properties: ''
            };
        }

        const metadata = thing.metadata || {};
        const slotSource = typeof thing.slot === 'string' && thing.slot
            ? thing.slot
            : (typeof metadata.slot === 'string' ? metadata.slot : null);
        const slotList = slotSource
            ? slotSource.split(/[,/]/).map(part => part.trim()).filter(Boolean)
            : [];

        const bonusesSource = Array.isArray(thing.attributeBonuses) && thing.attributeBonuses.length
            ? thing.attributeBonuses
            : (Array.isArray(metadata.attributeBonuses) ? metadata.attributeBonuses : []);
        const attributeBonuses = bonusesSource.map(entry => ({
            attribute: typeof entry.attribute === 'string' ? entry.attribute : '',
            bonus: Number.isFinite(entry.bonus) ? entry.bonus : Number(entry.value) || 0
        })).filter(bonus => bonus.attribute);

        const rawEffect = thing.causeStatusEffect || metadata.causeStatusEffect || null;
        const causeStatusEffect = rawEffect && typeof rawEffect === 'object'
            ? {
                name: typeof rawEffect.name === 'string' ? rawEffect.name : '',
                description: typeof rawEffect.description === 'string' ? rawEffect.description : '',
                duration: rawEffect.duration ?? ''
            }
            : null;

        return {
            name: thing.name || fallbackName,
            description: thing.description || 'No description available.',
            itemOrScenery: thing.isScenery() ? 'scenery' : 'item',
            type: thing.itemTypeDetail
                || metadata.itemTypeDetail
                || metadata.itemType
                || (thing.isScenery() ? 'scenery' : 'item'),
            slot: slotList,
            rarity: thing.rarity || metadata.rarity || Thing.getDefaultRarityLabel(),
            value: metadata.value ?? '',
            weight: metadata.weight ?? '',
            relativeLevel: metadata.relativeLevel ?? thing.relativeLevel ?? 0,
            attributeBonuses,
            causeStatusEffect,
            properties: metadata.properties || ''
        };
    }

    static parseThingAlterXml(xmlContent) {
        if (!xmlContent || typeof xmlContent !== 'string') {
            return null;
        }

        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(xmlContent, 'text/xml');

            const parserError = doc.getElementsByTagName('parsererror')[0];
            if (parserError) {
                throw new Error(parserError.textContent);
            }

            const itemNodes = Array.from(doc.getElementsByTagName('item'));
            if (!itemNodes.length) {
                return null;
            }

            const itemNode = itemNodes[itemNodes.length - 1];
            const getText = (tag) => itemNode.getElementsByTagName(tag)[0]?.textContent?.trim() || '';

            const attributeBonusesNode = itemNode.getElementsByTagName('attributeBonuses')[0];
            const attributeBonuses = attributeBonusesNode
                ? Array.from(attributeBonusesNode.getElementsByTagName('attributeBonus'))
                    .map(bonusNode => {
                        const attribute = bonusNode.getElementsByTagName('attribute')[0]?.textContent?.trim();
                        const bonusRaw = bonusNode.getElementsByTagName('bonus')[0]?.textContent?.trim();
                        if (!attribute) {
                            return null;
                        }
                        const bonus = Number(bonusRaw);
                        return {
                            attribute,
                            bonus: Number.isFinite(bonus) ? bonus : 0
                        };
                    })
                    .filter(Boolean)
                : [];

            const statusEffectNode = itemNode.getElementsByTagName('causeStatusEffect')[0];
            let causeStatusEffect = null;
            if (statusEffectNode) {
                const effectName = statusEffectNode.getElementsByTagName('name')[0]?.textContent?.trim();
                const effectDescription = statusEffectNode.getElementsByTagName('description')[0]?.textContent?.trim();
                const effectDuration = statusEffectNode.getElementsByTagName('duration')[0]?.textContent?.trim();
                const payload = {};
                if (effectName) payload.name = effectName;
                if (effectDescription) payload.description = effectDescription;
                if (effectDuration && effectDuration.toLowerCase() !== 'n/a') {
                    payload.duration = effectDuration;
                }
                if (Object.keys(payload).length) {
                    causeStatusEffect = payload;
                }
            }

            const relativeLevelRaw = getText('relativeLevel');
            const relativeLevel = Number(relativeLevelRaw);

            const slotRaw = getText('slot');
            const normalizedSlot = slotRaw && slotRaw.toLowerCase() !== 'n/a' ? slotRaw : '';

            return {
                name: getText('name') || null,
                description: getText('description') || '',
                itemOrScenery: getText('itemOrScenery') || '',
                type: getText('type') || '',
                slot: normalizedSlot,
                rarity: getText('rarity') || '',
                value: getText('value') || '',
                weight: getText('weight') || '',
                relativeLevel: Number.isFinite(relativeLevel) ? relativeLevel : null,
                attributeBonuses,
                causeStatusEffect,
                properties: getText('properties') || ''
            };
        } catch (error) {
            console.warn('Failed to parse altered item XML:', error.message);
            return null;
        }
    }

    static resolveBaseLevelReference({ context = {}, owner = null, location = null, existingThing = null } = {}) {
        if (owner && Number.isFinite(owner.level)) {
            return owner.level;
        }

        if (location && Number.isFinite(location.baseLevel)) {
            return location.baseLevel;
        }

        if (location && location.stubMetadata) {
            const { stubMetadata } = location;
            if (Number.isFinite(stubMetadata?.computedBaseLevel)) {
                return stubMetadata.computedBaseLevel;
            }
            if (Number.isFinite(stubMetadata?.regionAverageLevel)) {
                return stubMetadata.regionAverageLevel;
            }
        }

        const region = context.region || null;
        if (region && Number.isFinite(region.averageLevel)) {
            return region.averageLevel;
        }

        if (existingThing) {
            const metadata = existingThing.metadata || {};
            if (Number.isFinite(metadata.level)) {
                return metadata.level;
            }
            if (Number.isFinite(existingThing.level)) {
                return existingThing.level;
            }
        }

        const playerCandidate = context.player || this.currentPlayer;
        if (playerCandidate && Number.isFinite(playerCandidate.level)) {
            return playerCandidate.level;
        }

        return 1;
    }

    static resolveLocationCandidate(candidate) {
        if (!candidate) {
            return null;
        }

        if (typeof candidate === 'string') {
            const { Location } = this.deps;
            if (Location && typeof Location.get === 'function') {
                try {
                    return Location.get(candidate) || null;
                } catch (_) {
                    return null;
                }
            }
            return null;
        }

        if (typeof candidate === 'object' && typeof candidate.id === 'string') {
            return candidate;
        }

        return null;
    }

    static addThingToLocation(thing, candidate) {
        if (!thing) {
            return;
        }

        const location = this.resolveLocationCandidate(candidate);
        if (!location || typeof location.addThingId !== 'function') {
            return;
        }

        location.addThingId(thing.id);
    }

    static removeThingFromLocation(thing, candidate) {
        if (!thing) {
            return;
        }

        const location = this.resolveLocationCandidate(candidate);
        if (!location || typeof location.removeThingId !== 'function') {
            return;
        }

        location.removeThingId(thing.id);
    }

    static detachThingFromKnownLocation(thing) {
        if (!thing) {
            return;
        }

        const metadata = thing.metadata || {};
        if (metadata.locationId) {
            this.removeThingFromLocation(thing, metadata.locationId);
        }
    }

    static extractArrowParts(entry, expectedParts) {
        if (!entry || typeof entry !== 'string') {
            return [];
        }
        const parts = entry
            .split(/->/)
            .map(part => part.trim())
            .filter(part => part.length > 0);

        if (parts.length < expectedParts) {
            return [];
        }

        if (expectedParts === 2) {
            return [parts[0], parts.slice(1).join(' -> ')];
        }

        if (expectedParts === 3) {
            return [parts[0], parts[1], parts.slice(2).join(' -> ')];
        }

        return parts;
    }

    static extractNumericValue(text) {
        if (!text || typeof text !== 'string') {
            return null;
        }
        const match = text.match(/(-?\d+)/);
        return match ? parseInt(match[1], 10) : null;
    }

    static parseEventCheckResponse(eventTemplates, responseText) {
        if (!eventTemplates || !eventTemplates.length) {
            return null;
        }

        const cleaned = this.cleanEventResponseText(responseText);
        const lines = cleaned.split(/\n/).map(line => line.trim()).filter(line => line.length > 0);

        const numberedEntries = new Map();
        let currentIndex = null;
        let buffer = [];

        const flush = () => {
            if (currentIndex === null) {
                return;
            }
            const combined = buffer.join(' ').trim();
            numberedEntries.set(currentIndex, combined);
            currentIndex = null;
            buffer = [];
        };

        for (const line of lines) {
            const match = line.match(/^(\d+)\.\s*(.*)$/);
            if (match) {
                flush();
                currentIndex = parseInt(match[1], 10);
                buffer.push(match[2]);
            } else if (currentIndex !== null) {
                buffer.push(line);
            }
        }
        flush();

        const rawEntries = {};
        const parsedEntries = {};
        const path = this.deps.path;

        eventTemplates.forEach((templatePath, idx) => {
            const index = idx + 1;
            const key = path.posix.basename(templatePath, '.njk');
            const raw = numberedEntries.has(index) ? numberedEntries.get(index) : '';
            rawEntries[key] = raw;
            const parser = this._entryParsers[key];
            parsedEntries[key] = parser ? parser(raw) : raw;
        });

        return { rawEntries, parsed: parsedEntries };
    }

    static guessStatusDuration(description) {
        const value = this.extractNumericValue(description);
        if (Number.isFinite(value)) {
            return Math.max(1, Math.abs(value));
        }
        return this.DEFAULT_STATUS_DURATION;
    }

    static async handleAttackDamageEvents(entries = [], context = {}) {
        if (!Array.isArray(entries) || !entries.length) {
            return;
        }
        const { findActorByName } = this.deps;
        for (const { attacker, target } of entries) {
            if (!target) continue;
            const victim = findActorByName(target);
            if (!victim) {
                continue;
            }
            const description = attacker ? `Wounded by ${attacker}` : 'Wounded';
            if (typeof victim.addStatusEffect === 'function') {
                victim.addStatusEffect({ description, duration: this.MAJOR_STATUS_DURATION });
            }
            if (typeof victim.modifyHealth === 'function') {
                victim.modifyHealth(-5, attacker ? `Attacked by ${attacker}` : 'Attacked');
            }
        }
    }

    static handleConsumeItemEvents(entries = []) {
        if (!Array.isArray(entries) || !entries.length) {
            return;
        }
        const { findThingByName, findActorByName } = this.deps;
        for (const { user, item } of entries) {
            if (!item) continue;
            const thing = findThingByName(item);
            if (!thing) {
                continue;
            }

            const actor = findActorByName(user);
            if (actor && typeof actor.removeInventoryItem === 'function') {
                actor.removeInventoryItem(thing);
            }

            const metadata = thing.metadata || {};
            if (metadata.locationId) {
                this.removeThingFromLocation(thing, metadata.locationId);
            }
            delete metadata.ownerId;
            delete metadata.locationId;
            metadata.consumedAt = new Date().toISOString();
            thing.metadata = metadata;

            if (typeof thing.delete === 'function') {
                thing.delete();
            }
            this.things.delete(thing.id);
        }
    }

    static handleDeathEvents(entries = []) {
        if (!Array.isArray(entries) || !entries.length) {
            return;
        }
        const { findActorByName } = this.deps;
        for (const entityName of entries) {
            const actor = findActorByName(entityName);
            if (!actor) {
                continue;
            }
            if (typeof actor.modifyHealth === 'function') {
                const status = actor.getStatus ? actor.getStatus() : null;
                const currentHealth = status?.health ?? null;
                if (Number.isFinite(currentHealth)) {
                    actor.modifyHealth(-currentHealth, 'Incapacitated');
                } else {
                    actor.modifyHealth(-(actor.health || 0), 'Incapacitated');
                }
            }
            if (typeof actor.addStatusEffect === 'function') {
                actor.addStatusEffect({ description: 'Incapacitated', duration: null });
            }
        }
    }

    static handleDropItemEvents(entries = [], context = {}) {
        if (!Array.isArray(entries) || !entries.length) {
            return;
        }
        const location = context.location;
        if (!location) {
            return;
        }
        const { findThingByName, findActorByName } = this.deps;
        for (const { character, item } of entries) {
            if (!item) continue;
            const thing = findThingByName(item);
            if (!thing) {
                continue;
            }
            const actor = findActorByName(character);
            if (actor && typeof actor.removeInventoryItem === 'function') {
                actor.removeInventoryItem(thing);
            }
            const metadata = thing.metadata || {};
            this.detachThingFromKnownLocation(thing);
            metadata.locationId = location.id;
            delete metadata.ownerId;
            thing.metadata = metadata;
            this.addThingToLocation(thing, location);
        }
    }

    static handleHealEvents(entries = [], context = {}) {
        if (!Array.isArray(entries) || !entries.length) {
            return;
        }
        const { findActorByName } = this.deps;
        for (const { healer, recipient, effect } of entries) {
            if (!recipient) continue;
            const target = findActorByName(recipient);
            if (!target) {
                continue;
            }
            const amount = this.extractNumericValue(effect);
            if (typeof target.modifyHealth === 'function') {
                const healAmount = amount ? Math.abs(amount) : 5;
                target.modifyHealth(healAmount, healer ? `Healed by ${healer}` : 'Healed');
            }
            if (typeof target.addStatusEffect === 'function' && effect) {
                target.addStatusEffect({ description: `Bolstered: ${effect}`, duration: this.DEFAULT_STATUS_DURATION });
            }
        }
    }

    static async handleAlterItemEvents(entries = [], context = {}) {
        if (!Array.isArray(entries) || !entries.length) {
            return;
        }

        const {
            findThingByName,
            buildBasePromptContext,
            promptEnv,
            parseXMLTemplate,
            axios,
            Location,
            fs,
            path,
            players,
            things,
            baseDir
        } = this.deps;

        if (typeof buildBasePromptContext !== 'function' || !promptEnv || typeof parseXMLTemplate !== 'function' || !axios) {
            console.warn('Alter item handler missing prompt dependencies.');
            return;
        }

        const config = this.config;
        if (!config?.ai?.endpoint || !config?.ai?.apiKey || !config?.ai?.model) {
            console.warn('AI configuration incomplete; cannot process alter_item events.');
            return;
        }

        let location = context.location || null;
        if (!location && context.player?.currentLocation && Location && typeof Location.get === 'function') {
            try {
                location = Location.get(context.player.currentLocation);
            } catch (_) {
                location = null;
            }
        }

        const baseContext = buildBasePromptContext({ locationOverride: location });

        const endpoint = config.ai.endpoint;
        const chatEndpoint = endpoint.endsWith('/')
            ? `${endpoint}chat/completions`
            : `${endpoint}/chat/completions`;
        const defaultTemperature = typeof config.ai.temperature === 'number' ? config.ai.temperature : 0.5;

        const alteredSummaries = [];

        for (const entry of entries) {
            if (!entry) {
                continue;
            }

            let targetThing = null;
            if (entry.originalName) {
                targetThing = findThingByName(entry.originalName);
            }
            if (!targetThing && entry.newName) {
                targetThing = findThingByName(entry.newName);
            }

            const fallbackName = entry.originalName || entry.newName || 'Unknown Item';
            const promptThing = this.buildThingPromptSnapshot(targetThing, { fallbackName });
            const seedName = entry.newName && entry.newName.trim()
                ? entry.newName.trim()
                : (promptThing.name || fallbackName);

            const promptPayload = {
                ...baseContext,
                promptType: 'thing-alter',
                changeDescription: entry.changeDescription || '',
                thingSeed: { name: seedName },
                alteredItem: promptThing,
                item: promptThing
            };

            let renderedTemplate;
            try {
                renderedTemplate = promptEnv.render('base-context.xml.njk', promptPayload);
            } catch (renderError) {
                console.warn(`Failed to render thing alteration prompt for ${seedName}:`, renderError.message);
                continue;
            }

            let parsedTemplate;
            try {
                parsedTemplate = parseXMLTemplate(renderedTemplate);
            } catch (templateError) {
                console.warn(`Failed to parse thing alteration template for ${seedName}:`, templateError.message);
                continue;
            }

            if (!parsedTemplate.systemPrompt || !parsedTemplate.generationPrompt) {
                console.warn(`Alteration template missing prompts for ${seedName}.`);
                continue;
            }

            const messages = [
                { role: 'system', content: parsedTemplate.systemPrompt },
                { role: 'user', content: parsedTemplate.generationPrompt }
            ];

            const requestData = {
                model: config.ai.model,
                messages,
                max_tokens: parsedTemplate.maxTokens || 600,
                temperature: typeof parsedTemplate.temperature === 'number'
                    ? parsedTemplate.temperature
                    : defaultTemperature
            };

            let response;
            const requestStart = Date.now();
            try {
                response = await axios.post(chatEndpoint, requestData, {
                    headers: {
                        'Authorization': `Bearer ${config.ai.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: config.baseTimeoutSeconds
                });
            } catch (requestError) {
                console.warn(`Alter item request failed for ${seedName}:`, requestError.message);
                continue;
            }

            const apiDurationSeconds = (Date.now() - requestStart) / 1000;
            const aiContent = response?.data?.choices?.[0]?.message?.content || '';
            if (!aiContent.trim()) {
                console.warn(`Alter item response empty for ${seedName}.`);
                continue;
            }

            const parsedItem = this.parseThingAlterXml(aiContent);
            if (!parsedItem || !parsedItem.name) {
                console.warn(`Failed to parse alteration response for ${seedName}.`);
                continue;
            }

            const summary = await this.applyAlterationResult({
                entry,
                context,
                initialLocation: location,
                targetThing,
                parsedItem,
                players,
                things
            });

            if (summary) {
                alteredSummaries.push(summary);
            }

            if (fs && path) {
                try {
                    const logsDir = path.join(baseDir || process.cwd(), 'logs');
                    if (!fs.existsSync(logsDir)) {
                        fs.mkdirSync(logsDir, { recursive: true });
                    }
                    const safeNameSource = seedName || 'item';
                    const safeName = safeNameSource.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'item';
                    const logPath = path.join(logsDir, `alter_item_${Date.now()}_${safeName}.log`);
                    const logLines = [
                        `=== API CALL DURATION: ${apiDurationSeconds.toFixed(3)}s ===`,
                        '=== ALTER ITEM SYSTEM PROMPT ===',
                        parsedTemplate.systemPrompt,
                        '',
                        '=== ALTER ITEM GENERATION PROMPT ===',
                        parsedTemplate.generationPrompt,
                        '',
                        '=== ALTER ITEM RESPONSE ===',
                        aiContent,
                        ''
                    ];
                    fs.writeFileSync(logPath, logLines.join('\n'), 'utf8');
                } catch (logError) {
                    console.warn('Failed to log item alteration prompt:', logError.message);
                }
            }
        }

        if (alteredSummaries.length) {
            if (!Array.isArray(context.alteredItems)) {
                context.alteredItems = [];
            }
            context.alteredItems.push(...alteredSummaries);
        }
    }

    static async applyAlterationResult({
        entry,
        context,
        initialLocation,
        targetThing,
        parsedItem,
        players,
        things
    }) {
        const normalizedType = this.normalizeThingType(
            parsedItem.itemOrScenery,
            targetThing ? targetThing.thingType : 'item'
        );

        const newName = parsedItem.name.trim();
        const description = parsedItem.description || (targetThing ? targetThing.description : `An item named ${newName}.`);
        const rarity = parsedItem.rarity || (targetThing ? targetThing.rarity : Thing.getDefaultRarityLabel());

        const metadataBefore = targetThing ? targetThing.metadata || {} : {};
        const previousOwnerId = metadataBefore.ownerId || null;
        const previousLocationId = metadataBefore.locationId || null;
        const owner = previousOwnerId && players instanceof Map ? players.get(previousOwnerId) : null;

        let resolvedLocation = initialLocation || null;
        if (!resolvedLocation && previousLocationId) {
            resolvedLocation = this.resolveLocationCandidate(previousLocationId);
        }
        if (!resolvedLocation && owner?.currentLocation) {
            resolvedLocation = this.resolveLocationCandidate(owner.currentLocation);
        }
        if (!resolvedLocation && context.player?.currentLocation) {
            resolvedLocation = this.resolveLocationCandidate(context.player.currentLocation);
        }

        const relativeLevel = Number.isFinite(parsedItem.relativeLevel)
            ? parsedItem.relativeLevel
            : (metadataBefore.relativeLevel ?? targetThing?.relativeLevel ?? 0);

        const baseLevelReference = this.resolveBaseLevelReference({
            context,
            owner,
            location: resolvedLocation,
            existingThing: targetThing
        });

        const computedLevel = this.clampLevel(
            (Number.isFinite(baseLevelReference) ? baseLevelReference : 1)
                + (Number.isFinite(relativeLevel) ? relativeLevel : 0),
            baseLevelReference
        );

        const scaledBonuses = normalizedType === 'item'
            ? this.scaleAttributeBonusesForItem(parsedItem.attributeBonuses, {
                level: computedLevel,
                rarity: parsedItem.rarity
            })
            : [];

        const updatedMetadata = { ...metadataBefore };
        if (rarity) {
            updatedMetadata.rarity = rarity;
        } else {
            delete updatedMetadata.rarity;
        }
        if (parsedItem.type) {
            updatedMetadata.itemType = parsedItem.type;
            updatedMetadata.itemTypeDetail = parsedItem.type;
        }

        if (parsedItem.value) {
            updatedMetadata.value = parsedItem.value;
        } else {
            delete updatedMetadata.value;
        }

        if (parsedItem.weight) {
            updatedMetadata.weight = parsedItem.weight;
        } else {
            delete updatedMetadata.weight;
        }

        if (parsedItem.properties) {
            updatedMetadata.properties = parsedItem.properties;
        } else {
            delete updatedMetadata.properties;
        }

        if (normalizedType === 'item' && scaledBonuses.length) {
            updatedMetadata.attributeBonuses = scaledBonuses;
        } else {
            delete updatedMetadata.attributeBonuses;
        }

        if (normalizedType === 'item' && parsedItem.causeStatusEffect) {
            updatedMetadata.causeStatusEffect = parsedItem.causeStatusEffect;
        } else {
            delete updatedMetadata.causeStatusEffect;
        }

        if (Number.isFinite(relativeLevel)) {
            updatedMetadata.relativeLevel = relativeLevel;
        } else {
            delete updatedMetadata.relativeLevel;
        }
        updatedMetadata.level = computedLevel;

        if (normalizedType === 'scenery') {
            updatedMetadata.isScenery = true;
        } else {
            delete updatedMetadata.isScenery;
        }

        if (normalizedType === 'scenery') {
            if (owner && typeof owner.removeInventoryItem === 'function' && targetThing) {
                try {
                    owner.removeInventoryItem(targetThing);
                } catch (error) {
                    console.warn(`Failed to remove ${targetThing.name || 'item'} from ${owner.name || owner.id}:`, error.message);
                }
            }
            delete updatedMetadata.ownerId;

            if (resolvedLocation) {
                updatedMetadata.locationId = resolvedLocation.id || updatedMetadata.locationId;
                updatedMetadata.locationName = resolvedLocation.name || updatedMetadata.locationName;
            }
        } else if (previousOwnerId) {
            updatedMetadata.ownerId = previousOwnerId;
            delete updatedMetadata.locationId;
            delete updatedMetadata.locationName;
        } else if (resolvedLocation) {
            updatedMetadata.locationId = resolvedLocation.id || updatedMetadata.locationId;
            updatedMetadata.locationName = resolvedLocation.name || updatedMetadata.locationName;
        }

        const sanitizedMetadata = this.sanitizeMetadataObject(updatedMetadata);

        if (targetThing) {
            const priorLocationId = metadataBefore.locationId || null;

            targetThing.thingType = normalizedType;
            targetThing.name = newName;
            targetThing.description = description;
            targetThing.itemTypeDetail = parsedItem.type || null;
            targetThing.rarity = rarity;
            targetThing.slot = parsedItem.slot || null;
            targetThing.attributeBonuses = normalizedType === 'item' ? scaledBonuses : [];
            targetThing.causeStatusEffect = normalizedType === 'item' ? parsedItem.causeStatusEffect : null;
            targetThing.level = computedLevel;
            if (Number.isFinite(relativeLevel)) {
                targetThing.relativeLevel = relativeLevel;
            } else if (targetThing.relativeLevel !== null) {
                targetThing.relativeLevel = null;
            }
            targetThing.metadata = sanitizedMetadata;

            if (priorLocationId && (!sanitizedMetadata.locationId || sanitizedMetadata.locationId !== priorLocationId)) {
                this.removeThingFromLocation(targetThing, priorLocationId);
            }
            if (sanitizedMetadata.locationId) {
                this.addThingToLocation(targetThing, sanitizedMetadata.locationId);
            }

            if (targetThing.imageId) {
                targetThing.imageId = null;
            }

            return {
                id: targetThing.id,
                name: targetThing.name,
                thingType: targetThing.thingType,
                originalName: entry.originalName || null,
                newName: targetThing.name
            };
        }

        const creationMetadata = sanitizedMetadata;
        const newThing = new Thing({
            name: newName,
            description,
            thingType: normalizedType,
            rarity,
            itemTypeDetail: parsedItem.type || null,
            slot: parsedItem.slot || null,
            attributeBonuses: normalizedType === 'item' ? scaledBonuses : [],
            causeStatusEffect: normalizedType === 'item' ? parsedItem.causeStatusEffect : null,
            level: computedLevel,
            relativeLevel: Number.isFinite(relativeLevel) ? relativeLevel : null,
            metadata: creationMetadata
        });

        if (things instanceof Map) {
            things.set(newThing.id, newThing);
        }

        if (creationMetadata.locationId) {
            this.addThingToLocation(newThing, creationMetadata.locationId);
        }

        newThing.imageId = null;

        return {
            id: newThing.id,
            name: newThing.name,
            thingType: newThing.thingType,
            originalName: entry.originalName || null,
            newName: newThing.name
        };
    }

    static async handleItemAppearEvents(entries = [], context = {}) {
        if (!Array.isArray(entries) || !entries.length) {
            return;
        }

        const { Location, generateItemsByNames, findThingByName } = this.deps;

        let location = context.location || null;
        if (!location && context.player?.currentLocation) {
            try {
                location = Location.get(context.player.currentLocation);
            } catch (_) {
                location = null;
            }
        }

        const itemNames = entries
            .map(entry => (typeof entry === 'string' ? entry : entry?.item || entry))
            .filter(name => typeof name === 'string' && name.trim());

        if (!itemNames.length) {
            return;
        }

        const missing = itemNames.filter(name => !findThingByName(name));
        if (missing.length) {
            await generateItemsByNames({ itemNames: missing, location });
        }

        for (const itemName of itemNames) {
            const thing = findThingByName(itemName);
            if (!thing) {
                continue;
            }
            if (location) {
                this.detachThingFromKnownLocation(thing);
                const metadata = thing.metadata || {};
                metadata.locationId = location.id;
                delete metadata.ownerId;
                thing.metadata = metadata;
                this.addThingToLocation(thing, location);
            }
        }
    }

    static async handleMoveLocationEvents(entries = [], context = {}) {
        if (!Array.isArray(entries) || !entries.length || !context.player) {
            return;
        }

        const destinationName = entries.find(entry => entry && entry.trim());
        if (!destinationName) {
            return;
        }

        const {
            findLocationByNameLoose,
            createLocationFromEvent,
            scheduleStubExpansion,
            generateLocationImage,
            queueNpcAssetsForLocation,
            queueLocationThingImages,
            findRegionByLocationId,
            gameLocations,
            Location,
            directionKeyFromName,
            generateStubName,
            ensureExitConnection,
            generateLocationExitImage
        } = this.deps;

        const stream = context.stream;
        let emittedLocationGenerated = false;

        let destination = findLocationByNameLoose(destinationName);
        if (!destination) {
            let originLocation = context.location || null;
            if (!originLocation && context.player?.currentLocation) {
                try {
                    originLocation = Location.get(context.player.currentLocation);
                } catch (_) {
                    originLocation = null;
                }
            }

            if (stream && stream.isEnabled) {
                stream.status('event:location:generate_start', `Generating location "${destinationName}"...`, { scope: 'location' });
            }

            destination = await createLocationFromEvent({
                name: destinationName,
                originLocation,
                descriptionHint: originLocation ? `Path leading from ${originLocation.name || originLocation.id} toward ${destinationName}.` : null,
                directionHint: null
            });

            if (stream && stream.isEnabled) {
                if (destination) {
                    stream.status('event:location:generate_complete', `Location ready: ${destination.name || destinationName}`, { scope: 'location' });
                    if (!destination.isStub) {
                        if (typeof destination?.toJSON === 'function') {
                            stream.emit('location_generated', {
                                location: destination.toJSON(),
                                locationId: destination.id,
                                source: 'event-move'
                            });
                        } else {
                            stream.emit('location_generated', {
                                location: null,
                                locationId: destination?.id || null,
                                name: destination?.name || destinationName,
                                source: 'event-move'
                            });
                        }
                        emittedLocationGenerated = true;
                    }
                } else {
                    stream.status('event:location:generate_error', `Failed to generate location "${destinationName}".`, { scope: 'location' });
                }
            }

            if (!destination) {
                console.warn(`Unable to resolve or generate destination location "${destinationName}" from event.`);
                return;
            }
        }

        if (destination.isStub) {
            const initialLabel = destination.name || destinationName;
            if (stream && stream.isEnabled) {
                stream.status('event:location:expand_start', `Expanding location "${initialLabel}"...`, { scope: 'location' });
            }
            try {
                await scheduleStubExpansion(destination);
                destination = gameLocations.get(destination.id) || destination;
                if (stream && stream.isEnabled) {
                    const updatedLabel = destination?.name || initialLabel;
                    stream.status('event:location:expand_complete', `Expansion complete: ${updatedLabel}`, { scope: 'location' });
                    if (!emittedLocationGenerated) {
                        if (typeof destination?.toJSON === 'function') {
                            stream.emit('location_generated', {
                                location: destination.toJSON(),
                                locationId: destination.id,
                                source: 'event-move'
                            });
                        } else {
                            stream.emit('location_generated', {
                                location: null,
                                locationId: destination?.id || null,
                                name: updatedLabel,
                                source: 'event-move'
                            });
                        }
                        emittedLocationGenerated = true;
                    }
                }
            } catch (error) {
                console.warn('Failed to expand stub during move event:', error.message);
                if (stream && stream.isEnabled) {
                    stream.status('event:location:expand_error', `Failed to expand location "${initialLabel}".`, { scope: 'location' });
                }
            }
        }

        try {
            context.player.setLocation(destination.id);
            context.location = destination;
            context.region = findRegionByLocationId(destination.id) || context.region;

        } catch (error) {
            console.warn('Failed to finalize move location event:', error.message);
        }

        try {
            queueNpcAssetsForLocation(destination);
        } catch (error) {
            console.warn('Failed to queue NPC assets after event move:', error.message);
        }

        try {
            queueLocationThingImages(destination);
        } catch (error) {
            console.warn('Failed to queue location item images after event move:', error.message);
        }
    }

    static async handleNewExitEvents(entries = [], context = {}) {
        if (!Array.isArray(entries) || !entries.length) {
            return;
        }

        const {
            Location,
            directionKeyFromName,
            generateStubName,
            createLocationFromEvent,
            ensureExitConnection,
            generateLocationExitImage,
            createRegionStubFromEvent
        } = this.deps;

        let location = context.location || null;
        if (!location && context.player?.currentLocation) {
            try {
                location = Location.get(context.player.currentLocation);
            } catch (_) {
                location = null;
            }
        }

        if (!location) {
            return;
        }

        const metadata = location.stubMetadata ? { ...location.stubMetadata } : {};
        const discovered = Array.isArray(metadata.discoveredExits) ? metadata.discoveredExits : [];

        for (const entry of entries) {
            if (!entry) {
                continue;
            }

            let detail = entry;
            if (typeof detail === 'string') {
                const trimmed = detail.trim();
                if (!trimmed) {
                    continue;
                }
                detail = {
                    kind: 'location',
                    name: trimmed,
                    description: trimmed,
                    raw: trimmed,
                    fallback: true
                };
            }

            const kind = typeof detail.kind === 'string' ? detail.kind.trim().toLowerCase() : 'location';
            const name = typeof detail.name === 'string' ? detail.name.trim() : '';
            const description = typeof detail.description === 'string' ? detail.description.trim() : '';
            const rawSummary = detail.raw || description || name;

            if (rawSummary && typeof location.addStatusEffect === 'function') {
                location.addStatusEffect({
                    description: `Exit discovered (${kind}): ${rawSummary}`,
                    duration: this.MAJOR_STATUS_DURATION
                });
            }

            if (rawSummary) {
                discovered.push(rawSummary);
            }

            if (kind === 'region') {
                if (typeof createRegionStubFromEvent === 'function') {
                    try {
                        await createRegionStubFromEvent({
                            name,
                            description,
                            originLocation: location
                        });
                    } catch (error) {
                        console.warn('Failed to create region stub from event:', error?.message || error);
                    }
                }
                continue;
            }

            const baseName = name || description;
            let directionKey = directionKeyFromName(baseName || `${location.name || location.id} path ${Date.now()}`);
            if (!directionKey) {
                directionKey = `path_${Date.now()}`;
            }

            let cleanedName = baseName
                ? baseName.replace(/[.,!?]+$/g, '').replace(/^the\s+/i, '').trim()
                : '';
            if (!cleanedName) {
                cleanedName = generateStubName(location, directionKey);
            }

            const descriptionHint = description || `Unmarked path leaving ${location.name || location.id}.`;

            let targetLocation = null;
            try {
                targetLocation = await createLocationFromEvent({
                    name: cleanedName,
                    originLocation: location,
                    descriptionHint,
                    directionHint: directionKey
                });
            } catch (error) {
                console.warn('Failed to create location stub from event:', error?.message || error);
                continue;
            }

            if (targetLocation) {
                const exit = ensureExitConnection(location, directionKey, targetLocation, {
                    description: description || `Path to ${targetLocation.name || targetLocation.id}`,
                    bidirectional: false
                });

                if (exit) {
                    exit.imageId = null;
                }
            }
        }

        if (Object.keys(metadata).length) {
            metadata.discoveredExits = Array.from(new Set(discovered));
            location.stubMetadata = metadata;
        }
    }

    static async handleNpcArrivalDepartureEvents(entries = [], context = {}) {
        if (!Array.isArray(entries) || !entries.length || !context.location) {
            return;
        }
        const {
            ensureNpcByName,
            findLocationByNameLoose,
            createLocationFromEvent,
            queueNpcAssetsForLocation,
            generateLocationImage,
            gameLocations
        } = this.deps;
        const removeNpcFromOtherLocations = (npcId, excludeId = null) => {
            if (!npcId || !gameLocations) {
                return;
            }

            const iterate = gameLocations instanceof Map
                ? gameLocations.values()
                : (Array.isArray(gameLocations) ? gameLocations : Object.values(gameLocations));

            for (const loc of iterate) {
                if (!loc || typeof loc.removeNpcId !== 'function') {
                    continue;
                }
                if (excludeId && loc.id === excludeId) {
                    continue;
                }
                loc.removeNpcId(npcId);
            }
        };
        const location = context.location;

        for (const entry of entries) {
            if (!entry || !entry.name) continue;
            const npc = await ensureNpcByName(entry.name, context);
            if (!npc) continue;

            if (entry.action === 'arrived') {
                removeNpcFromOtherLocations(npc.id, location.id);
                try {
                    npc.setLocation(location.id);
                } catch (_) {
                    // Ignore
                }
                location.addNpcId(npc.id);
                if (gameLocations instanceof Map) {
                    gameLocations.set(location.id, location);
                }
            } else if (entry.action === 'left') {
                location.removeNpcId(npc.id);
                if (gameLocations instanceof Map) {
                    gameLocations.set(location.id, location);
                }
                const destinationName = typeof entry.destination === 'string' ? entry.destination.trim() : '';
                let destinationLocation = null;

                if (destinationName && typeof findLocationByNameLoose === 'function') {
                    destinationLocation = findLocationByNameLoose(destinationName);
                }

                if (!destinationLocation && destinationName && typeof createLocationFromEvent === 'function') {
                    try {
                        destinationLocation = await createLocationFromEvent({
                            name: destinationName,
                            originLocation: location,
                            descriptionHint: `Path leading from ${location.name || location.id} toward ${destinationName}.`,
                            directionHint: null,
                            expandStub: false
                        });
                    } catch (error) {
                        console.warn('Failed to create destination from NPC departure event:', error.message);
                    }
                }

                const destinationId = destinationLocation?.id || null;
                removeNpcFromOtherLocations(npc.id, destinationId);

                if (destinationLocation && typeof destinationLocation.addNpcId === 'function') {
                    destinationLocation.addNpcId(npc.id);
                    if (gameLocations instanceof Map) {
                        gameLocations.set(destinationLocation.id, destinationLocation);
                    }
                }

                if (destinationLocation && destinationLocation.id) {
                    try {
                        npc.setLocation(destinationLocation.id);
                    } catch (_) {
                        // ignore
                    }

                    if (typeof queueNpcAssetsForLocation === 'function') {
                        try {
                            queueNpcAssetsForLocation(destinationLocation);
                        } catch (error) {
                            console.warn('Failed to queue NPC assets for destination:', error.message);
                        }
                    }

                } else {
                    try {
                        npc.setLocation(null);
                    } catch (_) {
                        // ignore
                    }
                }
            }
        }
    }

    static async handlePartyChangeEvents(entries = [], context = {}) {
        if (!Array.isArray(entries) || !entries.length || !context.player) {
            return;
        }

        const { ensureNpcByName, gameLocations } = this.deps;

        for (const entry of entries) {
            if (!entry || !entry.name) continue;
            const npc = await ensureNpcByName(entry.name, context);
            if (!npc) continue;

            const currentPartyOwner = context.player;

            if (entry.action === 'joined' && typeof currentPartyOwner?.addPartyMember === 'function') {
                const previousLocationId = npc.currentLocation;
                const previousLocation = previousLocationId && gameLocations instanceof Map
                    ? gameLocations.get(previousLocationId)
                    : null;

                const added = currentPartyOwner.addPartyMember(npc.id);
                if (added) {
                    const ownerLocationId = currentPartyOwner.currentLocation || null;
                    if (ownerLocationId) {
                        try {
                            npc.setLocation(ownerLocationId);
                        } catch (_) {
                            // ignore failures to set NPC location
                        }
                    }

                    if (previousLocation && typeof previousLocation.removeNpcId === 'function') {
                        previousLocation.removeNpcId(npc.id);
                    }

                    if (ownerLocationId && gameLocations instanceof Map) {
                        const ownerLocation = gameLocations.get(ownerLocationId);
                        if (ownerLocation && typeof ownerLocation.removeNpcId === 'function') {
                            ownerLocation.removeNpcId(npc.id);
                        }
                    }
                }
            } else if (entry.action === 'left' && typeof currentPartyOwner?.removePartyMember === 'function') {
                const removed = currentPartyOwner.removePartyMember(npc.id);
                if (removed) {
                    const targetLocationId = context.location?.id
                        || currentPartyOwner.currentLocation
                        || npc.currentLocation
                        || null;

                    if (targetLocationId) {
                        try {
                            npc.setLocation(targetLocationId);
                        } catch (_) {
                            // ignore failures to set NPC location
                        }

                        if (gameLocations instanceof Map) {
                            const targetLocation = gameLocations.get(targetLocationId);
                            if (targetLocation) {
                                if (typeof targetLocation.removeNpcId === 'function') {
                                    targetLocation.removeNpcId(npc.id);
                                }
                                if (typeof targetLocation.addNpcId === 'function') {
                                    targetLocation.addNpcId(npc.id);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    static async handlePickUpItemEvents(entries = [], context = {}) {
        if (!Array.isArray(entries) || !entries.length) {
            return;
        }

        const contextPlayer = context.player || null;
        const {
            findThingByName,
            generateItemsByNames,
            Location,
            shouldGenerateThingImage,
            generateThingImage,
            findActorByName
        } = this.deps;

        const normalizedEntries = entries
            .map(entry => {
                if (!entry) return null;
                let name = null;
                let item = null;

                if (typeof entry === 'string') {
                    const [parsedName, parsedItem] = this.extractArrowParts(entry, 2);
                    name = parsedName;
                    item = parsedItem;
                } else if (entry && typeof entry === 'object') {
                    name = typeof entry.name === 'string' ? entry.name : null;
                    item = typeof entry.item === 'string' ? entry.item : null;
                }

                if (!name || !item) {
                    return null;
                }

                return {
                    name: String(name).trim(),
                    item: String(item).trim()
                };
            })
            .filter(entry => entry && entry.name && entry.item);

        if (!normalizedEntries.length) {
            return;
        }

        const itemNames = Array.from(new Set(normalizedEntries.map(entry => entry.item)));
        if (!itemNames.length) {
            return;
        }

        const missing = itemNames.filter(name => !findThingByName(name));
        const fallbackPlayer = contextPlayer || this.currentPlayer || null;

        if (missing.length) {
            let locationForContext = context.location || null;
            if (!locationForContext && fallbackPlayer?.currentLocation) {
                try {
                    locationForContext = Location.get(fallbackPlayer.currentLocation);
                } catch (_) {
                    locationForContext = null;
                }
            }
            await generateItemsByNames({ itemNames: missing, location: locationForContext });
        }

        const resolveRecipient = (name) => {
            if (!name) {
                return null;
            }
            const lowerName = name.toLowerCase();
            if (fallbackPlayer && (
                lowerName === 'player' ||
                (typeof fallbackPlayer.name === 'string' && fallbackPlayer.name.trim().toLowerCase() === lowerName)
            )) {
                return fallbackPlayer;
            }

            try {
                return findActorByName(name);
            } catch (_) {
                return null;
            }
        };

        for (const entry of normalizedEntries) {
            const thing = findThingByName(entry.item);
            if (!thing) {
                continue;
            }

            const recipient = resolveRecipient(entry.name);
            if (!recipient) {
                continue;
            }

            const existingMetadata = thing.metadata || {};
            if (existingMetadata.locationId) {
                this.removeThingFromLocation(thing, existingMetadata.locationId);
            } else if (context.location) {
                this.removeThingFromLocation(thing, context.location);
            }

            if (typeof recipient.addInventoryItem === 'function') {
                try {
                    recipient.addInventoryItem(thing);
                } catch (inventoryError) {
                    console.warn(`Failed to add ${thing.name} to ${recipient.name || recipient.id}:`, inventoryError.message);
                }
            }

            const metadata = thing.metadata || {};
            if (recipient.id) {
                metadata.ownerId = recipient.id;
            }
            delete metadata.locationId;
            thing.metadata = metadata;

            if (shouldGenerateThingImage(thing)) {
                generateThingImage(thing).catch(err => console.warn('Failed to generate item image after pickup:', err.message));
            }
        }
    }

    static handleStatusEffectChangeEvents(entries = [], context = {}) {
        if (!Array.isArray(entries) || !entries.length) {
            return;
        }

        const { findActorByName, findLocationByNameLoose, findRegionByNameLoose, findThingByName } = this.deps;

        const region = context.region;
        const location = context.location;

        for (const { entity, description, action } of entries) {
            if (!entity || !description) continue;
            const normalized = entity.trim().toLowerCase();
            let target = null;

            const currentPlayer = this.currentPlayer;
            if (currentPlayer && ([currentPlayer.name?.trim().toLowerCase(), 'player', 'the player', 'you'].includes(normalized))) {
                target = currentPlayer;
            }

            if (!target) {
                target = findActorByName(entity);
            }

            if (!target && location) {
                const locationAliases = [
                    typeof location.name === 'string' ? location.name.trim().toLowerCase() : null,
                    'location',
                    'current location'
                ].filter(Boolean);
                if (locationAliases.includes(normalized)) {
                    target = location;
                }
            }

            if (!target && region) {
                const regionAliases = [
                    typeof region.name === 'string' ? region.name.trim().toLowerCase() : null,
                    'region',
                    'current region'
                ].filter(Boolean);
                if (regionAliases.includes(normalized)) {
                    target = region;
                }
            }

            if (!target) {
                target = findLocationByNameLoose(entity) || findRegionByNameLoose(entity) || findThingByName(entity);
            }

            if (!target) {
                console.warn(`Status effect target "${entity}" not found.`);
                continue;
            }

            if (action === 'gained' && typeof target.addStatusEffect === 'function') {
                const duration = this.guessStatusDuration(description);
                target.addStatusEffect({ description, duration });
            } else if (action === 'lost' && typeof target.removeStatusEffect === 'function') {
                target.removeStatusEffect(description);
            }
        }
    }

    static async handleTransferItemEvents(entries = [], context = {}) {
        if (!Array.isArray(entries) || !entries.length) {
            return;
        }

        const {
            findThingByName,
            generateItemsByNames,
            findActorByName,
            Location,
            generateThingImage,
            shouldGenerateThingImage
        } = this.deps;

        for (const { giver, item, receiver } of entries) {
            if (!item) continue;
            let thing = findThingByName(item);
            if (!thing) {
                let owner = null;
                const receiverActorCandidate = findActorByName(receiver);
                if (receiverActorCandidate && typeof receiverActorCandidate.addInventoryItem === 'function') {
                    owner = receiverActorCandidate;
                }

                let locationContext = context.location || null;
                if (!locationContext && owner?.currentLocation) {
                    try {
                        locationContext = Location.get(owner.currentLocation);
                    } catch (_) {
                        locationContext = null;
                    }
                }

                await generateItemsByNames({ itemNames: [item], owner, location: locationContext });
                thing = findThingByName(item);
                if (!thing) {
                    continue;
                }
            }

            const currentMetadata = thing.metadata || {};
            if (currentMetadata.locationId) {
                this.removeThingFromLocation(thing, currentMetadata.locationId);
            }

            const giverActor = findActorByName(giver);
            if (giverActor && typeof giverActor.removeInventoryItem === 'function') {
                giverActor.removeInventoryItem(thing);
            }

            const receiverActor = findActorByName(receiver);
            if (receiverActor && typeof receiverActor.addInventoryItem === 'function') {
                receiverActor.addInventoryItem(thing);
                const metadata = thing.metadata || {};
                metadata.ownerId = receiverActor.id;
                delete metadata.locationId;
                thing.metadata = metadata;

                if (receiverActor === this.currentPlayer && shouldGenerateThingImage(thing)) {
                    generateThingImage(thing).catch(err => console.warn('Failed to generate image after transfer:', err.message));
                }
            } else {
                const metadata = thing.metadata || {};
                delete metadata.ownerId;
                metadata.locationId = context.location ? context.location.id : metadata.locationId;
                thing.metadata = metadata;
                if (metadata.locationId) {
                    this.addThingToLocation(thing, metadata.locationId);
                }
            }
        }
    }

    static handleCurrencyEvents(entries, context = {}) {
        const deltas = Array.isArray(entries)
            ? entries
            : (entries === null || entries === undefined ? [] : [entries]);

        if (!deltas.length) {
            return;
        }

        const player = context.player || this.currentPlayer;
        if (!player || typeof player.adjustCurrency !== 'function') {
            return;
        }

        if (!Array.isArray(context.currencyChanges)) {
            context.currencyChanges = [];
        }

        const getCurrentCurrency = () => {
            try {
                if (typeof player.getCurrency === 'function') {
                    return player.getCurrency();
                }
            } catch (_) { }
            const fallback = Number(player.currency);
            return Number.isFinite(fallback) ? fallback : 0;
        };

        for (const entry of deltas) {
            const numeric = Number(entry);
            if (!Number.isFinite(numeric) || numeric === 0) {
                continue;
            }
            const before = getCurrentCurrency();
            player.adjustCurrency(numeric);
            const after = getCurrentCurrency();
            const delta = after - before;
            if (delta !== 0) {
                context.currencyChanges.push({ amount: delta });
            }
        }
    }

    static handleNeedBarChangeEvents(entries, context = {}) {
        const updates = Array.isArray(entries)
            ? entries
            : (entries === null || entries === undefined ? [] : [entries]);

        if (!updates.length) {
            return;
        }

        const { findActorByName } = this.deps;

        if (!Array.isArray(context.needBarChanges)) {
            context.needBarChanges = [];
        }

        const resolveActor = (name) => {
            if (!name || typeof name !== 'string') {
                return null;
            }
            let actor = findActorByName ? findActorByName(name) : null;
            if (!actor && this.currentPlayer) {
                const normalized = name.trim().toLowerCase();
                if (['player', 'the player', 'you', 'self'].includes(normalized)) {
                    actor = this.currentPlayer;
                }
            }
            return actor;
        };

        for (const entry of updates) {
            if (!entry || !entry.character || !entry.needBar) {
                continue;
            }

            const actor = resolveActor(entry.character);
            if (!actor || typeof actor.applyNeedBarChange !== 'function') {
                continue;
            }

            const adjustment = actor.applyNeedBarChange(entry.needBar, {
                direction: entry.direction,
                magnitude: entry.magnitude,
                reason: entry.reason
            });

            if (!adjustment) {
                continue;
            }

            context.needBarChanges.push({
                actorId: actor.id || null,
                actorName: actor.name || entry.character,
                needBarId: adjustment.id || entry.needBar,
                needBarName: adjustment.name || entry.needBar,
                direction: adjustment.direction,
                magnitude: adjustment.magnitude,
                previousValue: adjustment.previousValue,
                newValue: adjustment.newValue,
                delta: adjustment.delta,
                reason: adjustment.reason || entry.reason || null,
                playerOnly: adjustment.playerOnly,
                min: adjustment.min,
                max: adjustment.max,
                previousThreshold: adjustment.previousThreshold,
                currentThreshold: adjustment.currentThreshold
            });
        }
    }

    static handleExperienceCheckEvents(entries, context = {}) {
        const items = Array.isArray(entries)
            ? entries
            : (entries === null || entries === undefined ? [] : [entries]);

        if (!items.length) {
            return;
        }

        const player = context.player || this.currentPlayer;
        if (!player || typeof player.addExperience !== 'function') {
            return;
        }

        const playerLevelRaw = Number(player.level);
        const playerLevel = Number.isFinite(playerLevelRaw) ? playerLevelRaw : 1;
        const locationLevelRaw = Number(context.location?.baseLevel);
        const locationLevel = Number.isFinite(locationLevelRaw) ? locationLevelRaw : playerLevel;
        const levelDelta = locationLevel - playerLevel;
        const multiplier = Number.isFinite(levelDelta) ? Math.pow(1.15, levelDelta) : 1;

        const scale = Number.isFinite(multiplier) ? multiplier : 1;
        let totalXp = 0;
        const awards = [];

        for (const entry of items) {
            const value = typeof entry === 'object' && entry !== null ? entry.amount : entry;
            const numeric = Number(value);
            if (!Number.isFinite(numeric) || numeric <= 0) {
                continue;
            }

            const xpAward = Math.round(Math.max(0, numeric) * 10 * scale);
            if (xpAward <= 0) {
                continue;
            }

            totalXp += xpAward;

            let reason = '';
            if (entry && typeof entry === 'object' && entry.reason) {
                reason = String(entry.reason).trim();
            }
            if (!reason) {
                reason = 'Accomplishment';
            }

            awards.push({ amount: xpAward, reason });
        }

        if (totalXp > 0) {
            player.addExperience(totalXp);
        }

        if (awards.length) {
            if (!Array.isArray(context.experienceAwards)) {
                context.experienceAwards = [];
            }
            context.experienceAwards.push(...awards);
        }
    }

    static handleEnvironmentalStatusDamageEvents(entries = [], context = {}) {
        if (context && context.allowEnvironmentalEffects === false) {
            return;
        }

        const items = Array.isArray(entries)
            ? entries
            : (entries === null || entries === undefined ? [] : [entries]);

        if (!items.length) {
            return;
        }

        if (!Array.isArray(context.environmentalDamageEvents)) {
            context.environmentalDamageEvents = [];
        }

        const { findActorByName } = this.deps;

        const locationLevelRaw = Number(context.location?.baseLevel);
        const playerLevelRaw = Number(context.player?.level);
        const resolvedLevel = Number.isFinite(locationLevelRaw)
            ? locationLevelRaw
            : (Number.isFinite(playerLevelRaw) ? playerLevelRaw : 1);

        const mediumDamage = Math.max(1, Math.floor(8 + (resolvedLevel * 2)));
        const highDamage = Math.max(1, Math.floor(mediumDamage * 1.75));
        const lowDamage = Math.max(1, Math.floor(mediumDamage * 0.25));

        const severityLookup = {
            low: lowDamage,
            medium: mediumDamage,
            high: highDamage
        };

        for (const entry of items) {
            if (!entry) {
                continue;
            }

            const name = typeof entry === 'object' && entry !== null && entry.name
                ? String(entry.name).trim()
                : (typeof entry === 'string' ? entry.trim() : '');
            if (!name) {
                continue;
            }

            let severityKey = 'medium';
            if (typeof entry === 'object' && entry !== null && entry.severity) {
                const normalized = String(entry.severity).trim().toLowerCase();
                if (normalized) {
                    severityKey = normalized.split(/\s+/)[0] || severityKey;
                }
            }
            if (!severityLookup[severityKey]) {
                severityKey = 'medium';
            }

            const reason = typeof entry === 'object' && entry !== null && entry.reason
                ? String(entry.reason).trim()
                : '';

            const plannedAmount = severityLookup[severityKey] || mediumDamage;

            const effectTypeRaw = typeof entry === 'object' && entry !== null && entry.effect
                ? String(entry.effect).trim().toLowerCase()
                : 'damage';
            const isHealing = effectTypeRaw === 'healing' || effectTypeRaw === 'heal' || effectTypeRaw === 'healed';

            const actor = findActorByName ? findActorByName(name) : null;
            let appliedAmount = plannedAmount;

            if (actor && typeof actor.modifyHealth === 'function') {
                try {
                    const delta = isHealing ? plannedAmount : -plannedAmount;
                    const fallbackReason = isHealing ? 'Environmental healing' : 'Environmental damage';
                    const result = actor.modifyHealth(delta, reason || fallbackReason);
                    if (result && typeof result.change === 'number') {
                        const magnitude = Math.abs(result.change);
                        if (magnitude > 0) {
                            appliedAmount = magnitude;
                        } else {
                            appliedAmount = plannedAmount;
                        }
                    }
                } catch (error) {
                    console.warn('Failed to apply environmental status effect:', error.message);
                }
            }

            appliedAmount = Math.max(1, Math.floor(appliedAmount));

            context.environmentalDamageEvents.push({
                name,
                amount: appliedAmount,
                severity: severityKey,
                reason,
                actorId: actor?.id || null,
                type: isHealing ? 'healing' : 'damage'
            });
        }
    }

    static handleDefeatedEnemyEvents(entries = [], context = {}) {
        const names = Array.isArray(entries)
            ? entries
            : (entries === null || entries === undefined ? [] : [entries]);

        if (!names.length) {
            return;
        }

        const player = context.player || this.currentPlayer;
        if (!player || typeof player.addExperience !== 'function') {
            return;
        }

        const playerLevelRaw = Number(player.level);
        const playerLevel = Number.isFinite(playerLevelRaw) ? playerLevelRaw : 1;
        const { findActorByName } = this.deps;

        const awards = [];
        let totalXp = 0;

        for (const name of names) {
            if (!name || typeof name !== 'string') {
                continue;
            }

            let enemy = findActorByName(name);

            const enemyLevelRaw = Number(enemy?.level);
            const enemyLevel = Number.isFinite(enemyLevelRaw) ? enemyLevelRaw : playerLevel;
            const multiplier = Math.pow(1.15, enemyLevel - playerLevel);
            const total = Math.round(50 * (Number.isFinite(multiplier) ? multiplier : 1));
            if (total > 0) {
                totalXp += total;
                const reason = `Defeated ${String(name).trim() || 'an enemy'}`;
                awards.push({ amount: total, reason });
            }
        }

        if (totalXp > 0) {
            player.addExperience(totalXp);
        }

        if (awards.length) {
            if (!Array.isArray(context.experienceAwards)) {
                context.experienceAwards = [];
            }
            context.experienceAwards.push(...awards);
        }
    }

    static async applyEventOutcomes(parsedEvents, context = {}) {
        if (!parsedEvents || !parsedEvents.parsed) {
            return context;
        }

        const eventMap = parsedEvents.parsed;
        const prioritizedOrder = [
            'pick_up_item',
            'transfer_item',
            'drop_item',
            'alter_item'
        ];

        const seen = new Set();
        const orderedKeys = [];

        prioritizedOrder.forEach(key => {
            if (Object.prototype.hasOwnProperty.call(eventMap, key)) {
                orderedKeys.push(key);
                seen.add(key);
            }
        });

        Object.keys(eventMap).forEach(key => {
            if (!seen.has(key)) {
                orderedKeys.push(key);
            }
        });

        for (const eventKey of orderedKeys) {
            const entries = eventMap[eventKey];
            const handler = this._handlers[eventKey];
            if (!handler) {
                continue;
            }
            try {
                await handler(entries, context, parsedEvents.rawEntries?.[eventKey] || '');
            } catch (error) {
                console.warn(`Failed to apply event handler for ${eventKey}:`, error.message);
            }
        }

        return context;
    }

    static logEventCheck({ systemPrompt, generationPrompt, responseText }) {
        try {
            const { fs, path, baseDir } = this.deps;
            const logDir = path.join(baseDir, 'logs');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const logPath = path.join(logDir, `event_checks_${timestamp}.log`);
            const parts = [
                '=== EVENT CHECK SYSTEM PROMPT ===',
                systemPrompt || '(none)',
                '',
                '=== EVENT CHECK GENERATION PROMPT ===',
                generationPrompt || '(none)',
                '',
                '=== EVENT CHECK RESPONSE ===',
                responseText || '(no response)',
                ''
            ];
            fs.writeFileSync(logPath, parts.join('\n'), 'utf8');
        } catch (error) {
            console.warn('Failed to log event check:', error.message);
        }
    }

    static escapeHtml(text) {
        if (typeof text !== 'string') {
            return '';
        }
        return text.replace(/[&<>'"]/g, char => {
            switch (char) {
                case '&':
                    return '&amp;';
                case '<':
                    return '&lt;';
                case '>':
                    return '&gt;';
                case '"':
                    return '&quot;';
                case '\'':
                    return '&#39;';
                default:
                    return char;
            }
        });
    }

    static async runEventChecks({ textToCheck, stream = null, allowEnvironmentalEffects = true } = {}) {
        if (!textToCheck || !textToCheck.trim()) {
            return null;
        }

        const eventPromptTemplates = this.deps.getEventPromptTemplates();
        if (!eventPromptTemplates.length) {
            return null;
        }

        try {
            const currentPlayer = this.currentPlayer;
            const { Location, buildBasePromptContext, promptEnv, parseXMLTemplate, axios, findRegionByLocationId } = this.deps;

            const location = currentPlayer && currentPlayer.currentLocation
                ? Location.get(currentPlayer.currentLocation)
                : null;

            let region = null;
            if (location) {
                try {
                    region = findRegionByLocationId(location.id);
                } catch (_) {
                    region = null;
                }
            }

            const baseContext = buildBasePromptContext({ locationOverride: location });
            const renderedTemplate = promptEnv.render('base-context.xml.njk', {
                ...baseContext,
                promptType: 'event-checks',
                textToCheck,
                eventPrompts: eventPromptTemplates
            });

            const parsedTemplate = parseXMLTemplate(renderedTemplate);

            if (!parsedTemplate.systemPrompt || !parsedTemplate.generationPrompt) {
                console.warn('Event check template missing prompts, skipping event analysis.');
                return null;
            }

            const messages = [
                { role: 'system', content: parsedTemplate.systemPrompt },
                { role: 'user', content: parsedTemplate.generationPrompt }
            ];

            const config = this.config;
            const endpoint = config.ai.endpoint;
            const apiKey = config.ai.apiKey;
            const chatEndpoint = endpoint.endsWith('/') ?
                endpoint + 'chat/completions' :
                endpoint + '/chat/completions';

            const requestData = {
                model: config.ai.model,
                messages,
                max_tokens: parsedTemplate.maxTokens || 400,
                temperature: typeof parsedTemplate.temperature === 'number' ? parsedTemplate.temperature : 0.3
            };

            const response = await axios.post(chatEndpoint, requestData, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: config.baseTimeoutSeconds
            });

            const eventResponse = response.data?.choices?.[0]?.message?.content || '';

            this.logEventCheck({
                systemPrompt: parsedTemplate.systemPrompt,
                generationPrompt: parsedTemplate.generationPrompt,
                responseText: eventResponse
            });

            if (!eventResponse.trim()) {
                return null;
            }

            const structured = this.parseEventCheckResponse(eventPromptTemplates, eventResponse);
            let experienceAwards = [];
            let currencyChanges = [];
            let environmentalDamageEvents = [];
            let needBarChanges = [];
            if (structured) {
                if (allowEnvironmentalEffects === false) {
                    if (structured.parsed && Array.isArray(structured.parsed.environmental_status_damage)) {
                        structured.parsed.environmental_status_damage = [];
                    }
                    if (structured.rawEntries && Object.prototype.hasOwnProperty.call(structured.rawEntries, 'environmental_status_damage')) {
                        structured.rawEntries.environmental_status_damage = '';
                    }
                }
                try {
                    const outcomeContext = await this.applyEventOutcomes(structured, {
                        player: currentPlayer,
                        location,
                        region,
                        experienceAwards: [],
                        currencyChanges: [],
                        environmentalDamageEvents: [],
                        allowEnvironmentalEffects: Boolean(allowEnvironmentalEffects),
                        stream
                    });
                    if (Array.isArray(outcomeContext?.experienceAwards) && outcomeContext.experienceAwards.length) {
                        experienceAwards = outcomeContext.experienceAwards;
                    }
                    if (Array.isArray(outcomeContext?.currencyChanges) && outcomeContext.currencyChanges.length) {
                        currencyChanges = outcomeContext.currencyChanges;
                    }
                    if (Array.isArray(outcomeContext?.environmentalDamageEvents) && outcomeContext.environmentalDamageEvents.length) {
                        environmentalDamageEvents = outcomeContext.environmentalDamageEvents;
                    }
                    if (Array.isArray(outcomeContext?.needBarChanges) && outcomeContext.needBarChanges.length) {
                        needBarChanges = outcomeContext.needBarChanges;
                    }
                } catch (applyError) {
                    console.warn('Failed to apply event outcomes:', applyError.message);
                }
            }

            const safeResponse = this.escapeHtml(this.cleanEventResponseText(eventResponse));
            return {
                raw: eventResponse,
                html: safeResponse.replace(/\n/g, '<br>'),
                structured,
                experienceAwards,
                currencyChanges,
                environmentalDamageEvents,
                needBarChanges
            };
        } catch (error) {
            console.warn('Event check execution failed:', error.message);
            return null;
        }
    }
}

module.exports = Events;
