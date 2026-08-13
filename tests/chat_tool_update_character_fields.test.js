const test = require('node:test');
const assert = require('node:assert/strict');

const {
    CHAT_TOOL_DEFINITIONS,
    createChatToolRuntime,
    getChatToolDefinitions
} = require('../chat_tool_calls.js');
const ModExtensionRegistry = require('../ModExtensionRegistry.js');

function findToolDefinition(name) {
    return CHAT_TOOL_DEFINITIONS.find(entry => entry?.function?.name === name)?.function || null;
}

function makeNpc(overrides = {}) {
    return {
        id: overrides.id || 'npc-1',
        name: overrides.name || 'Neka',
        isNPC: overrides.isNPC ?? true,
        currentLocation: overrides.currentLocation || 'loc-1',
        description: overrides.description || 'Original description.',
        shortDescription: overrides.shortDescription || '',
        race: overrides.race || 'human',
        class: overrides.class || 'scout',
        gender: overrides.gender || 'female',
        level: overrides.level || 2,
        health: overrides.health || 10,
        healthAttribute: overrides.healthAttribute || 'Vigor',
        currency: overrides.currency || 0,
        experience: overrides.experience || 0,
        isDead: Boolean(overrides.isDead),
        isHostile: Boolean(overrides.isHostile),
        factionId: overrides.factionId || null,
        aliases: Array.isArray(overrides.aliases) ? overrides.aliases : [],
        personalityType: overrides.personalityType || '',
        personalityTraits: overrides.personalityTraits || '',
        personalityNotes: overrides.personalityNotes || '',
        aiNotes: overrides.aiNotes || '',
        resistances: overrides.resistances || '',
        vulnerabilities: overrides.vulnerabilities || '',
        attributes: { ...(overrides.attributes || { Vigor: 10, Wits: 10 }) },
        skills: { ...(overrides.skills || { Medicine: 1, Stealth: 1 }) },
        statusEffects: Array.isArray(overrides.statusEffects) ? overrides.statusEffects : [],
        needBarApplicability: { ...(overrides.needBarApplicability || {}) },
        relationships: { ...(overrides.relationships || {}) },
        willingToTrade: overrides.willingToTrade ?? true,
        setName(value) {
            this.name = String(value).trim();
            return this.name;
        },
        setAliases(value) {
            this.aliases = Array.from(value);
            return this.aliases;
        },
        setLevel(value) {
            this.level = value;
            return { level: value };
        },
        setHealth(value) {
            this.health = value;
            return this.health;
        },
        setHealthAttribute(value) {
            this.healthAttribute = value;
            return this.healthAttribute;
        },
        setCurrency(value) {
            this.currency = value;
            return this.currency;
        },
        setExperience(value) {
            this.experience = value;
            return this.experience;
        },
        setAttribute(name, value) {
            this.attributes[name] = value;
            return { attribute: name, newValue: value };
        },
        setSkillValue(name, value) {
            this.skills[name] = value;
            return true;
        },
        setStatusEffects(value) {
            this.statusEffects = Array.from(value);
            return this.statusEffects;
        },
        setNeedBarApplicability(value) {
            this.needBarApplicability = { ...value };
            return this.needBarApplicability;
        },
        setRelationships(value) {
            this.relationships = { ...value };
            return this.relationships;
        },
        setWillingToTrade(value) {
            this.willingToTrade = Boolean(value);
            return this.willingToTrade;
        },
        toJSON() {
            return {
                id: this.id,
                name: this.name,
                isNPC: this.isNPC,
                currentLocation: this.currentLocation,
                description: this.description,
                aliases: this.aliases,
                aiNotes: this.aiNotes,
                relationships: this.relationships,
                attributes: this.attributes,
                skills: this.skills,
                statusEffects: this.statusEffects
            };
        }
    };
}

