const Globals = require('./Globals.js');
const ThingFieldRegistry = require('./ThingFieldRegistry.js');

const cloneJsonish = (value) => {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
};

class ThingMutationService {
    constructor({
        ThingClass = null,
        getModExtensionRegistry = null,
        fieldRegistry = null
    } = {}) {
        this.Thing = ThingClass || require('./Thing.js');
        this.getModExtensionRegistry = typeof getModExtensionRegistry === 'function'
            ? getModExtensionRegistry
            : () => Globals.modExtensionRegistry || null;
        this.fields = fieldRegistry || new ThingFieldRegistry({
            getModExtensionRegistry: this.getModExtensionRegistry
        });
    }

    prepareCreate(data, { constraints = null } = {}) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw new TypeError('Thing creation data must be an object.');
        }
        let candidateData = cloneJsonish(data);
        let normalizedConstraints = {};
        if (constraints) {
            const persistedConstraints = { ...cloneJsonish(constraints) };
            delete persistedConstraints.notes;
            const applied = this.fields.applyPatchToData(candidateData, persistedConstraints, {
                filter: { exposeToCreateTool: true },
                allowUnknown: false
            });
            candidateData = applied.data;
            normalizedConstraints = applied.normalizedPatch;
        }
        delete candidateData.id;
        delete candidateData.createdAt;
        delete candidateData.lastUpdated;
        const candidate = this.Thing.fromJSON(candidateData, { register: false });
        this.validateCandidate(candidate, { operation: 'create', constraints: normalizedConstraints });
        return { candidate, constraints: normalizedConstraints };
    }

    prepareCreateBatch(entries, options = {}) {
        if (!Array.isArray(entries)) {
            throw new TypeError('Thing batch creation entries must be an array.');
        }
        return entries.map((entry, index) => {
            try {
                const data = entry?.data !== undefined ? entry.data : entry;
                const constraints = entry?.data !== undefined ? (entry.constraints || null) : (options.constraints || null);
                return this.prepareCreate(data, { constraints });
            } catch (error) {
                error.message = `Thing batch candidate ${index + 1} failed validation: ${error.message}`;
                throw error;
            }
        });
    }

    prepareUpdate(existingThing, patch, { operation = 'update', filter = { exposeToUpdateTool: true } } = {}) {
        this.#requireLiveThing(existingThing, operation);
        const before = cloneJsonish(existingThing.toJSON());
        const applied = this.fields.applyPatchToData(before, patch, { filter });
        const candidate = this.Thing.fromJSON(applied.data, { register: false });
        this.validateCandidate(candidate, { operation, patch: applied.normalizedPatch, existingThing });
        return {
            before,
            candidate,
            patch: applied.normalizedPatch
        };
    }

    prepareReplacement(existingThing, generatedData, constraints = {}, { preservePlacement = true } = {}) {
        this.#requireLiveThing(existingThing, 'recreate');
        if (typeof preservePlacement !== 'boolean') {
            throw new TypeError('Thing replacement preservePlacement must be a boolean.');
        }
        if (!generatedData || typeof generatedData !== 'object' || Array.isArray(generatedData)) {
            throw new TypeError('Thing replacement generated data must be an object.');
        }
        const before = cloneJsonish(existingThing.toJSON());
        const preserved = {
            id: before.id,
            createdAt: before.createdAt,
            containedThingIds: before.containedThingIds || [],
            metadata: {
                ...(generatedData.metadata || {}),
                ...(preservePlacement ? this.#placementMetadata(before.metadata || {}) : {})
            }
        };
        let candidateData = {
            ...before,
            ...cloneJsonish(generatedData),
            ...preserved
        };
        const applied = this.fields.applyPatchToData(candidateData, constraints, {
            filter: { exposeToCreateTool: true },
            allowUnknown: false
        });
        candidateData = applied.data;
        candidateData.id = before.id;
        candidateData.createdAt = before.createdAt;
        candidateData.containedThingIds = before.containedThingIds || [];
        const candidate = this.Thing.fromJSON(candidateData, { register: false });
        this.validateCandidate(candidate, {
            operation: 'recreate',
            constraints: applied.normalizedPatch,
            existingThing
        });
        return { before, candidate, constraints: applied.normalizedPatch };
    }

    validateCandidate(candidate, context = {}) {
        if (!(candidate instanceof this.Thing)) {
            throw new TypeError('Thing candidate validation requires a Thing instance.');
        }
        const candidateLabel = candidate.name || candidate.id || 'unnamed Thing';
        if (typeof candidate.name !== 'string' || !candidate.name.trim()) {
            throw new Error(`Thing candidate "${candidateLabel}" must have a nonblank name.`);
        }
        if (typeof candidate.description !== 'string' || !candidate.description.trim()) {
            throw new Error(`Thing candidate "${candidateLabel}" must have a nonblank description.`);
        }
        if (!['item', 'scenery'].includes(candidate.thingType)) {
            throw new Error(
                `Thing candidate "${candidateLabel}" has invalid thingType ${JSON.stringify(candidate.thingType)}.`
            );
        }
        if (
            Array.isArray(candidate.containedThingIds)
            && candidate.containedThingIds.length
            && candidate.isContainer !== true
        ) {
            throw new Error(
                `Thing candidate "${candidateLabel}" has containedThingIds but isContainer is not true.`
            );
        }
        const registry = this.getModExtensionRegistry();
        if (registry && typeof registry.validateEntity === 'function') {
            registry.validateEntity('thing', candidate, context);
        }
        return candidate;
    }

    commitCreate(prepared, { runtimeRegistry = null } = {}) {
        const candidate = prepared?.candidate;
        this.validateCandidate(candidate, { operation: 'create-commit' });
        const data = cloneJsonish(candidate.toJSON());
        delete data.id;
        delete data.createdAt;
        delete data.lastUpdated;
        const thing = this.Thing.fromJSON(data, { register: true });
        if (runtimeRegistry instanceof Map) {
            runtimeRegistry.set(thing.id, thing);
        }
        return {
            thing,
            receipt: this.#receipt({
                operation: 'create',
                thing,
                before: null,
                after: thing.toJSON(),
                changedFields: Object.keys(thing.toJSON())
            })
        };
    }

    commitCreateBatch(preparedEntries, { runtimeRegistry = null } = {}) {
        if (!Array.isArray(preparedEntries)) {
            throw new TypeError('Thing batch commit requires an array of prepared candidates.');
        }
        preparedEntries.forEach((prepared, index) => {
            try {
                this.validateCandidate(prepared?.candidate, { operation: 'create-batch-commit', batchIndex: index });
            } catch (error) {
                error.message = `Thing batch candidate ${index + 1} failed commit validation: ${error.message}`;
                throw error;
            }
        });

        const committed = [];
        try {
            for (const prepared of preparedEntries) {
                committed.push(this.commitCreate(prepared, { runtimeRegistry }));
            }
            return committed;
        } catch (error) {
            for (const entry of committed.reverse()) {
                if (runtimeRegistry instanceof Map && entry.thing?.id) {
                    runtimeRegistry.delete(entry.thing.id);
                }
                if (entry.thing && typeof entry.thing.delete === 'function') {
                    entry.thing.delete();
                }
            }
            throw error;
        }
    }

    commitUpdate(existingThing, prepared, { operation = 'update' } = {}) {
        this.#requireLiveThing(existingThing, operation);
        if (!prepared || !(prepared.candidate instanceof this.Thing)) {
            throw new TypeError(`Thing ${operation} commit requires a prepared candidate.`);
        }
        this.validateCandidate(prepared.candidate, { operation: `${operation}-commit`, existingThing });
        const before = cloneJsonish(prepared.before || existingThing.toJSON());
        existingThing.replaceStateFrom(prepared.candidate, { preserveCreatedAt: true });
        const after = cloneJsonish(existingThing.toJSON());
        return {
            thing: existingThing,
            receipt: this.#receipt({
                operation,
                thing: existingThing,
                before,
                after,
                changedFields: this.#changedFields(before, after)
            })
        };
    }

    commitReplacement(existingThing, prepared) {
        return this.commitUpdate(existingThing, prepared, { operation: 'recreate' });
    }

    audit(things, { warn = console.warn } = {}) {
        const entries = Array.isArray(things)
            ? things
            : (things instanceof Map ? Array.from(things.values()) : []);
        const failures = [];
        for (const thing of entries.filter(Boolean)) {
            try {
                this.validateCandidate(thing, { operation: 'hydration-audit', readOnly: true });
            } catch (error) {
                const failure = {
                    thingId: thing.id || null,
                    thingName: thing.name || null,
                    message: error?.message || String(error)
                };
                failures.push(failure);
                warn(`[ThingValidationAudit] ${failure.thingName || 'Unknown Thing'} (${failure.thingId || 'no id'}): ${failure.message}`);
            }
        }
        return failures;
    }

    #requireLiveThing(thing, operation) {
        if (!(thing instanceof this.Thing) || !thing.id) {
            throw new TypeError(`Thing ${operation} requires a registered Thing with an id.`);
        }
    }

    #placementMetadata(metadata) {
        const placementKeys = new Set([
            'location', 'locationId', 'locationID', 'location_id', 'locationName',
            'owner', 'ownerId', 'ownerID', 'owner_id', 'playerId', 'playerID', 'player_id',
            'inventoryOwnerId', 'inventory_owner_id', 'containerId', 'containerID', 'container_id'
        ]);
        return Object.fromEntries(
            Object.entries(metadata || {})
                .filter(([key]) => placementKeys.has(key))
                .map(([key, value]) => [key, cloneJsonish(value)])
        );
    }

    #changedFields(before, after) {
        const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
        return Array.from(keys).filter(key => (
            JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key])
        ));
    }

    #receipt({ operation, thing, before, after, changedFields }) {
        return {
            operation,
            thingId: thing?.id || null,
            beforeChecksum: before ? this.#checksumForData(before) : null,
            afterChecksum: thing?.checksum || this.#checksumForData(after),
            changedFields: [...(changedFields || [])],
            placementBefore: before ? this.#placementMetadata(before.metadata || {}) : null,
            placementAfter: after ? this.#placementMetadata(after.metadata || {}) : null,
            createdIds: operation === 'create' && thing?.id ? [thing.id] : [],
            replacedIds: operation === 'recreate' && thing?.id ? [thing.id] : [],
            deletedIds: [],
            committedAt: new Date().toISOString(),
            committed: true
        };
    }

    #checksumForData(data) {
        try {
            const candidate = this.Thing.fromJSON(data, { register: false });
            return candidate.checksum;
        } catch (_) {
            return null;
        }
    }
}

module.exports = ThingMutationService;
