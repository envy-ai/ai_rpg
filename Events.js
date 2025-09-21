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
            move_location: raw => this.splitSemicolonEntries(raw),
            new_exit_discovered: raw => this.splitSemicolonEntries(raw),
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
            pick_up_item: raw => this.splitSemicolonEntries(raw),
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
            }).filter(Boolean)
        };

        this._handlers = {
            attack_damage: (entries, context) => this.handleAttackDamageEvents(entries, context),
            consume_item: (entries, context) => this.handleConsumeItemEvents(entries, context),
            death_incapacitation: (entries, context) => this.handleDeathEvents(entries, context),
            drop_item: (entries, context) => this.handleDropItemEvents(entries, context),
            heal_recover: (entries, context) => this.handleHealEvents(entries, context),
            item_appear: (entries, context) => this.handleItemAppearEvents(entries, context),
            move_location: (entries, context) => this.handleMoveLocationEvents(entries, context),
            new_exit_discovered: (entries, context) => this.handleNewExitEvents(entries, context),
            npc_arrival_departure: (entries, context) => this.handleNpcArrivalDepartureEvents(entries, context),
            party_change: (entries, context) => this.handlePartyChangeEvents(entries, context),
            pick_up_item: (entries, context) => this.handlePickUpItemEvents(entries, context),
            status_effect_change: (entries, context) => this.handleStatusEffectChangeEvents(entries, context),
            transfer_item: (entries, context) => this.handleTransferItemEvents(entries, context)
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
            findRegionByLocationId,
            gameLocations,
            Location,
            directionKeyFromName,
            generateStubName,
            ensureExitConnection,
            generateLocationExitImage
        } = this.deps;

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

            destination = await createLocationFromEvent({
                name: destinationName,
                originLocation,
                descriptionHint: originLocation ? `Path leading from ${originLocation.name || originLocation.id} toward ${destinationName}.` : null,
                directionHint: null
            });

            if (!destination) {
                console.warn(`Unable to resolve or generate destination location "${destinationName}" from event.`);
                return;
            }
        }

        if (destination.isStub) {
            try {
                await scheduleStubExpansion(destination);
                destination = gameLocations.get(destination.id) || destination;
            } catch (error) {
                console.warn('Failed to expand stub during move event:', error.message);
            }
        }

        try {
            context.player.setLocation(destination.id);
            context.location = destination;
            context.region = findRegionByLocationId(destination.id) || context.region;

            await generateLocationImage(destination);
        } catch (error) {
            console.warn('Failed to finalize move location event:', error.message);
        }

        try {
            queueNpcAssetsForLocation(destination);
        } catch (error) {
            console.warn('Failed to queue NPC assets after event move:', error.message);
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
            generateLocationExitImage
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

        for (const rawDescription of entries) {
            if (!rawDescription) continue;
            const description = typeof rawDescription === 'string' ? rawDescription.trim() : '';

            if (typeof location.addStatusEffect === 'function' && description) {
                location.addStatusEffect({ description: `Exit discovered: ${description}`, duration: this.MAJOR_STATUS_DURATION });
            }
            if (description) {
                discovered.push(description);
            }

            const directionKey = directionKeyFromName(description || `${location.name || location.id} path ${Date.now()}`);
            const cleanedName = description
                ? description.replace(/[.,!?]+$/g, '').replace(/^the\s+/i, '').trim() || generateStubName(location, directionKey)
                : generateStubName(location, directionKey);

            const targetLocation = await createLocationFromEvent({
                name: cleanedName,
                originLocation: location,
                descriptionHint: description || `Unmarked path leaving ${location.name || location.id}.`,
                directionHint: directionKey
            });

            if (targetLocation) {
                const exit = ensureExitConnection(location, directionKey, targetLocation, {
                    description: description || `Path to ${targetLocation.name || targetLocation.id}`,
                    bidirectional: false
                });

                if (exit) {
                    generateLocationExitImage(exit).catch(err => console.warn('Failed to queue exit image generation:', err.message));
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
                            directionHint: null
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

                    if (typeof generateLocationImage === 'function') {
                        generateLocationImage(destinationLocation).catch(error => {
                            console.warn('Failed to queue destination location image:', error.message);
                        });
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

        const { ensureNpcByName } = this.deps;

        for (const entry of entries) {
            if (!entry || !entry.name) continue;
            const npc = await ensureNpcByName(entry.name, context);
            if (!npc) continue;

            if (entry.action === 'joined' && typeof context.player.addPartyMember === 'function') {
                context.player.addPartyMember(npc.id);
                const currentLocationId = context.player.currentLocation;
                if (currentLocationId) {
                    try {
                        npc.setLocation(currentLocationId);
                    } catch (_) {
                        // ignore failures to set NPC location
                    }
                }
            } else if (entry.action === 'left' && typeof context.player.removePartyMember === 'function') {
                context.player.removePartyMember(npc.id);
            }
        }
    }

    static async handlePickUpItemEvents(entries = [], context = {}) {
        if (!Array.isArray(entries) || !entries.length || !context.player) {
            return;
        }

        const { player } = context;
        const { findThingByName, generateItemsByNames, Location, shouldGenerateThingImage, generateThingImage } = this.deps;

        const itemNames = entries
            .map(name => typeof name === 'string' ? name : null)
            .filter(name => typeof name === 'string' && name.trim());

        if (!itemNames.length) {
            return;
        }

        const missing = itemNames.filter(name => !findThingByName(name));
        if (missing.length) {
            let locationForContext = context.location || null;
            if (!locationForContext && player.currentLocation) {
                try {
                    locationForContext = Location.get(player.currentLocation);
                } catch (_) {
                    locationForContext = null;
                }
            }
            await generateItemsByNames({ itemNames: missing, owner: player, location: locationForContext });
        }

        for (const itemName of itemNames) {
            const thing = findThingByName(itemName);
            if (!thing) {
                continue;
            }

            const existingMetadata = thing.metadata || {};
            if (existingMetadata.locationId) {
                this.removeThingFromLocation(thing, existingMetadata.locationId);
            } else if (context.location) {
                this.removeThingFromLocation(thing, context.location);
            }

            if (typeof player.addInventoryItem === 'function') {
                player.addInventoryItem(thing);
            }

            const metadata = thing.metadata || {};
            metadata.ownerId = player.id;
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

    static async applyEventOutcomes(parsedEvents, context = {}) {
        if (!parsedEvents || !parsedEvents.parsed) {
            return context;
        }

        for (const [eventKey, entries] of Object.entries(parsedEvents.parsed)) {
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

    static async runEventChecks({ textToCheck }) {
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
                timeout: 60000
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
            if (structured) {
                try {
                    await this.applyEventOutcomes(structured, {
                        player: currentPlayer,
                        location,
                        region: location ? findRegionByLocationId(location.id) : null
                    });
                } catch (applyError) {
                    console.warn('Failed to apply event outcomes:', applyError.message);
                }
            }

            const safeResponse = this.escapeHtml(this.cleanEventResponseText(eventResponse));
            return {
                raw: eventResponse,
                html: safeResponse.replace(/\n/g, '<br>'),
                structured
            };
        } catch (error) {
            console.warn('Event check execution failed:', error.message);
            return null;
        }
    }
}

module.exports = Events;