function makeThing(overrides = {}) {
    return {
        id: overrides.id || 'thing-1',
        name: overrides.name || 'Copper Token',
        description: overrides.description || 'A dull token.',
        shortDescription: overrides.shortDescription || '',
        thingType: overrides.thingType || 'item',
        rarity: overrides.rarity || 'common',
        itemTypeDetail: overrides.itemTypeDetail || '',
        count: overrides.count ?? 1,
        level: overrides.level ?? 1,
        relativeLevel: overrides.relativeLevel ?? 0,
        metadata: { ...(overrides.metadata || {}) },
        extensionFields: { ...(overrides.extensionFields || {}) },
        setExtensionField(fieldName, value) {
            this.extensionFields[fieldName] = value;
        },
        getExtensionField(fieldName) {
            return this.extensionFields[fieldName];
        },
        setStatusEffects(value) {
            this.statusEffects = Array.from(value);
            return this.statusEffects;
        },
        toJSON() {
            return {
                id: this.id,
                name: this.name,
                description: this.description,
                shortDescription: this.shortDescription,
                thingType: this.thingType,
                rarity: this.rarity,
                itemTypeDetail: this.itemTypeDetail,
                count: this.count,
                level: this.level,
                relativeLevel: this.relativeLevel,
                metadata: this.metadata,
                statusEffects: this.statusEffects || []
            };
        }
    };
}

function makeLocation(overrides = {}) {
    return {
        id: overrides.id || 'loc-1',
        name: overrides.name || 'Study',
        description: overrides.description || 'Original location description.',
        shortDescription: overrides.shortDescription || '',
        baseLevel: overrides.baseLevel ?? 1,
        visited: overrides.visited ?? false,
        lastVisitedTime: overrides.lastVisitedTime ?? null,
        generationHints: {
            numItems: null,
            numScenery: null,
            numNpcs: null,
            numHostiles: null,
            hasWeather: null,
            ...(overrides.generationHints || {})
        },
        imageVariants: { ...(overrides.imageVariants || {}) },
        imageVariantClearCount: 0,
        exits: overrides.exits || {},
        getAvailableDirections() {
            return Object.keys(this.exits);
        },
        getExit(direction) {
            return this.exits[direction] || null;
        },
        setStatusEffects(value) {
            this.statusEffects = Array.from(value);
            return this.statusEffects;
        },
        clearImageVariants() {
            this.imageVariants = {};
            this.imageVariantClearCount += 1;
            return [];
        },
        toJSON() {
            return {
                id: this.id,
                name: this.name,
                description: this.description,
                shortDescription: this.shortDescription,
                baseLevel: this.baseLevel,
                visited: this.visited,
                lastVisitedTime: this.lastVisitedTime,
                generationHints: this.generationHints,
                imageVariants: this.imageVariants,
                exits: this.exits,
                statusEffects: this.statusEffects || []
            };
        }
    };
}

function makeRegion(overrides = {}) {
    return {
        id: overrides.id || 'region-1',
        name: overrides.name || 'Manor',
        description: overrides.description || 'Original region description.',
        shortDescription: overrides.shortDescription || '',
        relativeLevel: overrides.relativeLevel ?? 0,
        locationIds: overrides.locationIds || ['loc-1'],
        setAverageLevel(value) {
            this.averageLevel = value;
            return this.averageLevel;
        },
        setStatusEffects(value) {
            this.statusEffects = Array.from(value);
            return this.statusEffects;
        },
        toJSON() {
            return {
                id: this.id,
                name: this.name,
                description: this.description,
                shortDescription: this.shortDescription,
                relativeLevel: this.relativeLevel,
                locationIds: this.locationIds,
                statusEffects: this.statusEffects || []
            };
        }
    };
}

function makeFaction(overrides = {}) {
    return {
        id: overrides.id || 'faction-1',
        name: overrides.name || 'The Guild',
        description: overrides.description || 'Original faction description.',
        shortDescription: overrides.shortDescription || '',
        tags: Array.isArray(overrides.tags) ? overrides.tags : [],
        goals: Array.isArray(overrides.goals) ? overrides.goals : [],
        toJSON() {
            return {
                id: this.id,
                name: this.name,
                description: this.description,
                shortDescription: this.shortDescription,
                tags: this.tags,
                goals: this.goals
            };
        }
    };
}

