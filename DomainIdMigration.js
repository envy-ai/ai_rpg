'use strict';

const IdGenerator = require('./IdGenerator.js');
const TechniqueService = require('./TechniqueService.js');

const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const list = value => Array.isArray(value) ? value : [];
const entries = value => value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : [];

/** Detached preparation for the explicitly requested running-world migration. */
class DomainIdMigration {
    static prepare(snapshot) {
        if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new TypeError('Domain ID migration requires a complete serialized world snapshot.');
        return IdGenerator.withIsolatedState(() => this.#prepare(structuredClone(snapshot)));
    }

    static #prepare(serialized) {
        const identities = new Map();
        const records = [];
        const derived = new Map();
        const replacements = new Map();
        const counts = {};
        const world = serialized.gameWorld || {};
        const definitions = new Map(list(serialized.techniques?.definitions).map(value => [value.id, value]));
        const locations = new Map(entries(world.locations).flatMap(([key, value]) => [[key, value], [value?.id, value]]));
        const add = (type, record, path, source, key = null) => {
            if (!record || typeof record !== 'object' || Array.isArray(record)) return;
            const aliases = [...new Set([text(record.id), text(key)].filter(Boolean))];
            if (!aliases.length) return; // Descriptive templates without IDs are not canonical records.
            let identity = null;
            for (const alias of aliases) {
                const found = identities.get(alias);
                if (found && found.type !== type) throw new Error(`${path}.id: ID "${alias}" is shared by ${found.type} (${found.path}) and ${type}. Give these records distinct IDs before migration; exact references cannot identify which object they mean.`);
                if (identity && found && identity !== found) throw new Error(`${path}.id: Supplied ID and map key identify different records. Repair their identity/reference mismatch before migration.`);
                identity ||= found;
            }
            if (!identity) {
                identity = { type, id: aliases[0], source, path, aliases: new Set(), records: [] };
                records.push(identity);
            }
            identity.records.push(record);
            for (const alias of aliases) { identity.aliases.add(alias); identities.set(alias, identity); }
        };
        const grants = (values, owner, path) => {
            for (const [index, grant] of list(values).entries()) {
                if (!grant || typeof grant !== 'object' || text(grant.id)?.startsWith('status_grant:')) continue;
                add('tgrant', grant, `${path}[${index}]`, definitions.get(grant.techniqueId)?.name ?? owner);
            }
        };
        const statuses = (values, path) => {
            for (const [index, status] of list(values).entries()) {
                if (!status || typeof status !== 'object') continue;
                add('status', status, `${path}[${index}]`, text(status.name) ?? status.description);
                grants(status.techniqueGrants, text(status.name) ?? status.description, `${path}[${index}].techniqueGrants`);
                for (const [grantIndex, option] of list(status.techniqueEntries).entries()) {
                    const optionPath = `${path}[${index}].techniqueEntries[${grantIndex}]`;
                    add('discipline', option?.candidateDiscipline, `${optionPath}.candidateDiscipline`, option?.candidateDiscipline?.name);
                    add('technique', option?.candidate, `${optionPath}.candidate`, option?.candidate?.name);
                    if (!text(option?.id)?.startsWith('status_grant:')) add('tgrant', option, optionPath, option?.candidate?.name ?? definitions.get(option?.techniqueId)?.name ?? text(status.name) ?? status.description);
                }
            }
        };
        const quests = (quest, path) => {
            add('quest', quest, path, quest?.name);
            for (const [index, objective] of list(quest?.objectives).entries()) add('obj', objective, `${path}.objectives[${index}]`, objective?.description);
        };
        const abilities = (values, path) => {
            const valuesList = Array.isArray(values) ? values : Object.values(values || {});
            for (const [index, ability] of valuesList.entries()) {
                add('ability', ability, `${path}[${index}]`, ability?.name);
                statuses(ability?.statusEffects, `${path}[${index}].statusEffects`);
            }
        };
        const maps = [
            ['char', serialized.players, 'players'], ['thing', serialized.things, 'things'],
            ['loc', world.locations, 'gameWorld.locations'], ['exit', world.locationExits, 'gameWorld.locationExits'],
            ['region', world.regions, 'gameWorld.regions'], ['faction', serialized.factions, 'factions'],
            ['mystery', serialized.mysteryBoxes, 'mysteryBoxes'], ['mthread', serialized.mysteryThreads, 'mysteryThreads'],
            ['sevent', serialized.scheduledEvents, 'scheduledEvents'], ['tracker', serialized.trackers, 'trackers']
        ];
        const exitSource = value => text(value?.description) ?? locations.get(value?.destination)?.name ?? value?.destination;
        for (const [type, values, path] of maps) for (const [key, record] of entries(values)) {
            const source = type === 'exit' ? exitSource(record) : type === 'sevent' ? text(record?.event) ?? record?.description : record?.name;
            add(type, record, `${path}.${key}`, source, key);
            statuses(record?.statusEffects, `${path}.${key}.statusEffects`);
        }
        for (const [key, actor] of entries(serialized.players)) {
            if (actor?.modState?.['story-authoring']?.storyBinding) throw new Error(`players.${key}.modState.story-authoring.storyBinding: Domain ID migration cannot update a bound Story's independent library references. Use a world without an active Story binding; no changes were applied.`);
            for (const [index, quest] of list(actor?.quests).entries()) quests(quest, `players.${key}.quests[${index}]`);
            abilities(actor?.abilities, `players.${key}.abilities`);
            abilities(actor?.declinedAbilities, `players.${key}.declinedAbilities`);
            for (const [level, options] of entries(actor?.pendingAbilityOptionsByLevel)) abilities(options, `players.${key}.pendingAbilityOptionsByLevel.${level}`);
            for (const [level, drafts] of entries(actor?.pendingAbilityAttachmentDraftsByLevel)) for (const [index, draft] of list(drafts).entries()) statuses(draft?.draft?.statusEffects, `players.${key}.pendingAbilityAttachmentDraftsByLevel.${level}[${index}].draft.statusEffects`);
        }
        for (const [key, thing] of entries(serialized.things)) {
            grants(thing?.techniqueGrants, thing?.name, `things.${key}.techniqueGrants`);
            for (const source of [thing, thing?.metadata]) for (const field of ['causeStatusEffects', 'causeStatusEffect', 'causeStatusEffectOnTarget', 'causeStatusEffectOnEquipper']) {
                const value = source?.[field];
                statuses(Array.isArray(value) ? value : [value], `things.${key}.${source === thing ? '' : 'metadata.'}${field}`);
            }
        }
        for (const [key, location] of entries(world.locations)) for (const [direction, exit] of entries(location?.exits)) {
            add('exit', exit, `gameWorld.locations.${key}.exits.${direction}`, exitSource(exit));
            add('exit', exit?.exitObject, `gameWorld.locations.${key}.exits.${direction}.exitObject`, exitSource(exit?.exitObject));
        }
        for (const [key, pending] of entries(serialized.pendingRegionStubs)) {
            add('region', pending && typeof pending === 'object' ? pending : { id: key }, `pendingRegionStubs.${key}`, pending?.name ?? pending?.regionName, key);
        }
        for (const [index, confirmation] of list(serialized.pendingQuestConfirmations).entries()) quests(confirmation?.quest, `pendingQuestConfirmations[${index}].quest`);
        for (const [index, discipline] of list(serialized.techniques?.disciplines).entries()) add('discipline', discipline, `techniques.disciplines[${index}]`, discipline?.name);
        for (const [index, definition] of list(serialized.techniques?.definitions).entries()) add('technique', definition, `techniques.definitions[${index}]`, definition?.name);
        // Receipt copies can be the only remaining named record for a removed
        // status. Historical removed actors/targets have no invented names.
        for (const [index, receipt] of list(serialized.techniques?.receipts).entries()) {
            for (const [effectIndex, effect] of list(receipt.effects).entries()) statuses([effect?.status], `techniques.receipts[${index}].effects[${effectIndex}].status`);
            for (const [effectIndex, effect] of list(receipt.display?.effects).entries()) statuses([effect?.status], `techniques.receipts[${index}].display.effects[${effectIndex}].status`);
        }

        IdGenerator.seedCounters(serialized.metadata?.idCounters ?? {});
        IdGenerator.seedNamedCounters(serialized.metadata?.idNameCounters === undefined ? {} : serialized.metadata.idNameCounters);
        for (const identity of records) for (const alias of identity.aliases) IdGenerator.register(identity.type, alias);
        for (const identity of records) {
            let stem;
            try { stem = IdGenerator.normalizeStem(identity.source); }
            catch (cause) { throw new Error(`${identity.path}: Cannot derive a ${identity.type} ID from its name/descriptive field. Supply nonempty text containing letters or numbers. ${cause.message}`, { cause }); }
            const base = `${identity.type}_${stem}`;
            const tail = identity.id.startsWith(`${base}_`) ? identity.id.slice(base.length + 1) : null;
            const conforms = identity.id === base || (tail !== null && /^[1-9]\d*$/u.test(tail) && Number.isSafeInteger(Number(tail)) && Number(tail) >= 2 && String(Number(tail)) === tail);
            const id = conforms ? identity.id : IdGenerator.next(identity.type, identity.source);
            for (const alias of identity.aliases) if (alias !== id) replacements.set(alias, id);
            if (id !== identity.id) counts[identity.type] = (counts[identity.type] || 0) + 1;
        }

        const mapped = id => replacements.get(id) ?? id;
        const derive = (oldId, newId) => {
            if (oldId === newId) return;
            if (derived.has(oldId) && derived.get(oldId) !== newId) throw new Error(`Derived identity ${oldId} has conflicting migrated targets; repair its source references before migration.`);
            derived.set(oldId, newId);
        };
        for (const identity of records) if (identity.type === 'technique') for (const alias of identity.aliases) derive(`learned:${alias}`, `learned:${mapped(alias)}`);
        for (const identity of records) if (identity.type === 'quest') for (const quest of identity.records) {
            for (const benefit of list(quest.rewardBenefits)) {
                if (benefit.type === 'party-member' && benefit.id === `party-member:${benefit.targetId}`) derive(benefit.id, `party-member:${mapped(benefit.targetId)}`);
                if (benefit.type === 'knowledge' && benefit.subtype === 'route') derive(`knowledge-route:${benefit.sourceLocationId}:${benefit.targetId}`, `knowledge-route:${mapped(benefit.sourceLocationId)}:${mapped(benefit.targetId)}`);
            }
        }
        const statusGrantIds = new Map();
        for (const identity of records) if (identity.type === 'status') for (const record of identity.records) {
            for (const [index, grant] of list(record.techniqueGrants).entries()) {
                const oldId = grant.id ?? `status_grant:${record.id}:${index}`;
                const prefix = `status_grant:${record.id}:`;
                const newId = oldId.startsWith(prefix) ? `status_grant:${mapped(record.id)}:${oldId.slice(prefix.length)}` : mapped(oldId);
                derive(oldId, newId);
                statusGrantIds.set(oldId, newId);
            }
            for (const option of list(record.techniqueEntries)) {
                const prefix = `status_grant:${record.id}:`;
                if (typeof option?.id === 'string' && option.id.startsWith(prefix)) derive(option.id, `status_grant:${mapped(record.id)}:${option.id.slice(prefix.length)}`);
            }
        }
        for (const [key, thing] of entries(serialized.things)) {
            const itemId = thing.id ?? key;
            const meta = thing.metadata || {};
            const plural = list(thing.causeStatusEffects ?? meta.causeStatusEffects).filter(effect => effect?.applyToEquipper);
            const single = thing.causeStatusEffectOnEquipper ?? meta.causeStatusEffectOnEquipper;
            const legacy = thing.causeStatusEffect ?? meta.causeStatusEffect;
            const effects = plural.length ? plural : single ? [single] : legacy?.applyToEquipper ? [legacy] : [];
            for (const [index, effect] of effects.entries()) {
                derive(`equipped_status:${itemId}:${effect.id ?? index}`, `equipped_status:${mapped(itemId)}:${mapped(effect.id) ?? index}`);
                for (const grant of list(effect.techniqueGrants)) derive(`equipped_grant:${itemId}:${grant.id}`, `equipped_grant:${mapped(itemId)}:${derived.get(grant.id) ?? mapped(grant.id)}`);
            }
        }
        const actorSources = (actorId, values) => {
            for (const status of list(values)) for (const [index, grant] of list(status?.techniqueGrants).entries()) {
                const grantId = grant.id ?? `status_grant:${status.id}:${index}`;
                derive(`status:${actorId}:${grantId}`, `status:${mapped(actorId)}:${statusGrantIds.get(grantId) ?? mapped(grantId)}`);
            }
        };
        for (const [key, actor] of entries(serialized.players)) {
            const actorId = actor.id ?? key;
            actorSources(actorId, actor.statusEffects);
            for (const collection of [actor.abilities, actor.declinedAbilities, ...Object.values(actor.pendingAbilityOptionsByLevel || {})]) {
                for (const ability of Array.isArray(collection) ? collection : Object.values(collection || {})) {
                    actorSources(actorId, ability?.statusEffects);
                    if (ability?.id) derive(`${actorId}:${ability.id}`, `${mapped(actorId)}:${mapped(ability.id)}`);
                }
            }
            for (const drafts of Object.values(actor.pendingAbilityAttachmentDraftsByLevel || {})) for (const draft of list(drafts)) actorSources(actorId, draft?.draft?.statusEffects);
        }
        for (const receipt of list(serialized.techniques?.receipts)) {
            const source = receipt.source;
            if (source?.sourceKind === 'learned') derive(source.sourceId, `learned:${mapped(receipt.techniqueId)}`);
            if (source?.sourceKind === 'status') {
                const prefix = `status:${receipt.actorId}:`;
                if (typeof source.sourceId !== 'string' || !source.sourceId.startsWith(prefix)) throw new Error(`Technique receipt ${receipt.operationId}.source.sourceId: Status source does not match its actor. Repair the original source identity before migration.`);
                const grantId = source.sourceId.slice(prefix.length);
                let newGrantId = derived.get(grantId) ?? mapped(grantId);
                if (grantId.startsWith(`status_grant:${source.statusId}:`)) newGrantId = `status_grant:${mapped(source.statusId)}:${grantId.slice(`status_grant:${source.statusId}:`.length)}`;
                derive(source.sourceId, `status:${mapped(receipt.actorId)}:${newGrantId}`);
                derive(grantId, newGrantId);
            }
            for (const effect of list(receipt.effects)) if (effect.mutationId) derive(effect.mutationId, `${receipt.operationId}:effect:${mapped(effect.targetId)}:${effect.effectId}`);
        }
        for (const [oldId, newId] of derived) {
            if (replacements.has(oldId) && replacements.get(oldId) !== newId) throw new Error(`Derived identity ${oldId} conflicts with a canonical object ID. Give these identities distinct values before migration.`);
        }
        const protectedField = key => /(?:name|title|description|prose|summary|text|content|event|events|keys|guidance|role|plan|steps|memories|secrets|class|race|attribute|skill|needId|resource|reason|intent|instruction|instructions|prompt|note|notes|label|goal|goals|directive|directives|stack|error|aliases|constraints|semanticKey|operationId|turnId|requestId|parentId|confirmationId|chatEntryId|arrivalId|imageId|imagePrompt|filename|filePath|worldLineageId|runtimeMechanicsFingerprint|effectId|evidenceIds|usedBy)$/iu.test(key);
        const rewrite = (value, path = [], field = '') => {
            if (typeof value === 'string') return protectedField(field) ? value : (derived.get(value) ?? mapped(value));
            if (!value || typeof value !== 'object') return value;
            if (path.length === 2 && path[0] === 'metadata' && ['idCounters', 'idNameCounters'].includes(path[1])) return value;
            if (Array.isArray(value)) return value.map(child => rewrite(child, path, field));
            const result = {};
            for (const [key, child] of Object.entries(value)) {
                const operationalId = key === 'id' && path.length === 1 && ['chatHistory', 'skills', 'setting', 'generatedImages'].includes(path[0]);
                const nextKey = derived.get(key) ?? mapped(key);
                if (Object.hasOwn(result, nextKey)) throw new Error(`${path.join('.')}: Migrating map key ${key} would overwrite ${nextKey}. Repair duplicate identity keys before migration.`);
                Object.defineProperty(result, nextKey, { value: operationalId ? child : rewrite(child, [...path, key], key), enumerable: true, configurable: true, writable: true });
            }
            return result;
        };
        const result = rewrite(serialized);
        result.metadata ??= {};
        result.metadata.idCounters = IdGenerator.snapshotCounters();
        result.metadata.idNameCounters = IdGenerator.snapshotNamedCounters();
        TechniqueService.validateState(result.techniques, { actors: Object.values(result.players || {}), things: Object.values(result.things || {}) });
        return { serialized: result, counts, replacements: Object.fromEntries(replacements) };
    }
}

module.exports = DomainIdMigration;
