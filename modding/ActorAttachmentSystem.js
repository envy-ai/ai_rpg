class ActorAttachmentSystem {
    constructor({
        namespace,
        displayLabel,
        itemSlotFieldName,
        itemMetadataSlotKey,
        installToolName,
        removeToolName,
        installEventTag,
        removeEventTag,
        installEventKey,
        removeEventKey
    } = {}) {
        this.namespace = ActorAttachmentSystem.#requiredString(namespace, 'namespace');
        this.displayLabel = ActorAttachmentSystem.#requiredString(displayLabel || namespace, 'displayLabel');
        this.itemSlotFieldName = ActorAttachmentSystem.#requiredString(itemSlotFieldName || itemMetadataSlotKey, 'itemSlotFieldName');
        this.installToolName = installToolName || `equip${ActorAttachmentSystem.#capitalize(this.namespace)}`;
        this.removeToolName = removeToolName || `unequip${ActorAttachmentSystem.#capitalize(this.namespace)}`;
        this.installEventTag = installEventTag || `${this.namespace}Equipped`;
        this.removeEventTag = removeEventTag || `${this.namespace}Unequipped`;
        this.installEventKey = installEventKey || `${this.namespace}_equipped`;
        this.removeEventKey = removeEventKey || `${this.namespace}_unequipped`;
    }

    static #requiredString(value, fieldName) {
        const normalized = typeof value === 'string' ? value.trim() : '';
        if (!normalized) {
            throw new Error(`ActorAttachmentSystem requires ${fieldName}.`);
        }
        return normalized;
    }

    static #capitalize(value) {
        const normalized = String(value || '').trim();
        return normalized ? normalized[0].toUpperCase() + normalized.slice(1) : '';
    }

    static #clone(value) {
        return JSON.parse(JSON.stringify(value || {}));
    }

    static #normalizeName(value, fieldName) {
        const normalized = typeof value === 'string' ? value.trim() : '';
        if (!normalized) {
            throw new Error(`${fieldName} is required.`);
        }
        return normalized;
    }

    #getState(actor) {
        if (!actor || typeof actor.getModState !== 'function') {
            throw new Error(`${this.displayLabel} actor does not support mod state.`);
        }
        const state = actor.getModState(this.namespace);
        const slots = state.slots && typeof state.slots === 'object' && !Array.isArray(state.slots)
            ? ActorAttachmentSystem.#clone(state.slots)
            : {};
        for (const [slotName, itemIds] of Object.entries(slots)) {
            if (!Array.isArray(itemIds)) {
                throw new Error(`${this.namespace}.slots.${slotName} must be an array.`);
            }
            slots[slotName] = itemIds
                .map(itemId => (typeof itemId === 'string' ? itemId.trim() : ''))
                .filter(Boolean);
        }
        return {
            ...state,
            slots
        };
    }

    #setState(actor, state, options = {}) {
        actor.setModState(this.namespace, state, options);
    }

    #inventoryItems(actor) {
        if (!actor || typeof actor.getInventoryItems !== 'function') {
            throw new Error(`${this.displayLabel} actor does not expose inventory items.`);
        }
        return actor.getInventoryItems();
    }

    #findInventoryItemByName(actor, itemName) {
        const normalizedName = ActorAttachmentSystem.#normalizeName(itemName, 'itemName').toLowerCase();
        const matches = this.#inventoryItems(actor).filter(item => {
            const name = typeof item?.name === 'string' ? item.name.trim().toLowerCase() : '';
            return name === normalizedName;
        });
        if (matches.length === 0) {
            throw new Error(`No inventory item named "${itemName}" found for ${actor.name || 'actor'}.`);
        }
        if (matches.length > 1) {
            throw new Error(`Ambiguous inventory item "${itemName}" for ${actor.name || 'actor'}.`);
        }
        return matches[0];
    }

    #resolveItem(actor, { item, itemName }) {
        if (item) {
            const inventoryItem = this.#inventoryItems(actor).find(candidate => candidate === item || candidate.id === item.id);
            if (!inventoryItem) {
                throw new Error(`Item "${item.name || item.id || 'unknown'}" is not in ${actor.name || 'actor'} inventory.`);
            }
            return inventoryItem;
        }
        return this.#findInventoryItemByName(actor, itemName);
    }

    #resolveInstallItem(actor, { item, itemName, sourceActors }) {
        if (!Array.isArray(sourceActors)) throw new Error(`${this.displayLabel} sourceActors must be an array of accessible inventory owners.`);
        const name = item ? null : ActorAttachmentSystem.#normalizeName(itemName, 'itemName').toLowerCase();
        const matches = owner => this.#inventoryItems(owner).filter(candidate => item
            ? candidate === item || candidate.id === item.id
            : typeof candidate?.name === 'string' && candidate.name.trim().toLowerCase() === name);
        const owned = matches(actor);
        if (owned.length > 1) throw new Error(`Ambiguous inventory item "${itemName || item?.name}" for ${actor.name || 'actor'}.`);
        if (owned.length) return { item: owned[0], sourceActor: actor };
        const sources = [...new Set(sourceActors)].filter(owner => owner && owner !== actor);
        const found = sources.flatMap(owner => matches(owner).map(candidate => ({ item: candidate, sourceActor: owner })));
        if (found.length > 1) throw new Error(`Ambiguous accessible inventory item "${itemName || item?.name}"; select a uniquely named implant before installing it.`);
        if (!found.length) throw new Error(`No accessible inventory item "${itemName || item?.name || item?.id}" found for ${actor.name || 'actor'}. Use an item in the recipient's inventory or the current player's carried inventory with a local recipient.`);
        return found[0];
    }

    #slotForItem(item) {
        const rawSlot = typeof item?.getExtensionField === 'function'
            ? item.getExtensionField(this.itemSlotFieldName)
            : item?.[this.itemSlotFieldName];
        const slot = typeof rawSlot === 'string' ? rawSlot.trim() : '';
        if (!slot) {
            throw new Error(`Item "${item?.name || item?.id || 'unknown'}" is not compatible with ${this.displayLabel}; ${this.itemSlotFieldName} is required.`);
        }
        return slot;
    }

    #findInstalledSlot(state, itemId) {
        for (const [slotName, itemIds] of Object.entries(state.slots)) {
            if (Array.isArray(itemIds) && itemIds.includes(itemId)) {
                return slotName;
            }
        }
        return null;
    }

    install({ actor, item, itemName, sourceActors = [], implantSlot, slot, reason } = {}) {
        const { item: resolvedItem, sourceActor } = this.#resolveInstallItem(actor, { item, itemName, sourceActors });
        if (!resolvedItem.id || typeof resolvedItem.id !== 'string') {
            throw new Error(`${this.displayLabel} item "${resolvedItem.name || 'unknown'}" requires a stable id.`);
        }
        const itemSlot = this.#slotForItem(resolvedItem);
        const requestedSlot = typeof (implantSlot ?? slot) === 'string' ? (implantSlot ?? slot).trim() : '';
        if (requestedSlot && requestedSlot !== itemSlot) {
            throw new Error(`${this.displayLabel} slot mismatch for "${resolvedItem.name}": requested "${requestedSlot}", item requires "${itemSlot}".`);
        }
        const state = this.#getState(actor);
        const existingSlot = this.#findInstalledSlot(state, resolvedItem.id);
        if (existingSlot) {
            throw new Error(`${this.displayLabel} item "${resolvedItem.name}" is already installed in "${existingSlot}".`);
        }

        const transferring = sourceActor !== actor;
        if (transferring) {
            const sourceSlot = this.#findInstalledSlot(this.#getState(sourceActor), resolvedItem.id);
            if (sourceSlot) throw new Error(`${this.displayLabel} item "${resolvedItem.name}" is already installed on ${sourceActor.name || 'its owner'}; uninstall it before installing it on another character.`);
            if (resolvedItem.hiddenFromPlayer === true) throw new Error(`${this.displayLabel} item "${resolvedItem.name}" is hidden and cannot be transferred for installation.`);
            if (resolvedItem.isEquipped || resolvedItem.equippedSlot || resolvedItem.moduleInstalledOnItemId) {
                throw new Error(`${this.displayLabel} item "${resolvedItem.name}" is equipped or installed as a module; remove it before installing it on another character.`);
            }
            if (typeof sourceActor.removeInventoryItem !== 'function' || typeof sourceActor.addInventoryItem !== 'function'
                || typeof actor.addInventoryItem !== 'function' || typeof actor.removeInventoryItem !== 'function') {
                throw new Error(`${this.displayLabel} installation transfer requires native inventory mutation methods on both characters.`);
            }
            if (!actor.modState || !sourceActor.modState) throw new Error(`${this.displayLabel} installation transfer requires complete character mod state for rollback.`);
        }

        const previousState = actor.getModState(this.namespace);
        const previousRecipientModState = transferring ? ActorAttachmentSystem.#clone(actor.modState) : null;
        const previousSourceModState = transferring ? ActorAttachmentSystem.#clone(sourceActor.modState) : null;
        const previousMetadata = transferring ? ActorAttachmentSystem.#clone(resolvedItem.metadata) : null;
        const previousHealth = actor.health;
        const previousSourceHealth = sourceActor.health;

        const mutate = () => {
            if (transferring) {
                if (sourceActor.removeInventoryItem(resolvedItem, { suppressNpcEquip: true }) !== true) {
                    throw new Error(`Could not remove "${resolvedItem.name}" from ${sourceActor.name || 'source inventory'} for installation.`);
                }
                if (actor.addInventoryItem(resolvedItem, { mergeStacks: false, suppressNpcEquip: true }) !== true) {
                    throw new Error(`Could not move "${resolvedItem.name}" into ${actor.name || 'recipient'} inventory for installation.`);
                }
            }
            const itemIds = Array.isArray(state.slots[itemSlot]) ? state.slots[itemSlot] : [];
            state.slots[itemSlot] = [...itemIds, resolvedItem.id];
            this.#setState(actor, state);
        };
        const install = () => typeof actor.withHealthRatioPreserved === 'function'
            ? actor.withHealthRatioPreserved(mutate) : mutate();
        try {
            if (transferring && typeof sourceActor.withHealthRatioPreserved === 'function') sourceActor.withHealthRatioPreserved(install);
            else install();
        } catch (error) {
            const failures = [];
            const restore = action => { try { action(); } catch (cause) { failures.push(cause); } };
            if (transferring) {
                restore(() => {
                    if (this.#inventoryItems(actor).includes(resolvedItem)
                        && actor.removeInventoryItem(resolvedItem, { suppressNpcEquip: true }) !== true) throw new Error('Could not remove failed installation from recipient inventory.');
                });
                restore(() => {
                    if (!this.#inventoryItems(sourceActor).includes(resolvedItem)
                        && sourceActor.addInventoryItem(resolvedItem, { mergeStacks: false, suppressNpcEquip: true }) !== true) throw new Error('Could not restore implant to its source inventory.');
                });
                restore(() => { resolvedItem.metadata = previousMetadata; });
                restore(() => { actor.modState = previousRecipientModState; });
                restore(() => { sourceActor.modState = previousSourceModState; });
                if (Number.isFinite(previousSourceHealth)) restore(() => sourceActor.setHealth(previousSourceHealth));
            } else {
                restore(() => this.#setState(actor, previousState));
            }
            if (Number.isFinite(previousHealth)) restore(() => actor.setHealth(previousHealth));
            if (failures.length) throw new AggregateError([error, ...failures], `${this.displayLabel} installation failed and rollback was incomplete: ${error.message}`, { cause: error });
            throw error;
        }

        return {
            actor,
            item: resolvedItem,
            sourceActor,
            slot: itemSlot,
            reason: typeof reason === 'string' ? reason.trim() : ''
        };
    }

    remove({ actor, item, itemName, reason } = {}) {
        const resolvedItem = this.#resolveItem(actor, { item, itemName });
        const state = this.#getState(actor);
        const installedSlot = this.#findInstalledSlot(state, resolvedItem.id);
        if (!installedSlot) {
            throw new Error(`${this.displayLabel} item "${resolvedItem.name}" is not installed on ${actor.name || 'actor'}.`);
        }

        const mutate = () => {
            state.slots[installedSlot] = state.slots[installedSlot].filter(itemId => itemId !== resolvedItem.id);
            this.#setState(actor, state);
        };
        if (typeof actor.withHealthRatioPreserved === 'function') {
            actor.withHealthRatioPreserved(mutate);
        } else {
            mutate();
        }

        return {
            actor,
            item: resolvedItem,
            slot: installedSlot,
            reason: typeof reason === 'string' ? reason.trim() : ''
        };
    }

    list(actor) {
        const state = this.#getState(actor);
        const inventoryById = new Map(this.#inventoryItems(actor)
            .filter(item => item && typeof item.id === 'string')
            .map(item => [item.id, item]));
        const installed = [];
        for (const [slotName, itemIds] of Object.entries(state.slots)) {
            for (const itemId of itemIds) {
                const item = inventoryById.get(itemId);
                if (item) {
                    installed.push({ slot: slotName, itemId, item });
                }
            }
        }
        return installed;
    }

    syncWithInventory(actor) {
        const state = this.#getState(actor);
        const inventoryIds = new Set(this.#inventoryItems(actor)
            .filter(item => item && typeof item.id === 'string')
            .map(item => item.id));
        let changed = false;
        for (const [slotName, itemIds] of Object.entries(state.slots)) {
            const filtered = itemIds.filter(itemId => inventoryIds.has(itemId));
            if (filtered.length !== itemIds.length) {
                state.slots[slotName] = filtered;
                changed = true;
            }
        }
        if (changed) {
            this.#setState(actor, state);
        }
        return changed;
    }

    getAttributeModifierContributions(actor, attributeName) {
        return this.list(actor).reduce((total, entry) => {
            if (typeof entry.item?.getAttributeBonus !== 'function') {
                return total;
            }
            const bonus = entry.item.getAttributeBonus(attributeName);
            return total + (Number.isFinite(Number(bonus)) ? Number(bonus) : 0);
        }, 0);
    }

    getStatusEffectContributions(actor) {
        return this.list(actor).flatMap(entry => {
            const effect = entry.item?.causeStatusEffectOnEquipper
                || (entry.item?.causeStatusEffect?.applyToEquipper ? entry.item.causeStatusEffect : null)
                || null;
            if (!effect || (!effect.description && !effect.name)) {
                return [];
            }
            return [{
                name: effect.name || null,
                description: effect.description || effect.text || effect.name || '',
                duration: effect.duration ?? null,
                attributes: Array.isArray(effect.attributes) ? effect.attributes : [],
                skills: Array.isArray(effect.skills) ? effect.skills : [],
                needBars: Array.isArray(effect.needBars) ? effect.needBars : []
            }];
        });
    }

    getActorStatusSection(actor, context = {}) {
        const installed = this.list(actor);
        if (!installed.length) {
            return null;
        }
        const label = this.getDisplayLabel(context);
        return {
            key: this.namespace,
            label,
            presentation: 'equipment',
            entries: installed.map(entry => ({
                slot: entry.slot,
                itemId: entry.itemId,
                itemName: entry.item.name,
                description: entry.item.shortDescription || entry.item.description || ''
            }))
        };
    }

    getDisplayLabel(context = {}) {
        const setting = context.setting || context.currentSetting || null;
        const configured = setting && typeof setting.getModSetting === 'function'
            ? setting.getModSetting(this.namespace, 'displayLabel', null)
            : setting?.modSettings?.[this.namespace]?.displayLabel;
        return typeof configured === 'string' && configured.trim()
            ? configured.trim()
            : this.displayLabel;
    }

    parseXmlRaw(raw) {
        if (typeof raw !== 'string' || !raw.trim()) {
            throw new Error(`${this.displayLabel} XML event payload is required.`);
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error(`${this.displayLabel} XML event payload must be an object.`);
        }
        return parsed;
    }
}

module.exports = ActorAttachmentSystem;