function makeQuest(overrides = {}) {
    const objective = overrides.objective || {
        id: 'objective-1',
        description: 'Find the key.',
        completed: false,
        optional: false,
        toJSON() {
            return {
                id: this.id,
                description: this.description,
                completed: this.completed,
                optional: this.optional
            };
        }
    };
    return {
        id: overrides.id || 'quest-1',
        name: overrides.name || 'Door Trouble',
        description: overrides.description || 'Open the locked door.',
        objectives: [objective],
        rewardCurrency: overrides.rewardCurrency ?? 0,
        rewardXp: overrides.rewardXp ?? 0,
        rewardItems: [],
        rewardFactionReputation: {},
        rewardClaimed: false,
        secretNotes: '',
        paused: false,
        toJSON() {
            return {
                id: this.id,
                name: this.name,
                description: this.description,
                objectives: this.objectives.map(entry => (typeof entry.toJSON === 'function' ? entry.toJSON() : entry)),
                rewardCurrency: this.rewardCurrency,
                rewardXp: this.rewardXp,
                rewardItems: this.rewardItems,
                rewardFactionReputation: this.rewardFactionReputation,
                rewardClaimed: this.rewardClaimed,
                secretNotes: this.secretNotes,
                paused: this.paused
            };
        }
    };
}

function makeRuntime({
    npc = makeNpc(),
    firstResponse,
    player = null,
    things = [],
    locations = null,
    regions = null,
    factions = [],
    modExtensionRegistry = null,
    onChatCompletionOptions = null,
    regenerateShortDescription = async ({ objectType }) => `Generated ${objectType} summary.`
}) {
    const locationList = locations || [makeLocation()];
    const regionList = regions || [makeRegion({ locationIds: locationList.map(location => location.id) })];
    const location = locationList[0];
    const region = regionList[0];
    const currentPlayer = player || { id: 'player-1', name: 'Player', isNPC: false, currentLocation: location.id };
    const llmResponses = [
        firstResponse,
        {
            data: {
                choices: [{
                    message: {
                        content: 'Done.',
                        tool_calls: []
                    }
                }]
            }
        }
    ];

    return createChatToolRuntime({
        getConfig: () => ({ ai: { max_tool_rounds: 3 } }),
        getChatHistory: () => [],
        isAssistantProseLikeEntry: () => true,
        serializeNpcForClient: value => value,
        buildLocationResponse: value => value,
        getCurrentPlayer: () => currentPlayer,
        createLocationFromEvent: async () => location,
        createRegionStubFromEvent: async () => region,
        generateItemsByNames: async () => [],
        ensureExitConnection: async () => ({}),
        findRegionByLocationId: () => region,
        LLMClient: {
            async chatCompletion(options) {
                onChatCompletionOptions?.(options);
                const response = llmResponses.shift();
                assert.ok(response, 'Expected a queued LLM response.');
                options.onResponse?.(response);
                return response.data.choices[0].message.content || '';
            },
            logPrompt() {},
            formatMessagesForErrorLog(messages) {
                return JSON.stringify(messages);
            }
        },
        Player: { getAll: () => [currentPlayer, npc].filter(Boolean) },
        Thing: { getAll: () => things },
        Location: { get: id => locationList.find(entry => entry.id === id) || null, getAll: () => locationList },
        Region: { getAll: () => regionList },
        getGameLocations: () => new Map(locationList.map(entry => [entry.id, entry])),
        getFactions: () => new Map(factions.map(entry => [entry.id, entry])),
        getRegionsMap: () => new Map(regionList.map(entry => [entry.id, entry])),
        getPendingRegionStubs: () => new Map(),
        clearLocationImageVariants: targetLocation => targetLocation.clearImageVariants(),
        regenerateShortDescription,
        getModExtensionRegistry: () => modExtensionRegistry
    });
}

function toolResponse(args, functionName = 'updateCharacterFields') {
    return {
        data: {
            choices: [{
                message: {
                    content: '',
                    tool_calls: [{
                        id: `call-${functionName}`,
                        type: 'function',
                        function: {
                            name: functionName,
                            arguments: JSON.stringify(args)
                        }
                    }]
                }
            }]
        }
    };
}

