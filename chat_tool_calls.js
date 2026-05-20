const path = require('path');
const nunjucks = require('nunjucks');
const { addEvalFilter } = require('./nunjucks_filters.js');
const {
    getSceneSummaryIndexText,
    shouldIncludeEntryInSceneSummaryIndex
} = require('./scene_summary_index.js');
const MysteryBox = require('./MysteryBox.js');
const MysteryThread = require('./MysteryThread.js');

const CHAT_TOOL_MAX_ROUNDS = 8;
const MORE_INFO_MAX_MATCHES = 50;
const CACHED_CHECK_TOOL_CALL_NOTE = 'You already made this tool call. Do not re-run tool calls for the same checks that you made in earlier drafts.';
const MORE_INFO_COMPACT_OMITTED_FIELDS = new Set([
    'needBars',
    'needBarRatesAppliedAt',
    'healthRegenAppliedAt',
    'partyMemoryHistorySegments',
    'partyMembershipChangedThisTurn',
    'partyMembersAddedThisTurn',
    'partyMembersRemovedThisTurn',
    'turnsSincePartyMemoryGeneration',
    'previousLocationId',
    'lastActionWasTravel',
    'consecutiveTravelActions',
    'elapsedTime',
    'pendingAbilityOptionsByLevel',
    'thingListViewPreferences',
    'locationBlueprints',
    'randomEvents',
    'characterConcepts',
    'enemyConcepts',
    'weatherState',
    'imageVariants',
    'stubMetadata',
    'generationHints'
]);
const UPDATE_CHARACTER_FIELD_NAMES = Object.freeze([
    'name',
    'description',
    'shortDescription',
    'race',
    'class',
    'gender',
    'level',
    'health',
    'healthAttribute',
    'currency',
    'experience',
    'isDead',
    'isHostile',
    'factionId',
    'aliases',
    'personalityType',
    'personalityTraits',
    'personalityNotes',
    'aiNotes',
    'resistances',
    'vulnerabilities',
    'attributes',
    'skills',
    'statusEffects',
    'needBarApplicability',
    'willingToTrade'
]);
const UPDATE_CHARACTER_FIELD_SET = new Set(UPDATE_CHARACTER_FIELD_NAMES);
const UPDATE_OBJECT_TYPE_VALUES = Object.freeze([
    'character',
    'thing',
    'location',
    'exit',
    'region',
    'faction',
    'quest',
    'objective',
    'statusEffect'
]);
const UPDATE_OBJECT_TYPE_ALIASES = Object.freeze({
    npc: 'character',
    character: 'character',
    item: 'thing',
    scenery: 'thing',
    thing: 'thing',
    location: 'location',
    loc: 'location',
    exit: 'exit',
    locationExit: 'exit',
    region: 'region',
    faction: 'faction',
    quest: 'quest',
    objective: 'objective',
    questObjective: 'objective',
    status: 'statusEffect',
    effect: 'statusEffect',
    statusEffect: 'statusEffect'
});
const UPDATE_OBJECT_FIELD_NAMES_BY_TYPE = Object.freeze({
    character: UPDATE_CHARACTER_FIELD_NAMES,
    thing: Object.freeze([
        'name',
        'description',
        'shortDescription',
        'thingType',
        'rarity',
        'itemTypeDetail',
        'slot',
        'count',
        'level',
        'relativeLevel',
        'value',
        'isVehicle',
        'isCraftingStation',
        'isProcessingStation',
        'isHarvestable',
        'isSalvageable',
        'isContainer',
        'attributeBonuses',
        'unscaledAttributeBonuses',
        'statusEffects'
    ]),
    location: Object.freeze([
        'name',
        'description',
        'shortDescription',
        'baseLevel',
        'visited',
        'lastVisitedTime',
        'hasGeneratedStubs',
        'generationHints',
        'randomEvents',
        'controllingFactionId',
        'statusEffects'
    ]),
    exit: Object.freeze([
        'description',
        'destination',
        'travelTimeMinutes',
        'bidirectional',
        'imageId',
        'isVehicle',
        'vehicleType'
    ]),
    region: Object.freeze([
        'name',
        'description',
        'shortDescription',
        'relativeLevel',
        'averageLevel',
        'numImportantNPCs',
        'characterConcepts',
        'enemyConcepts',
        'secrets',
        'lastVisitedTime',
        'parentRegionId',
        'entranceLocationId',
        'controllingFactionId',
        'weather',
        'weatherState',
        'randomEvents',
        'statusEffects'
    ]),
    faction: Object.freeze([
        'name',
        'description',
        'shortDescription',
        'tags',
        'goals',
        'homeRegionName',
        'relations',
        'assets',
        'reputationTiers'
    ]),
    quest: Object.freeze([
        'name',
        'description',
        'rewardItems',
        'rewardCurrency',
        'rewardXp',
        'rewardFactionReputation',
        'rewardNpcDispositions',
        'rewardClaimed',
        'secretNotes',
        'giverId',
        'giverName',
        'paused'
    ]),
    objective: Object.freeze([
        'description',
        'completed',
        'optional'
    ]),
    statusEffect: Object.freeze([
        'name',
        'description',
        'attributes',
        'skills',
        'needBars',
        'duration',
        'appliedAt'
    ])
});
const CHAT_TOOL_DEFINITIONS = Object.freeze([
    {
        type: 'function',
        function: {
            name: 'moreInfo',
            description: 'Return compact JSON objects for NPCs, things, locations, and regions whose names contain the given query substring. Use includeFullState only for debugging raw persisted/runtime fields.',
            parameters: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'Case-insensitive substring to match against entity names. Example: "Bob".'
                    },
                    type: {
                        type: 'string',
                        enum: ['character', 'thing', 'location', 'region'],
                        description: 'Optional info category filter. Omit to search all categories.'
                    },
                    includeFullState: {
                        type: 'boolean',
                        description: 'Optional. Defaults to false. When true, returns raw full toJSON payloads including bulky runtime fields; otherwise returns compact JSON for prompt use.'
                    }
                },
                required: ['name'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'getHistory',
            description: 'Return chat history entries whose content contains every provided case-insensitive query substring. Regular prompts search assistant prose-like entries; @, @@, and @@@ generic prompts search every stored chat log entry type.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'array',
                        items: { type: 'string' },
                        minItems: 1,
                        description: 'All case-insensitive substrings that must match the same prose history entry. Example: ["Rodrigo", "bridge"].'
                    },
                    startIndex: {
                        type: 'integer',
                        minimum: 1,
                        description: 'Optional 1-based index into the matched result list. Omit to start at 1.'
                    },
                    count: {
                        type: 'integer',
                        minimum: 1,
                        description: 'Optional number of matched items to return. Omit to return all remaining matches.'
                    }
                },
                required: ['query'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'getFullScene',
            description: 'Return all scene-summary-indexed action inputs and prose entries for a stored Scene N listed inside the <olderStoryHistory> context.',
            parameters: {
                type: 'object',
                properties: {
                    sceneNumber: {
                        type: 'integer',
                        minimum: 1,
                        description: '1-based Scene N number from <olderStoryHistory>, matching the display number shown by /scene_summaries.'
                    }
                },
                required: ['sceneNumber'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'requestUserInput',
            description: 'Ask the player one direct question when the prompt cannot continue safely without additional information from the user.',
            parameters: {
                type: 'object',
                properties: {
                    question: {
                        type: 'string',
                        description: 'The exact question to show to the player.'
                    }
                },
                required: ['question'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'listMysteryBoxes',
            description: 'List tracked private mystery boxes. Optionally filters by a phrase contained in the mystery box id, name, keys, aliases, or private note text. Does not return full private notes.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Optional phrase to search for. Omit or leave blank to list all mystery boxes.'
                    }
                },
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'findMysteryBoxes',
            description: 'Search private GM-only mystery box notes by id, name, key, or alias. Returns all matching mystery boxes.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Mystery box id, name, key, alias, or partial normalized query. Example: "Ellison" or "ELLISON-SEVEN".'
                    }
                },
                required: ['query'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'getMysteryBox',
            description: 'Return private GM-only notes for a tracked mystery box by key, alias, or name.',
            parameters: {
                type: 'object',
                properties: {
                    key: {
                        type: 'string',
                        description: 'Mystery box key, alias, or name. Example: "Captain Ellison" or "ELLISON-SEVEN".'
                    }
                },
                required: ['key'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'listMysteryThreads',
            description: 'List tracked GM-only mystery threads. Optionally filters by phrase. Returns lightweight thread summaries and contained box ids/names, not full box text.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Optional phrase to search for. Omit or leave blank to list all mystery threads.'
                    }
                },
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'getMysteryThread',
            description: 'Return full private GM-only continuity for a mystery thread by id, key, alias, or name, including contained mystery boxes.',
            parameters: {
                type: 'object',
                properties: {
                    key: {
                        type: 'string',
                        description: 'Mystery thread id, key, alias, or name. Example: "Skyhawk Furnace Siphoning".'
                    }
                },
                required: ['key'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'teleportCharacterToLocation',
            description: 'Teleport a character (player or NPC) to a location. When names are ambiguous, the tool returns disambiguation candidates.',
            parameters: {
                type: 'object',
                properties: {
                    character: {
                        type: 'string',
                        description: 'Character ID or name.'
                    },
                    location: {
                        type: 'string',
                        description: 'Destination location ID or name.'
                    },
                    region: {
                        type: 'string',
                        description: 'Optional region ID or name used to disambiguate location matching.'
                    }
                },
                required: ['character', 'location'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'teleportThingToLocation',
            description: 'Teleport a thing to a location. Removes the thing from prior owner inventory/location first.',
            parameters: {
                type: 'object',
                properties: {
                    thing: {
                        type: 'string',
                        description: 'Thing ID or name.'
                    },
                    location: {
                        type: 'string',
                        description: 'Destination location ID or name.'
                    },
                    region: {
                        type: 'string',
                        description: 'Optional region ID or name used to disambiguate location matching.'
                    }
                },
                required: ['thing', 'location'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'moveThingFromLocationToCharacterInventory',
            description: 'Move a thing from a specific location into a character inventory. Fails if the thing is not at that location.',
            parameters: {
                type: 'object',
                properties: {
                    thing: {
                        type: 'string',
                        description: 'Thing ID or name.'
                    },
                    fromLocation: {
                        type: 'string',
                        description: 'Source location ID or name where the thing must currently exist.'
                    },
                    character: {
                        type: 'string',
                        description: 'Target character ID or name.'
                    },
                    region: {
                        type: 'string',
                        description: 'Optional region ID or name used to disambiguate location matching.'
                    }
                },
                required: ['thing', 'fromLocation', 'character'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'createRegionStub',
            description: 'Create a new region-entry stub reachable from an origin location. Use createExit for the canonical location/region creation flow.',
            parameters: {
                type: 'object',
                properties: {
                    regionName: {
                        type: 'string',
                        description: 'Name for the new region stub.'
                    },
                    originLocation: {
                        type: 'string',
                        description: 'Optional origin location ID or name. Defaults to the current player location.'
                    },
                    originRegion: {
                        type: 'string',
                        description: 'Optional region disambiguator for origin location matching.'
                    },
                    description: {
                        type: 'string',
                        description: 'Optional stub description and exit label.'
                    },
                    parentRegion: {
                        type: 'string',
                        description: 'Optional parent region ID or name.'
                    },
                    vehicleType: {
                        type: 'string',
                        description: 'Optional vehicle type for this exit path.'
                    },
                    relativeLevel: {
                        type: 'integer',
                        description: 'Optional relative level hint for generation.'
                    }
                },
                required: ['regionName'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'createLocationStub',
            description: 'Create a location stub reachable from an origin location and ensure an exit connects to it.',
            parameters: {
                type: 'object',
                properties: {
                    locationName: {
                        type: 'string',
                        description: 'Name for the destination location stub.'
                    },
                    originLocation: {
                        type: 'string',
                        description: 'Optional origin location ID or name. Defaults to the current player location.'
                    },
                    originRegion: {
                        type: 'string',
                        description: 'Optional region disambiguator for origin location matching.'
                    },
                    description: {
                        type: 'string',
                        description: 'Optional stub description and exit label.'
                    },
                    targetRegion: {
                        type: 'string',
                        description: 'Optional target region ID or name for placing/disambiguating the destination location.'
                    },
                    vehicleType: {
                        type: 'string',
                        description: 'Optional vehicle type for this exit path.'
                    },
                    relativeLevel: {
                        type: 'integer',
                        description: 'Optional relative level hint for generation.'
                    }
                },
                required: ['locationName'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'createExit',
            description: 'Create an exit from one location to another location or region. This is the canonical way to create new location and region stubs: if the destination does not exist, this tool creates the missing stub and connects it.',
            parameters: {
                type: 'object',
                properties: {
                    fromLocation: {
                        type: 'string',
                        description: 'Origin location ID or name.'
                    },
                    fromRegion: {
                        type: 'string',
                        description: 'Optional region ID or name used to disambiguate origin location matching.'
                    },
                    toLocation: {
                        type: 'string',
                        description: 'Destination location ID or name. If missing and toRegion is provided, a region exit is created.'
                    },
                    toRegion: {
                        type: 'string',
                        description: 'Destination region ID or name. If not found, a region-entry stub is created.'
                    },
                    description: {
                        type: 'string',
                        description: 'Optional exit description.'
                    },
                    vehicleType: {
                        type: 'string',
                        description: 'Optional vehicle type; sets isVehicle=true.'
                    },
                    relativeLevel: {
                        type: 'integer',
                        description: 'Optional relative level hint for created stubs.'
                    }
                },
                required: ['fromLocation'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'listLocationEntities',
            description: 'List characters and/or things at a location. Includes the player and player party members when the player is present at that location.',
            parameters: {
                type: 'object',
                properties: {
                    location: {
                        type: 'string',
                        description: 'Location ID or name.'
                    },
                    region: {
                        type: 'string',
                        description: 'Optional region ID or name used to disambiguate location matching.'
                    },
                    entityType: {
                        type: 'string',
                        enum: ['characters', 'things', 'both'],
                        description: 'Optional filter. Defaults to both.'
                    }
                },
                required: ['location'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'createThing',
            description: 'Create a thing at a location using thing-generator-single. Returns the final created name (which may differ from requested name after name validation).',
            parameters: {
                type: 'object',
                properties: {
                    shortDescription: {
                        type: 'string',
                        description: 'Required short description seed for generation.'
                    },
                    itemOrScenery: {
                        type: 'string',
                        enum: ['item', 'scenery'],
                        description: 'Required thing type.'
                    },
                    location: {
                        type: 'string',
                        description: 'Optional location ID or name. Defaults to current player location.'
                    },
                    region: {
                        type: 'string',
                        description: 'Optional region ID or name used to disambiguate location matching.'
                    },
                    name: {
                        type: 'string',
                        description: 'Optional preferred thing name.'
                    },
                    description: {
                        type: 'string',
                        description: 'Optional long description seed.'
                    },
                    notes: {
                        type: 'string',
                        description: 'Optional additional generator notes.'
                    },
                    type: {
                        type: 'string',
                        description: 'Optional item/scenery type detail.'
                    },
                    slot: {
                        type: 'string',
                        description: 'Optional equipment slot or N/A.'
                    },
                    rarity: {
                        type: 'string',
                        description: 'Optional rarity label.'
                    },
                    value: {
                        type: 'number',
                        description: 'Optional value field.'
                    },
                    weight: {
                        type: 'number',
                        description: 'Optional weight field.'
                    },
                    relativeLevel: {
                        type: 'integer',
                        description: 'Optional relative level hint.'
                    },
                    isVehicle: {
                        type: 'boolean'
                    },
                    isCraftingStation: {
                        type: 'boolean'
                    },
                    isProcessingStation: {
                        type: 'boolean'
                    },
                    isHarvestable: {
                        type: 'boolean'
                    },
                    isSalvageable: {
                        type: 'boolean'
                    },
                    isContainer: {
                        type: 'boolean',
                        description: 'Optional container flag. Set true for items or scenery that can visibly hold item stacks, such as chests, shelves, satchels, desk drawers, and cabinets.'
                    },
                    attributeBonuses: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                attribute: { type: 'string' },
                                bonus: { type: 'number' }
                            },
                            required: ['attribute', 'bonus'],
                            additionalProperties: false
                        }
                    },
                    causeStatusEffectOnTarget: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            description: { type: 'string' },
                            duration: { type: 'string' }
                        },
                        additionalProperties: false
                    },
                    causeStatusEffectOnEquipper: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            description: { type: 'string' },
                            duration: { type: 'string' }
                        },
                        additionalProperties: false
                    },
                    properties: {
                        type: 'string',
                        description: 'Optional freeform properties text.'
                    }
                },
                required: ['shortDescription', 'itemOrScenery'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'alterThing',
            description: 'Alter an existing thing by ID or name using the existing thing alteration prompt flow. Alters the whole resolved thing stack.',
            parameters: {
                type: 'object',
                properties: {
                    thing: {
                        type: 'string',
                        description: 'Thing ID or name.'
                    },
                    alteration: {
                        type: 'string',
                        description: 'Detailed description of the alteration to apply.'
                    }
                },
                required: ['thing', 'alteration'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'alterNpc',
            description: 'Alter an existing NPC by ID or name using the existing alter_npc event flow.',
            parameters: {
                type: 'object',
                properties: {
                    npc: {
                        type: 'string',
                        description: 'NPC ID or name.'
                    },
                    alteration: {
                        type: 'string',
                        description: 'Detailed description of the alteration to apply.'
                    }
                },
                required: ['npc', 'alteration'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'updateCharacterFields',
            description: `Directly update allowed persisted fields on an NPC without running the alter_npc event flow. Only use simple character fields from this allowlist: ${UPDATE_CHARACTER_FIELD_NAMES.join(', ')}. Do not use this for equipment, inventory, barter inventory, party membership, quests, location, dispositions, or other object-graph state.`,
            parameters: {
                type: 'object',
                properties: {
                    character: {
                        type: 'string',
                        description: 'NPC ID or exact name. Player characters are not valid targets.'
                    },
                    fields: {
                        type: 'object',
                        description: 'Object of allowed field names to new values, such as { "aiNotes": "...", "personalityNotes": "...", "attributes": { "Strength": 12 } }.'
                    }
                },
                required: ['character', 'fields'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'updateObjectFields',
            description: `Directly update allowed persisted fields on a specific object without running alter prompts. Identify by exact ID when possible; names and aliases are accepted where applicable, but ambiguous names return candidate JSON and must be retried by ID. Character updates are NPC-only. Allowed object types: ${UPDATE_OBJECT_TYPE_VALUES.join(', ')}.`,
            parameters: {
                type: 'object',
                properties: {
                    objectType: {
                        type: 'string',
                        enum: UPDATE_OBJECT_TYPE_VALUES,
                        description: 'Type of object to update.'
                    },
                    object: {
                        type: 'string',
                        description: 'Object ID, exact name, or exact alias where aliases apply. Use IDs after an ambiguity error.'
                    },
                    fields: {
                        type: 'object',
                        description: 'Object of allowed field names to new values. Whole ownership/equipment/inventory graph fields are rejected.'
                    }
                },
                required: ['objectType', 'object', 'fields'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'alterLocation',
            description: 'Alter an existing location by ID or name using the existing alter_location event flow.',
            parameters: {
                type: 'object',
                properties: {
                    location: {
                        type: 'string',
                        description: 'Location ID or name.'
                    },
                    region: {
                        type: 'string',
                        description: 'Optional region ID or name used to disambiguate location matching.'
                    },
                    alteration: {
                        type: 'string',
                        description: 'Detailed description of the alteration to apply.'
                    }
                },
                required: ['location', 'alteration'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'resolveAttack',
            description: 'Resolve an attack using the same fields produced by the attack-check prompt, apply the resulting damage to the defender, and return the damage done as a string or "miss" if the attack misses.',
            parameters: {
                type: 'object',
                properties: {
                    attacker: {
                        type: 'string',
                        description: 'Full exact name of the attacker as seen in location context, or "player".'
                    },
                    defender: {
                        type: 'string',
                        description: 'Full exact name of the defender as seen in location context, or "player".'
                    },
                    attackerInfo: {
                        type: 'object',
                        properties: {
                            attackSkill: {
                                type: 'string',
                                description: 'Exact skill name used to hit.'
                            },
                            damageAttribute: {
                                type: 'string',
                                description: 'Exact attribute name used for damage.'
                            }
                        },
                        required: ['attackSkill', 'damageAttribute'],
                        additionalProperties: false
                    },
                    defenderInfo: {
                        type: 'object',
                        properties: {
                            evadeSkill: {
                                type: 'string',
                                description: 'N/A or exact skill name used to dodge or evade.'
                            },
                            deflectSkill: {
                                type: 'string',
                                description: 'N/A or exact skill name used to parry, deflect, or block.'
                            }
                        },
                        required: ['evadeSkill', 'deflectSkill'],
                        additionalProperties: false
                    },
                    ability: {
                        type: 'string',
                        description: 'N/A or exact name of the ability used.'
                    },
                    weapon: {
                        type: 'string',
                        description: 'N/A, barehanded, or exact name of the weapon used.'
                    },
                    circumstanceModifiers: {
                        type: 'object',
                        properties: {
                            attackerCircumstanceModifier: {
                                type: 'array',
                                description: 'Attack-roll circumstance modifiers from attacker circumstances. Use an empty array when none apply.',
                                items: {
                                    type: 'object',
                                    properties: {
                                        amount: { type: 'integer' },
                                        reason: { type: 'string' }
                                    },
                                    required: ['amount', 'reason'],
                                    additionalProperties: false
                                }
                            },
                            defenderCircumstanceModifier: {
                                type: 'array',
                                description: 'Defender-DC circumstance modifiers from defender circumstances. Use an empty array when none apply.',
                                items: {
                                    type: 'object',
                                    properties: {
                                        amount: { type: 'integer' },
                                        reason: { type: 'string' }
                                    },
                                    required: ['amount', 'reason'],
                                    additionalProperties: false
                                }
                            }
                        },
                        required: ['attackerCircumstanceModifier', 'defenderCircumstanceModifier'],
                        additionalProperties: false
                    },
                    damageEffectiveness: {
                        type: 'integer',
                        description: 'Integer from 1 to 5, where 3 is typical effectiveness.'
                    }
                },
                required: [
                    'attacker',
                    'defender',
                    'attackerInfo',
                    'defenderInfo',
                    'ability',
                    'weapon',
                    'circumstanceModifiers',
                    'damageEffectiveness'
                ],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'resolveAreaAttack',
            description: 'Resolve one shared area attack or effect against multiple defenders, apply per-target damage, and return grouped per-target outcomes.',
            parameters: {
                type: 'object',
                properties: {
                    attacker: {
                        type: 'string',
                        description: 'Full exact name of the attacker as seen in location context, or "player".'
                    },
                    targets: {
                        type: 'array',
                        description: 'Each defender affected by this one area effect. Use exact names from location context.',
                        items: {
                            type: 'object',
                            properties: {
                                name: {
                                    type: 'string',
                                    description: 'Full exact defender name as seen in location context, or "player".'
                                },
                                position: {
                                    type: 'string',
                                    enum: ['center', 'near', 'edge', 'behind cover', 'uncertain'],
                                    description: 'Symbolic location within the area effect.'
                                },
                                defenseInfo: {
                                    type: 'object',
                                    properties: {
                                        evadeSkill: {
                                            type: 'string',
                                            description: 'N/A or exact skill name used to dodge or evade.'
                                        },
                                        deflectSkill: {
                                            type: 'string',
                                            description: 'N/A or exact skill name used to parry, deflect, or block.'
                                        },
                                        toughnessAttribute: {
                                            type: 'string',
                                            description: 'N/A or exact attribute name used to absorb damage.'
                                        }
                                    },
                                    required: ['evadeSkill', 'deflectSkill', 'toughnessAttribute'],
                                    additionalProperties: false
                                },
                                circumstanceModifiers: {
                                    type: 'array',
                                    description: 'Target-specific defense modifiers. Positive values make the target harder to affect; negative values make the target easier to affect. Use an empty array when none apply.',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            amount: { type: 'integer' },
                                            reason: { type: 'string' }
                                        },
                                        required: ['amount', 'reason'],
                                        additionalProperties: false
                                    }
                                },
                                damageEffectiveness: {
                                    type: 'integer',
                                    description: 'Integer from 1 to 5 for this target, where 3 is typical effectiveness.'
                                }
                            },
                            required: [
                                'name',
                                'position',
                                'defenseInfo',
                                'circumstanceModifiers',
                                'damageEffectiveness'
                            ],
                            additionalProperties: false
                        }
                    },
                    attackerInfo: {
                        type: 'object',
                        properties: {
                            attackSkill: {
                                type: 'string',
                                description: 'Exact skill name used for placement or accuracy.'
                            },
                            damageAttribute: {
                                type: 'string',
                                description: 'Exact attribute name used for damage.'
                            }
                        },
                        required: ['attackSkill', 'damageAttribute'],
                        additionalProperties: false
                    },
                    ability: {
                        type: 'string',
                        description: 'N/A or exact name of the ability used.'
                    },
                    weapon: {
                        type: 'string',
                        description: 'N/A, barehanded, or exact name of the weapon/item/effect source used.'
                    },
                    areaShape: {
                        type: 'string',
                        enum: ['blast', 'cone', 'line', 'cloud', 'burst', 'sweep', 'other'],
                        description: 'General shape of the area effect.'
                    },
                    effectDescription: {
                        type: 'string',
                        description: 'Short description of the shared area effect.'
                    },
                    rollMode: {
                        type: 'string',
                        enum: ['sharedAttackRoll'],
                        description: 'For v1 this must be sharedAttackRoll.'
                    },
                    circumstanceModifiers: {
                        type: 'array',
                        description: 'Attacker/effect-wide circumstance modifiers to the shared attack roll. Use an empty array when none apply.',
                        items: {
                            type: 'object',
                            properties: {
                                amount: { type: 'integer' },
                                reason: { type: 'string' }
                            },
                            required: ['amount', 'reason'],
                            additionalProperties: false
                        }
                    },
                    secondaryEffect: {
                        type: 'object',
                        properties: {
                            name: {
                                type: 'string',
                                description: 'N/A or status effect name suggested by this area effect.'
                            },
                            description: {
                                type: 'string',
                                description: 'Observed secondary effect if applicable, or N/A.'
                            },
                            appliesOn: {
                                type: 'string',
                                enum: ['hit', 'damage', 'anyEffect', 'never'],
                                description: 'When the secondary effect should be narrated as applying.'
                            }
                        },
                        required: ['name', 'description', 'appliesOn'],
                        additionalProperties: false
                    }
                },
                required: [
                    'attacker',
                    'targets',
                    'attackerInfo',
                    'ability',
                    'weapon',
                    'areaShape',
                    'effectDescription',
                    'rollMode',
                    'circumstanceModifiers',
                    'secondaryEffect'
                ],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'resolveSkillCheck',
            description: 'Resolve an unopposed skill check for a meaningful uncertain non-attack action and return the resulting outcome label.',
            parameters: {
                type: 'object',
                properties: {
                    actor: {
                        type: 'string',
                        description: 'Optional acting character name or "player". Defaults to the current prose actor when available, otherwise the current player.'
                    },
                    reason: {
                        type: 'string',
                        description: 'Brief reason this skill check is needed and why this skill/attribute and difficulty are appropriate.'
                    },
                    skill: {
                        type: 'string',
                        description: 'N/A or exact skill name used for the check. Must specify either this or attribute.'
                    },
                    attribute: {
                        type: 'string',
                        description: 'N/A or exact attribute name used for the check. Must specify either this or skill.'
                    },
                    difficultyLevel: {
                        type: 'string',
                        enum: ['Trivial', 'Easy', 'Medium', 'Hard', 'Very Hard', 'Legendary'],
                        description: 'Unopposed difficulty level.'
                    },
                    circumstanceModifiers: {
                        type: 'array',
                        description: 'Circumstance modifiers. Use an empty array when none apply.',
                        items: {
                            type: 'object',
                            properties: {
                                amount: { type: 'integer' },
                                reason: { type: 'string' }
                            },
                            required: ['amount', 'reason'],
                            additionalProperties: false
                        }
                    }
                },
                required: ['reason', 'skill', 'attribute', 'difficultyLevel', 'circumstanceModifiers'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'resolveOpposedSkillCheck',
            description: 'Resolve an opposed skill check against another present actor for a meaningful contested non-attack action and return the resulting outcome label.',
            parameters: {
                type: 'object',
                properties: {
                    actor: {
                        type: 'string',
                        description: 'Optional acting character name or "player". Defaults to the current prose actor when available, otherwise the current player.'
                    },
                    reason: {
                        type: 'string',
                        description: 'Brief reason this contested skill check is needed and why this opposed skill/attribute pairing is appropriate.'
                    },
                    skill: {
                        type: 'string',
                        description: 'N/A or exact acting character skill name used for the check. Must specify either this or attribute.'
                    },
                    attribute: {
                        type: 'string',
                        description: 'N/A or exact acting character attribute name used for the check. Must specify either this or skill.'
                    },
                    opponent: {
                        type: 'string',
                        description: 'Exact opponent name as seen in location context, or "player".'
                    },
                    opponentSkill: {
                        type: 'string',
                        description: 'N/A or exact opponent skill name used to resist. Must specify either this or opponentAttribute'
                    },
                    opponentAttribute: {
                        type: 'string',
                        description: 'N/A or exact opponent attribute name used to resist. Must specify either this or opponentSkill.'
                    },
                    circumstanceModifiers: {
                        type: 'array',
                        description: 'Acting character circumstance modifiers. Use an empty array when none apply.',
                        items: {
                            type: 'object',
                            properties: {
                                amount: { type: 'integer' },
                                reason: { type: 'string' }
                            },
                            required: ['amount', 'reason'],
                            additionalProperties: false
                        }
                    }
                },
                required: ['reason', 'skill', 'attribute', 'opponent', 'opponentSkill', 'opponentAttribute', 'circumstanceModifiers'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'locateNpcs',
            description: 'Locate NPCs by full name or alias. Returns all matching NPCs with full name, location, and region.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'NPC name or alias to search for.'
                    }
                },
                required: ['query'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'locateThings',
            description: 'Locate things by name. Returns all matching things with location and, when in inventory, owner name plus owner location.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Thing name to search for.'
                    }
                },
                required: ['query'],
                additionalProperties: false
            }
        }
    }
]);

const ensureFunction = (value, name) => {
    if (typeof value !== 'function') {
        throw new Error(`Chat tool runtime requires ${name} function.`);
    }
};

const ensureModel = (value, name) => {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
        throw new Error(`Chat tool runtime requires ${name} model.`);
    }
};

class ToolVisibleError extends Error {
    constructor(message, { code = 'tool_error', candidates = [], details = null } = {}) {
        super(message);
        this.name = 'ToolVisibleError';
        this.code = typeof code === 'string' && code.trim() ? code.trim() : 'tool_error';
        this.candidates = Array.isArray(candidates) ? candidates : [];
        this.details = details && typeof details === 'object' ? details : null;
    }
}

const xmlEscapeText = (value) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const xmlEscapeAttribute = (value) => xmlEscapeText(value)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const xmlIndent = (level) => '  '.repeat(Math.max(0, level));

const buildXmlAttributeText = (attributes = null) => {
    const attrs = [];
    if (attributes && typeof attributes === 'object') {
        for (const [key, raw] of Object.entries(attributes)) {
            if (raw === null || raw === undefined) {
                continue;
            }
            attrs.push(`${key}="${xmlEscapeAttribute(raw)}"`);
        }
    }
    return attrs.length ? ` ${attrs.join(' ')}` : '';
};

const renderXmlNode = (tagName, value, level = 0, attributes = null) => {
    const attrText = buildXmlAttributeText(attributes);
    const tag = typeof tagName === 'string' && tagName.trim() ? tagName.trim() : 'node';

    if (value === null || value === undefined) {
        return [`${xmlIndent(level)}<${tag}${attrText}/>`];
    }

    const valueType = typeof value;
    if (valueType !== 'object') {
        return [`${xmlIndent(level)}<${tag}${attrText}>${xmlEscapeText(value)}</${tag}>`];
    }

    const lines = [`${xmlIndent(level)}<${tag}${attrText}>`];
    if (Array.isArray(value)) {
        for (const item of value) {
            lines.push(...renderXmlNode('item', item, level + 1));
        }
    } else {
        for (const [key, entry] of Object.entries(value)) {
            lines.push(...renderXmlNode('field', entry, level + 1, { name: key }));
        }
    }
    lines.push(`${xmlIndent(level)}</${tag}>`);
    return lines;
};

const normalizeToolCallsForExecution = (toolCalls = [], { sourceLabel = 'tool response' } = {}) => {
    if (!Array.isArray(toolCalls)) {
        throw new Error(`Expected tool call list in ${sourceLabel}.`);
    }
    const normalized = [];
    for (let i = 0; i < toolCalls.length; i += 1) {
        const rawCall = toolCalls[i];
        if (!rawCall || typeof rawCall !== 'object') {
            continue;
        }
        const id = typeof rawCall.id === 'string' ? rawCall.id.trim() : '';
        if (!id) {
            throw new Error(`Malformed tool call in ${sourceLabel}: missing call id.`);
        }
        const fn = rawCall.function;
        const functionName = typeof fn?.name === 'string' ? fn.name.trim() : '';
        if (!functionName) {
            throw new Error(`Malformed tool call "${id}" in ${sourceLabel}: missing function.name.`);
        }
        const argumentsText = typeof fn?.arguments === 'string' ? fn.arguments : '';
        const trimmedArguments = argumentsText.trim();
        if (!trimmedArguments) {
            throw new Error(`Malformed tool call "${functionName}" in ${sourceLabel}: function.arguments is empty.`);
        }
        let argumentsObject = null;
        try {
            argumentsObject = JSON.parse(trimmedArguments);
        } catch (error) {
            throw new Error(`Malformed tool call "${functionName}" in ${sourceLabel}: function.arguments is not valid JSON (${error.message}).`);
        }
        normalized.push({
            id,
            type: typeof rawCall.type === 'string' ? rawCall.type : 'function',
            functionName,
            argumentsText,
            argumentsObject
        });
    }
    return normalized;
};

const toSearchableValues = (input) => {
    if (input === null || input === undefined) {
        return [];
    }
    if (typeof input === 'string') {
        const trimmed = input.trim();
        return trimmed ? [trimmed] : [];
    }
    if (typeof input === 'number' || typeof input === 'boolean') {
        return [String(input)];
    }
    if (Array.isArray(input)) {
        return input.flatMap(toSearchableValues);
    }
    if (typeof input === 'object') {
        return Object.values(input).flatMap(toSearchableValues);
    }
    return [];
};

const normalizeHistoryQueries = (query) => {
    if (typeof query === 'string') {
        const trimmed = query.trim();
        if (!trimmed) {
            throw new Error('getHistory requires a non-empty "query" string or array of non-empty strings.');
        }
        return [trimmed];
    }

    if (!Array.isArray(query) || !query.length) {
        throw new Error('getHistory requires a non-empty "query" string or array of non-empty strings.');
    }

    const normalized = [];
    for (let i = 0; i < query.length; i += 1) {
        const entry = query[i];
        if (typeof entry !== 'string') {
            throw new Error(`getHistory query array entry at index ${i} must be a string.`);
        }
        const trimmed = entry.trim();
        if (!trimmed) {
            throw new Error(`getHistory query array entry at index ${i} must be non-empty.`);
        }
        normalized.push(trimmed);
    }
    return normalized;
};

const normalizeOptionalPositiveInteger = (value, name) => {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric < 1) {
        throw new Error(`getHistory "${name}" must be an integer >= 1 when provided.`);
    }
    return numeric;
};

const normalizeRequiredPositiveInteger = (value, name, toolName) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric < 1) {
        throw new Error(`${toolName} "${name}" must be an integer >= 1.`);
    }
    return numeric;
};

const normalizeMoreInfoType = (value) => {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value !== 'string') {
        throw new Error('moreInfo "type" must be a string when provided.');
    }
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
        return null;
    }
    if (normalized !== 'character'
        && normalized !== 'thing'
        && normalized !== 'location'
        && normalized !== 'region') {
        throw new Error('moreInfo "type" must be one of: character, thing, location, region.');
    }
    return normalized;
};

const normalizeMoreInfoIncludeFullState = (value) => {
    if (value === null || value === undefined) {
        return false;
    }
    if (typeof value !== 'boolean') {
        throw new Error('moreInfo "includeFullState" must be a boolean when provided.');
    }
    return value;
};

const toTrimmedString = (value) => (typeof value === 'string' ? value.trim() : '');

const toDisplayLevel = (rawValues = [], fallback = 1) => {
    for (const rawValue of rawValues) {
        const numeric = Number(rawValue);
        if (Number.isFinite(numeric) && numeric > 0) {
            return Math.max(1, Math.round(numeric));
        }
    }
    return fallback;
};

const normalizeStatusEffectsForDisplay = (effects) => {
    if (!Array.isArray(effects)) {
        return [];
    }
    return effects
        .map(effect => {
            const description = toTrimmedString(effect?.description || effect?.name || effect?.text);
            if (!description) {
                return null;
            }
            const durationValue = effect?.duration;
            const duration = durationValue === null || durationValue === undefined
                ? 'unknown'
                : String(durationValue);
            return { description, duration };
        })
        .filter(Boolean);
};

const normalizeMoreInfoMarkdown = (input) => {
    if (typeof input !== 'string') {
        return '';
    }
    const rawLines = input
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map(line => line.replace(/[ \t]+$/g, ''));

    const collapsed = [];
    let previousWasBlank = false;
    for (const line of rawLines) {
        const isBlank = line.trim() === '';
        if (isBlank) {
            if (previousWasBlank) {
                continue;
            }
            collapsed.push('');
            previousWasBlank = true;
            continue;
        }
        collapsed.push(line);
        previousWasBlank = false;
    }

    while (collapsed.length && collapsed[0].trim() === '') {
        collapsed.shift();
    }
    while (collapsed.length && collapsed[collapsed.length - 1].trim() === '') {
        collapsed.pop();
    }
    return collapsed.join('\n');
};

const createChatToolRuntime = ({
    getConfig,
    getChatHistory,
    getSceneSummaries = null,
    isAssistantProseLikeEntry,
    serializeNpcForClient,
    buildLocationResponse,
    getCurrentPlayer,
    createLocationFromEvent,
    createRegionStubFromEvent,
    generateItemsByNames,
    ensureExitConnection,
    findRegionByLocationId,
    alterThingByPrompt = null,
    alterNpcByEvent = null,
    alterLocationByEvent = null,
    resolveAttack = null,
    resolveAreaAttack = null,
    resolvePlausibilityCheck = null,
    resolveOpposedPlausibilityCheck = null,
    LLMClient,
    Player,
    Thing,
    Location,
    Region,
    getGameLocations,
    getFactions,
    getRegionsMap,
    getPendingRegionStubs,
    requestUserInput = null
} = {}) => {
    ensureFunction(getConfig, 'getConfig');
    ensureFunction(getChatHistory, 'getChatHistory');
    ensureFunction(isAssistantProseLikeEntry, 'isAssistantProseLikeEntry');
    ensureFunction(serializeNpcForClient, 'serializeNpcForClient');
    ensureFunction(buildLocationResponse, 'buildLocationResponse');
    ensureFunction(getCurrentPlayer, 'getCurrentPlayer');
    ensureFunction(createLocationFromEvent, 'createLocationFromEvent');
    ensureFunction(createRegionStubFromEvent, 'createRegionStubFromEvent');
    ensureFunction(generateItemsByNames, 'generateItemsByNames');
    ensureFunction(ensureExitConnection, 'ensureExitConnection');
    ensureFunction(findRegionByLocationId, 'findRegionByLocationId');
    ensureFunction(getGameLocations, 'getGameLocations');
    ensureFunction(getFactions, 'getFactions');
    ensureFunction(getRegionsMap, 'getRegionsMap');
    ensureFunction(getPendingRegionStubs, 'getPendingRegionStubs');
    ensureModel(LLMClient, 'LLMClient');
    ensureModel(Player, 'Player');
    ensureModel(Thing, 'Thing');
    ensureModel(Location, 'Location');
    ensureModel(Region, 'Region');

    const moreInfoTemplateEnv = (() => {
        if (typeof nunjucks.Environment !== 'function' || typeof nunjucks.FileSystemLoader !== 'function') {
            throw new Error('Nunjucks is unavailable for moreInfo display templates.');
        }
        const templatesPath = path.join(__dirname, 'templates');
        const env = new nunjucks.Environment(
            new nunjucks.FileSystemLoader(templatesPath, { noCache: true }),
            {
                autoescape: false,
                throwOnUndefined: false,
                trimBlocks: true,
                lstripBlocks: true
            }
        );
        addEvalFilter(env);
        return env;
    })();

    const renderMoreInfoTemplate = (templateName, context = {}) => {
        if (typeof templateName !== 'string' || !templateName.trim()) {
            throw new Error('moreInfo template name must be a non-empty string.');
        }
        let rendered = '';
        try {
            rendered = moreInfoTemplateEnv.render(templateName.trim(), context);
        } catch (error) {
            throw new Error(`Failed to render moreInfo template "${templateName}": ${error.message}`);
        }
        const trimmed = typeof rendered === 'string' ? rendered.trim() : '';
        if (!trimmed) {
            throw new Error(`moreInfo template "${templateName}" rendered empty output.`);
        }
        return trimmed;
    };

    const renderTemplatedXmlNode = ({
        tagName,
        templateName,
        context,
        level = 0,
        attributes = null
    } = {}) => {
        const tag = typeof tagName === 'string' && tagName.trim() ? tagName.trim() : 'entry';
        const attrText = buildXmlAttributeText(attributes);
        const rendered = renderMoreInfoTemplate(templateName, context);
        const markdown = normalizeMoreInfoMarkdown(rendered);
        if (!markdown) {
            throw new Error(`moreInfo template "${templateName}" rendered no markdown content.`);
        }
        const lines = [`${xmlIndent(level)}<${tag}${attrText}>`];
        lines.push(`${xmlIndent(level + 1)}<markdown>${xmlEscapeText(markdown)}</markdown>`);
        lines.push(`${xmlIndent(level)}</${tag}>`);
        return lines;
    };

    const npcAliasesForMatching = (npc) => {
        if (!npc) {
            return [];
        }
        if (typeof npc.getAliases === 'function') {
            return toSearchableValues(npc.getAliases());
        }
        if (npc.aliases instanceof Set) {
            return toSearchableValues(Array.from(npc.aliases));
        }
        return toSearchableValues(npc.aliases);
    };

    const buildThingDisplayModel = (thingLike) => {
        const rawThing = thingLike && typeof thingLike === 'object' ? thingLike : {};
        const metadata = rawThing.metadata && typeof rawThing.metadata === 'object'
            ? rawThing.metadata
            : {};
        const description = toTrimmedString(rawThing.description);
        const shortDescription = toTrimmedString(rawThing.shortDescription)
            || toTrimmedString(metadata.shortDescription);
        const summary = shortDescription || description;
        const rarity = toTrimmedString(rawThing.rarity) || 'common';
        const level = toDisplayLevel(
            [rawThing.level, rawThing.relativeLevel, metadata.relativeLevel, metadata.level],
            1
        );

        const attributeBonusesRaw = Array.isArray(rawThing.attributeBonuses)
            ? rawThing.attributeBonuses
            : [];
        const attributeBonuses = attributeBonusesRaw
            .map(entry => {
                if (!entry || typeof entry !== 'object') {
                    return null;
                }
                const attribute = toTrimmedString(entry.attribute || entry.name);
                if (!attribute) {
                    return null;
                }
                const bonusNumber = Number(entry.bonus ?? entry.value ?? 0);
                return {
                    attribute,
                    bonus: Number.isFinite(bonusNumber) ? bonusNumber : 0
                };
            })
            .filter(Boolean);

        return {
            id: toTrimmedString(rawThing.id) || null,
            name: toTrimmedString(rawThing.name) || 'Unknown',
            thingType: toTrimmedString(rawThing.thingType) || 'item',
            description,
            summary,
            rarity,
            level,
            itemTypeDetail: toTrimmedString(rawThing.itemTypeDetail),
            slot: toTrimmedString(rawThing.slot),
            isVehicle: Boolean(rawThing.isVehicle ?? metadata.isVehicle),
            isCraftingStation: Boolean(rawThing.isCraftingStation ?? metadata.isCraftingStation),
            isProcessingStation: Boolean(rawThing.isProcessingStation ?? metadata.isProcessingStation),
            isHarvestable: Boolean(rawThing.isHarvestable ?? metadata.isHarvestable),
            isSalvageable: Boolean(rawThing.isSalvageable ?? metadata.isSalvageable),
            attributeBonuses,
            statusEffects: normalizeStatusEffectsForDisplay(rawThing.statusEffects),
            causeStatusEffectOnTarget: rawThing.causeStatusEffectOnTarget && typeof rawThing.causeStatusEffectOnTarget === 'object'
                ? rawThing.causeStatusEffectOnTarget
                : null,
            causeStatusEffectOnEquipper: rawThing.causeStatusEffectOnEquipper && typeof rawThing.causeStatusEffectOnEquipper === 'object'
                ? rawThing.causeStatusEffectOnEquipper
                : null
        };
    };

    const buildPlayerDisplayModel = (playerRecord) => {
        const snapshot = playerRecord && typeof playerRecord === 'object' ? playerRecord : {};
        const skillSource = snapshot.skills && typeof snapshot.skills === 'object'
            ? snapshot.skills
            : {};
        const skills = Object.entries(skillSource)
            .map(([name, value]) => ({ name: toTrimmedString(name), value: Number(value) }))
            .filter(entry => entry.name && Number.isFinite(entry.value) && entry.value > 1)
            .sort((a, b) => {
                if (b.value !== a.value) {
                    return b.value - a.value;
                }
                return a.name.localeCompare(b.name);
            });

        const abilities = Array.isArray(snapshot.abilities)
            ? snapshot.abilities
                .map(ability => {
                    const name = toTrimmedString(ability?.name);
                    if (!name) {
                        return null;
                    }
                    return {
                        name,
                        level: toDisplayLevel([ability?.level], 1),
                        summary: toTrimmedString(ability?.shortDescription) || toTrimmedString(ability?.description)
                    };
                })
                .filter(Boolean)
            : [];

        const inventory = Array.isArray(snapshot.inventory)
            ? snapshot.inventory
                .map(item => {
                    const thing = buildThingDisplayModel(item);
                    const equippedSlot = toTrimmedString(item?.equippedSlot);
                    if (equippedSlot) {
                        thing.equippedSlot = equippedSlot;
                    }
                    return thing;
                })
                .filter(Boolean)
            : [];

        const aliases = Array.isArray(snapshot.aliases)
            ? Array.from(new Set(snapshot.aliases.map(alias => toTrimmedString(alias)).filter(Boolean)))
            : [];

        const gameLocations = getGameLocations();
        const factions = getFactions();
        const locationId = toTrimmedString(snapshot.locationId);
        const locationName = locationId && gameLocations instanceof Map && gameLocations.has(locationId)
            ? toTrimmedString(gameLocations.get(locationId)?.name) || locationId
            : (locationId || 'Unknown');
        const factionId = toTrimmedString(snapshot.factionId);
        const factionName = factionId && factions instanceof Map && factions.has(factionId)
            ? toTrimmedString(factions.get(factionId)?.name) || factionId
            : factionId;

        return {
            id: toTrimmedString(snapshot.id) || null,
            name: toTrimmedString(snapshot.name) || 'Unknown',
            description: toTrimmedString(snapshot.shortDescription) || toTrimmedString(snapshot.description),
            class: toTrimmedString(snapshot.class) || 'Unknown',
            race: toTrimmedString(snapshot.race) || 'Unknown',
            level: toDisplayLevel([snapshot.level], 1),
            locationName,
            isNPC: Boolean(snapshot.isNPC),
            isHostile: Boolean(snapshot.isHostile),
            isDead: Boolean(snapshot.isDead),
            aliases,
            factionName: factionName || null,
            resistances: toTrimmedString(snapshot.resistances),
            vulnerabilities: toTrimmedString(snapshot.vulnerabilities),
            currency: Number.isFinite(Number(snapshot.currency)) ? Number(snapshot.currency) : null,
            experience: Number.isFinite(Number(snapshot.experience)) ? Number(snapshot.experience) : null,
            skills,
            abilities,
            inventory,
            statusEffects: normalizeStatusEffectsForDisplay(snapshot.statusEffects)
        };
    };

    const buildLocationDisplayModel = (locationData) => {
        const snapshot = locationData && typeof locationData === 'object' ? locationData : {};
        const exits = Object.entries(snapshot.exits || {})
            .map(([direction, exit]) => {
                if (!exit || typeof exit !== 'object') {
                    return null;
                }
                return {
                    direction,
                    name: toTrimmedString(exit.name) || direction,
                    destinationName: toTrimmedString(exit.destinationName) || toTrimmedString(exit.destination),
                    destinationRegionName: toTrimmedString(exit.destinationRegionName),
                    isVehicle: Boolean(exit.isVehicle),
                    vehicleType: toTrimmedString(exit.vehicleType)
                };
            })
            .filter(Boolean);

        const npcs = Array.isArray(snapshot.npcs)
            ? snapshot.npcs
                .map(npc => ({
                    name: toTrimmedString(npc?.name) || 'Unknown',
                    class: toTrimmedString(npc?.class) || 'Unknown',
                    race: toTrimmedString(npc?.race) || 'Unknown',
                    level: toDisplayLevel([npc?.level], 1),
                    summary: toTrimmedString(npc?.shortDescription) || toTrimmedString(npc?.description)
                }))
                .filter(Boolean)
            : [];

        const thingModels = Array.isArray(snapshot.things)
            ? snapshot.things.map(buildThingDisplayModel).filter(Boolean)
            : [];
        const items = thingModels.filter(entry => entry.thingType !== 'scenery');
        const scenery = thingModels.filter(entry => entry.thingType === 'scenery');

        const factions = getFactions();
        const controllingFactionId = toTrimmedString(snapshot.controllingFactionId);
        const controllingFactionName = controllingFactionId && factions instanceof Map && factions.has(controllingFactionId)
            ? toTrimmedString(factions.get(controllingFactionId)?.name) || controllingFactionId
            : controllingFactionId;

        return {
            id: toTrimmedString(snapshot.id) || null,
            name: toTrimmedString(snapshot.name) || 'Unknown',
            description: toTrimmedString(snapshot.description),
            shortDescription: toTrimmedString(snapshot.shortDescription),
            regionName: toTrimmedString(snapshot.regionName),
            baseLevel: toDisplayLevel([snapshot.baseLevel], 1),
            isStub: Boolean(snapshot.isStub),
            controllingFactionName: controllingFactionName || null,
            exits,
            npcs,
            items,
            scenery,
            statusEffects: normalizeStatusEffectsForDisplay(snapshot.statusEffects)
        };
    };

    const buildRegionDisplayModel = (regionRecord) => {
        const regionData = typeof regionRecord?.toJSON === 'function'
            ? regionRecord.toJSON()
            : (regionRecord && typeof regionRecord === 'object' ? regionRecord : {});
        const regionId = toTrimmedString(regionData.id);

        const gameLocations = getGameLocations();
        const regions = getRegionsMap();
        const pendingRegionStubs = getPendingRegionStubs();
        const factions = getFactions();

        const locationIds = Array.isArray(regionData.locationIds)
            ? regionData.locationIds
            : [];
        const locationNames = locationIds
            .map(locationId => {
                const trimmedId = toTrimmedString(locationId);
                if (!trimmedId) {
                    return null;
                }
                if (gameLocations instanceof Map && gameLocations.has(trimmedId)) {
                    return toTrimmedString(gameLocations.get(trimmedId)?.name) || trimmedId;
                }
                return trimmedId;
            })
            .filter(Boolean);

        const connectedRegionNames = new Set();
        for (const locationId of locationIds) {
            const trimmedId = toTrimmedString(locationId);
            if (!trimmedId || !(gameLocations instanceof Map) || !gameLocations.has(trimmedId)) {
                continue;
            }
            const location = gameLocations.get(trimmedId);
            const exitMap = location?.exits instanceof Map ? location.exits : null;
            if (!exitMap) {
                continue;
            }
            for (const exit of exitMap.values()) {
                const destinationId = toTrimmedString(exit?.destination);
                if (!destinationId || !(gameLocations instanceof Map) || !gameLocations.has(destinationId)) {
                    continue;
                }
                const destinationLocation = gameLocations.get(destinationId);
                const destinationRegionId = toTrimmedString(destinationLocation?.regionId)
                    || toTrimmedString(destinationLocation?.stubMetadata?.regionId)
                    || toTrimmedString(destinationLocation?.stubMetadata?.targetRegionId);
                if (!destinationRegionId || destinationRegionId === regionId) {
                    continue;
                }
                const connectedRegionName = (regions instanceof Map && regions.has(destinationRegionId))
                    ? (toTrimmedString(regions.get(destinationRegionId)?.name) || destinationRegionId)
                    : (toTrimmedString(pendingRegionStubs?.get(destinationRegionId)?.name)
                        || toTrimmedString(destinationLocation?.stubMetadata?.regionName)
                        || toTrimmedString(destinationLocation?.stubMetadata?.targetRegionName)
                        || destinationRegionId);
                if (connectedRegionName) {
                    connectedRegionNames.add(connectedRegionName);
                }
            }
        }

        const parentRegionId = toTrimmedString(regionData.parentRegionId);
        const parentRegionName = parentRegionId && regions instanceof Map && regions.has(parentRegionId)
            ? toTrimmedString(regions.get(parentRegionId)?.name) || parentRegionId
            : parentRegionId;
        const controllingFactionId = toTrimmedString(regionData.controllingFactionId);
        const controllingFactionName = controllingFactionId && factions instanceof Map && factions.has(controllingFactionId)
            ? toTrimmedString(factions.get(controllingFactionId)?.name) || controllingFactionId
            : controllingFactionId;
        const weatherName = toTrimmedString(regionData.weatherState?.name);
        const weatherDescription = toTrimmedString(regionData.weatherState?.description);

        return {
            id: regionId || null,
            name: toTrimmedString(regionData.name) || 'Unknown',
            description: toTrimmedString(regionData.description),
            shortDescription: toTrimmedString(regionData.shortDescription),
            parentRegionName: parentRegionName || null,
            controllingFactionName: controllingFactionName || null,
            averageLevel: Number.isFinite(Number(regionData.averageLevel))
                ? Number(regionData.averageLevel)
                : null,
            locationNames,
            connectedRegionNames: Array.from(connectedRegionNames).sort((a, b) => a.localeCompare(b)),
            secrets: Array.isArray(regionData.secrets)
                ? regionData.secrets.map(secret => toTrimmedString(secret)).filter(Boolean)
                : [],
            weatherName: weatherName || null,
            weatherDescription: weatherDescription || null,
            statusEffects: normalizeStatusEffectsForDisplay(regionData.statusEffects)
        };
    };

    const locationRegionId = (location) => {
        const directRegionId = toTrimmedString(location?.regionId)
            || toTrimmedString(location?.stubMetadata?.regionId)
            || toTrimmedString(location?.stubMetadata?.targetRegionId);
        if (directRegionId) {
            return directRegionId;
        }
        const resolved = location?.id ? findRegionByLocationId(location.id) : null;
        return toTrimmedString(resolved?.id) || null;
    };

    const locationRegionName = (location) => {
        const regionId = locationRegionId(location);
        if (!regionId) {
            return null;
        }
        const regions = getRegionsMap();
        const pendingRegionStubs = getPendingRegionStubs();
        if (regions instanceof Map && regions.has(regionId)) {
            return toTrimmedString(regions.get(regionId)?.name) || regionId;
        }
        if (pendingRegionStubs instanceof Map && pendingRegionStubs.has(regionId)) {
            return toTrimmedString(pendingRegionStubs.get(regionId)?.name) || regionId;
        }
        return regionId;
    };

    const normalizeRequiredString = (value, { functionName, fieldName } = {}) => {
        const trimmed = toTrimmedString(value);
        if (!trimmed) {
            throw new ToolVisibleError(
                `${functionName} requires a non-empty "${fieldName}" string.`,
                { code: 'invalid_arguments' }
            );
        }
        return trimmed;
    };

    const normalizeOptionalString = (value) => {
        const trimmed = toTrimmedString(value);
        return trimmed || null;
    };

    const normalizeOptionalInteger = (value, { functionName, fieldName } = {}) => {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) {
            throw new ToolVisibleError(
                `${functionName} "${fieldName}" must be an integer when provided.`,
                { code: 'invalid_arguments' }
            );
        }
        return numeric;
    };

    const normalizeOptionalNumber = (value, { functionName, fieldName } = {}) => {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            throw new ToolVisibleError(
                `${functionName} "${fieldName}" must be a finite number when provided.`,
                { code: 'invalid_arguments' }
            );
        }
        return numeric;
    };

    const normalizeOptionalBoolean = (value, { functionName, fieldName } = {}) => {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        if (typeof value === 'boolean') {
            return value;
        }
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (normalized === 'true') {
                return true;
            }
            if (normalized === 'false') {
                return false;
            }
        }
        throw new ToolVisibleError(
            `${functionName} "${fieldName}" must be a boolean when provided.`,
            { code: 'invalid_arguments' }
        );
    };

    const cloneToolResult = (value) => {
        if (!value || typeof value !== 'object') {
            return value;
        }
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (_) {
            return {
                content: value.content,
                metadata: value.metadata && typeof value.metadata === 'object'
                    ? { ...value.metadata }
                    : value.metadata
            };
        }
    };

    const appendCachedCheckToolCallNote = (toolResult) => {
        if (!toolResult || typeof toolResult !== 'object') {
            throw new Error('Cannot append cached check-tool note to an invalid tool result.');
        }
        if (typeof toolResult.content !== 'string' || !toolResult.content.trim()) {
            throw new Error('Cannot append cached check-tool note to a tool result without content.');
        }
        if (toolResult.content.includes(CACHED_CHECK_TOOL_CALL_NOTE)) {
            return toolResult;
        }
        toolResult.content = `${toolResult.content.trimEnd()}\n\n${CACHED_CHECK_TOOL_CALL_NOTE}`;
        return toolResult;
    };

    const normalizeCacheKeyPart = (value) => {
        if (value === null || value === undefined) {
            return null;
        }
        const normalized = String(value).trim().replace(/\s+/g, ' ').toLowerCase();
        if (!normalized || normalized === 'n/a' || normalized === 'none' || normalized === 'null') {
            return null;
        }
        return normalized;
    };

    const stableCacheKey = (parts = {}) => {
        const entries = [];
        Object.keys(parts).sort().forEach(key => {
            const value = normalizeCacheKeyPart(parts[key]);
            if (value !== null) {
                entries.push(`${key}=${value}`);
            }
        });
        return entries.join('|');
    };

    const normalizeToolResultCache = (cache, { metadataLabel } = {}) => {
        if (cache && cache.entries instanceof Map) {
            if (!cache.roundKey) {
                cache.roundKey = metadataLabel || 'prompt';
            }
            return cache;
        }
        if (cache instanceof Map) {
            if (!cache.roundKey) {
                cache.roundKey = metadataLabel || 'prompt';
            }
            return {
                roundKey: cache.roundKey,
                entries: cache
            };
        }
        return {
            roundKey: metadataLabel || `prompt-${Date.now()}`,
            entries: new Map()
        };
    };

    const getCacheKeyForToolCall = (functionName, args, roundKey) => {
        if (!args || typeof args !== 'object') {
            return null;
        }
        if (functionName === 'resolveAttack') {
            return stableCacheKey({
                type: 'attack',
                round: roundKey,
                attacker: args.attacker,
                target: args.defender,
                weapon: args.weapon,
                ability: args.ability,
                skill: args.attackerInfo?.attackSkill
            });
        }
        if (functionName === 'resolveAreaAttack') {
            const targetNames = Array.isArray(args.targets)
                ? args.targets
                    .map(entry => normalizeCacheKeyPart(entry?.name))
                    .filter(Boolean)
                    .sort()
                    .join(',')
                : null;
            return stableCacheKey({
                type: 'area_attack',
                round: roundKey,
                attacker: args.attacker,
                targets: targetNames,
                weapon: args.weapon,
                ability: args.ability,
                areaShape: args.areaShape,
                effectDescription: args.effectDescription,
                rollMode: args.rollMode,
                skill: args.attackerInfo?.attackSkill
            });
        }
        if (functionName === 'resolveSkillCheck' || functionName === 'resolvePlausibilityCheck') {
            return stableCacheKey({
                type: 'skill_check',
                round: roundKey,
                character: args.actor || 'player',
                attribute: args.attribute,
                skill: args.skill
            });
        }
        if (functionName === 'resolveOpposedSkillCheck' || functionName === 'resolveOpposedPlausibilityCheck') {
            return stableCacheKey({
                type: 'opposed_skill_check',
                round: roundKey,
                character: args.actor || 'player',
                opponent: args.opponent,
                attribute: args.attribute,
                skill: args.skill,
                opponentAttribute: args.opponentAttribute,
                opponentSkill: args.opponentSkill
            });
        }
        return null;
    };

    const normalizeEntityTypeFilter = (value) => {
        if (value === null || value === undefined || value === '') {
            return 'both';
        }
        if (typeof value !== 'string') {
            throw new ToolVisibleError(
                'listLocationEntities "entityType" must be "characters", "things", or "both".',
                { code: 'invalid_arguments' }
            );
        }
        const normalized = value.trim().toLowerCase();
        if (normalized === 'characters' || normalized === 'things' || normalized === 'both') {
            return normalized;
        }
        throw new ToolVisibleError(
            'listLocationEntities "entityType" must be "characters", "things", or "both".',
            { code: 'invalid_arguments' }
        );
    };

    const getAllCharacters = () => {
        const allCharacters = typeof Player?.getAll === 'function' ? Player.getAll() : [];
        return Array.isArray(allCharacters) ? allCharacters.filter(Boolean) : [];
    };

    const getAllThings = () => {
        const allThings = typeof Thing?.getAll === 'function' ? Thing.getAll() : [];
        return Array.isArray(allThings) ? allThings.filter(Boolean) : [];
    };

    const getAllLocations = () => {
        const locationMap = getGameLocations();
        if (locationMap instanceof Map) {
            return Array.from(locationMap.values()).filter(Boolean);
        }
        const allLocations = typeof Location?.getAll === 'function' ? Location.getAll() : [];
        return Array.isArray(allLocations) ? allLocations.filter(Boolean) : [];
    };

    const getLocationByIdLoose = (locationId) => {
        const id = toTrimmedString(locationId);
        if (!id) {
            return null;
        }
        const gameLocations = getGameLocations();
        if (gameLocations instanceof Map && gameLocations.has(id)) {
            return gameLocations.get(id);
        }
        if (typeof Location?.get === 'function') {
            try {
                return Location.get(id) || null;
            } catch (_) {
                return null;
            }
        }
        return null;
    };

    const describeLocationSummary = (locationId) => {
        const location = getLocationByIdLoose(locationId);
        if (!location) {
            return {
                locationId: locationId || null,
                locationName: locationId || null,
                regionId: null,
                regionName: null
            };
        }
        return {
            locationId: location.id || null,
            locationName: toTrimmedString(location.name) || location.id || null,
            regionId: locationRegionId(location),
            regionName: locationRegionName(location)
        };
    };

    const describeCharacterCandidate = (character) => {
        const summary = describeLocationSummary(character?.currentLocation || character?.locationId || null);
        return {
            id: toTrimmedString(character?.id) || null,
            name: toTrimmedString(character?.name) || null,
            locationId: summary.locationId,
            locationName: summary.locationName,
            regionId: summary.regionId,
            regionName: summary.regionName
        };
    };

    const describeThingCandidate = (thing) => {
        const metadata = thing?.metadata && typeof thing.metadata === 'object' ? thing.metadata : {};
        const ownerId = toTrimmedString(metadata.ownerId || metadata.owner || metadata.ownerID) || null;
        const owner = ownerId
            ? getAllCharacters().find(candidate => toTrimmedString(candidate?.id) === ownerId) || null
            : null;
        const locationId = toTrimmedString(metadata.locationId || metadata.locationID) || null;
        const locationSummary = describeLocationSummary(locationId);
        return {
            id: toTrimmedString(thing?.id) || null,
            name: toTrimmedString(thing?.name) || null,
            locationId: locationSummary.locationId,
            locationName: locationSummary.locationName,
            ownerId,
            ownerName: toTrimmedString(owner?.name) || null
        };
    };

    const buildToolVisibleErrorResult = (functionName, error) => {
        const safeFunctionName = toTrimmedString(functionName) || 'unknownTool';
        const code = toTrimmedString(error?.code) || 'tool_error';
        const message = toTrimmedString(error?.message) || 'Tool call failed.';
        const candidates = Array.isArray(error?.candidates) ? error.candidates : [];
        const lines = [
            '<toolError>',
            `  <function>${xmlEscapeText(safeFunctionName)}</function>`,
            `  <code>${xmlEscapeText(code)}</code>`,
            `  <message>${xmlEscapeText(message)}</message>`,
            `  <candidates count="${candidates.length}">`
        ];
        for (const candidate of candidates) {
            lines.push(...renderXmlNode('candidate', candidate, 2));
        }
        lines.push('  </candidates>');
        lines.push('</toolError>');
        return {
            content: lines.join('\n'),
            metadata: {
                error: true,
                functionName: safeFunctionName,
                code,
                message,
                candidates
            }
        };
    };

    const candidateSort = (a, b) => {
        const leftName = toTrimmedString(a?.name).toLowerCase();
        const rightName = toTrimmedString(b?.name).toLowerCase();
        if (leftName !== rightName) {
            return leftName.localeCompare(rightName);
        }
        const leftId = toTrimmedString(a?.id).toLowerCase();
        const rightId = toTrimmedString(b?.id).toLowerCase();
        return leftId.localeCompare(rightId);
    };

    const resolveRegionReference = (rawQuery, {
        fieldName = 'region',
        allowPending = true,
        allowMissing = false
    } = {}) => {
        const query = toTrimmedString(rawQuery);
        if (!query) {
            if (allowMissing) {
                return null;
            }
            throw new ToolVisibleError(`A non-empty "${fieldName}" is required.`, {
                code: 'invalid_arguments'
            });
        }

        const regions = getRegionsMap();
        const pendingRegionStubs = getPendingRegionStubs();
        const lowerQuery = query.toLowerCase();
        const allCandidates = [];

        if (regions instanceof Map) {
            for (const region of regions.values()) {
                if (!region) {
                    continue;
                }
                const id = toTrimmedString(region.id);
                if (!id) {
                    continue;
                }
                allCandidates.push({
                    kind: 'region',
                    id,
                    name: toTrimmedString(region.name) || id,
                    record: region
                });
            }
        }

        if (allowPending && pendingRegionStubs instanceof Map) {
            for (const pending of pendingRegionStubs.values()) {
                if (!pending) {
                    continue;
                }
                const id = toTrimmedString(pending.id);
                if (!id) {
                    continue;
                }
                allCandidates.push({
                    kind: 'pending_region_stub',
                    id,
                    name: toTrimmedString(pending.name) || id,
                    record: pending
                });
            }
        }

        const idMatch = allCandidates.find(candidate => candidate.id === query) || null;
        if (idMatch) {
            return idMatch;
        }

        const exactNameMatches = allCandidates.filter(candidate => candidate.name.toLowerCase() === lowerQuery);
        const includesMatches = allCandidates.filter(candidate => candidate.name.toLowerCase().includes(lowerQuery));
        const matches = exactNameMatches.length ? exactNameMatches : includesMatches;

        if (!matches.length) {
            if (allowMissing) {
                return null;
            }
            throw new ToolVisibleError(
                `No ${fieldName} matches "${query}".`,
                { code: 'region_not_found' }
            );
        }

        if (matches.length > 1) {
            throw new ToolVisibleError(
                `Multiple ${fieldName} matches found for "${query}".`,
                {
                    code: 'ambiguous_region',
                    candidates: matches
                        .map(match => ({
                            id: match.id,
                            name: match.name,
                            kind: match.kind
                        }))
                        .sort(candidateSort)
                }
            );
        }

        return matches[0];
    };

    const resolveLocationReference = (rawQuery, {
        fieldName = 'location',
        regionQuery = null,
        allowMissing = false
    } = {}) => {
        const query = toTrimmedString(rawQuery);
        if (!query) {
            if (allowMissing) {
                return null;
            }
            throw new ToolVisibleError(`A non-empty "${fieldName}" is required.`, {
                code: 'invalid_arguments'
            });
        }

        const regionFilter = regionQuery
            ? resolveRegionReference(regionQuery, { fieldName: 'region', allowPending: true, allowMissing: false })
            : null;
        const regionFilterId = regionFilter?.id || null;

        const allLocations = getAllLocations();
        const idMatchedLocation = getLocationByIdLoose(query);
        if (idMatchedLocation) {
            const locationRegion = locationRegionId(idMatchedLocation);
            if (regionFilterId && locationRegion !== regionFilterId) {
                throw new ToolVisibleError(
                    `Location "${query}" is not in region "${regionFilter.name}".`,
                    { code: 'location_region_mismatch' }
                );
            }
            return idMatchedLocation;
        }

        const lowerQuery = query.toLowerCase();
        const exactNameMatches = allLocations.filter(location => (
            toTrimmedString(location?.name).toLowerCase() === lowerQuery
        ));
        const includesMatches = allLocations.filter(location => (
            toTrimmedString(location?.name).toLowerCase().includes(lowerQuery)
        ));
        let matches = exactNameMatches.length ? exactNameMatches : includesMatches;

        if (regionFilterId) {
            matches = matches.filter(location => locationRegionId(location) === regionFilterId);
        }

        if (!matches.length) {
            if (allowMissing) {
                return null;
            }
            throw new ToolVisibleError(
                `No ${fieldName} matches "${query}".`,
                { code: 'location_not_found' }
            );
        }

        if (matches.length > 1) {
            throw new ToolVisibleError(
                `Multiple ${fieldName} matches found for "${query}".`,
                {
                    code: 'ambiguous_location',
                    candidates: matches
                        .map(location => ({
                            id: toTrimmedString(location?.id) || null,
                            name: toTrimmedString(location?.name) || null,
                            regionId: locationRegionId(location),
                            regionName: locationRegionName(location)
                        }))
                        .sort(candidateSort)
                }
            );
        }

        return matches[0];
    };

    const resolveCharacterReference = (rawQuery, { fieldName = 'character' } = {}) => {
        const query = toTrimmedString(rawQuery);
        if (!query) {
            throw new ToolVisibleError(`A non-empty "${fieldName}" is required.`, {
                code: 'invalid_arguments'
            });
        }

        const allCharacters = getAllCharacters();
        const idMatch = allCharacters.find(character => toTrimmedString(character?.id) === query) || null;
        if (idMatch) {
            return idMatch;
        }

        const lowerQuery = query.toLowerCase();
        const exactNameMatches = allCharacters.filter(character => (
            toTrimmedString(character?.name).toLowerCase() === lowerQuery
        ));
        const includesMatches = allCharacters.filter(character => (
            toTrimmedString(character?.name).toLowerCase().includes(lowerQuery)
        ));
        const matches = exactNameMatches.length ? exactNameMatches : includesMatches;

        if (!matches.length) {
            throw new ToolVisibleError(
                `No ${fieldName} matches "${query}".`,
                { code: 'character_not_found' }
            );
        }

        if (matches.length > 1) {
            throw new ToolVisibleError(
                `Multiple ${fieldName} matches found for "${query}".`,
                {
                    code: 'ambiguous_character',
                    candidates: matches
                        .map(describeCharacterCandidate)
                        .sort(candidateSort)
                }
            );
        }

        return matches[0];
    };

    const resolveThingReference = (rawQuery, { fieldName = 'thing' } = {}) => {
        const query = toTrimmedString(rawQuery);
        if (!query) {
            throw new ToolVisibleError(`A non-empty "${fieldName}" is required.`, {
                code: 'invalid_arguments'
            });
        }

        const allThings = getAllThings();
        const idMatch = allThings.find(thing => toTrimmedString(thing?.id) === query) || null;
        if (idMatch) {
            return idMatch;
        }

        const lowerQuery = query.toLowerCase();
        const exactNameMatches = allThings.filter(thing => (
            toTrimmedString(thing?.name).toLowerCase() === lowerQuery
        ));
        const includesMatches = allThings.filter(thing => (
            toTrimmedString(thing?.name).toLowerCase().includes(lowerQuery)
        ));
        const matches = exactNameMatches.length ? exactNameMatches : includesMatches;

        if (!matches.length) {
            throw new ToolVisibleError(
                `No ${fieldName} matches "${query}".`,
                { code: 'thing_not_found' }
            );
        }

        if (matches.length > 1) {
            throw new ToolVisibleError(
                `Multiple ${fieldName} matches found for "${query}".`,
                {
                    code: 'ambiguous_thing',
                    candidates: matches
                        .map(describeThingCandidate)
                        .sort(candidateSort)
                }
            );
        }

        return matches[0];
    };

    const ensureLocationNpcMethod = (location, methodName) => {
        if (!location || typeof location[methodName] !== 'function') {
            throw new Error(`Location "${location?.id || 'unknown'}" is missing required method "${methodName}".`);
        }
    };

    const ensureLocationThingMethod = (location, methodName) => {
        if (!location || typeof location[methodName] !== 'function') {
            throw new Error(`Location "${location?.id || 'unknown'}" is missing required method "${methodName}".`);
        }
    };

    const updateThingLocationMetadata = (thing, { locationId = null, ownerId = null } = {}) => {
        const existingMetadata = thing?.metadata && typeof thing.metadata === 'object'
            ? thing.metadata
            : {};
        const nextMetadata = { ...existingMetadata };
        if (locationId) {
            nextMetadata.locationId = locationId;
            delete nextMetadata.locationID;
        } else {
            delete nextMetadata.locationId;
            delete nextMetadata.locationID;
        }
        if (ownerId) {
            nextMetadata.ownerId = ownerId;
            delete nextMetadata.owner;
            delete nextMetadata.ownerID;
        } else {
            delete nextMetadata.ownerId;
            delete nextMetadata.owner;
            delete nextMetadata.ownerID;
        }
        thing.metadata = nextMetadata;
    };

    const executeTeleportCharacterToLocationTool = ({
        character,
        location,
        region = null
    } = {}) => {
        const functionName = 'teleportCharacterToLocation';
        const characterQuery = normalizeRequiredString(character, { functionName, fieldName: 'character' });
        const locationQuery = normalizeRequiredString(location, { functionName, fieldName: 'location' });
        const regionQuery = normalizeOptionalString(region);

        const targetCharacter = resolveCharacterReference(characterQuery, { fieldName: 'character' });
        const destinationLocation = resolveLocationReference(locationQuery, {
            fieldName: 'location',
            regionQuery
        });

        const originLocation = getLocationByIdLoose(targetCharacter.currentLocation || null);
        const isNpc = Boolean(targetCharacter.isNPC);
        if (originLocation && destinationLocation.id && originLocation.id === destinationLocation.id) {
            const lines = [
                '<teleportCharacterToLocationResult>',
                '  <status>unchanged</status>',
                ...renderXmlNode('character', {
                    id: targetCharacter.id || null,
                    name: targetCharacter.name || null,
                    isNPC: isNpc
                }, 1),
                ...renderXmlNode('location', {
                    id: destinationLocation.id || null,
                    name: destinationLocation.name || null,
                    regionId: locationRegionId(destinationLocation),
                    regionName: locationRegionName(destinationLocation)
                }, 1),
                '</teleportCharacterToLocationResult>'
            ];
            return {
                content: lines.join('\n'),
                metadata: {
                    status: 'unchanged',
                    characterId: targetCharacter.id || null,
                    locationId: destinationLocation.id || null
                }
            };
        }

        if (isNpc && originLocation) {
            ensureLocationNpcMethod(originLocation, 'removeNpcId');
            originLocation.removeNpcId(targetCharacter.id);
        }
        if (isNpc) {
            ensureLocationNpcMethod(destinationLocation, 'addNpcId');
            destinationLocation.addNpcId(targetCharacter.id);
        }

        targetCharacter.setLocation(destinationLocation.id);
        const gameLocations = getGameLocations();
        if (gameLocations instanceof Map) {
            if (originLocation?.id) {
                gameLocations.set(originLocation.id, originLocation);
            }
            gameLocations.set(destinationLocation.id, destinationLocation);
        }

        const lines = [
            '<teleportCharacterToLocationResult>',
            '  <status>success</status>',
            ...renderXmlNode('character', {
                id: targetCharacter.id || null,
                name: targetCharacter.name || null,
                isNPC: isNpc
            }, 1),
            ...renderXmlNode('fromLocation', {
                id: originLocation?.id || null,
                name: toTrimmedString(originLocation?.name) || null,
                regionId: locationRegionId(originLocation),
                regionName: locationRegionName(originLocation)
            }, 1),
            ...renderXmlNode('toLocation', {
                id: destinationLocation.id || null,
                name: toTrimmedString(destinationLocation.name) || null,
                regionId: locationRegionId(destinationLocation),
                regionName: locationRegionName(destinationLocation)
            }, 1),
            '</teleportCharacterToLocationResult>'
        ];

        return {
            content: lines.join('\n'),
            metadata: {
                status: 'success',
                characterId: targetCharacter.id || null,
                originLocationId: originLocation?.id || null,
                destinationLocationId: destinationLocation.id || null
            }
        };
    };

    const executeTeleportThingToLocationTool = ({
        thing,
        location,
        region = null
    } = {}) => {
        const functionName = 'teleportThingToLocation';
        const thingQuery = normalizeRequiredString(thing, { functionName, fieldName: 'thing' });
        const locationQuery = normalizeRequiredString(location, { functionName, fieldName: 'location' });
        const regionQuery = normalizeOptionalString(region);

        const targetThing = resolveThingReference(thingQuery, { fieldName: 'thing' });
        const destinationLocation = resolveLocationReference(locationQuery, {
            fieldName: 'location',
            regionQuery
        });

        const allCharacters = getAllCharacters();
        const removedOwnerIds = [];
        for (const actor of allCharacters) {
            if (!actor || typeof actor.removeInventoryItem !== 'function') {
                continue;
            }
            const removed = actor.removeInventoryItem(targetThing.id, {
                suppressNpcEquip: Boolean(actor.isNPC)
            });
            if (removed && actor.id) {
                removedOwnerIds.push(actor.id);
                if (typeof actor.unequipItemId === 'function') {
                    actor.unequipItemId(targetThing.id, { suppressTimestamp: true });
                }
            }
        }

        const existingMetadata = targetThing.metadata && typeof targetThing.metadata === 'object'
            ? targetThing.metadata
            : {};
        const previousLocationId = toTrimmedString(existingMetadata.locationId || existingMetadata.locationID) || null;
        const previousLocationsById = new Map();
        if (previousLocationId) {
            const metadataLocation = getLocationByIdLoose(previousLocationId);
            if (metadataLocation?.id) {
                previousLocationsById.set(metadataLocation.id, metadataLocation);
            }
        }
        for (const candidateLocation of getAllLocations()) {
            if (!candidateLocation?.id || candidateLocation.id === destinationLocation.id) {
                continue;
            }
            if (Array.isArray(candidateLocation.thingIds) && candidateLocation.thingIds.includes(targetThing.id)) {
                previousLocationsById.set(candidateLocation.id, candidateLocation);
            }
        }
        for (const previousLocation of previousLocationsById.values()) {
            ensureLocationThingMethod(previousLocation, 'removeThingId');
            previousLocation.removeThingId(targetThing.id);
        }

        ensureLocationThingMethod(destinationLocation, 'addThingId');
        destinationLocation.addThingId(targetThing.id);
        updateThingLocationMetadata(targetThing, { locationId: destinationLocation.id, ownerId: null });

        const gameLocations = getGameLocations();
        if (gameLocations instanceof Map) {
            for (const previousLocation of previousLocationsById.values()) {
                if (previousLocation?.id) {
                    gameLocations.set(previousLocation.id, previousLocation);
                }
            }
            gameLocations.set(destinationLocation.id, destinationLocation);
        }

        const previousLocations = Array.from(previousLocationsById.values());
        const primaryPreviousLocation = previousLocations.length ? previousLocations[0] : null;

        const lines = [
            '<teleportThingToLocationResult>',
            '  <status>success</status>',
            ...renderXmlNode('thing', {
                id: targetThing.id || null,
                name: targetThing.name || null,
                thingType: targetThing.thingType || null
            }, 1),
            ...renderXmlNode('fromLocation', {
                id: primaryPreviousLocation?.id || null,
                name: toTrimmedString(primaryPreviousLocation?.name) || null
            }, 1),
            ...renderXmlNode('fromLocationIds', previousLocations.map(locationRecord => locationRecord.id), 1),
            ...renderXmlNode('toLocation', {
                id: destinationLocation.id || null,
                name: destinationLocation.name || null,
                regionId: locationRegionId(destinationLocation),
                regionName: locationRegionName(destinationLocation)
            }, 1),
            ...renderXmlNode('removedOwnerIds', removedOwnerIds, 1),
            '</teleportThingToLocationResult>'
        ];

        return {
            content: lines.join('\n'),
            metadata: {
                status: 'success',
                thingId: targetThing.id || null,
                previousLocationId: primaryPreviousLocation?.id || null,
                previousLocationIds: previousLocations.map(locationRecord => locationRecord.id),
                destinationLocationId: destinationLocation.id || null,
                removedOwnerIds
            }
        };
    };

    const executeMoveThingFromLocationToCharacterInventoryTool = ({
        thing,
        fromLocation,
        character,
        region = null
    } = {}) => {
        const functionName = 'moveThingFromLocationToCharacterInventory';
        const thingQuery = normalizeRequiredString(thing, { functionName, fieldName: 'thing' });
        const sourceLocationQuery = normalizeRequiredString(fromLocation, { functionName, fieldName: 'fromLocation' });
        const characterQuery = normalizeRequiredString(character, { functionName, fieldName: 'character' });
        const regionQuery = normalizeOptionalString(region);

        const targetThing = resolveThingReference(thingQuery, { fieldName: 'thing' });
        const sourceLocation = resolveLocationReference(sourceLocationQuery, {
            fieldName: 'fromLocation',
            regionQuery
        });
        const targetCharacter = resolveCharacterReference(characterQuery, { fieldName: 'character' });

        if (targetThing.thingType && targetThing.thingType !== 'item') {
            throw new ToolVisibleError(
                `Thing "${targetThing.name || targetThing.id}" is "${targetThing.thingType}" and cannot be moved into inventory.`,
                { code: 'thing_not_inventory_item' }
            );
        }

        if (typeof targetCharacter.addInventoryItem !== 'function' || typeof targetCharacter.hasInventoryItem !== 'function') {
            throw new Error(`Character "${targetCharacter.id || targetCharacter.name || 'unknown'}" cannot hold inventory items.`);
        }

        const metadata = targetThing.metadata && typeof targetThing.metadata === 'object'
            ? targetThing.metadata
            : {};
        const metadataLocationId = toTrimmedString(metadata.locationId || metadata.locationID) || null;
        const locationContainsThing = Array.isArray(sourceLocation.thingIds) && sourceLocation.thingIds.includes(targetThing.id);
        if (!locationContainsThing && metadataLocationId !== sourceLocation.id) {
            throw new ToolVisibleError(
                `Thing "${targetThing.name || targetThing.id}" is not currently at location "${sourceLocation.name || sourceLocation.id}".`,
                { code: 'thing_not_at_location' }
            );
        }

        const previousOwnerId = toTrimmedString(metadata.ownerId || metadata.owner || metadata.ownerID) || null;
        if (previousOwnerId && previousOwnerId !== targetCharacter.id) {
            const previousOwner = getAllCharacters().find(actor => toTrimmedString(actor?.id) === previousOwnerId) || null;
            if (previousOwner && typeof previousOwner.removeInventoryItem === 'function') {
                previousOwner.removeInventoryItem(targetThing.id, { suppressNpcEquip: Boolean(previousOwner.isNPC) });
            }
        }

        ensureLocationThingMethod(sourceLocation, 'removeThingId');
        sourceLocation.removeThingId(targetThing.id);
        targetCharacter.addInventoryItem(targetThing, { suppressNpcEquip: Boolean(targetCharacter.isNPC) });

        if (!targetCharacter.hasInventoryItem(targetThing.id)) {
            throw new Error(`Failed to add thing "${targetThing.id}" to character inventory.`);
        }

        updateThingLocationMetadata(targetThing, { locationId: null, ownerId: targetCharacter.id });
        const gameLocations = getGameLocations();
        if (gameLocations instanceof Map) {
            gameLocations.set(sourceLocation.id, sourceLocation);
        }

        const lines = [
            '<moveThingFromLocationToCharacterInventoryResult>',
            '  <status>success</status>',
            ...renderXmlNode('thing', {
                id: targetThing.id || null,
                name: targetThing.name || null
            }, 1),
            ...renderXmlNode('fromLocation', {
                id: sourceLocation.id || null,
                name: sourceLocation.name || null
            }, 1),
            ...renderXmlNode('character', {
                id: targetCharacter.id || null,
                name: targetCharacter.name || null
            }, 1),
            '</moveThingFromLocationToCharacterInventoryResult>'
        ];

        return {
            content: lines.join('\n'),
            metadata: {
                status: 'success',
                thingId: targetThing.id || null,
                sourceLocationId: sourceLocation.id || null,
                characterId: targetCharacter.id || null
            }
        };
    };

    const resolveOriginLocationForCreation = ({ originLocation = null, originRegion = null, functionName }) => {
        const originLocationQuery = normalizeOptionalString(originLocation);
        const originRegionQuery = normalizeOptionalString(originRegion);
        if (originLocationQuery) {
            return resolveLocationReference(originLocationQuery, {
                fieldName: 'originLocation',
                regionQuery: originRegionQuery
            });
        }
        const currentPlayer = getCurrentPlayer();
        if (!currentPlayer) {
            throw new ToolVisibleError(
                `${functionName} requires "originLocation" when there is no current player.`,
                { code: 'missing_origin_location' }
            );
        }
        const playerLocationId = toTrimmedString(currentPlayer.currentLocation || currentPlayer.locationId);
        if (!playerLocationId) {
            throw new ToolVisibleError(
                `${functionName} could not determine origin location from the current player.`,
                { code: 'missing_origin_location' }
            );
        }
        const resolved = getLocationByIdLoose(playerLocationId);
        if (!resolved) {
            throw new ToolVisibleError(
                `${functionName} could not find current player location "${playerLocationId}".`,
                { code: 'missing_origin_location' }
            );
        }
        return resolved;
    };

    const executeCreateRegionStubTool = async ({
        regionName,
        originLocation = null,
        originRegion = null,
        description = null,
        parentRegion = null,
        vehicleType = null,
        relativeLevel = null
    } = {}) => {
        const functionName = 'createRegionStub';
        const targetRegionName = normalizeRequiredString(regionName, { functionName, fieldName: 'regionName' });
        const originLocationRecord = resolveOriginLocationForCreation({
            originLocation,
            originRegion,
            functionName
        });
        const parentRegionQuery = normalizeOptionalString(parentRegion);
        const descriptionText = normalizeOptionalString(description);
        const vehicleTypeText = normalizeOptionalString(vehicleType);
        const relativeLevelValue = normalizeOptionalInteger(relativeLevel, {
            functionName,
            fieldName: 'relativeLevel'
        });

        const resolvedParentRegion = parentRegionQuery
            ? resolveRegionReference(parentRegionQuery, {
                fieldName: 'parentRegion',
                allowPending: true,
                allowMissing: false
            })
            : null;

        const pendingBefore = getPendingRegionStubs();
        const pendingRegionIdsBefore = pendingBefore instanceof Map
            ? new Set(Array.from(pendingBefore.keys()))
            : new Set();

        const regionEntryStub = await createRegionStubFromEvent({
            name: targetRegionName,
            originLocation: originLocationRecord,
            description: descriptionText,
            parentRegionId: resolvedParentRegion?.id || null,
            vehicleType: vehicleTypeText || null,
            isVehicle: Boolean(vehicleTypeText),
            relativeLevel: relativeLevelValue
        });

        if (!regionEntryStub) {
            throw new ToolVisibleError(
                `Unable to create region stub "${targetRegionName}".`,
                { code: 'region_stub_create_failed' }
            );
        }

        const stubMetadata = regionEntryStub.stubMetadata || {};
        const resolvedRegionId = toTrimmedString(stubMetadata.targetRegionId)
            || toTrimmedString(stubMetadata.regionId)
            || null;
        const regions = getRegionsMap();
        const pendingRegionStubs = getPendingRegionStubs();
        const resolvedRegionName = (resolvedRegionId && regions instanceof Map && regions.has(resolvedRegionId))
            ? (toTrimmedString(regions.get(resolvedRegionId)?.name) || resolvedRegionId)
            : ((resolvedRegionId && pendingRegionStubs instanceof Map && pendingRegionStubs.has(resolvedRegionId))
                ? (toTrimmedString(pendingRegionStubs.get(resolvedRegionId)?.name) || resolvedRegionId)
                : targetRegionName);
        const createdRegionStub = Boolean(
            resolvedRegionId
            && pendingRegionStubs instanceof Map
            && pendingRegionStubs.has(resolvedRegionId)
            && !pendingRegionIdsBefore.has(resolvedRegionId)
        );

        const lines = [
            '<createRegionStubResult>',
            '  <status>success</status>',
            ...renderXmlNode('originLocation', {
                id: originLocationRecord.id || null,
                name: originLocationRecord.name || null
            }, 1),
            ...renderXmlNode('region', {
                id: resolvedRegionId,
                name: resolvedRegionName,
                createdRegionStub
            }, 1),
            ...renderXmlNode('entryStubLocation', {
                id: regionEntryStub.id || null,
                name: regionEntryStub.name || null
            }, 1),
            '</createRegionStubResult>'
        ];

        return {
            content: lines.join('\n'),
            metadata: {
                status: 'success',
                originLocationId: originLocationRecord.id || null,
                regionId: resolvedRegionId,
                regionName: resolvedRegionName,
                createdRegionStub,
                entryStubLocationId: regionEntryStub.id || null
            }
        };
    };

    const executeCreateLocationStubTool = async ({
        locationName,
        originLocation = null,
        originRegion = null,
        description = null,
        targetRegion = null,
        vehicleType = null,
        relativeLevel = null
    } = {}) => {
        const functionName = 'createLocationStub';
        const targetLocationName = normalizeRequiredString(locationName, {
            functionName,
            fieldName: 'locationName'
        });
        const originLocationRecord = resolveOriginLocationForCreation({
            originLocation,
            originRegion,
            functionName
        });
        const descriptionText = normalizeOptionalString(description);
        const targetRegionQuery = normalizeOptionalString(targetRegion);
        const vehicleTypeText = normalizeOptionalString(vehicleType);
        const relativeLevelValue = normalizeOptionalInteger(relativeLevel, {
            functionName,
            fieldName: 'relativeLevel'
        });

        const resolvedTargetRegion = targetRegionQuery
            ? resolveRegionReference(targetRegionQuery, {
                fieldName: 'targetRegion',
                allowPending: false,
                allowMissing: false
            })
            : null;
        const targetRegionId = toTrimmedString(resolvedTargetRegion?.id) || null;

        let destinationLocation = resolveLocationReference(targetLocationName, {
            fieldName: 'locationName',
            regionQuery: targetRegionQuery,
            allowMissing: true
        });
        let createdLocationStub = false;

        if (!destinationLocation) {
            destinationLocation = await createLocationFromEvent({
                name: targetLocationName,
                originLocation: originLocationRecord,
                descriptionHint: descriptionText || targetLocationName,
                directionHint: null,
                expandStub: false,
                targetRegionId,
                vehicleType: vehicleTypeText || null,
                isVehicle: Boolean(vehicleTypeText),
                relativeLevel: relativeLevelValue
            });
            if (!destinationLocation) {
                throw new ToolVisibleError(
                    `Failed to create destination location stub "${targetLocationName}".`,
                    { code: 'location_stub_create_failed' }
                );
            }
            createdLocationStub = Boolean(destinationLocation.isStub);
        }

        const destinationRegionId = locationRegionId(destinationLocation);
        if (targetRegionId && destinationRegionId !== targetRegionId) {
            throw new ToolVisibleError(
                `Created or resolved location "${destinationLocation.name || destinationLocation.id}" is in region "${destinationRegionId || 'unknown'}", not requested target region "${targetRegionId}".`,
                { code: 'location_region_mismatch' }
            );
        }

        const originRegionId = locationRegionId(originLocationRecord);
        const destinationRegionForExit = destinationRegionId && destinationRegionId !== originRegionId
            ? destinationRegionId
            : null;
        ensureExitConnection(originLocationRecord, destinationLocation, {
            description: descriptionText || `${destinationLocation.name || destinationLocation.id}`,
            bidirectional: true,
            destinationRegion: destinationRegionForExit,
            isVehicle: Boolean(vehicleTypeText),
            vehicleType: vehicleTypeText || null
        });

        const lines = [
            '<createLocationStubResult>',
            '  <status>success</status>',
            ...renderXmlNode('originLocation', {
                id: originLocationRecord.id || null,
                name: originLocationRecord.name || null,
                regionId: locationRegionId(originLocationRecord),
                regionName: locationRegionName(originLocationRecord)
            }, 1),
            ...renderXmlNode('location', {
                id: destinationLocation.id || null,
                name: destinationLocation.name || null,
                regionId: destinationRegionId || null,
                regionName: locationRegionName(destinationLocation),
                createdLocationStub
            }, 1),
            '</createLocationStubResult>'
        ];

        return {
            content: lines.join('\n'),
            metadata: {
                status: 'success',
                originLocationId: originLocationRecord.id || null,
                locationId: destinationLocation.id || null,
                regionId: destinationRegionId || null,
                createdLocationStub
            }
        };
    };

    const resolveRegionEntranceLocation = (regionId) => {
        const regions = getRegionsMap();
        const pendingRegionStubs = getPendingRegionStubs();
        if (regions instanceof Map && regions.has(regionId)) {
            const region = regions.get(regionId);
            const entranceLocationId = toTrimmedString(region?.entranceLocationId)
                || (Array.isArray(region?.locationIds) ? toTrimmedString(region.locationIds[0]) : '');
            if (!entranceLocationId) {
                return null;
            }
            return getLocationByIdLoose(entranceLocationId);
        }
        if (pendingRegionStubs instanceof Map && pendingRegionStubs.has(regionId)) {
            const pending = pendingRegionStubs.get(regionId);
            const entranceStubId = toTrimmedString(pending?.entranceStubId);
            if (!entranceStubId) {
                return null;
            }
            return getLocationByIdLoose(entranceStubId);
        }
        return null;
    };

    const findExistingExitToDestination = (originLocation, {
        destinationLocationId = null,
        destinationRegionId = null
    } = {}) => {
        if (!originLocation || typeof originLocation.getAvailableDirections !== 'function' || typeof originLocation.getExit !== 'function') {
            return null;
        }
        const destinationId = toTrimmedString(destinationLocationId);
        if (!destinationId) {
            return null;
        }
        const normalizedDestinationRegionId = toTrimmedString(destinationRegionId) || null;

        const directions = originLocation.getAvailableDirections();
        for (const direction of directions) {
            const exit = originLocation.getExit(direction);
            if (!exit) {
                continue;
            }
            const exitDestinationId = toTrimmedString(exit.destination);
            if (exitDestinationId !== destinationId) {
                continue;
            }
            if (normalizedDestinationRegionId) {
                const exitDestinationRegionId = toTrimmedString(exit.destinationRegion) || null;
                if (exitDestinationRegionId && exitDestinationRegionId !== normalizedDestinationRegionId) {
                    continue;
                }
            }
            return { direction, exit };
        }

        return null;
    };

    const findExistingRegionExitByTargetName = (originLocation, rawRegionName) => {
        if (!originLocation || typeof originLocation.getAvailableDirections !== 'function' || typeof originLocation.getExit !== 'function') {
            return null;
        }
        const normalizedTargetName = toTrimmedString(rawRegionName).toLowerCase();
        if (!normalizedTargetName) {
            return null;
        }

        const regions = getRegionsMap();
        const pendingRegionStubs = getPendingRegionStubs();
        const directions = originLocation.getAvailableDirections();

        for (const direction of directions) {
            const exit = originLocation.getExit(direction);
            if (!exit) {
                continue;
            }

            const destinationRegionId = toTrimmedString(exit.destinationRegion) || null;
            if (destinationRegionId) {
                const pending = pendingRegionStubs instanceof Map ? pendingRegionStubs.get(destinationRegionId) : null;
                const pendingName = toTrimmedString(pending?.originalName || pending?.name).toLowerCase();
                if (pendingName && pendingName === normalizedTargetName) {
                    const destinationLocation = getLocationByIdLoose(exit.destination);
                    return { direction, exit, destinationLocation };
                }

                const destinationRegion = regions instanceof Map ? regions.get(destinationRegionId) : null;
                const destinationRegionName = toTrimmedString(destinationRegion?.name).toLowerCase();
                if (destinationRegionName && destinationRegionName === normalizedTargetName) {
                    const destinationLocation = getLocationByIdLoose(exit.destination);
                    return { direction, exit, destinationLocation };
                }
            }

            const destinationLocation = getLocationByIdLoose(exit.destination);
            const stubTargetName = toTrimmedString(destinationLocation?.stubMetadata?.targetRegionName).toLowerCase();
            if (stubTargetName && stubTargetName === normalizedTargetName) {
                return { direction, exit, destinationLocation };
            }
        }

        return null;
    };

    const executeCreateExitTool = async ({
        fromLocation,
        fromRegion = null,
        toLocation = null,
        toRegion = null,
        description = null,
        vehicleType = null,
        relativeLevel = null
    } = {}) => {
        const functionName = 'createExit';
        const fromLocationQuery = normalizeRequiredString(fromLocation, { functionName, fieldName: 'fromLocation' });
        const fromRegionQuery = normalizeOptionalString(fromRegion);
        const toLocationQuery = normalizeOptionalString(toLocation);
        const toRegionQuery = normalizeOptionalString(toRegion);
        const descriptionText = normalizeOptionalString(description);
        const vehicleTypeText = normalizeOptionalString(vehicleType);
        const relativeLevelValue = normalizeOptionalInteger(relativeLevel, {
            functionName,
            fieldName: 'relativeLevel'
        });

        if (!toLocationQuery && !toRegionQuery) {
            throw new ToolVisibleError(
                'createExit requires either "toLocation" or "toRegion".',
                { code: 'invalid_arguments' }
            );
        }
        if (toLocationQuery && toRegionQuery) {
            throw new ToolVisibleError(
                'createExit accepts either "toLocation" or "toRegion", not both in one call.',
                { code: 'invalid_arguments' }
            );
        }

        const originLocation = resolveLocationReference(fromLocationQuery, {
            fieldName: 'fromLocation',
            regionQuery: fromRegionQuery
        });
        const originRegionId = locationRegionId(originLocation);

        let destinationLocation = null;
        let destinationRegionId = null;
        let destinationKind = null;
        let createdLocationStub = false;
        let createdRegionStub = false;
        let duplicateIgnored = false;
        let duplicateExitId = null;

        if (toRegionQuery) {
            const resolvedRegion = resolveRegionReference(toRegionQuery, {
                fieldName: 'toRegion',
                allowPending: true,
                allowMissing: true
            });
            if (resolvedRegion) {
                destinationRegionId = resolvedRegion.id;
                destinationLocation = resolveRegionEntranceLocation(destinationRegionId);
                if (!destinationLocation) {
                    throw new ToolVisibleError(
                        `Region "${resolvedRegion.name}" has no reachable entrance location.`,
                        { code: 'region_missing_entrance' }
                    );
                }
                const existingExit = findExistingExitToDestination(originLocation, {
                    destinationLocationId: destinationLocation.id,
                    destinationRegionId
                });
                if (existingExit) {
                    duplicateIgnored = true;
                    duplicateExitId = toTrimmedString(existingExit.exit?.id) || null;
                } else {
                    ensureExitConnection(originLocation, destinationLocation, {
                        description: descriptionText || `${destinationLocation.name || destinationLocation.id}`,
                        bidirectional: true,
                        destinationRegion: destinationRegionId,
                        isVehicle: Boolean(vehicleTypeText),
                        vehicleType: vehicleTypeText || null
                    });
                }
            } else {
                const pendingBefore = getPendingRegionStubs();
                const pendingIdsBefore = pendingBefore instanceof Map
                    ? new Set(Array.from(pendingBefore.keys()))
                    : new Set();
                destinationLocation = await createRegionStubFromEvent({
                    name: toRegionQuery,
                    originLocation,
                    description: descriptionText,
                    vehicleType: vehicleTypeText || null,
                    isVehicle: Boolean(vehicleTypeText),
                    relativeLevel: relativeLevelValue
                });
                if (!destinationLocation) {
                    const existingRegionExit = findExistingRegionExitByTargetName(originLocation, toRegionQuery);
                    if (!existingRegionExit) {
                        throw new ToolVisibleError(
                            `Failed to create destination region stub "${toRegionQuery}".`,
                            { code: 'region_stub_create_failed' }
                        );
                    }
                    duplicateIgnored = true;
                    duplicateExitId = toTrimmedString(existingRegionExit.exit?.id) || null;
                    destinationLocation = existingRegionExit.destinationLocation || getLocationByIdLoose(existingRegionExit.exit?.destination);
                    destinationRegionId = toTrimmedString(existingRegionExit.exit?.destinationRegion)
                        || locationRegionId(destinationLocation)
                        || null;
                } else {
                    const metadata = destinationLocation.stubMetadata || {};
                    destinationRegionId = toTrimmedString(metadata.targetRegionId)
                        || toTrimmedString(metadata.regionId)
                        || null;
                    const pendingAfter = getPendingRegionStubs();
                    createdRegionStub = Boolean(
                        destinationRegionId
                        && pendingAfter instanceof Map
                        && pendingAfter.has(destinationRegionId)
                        && !pendingIdsBefore.has(destinationRegionId)
                    );
                    ensureExitConnection(originLocation, destinationLocation, {
                        description: descriptionText || `${destinationLocation.name || destinationLocation.id}`,
                        bidirectional: true,
                        destinationRegion: destinationRegionId,
                        isVehicle: Boolean(vehicleTypeText),
                        vehicleType: vehicleTypeText || null
                    });
                }
            }
            destinationKind = 'region';
        } else {
            destinationLocation = resolveLocationReference(toLocationQuery, {
                fieldName: 'toLocation',
                allowMissing: true
            });
            if (!destinationLocation) {
                destinationLocation = await createLocationFromEvent({
                    name: toLocationQuery,
                    originLocation,
                    descriptionHint: descriptionText || toLocationQuery,
                    directionHint: null,
                    expandStub: false,
                    targetRegionId: null,
                    vehicleType: vehicleTypeText || null,
                    isVehicle: Boolean(vehicleTypeText),
                    relativeLevel: relativeLevelValue
                });
                if (!destinationLocation) {
                    throw new ToolVisibleError(
                        `Failed to create destination location stub "${toLocationQuery}".`,
                        { code: 'location_stub_create_failed' }
                    );
                }
                createdLocationStub = Boolean(destinationLocation.isStub);
                const destinationLocationRegionId = locationRegionId(destinationLocation);
                const destinationRegionForExit = destinationLocationRegionId && destinationLocationRegionId !== originRegionId
                    ? destinationLocationRegionId
                    : null;
                ensureExitConnection(originLocation, destinationLocation, {
                    description: descriptionText || `${destinationLocation.name || destinationLocation.id}`,
                    bidirectional: true,
                    destinationRegion: destinationRegionForExit,
                    isVehicle: Boolean(vehicleTypeText),
                    vehicleType: vehicleTypeText || null
                });
            } else {
                const destinationLocationRegionId = locationRegionId(destinationLocation);
                const destinationRegionForExit = destinationLocationRegionId && destinationLocationRegionId !== originRegionId
                    ? destinationLocationRegionId
                    : null;
                const existingExit = findExistingExitToDestination(originLocation, {
                    destinationLocationId: destinationLocation.id,
                    destinationRegionId: destinationRegionForExit
                });
                if (existingExit) {
                    duplicateIgnored = true;
                    duplicateExitId = toTrimmedString(existingExit.exit?.id) || null;
                } else {
                    ensureExitConnection(originLocation, destinationLocation, {
                        description: descriptionText || `${destinationLocation.name || destinationLocation.id}`,
                        bidirectional: true,
                        destinationRegion: destinationRegionForExit,
                        isVehicle: Boolean(vehicleTypeText),
                        vehicleType: vehicleTypeText || null
                    });
                }
            }
            destinationKind = 'location';
            destinationRegionId = locationRegionId(destinationLocation);
        }

        const status = duplicateIgnored ? 'unchanged' : 'success';

        const lines = [
            '<createExitResult>',
            `  <status>${status}</status>`,
            ...renderXmlNode('originLocation', {
                id: originLocation.id || null,
                name: originLocation.name || null,
                regionId: locationRegionId(originLocation),
                regionName: locationRegionName(originLocation)
            }, 1),
            ...renderXmlNode('destination', {
                kind: destinationKind,
                locationId: destinationLocation?.id || null,
                locationName: destinationLocation?.name || null,
                regionId: destinationRegionId || null,
                regionName: locationRegionName(destinationLocation),
                createdLocationStub,
                createdRegionStub,
                duplicateIgnored,
                duplicateExitId
            }, 1),
            '</createExitResult>'
        ];

        return {
            content: lines.join('\n'),
            metadata: {
                status,
                originLocationId: originLocation.id || null,
                destinationKind,
                destinationLocationId: destinationLocation?.id || null,
                destinationRegionId: destinationRegionId || null,
                createdLocationStub,
                createdRegionStub,
                duplicateIgnored,
                duplicateExitId
            }
        };
    };

    const executeListLocationEntitiesTool = ({
        location,
        region = null,
        entityType = 'both'
    } = {}) => {
        const functionName = 'listLocationEntities';
        const locationQuery = normalizeRequiredString(location, { functionName, fieldName: 'location' });
        const regionQuery = normalizeOptionalString(region);
        const entityFilter = normalizeEntityTypeFilter(entityType);

        const targetLocation = resolveLocationReference(locationQuery, {
            fieldName: 'location',
            regionQuery
        });

        const includeCharacters = entityFilter === 'both' || entityFilter === 'characters';
        const includeThings = entityFilter === 'both' || entityFilter === 'things';

        const characterRows = [];
        if (includeCharacters) {
            const seenCharacterIds = new Set();
            const allCharacters = getAllCharacters();
            const currentPlayer = getCurrentPlayer();

            const addCharacter = (character, { inPlayerParty = false } = {}) => {
                if (!character || !character.id || seenCharacterIds.has(character.id)) {
                    return;
                }
                seenCharacterIds.add(character.id);
                const summary = describeLocationSummary(character.currentLocation || character.locationId || null);
                characterRows.push({
                    id: character.id,
                    name: character.name || character.id,
                    isNPC: Boolean(character.isNPC),
                    inPlayerParty: Boolean(inPlayerParty),
                    locationId: summary.locationId,
                    locationName: summary.locationName
                });
            };

            for (const character of allCharacters) {
                if (!character?.isNPC) {
                    continue;
                }
                const locationId = toTrimmedString(character.currentLocation || character.locationId);
                if (locationId && locationId === targetLocation.id) {
                    addCharacter(character, { inPlayerParty: false });
                }
            }

            const playerAtLocation = Boolean(currentPlayer && toTrimmedString(currentPlayer.currentLocation) === targetLocation.id);
            if (playerAtLocation && currentPlayer) {
                addCharacter(currentPlayer, { inPlayerParty: false });
                if (typeof currentPlayer.getPartyMembers === 'function') {
                    const partyMembers = currentPlayer.getPartyMembers();
                    const membersArray = Array.isArray(partyMembers)
                        ? partyMembers
                        : (partyMembers instanceof Set ? Array.from(partyMembers) : []);
                    for (const partyEntry of membersArray) {
                        if (!partyEntry) {
                            continue;
                        }
                        const partyMember = typeof partyEntry === 'string'
                            ? (allCharacters.find(character => character?.id === partyEntry) || null)
                            : partyEntry;
                        if (partyMember) {
                            addCharacter(partyMember, { inPlayerParty: true });
                        }
                    }
                }
            }

            characterRows.sort(candidateSort);
        }

        const thingRows = [];
        if (includeThings) {
            const allThings = getAllThings();
            const seenThingIds = new Set();
            if (Array.isArray(targetLocation.thingIds)) {
                for (const thingId of targetLocation.thingIds) {
                    const normalizedThingId = toTrimmedString(thingId);
                    if (!normalizedThingId) {
                        continue;
                    }
                    seenThingIds.add(normalizedThingId);
                }
            }

            for (const thingRecord of allThings) {
                const metadata = thingRecord?.metadata && typeof thingRecord.metadata === 'object'
                    ? thingRecord.metadata
                    : {};
                const thingLocationId = toTrimmedString(metadata.locationId || metadata.locationID);
                if (thingLocationId && thingLocationId === targetLocation.id) {
                    seenThingIds.add(toTrimmedString(thingRecord.id));
                }
            }

            for (const thingId of seenThingIds) {
                const thingRecord = allThings.find(entry => toTrimmedString(entry?.id) === thingId) || null;
                thingRows.push({
                    id: thingId,
                    name: toTrimmedString(thingRecord?.name) || thingId,
                    thingType: toTrimmedString(thingRecord?.thingType) || null
                });
            }
            thingRows.sort(candidateSort);
        }

        const lines = [
            '<listLocationEntitiesResult>',
            ...renderXmlNode('location', {
                id: targetLocation.id || null,
                name: targetLocation.name || null,
                regionId: locationRegionId(targetLocation),
                regionName: locationRegionName(targetLocation)
            }, 1),
            `  <characters count="${characterRows.length}">`
        ];
        for (const row of characterRows) {
            lines.push(...renderXmlNode('character', row, 2));
        }
        lines.push('  </characters>');
        lines.push(`  <things count="${thingRows.length}">`);
        for (const row of thingRows) {
            lines.push(...renderXmlNode('thing', row, 2));
        }
        lines.push('  </things>');
        lines.push('</listLocationEntitiesResult>');

        return {
            content: lines.join('\n'),
            metadata: {
                locationId: targetLocation.id || null,
                entityType: entityFilter,
                characterCount: characterRows.length,
                thingCount: thingRows.length
            }
        };
    };

    const executeCreateThingTool = async ({
        shortDescription,
        itemOrScenery,
        location = null,
        region = null,
        name = null,
        description = null,
        notes = null,
        type = null,
        slot = null,
        rarity = null,
        value = null,
        weight = null,
        relativeLevel = null,
        isVehicle = null,
        isCraftingStation = null,
        isProcessingStation = null,
        isHarvestable = null,
        isSalvageable = null,
        isContainer = null,
        attributeBonuses = null,
        causeStatusEffectOnTarget = null,
        causeStatusEffectOnEquipper = null,
        properties = null
    } = {}) => {
        const functionName = 'createThing';
        const shortDescriptionValue = normalizeRequiredString(shortDescription, {
            functionName,
            fieldName: 'shortDescription'
        });
        const itemOrSceneryValue = normalizeRequiredString(itemOrScenery, {
            functionName,
            fieldName: 'itemOrScenery'
        }).toLowerCase();
        if (itemOrSceneryValue !== 'item' && itemOrSceneryValue !== 'scenery') {
            throw new ToolVisibleError(
                'createThing "itemOrScenery" must be either "item" or "scenery".',
                { code: 'invalid_arguments' }
            );
        }

        const locationQuery = normalizeOptionalString(location);
        const regionQuery = normalizeOptionalString(region);
        let targetLocation = null;
        if (locationQuery) {
            targetLocation = resolveLocationReference(locationQuery, {
                fieldName: 'location',
                regionQuery
            });
        } else {
            const currentPlayer = getCurrentPlayer();
            if (!currentPlayer || !toTrimmedString(currentPlayer.currentLocation)) {
                throw new ToolVisibleError(
                    'createThing requires "location" when no current player location is available.',
                    { code: 'missing_location' }
                );
            }
            targetLocation = getLocationByIdLoose(currentPlayer.currentLocation);
            if (!targetLocation) {
                throw new ToolVisibleError(
                    `createThing could not find current player location "${currentPlayer.currentLocation}".`,
                    { code: 'missing_location' }
                );
            }
        }

        const normalizeEffect = (rawValue, fieldName) => {
            if (rawValue === null || rawValue === undefined || rawValue === '') {
                return null;
            }
            if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
                throw new ToolVisibleError(
                    `createThing "${fieldName}" must be an object when provided.`,
                    { code: 'invalid_arguments' }
                );
            }
            const effectName = normalizeOptionalString(rawValue.name);
            const effectDescription = normalizeOptionalString(rawValue.description);
            const effectDuration = normalizeOptionalString(rawValue.duration);
            if (!effectName && !effectDescription && !effectDuration) {
                return null;
            }
            return {
                name: effectName || '',
                description: effectDescription || '',
                duration: effectDuration || ''
            };
        };

        const seed = {
            shortDescription: shortDescriptionValue,
            itemOrScenery: itemOrSceneryValue
        };

        const requestedName = normalizeOptionalString(name);
        if (requestedName) seed.name = requestedName;
        const descriptionValue = normalizeOptionalString(description);
        if (descriptionValue) seed.description = descriptionValue;
        const notesValue = normalizeOptionalString(notes);
        if (notesValue) seed.notes = notesValue;
        const typeValue = normalizeOptionalString(type);
        if (typeValue) seed.type = typeValue;
        const slotValue = normalizeOptionalString(slot);
        if (slotValue) seed.slot = slotValue;
        const rarityValue = normalizeOptionalString(rarity);
        if (rarityValue) seed.rarity = rarityValue;

        const valueNumber = normalizeOptionalNumber(value, { functionName, fieldName: 'value' });
        if (valueNumber !== null) seed.value = valueNumber;
        const weightNumber = normalizeOptionalNumber(weight, { functionName, fieldName: 'weight' });
        if (weightNumber !== null) seed.weight = weightNumber;
        const relativeLevelInteger = normalizeOptionalInteger(relativeLevel, { functionName, fieldName: 'relativeLevel' });
        if (relativeLevelInteger !== null) seed.relativeLevel = relativeLevelInteger;

        const isVehicleValue = normalizeOptionalBoolean(isVehicle, { functionName, fieldName: 'isVehicle' });
        if (isVehicleValue !== null) seed.isVehicle = isVehicleValue;
        const isCraftingStationValue = normalizeOptionalBoolean(isCraftingStation, { functionName, fieldName: 'isCraftingStation' });
        if (isCraftingStationValue !== null) seed.isCraftingStation = isCraftingStationValue;
        const isProcessingStationValue = normalizeOptionalBoolean(isProcessingStation, { functionName, fieldName: 'isProcessingStation' });
        if (isProcessingStationValue !== null) seed.isProcessingStation = isProcessingStationValue;
        const isHarvestableValue = normalizeOptionalBoolean(isHarvestable, { functionName, fieldName: 'isHarvestable' });
        if (isHarvestableValue !== null) seed.isHarvestable = isHarvestableValue;
        const isSalvageableValue = normalizeOptionalBoolean(isSalvageable, { functionName, fieldName: 'isSalvageable' });
        if (isSalvageableValue !== null) seed.isSalvageable = isSalvageableValue;
        const isContainerValue = normalizeOptionalBoolean(isContainer, { functionName, fieldName: 'isContainer' });
        if (isContainerValue !== null) seed.isContainer = isContainerValue;

        if (attributeBonuses !== null && attributeBonuses !== undefined) {
            if (!Array.isArray(attributeBonuses)) {
                throw new ToolVisibleError(
                    'createThing "attributeBonuses" must be an array when provided.',
                    { code: 'invalid_arguments' }
                );
            }
            seed.attributeBonuses = attributeBonuses.map((entry, index) => {
                if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                    throw new ToolVisibleError(
                        `createThing "attributeBonuses[${index}]" must be an object.`,
                        { code: 'invalid_arguments' }
                    );
                }
                const attributeName = normalizeRequiredString(entry.attribute, {
                    functionName,
                    fieldName: `attributeBonuses[${index}].attribute`
                });
                const bonusValue = normalizeOptionalNumber(entry.bonus, {
                    functionName,
                    fieldName: `attributeBonuses[${index}].bonus`
                });
                if (bonusValue === null) {
                    throw new ToolVisibleError(
                        `createThing "attributeBonuses[${index}].bonus" is required.`,
                        { code: 'invalid_arguments' }
                    );
                }
                return { attribute: attributeName, bonus: bonusValue };
            });
        }

        const effectOnTarget = normalizeEffect(causeStatusEffectOnTarget, 'causeStatusEffectOnTarget');
        if (effectOnTarget) seed.causeStatusEffectOnTarget = effectOnTarget;
        const effectOnEquipper = normalizeEffect(causeStatusEffectOnEquipper, 'causeStatusEffectOnEquipper');
        if (effectOnEquipper) seed.causeStatusEffectOnEquipper = effectOnEquipper;
        const propertiesValue = normalizeOptionalString(properties);
        if (propertiesValue) seed.properties = propertiesValue;

        const targetRegion = findRegionByLocationId(targetLocation.id) || null;
        const generated = await generateItemsByNames({
            itemNames: requestedName ? [requestedName] : [],
            location: targetLocation,
            owner: null,
            region: targetRegion,
            seeds: [seed],
            options: itemOrSceneryValue === 'scenery' ? { treatAsScenery: true } : {}
        });

        if (!Array.isArray(generated) || !generated.length) {
            throw new ToolVisibleError(
                'Thing generation did not return a created thing.',
                { code: 'thing_generation_failed' }
            );
        }

        const createdThing = generated[0];
        const finalName = normalizeOptionalString(createdThing?.name);
        if (!finalName) {
            throw new ToolVisibleError(
                'Thing generation completed but final name is missing.',
                { code: 'thing_generation_failed' }
            );
        }

        const lines = [
            '<createThingResult>',
            '  <status>success</status>',
            ...renderXmlNode('thing', {
                id: createdThing?.id || null,
                requestedName: requestedName || null,
                finalName,
                thingType: createdThing?.thingType || null,
                locationId: targetLocation.id || null,
                locationName: targetLocation.name || null,
                regionId: locationRegionId(targetLocation),
                regionName: locationRegionName(targetLocation)
            }, 1),
            '</createThingResult>'
        ];

        return {
            content: lines.join('\n'),
            metadata: {
                status: 'success',
                thingId: createdThing?.id || null,
                requestedName: requestedName || null,
                finalName,
                thingType: createdThing?.thingType || null,
                locationId: targetLocation.id || null
            }
        };
    };

    const executeAlterThingTool = async ({
        thing,
        alteration
    } = {}) => {
        const functionName = 'alterThing';
        const thingQuery = normalizeRequiredString(thing, {
            functionName,
            fieldName: 'thing'
        });
        const changeDescription = normalizeRequiredString(alteration, {
            functionName,
            fieldName: 'alteration'
        });

        if (typeof alterThingByPrompt !== 'function') {
            throw new ToolVisibleError(
                'alterThing is unavailable because the alteration helper was not configured.',
                { code: 'missing_dependency' }
            );
        }

        const targetThing = resolveThingReference(thingQuery, { fieldName: 'thing' });
        const outcome = await alterThingByPrompt({
            thing: targetThing,
            changeDescription,
            newName: null
        });

        if (!outcome || typeof outcome !== 'object') {
            throw new ToolVisibleError(
                'alterThing completed without returning an alteration result.',
                { code: 'alteration_failed' }
            );
        }

        const alteredThing = outcome.thing || targetThing;
        const originalName = normalizeOptionalString(outcome.originalName) || normalizeOptionalString(targetThing?.name);
        const newName = normalizeOptionalString(outcome.newName) || normalizeOptionalString(alteredThing?.name) || originalName;
        const thingId = normalizeOptionalString(alteredThing?.id) || normalizeOptionalString(targetThing?.id);
        const thingType = normalizeOptionalString(alteredThing?.thingType) || normalizeOptionalString(targetThing?.thingType);

        const lines = [
            '<alterThingResult>',
            '  <status>success</status>',
            ...renderXmlNode('thing', {
                id: thingId,
                originalName,
                newName,
                thingType
            }, 1),
            ...renderXmlNode('alteration', changeDescription, 1),
            '</alterThingResult>'
        ];

        return {
            content: lines.join('\n'),
            metadata: {
                status: 'success',
                thingId,
                originalName,
                newName,
                thingType,
                changeDescription
            }
        };
    };

    const isNpcEntity = (character) => {
        if (!character) {
            return false;
        }
        if (typeof character.isNPC === 'function') {
            return Boolean(character.isNPC());
        }
        return Boolean(character.isNPC);
    };

    const isPlainObject = (value) => (
        value !== null
        && typeof value === 'object'
        && !Array.isArray(value)
    );

    const normalizeCharacterFieldString = (value, { functionName, fieldName, allowNullAsEmpty = true, requireNonEmpty = false } = {}) => {
        if (value === null && allowNullAsEmpty) {
            if (requireNonEmpty) {
                throw new ToolVisibleError(
                    `${functionName} "${fieldName}" must be a non-empty string.`,
                    { code: 'invalid_arguments' }
                );
            }
            return '';
        }
        if (typeof value !== 'string') {
            throw new ToolVisibleError(
                `${functionName} "${fieldName}" must be a string.`,
                { code: 'invalid_arguments' }
            );
        }
        if (requireNonEmpty && !value.trim()) {
            throw new ToolVisibleError(
                `${functionName} "${fieldName}" must be a non-empty string.`,
                { code: 'invalid_arguments' }
            );
        }
        return requireNonEmpty ? value.trim() : value;
    };

    const normalizeCharacterFieldNumber = (value, { functionName, fieldName, integer = false, min = null, max = null } = {}) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || (integer && !Number.isInteger(numeric))) {
            throw new ToolVisibleError(
                `${functionName} "${fieldName}" must be a finite ${integer ? 'integer' : 'number'}.`,
                { code: 'invalid_arguments' }
            );
        }
        if (min !== null && numeric < min) {
            throw new ToolVisibleError(
                `${functionName} "${fieldName}" must be at least ${min}.`,
                { code: 'invalid_arguments' }
            );
        }
        if (max !== null && numeric > max) {
            throw new ToolVisibleError(
                `${functionName} "${fieldName}" must be at most ${max}.`,
                { code: 'invalid_arguments' }
            );
        }
        return numeric;
    };

    const normalizeCharacterFieldBoolean = (value, { functionName, fieldName } = {}) => {
        if (typeof value !== 'boolean') {
            throw new ToolVisibleError(
                `${functionName} "${fieldName}" must be a boolean.`,
                { code: 'invalid_arguments' }
            );
        }
        return value;
    };

    const normalizeCharacterFieldArrayOfStrings = (value, { functionName, fieldName } = {}) => {
        if (!Array.isArray(value)) {
            throw new ToolVisibleError(
                `${functionName} "${fieldName}" must be an array of strings.`,
                { code: 'invalid_arguments' }
            );
        }
        const invalid = value.some(entry => typeof entry !== 'string');
        if (invalid) {
            throw new ToolVisibleError(
                `${functionName} "${fieldName}" must only contain strings.`,
                { code: 'invalid_arguments' }
            );
        }
        return value;
    };

    const normalizeCharacterFieldMap = (value, { functionName, fieldName } = {}) => {
        if (!isPlainObject(value)) {
            throw new ToolVisibleError(
                `${functionName} "${fieldName}" must be an object.`,
                { code: 'invalid_arguments' }
            );
        }
        return value;
    };

    const makeUpdateCharacterFieldOperations = (targetNpc, fieldsObject, { functionName } = {}) => {
        if (!isPlainObject(fieldsObject)) {
            throw new ToolVisibleError(
                `${functionName} requires "fields" to be an object.`,
                { code: 'invalid_arguments' }
            );
        }

        const fieldEntries = Object.entries(fieldsObject);
        if (!fieldEntries.length) {
            throw new ToolVisibleError(
                `${functionName} requires at least one field to update.`,
                { code: 'invalid_arguments' }
            );
        }

        for (const [fieldName] of fieldEntries) {
            if (!UPDATE_CHARACTER_FIELD_SET.has(fieldName)) {
                throw new ToolVisibleError(
                    `${functionName} cannot update field "${fieldName}". Allowed fields: ${UPDATE_CHARACTER_FIELD_NAMES.join(', ')}.`,
                    {
                        code: 'unsupported_field',
                        details: { fieldName }
                    }
                );
            }
        }

        const operations = [];
        const addOperation = (fieldName, apply) => {
            operations.push({ fieldName, apply });
        };

        for (const [fieldName, rawValue] of fieldEntries) {
            switch (fieldName) {
                case 'name': {
                    const value = normalizeCharacterFieldString(rawValue, {
                        functionName,
                        fieldName,
                        requireNonEmpty: true
                    });
                    if (typeof targetNpc.setName !== 'function') {
                        throw new ToolVisibleError(`${functionName} cannot update "name" on this NPC.`, { code: 'unsupported_field' });
                    }
                    addOperation(fieldName, () => targetNpc.setName(value));
                    break;
                }
                case 'description':
                case 'shortDescription':
                case 'race':
                case 'class':
                case 'gender':
                case 'personalityType':
                case 'personalityTraits':
                case 'personalityNotes':
                case 'aiNotes':
                case 'resistances':
                case 'vulnerabilities': {
                    const value = normalizeCharacterFieldString(rawValue, { functionName, fieldName });
                    addOperation(fieldName, () => {
                        targetNpc[fieldName] = value;
                    });
                    break;
                }
                case 'factionId': {
                    const value = rawValue === null
                        ? null
                        : normalizeCharacterFieldString(rawValue, { functionName, fieldName, requireNonEmpty: false });
                    addOperation(fieldName, () => {
                        targetNpc.factionId = value;
                    });
                    break;
                }
                case 'level': {
                    const value = normalizeCharacterFieldNumber(rawValue, {
                        functionName,
                        fieldName,
                        integer: true,
                        min: 1,
                        max: 20
                    });
                    if (typeof targetNpc.setLevel !== 'function') {
                        throw new ToolVisibleError(`${functionName} cannot update "level" on this NPC.`, { code: 'unsupported_field' });
                    }
                    addOperation(fieldName, () => targetNpc.setLevel(value));
                    break;
                }
                case 'health': {
                    const value = normalizeCharacterFieldNumber(rawValue, {
                        functionName,
                        fieldName,
                        min: 0
                    });
                    if (typeof targetNpc.setHealth !== 'function') {
                        throw new ToolVisibleError(`${functionName} cannot update "health" on this NPC.`, { code: 'unsupported_field' });
                    }
                    addOperation(fieldName, () => targetNpc.setHealth(value));
                    break;
                }
                case 'healthAttribute': {
                    const value = normalizeCharacterFieldString(rawValue, {
                        functionName,
                        fieldName,
                        requireNonEmpty: true
                    });
                    if (typeof targetNpc.setHealthAttribute !== 'function') {
                        throw new ToolVisibleError(`${functionName} cannot update "healthAttribute" on this NPC.`, { code: 'unsupported_field' });
                    }
                    addOperation(fieldName, () => targetNpc.setHealthAttribute(value));
                    break;
                }
                case 'currency':
                case 'experience': {
                    const value = normalizeCharacterFieldNumber(rawValue, {
                        functionName,
                        fieldName,
                        integer: true,
                        min: 0
                    });
                    const setterName = fieldName === 'currency' ? 'setCurrency' : 'setExperience';
                    if (typeof targetNpc[setterName] !== 'function') {
                        throw new ToolVisibleError(`${functionName} cannot update "${fieldName}" on this NPC.`, { code: 'unsupported_field' });
                    }
                    addOperation(fieldName, () => targetNpc[setterName](value));
                    break;
                }
                case 'isDead':
                case 'isHostile': {
                    const value = normalizeCharacterFieldBoolean(rawValue, { functionName, fieldName });
                    addOperation(fieldName, () => {
                        targetNpc[fieldName] = value;
                    });
                    break;
                }
                case 'willingToTrade': {
                    const value = normalizeCharacterFieldBoolean(rawValue, { functionName, fieldName });
                    addOperation(fieldName, () => {
                        if (typeof targetNpc.setWillingToTrade === 'function') {
                            targetNpc.setWillingToTrade(value);
                        } else {
                            targetNpc.willingToTrade = value;
                        }
                    });
                    break;
                }
                case 'aliases': {
                    const value = normalizeCharacterFieldArrayOfStrings(rawValue, { functionName, fieldName });
                    if (typeof targetNpc.setAliases !== 'function') {
                        throw new ToolVisibleError(`${functionName} cannot update "aliases" on this NPC.`, { code: 'unsupported_field' });
                    }
                    addOperation(fieldName, () => targetNpc.setAliases(value));
                    break;
                }
                case 'attributes': {
                    const attributeMap = normalizeCharacterFieldMap(rawValue, { functionName, fieldName });
                    if (typeof targetNpc.setAttribute !== 'function') {
                        throw new ToolVisibleError(`${functionName} cannot update "attributes" on this NPC.`, { code: 'unsupported_field' });
                    }
                    for (const [rawAttributeName, rawAttributeValue] of Object.entries(attributeMap)) {
                        const attributeName = normalizeCharacterFieldString(rawAttributeName, {
                            functionName,
                            fieldName: 'attributes key',
                            requireNonEmpty: true
                        });
                        const value = normalizeCharacterFieldNumber(rawAttributeValue, {
                            functionName,
                            fieldName: `attributes.${attributeName}`
                        });
                        if (typeof targetNpc.getAttributeDefinition === 'function' && !targetNpc.getAttributeDefinition(attributeName)) {
                            throw new ToolVisibleError(
                                `${functionName} cannot update unknown attribute "${attributeName}".`,
                                { code: 'invalid_arguments' }
                            );
                        }
                        addOperation(`attributes.${attributeName}`, () => targetNpc.setAttribute(attributeName, value));
                    }
                    break;
                }
                case 'skills': {
                    const skillMap = normalizeCharacterFieldMap(rawValue, { functionName, fieldName });
                    if (typeof targetNpc.setSkillValue !== 'function') {
                        throw new ToolVisibleError(`${functionName} cannot update "skills" on this NPC.`, { code: 'unsupported_field' });
                    }
                    for (const [rawSkillName, rawSkillValue] of Object.entries(skillMap)) {
                        const skillName = normalizeCharacterFieldString(rawSkillName, {
                            functionName,
                            fieldName: 'skills key',
                            requireNonEmpty: true
                        });
                        const value = normalizeCharacterFieldNumber(rawSkillValue, {
                            functionName,
                            fieldName: `skills.${skillName}`
                        });
                        if (Player?.availableSkills instanceof Map && Player.availableSkills.size > 0 && !Player.availableSkills.has(skillName)) {
                            throw new ToolVisibleError(
                                `${functionName} cannot update unknown skill "${skillName}".`,
                                { code: 'invalid_arguments' }
                            );
                        }
                        addOperation(`skills.${skillName}`, () => {
                            const updated = targetNpc.setSkillValue(skillName, value);
                            if (updated === false) {
                                throw new Error(`Failed to set skill "${skillName}".`);
                            }
                            return updated;
                        });
                    }
                    break;
                }
                case 'statusEffects': {
                    if (!Array.isArray(rawValue)) {
                        throw new ToolVisibleError(
                            `${functionName} "statusEffects" must be an array.`,
                            { code: 'invalid_arguments' }
                        );
                    }
                    if (typeof targetNpc.setStatusEffects !== 'function') {
                        throw new ToolVisibleError(`${functionName} cannot update "statusEffects" on this NPC.`, { code: 'unsupported_field' });
                    }
                    addOperation(fieldName, () => targetNpc.setStatusEffects(rawValue));
                    break;
                }
                case 'needBarApplicability': {
                    const value = normalizeCharacterFieldMap(rawValue, { functionName, fieldName });
                    if (typeof targetNpc.setNeedBarApplicability !== 'function') {
                        throw new ToolVisibleError(`${functionName} cannot update "needBarApplicability" on this NPC.`, { code: 'unsupported_field' });
                    }
                    addOperation(fieldName, () => targetNpc.setNeedBarApplicability(value));
                    break;
                }
                default:
                    throw new ToolVisibleError(
                        `${functionName} cannot update field "${fieldName}".`,
                        { code: 'unsupported_field' }
                    );
            }
        }

        if (!operations.length) {
            throw new ToolVisibleError(
                `${functionName} did not receive any concrete field updates.`,
                { code: 'invalid_arguments' }
            );
        }
        return operations;
    };

    const normalizeUpdateObjectType = (rawObjectType, { functionName } = {}) => {
        const raw = normalizeRequiredString(rawObjectType, {
            functionName,
            fieldName: 'objectType'
        });
        const lower = raw.toLowerCase();
        const canonical = Object.entries(UPDATE_OBJECT_TYPE_ALIASES)
            .find(([alias]) => alias.toLowerCase() === lower)?.[1] || null;
        if (!canonical) {
            throw new ToolVisibleError(
                `${functionName} received unsupported objectType "${raw}". Allowed object types: ${UPDATE_OBJECT_TYPE_VALUES.join(', ')}.`,
                { code: 'invalid_arguments' }
            );
        }
        return canonical;
    };

    const serializeUpdateObjectRecord = (record) => {
        const source = record && typeof record.toJSON === 'function'
            ? record.toJSON()
            : record;
        if (source === null || source === undefined) {
            return null;
        }
        try {
            return JSON.parse(JSON.stringify(source, (key, value) => (
                typeof value === 'function' ? undefined : value
            )));
        } catch {
            return {
                id: toTrimmedString(record?.id) || null,
                name: toTrimmedString(record?.name) || null
            };
        }
    };

    const compactMoreInfoRecord = (value) => {
        if (Array.isArray(value)) {
            return value.map(entry => compactMoreInfoRecord(entry));
        }
        if (!value || typeof value !== 'object') {
            return value;
        }

        const compacted = {};
        for (const [key, entryValue] of Object.entries(value)) {
            if (MORE_INFO_COMPACT_OMITTED_FIELDS.has(key)) {
                continue;
            }
            compacted[key] = compactMoreInfoRecord(entryValue);
        }
        return compacted;
    };

    const serializeMoreInfoRecord = (record, { includeFullState = false } = {}) => {
        const serialized = serializeUpdateObjectRecord(record);
        if (!serialized || includeFullState) {
            return serialized;
        }
        return compactMoreInfoRecord(serialized);
    };

    const buildUpdateObjectCandidate = (target) => ({
        objectType: target.objectType,
        id: target.id || null,
        name: target.name || null,
        ownerType: target.ownerType || null,
        ownerId: target.ownerId || null,
        ownerName: target.ownerName || null,
        toJSON: serializeUpdateObjectRecord(target.record)
    });

    const getRecordId = (record) => toTrimmedString(record?.id) || null;
    const getRecordName = (record) => toTrimmedString(record?.name) || null;

    const makeUpdateObjectTarget = ({
        objectType,
        record,
        ownerType = null,
        owner = null,
        ownerName = null,
        aliases = [],
        applyReplacement = null
    } = {}) => ({
        objectType,
        record,
        id: getRecordId(record),
        name: getRecordName(record),
        ownerType,
        ownerId: getRecordId(owner),
        ownerName: ownerName || getRecordName(owner),
        aliases: toSearchableValues(aliases),
        applyReplacement
    });

    const collectExitUpdateTargets = () => {
        const targets = [];
        const seen = new Set();
        for (const location of getAllLocations()) {
            const directions = typeof location?.getAvailableDirections === 'function'
                ? location.getAvailableDirections()
                : Object.keys(location?.exits || {});
            for (const direction of directions || []) {
                const exit = typeof location?.getExit === 'function'
                    ? location.getExit(direction)
                    : location?.exits?.[direction];
                if (!exit) {
                    continue;
                }
                const id = getRecordId(exit) || `${getRecordId(location) || 'unknown'}:${toTrimmedString(direction)}`;
                if (seen.has(id)) {
                    continue;
                }
                seen.add(id);
                const aliases = [direction, exit.description, exit.destination, exit.name].filter(Boolean);
                targets.push(makeUpdateObjectTarget({
                    objectType: 'exit',
                    record: exit,
                    ownerType: 'location',
                    owner: location,
                    aliases
                }));
            }
        }
        return targets;
    };

    const collectRegionUpdateTargets = () => {
        const targets = [];
        const seen = new Set();
        const addRegion = (region) => {
            const id = getRecordId(region);
            if (!id || seen.has(id)) {
                return;
            }
            seen.add(id);
            targets.push(makeUpdateObjectTarget({ objectType: 'region', record: region }));
        };
        const regions = getRegionsMap();
        if (regions instanceof Map) {
            for (const region of regions.values()) {
                addRegion(region);
            }
        }
        const pendingStubs = getPendingRegionStubs();
        if (pendingStubs instanceof Map) {
            for (const stub of pendingStubs.values()) {
                addRegion(stub);
            }
        }
        return targets;
    };

    const collectQuestUpdateTargets = () => {
        const targets = [];
        const seen = new Set();
        const currentPlayer = getCurrentPlayer();
        const questOwners = currentPlayer
            ? [currentPlayer]
            : getAllCharacters().filter(character => !isNpcEntity(character));
        for (const character of questOwners) {
            const quests = [];
            if (typeof character?.getCurrentQuests === 'function') {
                quests.push(...character.getCurrentQuests());
            }
            if (typeof character?.getCompletedQuests === 'function') {
                quests.push(...character.getCompletedQuests());
            }
            if (Array.isArray(character?.quests)) {
                quests.push(...character.quests);
            }
            for (const quest of quests) {
                const id = getRecordId(quest);
                if (!id || seen.has(id)) {
                    continue;
                }
                seen.add(id);
                targets.push(makeUpdateObjectTarget({
                    objectType: 'quest',
                    record: quest,
                    ownerType: isNpcEntity(character) ? 'npc' : 'player',
                    owner: character
                }));
            }
        }
        return targets;
    };

    const collectObjectiveUpdateTargets = () => {
        const targets = [];
        const seen = new Set();
        for (const questTarget of collectQuestUpdateTargets()) {
            const objectives = Array.isArray(questTarget.record?.objectives)
                ? questTarget.record.objectives
                : [];
            for (const objective of objectives) {
                const id = getRecordId(objective);
                if (!id || seen.has(id)) {
                    continue;
                }
                seen.add(id);
                targets.push(makeUpdateObjectTarget({
                    objectType: 'objective',
                    record: objective,
                    ownerType: 'quest',
                    owner: questTarget.record,
                    ownerName: questTarget.name
                }));
            }
        }
        return targets;
    };

    const collectStatusEffectsForOwner = (ownerType, owner) => {
        if (!owner) {
            return [];
        }
        let effects = [];
        if (typeof owner.getIntrinsicStatusEffects === 'function') {
            effects = owner.getIntrinsicStatusEffects();
        } else if (typeof owner.getStatusEffects === 'function') {
            effects = owner.getStatusEffects();
        } else if (Array.isArray(owner.statusEffects)) {
            effects = owner.statusEffects;
        }
        if (!Array.isArray(effects)) {
            return [];
        }
        return effects
            .map((effect, index) => {
                if (!effect || typeof effect !== 'object') {
                    return null;
                }
                return makeUpdateObjectTarget({
                    objectType: 'statusEffect',
                    record: { ...effect },
                    ownerType,
                    owner,
                    applyReplacement: (updatedEffect) => {
                        const next = effects.map((entry, entryIndex) => (
                            entryIndex === index ? { ...updatedEffect } : entry
                        ));
                        if (typeof owner.setStatusEffects === 'function') {
                            owner.setStatusEffects(next);
                        } else {
                            owner.statusEffects = next;
                        }
                        effects = next;
                    }
                });
            })
            .filter(Boolean);
    };

    const collectStatusEffectUpdateTargets = () => ([
        ...getAllCharacters().flatMap(character => collectStatusEffectsForOwner(
            isNpcEntity(character) ? 'npc' : 'player',
            character
        )),
        ...getAllThings().flatMap(thing => collectStatusEffectsForOwner('thing', thing)),
        ...getAllLocations().flatMap(location => collectStatusEffectsForOwner('location', location)),
        ...collectRegionUpdateTargets().flatMap(regionTarget => collectStatusEffectsForOwner('region', regionTarget.record))
    ]);

    const collectUpdateObjectTargets = (objectType) => {
        switch (objectType) {
            case 'character':
                return getAllCharacters().map(character => makeUpdateObjectTarget({
                    objectType,
                    record: character,
                    aliases: npcAliasesForMatching(character)
                }));
            case 'thing':
                return getAllThings().map(thing => makeUpdateObjectTarget({ objectType, record: thing }));
            case 'location':
                return getAllLocations().map(location => makeUpdateObjectTarget({ objectType, record: location }));
            case 'exit':
                return collectExitUpdateTargets();
            case 'region':
                return collectRegionUpdateTargets();
            case 'faction': {
                const factions = getFactions();
                return factions instanceof Map
                    ? Array.from(factions.values()).filter(Boolean).map(faction => makeUpdateObjectTarget({ objectType, record: faction }))
                    : [];
            }
            case 'quest':
                return collectQuestUpdateTargets();
            case 'objective':
                return collectObjectiveUpdateTargets();
            case 'statusEffect':
                return collectStatusEffectUpdateTargets();
            default:
                return [];
        }
    };

    const resolveUpdateObjectTarget = (objectType, rawQuery, { functionName } = {}) => {
        const query = normalizeRequiredString(rawQuery, {
            functionName,
            fieldName: 'object'
        });
        const lowerQuery = query.toLowerCase();
        const targets = collectUpdateObjectTargets(objectType);
        const idMatches = targets.filter(target => target.id === query);
        const matchesById = idMatches.length ? idMatches : [];
        const exactMatches = targets.filter(target => {
            if (toTrimmedString(target.name).toLowerCase() === lowerQuery) {
                return true;
            }
            return target.aliases.some(alias => alias.toLowerCase() === lowerQuery);
        });
        const includesMatches = targets.filter(target => (
            toTrimmedString(target.name).toLowerCase().includes(lowerQuery)
        ));
        const matches = matchesById.length
            ? matchesById
            : (exactMatches.length ? exactMatches : includesMatches);

        if (!matches.length) {
            throw new ToolVisibleError(
                `No ${objectType} matches "${query}".`,
                { code: 'object_not_found' }
            );
        }

        if (matches.length > 1) {
            throw new ToolVisibleError(
                `Multiple ${objectType} matches found for "${query}". Call updateObjectFields again with the exact id from one candidate.`,
                {
                    code: 'ambiguous_object',
                    candidates: matches
                        .map(buildUpdateObjectCandidate)
                        .sort(candidateSort)
                }
            );
        }

        const target = matches[0];
        if (objectType === 'character' && !isNpcEntity(target.record)) {
            throw new ToolVisibleError(
                `updateObjectFields can only update NPC characters; "${target.name || query}" is not an NPC.`,
                { code: 'invalid_target' }
            );
        }
        return target;
    };

    const normalizeUpdateObjectFieldValue = (rawValue, { functionName, objectType, fieldName } = {}) => {
        const stringFields = new Set([
            'name',
            'description',
            'shortDescription',
            'race',
            'class',
            'gender',
            'healthAttribute',
            'factionId',
            'personalityType',
            'personalityTraits',
            'personalityNotes',
            'aiNotes',
            'resistances',
            'vulnerabilities',
            'thingType',
            'rarity',
            'itemTypeDetail',
            'slot',
            'controllingFactionId',
            'parentRegionId',
            'entranceLocationId',
            'weather',
            'homeRegionName',
            'giverId',
            'giverName',
            'imageId',
            'vehicleType'
        ]);
        const requiredStringFields = new Set(['name', 'destination']);
        const numberFields = new Set([
            'level',
            'health',
            'currency',
            'experience',
            'count',
            'relativeLevel',
            'value',
            'baseLevel',
            'lastVisitedTime',
            'travelTimeMinutes',
            'averageLevel',
            'numImportantNPCs',
            'rewardCurrency',
            'rewardXp',
            'duration',
            'appliedAt'
        ]);
        const integerFields = new Set([
            'level',
            'currency',
            'experience',
            'count',
            'baseLevel',
            'lastVisitedTime',
            'travelTimeMinutes',
            'numImportantNPCs',
            'rewardCurrency',
            'rewardXp',
            'duration',
            'appliedAt'
        ]);
        const booleanFields = new Set([
            'isDead',
            'isHostile',
            'willingToTrade',
            'isVehicle',
            'isCraftingStation',
            'isProcessingStation',
            'isHarvestable',
            'isSalvageable',
            'isContainer',
            'visited',
            'hasGeneratedStubs',
            'bidirectional',
            'rewardClaimed',
            'paused',
            'completed',
            'optional'
        ]);
        const arrayFields = new Set([
            'aliases',
            'attributeBonuses',
            'unscaledAttributeBonuses',
            'statusEffects',
            'randomEvents',
            'characterConcepts',
            'enemyConcepts',
            'secrets',
            'tags',
            'goals',
            'rewardItems',
            'rewardNpcDispositions',
            'attributes',
            'skills',
            'needBars'
        ]);
        const objectFields = new Set([
            'needBarApplicability',
            'generationHints',
            'weatherState',
            'relations',
            'assets',
            'reputationTiers',
            'rewardFactionReputation'
        ]);

        if (requiredStringFields.has(fieldName)) {
            return normalizeCharacterFieldString(rawValue, {
                functionName,
                fieldName,
                requireNonEmpty: true
            });
        }
        if (stringFields.has(fieldName)) {
            if (rawValue === null && ['factionId', 'controllingFactionId', 'parentRegionId', 'entranceLocationId', 'giverId', 'imageId', 'vehicleType'].includes(fieldName)) {
                return null;
            }
            return normalizeCharacterFieldString(rawValue, { functionName, fieldName });
        }
        if (numberFields.has(fieldName)) {
            if (rawValue === null && objectType === 'statusEffect' && ['duration', 'appliedAt'].includes(fieldName)) {
                return null;
            }
            return normalizeCharacterFieldNumber(rawValue, {
                functionName,
                fieldName,
                integer: integerFields.has(fieldName)
            });
        }
        if (booleanFields.has(fieldName)) {
            return normalizeCharacterFieldBoolean(rawValue, { functionName, fieldName });
        }
        if (arrayFields.has(fieldName)) {
            if (!Array.isArray(rawValue)) {
                throw new ToolVisibleError(
                    `${functionName} "${fieldName}" must be an array.`,
                    { code: 'invalid_arguments' }
                );
            }
            return rawValue;
        }
        if (objectFields.has(fieldName)) {
            return normalizeCharacterFieldMap(rawValue, { functionName, fieldName });
        }
        return rawValue;
    };

    const makeUpdateObjectFieldOperations = (target, fieldsObject, { functionName, objectType } = {}) => {
        if (objectType === 'character') {
            return makeUpdateCharacterFieldOperations(target.record, fieldsObject, { functionName });
        }
        if (!isPlainObject(fieldsObject)) {
            throw new ToolVisibleError(
                `${functionName} requires "fields" to be an object.`,
                { code: 'invalid_arguments' }
            );
        }

        const fieldEntries = Object.entries(fieldsObject);
        if (!fieldEntries.length) {
            throw new ToolVisibleError(
                `${functionName} requires at least one field to update.`,
                { code: 'invalid_arguments' }
            );
        }

        const allowedFields = UPDATE_OBJECT_FIELD_NAMES_BY_TYPE[objectType] || [];
        const allowedFieldSet = new Set(allowedFields);
        for (const [fieldName] of fieldEntries) {
            if (!allowedFieldSet.has(fieldName)) {
                throw new ToolVisibleError(
                    `${functionName} cannot update field "${fieldName}" on ${objectType}. Allowed fields: ${allowedFields.join(', ')}.`,
                    {
                        code: 'unsupported_field',
                        details: { objectType, fieldName }
                    }
                );
            }
        }

        const operations = [];
        const addOperation = (fieldName, apply) => {
            operations.push({ fieldName, apply });
        };

        for (const [fieldName, rawValue] of fieldEntries) {
            const value = normalizeUpdateObjectFieldValue(rawValue, { functionName, objectType, fieldName });
            addOperation(fieldName, () => {
                if (objectType === 'thing' && fieldName === 'value') {
                    const metadata = isPlainObject(target.record.metadata) ? { ...target.record.metadata } : {};
                    metadata.value = value;
                    target.record.metadata = metadata;
                } else if (fieldName === 'averageLevel' && typeof target.record.setAverageLevel === 'function') {
                    target.record.setAverageLevel(value);
                } else if (fieldName === 'statusEffects' && typeof target.record.setStatusEffects === 'function') {
                    target.record.setStatusEffects(value);
                } else {
                    target.record[fieldName] = value;
                }
                if (typeof target.applyReplacement === 'function') {
                    target.applyReplacement(target.record);
                }
            });
        }

        return operations;
    };

    const executeUpdateObjectFieldsTool = ({
        objectType,
        object,
        fields
    } = {}) => {
        const functionName = 'updateObjectFields';
        const canonicalObjectType = normalizeUpdateObjectType(objectType, { functionName });
        const target = resolveUpdateObjectTarget(canonicalObjectType, object, { functionName });
        const operations = makeUpdateObjectFieldOperations(target, fields, {
            functionName,
            objectType: canonicalObjectType
        });
        const updatedFields = [];
        for (const operation of operations) {
            try {
                operation.apply();
                updatedFields.push(operation.fieldName);
            } catch (error) {
                throw new ToolVisibleError(
                    `Failed to update "${operation.fieldName}" on ${canonicalObjectType} "${target.name || target.id || object}": ${error?.message || error}`,
                    { code: 'field_update_failed' }
                );
            }
        }

        const objectId = getRecordId(target.record) || target.id;
        const objectName = getRecordName(target.record) || target.name || object;
        const lines = [
            '<updateObjectFieldsResult>',
            '  <status>success</status>',
            `  <objectType>${xmlEscapeText(canonicalObjectType)}</objectType>`,
            ...renderXmlNode('object', {
                id: objectId,
                name: objectName,
                ownerType: target.ownerType || null,
                ownerId: target.ownerId || null,
                ownerName: target.ownerName || null
            }, 1),
            ...renderXmlNode('updatedFields', updatedFields, 1),
            '</updateObjectFieldsResult>'
        ];

        return {
            content: lines.join('\n'),
            metadata: {
                status: 'success',
                objectType: canonicalObjectType,
                objectId,
                objectName,
                ownerType: target.ownerType || null,
                ownerId: target.ownerId || null,
                ownerName: target.ownerName || null,
                updatedFields
            }
        };
    };

    const executeUpdateCharacterFieldsTool = ({
        character,
        fields
    } = {}) => {
        const functionName = 'updateCharacterFields';
        const characterQuery = normalizeRequiredString(character, {
            functionName,
            fieldName: 'character'
        });
        const targetNpc = resolveCharacterReference(characterQuery, { fieldName: 'character' });
        if (!isNpcEntity(targetNpc)) {
            throw new ToolVisibleError(
                `updateCharacterFields can only update NPCs; "${targetNpc?.name || characterQuery}" is not an NPC.`,
                { code: 'invalid_target' }
            );
        }

        const operations = makeUpdateCharacterFieldOperations(targetNpc, fields, { functionName });
        const updatedFields = [];
        for (const operation of operations) {
            try {
                operation.apply();
                updatedFields.push(operation.fieldName);
            } catch (error) {
                throw new ToolVisibleError(
                    `Failed to update "${operation.fieldName}" on "${targetNpc?.name || characterQuery}": ${error?.message || error}`,
                    { code: 'field_update_failed' }
                );
            }
        }

        const npcId = normalizeOptionalString(targetNpc?.id);
        const npcName = normalizeOptionalString(targetNpc?.name) || characterQuery;
        const lines = [
            '<updateCharacterFieldsResult>',
            '  <status>success</status>',
            ...renderXmlNode('npc', {
                id: npcId,
                name: npcName
            }, 1),
            ...renderXmlNode('updatedFields', updatedFields, 1),
            '</updateCharacterFieldsResult>'
        ];

        return {
            content: lines.join('\n'),
            metadata: {
                status: 'success',
                npcId,
                npcName,
                updatedFields
            }
        };
    };

    const executeAlterNpcTool = async ({
        npc,
        alteration
    } = {}) => {
        const functionName = 'alterNpc';
        const npcQuery = normalizeRequiredString(npc, {
            functionName,
            fieldName: 'npc'
        });
        const changeDescription = normalizeRequiredString(alteration, {
            functionName,
            fieldName: 'alteration'
        });

        if (typeof alterNpcByEvent !== 'function') {
            throw new ToolVisibleError(
                'alterNpc is unavailable because the NPC alteration event wrapper was not configured.',
                { code: 'missing_dependency' }
            );
        }

        const targetNpc = resolveCharacterReference(npcQuery, { fieldName: 'npc' });
        if (!isNpcEntity(targetNpc)) {
            throw new ToolVisibleError(
                `alterNpc can only alter NPCs; "${targetNpc?.name || npcQuery}" is not an NPC.`,
                { code: 'invalid_target' }
            );
        }

        const outcome = await alterNpcByEvent({
            npc: targetNpc,
            alteration: changeDescription
        });

        if (!outcome || typeof outcome !== 'object') {
            throw new ToolVisibleError(
                'alterNpc completed without returning an alteration result.',
                { code: 'alteration_failed' }
            );
        }

        const npcId = normalizeOptionalString(outcome.npcId) || normalizeOptionalString(targetNpc?.id);
        const originalName = normalizeOptionalString(outcome.originalName) || normalizeOptionalString(targetNpc?.name);
        const newName = normalizeOptionalString(outcome.name) || normalizeOptionalString(outcome.newName) || normalizeOptionalString(targetNpc?.name) || originalName;

        const lines = [
            '<alterNpcResult>',
            '  <status>success</status>',
            ...renderXmlNode('npc', {
                id: npcId,
                originalName,
                newName
            }, 1),
            ...renderXmlNode('alteration', changeDescription, 1),
            '</alterNpcResult>'
        ];

        return {
            content: lines.join('\n'),
            metadata: {
                status: 'success',
                npcId,
                originalName,
                newName,
                changeDescription
            }
        };
    };

    const executeAlterLocationTool = async ({
        location,
        region = null,
        alteration
    } = {}) => {
        const functionName = 'alterLocation';
        const locationQuery = normalizeRequiredString(location, {
            functionName,
            fieldName: 'location'
        });
        const changeDescription = normalizeRequiredString(alteration, {
            functionName,
            fieldName: 'alteration'
        });

        if (typeof alterLocationByEvent !== 'function') {
            throw new ToolVisibleError(
                'alterLocation is unavailable because the location alteration event wrapper was not configured.',
                { code: 'missing_dependency' }
            );
        }

        const regionQuery = normalizeOptionalString(region);
        const targetLocation = resolveLocationReference(locationQuery, {
            fieldName: 'location',
            regionQuery
        });
        const outcome = await alterLocationByEvent({
            location: targetLocation,
            alteration: changeDescription
        });

        if (!outcome || typeof outcome !== 'object') {
            throw new ToolVisibleError(
                'alterLocation completed without returning an alteration result.',
                { code: 'alteration_failed' }
            );
        }

        const locationId = normalizeOptionalString(outcome.locationId) || normalizeOptionalString(targetLocation?.id);
        const originalName = normalizeOptionalString(outcome.originalName) || normalizeOptionalString(targetLocation?.name);
        const newName = normalizeOptionalString(outcome.newName) || normalizeOptionalString(targetLocation?.name) || originalName;
        const changed = typeof outcome.changed === 'boolean' ? outcome.changed : null;

        const lines = [
            '<alterLocationResult>',
            '  <status>success</status>',
            ...renderXmlNode('location', {
                id: locationId,
                originalName,
                newName,
                changed
            }, 1),
            ...renderXmlNode('alteration', changeDescription, 1),
            '</alterLocationResult>'
        ];

        return {
            content: lines.join('\n'),
            metadata: {
                status: 'success',
                locationId,
                originalName,
                newName,
                changed,
                changeDescription
            }
        };
    };

    const normalizeRequiredObject = (value, { functionName, fieldName } = {}) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new ToolVisibleError(
                `${functionName} requires "${fieldName}" to be an object.`,
                { code: 'invalid_arguments' }
            );
        }
        return value;
    };

    const normalizeAttackModifierArray = (value, {
        functionName,
        fieldName,
        invertAmount = false,
        enforceStandardRange = true
    } = {}) => {
        const entries = (() => {
            if (value === null || value === undefined) {
                return [];
            }
            if (Array.isArray(value)) {
                return value;
            }
            if (typeof value === 'object') {
                return [value];
            }
            throw new ToolVisibleError(
                `${functionName} "${fieldName}" must be an array of modifier objects.`,
                { code: 'invalid_arguments' }
            );
        })();

        return entries.map((entry, index) => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                throw new ToolVisibleError(
                    `${functionName} "${fieldName}[${index}]" must be an object.`,
                    { code: 'invalid_arguments' }
                );
            }
            const amount = normalizeOptionalInteger(entry.amount, {
                functionName,
                fieldName: `${fieldName}[${index}].amount`
            });
            if (amount === null) {
                throw new ToolVisibleError(
                    `${functionName} "${fieldName}[${index}].amount" is required.`,
                    { code: 'invalid_arguments' }
                );
            }
            if (enforceStandardRange && (amount < -10 || amount > 10)) {
                throw new ToolVisibleError(
                    `${functionName} "${fieldName}[${index}].amount" must be between -10 and 10.`,
                    { code: 'invalid_arguments' }
                );
            }
            const reason = normalizeOptionalString(entry.reason);
            return {
                amount: invertAmount ? -amount : amount,
                reason: reason && reason.toLowerCase() !== 'n/a' ? reason : null
            };
        });
    };

    const normalizeFiniteNumberOrNull = (value) => {
        if (typeof value === 'number') {
            return Number.isFinite(value) ? value : null;
        }
        if (typeof value === 'string' && value.trim()) {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : null;
        }
        return null;
    };

    const ceilStoredPercentOrNull = (value, { zeroWhenNonPositive = false } = {}) => {
        const percent = normalizeFiniteNumberOrNull(value);
        if (percent === null) {
            return null;
        }
        if (zeroWhenNonPositive && percent <= 0) {
            return 0;
        }
        return Math.ceil(percent - 1e-9);
    };

    const ceilPercentFromHealthRatioOrNull = (value, maxHealth, { zeroWhenNonPositive = false } = {}) => {
        const finiteValue = normalizeFiniteNumberOrNull(value);
        const finiteMaxHealth = normalizeFiniteNumberOrNull(maxHealth);
        if (finiteValue === null || finiteMaxHealth === null || finiteMaxHealth <= 0) {
            return null;
        }
        if (zeroWhenNonPositive && finiteValue <= 0) {
            return 0;
        }
        return Math.ceil(((finiteValue / finiteMaxHealth) * 100) - 1e-9);
    };

    const firstFiniteNumberOrNull = (...values) => {
        for (const value of values) {
            const finiteValue = normalizeFiniteNumberOrNull(value);
            if (finiteValue !== null) {
                return finiteValue;
            }
        }
        return null;
    };

    const buildResolveAttackHitContent = ({ resolved, damage }) => {
        const application = resolved?.application && typeof resolved.application === 'object'
            ? resolved.application
            : {};
        const summary = resolved?.summary && typeof resolved.summary === 'object'
            ? resolved.summary
            : {};
        const summaryDamage = summary.damage && typeof summary.damage === 'object'
            ? summary.damage
            : {};
        const summaryTarget = summary.target && typeof summary.target === 'object'
            ? summary.target
            : {};

        const maxHealth = firstFiniteNumberOrNull(
            application.maxHealthAfter,
            application.maxHealthBefore,
            summaryTarget.maxHealth,
            summaryTarget.maximumHealth,
            summaryTarget.totalHealth
        );
        const appliedDamage = firstFiniteNumberOrNull(
            application.damageApplied,
            summaryDamage.applied,
            summaryDamage.total,
            damage
        );

        let damagePercent = ceilPercentFromHealthRatioOrNull(appliedDamage, maxHealth);
        if (damagePercent === null) {
            damagePercent = firstFiniteNumberOrNull(
                ceilStoredPercentOrNull(application.healthLostPercent),
                ceilStoredPercentOrNull(summaryTarget.healthLostPercent)
            );
        }
        if (damagePercent === null) {
            throw new ToolVisibleError(
                'resolveAttack hit, but no finite damage percentage could be calculated.',
                { code: 'attack_resolution_failed' }
            );
        }

        const remainingHealth = firstFiniteNumberOrNull(
            application.endingHealth,
            application.rawRemainingHealth,
            summaryTarget.remainingHealth,
            summaryTarget.rawRemainingHealth
        );
        let remainingHealthPercent = ceilPercentFromHealthRatioOrNull(
            remainingHealth,
            maxHealth,
            { zeroWhenNonPositive: true }
        );
        if (remainingHealthPercent === null) {
            remainingHealthPercent = firstFiniteNumberOrNull(
                ceilStoredPercentOrNull(application.remainingHealthPercent, { zeroWhenNonPositive: true }),
                ceilStoredPercentOrNull(summaryTarget.remainingHealthPercent, { zeroWhenNonPositive: true })
            );
        }
        if (remainingHealthPercent === null) {
            throw new ToolVisibleError(
                'resolveAttack hit, but no finite remaining-health percentage could be calculated.',
                { code: 'attack_resolution_failed' }
            );
        }

        const defeatedText = remainingHealthPercent <= 0 ? ' (incapacitated or dead)' : '';
        return [
            `Damage: ${damagePercent}%`,
            `Remaining health: ${remainingHealthPercent}%${defeatedText}`
        ].join('\n');
    };

    const executeResolveAttackTool = async ({
        attacker,
        defender,
        attackerInfo,
        defenderInfo,
        ability,
        weapon,
        circumstanceModifiers,
        damageEffectiveness
    } = {}) => {
        const functionName = 'resolveAttack';
        if (typeof resolveAttack !== 'function') {
            throw new ToolVisibleError(
                'resolveAttack is unavailable because the attack resolver was not configured.',
                { code: 'missing_dependency' }
            );
        }

        const attackerName = normalizeRequiredString(attacker, { functionName, fieldName: 'attacker' });
        const defenderName = normalizeRequiredString(defender, { functionName, fieldName: 'defender' });
        const attackerInfoObject = normalizeRequiredObject(attackerInfo, { functionName, fieldName: 'attackerInfo' });
        const defenderInfoObject = normalizeRequiredObject(defenderInfo, { functionName, fieldName: 'defenderInfo' });
        const circumstanceModifierObject = normalizeRequiredObject(circumstanceModifiers, {
            functionName,
            fieldName: 'circumstanceModifiers'
        });

        const attackSkill = normalizeRequiredString(attackerInfoObject.attackSkill, {
            functionName,
            fieldName: 'attackerInfo.attackSkill'
        });
        const damageAttribute = normalizeRequiredString(attackerInfoObject.damageAttribute, {
            functionName,
            fieldName: 'attackerInfo.damageAttribute'
        });
        const evadeSkill = normalizeRequiredString(defenderInfoObject.evadeSkill, {
            functionName,
            fieldName: 'defenderInfo.evadeSkill'
        });
        const deflectSkill = normalizeRequiredString(defenderInfoObject.deflectSkill, {
            functionName,
            fieldName: 'defenderInfo.deflectSkill'
        });
        const abilityName = normalizeRequiredString(ability, { functionName, fieldName: 'ability' });
        const weaponName = normalizeRequiredString(weapon, { functionName, fieldName: 'weapon' });
        const damageEffectivenessValue = normalizeOptionalInteger(damageEffectiveness, {
            functionName,
            fieldName: 'damageEffectiveness'
        });
        if (damageEffectivenessValue === null) {
            throw new ToolVisibleError(
                'resolveAttack "damageEffectiveness" is required.',
                { code: 'invalid_arguments' }
            );
        }
        if (damageEffectivenessValue < 1 || damageEffectivenessValue > 5) {
            throw new ToolVisibleError(
                'resolveAttack "damageEffectiveness" must be an integer from 1 to 5.',
                { code: 'invalid_arguments' }
            );
        }

        const attackerModifiers = normalizeAttackModifierArray(
            circumstanceModifierObject.attackerCircumstanceModifier
            ?? circumstanceModifierObject.attackerCircumstanceModifiers,
            {
                functionName,
                fieldName: 'circumstanceModifiers.attackerCircumstanceModifier'
            }
        );
        const defenderModifiers = normalizeAttackModifierArray(
            circumstanceModifierObject.defenderCircumstanceModifier
            ?? circumstanceModifierObject.defenderCircumstanceModifiers,
            {
                functionName,
                fieldName: 'circumstanceModifiers.defenderCircumstanceModifier',
                invertAmount: true
            }
        );

        const attackEntry = {
            attacker: attackerName,
            defender: defenderName,
            attackerInfo: {
                attackSkill,
                damageAttribute
            },
            defenderInfo: {
                evadeSkill,
                deflectSkill
            },
            ability: abilityName,
            weapon: weaponName,
            damageEffectiveness: damageEffectivenessValue,
            circumstanceModifiers: attackerModifiers.concat(defenderModifiers)
        };

        const resolved = await resolveAttack({ attackEntry });
        if (!resolved || typeof resolved !== 'object') {
            throw new ToolVisibleError(
                'resolveAttack completed without returning an attack result.',
                { code: 'attack_resolution_failed' }
            );
        }

        if (!resolved.hit) {
            return {
                content: 'miss',
                metadata: {
                    result: 'miss',
                    hit: false,
                    summary: resolved.summary || null,
                    attacker: attackerName,
                    defender: defenderName
                }
            };
        }

        const rawDamage = resolved.application?.damageApplied
            ?? resolved.damageApplied
            ?? resolved.damageDone
            ?? resolved.damage
            ?? resolved.damageAmount
            ?? resolved.attackOutcome?.damage?.total
            ?? resolved.outcome?.damage?.total;
        const damage = Number(rawDamage);
        if (!Number.isFinite(damage)) {
            throw new ToolVisibleError(
                'resolveAttack hit, but no finite damage amount was returned.',
                { code: 'attack_resolution_failed' }
            );
        }

        return {
            content: buildResolveAttackHitContent({ resolved, damage }),
            metadata: {
                result: 'damage',
                hit: true,
                damage,
                declaredDamage: Number.isFinite(Number(resolved.declaredDamage))
                    ? Number(resolved.declaredDamage)
                    : null,
                application: resolved.application || null,
                appliedStatusEffects: Array.isArray(resolved.appliedStatusEffects)
                    ? resolved.appliedStatusEffects
                    : [],
                locationRefreshRequested: Boolean(resolved.locationRefreshRequested || resolved.application),
                summary: resolved.summary || null,
                attacker: attackerName,
                defender: defenderName
            }
        };
    };

    const AREA_ATTACK_POSITIONS = new Set(['center', 'near', 'edge', 'behind cover', 'uncertain']);
    const AREA_ATTACK_SHAPES = new Set(['blast', 'cone', 'line', 'cloud', 'burst', 'sweep', 'other']);
    const AREA_ATTACK_SECONDARY_APPLIES_ON = new Set(['hit', 'damage', 'anyeffect', 'never']);

    const normalizeAreaAttackEnum = (value, allowedValues, { functionName, fieldName } = {}) => {
        const normalized = normalizeRequiredString(value, { functionName, fieldName }).toLowerCase().replace(/\s+/g, ' ');
        if (!allowedValues.has(normalized)) {
            throw new ToolVisibleError(
                `${functionName} "${fieldName}" must be one of: ${Array.from(allowedValues).join(', ')}.`,
                { code: 'invalid_arguments' }
            );
        }
        return normalized;
    };

    const formatAreaAttackPercent = (value) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return null;
        }
        return Math.ceil(numeric - 1e-9);
    };

    const buildResolveAreaAttackContent = ({ resolved, summary }) => {
        const results = Array.isArray(summary?.results)
            ? summary.results
            : (Array.isArray(resolved?.results) ? resolved.results : []);
        if (!results.length) {
            throw new ToolVisibleError(
                'resolveAreaAttack completed without returning per-target results.',
                { code: 'area_attack_resolution_failed' }
            );
        }

        const lines = ['Area attack results:'];
        for (const result of results) {
            const target = normalizeOptionalString(result?.target || result?.targetName || result?.name) || 'Target';
            const hit = typeof result?.hit === 'boolean' ? result.hit : false;
            if (!hit) {
                lines.push(`- ${target}: miss, no damage`);
                continue;
            }

            const damagePercent = formatAreaAttackPercent(
                result.healthLostPercent
                ?? result.damagePercent
                ?? result.damageApplied
                ?? result.damage
            );
            if (damagePercent === null) {
                throw new ToolVisibleError(
                    `resolveAreaAttack hit ${target}, but no finite damage percentage could be calculated.`,
                    { code: 'area_attack_resolution_failed' }
                );
            }

            const remainingHealthPercent = formatAreaAttackPercent(
                result.remainingHealthPercent
                ?? result.remainingPercent
            );
            if (remainingHealthPercent === null) {
                throw new ToolVisibleError(
                    `resolveAreaAttack hit ${target}, but no finite remaining-health percentage could be calculated.`,
                    { code: 'area_attack_resolution_failed' }
                );
            }

            const defeatedText = remainingHealthPercent <= 0 ? ' (incapacitated or dead)' : '';
            const effectName = normalizeOptionalString(result.secondaryEffect || result.effect);
            const effectText = result.secondaryEffectApplied && effectName
                ? `, effect: ${effectName}`
                : '';
            lines.push(`- ${target}: hit, Damage: ${damagePercent}%, Remaining health: ${remainingHealthPercent}%${defeatedText}${effectText}`);
        }
        return lines.join('\n');
    };

    const executeResolveAreaAttackTool = async ({
        attacker,
        targets,
        attackerInfo,
        ability,
        weapon,
        areaShape,
        effectDescription,
        rollMode,
        circumstanceModifiers,
        secondaryEffect
    } = {}) => {
        const functionName = 'resolveAreaAttack';
        if (typeof resolveAreaAttack !== 'function') {
            throw new ToolVisibleError(
                'resolveAreaAttack is unavailable because the area attack resolver was not configured.',
                { code: 'missing_dependency' }
            );
        }

        const attackerName = normalizeRequiredString(attacker, { functionName, fieldName: 'attacker' });
        if (!Array.isArray(targets) || !targets.length) {
            throw new ToolVisibleError(
                'resolveAreaAttack requires a non-empty "targets" array.',
                { code: 'invalid_arguments' }
            );
        }

        const attackerInfoObject = normalizeRequiredObject(attackerInfo, { functionName, fieldName: 'attackerInfo' });
        const attackSkill = normalizeRequiredString(attackerInfoObject.attackSkill, {
            functionName,
            fieldName: 'attackerInfo.attackSkill'
        });
        const damageAttribute = normalizeRequiredString(attackerInfoObject.damageAttribute, {
            functionName,
            fieldName: 'attackerInfo.damageAttribute'
        });
        const abilityName = normalizeRequiredString(ability, { functionName, fieldName: 'ability' });
        const weaponName = normalizeRequiredString(weapon, { functionName, fieldName: 'weapon' });
        const shapeName = normalizeAreaAttackEnum(areaShape, AREA_ATTACK_SHAPES, {
            functionName,
            fieldName: 'areaShape'
        });
        const effectText = normalizeRequiredString(effectDescription, { functionName, fieldName: 'effectDescription' });
        const rollModeName = normalizeRequiredString(rollMode, { functionName, fieldName: 'rollMode' });
        if (rollModeName !== 'sharedAttackRoll') {
            throw new ToolVisibleError(
                'resolveAreaAttack "rollMode" must be "sharedAttackRoll".',
                { code: 'invalid_arguments' }
            );
        }
        const sharedModifiers = normalizeAttackModifierArray(circumstanceModifiers, {
            functionName,
            fieldName: 'circumstanceModifiers'
        });

        const secondaryEffectObject = normalizeRequiredObject(secondaryEffect, {
            functionName,
            fieldName: 'secondaryEffect'
        });
        const secondaryEffectName = normalizeRequiredString(secondaryEffectObject.name, {
            functionName,
            fieldName: 'secondaryEffect.name'
        });
        const secondaryEffectDescription = normalizeRequiredString(secondaryEffectObject.description, {
            functionName,
            fieldName: 'secondaryEffect.description'
        });
        const appliesOnNormalized = normalizeAreaAttackEnum(secondaryEffectObject.appliesOn, AREA_ATTACK_SECONDARY_APPLIES_ON, {
            functionName,
            fieldName: 'secondaryEffect.appliesOn'
        });
        const appliesOn = appliesOnNormalized === 'anyeffect' ? 'anyEffect' : appliesOnNormalized;

        const seenTargets = new Set();
        const normalizedTargets = targets.map((target, index) => {
            if (!target || typeof target !== 'object' || Array.isArray(target)) {
                throw new ToolVisibleError(
                    `resolveAreaAttack "targets[${index}]" must be an object.`,
                    { code: 'invalid_arguments' }
                );
            }
            const targetName = normalizeRequiredString(target.name, {
                functionName,
                fieldName: `targets[${index}].name`
            });
            const targetKey = targetName.trim().toLowerCase();
            if (seenTargets.has(targetKey)) {
                throw new ToolVisibleError(
                    `resolveAreaAttack duplicate target "${targetName}" is not allowed.`,
                    { code: 'invalid_arguments' }
                );
            }
            seenTargets.add(targetKey);

            const targetPosition = normalizeAreaAttackEnum(target.position, AREA_ATTACK_POSITIONS, {
                functionName,
                fieldName: `targets[${index}].position`
            });
            const defenseInfo = normalizeRequiredObject(target.defenseInfo, {
                functionName,
                fieldName: `targets[${index}].defenseInfo`
            });
            const evadeSkill = normalizeRequiredString(defenseInfo.evadeSkill, {
                functionName,
                fieldName: `targets[${index}].defenseInfo.evadeSkill`
            });
            const deflectSkill = normalizeRequiredString(defenseInfo.deflectSkill, {
                functionName,
                fieldName: `targets[${index}].defenseInfo.deflectSkill`
            });
            const toughnessAttribute = normalizeRequiredString(defenseInfo.toughnessAttribute, {
                functionName,
                fieldName: `targets[${index}].defenseInfo.toughnessAttribute`
            });
            const targetModifiers = normalizeAttackModifierArray(target.circumstanceModifiers, {
                functionName,
                fieldName: `targets[${index}].circumstanceModifiers`,
                invertAmount: true
            });
            const damageEffectivenessValue = normalizeOptionalInteger(target.damageEffectiveness, {
                functionName,
                fieldName: `targets[${index}].damageEffectiveness`
            });
            if (damageEffectivenessValue === null) {
                throw new ToolVisibleError(
                    `resolveAreaAttack "targets[${index}].damageEffectiveness" is required.`,
                    { code: 'invalid_arguments' }
                );
            }
            if (damageEffectivenessValue < 1 || damageEffectivenessValue > 5) {
                throw new ToolVisibleError(
                    `resolveAreaAttack "targets[${index}].damageEffectiveness" must be an integer from 1 to 5.`,
                    { code: 'invalid_arguments' }
                );
            }

            return {
                name: targetName,
                position: targetPosition,
                defenseInfo: {
                    evadeSkill,
                    deflectSkill,
                    toughnessAttribute
                },
                circumstanceModifiers: targetModifiers,
                damageEffectiveness: damageEffectivenessValue
            };
        });

        const areaAttackEntry = {
            attacker: attackerName,
            targets: normalizedTargets,
            attackerInfo: {
                attackSkill,
                damageAttribute
            },
            ability: abilityName,
            weapon: weaponName,
            areaShape: shapeName,
            effectDescription: effectText,
            rollMode: rollModeName,
            circumstanceModifiers: sharedModifiers,
            secondaryEffect: {
                name: secondaryEffectName,
                description: secondaryEffectDescription,
                appliesOn
            }
        };

        const resolved = await resolveAreaAttack({ areaAttackEntry });
        if (!resolved || typeof resolved !== 'object') {
            throw new ToolVisibleError(
                'resolveAreaAttack completed without returning an area attack result.',
                { code: 'area_attack_resolution_failed' }
            );
        }

        const summary = resolved.summary && typeof resolved.summary === 'object'
            ? resolved.summary
            : {
                kind: 'area-attack',
                attacker: attackerName,
                weapon: weaponName,
                ability: abilityName,
                areaShape: shapeName,
                rollMode: rollModeName,
                results: Array.isArray(resolved.results) ? resolved.results : []
            };
        const results = Array.isArray(summary.results)
            ? summary.results
            : (Array.isArray(resolved.results) ? resolved.results : []);
        const hitCount = Number.isFinite(Number(resolved.hitCount))
            ? Number(resolved.hitCount)
            : results.filter(entry => entry?.hit === true).length;
        const targetCount = Number.isFinite(Number(resolved.targetCount))
            ? Number(resolved.targetCount)
            : results.length;

        return {
            content: buildResolveAreaAttackContent({ resolved, summary }),
            metadata: {
                kind: 'area-attack',
                result: hitCount > 0 ? (hitCount === targetCount ? 'all-hit' : 'mixed') : 'miss',
                hitCount,
                targetCount,
                locationRefreshRequested: Boolean(resolved.locationRefreshRequested),
                summary,
                results,
                attacker: summary.attacker || attackerName,
                weapon: summary.weapon || weaponName,
                ability: summary.ability || abilityName,
                areaShape: summary.areaShape || shapeName,
                rollMode: summary.rollMode || rollModeName
            }
        };
    };

    const buildPlausibilitySkillCheck = ({
        reason,
        skill,
        attribute,
        difficultyLevel = null,
        opposedCheck = null,
        circumstanceModifiers = []
    } = {}) => {
        const cleanSkill = skill && skill.toLowerCase() !== 'n/a' ? skill : null;
        const cleanAttribute = attribute && attribute.toLowerCase() !== 'n/a' ? attribute : null;
        const totalModifier = circumstanceModifiers.reduce((sum, entry) => {
            return sum + (Number.isFinite(entry?.amount) ? entry.amount : 0);
        }, 0);
        const circumstanceReasons = circumstanceModifiers
            .map(entry => (entry?.reason && entry.reason.toLowerCase() !== 'n/a') ? entry.reason : null)
            .filter(Boolean);
        const skillCheck = {
            reason,
            skill: cleanSkill,
            attribute: cleanAttribute,
            circumstanceModifiers,
            circumstanceModifier: totalModifier
        };
        if (circumstanceReasons.length) {
            skillCheck.circumstanceModifierReason = circumstanceReasons.join('; ');
        }
        if (opposedCheck) {
            skillCheck.difficulty = 'Opposed';
            skillCheck.checkType = 'opposed';
            skillCheck.opposedCheck = opposedCheck;
        } else {
            skillCheck.difficulty = difficultyLevel;
            skillCheck.checkType = 'unopposed';
            skillCheck.unopposedCheck = { difficultyLevel };
        }
        return {
            type: 'Plausible',
            reason,
            skillCheck,
            itemsMentioned: [],
            abilitiesMentioned: []
        };
    };

    const normalizePlausibilityModifierArray = (value, { functionName, fieldName } = {}) => (
        normalizeAttackModifierArray(value, { functionName, fieldName, enforceStandardRange: false })
    );

    const executeResolvePlausibilityCheckTool = async ({
        actor,
        reason,
        skill,
        attribute,
        difficultyLevel,
        circumstanceModifiers
    } = {}, { defaultActorName = null, toolName = 'resolveSkillCheck' } = {}) => {
        const functionName = toolName;
        if (typeof resolvePlausibilityCheck !== 'function') {
            throw new ToolVisibleError(
                `${functionName} is unavailable because the skill-check resolver was not configured.`,
                { code: 'missing_dependency' }
            );
        }

        const actorName = normalizeOptionalString(actor) || normalizeOptionalString(defaultActorName) || 'player';
        const reasonText = normalizeRequiredString(reason, { functionName, fieldName: 'reason' });
        const skillName = normalizeRequiredString(skill, { functionName, fieldName: 'skill' });
        const attributeName = normalizeRequiredString(attribute, { functionName, fieldName: 'attribute' });
        const difficultyName = normalizeRequiredString(difficultyLevel, { functionName, fieldName: 'difficultyLevel' });
        const modifiers = normalizePlausibilityModifierArray(circumstanceModifiers, {
            functionName,
            fieldName: 'circumstanceModifiers'
        });

        const plausibility = buildPlausibilitySkillCheck({
            reason: reasonText,
            skill: skillName,
            attribute: attributeName,
            difficultyLevel: difficultyName,
            circumstanceModifiers: modifiers
        });

        const resolved = await resolvePlausibilityCheck({ actor: actorName, plausibility });
        const actionResolution = resolved?.actionResolution || resolved;
        if (!actionResolution || typeof actionResolution !== 'object') {
            throw new ToolVisibleError(
                `${functionName} completed without returning an action resolution.`,
                { code: 'skill_check_resolution_failed' }
            );
        }

        const resultLabel = normalizeOptionalString(actionResolution.label)
            || normalizeOptionalString(actionResolution.degree)
            || (actionResolution.success ? 'success' : 'failure');
        return {
            content: resultLabel,
            metadata: {
                result: resultLabel,
                checkType: 'unopposed',
                actor: actorName,
                actionResolution,
                plausibility: {
                    raw: null,
                    structured: resolved?.plausibility?.structured || plausibility
                }
            }
        };
    };

    const executeResolveOpposedPlausibilityCheckTool = async ({
        actor,
        reason,
        skill,
        attribute,
        opponent,
        opponentSkill,
        opponentAttribute,
        circumstanceModifiers
    } = {}, { defaultActorName = null, toolName = 'resolveOpposedSkillCheck' } = {}) => {
        const functionName = toolName;
        if (typeof resolveOpposedPlausibilityCheck !== 'function') {
            throw new ToolVisibleError(
                `${functionName} is unavailable because the opposed skill-check resolver was not configured.`,
                { code: 'missing_dependency' }
            );
        }

        const actorName = normalizeOptionalString(actor) || normalizeOptionalString(defaultActorName) || 'player';
        const reasonText = normalizeRequiredString(reason, { functionName, fieldName: 'reason' });
        const skillName = normalizeRequiredString(skill, { functionName, fieldName: 'skill' });
        const attributeName = normalizeRequiredString(attribute, { functionName, fieldName: 'attribute' });
        const opponentName = normalizeRequiredString(opponent, { functionName, fieldName: 'opponent' });
        const opponentSkillName = normalizeRequiredString(opponentSkill, { functionName, fieldName: 'opponentSkill' });
        const opponentAttributeName = normalizeRequiredString(opponentAttribute, { functionName, fieldName: 'opponentAttribute' });
        const modifiers = normalizePlausibilityModifierArray(circumstanceModifiers, {
            functionName,
            fieldName: 'circumstanceModifiers'
        });
        const opposedCheck = {
            opponent: opponentName,
            opponentSkill: opponentSkillName && opponentSkillName.toLowerCase() !== 'n/a' ? opponentSkillName : null,
            opponentAttribute: opponentAttributeName && opponentAttributeName.toLowerCase() !== 'n/a' ? opponentAttributeName : null
        };

        const plausibility = buildPlausibilitySkillCheck({
            reason: reasonText,
            skill: skillName,
            attribute: attributeName,
            opposedCheck,
            circumstanceModifiers: modifiers
        });

        const resolved = await resolveOpposedPlausibilityCheck({ actor: actorName, plausibility });
        const actionResolution = resolved?.actionResolution || resolved;
        if (!actionResolution || typeof actionResolution !== 'object') {
            throw new ToolVisibleError(
                `${functionName} completed without returning an action resolution.`,
                { code: 'skill_check_resolution_failed' }
            );
        }

        const resultLabel = normalizeOptionalString(actionResolution.label)
            || normalizeOptionalString(actionResolution.degree)
            || (actionResolution.success ? 'success' : 'failure');
        return {
            content: resultLabel,
            metadata: {
                result: resultLabel,
                checkType: 'opposed',
                actor: actorName,
                opponent: opponentName,
                actionResolution,
                plausibility: {
                    raw: null,
                    structured: resolved?.plausibility?.structured || plausibility
                }
            }
        };
    };

    const findThingContainerLocation = (thingId) => {
        const normalizedThingId = toTrimmedString(thingId);
        if (!normalizedThingId) {
            return null;
        }
        for (const location of getAllLocations()) {
            if (!location || !Array.isArray(location.thingIds)) {
                continue;
            }
            if (location.thingIds.includes(normalizedThingId)) {
                return location;
            }
        }
        return null;
    };

    const buildLocateThingEntry = (thing) => {
        const metadata = thing?.metadata && typeof thing.metadata === 'object'
            ? thing.metadata
            : {};
        const ownerId = toTrimmedString(metadata.ownerId || metadata.owner || metadata.ownerID) || null;
        const owner = ownerId
            ? getAllCharacters().find(candidate => toTrimmedString(candidate?.id) === ownerId) || null
            : null;

        let locationSummary = null;
        if (owner) {
            const ownerLocationId = toTrimmedString(owner.currentLocation || owner.locationId) || null;
            locationSummary = describeLocationSummary(ownerLocationId);
        }

        if (!locationSummary) {
            const metadataLocationId = toTrimmedString(metadata.locationId || metadata.locationID) || null;
            if (metadataLocationId) {
                locationSummary = describeLocationSummary(metadataLocationId);
            }
        }

        if (!locationSummary) {
            const indexedLocation = findThingContainerLocation(thing?.id);
            if (indexedLocation) {
                locationSummary = describeLocationSummary(indexedLocation.id);
            }
        }

        return {
            id: toTrimmedString(thing?.id) || null,
            name: toTrimmedString(thing?.name) || null,
            thingType: toTrimmedString(thing?.thingType) || null,
            ownerId: ownerId || null,
            ownerName: toTrimmedString(owner?.name) || null,
            inInventory: Boolean(ownerId),
            locationId: locationSummary?.locationId || null,
            locationName: locationSummary?.locationName || null,
            regionId: locationSummary?.regionId || null,
            regionName: locationSummary?.regionName || null
        };
    };

    const executeLocateNpcsTool = ({
        query
    } = {}) => {
        const functionName = 'locateNpcs';
        const normalizedQuery = normalizeRequiredString(query, {
            functionName,
            fieldName: 'query'
        });
        const queryLower = normalizedQuery.toLowerCase();

        const allNpcs = getAllCharacters().filter(character => character?.isNPC === true);
        const isExactNpcMatch = (npc) => {
            const name = toTrimmedString(npc?.name).toLowerCase();
            if (name && name === queryLower) {
                return true;
            }
            const aliases = npcAliasesForMatching(npc).map(alias => toTrimmedString(alias).toLowerCase()).filter(Boolean);
            return aliases.includes(queryLower);
        };
        const isLooseNpcMatch = (npc) => {
            const name = toTrimmedString(npc?.name).toLowerCase();
            if (name && name.includes(queryLower)) {
                return true;
            }
            const aliases = npcAliasesForMatching(npc).map(alias => toTrimmedString(alias).toLowerCase()).filter(Boolean);
            return aliases.some(alias => alias.includes(queryLower));
        };

        const exactMatches = allNpcs.filter(isExactNpcMatch);
        const looseMatches = allNpcs.filter(isLooseNpcMatch);
        const matches = exactMatches.length ? exactMatches : looseMatches;

        const entries = matches
            .map(npc => {
                const summary = describeLocationSummary(npc.currentLocation || npc.locationId || null);
                return {
                    id: toTrimmedString(npc.id) || null,
                    name: toTrimmedString(npc.name) || null,
                    locationId: summary.locationId || null,
                    locationName: summary.locationName || null,
                    regionId: summary.regionId || null,
                    regionName: summary.regionName || null
                };
            })
            .sort(candidateSort);

        const lines = [
            '<locateNpcsResult>',
            `  <query>${xmlEscapeText(normalizedQuery)}</query>`,
            `  <count>${entries.length}</count>`,
            `  <npcs count="${entries.length}">`
        ];
        for (const entry of entries) {
            lines.push(...renderXmlNode('npc', entry, 2));
        }
        lines.push('  </npcs>');
        lines.push('</locateNpcsResult>');

        return {
            content: lines.join('\n'),
            metadata: {
                query: normalizedQuery,
                count: entries.length,
                npcIds: entries.map(entry => entry.id).filter(Boolean)
            }
        };
    };

    const executeLocateThingsTool = ({
        query
    } = {}) => {
        const functionName = 'locateThings';
        const normalizedQuery = normalizeRequiredString(query, {
            functionName,
            fieldName: 'query'
        });
        const queryLower = normalizedQuery.toLowerCase();

        const allThings = getAllThings();
        const exactMatches = allThings.filter(thing => {
            const thingId = toTrimmedString(thing?.id);
            const thingName = toTrimmedString(thing?.name).toLowerCase();
            return (thingId && thingId === normalizedQuery) || (thingName && thingName === queryLower);
        });
        const looseMatches = allThings.filter(thing => {
            const thingName = toTrimmedString(thing?.name).toLowerCase();
            return Boolean(thingName && thingName.includes(queryLower));
        });
        const matches = exactMatches.length ? exactMatches : looseMatches;

        const entries = matches
            .map(buildLocateThingEntry)
            .sort(candidateSort);

        const lines = [
            '<locateThingsResult>',
            `  <query>${xmlEscapeText(normalizedQuery)}</query>`,
            `  <count>${entries.length}</count>`,
            `  <things count="${entries.length}">`
        ];
        for (const entry of entries) {
            lines.push(...renderXmlNode('thing', entry, 2));
        }
        lines.push('  </things>');
        lines.push('</locateThingsResult>');

        return {
            content: lines.join('\n'),
            metadata: {
                query: normalizedQuery,
                count: entries.length,
                thingIds: entries.map(entry => entry.id).filter(Boolean)
            }
        };
    };

    const executeMoreInfoTool = ({ name, type = null, includeFullState = false }) => {
        if (typeof name !== 'string' || !name.trim()) {
            throw new Error('moreInfo requires a non-empty "name" string.');
        }
        const query = name.trim();
        const requestedType = normalizeMoreInfoType(type);
        const shouldIncludeFullState = normalizeMoreInfoIncludeFullState(includeFullState);
        const includeCharacters = requestedType === null || requestedType === 'character';
        const includeThings = requestedType === null || requestedType === 'thing';
        const includeLocations = requestedType === null || requestedType === 'location';
        const includeRegions = requestedType === null || requestedType === 'region';
        const queryLower = query.toLowerCase();
        const nameIncludesQuery = (candidate) => (
            typeof candidate === 'string' && candidate.toLowerCase().includes(queryLower)
        );

        const allActors = includeCharacters && typeof Player?.getAll === 'function' ? Player.getAll() : [];
        const allThings = includeThings && typeof Thing?.getAll === 'function' ? Thing.getAll() : [];
        const allLocations = includeLocations && typeof Location?.getAll === 'function' ? Location.getAll() : [];
        const allRegions = includeRegions && typeof Region?.getAll === 'function' ? Region.getAll() : [];

        const matchedNpcs = Array.isArray(allActors)
            ? allActors.filter(actor => {
                if (!actor || actor.isNPC !== true) {
                    return false;
                }
                if (nameIncludesQuery(actor.name)) {
                    return true;
                }
                const aliases = npcAliasesForMatching(actor);
                return aliases.some(alias => nameIncludesQuery(alias));
            })
            : [];

        const matchedThings = Array.isArray(allThings)
            ? allThings.filter(thing => thing && nameIncludesQuery(thing.name))
            : [];

        const matchedLocations = Array.isArray(allLocations)
            ? allLocations.filter(location => location && nameIncludesQuery(location.name))
            : [];

        const matchedRegions = Array.isArray(allRegions)
            ? allRegions.filter(region => region && nameIncludesQuery(region.name))
            : [];

        const totalMatches = matchedNpcs.length
            + matchedThings.length
            + matchedLocations.length
            + matchedRegions.length;

        if (totalMatches > MORE_INFO_MAX_MATCHES) {
            throw new Error(`moreInfo("${query}") matched ${totalMatches} entities, exceeding the limit of ${MORE_INFO_MAX_MATCHES}. Provide a narrower query.`);
        }

        const results = {
            query,
            type: requestedType || null,
            totalMatches,
            npcs: matchedNpcs.map(entry => serializeMoreInfoRecord(entry, { includeFullState: shouldIncludeFullState })).filter(Boolean),
            things: matchedThings.map(entry => serializeMoreInfoRecord(entry, { includeFullState: shouldIncludeFullState })).filter(Boolean),
            locations: matchedLocations.map(entry => serializeMoreInfoRecord(entry, { includeFullState: shouldIncludeFullState })).filter(Boolean),
            regions: matchedRegions.map(entry => serializeMoreInfoRecord(entry, { includeFullState: shouldIncludeFullState })).filter(Boolean)
        };

        return {
            content: JSON.stringify(results, null, 2),
            metadata: {
                query,
                type: requestedType || null,
                includeFullState: shouldIncludeFullState,
                totalMatches,
                counts: {
                    npcs: matchedNpcs.length,
                    things: matchedThings.length,
                    locations: matchedLocations.length,
                    regions: matchedRegions.length
                },
                results
            }
        };
    };

    const collectHistoryMatches = ({
        query,
        startIndex = null,
        count = null,
        includeFullContent = true,
        includeAllEntryTypes = false
    } = {}) => {
        const queries = normalizeHistoryQueries(query);
        const normalizedStartIndex = normalizeOptionalPositiveInteger(startIndex, 'startIndex');
        const normalizedCount = normalizeOptionalPositiveInteger(count, 'count');
        const chatHistory = getChatHistory();
        if (!Array.isArray(chatHistory)) {
            throw new Error('Chat history is unavailable for getHistory.');
        }

        const queryLower = queries.map(entry => entry.toLowerCase());
        const matches = [];

        for (let index = 0; index < chatHistory.length; index += 1) {
            const entry = chatHistory[index];
            if (!entry || typeof entry !== 'object') {
                continue;
            }
            if (!includeAllEntryTypes && !isAssistantProseLikeEntry(entry)) {
                continue;
            }
            const content = typeof entry.content === 'string' ? entry.content : '';
            if (!content.trim()) {
                continue;
            }
            const contentLower = content.toLowerCase();
            if (!queryLower.every(term => contentLower.includes(term))) {
                continue;
            }

            const match = {
                index,
                id: typeof entry.id === 'string' ? entry.id : null,
                type: typeof entry.type === 'string' ? entry.type : null,
                role: typeof entry.role === 'string' ? entry.role : null,
                timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : null,
                locationId: typeof entry.locationId === 'string' ? entry.locationId : null
            };

            if (includeFullContent) {
                match.content = content;
            } else {
                const trimmedContent = content.trim();
                match.preview = trimmedContent.length > 220
                    ? `${trimmedContent.slice(0, 220)}...`
                    : trimmedContent;
            }

            matches.push(match);
        }

        const effectiveStartIndex = normalizedStartIndex === null ? 1 : normalizedStartIndex;
        const startOffset = effectiveStartIndex - 1;
        const slicedMatches = normalizedCount === null
            ? matches.slice(startOffset)
            : matches.slice(startOffset, startOffset + normalizedCount);

        return {
            query: queries.length === 1 ? queries[0] : null,
            queries,
            includeAllEntryTypes: Boolean(includeAllEntryTypes),
            totalMatches: matches.length,
            startIndex: effectiveStartIndex,
            count: normalizedCount,
            returnedCount: slicedMatches.length,
            entries: slicedMatches
        };
    };

    const executeGetHistoryTool = (
        { query, startIndex = null, count = null },
        { includeAllEntryTypes = false } = {}
    ) => {
        const historyResult = collectHistoryMatches({
            query,
            startIndex,
            count,
            includeFullContent: true,
            includeAllEntryTypes
        });
        const lines = [
            '<historyResults>',
            `  <queries count="${historyResult.queries.length}">`,
            ...historyResult.queries.map(entry => `    <query>${xmlEscapeText(entry)}</query>`),
            '  </queries>',
            `  <startIndex>${historyResult.startIndex}</startIndex>`
        ];
        if (historyResult.count !== null) {
            lines.push(`  <count>${historyResult.count}</count>`);
        }
        lines.push(
            `  <returnedCount>${historyResult.returnedCount}</returnedCount>`,
            `  <totalMatches>${historyResult.totalMatches}</totalMatches>`,
            `  <entries count="${historyResult.entries.length}">`
        );

        for (const entry of historyResult.entries) {
            const serializedEntry = {
                id: entry.id,
                type: entry.type,
                role: entry.role,
                timestamp: entry.timestamp,
                locationId: entry.locationId,
                content: entry.content
            };
            lines.push(...renderXmlNode('entry', serializedEntry, 2, { index: entry.index }));
        }

        lines.push('  </entries>');
        lines.push('</historyResults>');

        return {
            content: lines.join('\n'),
            metadata: {
                query: historyResult.query,
                queries: historyResult.queries,
                includeAllEntryTypes: historyResult.includeAllEntryTypes,
                startIndex: historyResult.startIndex,
                count: historyResult.count,
                returnedCount: historyResult.returnedCount,
                totalMatches: historyResult.totalMatches,
                entryIndexes: historyResult.entries.map(entry => entry.index)
            }
        };
    };

    const getOrderedSceneSummaries = () => {
        if (typeof getSceneSummaries !== 'function') {
            throw new Error('Scene summaries are unavailable for getFullScene.');
        }
        const sceneSummaries = getSceneSummaries();
        if (!sceneSummaries || typeof sceneSummaries.getScenesInOrder !== 'function') {
            throw new Error('Scene summaries are unavailable for getFullScene.');
        }
        const scenes = sceneSummaries.getScenesInOrder();
        if (!Array.isArray(scenes)) {
            throw new Error('Scene summaries returned an invalid scene list.');
        }
        return scenes;
    };

    const resolveSceneEntryLabel = (entry) => {
        const entryType = typeof entry?.type === 'string' ? entry.type.trim().toLowerCase() : '';
        const role = typeof entry?.role === 'string' ? entry.role.trim() : '';
        const normalizedRole = role.toLowerCase();

        if (normalizedRole === 'user') {
            const currentPlayer = typeof getCurrentPlayer === 'function' ? getCurrentPlayer() : null;
            const speaker = typeof entry?.actor === 'string' && entry.actor.trim()
                ? entry.actor.trim()
                : (typeof currentPlayer?.name === 'string' && currentPlayer.name.trim()
                    ? currentPlayer.name.trim()
                    : 'Player');
            const actionKind = entryType === 'user-question'
                ? 'question'
                : (entryType === 'user-generic-prompt' ? 'genericPrompt' : 'playerAction');
            const actionLabel = entryType === 'user-question'
                ? `Question by ${speaker}`
                : (entryType === 'user-generic-prompt'
                    ? `Generic prompt by ${speaker}`
                    : (entry?.travel === true ? `Travel action by ${speaker}` : `Action by ${speaker}`));
            return {
                kind: actionKind,
                label: actionLabel,
                speaker
            };
        }

        if (entryType === 'npc-action') {
            const speaker = typeof entry?.actor === 'string' && entry.actor.trim()
                ? entry.actor.trim()
                : (normalizedRole && normalizedRole !== 'assistant' && normalizedRole !== 'system'
                    ? role
                    : 'NPC');
            return {
                kind: 'npcAction',
                label: `Action by ${speaker}`,
                speaker
            };
        }

        if (isAssistantProseLikeEntry(entry)) {
            const speaker = typeof entry?.actor === 'string' && entry.actor.trim()
                ? entry.actor.trim()
                : 'Storyteller';
            return {
                kind: 'prose',
                label: speaker === 'Storyteller'
                    ? 'Storyteller prose'
                    : `Storyteller prose for ${speaker}`,
                speaker
            };
        }

        if (normalizedRole === 'assistant') {
            const speaker = typeof entry?.actor === 'string' && entry.actor.trim()
                ? entry.actor.trim()
                : 'Storyteller';
            const hiddenSceneTypes = new Set([
                'supplemental-story-info',
                'offscreen-npc-activity-daily',
                'offscreen-npc-activity-weekly',
                'while-you-were-away'
            ]);
            return {
                kind: hiddenSceneTypes.has(entryType) ? 'hiddenSceneNote' : 'prose',
                label: hiddenSceneTypes.has(entryType)
                    ? `Hidden scene note (${entryType})`
                    : (speaker === 'Storyteller' ? 'Storyteller prose' : `Storyteller prose for ${speaker}`),
                speaker
            };
        }

        const speaker = role || 'Unknown';
        return {
            kind: 'sceneEntry',
            label: `Scene entry by ${speaker}`,
            speaker
        };
    };

    const collectFullSceneEntries = ({ sceneNumber }) => {
        const normalizedSceneNumber = normalizeRequiredPositiveInteger(
            sceneNumber,
            'sceneNumber',
            'getFullScene'
        );
        const scenes = getOrderedSceneSummaries();
        if (scenes.length === 0) {
            throw new Error('getFullScene cannot return a scene because no scene summaries are stored.');
        }
        if (normalizedSceneNumber > scenes.length) {
            throw new Error(`getFullScene sceneNumber ${normalizedSceneNumber} is out of range; stored scenes: ${scenes.length}.`);
        }

        const scene = scenes[normalizedSceneNumber - 1];
        const startIndex = Number(scene?.startIndex);
        const endIndex = Number(scene?.endIndex);
        if (!Number.isInteger(startIndex) || startIndex < 1) {
            throw new Error(`Stored scene ${normalizedSceneNumber} has an invalid startIndex.`);
        }
        if (!Number.isInteger(endIndex) || endIndex < startIndex) {
            throw new Error(`Stored scene ${normalizedSceneNumber} has an invalid endIndex.`);
        }

        const chatHistory = getChatHistory();
        if (!Array.isArray(chatHistory)) {
            throw new Error('Chat history is unavailable for getFullScene.');
        }

        const entries = [];
        let sceneEntryIndex = 0;
        for (let historyIndex = 0; historyIndex < chatHistory.length; historyIndex += 1) {
            const entry = chatHistory[historyIndex];
            if (!shouldIncludeEntryInSceneSummaryIndex(entry)) {
                continue;
            }
            const indexedText = getSceneSummaryIndexText(entry);
            if (!indexedText) {
                continue;
            }

            sceneEntryIndex += 1;
            if (sceneEntryIndex < startIndex) {
                continue;
            }
            if (sceneEntryIndex > endIndex) {
                break;
            }

            const content = typeof entry.content === 'string' && entry.content.trim()
                ? entry.content
                : (typeof entry.summary === 'string' ? entry.summary : '');
            const label = resolveSceneEntryLabel(entry);
            entries.push({
                sceneEntryIndex,
                historyIndex,
                id: typeof entry.id === 'string' ? entry.id : null,
                type: typeof entry.type === 'string' ? entry.type : null,
                role: typeof entry.role === 'string' ? entry.role : null,
                kind: label.kind,
                label: label.label,
                speaker: label.speaker,
                timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : null,
                locationId: typeof entry.locationId === 'string' ? entry.locationId : null,
                content
            });
        }

        return {
            sceneNumber: normalizedSceneNumber,
            totalScenes: scenes.length,
            startIndex,
            endIndex,
            summary: typeof scene.summary === 'string' ? scene.summary : '',
            entries
        };
    };

    const executeGetFullSceneTool = ({ sceneNumber }) => {
        const sceneResult = collectFullSceneEntries({ sceneNumber });
        const lines = [
            `<fullScene number="${xmlEscapeAttribute(sceneResult.sceneNumber)}" totalScenes="${xmlEscapeAttribute(sceneResult.totalScenes)}">`,
            `  <range startIndex="${xmlEscapeAttribute(sceneResult.startIndex)}" endIndex="${xmlEscapeAttribute(sceneResult.endIndex)}"/>`
        ];
        if (sceneResult.summary) {
            lines.push(`  <sceneSummary>${xmlEscapeText(sceneResult.summary)}</sceneSummary>`);
        }
        lines.push(`  <entries count="${xmlEscapeAttribute(sceneResult.entries.length)}">`);
        for (const entry of sceneResult.entries) {
            lines.push(`    <entry sceneEntryIndex="${xmlEscapeAttribute(entry.sceneEntryIndex)}" historyIndex="${xmlEscapeAttribute(entry.historyIndex)}" kind="${xmlEscapeAttribute(entry.kind)}">`);
            lines.push(`      <label>${xmlEscapeText(entry.label)}</label>`);
            lines.push(`      <speaker>${xmlEscapeText(entry.speaker)}</speaker>`);
            if (entry.id) {
                lines.push(`      <id>${xmlEscapeText(entry.id)}</id>`);
            }
            if (entry.type) {
                lines.push(`      <type>${xmlEscapeText(entry.type)}</type>`);
            }
            if (entry.role) {
                lines.push(`      <role>${xmlEscapeText(entry.role)}</role>`);
            }
            if (entry.timestamp) {
                lines.push(`      <timestamp>${xmlEscapeText(entry.timestamp)}</timestamp>`);
            }
            if (entry.locationId) {
                lines.push(`      <locationId>${xmlEscapeText(entry.locationId)}</locationId>`);
            }
            lines.push(`      <content>${xmlEscapeText(entry.content)}</content>`);
            lines.push('    </entry>');
        }
        lines.push('  </entries>');
        lines.push('</fullScene>');

        return {
            content: lines.join('\n'),
            metadata: {
                sceneNumber: sceneResult.sceneNumber,
                totalScenes: sceneResult.totalScenes,
                startIndex: sceneResult.startIndex,
                endIndex: sceneResult.endIndex,
                returnedCount: sceneResult.entries.length,
                entryIndexes: sceneResult.entries.map(entry => entry.historyIndex),
                sceneEntryIndexes: sceneResult.entries.map(entry => entry.sceneEntryIndex)
            }
        };
    };

    const executeRequestUserInputTool = async (args = {}, { requestUserInputHandler = null } = {}) => {
        const question = normalizeRequiredString(args.question, {
            functionName: 'requestUserInput',
            fieldName: 'question'
        });
        const handler = typeof requestUserInputHandler === 'function'
            ? requestUserInputHandler
            : (typeof requestUserInput === 'function' ? requestUserInput : null);
        if (!handler) {
            throw new ToolVisibleError(
                'requestUserInput is unavailable for this prompt.',
                { code: 'user_input_unavailable' }
            );
        }

        let response = null;
        try {
            response = await handler({ question });
        } catch (error) {
            throw new ToolVisibleError(
                error?.message || 'The player did not provide an answer.',
                { code: toTrimmedString(error?.code) || 'user_input_unavailable' }
            );
        }

        const answer = typeof response === 'string'
            ? response.trim()
            : toTrimmedString(response?.answer);
        if (!answer) {
            throw new ToolVisibleError(
                'The player did not provide an answer.',
                { code: 'user_input_empty' }
            );
        }

        return {
            content: [
                '<userInputResponse>',
                `  <question>${xmlEscapeText(question)}</question>`,
                `  <answer>${xmlEscapeText(answer)}</answer>`,
                '</userInputResponse>'
            ].join('\n'),
            metadata: {
                functionName: 'requestUserInput',
                requestId: toTrimmedString(response?.requestId) || null,
                question,
                answerLength: answer.length
            }
        };
    };

    const buildMysteryBoxXmlLines = (box, level = 0) => {
        const data = box.toJSON();
        const indent = (extra = 0) => xmlIndent(level + extra);
        const lines = [
            `${indent()}<mysteryBox>`,
            `${indent(1)}<id>${xmlEscapeText(data.id)}</id>`,
            `${indent(1)}<name>${xmlEscapeText(data.name)}</name>`,
            `${indent(1)}<keys>`
        ];
        for (const entry of data.keys) {
            lines.push(`${indent(2)}<key>${xmlEscapeText(entry)}</key>`);
        }
        lines.push(`${indent(1)}</keys>`);
        lines.push(`${indent(1)}<text>${xmlEscapeText(data.text)}</text>`);
        lines.push(`${indent(1)}<mentions>`);
        for (const mention of data.mentions) {
            lines.push(`${indent(2)}<mention>`);
            if (mention.name) {
                lines.push(`${indent(3)}<name>${xmlEscapeText(mention.name)}</name>`);
            }
            if (mention.context) {
                lines.push(`${indent(3)}<context>${xmlEscapeText(mention.context)}</context>`);
            }
            if (mention.sourceEntryId) {
                lines.push(`${indent(3)}<sourceEntryId>${xmlEscapeText(mention.sourceEntryId)}</sourceEntryId>`);
            }
            lines.push(`${indent(2)}</mention>`);
        }
        lines.push(`${indent(1)}</mentions>`);
        lines.push(`${indent()}</mysteryBox>`);
        return { lines, data };
    };

    const buildMysteryBoxSummaryXmlLines = (box, level = 0) => {
        const data = box.toJSON();
        const indent = (extra = 0) => xmlIndent(level + extra);
        const lines = [
            `${indent()}<mysteryBox>`,
            `${indent(1)}<id>${xmlEscapeText(data.id)}</id>`,
            `${indent(1)}<name>${xmlEscapeText(data.name)}</name>`,
            `${indent(1)}<keys>`
        ];
        for (const entry of data.keys) {
            lines.push(`${indent(2)}<key>${xmlEscapeText(entry)}</key>`);
        }
        lines.push(`${indent(1)}</keys>`);
        if (data.updatedAt) {
            lines.push(`${indent(1)}<updatedAt>${xmlEscapeText(data.updatedAt)}</updatedAt>`);
        }
        lines.push(`${indent()}</mysteryBox>`);
        return lines;
    };

    const executeListMysteryBoxesTool = ({ query = '' } = {}) => {
        if (query !== undefined && query !== null && typeof query !== 'string') {
            throw new Error('listMysteryBoxes "query" must be a string when provided.');
        }
        const trimmedQuery = typeof query === 'string' ? query.trim() : '';
        const matches = MysteryBox.listBySearchPhrase(trimmedQuery);
        const lines = [
            '<mysteryBoxList>',
            `  <query>${xmlEscapeText(trimmedQuery)}</query>`,
            `  <count>${matches.length}</count>`
        ];
        for (const box of matches) {
            lines.push(...buildMysteryBoxSummaryXmlLines(box, 1));
        }
        lines.push('</mysteryBoxList>');
        return {
            content: lines.join('\n'),
            metadata: {
                query: trimmedQuery,
                matchCount: matches.length,
                ids: matches.map((box) => box.id),
                names: matches.map((box) => box.name)
            }
        };
    };

    const executeFindMysteryBoxesTool = ({ query }) => {
        if (typeof query !== 'string' || !query.trim()) {
            throw new Error('findMysteryBoxes requires a non-empty "query" string.');
        }
        const trimmedQuery = query.trim();
        const matches = MysteryBox.findByNameOrKey(trimmedQuery);
        const lines = [
            '<mysteryBoxMatches>',
            `  <query>${xmlEscapeText(trimmedQuery)}</query>`,
            `  <count>${matches.length}</count>`
        ];
        for (const box of matches) {
            lines.push(...buildMysteryBoxXmlLines(box, 1).lines);
        }
        lines.push('</mysteryBoxMatches>');
        return {
            content: lines.join('\n'),
            metadata: {
                query: trimmedQuery,
                matchCount: matches.length,
                ids: matches.map((box) => box.id),
                names: matches.map((box) => box.name)
            }
        };
    };

    const executeGetMysteryBoxTool = ({ key }) => {
        if (typeof key !== 'string' || !key.trim()) {
            throw new Error('getMysteryBox requires a non-empty "key" string.');
        }
        const query = key.trim();
        const box = MysteryBox.getByKey(query) || MysteryBox.getById(query);
        if (!box) {
            throw new Error(`No mystery box matches "${query}".`);
        }
        const { lines, data } = buildMysteryBoxXmlLines(box);
        return {
            content: lines.join('\n'),
            metadata: {
                id: data.id,
                name: data.name,
                keys: data.keys,
                query
            }
        };
    };

    const buildMysteryThreadXmlLines = (thread, level = 0, { includeBoxText = true } = {}) => {
        const data = thread.toJSON();
        const indent = (extra = 0) => xmlIndent(level + extra);
        const lines = [
            `${indent()}<mysteryThread>`,
            `${indent(1)}<id>${xmlEscapeText(data.id)}</id>`,
            `${indent(1)}<name>${xmlEscapeText(data.name)}</name>`,
            `${indent(1)}<status>${xmlEscapeText(data.status)}</status>`,
            `${indent(1)}<keys>`
        ];
        for (const entry of data.keys) {
            lines.push(`${indent(2)}<key>${xmlEscapeText(entry)}</key>`);
        }
        lines.push(`${indent(1)}</keys>`);
        if (data.summary) {
            lines.push(`${indent(1)}<summary>${xmlEscapeText(data.summary)}</summary>`);
        }
        lines.push(`${indent(1)}<constraints>`);
        for (const constraint of data.constraints) {
            lines.push(`${indent(2)}<constraint>${xmlEscapeText(constraint)}</constraint>`);
        }
        lines.push(`${indent(1)}</constraints>`);
        lines.push(`${indent(1)}<mysteryBoxes>`);
        for (const boxId of data.boxIds) {
            const box = MysteryBox.getById(boxId);
            lines.push(`${indent(2)}<mysteryBox>`);
            lines.push(`${indent(3)}<id>${xmlEscapeText(boxId)}</id>`);
            if (box) {
                lines.push(`${indent(3)}<name>${xmlEscapeText(box.name)}</name>`);
                if (includeBoxText) {
                    lines.push(`${indent(3)}<text>${xmlEscapeText(box.text)}</text>`);
                }
            }
            lines.push(`${indent(2)}</mysteryBox>`);
        }
        lines.push(`${indent(1)}</mysteryBoxes>`);
        if (data.updatedAt) {
            lines.push(`${indent(1)}<updatedAt>${xmlEscapeText(data.updatedAt)}</updatedAt>`);
        }
        lines.push(`${indent()}</mysteryThread>`);
        return { lines, data };
    };

    const executeListMysteryThreadsTool = ({ query = '' } = {}) => {
        if (query !== undefined && query !== null && typeof query !== 'string') {
            throw new Error('listMysteryThreads "query" must be a string when provided.');
        }
        const trimmedQuery = typeof query === 'string' ? query.trim() : '';
        const matches = MysteryThread.listBySearchPhrase(trimmedQuery);
        const lines = [
            '<mysteryThreadList>',
            `  <query>${xmlEscapeText(trimmedQuery)}</query>`,
            `  <count>${matches.length}</count>`
        ];
        for (const thread of matches) {
            lines.push(...buildMysteryThreadXmlLines(thread, 1, { includeBoxText: false }).lines);
        }
        lines.push('</mysteryThreadList>');
        return {
            content: lines.join('\n'),
            metadata: {
                query: trimmedQuery,
                matchCount: matches.length,
                ids: matches.map((thread) => thread.id),
                names: matches.map((thread) => thread.name)
            }
        };
    };

    const executeGetMysteryThreadTool = ({ key }) => {
        if (typeof key !== 'string' || !key.trim()) {
            throw new Error('getMysteryThread requires a non-empty "key" string.');
        }
        const query = key.trim();
        const thread = MysteryThread.getById(query)
            || MysteryThread.getByKey(query)
            || MysteryThread.findByNameOrKey(query)[0];
        if (!thread) {
            throw new Error(`No mystery thread matches "${query}".`);
        }
        const { lines, data } = buildMysteryThreadXmlLines(thread, 0, { includeBoxText: true });
        return {
            content: lines.join('\n'),
            metadata: {
                id: data.id,
                name: data.name,
                status: data.status,
                boxIds: data.boxIds,
                query
            }
        };
    };

    const buildToolExecutionErrorResult = (functionName, error) => {
        const visibleError = error instanceof ToolVisibleError
            ? error
            : new ToolVisibleError(
                error?.message || `Tool "${toTrimmedString(functionName) || 'unknownTool'}" failed.`,
                { code: 'tool_execution_error' }
            );
        const result = buildToolVisibleErrorResult(functionName, visibleError);
        result.metadata = {
            ...(result.metadata && typeof result.metadata === 'object' ? result.metadata : {}),
            stack: typeof error?.stack === 'string' ? error.stack : null
        };
        return result;
    };

    const buildToolCallAttemptsExhaustedResult = (functionName, maxRounds) => buildToolVisibleErrorResult(
        functionName,
        new ToolVisibleError(
            `The prompt has exhausted its tool call attempts after ${maxRounds} tool-call round${maxRounds === 1 ? '' : 's'}. Do not call any more tools. Continue by writing the final response using the information already available.`,
            { code: 'tool_call_attempts_exhausted' }
        )
    );

    const executeChatToolCall = async (
        toolCall,
        {
            resultCache = null,
            defaultActorName = null,
            includeAllHistoryEntryTypes = false,
            requestUserInputHandler = null
        } = {}
    ) => {
        if (!toolCall || typeof toolCall !== 'object') {
            throw new Error('Tool execution requires a tool call object.');
        }
        try {
            const argumentsObject = toolCall.argumentsObject || {};
            const cacheKey = resultCache
                ? getCacheKeyForToolCall(toolCall.functionName, argumentsObject, resultCache.roundKey)
                : null;
            if (cacheKey && resultCache.entries.has(cacheKey)) {
                const cachedResult = cloneToolResult(resultCache.entries.get(cacheKey));
                if (cachedResult?.metadata && typeof cachedResult.metadata === 'object') {
                    cachedResult.metadata = {
                        ...cachedResult.metadata,
                        cached: true,
                        cacheKey
                    };
                }
                appendCachedCheckToolCallNote(cachedResult);
                return cachedResult;
            }

            let toolResult = null;
            if (toolCall.functionName === 'moreInfo') {
                toolResult = executeMoreInfoTool(argumentsObject);
            } else if (toolCall.functionName === 'getHistory') {
                toolResult = executeGetHistoryTool(argumentsObject, {
                    includeAllEntryTypes: includeAllHistoryEntryTypes
                });
            } else if (toolCall.functionName === 'getFullScene') {
                toolResult = executeGetFullSceneTool(argumentsObject);
            } else if (toolCall.functionName === 'requestUserInput') {
                toolResult = executeRequestUserInputTool(argumentsObject, {
                    requestUserInputHandler
                });
            } else if (toolCall.functionName === 'listMysteryBoxes') {
                toolResult = executeListMysteryBoxesTool(argumentsObject);
            } else if (toolCall.functionName === 'findMysteryBoxes') {
                toolResult = executeFindMysteryBoxesTool(argumentsObject);
            } else if (toolCall.functionName === 'getMysteryBox') {
                toolResult = executeGetMysteryBoxTool(argumentsObject);
            } else if (toolCall.functionName === 'listMysteryThreads') {
                toolResult = executeListMysteryThreadsTool(argumentsObject);
            } else if (toolCall.functionName === 'getMysteryThread') {
                toolResult = executeGetMysteryThreadTool(argumentsObject);
            } else if (toolCall.functionName === 'teleportCharacterToLocation') {
                toolResult = executeTeleportCharacterToLocationTool(argumentsObject);
            } else if (toolCall.functionName === 'teleportThingToLocation') {
                toolResult = executeTeleportThingToLocationTool(argumentsObject);
            } else if (toolCall.functionName === 'moveThingFromLocationToCharacterInventory') {
                toolResult = executeMoveThingFromLocationToCharacterInventoryTool(argumentsObject);
            } else if (toolCall.functionName === 'createRegionStub') {
                toolResult = executeCreateRegionStubTool(argumentsObject);
            } else if (toolCall.functionName === 'createLocationStub') {
                toolResult = executeCreateLocationStubTool(argumentsObject);
            } else if (toolCall.functionName === 'createExit') {
                toolResult = executeCreateExitTool(argumentsObject);
            } else if (toolCall.functionName === 'listLocationEntities') {
                toolResult = executeListLocationEntitiesTool(argumentsObject);
            } else if (toolCall.functionName === 'createThing') {
                toolResult = executeCreateThingTool(argumentsObject);
            } else if (toolCall.functionName === 'alterThing') {
                toolResult = executeAlterThingTool(argumentsObject);
            } else if (toolCall.functionName === 'alterNpc') {
                toolResult = executeAlterNpcTool(argumentsObject);
            } else if (toolCall.functionName === 'updateCharacterFields') {
                toolResult = executeUpdateCharacterFieldsTool(argumentsObject);
            } else if (toolCall.functionName === 'updateObjectFields') {
                toolResult = executeUpdateObjectFieldsTool(argumentsObject);
            } else if (toolCall.functionName === 'alterLocation') {
                toolResult = executeAlterLocationTool(argumentsObject);
            } else if (toolCall.functionName === 'resolveAttack') {
                toolResult = executeResolveAttackTool(argumentsObject);
            } else if (toolCall.functionName === 'resolveAreaAttack') {
                toolResult = executeResolveAreaAttackTool(argumentsObject);
            } else if (toolCall.functionName === 'resolveSkillCheck' || toolCall.functionName === 'resolvePlausibilityCheck') {
                toolResult = executeResolvePlausibilityCheckTool(argumentsObject, {
                    defaultActorName,
                    toolName: toolCall.functionName
                });
            } else if (toolCall.functionName === 'resolveOpposedSkillCheck' || toolCall.functionName === 'resolveOpposedPlausibilityCheck') {
                toolResult = executeResolveOpposedPlausibilityCheckTool(argumentsObject, {
                    defaultActorName,
                    toolName: toolCall.functionName
                });
            } else if (toolCall.functionName === 'locateNpcs') {
                toolResult = executeLocateNpcsTool(argumentsObject);
            } else if (toolCall.functionName === 'locateThings') {
                toolResult = executeLocateThingsTool(argumentsObject);
            } else {
                throw new Error(`Unsupported tool call function "${toolCall.functionName}".`);
            }
            const resolvedToolResult = await toolResult;
            if (cacheKey) {
                if (resolvedToolResult?.metadata && typeof resolvedToolResult.metadata === 'object') {
                    resolvedToolResult.metadata = {
                        ...resolvedToolResult.metadata,
                        cached: false,
                        cacheKey
                    };
                }
                resultCache.entries.set(cacheKey, cloneToolResult(resolvedToolResult));
            }
            return resolvedToolResult;
        } catch (error) {
            return buildToolExecutionErrorResult(toolCall.functionName, error);
        }
    };

    const runChatCompletionWithToolLoop = async ({
        requestOptions,
        streamEmitter = null,
        metadataLabel = 'chat',
        toolResultCache = null,
        onToolCallDebug = null,
        onToolCallEvent = null,
        defaultToolActor = null,
        includeAllHistoryEntryTypes = false,
        requestUserInput: requestUserInputHandler = null
    }) => {
        if (!requestOptions || typeof requestOptions !== 'object') {
            throw new Error('runChatCompletionWithToolLoop requires requestOptions.');
        }
        if (!Array.isArray(requestOptions.messages) || !requestOptions.messages.length) {
            throw new Error('runChatCompletionWithToolLoop requires non-empty requestOptions.messages.');
        }
        if (onToolCallDebug !== null && onToolCallDebug !== undefined && typeof onToolCallDebug !== 'function') {
            throw new Error('runChatCompletionWithToolLoop onToolCallDebug must be a function when provided.');
        }
        if (onToolCallEvent !== null && onToolCallEvent !== undefined && typeof onToolCallEvent !== 'function') {
            throw new Error('runChatCompletionWithToolLoop onToolCallEvent must be a function when provided.');
        }

        const config = getConfig();
        const configuredMaxRounds = Number(config?.ai?.max_tool_rounds);
        const maxRounds = Number.isInteger(configuredMaxRounds) && configuredMaxRounds > 0
            ? configuredMaxRounds
            : CHAT_TOOL_MAX_ROUNDS;
        const originalOnResponse = typeof requestOptions.onResponse === 'function'
            ? requestOptions.onResponse
            : null;
        const messages = requestOptions.messages.map(message => (
            message && typeof message === 'object'
                ? JSON.parse(JSON.stringify(message))
                : message
        ));

        let aiResponse = '';
        let lastResponse = null;
        let rounds = 0;
        let completed = false;
        let toolLoopActivated = false;
        let toolRoundsUsed = 0;
        let toolsDisabledAfterExhaustion = false;
        let exhaustionErrorRounds = 0;
        const toolInvocations = [];
        const resultCache = normalizeToolResultCache(toolResultCache, { metadataLabel });
        const defaultActorName = normalizeOptionalString(defaultToolActor);
        let toolInvocationSequence = 0;
        const notifyToolCallLifecycle = async (payload) => {
            if (typeof onToolCallEvent === 'function') {
                await onToolCallEvent(payload);
            }
            if (typeof onToolCallDebug === 'function') {
                await onToolCallDebug(payload);
            }
        };
        const logToolCallError = ({ toolCall, toolResult }) => {
            const metadata = toolResult?.metadata && typeof toolResult.metadata === 'object'
                ? toolResult.metadata
                : {};
            const functionName = toTrimmedString(metadata.functionName) || toTrimmedString(toolCall?.functionName) || 'unknownTool';
            const message = toTrimmedString(metadata.message) || 'Tool call failed.';
            const code = toTrimmedString(metadata.code) || 'tool_error';
            const stack = toTrimmedString(metadata.stack);
            console.warn(`Chat tool call "${functionName}" failed (${code}): ${message}`);
            if (stack) {
                console.warn(stack);
            }
            if (LLMClient && typeof LLMClient.logPrompt === 'function') {
                try {
                    LLMClient.logPrompt({
                        prefix: `${metadataLabel || 'chat'}_tool_call_error`,
                        metadataLabel: `${metadataLabel || 'chat'}_tool_call_error`,
                        systemPrompt: '',
                        generationPrompt: [
                            `Tool: ${functionName}`,
                            `Arguments: ${toTrimmedString(toolCall?.argumentsText) || '{}'}`,
                            `Code: ${code}`,
                            `Message: ${message}`
                        ].join('\n'),
                        response: toolResult?.content || '',
                        sections: stack ? [{ title: 'Stack', content: stack }] : [],
                        output: 'silent'
                    });
                } catch (logError) {
                    console.warn(`Failed to write chat tool error log for "${functionName}":`, logError?.message || logError);
                }
            }
        };

        while (!completed) {
            rounds += 1;
            if (toolsDisabledAfterExhaustion && exhaustionErrorRounds > 3) {
                throw new Error(`Tool-call loop kept returning tool calls after attempts were exhausted for ${metadataLabel}.`);
            }

            let roundResponse = null;
            const roundOptions = {
                ...requestOptions,
                messages,
                onResponse: (response) => {
                    roundResponse = response;
                    if (originalOnResponse) {
                        originalOnResponse(response);
                    }
                }
            };
            if (toolsDisabledAfterExhaustion) {
                delete roundOptions.tools;
                delete roundOptions.functions;
                delete roundOptions.parallel_tool_calls;
                roundOptions.tool_choice = 'none';
                roundOptions.function_call = 'none';
            }

            aiResponse = await LLMClient.chatCompletion(roundOptions);
            lastResponse = roundResponse;

            const assistantMessage = roundResponse?.data?.choices?.[0]?.message || null;
            const rawToolCalls = Array.isArray(assistantMessage?.tool_calls)
                ? assistantMessage.tool_calls
                : [];
            const toolCalls = normalizeToolCallsForExecution(rawToolCalls, {
                sourceLabel: `${metadataLabel} round ${rounds}`
            });

            if (toolLoopActivated || toolCalls.length) {
                const roundLabel = `${metadataLabel}_tool_loop_round`;
                const toolCallSummary = toolCalls.length
                    ? toolCalls.map((call, index) => {
                        const argumentText = typeof call.argumentsText === 'string' && call.argumentsText.trim()
                            ? call.argumentsText.trim()
                            : '{}';
                        return [
                            `${index + 1}. ${call.functionName}`,
                            `   id: ${call.id || '(none)'}`,
                            `   arguments: ${argumentText}`
                        ].join('\n');
                    }).join('\n\n')
                    : 'No tool calls returned this round.';
                LLMClient.logPrompt({
                    prefix: roundLabel,
                    metadataLabel: roundLabel,
                    systemPrompt: '',
                    generationPrompt: LLMClient.formatMessagesForErrorLog(messages),
                    response: aiResponse || '',
                    sections: [
                        {
                            title: 'TOOL CALLS',
                            content: toolCallSummary
                        }
                    ]
                });
            }

            if (!toolCalls.length) {
                completed = true;
                continue;
            }
            toolLoopActivated = true;
            const toolCallsExhausted = toolRoundsUsed >= maxRounds;
            if (toolCallsExhausted) {
                exhaustionErrorRounds += 1;
                toolsDisabledAfterExhaustion = true;
            } else {
                toolRoundsUsed += 1;
            }

            if (streamEmitter?.isEnabled) {
                const toolStatusStage = `${metadataLabel || 'chat'}:tool_calls`;
                streamEmitter.status(toolStatusStage, {
                    round: rounds,
                    toolCallCount: toolCalls.length,
                    message: toolCallsExhausted
                        ? `Tool call attempts exhausted; returning ${toolCalls.length} tool error${toolCalls.length === 1 ? '' : 's'}...`
                        : `Running ${toolCalls.length} tool call${toolCalls.length === 1 ? '' : 's'}...`
                });
            }

            messages.push({
                role: 'assistant',
                content: typeof assistantMessage?.content === 'string' ? assistantMessage.content : (aiResponse || ''),
                tool_calls: toolCalls.map(call => ({
                    id: call.id,
                    type: 'function',
                    function: {
                        name: call.functionName,
                        arguments: call.argumentsText
                    }
                }))
            });

            for (const toolCall of toolCalls) {
                toolInvocationSequence += 1;
                const debugBase = {
                    metadataLabel,
                    round: rounds,
                    sequence: toolInvocationSequence,
                    id: toolCall.id,
                    name: toolCall.functionName,
                    parameters: toolCall.argumentsObject,
                    argumentsText: toolCall.argumentsText
                };
                await notifyToolCallLifecycle({
                    ...debugBase,
                    phase: 'started'
                });

                let toolResult = null;
                try {
                    toolResult = toolCallsExhausted
                        ? buildToolCallAttemptsExhaustedResult(toolCall.functionName, maxRounds)
                        : await executeChatToolCall(toolCall, {
                            resultCache,
                            defaultActorName,
                            includeAllHistoryEntryTypes,
                            requestUserInputHandler
                        });
                    if (!toolResult || typeof toolResult.content !== 'string' || !toolResult.content.trim()) {
                        throw new Error(`Tool "${toolCall.functionName}" returned empty content.`);
                    }
                } catch (error) {
                    toolResult = buildToolExecutionErrorResult(toolCall.functionName, error);
                }

                try {
                    const cacheHit = Boolean(toolResult.metadata?.cached);
                    const toolErrored = Boolean(toolResult.metadata?.error);
                    if (toolErrored) {
                        logToolCallError({ toolCall, toolResult });
                        await notifyToolCallLifecycle({
                            ...debugBase,
                            phase: 'error',
                            error: {
                                message: toolResult.metadata?.message || `Tool "${toolCall.functionName}" failed.`,
                                code: toolResult.metadata?.code || 'tool_error',
                                result: {
                                    content: toolResult.content,
                                    metadata: toolResult.metadata || null
                                }
                            }
                        });
                    } else {
                        await notifyToolCallLifecycle({
                            ...debugBase,
                            phase: 'completed',
                            cacheHit,
                            cacheKey: typeof toolResult.metadata?.cacheKey === 'string'
                                ? toolResult.metadata.cacheKey
                                : null,
                            result: {
                                content: toolResult.content,
                                metadata: toolResult.metadata || null
                            }
                        });
                    }
                    toolInvocations.push({
                        id: toolCall.id,
                        name: toolCall.functionName,
                        metadata: toolResult.metadata || null
                    });
                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        name: toolCall.functionName,
                        content: toolResult.content
                    });
                } catch (error) {
                    await notifyToolCallLifecycle({
                        ...debugBase,
                        phase: 'error',
                        error: {
                            message: error?.message || String(error)
                        }
                    });
                    throw error;
                }
            }
        }

        return {
            aiResponse,
            response: lastResponse,
            rounds,
            toolInvocations
        };
    };

    return {
        CHAT_TOOL_DEFINITIONS,
        collectHistoryMatches,
        runChatCompletionWithToolLoop
    };
};

module.exports = {
    CHAT_TOOL_DEFINITIONS,
    createChatToolRuntime
};