test('updateCharacterFields tool schema exists', () => {
    const tool = findToolDefinition('updateCharacterFields');
    assert.ok(tool, 'updateCharacterFields tool definition should exist');
    assert.deepEqual(tool.parameters.required, ['character', 'fields']);
    assert.equal(tool.parameters.properties.character.type, 'string');
    assert.equal(tool.parameters.properties.fields.type, 'object');
});

test('updateObjectFields tool schema exists', () => {
    const tool = findToolDefinition('updateObjectFields');
    assert.ok(tool, 'updateObjectFields tool definition should exist');
    assert.deepEqual(tool.parameters.required, ['objectType', 'object', 'fields']);
    assert.equal(tool.parameters.properties.objectType.type, 'string');
    assert.ok(tool.parameters.properties.objectType.enum.includes('thing'));
    assert.ok(tool.parameters.properties.objectType.enum.includes('quest'));
    assert.equal(tool.parameters.properties.object.type, 'string');
    assert.equal(tool.parameters.properties.fields.type, 'object');
    assert.match(tool.description, /For locations, hasWeather accepts "yes", "no", "sheltered", or null/);
});

test('ordinary tool schemas hide direct short-description updates while generic admin schemas retain them', () => {
    const ordinaryTools = getChatToolDefinitions();
    const adminTools = getChatToolDefinitions({ allowDirectShortDescriptionUpdates: true });
    for (const toolName of ['updateCharacterFields', 'updateObjectFields', 'upsertFactionFields']) {
        const ordinary = ordinaryTools.find(entry => entry?.function?.name === toolName)?.function;
        const admin = adminTools.find(entry => entry?.function?.name === toolName)?.function;
        assert.ok(ordinary, `Expected ordinary ${toolName} schema.`);
        assert.ok(admin, `Expected admin ${toolName} schema.`);
        assert.doesNotMatch(ordinary.description, /shortDescription/);
        if (toolName === 'updateObjectFields') {
            assert.match(ordinary.description, /automatically refreshes its concise summary/);
            assert.doesNotMatch(admin.description, /automatically refreshes its concise summary/);
        } else {
            assert.match(admin.description, /shortDescription/);
        }
    }
});

test('ordinary execution rejects direct short-description updates and generic admin execution accepts them', async () => {
    const restrictedNpc = makeNpc({ shortDescription: 'Original short.' });
    const restrictedRuntime = makeRuntime({
        npc: restrictedNpc,
        firstResponse: toolResponse({
            character: restrictedNpc.name,
            fields: { shortDescription: 'Rejected direct summary.' }
        })
    });
    const restrictedResult = await restrictedRuntime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: 'Update Neka.' }] },
        metadataLabel: 'test_restricted_short_description_update'
    });
    assert.equal(restrictedResult.toolInvocations[0].metadata.code, 'unsupported_field');
    assert.equal(restrictedNpc.shortDescription, 'Original short.');

    const adminNpc = makeNpc({ shortDescription: 'Original short.' });
    const adminRuntime = makeRuntime({
        npc: adminNpc,
        firstResponse: toolResponse({
            character: adminNpc.name,
            fields: { shortDescription: 'Accepted direct summary.' }
        })
    });
    const adminResult = await adminRuntime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: '@Update Neka.' }] },
        metadataLabel: 'test_admin_short_description_update',
        allowDirectShortDescriptionUpdates: true
    });
    assert.equal(adminResult.toolInvocations[0].metadata.status, 'success');
    assert.equal(adminNpc.shortDescription, 'Accepted direct summary.');
});

test('tool-loop validation rejects a tool call before it can mutate state', async () => {
    const thing = makeThing({ description: 'Original description.', shortDescription: 'Original short.' });
    const completionOptions = [];
    const runtime = makeRuntime({
        firstResponse: toolResponse({
            objectType: 'thing',
            object: thing.id,
            fields: {
                shortDescription: 'Unplanned short description.'
            }
        }, 'updateObjectFields'),
        things: [thing],
        onChatCompletionOptions: options => completionOptions.push({
            tool_choice: options.tool_choice,
            additionalPayload: options.additionalPayload
                ? structuredClone(options.additionalPayload)
                : undefined
        })
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: '@Update the thing.' }] },
        metadataLabel: 'test_pre_execution_tool_validation',
        validateToolCall: toolCall => {
            assert.equal(toolCall.name, 'updateObjectFields');
            assert.deepEqual(toolCall.argumentsObject.fields, {
                shortDescription: 'Unplanned short description.'
            });
            throw new Error('The field is not in the accepted structured plan.');
        }
    });

    assert.equal(thing.description, 'Original description.');
    assert.equal(thing.shortDescription, 'Original short.');
    assert.equal(result.toolInvocations.length, 1);
    assert.equal(result.toolInvocations[0].metadata.error, true);
    assert.match(result.toolInvocations[0].metadata.message, /accepted structured plan/i);
    assert.deepEqual(result.toolInvocations[0].argumentsObject.fields, {
        shortDescription: 'Unplanned short description.'
    });
    assert.equal(completionOptions[0].tool_choice, undefined);
    assert.equal(completionOptions[0].additionalPayload, undefined);
    assert.equal(completionOptions[1].tool_choice, undefined);
});

test('updateCharacterFields applies allowed scalar and map fields directly to an NPC', async () => {
    const npc = makeNpc();
    const runtime = makeRuntime({
        npc,
        firstResponse: toolResponse({
            character: 'Neka',
            fields: {
                description: 'Now wears a patched hazard coat.',
                aiNotes: 'Use her as a careful field medic.',
                aliases: ['Patch'],
                attributes: { Vigor: 13 },
                skills: { Medicine: 6 },
                currency: 25,
                willingToTrade: false
            }
        })
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: '@Update Neka.' }] },
        metadataLabel: 'test_update_character_fields'
    });

    assert.equal(result.rounds, 2);
    assert.equal(npc.description, 'Now wears a patched hazard coat.');
    assert.equal(npc.shortDescription, 'Generated character summary.');
    assert.equal(npc.aiNotes, 'Use her as a careful field medic.');
    assert.deepEqual(npc.aliases, ['Patch']);
    assert.equal(npc.attributes.Vigor, 13);
    assert.equal(npc.skills.Medicine, 6);
    assert.equal(npc.currency, 25);
    assert.equal(npc.willingToTrade, false);
    assert.equal(result.toolInvocations[0].metadata.status, 'success');
    assert.equal(result.toolInvocations[0].metadata.npcId, npc.id);
    assert.deepEqual(result.toolInvocations[0].metadata.updatedFields, [
        'description',
        'aiNotes',
        'aliases',
        'attributes.Vigor',
        'skills.Medicine',
        'currency',
        'willingToTrade',
        'shortDescription'
    ]);
});

test('description updates remain atomic when short-description generation fails', async () => {
    const npc = makeNpc({
        description: 'Original description.',
        shortDescription: 'Original short.'
    });
    const runtime = makeRuntime({
        npc,
        firstResponse: toolResponse({
            character: npc.name,
            fields: {
                description: 'A description that must not be applied alone.'
            }
        }),
        regenerateShortDescription: async () => {
            throw new Error('Short-description generation failed.');
        }
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: 'Update Neka.' }] },
        metadataLabel: 'test_atomic_short_description_generation_failure'
    });

    assert.equal(result.toolInvocations[0].metadata.error, true);
    assert.match(result.toolInvocations[0].metadata.message, /generation failed/i);
    assert.equal(npc.description, 'Original description.');
    assert.equal(npc.shortDescription, 'Original short.');
});

test('updateCharacterFields applies nested personality fields to persisted NPC personality fields', async () => {
    const npc = makeNpc();
    const runtime = makeRuntime({
        npc,
        firstResponse: toolResponse({
            character: 'Neka',
            fields: {
                personality: {
                    type: 'Cautious analyst',
                    traits: 'Hypervigilant, patient',
                    notes: 'Keeps emotional distance until trust is earned.',
                    aiNotes: 'Avoids committing to dangerous plans without concrete evidence.'
                }
            }
        })
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: '@Update Neka personality.' }] },
        metadataLabel: 'test_update_character_fields_personality'
    });

    assert.equal(npc.personalityType, 'Cautious analyst');
    assert.equal(npc.personalityTraits, 'Hypervigilant, patient');
    assert.equal(npc.personalityNotes, 'Keeps emotional distance until trust is earned.');
    assert.equal(npc.aiNotes, 'Avoids committing to dangerous plans without concrete evidence.');
    assert.equal(result.toolInvocations[0].metadata.status, 'success');
    assert.deepEqual(result.toolInvocations[0].metadata.updatedFields, [
        'personality.type',
        'personality.traits',
        'personality.notes',
        'personality.aiNotes'
    ]);
});

test('updateCharacterFields applies relationship mappings to an NPC', async () => {
    const npc = makeNpc();
    const runtime = makeRuntime({
        npc,
        firstResponse: toolResponse({
            character: 'Neka',
            fields: {
                relationships: {
                    'char-ally': 'old rival'
                }
            }
        })
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: '@Update Neka relationships.' }] },
        metadataLabel: 'test_update_character_fields_relationships'
    });

    assert.deepEqual(npc.relationships, {
        'char-ally': 'old rival'
    });
    assert.equal(result.toolInvocations[0].metadata.status, 'success');
    assert.deepEqual(result.toolInvocations[0].metadata.updatedFields, [
        'relationships'
    ]);
});

test('updateObjectFields resolves NPC aliases and applies the character allowlist', async () => {
    const npc = makeNpc({ aliases: ['Patch'] });
    const runtime = makeRuntime({
        npc,
        firstResponse: toolResponse({
            objectType: 'character',
            object: 'Patch',
            fields: {
                aiNotes: 'Alias lookup worked.',
                currency: 7
            }
        }, 'updateObjectFields')
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: '@Update Patch.' }] },
        metadataLabel: 'test_update_object_fields_character_alias'
    });

    assert.equal(npc.aiNotes, 'Alias lookup worked.');
    assert.equal(npc.currency, 7);
    assert.equal(result.toolInvocations[0].metadata.status, 'success');
    assert.equal(result.toolInvocations[0].metadata.objectType, 'character');
    assert.equal(result.toolInvocations[0].metadata.objectId, npc.id);
});

test('updateObjectFields rejects ambiguous names with toJSON candidates and no mutation', async () => {
    const firstCoin = makeThing({ id: 'thing-1', name: 'Copper Coin', description: 'First coin.' });
    const secondCoin = makeThing({ id: 'thing-2', name: 'Copper Coin', description: 'Second coin.' });
    const runtime = makeRuntime({
        firstResponse: toolResponse({
            objectType: 'thing',
            object: 'Copper Coin',
            fields: {
                description: 'Should not apply.'
            }
        }, 'updateObjectFields'),
        things: [firstCoin, secondCoin]
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: '@Update the coin.' }] },
        metadataLabel: 'test_update_object_fields_ambiguous'
    });

    assert.equal(result.toolInvocations[0].metadata.error, true);
    assert.equal(result.toolInvocations[0].metadata.code, 'ambiguous_object');
    assert.equal(result.toolInvocations[0].metadata.candidates.length, 2);
    assert.equal(result.toolInvocations[0].metadata.candidates[0].toJSON.id, 'thing-1');
    assert.match(result.toolInvocations[0].metadata.message, /call updateObjectFields again with the exact id/i);
    assert.equal(firstCoin.description, 'First coin.');
    assert.equal(secondCoin.description, 'Second coin.');
});

test('updateObjectFields applies allowed thing, location, region, and faction fields', async () => {
    const thing = makeThing();
    const location = makeLocation();
    const region = makeRegion({ locationIds: [location.id] });
    const faction = makeFaction();

    for (const [objectType, object, fields, assertion] of [
        ['thing', thing.id, { description: 'Polished token.', value: 14, count: 3 }, () => {
            assert.equal(thing.description, 'Polished token.');
            assert.equal(thing.metadata.value, 14);
            assert.equal(thing.count, 3);
        }],
        ['location', location.id, { description: 'A freshly dusted study.', visited: true, baseLevel: 4 }, () => {
            assert.equal(location.description, 'A freshly dusted study.');
            assert.equal(location.visited, true);
            assert.equal(location.baseLevel, 4);
        }],
        ['region', region.id, { description: 'A quiet manor district.', relativeLevel: 2 }, () => {
            assert.equal(region.description, 'A quiet manor district.');
            assert.equal(region.relativeLevel, 2);
        }],
        ['faction', faction.id, { description: 'A formal trade guild.', tags: ['merchant'] }, () => {
            assert.equal(faction.description, 'A formal trade guild.');
            assert.deepEqual(faction.tags, ['merchant']);
        }]
    ]) {
        const runtime = makeRuntime({
            firstResponse: toolResponse({ objectType, object, fields }, 'updateObjectFields'),
            things: [thing],
            locations: [location],
            regions: [region],
            factions: [faction]
        });

        const result = await runtime.runChatCompletionWithToolLoop({
            requestOptions: { messages: [{ role: 'user', content: `@Update ${objectType}.` }] },
            metadataLabel: `test_update_object_fields_${objectType}`
        });

        assertion();
        assert.equal({ thing, location, region, faction }[objectType].shortDescription, `Generated ${objectType} summary.`);
        assert.equal(result.toolInvocations[0].metadata.status, 'success');
        assert.equal(result.toolInvocations[0].metadata.objectType, objectType);
        assert.deepEqual(result.toolInvocations[0].metadata.updatedFields, [...Object.keys(fields), 'shortDescription']);
        assert.deepEqual(result.toolInvocations[0].metadata.updatedValues, {
            ...fields,
            shortDescription: `Generated ${objectType} summary.`
        });
    }
});

test('updateObjectFields updates location hasWeather canonically and clears image variants', async () => {
    const location = makeLocation({
        generationHints: {
            numItems: 3,
            hasWeather: 'no'
        },
        imageVariants: {
            'clear-day': { imageId: 'variant-1' }
        }
    });
    const runtime = makeRuntime({
        locations: [location],
        firstResponse: toolResponse({
            objectType: 'location',
            object: location.id,
            fields: {
                hasWeather: 'outside'
            }
        }, 'updateObjectFields')
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: '@Show the weather outside this sheltered location.' }] },
        metadataLabel: 'test_update_object_fields_location_has_weather'
    });

    assert.equal(location.generationHints.hasWeather, 'sheltered');
    assert.equal(location.generationHints.numItems, 3);
    assert.deepEqual(location.imageVariants, {});
    assert.equal(location.imageVariantClearCount, 1);
    assert.equal(result.toolInvocations[0].metadata.status, 'success');
    assert.deepEqual(result.toolInvocations[0].metadata.updatedFields, ['hasWeather']);
});

test('updateObjectFields rejects invalid location hasWeather without mutation', async () => {
    const location = makeLocation({
        generationHints: {
            numItems: 2,
            hasWeather: 'yes'
        },
        imageVariants: {
            'rain-day': { imageId: 'variant-2' }
        }
    });
    const runtime = makeRuntime({
        locations: [location],
        firstResponse: toolResponse({
            objectType: 'location',
            object: location.id,
            fields: {
                hasWeather: 'sometimes'
            }
        }, 'updateObjectFields')
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: '@Set uncertain location weather.' }] },
        metadataLabel: 'test_update_object_fields_location_has_weather_invalid'
    });

    assert.equal(result.toolInvocations[0].metadata.error, true);
    assert.equal(result.toolInvocations[0].metadata.code, 'invalid_arguments');
    assert.match(result.toolInvocations[0].metadata.message, /hasWeather must be "yes", "no", "sheltered"/);
    assert.equal(location.generationHints.hasWeather, 'yes');
    assert.equal(location.generationHints.numItems, 2);
    assert.deepEqual(location.imageVariants, {
        'rain-day': { imageId: 'variant-2' }
    });
    assert.equal(location.imageVariantClearCount, 0);
});

test('updateObjectFields applies registered first-class Thing fields', async () => {
    const registry = new ModExtensionRegistry();
    registry.registerEntityField({
        modName: 'implants',
        entityType: 'thing',
        fieldName: 'implantSlot',
        type: 'string',
        description: 'Implant grouping slot.',
        exposeToUpdateTool: true
    });
    const thing = makeThing();
    const runtime = makeRuntime({
        firstResponse: toolResponse({
            objectType: 'thing',
            object: thing.id,
            fields: { implantSlot: 'neural' }
        }, 'updateObjectFields'),
        things: [thing],
        modExtensionRegistry: registry
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: '@Mark this thing as an implant.' }] },
        metadataLabel: 'test_update_object_fields_registered_thing_field'
    });

    assert.equal(thing.extensionFields.implantSlot, 'neural');
    assert.equal(result.toolInvocations[0].metadata.status, 'success');
    assert.deepEqual(result.toolInvocations[0].metadata.updatedFields, ['implantSlot']);
});

test('updateObjectFields can update player-owned quests, objectives, and status effects by id', async () => {
    const quest = makeQuest();
    const player = {
        id: 'player-1',
        name: 'Player',
        isNPC: false,
        currentLocation: 'loc-1',
        quests: [quest],
        statusEffects: [{
            id: 'status-1',
            name: 'Bruised',
            description: 'A dull bruise.',
            duration: 30
        }],
        getCurrentQuests() {
            return this.quests;
        },
        getCompletedQuests() {
            return [];
        },
        getIntrinsicStatusEffects() {
            return this.statusEffects.map(entry => ({ ...entry }));
        },
        setStatusEffects(value) {
            this.statusEffects = value.map(entry => ({ ...entry }));
            return this.statusEffects;
        },
        toJSON() {
            return {
                id: this.id,
                name: this.name,
                quests: this.quests.map(entry => entry.toJSON()),
                statusEffects: this.statusEffects
            };
        }
    };

    for (const [objectType, object, fields, assertion] of [
        ['quest', 'quest-1', { description: 'Open the cellar door.', paused: true }, () => {
            assert.equal(quest.description, 'Open the cellar door.');
            assert.equal(quest.paused, true);
        }],
        ['objective', 'objective-1', { description: 'Find the brass key.', completed: true }, () => {
            assert.equal(quest.objectives[0].description, 'Find the brass key.');
            assert.equal(quest.objectives[0].completed, true);
        }],
        ['statusEffect', 'status-1', { name: 'Deep Bruise', duration: 45 }, () => {
            assert.equal(player.statusEffects[0].name, 'Deep Bruise');
            assert.equal(player.statusEffects[0].duration, 45);
        }]
    ]) {
        const runtime = makeRuntime({
            player,
            firstResponse: toolResponse({ objectType, object, fields }, 'updateObjectFields')
        });

        const result = await runtime.runChatCompletionWithToolLoop({
            requestOptions: { messages: [{ role: 'user', content: `@Update ${objectType}.` }] },
            metadataLabel: `test_update_object_fields_${objectType}`
        });

        assertion();
        assert.equal(result.toolInvocations[0].metadata.status, 'success');
        assert.equal(result.toolInvocations[0].metadata.objectType, objectType);
    }
});

test('updateCharacterFields rejects player targets', async () => {
    const npc = makeNpc();
    const runtime = makeRuntime({
        npc,
        firstResponse: toolResponse({
            character: 'Player',
            fields: {
                description: 'This should not apply.'
            }
        })
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: '@Update the player.' }] },
        metadataLabel: 'test_update_character_fields_player_rejected'
    });

    assert.equal(result.toolInvocations[0].metadata.error, true);
    assert.equal(result.toolInvocations[0].metadata.code, 'invalid_target');
});

test('updateCharacterFields rejects blocked object fields before applying allowed fields', async () => {
    const npc = makeNpc();
    const runtime = makeRuntime({
        npc,
        firstResponse: toolResponse({
            character: 'Neka',
            fields: {
                description: 'This should not be applied.',
                gear: { mainHand: 'thing-1' }
            }
        })
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: '@Bad update.' }] },
        metadataLabel: 'test_update_character_fields_blocked'
    });

    assert.equal(result.toolInvocations[0].metadata.error, true);
    assert.equal(result.toolInvocations[0].metadata.code, 'unsupported_field');
    assert.equal(npc.description, 'Original description.');
});
