const path = require('path');
const { randomBytes } = require('crypto');
const nunjucks = require('nunjucks');
const { addEvalFilter } = require('./nunjucks_filters.js');
const {
    getSceneSummaryIndexText,
    shouldIncludeEntryInSceneSummaryIndex
} = require('./scene_summary_index.js');
const {
    shouldExcludeEntryFromPromptHistory
} = require('./base_context_history.js');
const MysteryBox = require('./MysteryBox.js');
const MysteryThread = require('./MysteryThread.js');
const Faction = require('./Faction.js');
const Tracker = require('./Tracker.js');
const Utils = require('./Utils.js');
const { normalizeWeatherExposure } = require('./location_region_utils.js');
const { applyRegexReplace } = require('./regex_replace_runtime.js');
const Quest = require('./Quest.js');
const { questRewardBenefitRegistry } = require('./QuestRewardBenefitRegistry.js');
const ThingMutationService = require('./ThingMutationService.js');
const ThingFieldRegistry = require('./ThingFieldRegistry.js');

const MORE_INFO_MAX_MATCHES = 50;
const CACHED_CHECK_TOOL_CALL_NOTE = 'You already made this tool call. Do not re-run tool calls for the same checks that you made in earlier drafts.';
const TRACKER_TYPE_VALUES = Object.freeze(Tracker.validTypes);
const RELATIONSHIP_LABEL_MAX_WORDS = 6;
const RELATIONSHIP_LABEL_MAX_WORDS_TEXT = 'six';
const CHAT_TOOLS_THAT_MAY_LAUNCH_PROMPTS = new Set([
    'alterLocation',
    'alterNpc',
    'alterThing',
    'recreateThing',
    'createNpc',
    'createQuest',
    'createThing',
    'rerunSceneSummary',
    'bulkUpdateCharacterFields',
    'updateCharacterFields',
    'updateObjectFields',
    'upsertFactionFields'
]);
const MUTATING_CHAT_TOOL_NAMES = new Set([
    'editChatLogEntry',
    'regexReplace',
    'rerunSceneSummary',
    'editSceneSummary',
    'teleportCharacterToLocation',
    'teleportThingToLocation',
    'moveThingFromLocationToCharacterInventory',
    'createRegionStub',
    'createLocationStub',
    'createExit',
    'revealEntity',
    'hideEntity',
    'createThing',
    'createNpc',
    'deleteThing',
    'setRelationship',
    'addTracker',
    'updateTracker',
    'removeTracker',
    'createQuest',
    'scheduleEvent',
    'alterThing',
    'recreateThing',
    'alterNpc',
    'updateCharacterFields',
    'bulkUpdateCharacterFields',
    'updateObjectFields',
    'upsertFactionFields',
    'updatePartyMembers',
    'alterLocation'
]);

function chatToolMayLaunchPrompts(name) {
    return typeof name === 'string' && CHAT_TOOLS_THAT_MAY_LAUNCH_PROMPTS.has(name.trim());
}
const SKILL_CHECK_TOOL_NAMES = new Set([
    'resolveSkillCheck',
    'resolveOpposedSkillCheck',
    'resolvePlausibilityCheck',
    'resolveOpposedPlausibilityCheck'
]);
const UPDATE_MYSTERY_BOX_FIELD_NAMES = Object.freeze([
    'name',
    'keys',
    'text'
]);
const UPDATE_MYSTERY_BOX_FIELD_SET = new Set(UPDATE_MYSTERY_BOX_FIELD_NAMES);
const UPDATE_MYSTERY_THREAD_FIELD_NAMES = Object.freeze([
    'name',
    'status',
    'keys',
    'summary',
    'constraints'
]);
const UPDATE_MYSTERY_THREAD_FIELD_SET = new Set(UPDATE_MYSTERY_THREAD_FIELD_NAMES);
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
const ADMIN_UPDATE_CHARACTER_FIELD_NAMES = Object.freeze([
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
    'personality',
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
    'relationships',
    'willingToTrade'
]);
const UPDATE_CHARACTER_FIELD_NAMES = Object.freeze(
    ADMIN_UPDATE_CHARACTER_FIELD_NAMES.filter(fieldName => fieldName !== 'shortDescription')
);
const UPDATE_CHARACTER_FIELD_SET = new Set(UPDATE_CHARACTER_FIELD_NAMES);
const UPDATE_CHARACTER_PERSONALITY_FIELD_MAP = Object.freeze({
    type: 'personalityType',
    traits: 'personalityTraits',
    notes: 'personalityNotes',
    aiNotes: 'aiNotes'
});
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
const SHORT_DESCRIPTION_OBJECT_TYPES = new Set([
    'character',
    'thing',
    'location',
    'region',
    'faction'
]);
const UPSERT_FACTION_OPERATION_VALUES = Object.freeze(['create', 'update']);
const UPSERT_FACTION_DEFAULT_RELATION_STATUS = 'neutral';
const UPSERT_FACTION_DEFAULT_RELATION_NOTES = 'No explicit relationship provided.';
const BUILTIN_THING_UPDATE_FIELD_NAMES = Object.freeze(
    ThingFieldRegistry.BUILTIN_FIELDS
        .filter(field => field.exposeToUpdateTool === true)
        .map(field => field.fieldName)
);
const ADMIN_UPDATE_OBJECT_FIELD_NAMES_BY_TYPE = Object.freeze({
    character: ADMIN_UPDATE_CHARACTER_FIELD_NAMES,
    thing: BUILTIN_THING_UPDATE_FIELD_NAMES,
    location: Object.freeze([
        'name',
        'description',
        'shortDescription',
        'baseLevel',
        'visited',
        'lastVisitedTime',
        'hasGeneratedStubs',
        'hasWeather',
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
        'rewardBenefits',
        'rewardNotes',
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
const UPDATE_OBJECT_FIELD_NAMES_BY_TYPE = Object.freeze(Object.fromEntries(
    Object.entries(ADMIN_UPDATE_OBJECT_FIELD_NAMES_BY_TYPE).map(([objectType, fieldNames]) => [
        objectType,
        Object.freeze(fieldNames.filter(fieldName => fieldName !== 'shortDescription'))
    ])
));
const CHAT_TOOL_DEFINITIONS = Object.freeze([
    {
        type: 'function',
        function: {
            name: 'generateRandomInteger',
            description: 'Generate one random integer in an inclusive range where min <= result <= max.',
            parameters: {
                type: 'object',
                properties: {
                    min: {
                        type: 'integer',
                        description: 'Inclusive minimum integer result.'
                    },
                    max: {
                        type: 'integer',
                        description: 'Inclusive maximum integer result. Must be greater than or equal to min.'
                    }
                },
                required: ['min', 'max'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'moreInfo',
            description: 'Return compact JSON objects for NPCs, things, locations, and regions whose names contain the given query substring. Do not call this for items or characters whose full XML is already visible in the prompt; it would return redundant information. Use includeFullState only for debugging raw persisted/runtime fields.',
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
            name: 'editChatLogEntry',
            description: 'Edit one stored chat log entry. Generic-prompt mutation tool only. Use ids, timestamps, or zero-based history indexes returned by getHistory/getFullScene; do not invent entries.',
            parameters: {
                type: 'object',
                properties: {
                    entry: {
                        type: 'string',
                        description: 'Optional chat entry id, timestamp, or zero-based history index as returned by getHistory/getFullScene.'
                    },
                    index: {
                        type: 'integer',
                        minimum: 0,
                        description: 'Optional zero-based chatHistory index as returned by getHistory/getFullScene.'
                    },
                    content: {
                        type: 'string',
                        description: 'Replacement entry content. Must be non-empty.'
                    },
                    reason: {
                        type: 'string',
                        description: 'Optional private reason for the edit, used only in tool metadata.'
                    }
                },
                required: ['content'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'regexReplace',
            description: 'Run one exact JavaScript regular-expression replacement across persisted game text. Generic-prompt mutation tool only. With no scope, searches story entries, actor memories, NPC narrative fields, location descriptions, and item/scenery descriptions. Use scope story, memories, npcs, locations, or items to restrict a category; any other scope is treated as an exact chat-entry type.',
            parameters: {
                type: 'object',
                properties: {
                    pattern: {
                        type: 'string',
                        minLength: 1,
                        description: 'JavaScript regular-expression pattern without slash delimiters.'
                    },
                    replacement: {
                        type: 'string',
                        description: 'Replacement text. JavaScript replacement captures such as $1 are supported. Use an empty string to delete matches.'
                    },
                    flags: {
                        type: 'string',
                        default: 'g',
                        description: 'JavaScript regex flags using only g, i, m, s, u, and y. Defaults to g.'
                    },
                    scope: {
                        type: 'string',
                        description: 'Optional category (story, memories, npcs, locations, items) or exact chat-entry type. Omit to search every supported text category.'
                    }
                },
                required: ['pattern', 'replacement'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'rerunSceneSummary',
            description: 'Re-run a stored Scene N summary by resolving its saved range and calling the scene summarizer again for that range. Generic-prompt mutation tool only.',
            parameters: {
                type: 'object',
                properties: {
                    sceneNumber: {
                        type: 'integer',
                        minimum: 1,
                        description: '1-based Scene N display number from <olderStoryHistory>, /scene_summaries, or getFullScene.'
                    },
                    reason: {
                        type: 'string',
                        description: 'Optional private reason for rerunning this scene summary, used only in tool metadata.'
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
            name: 'editSceneSummary',
            description: 'Directly edit one stored Scene N summary, including its summary text, details, and quotes. Generic-prompt mutation tool only.',
            parameters: {
                type: 'object',
                properties: {
                    sceneNumber: {
                        type: 'integer',
                        minimum: 1,
                        description: '1-based Scene N display number from <olderStoryHistory>, /scene_summaries, or getFullScene.'
                    },
                    summary: {
                        type: 'string',
                        description: 'Replacement scene summary text. Must be non-empty.'
                    },
                    details: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Replacement detail bullet lines. Omit or pass an empty array for no detail lines.'
                    },
                    quotes: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                character: { type: 'string' },
                                text: { type: 'string' }
                            },
                            required: ['character', 'text'],
                            additionalProperties: false
                        },
                        description: 'Replacement notable quotes for the scene.'
                    },
                    reason: {
                        type: 'string',
                        description: 'Optional private reason for the edit, used only in tool metadata.'
                    }
                },
                required: ['sceneNumber', 'summary'],
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
            name: 'updateMysteryBoxFields',
            description: 'Directly update selected editable fields on one private GM-only mystery box. Available for explicit world-state editing; keys replace the editable alias list instead of merging.',
            parameters: {
                type: 'object',
                properties: {
                    mysteryBox: {
                        type: 'string',
                        description: 'Mystery box id, name, key, or alias. Use an exact id when a name is ambiguous.'
                    },
                    fields: {
                        type: 'object',
                        properties: {
                            name: {
                                type: 'string',
                                description: 'Optional new canonical mystery box name. Must be non-empty when provided.'
                            },
                            keys: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Optional replacement alias/key list. The canonical name is always retained automatically.'
                            },
                            text: {
                                type: 'string',
                                description: 'Optional replacement private note text. May be an empty string to clear the note.'
                            }
                        },
                        minProperties: 1,
                        additionalProperties: false
                    }
                },
                required: ['mysteryBox', 'fields'],
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
            name: 'updateMysteryThreadFields',
            description: 'Directly update selected editable fields on one private GM-only mystery thread. Available for explicit world-state editing; keys and constraints replace the existing lists instead of merging. Does not change contained mystery-box assignments.',
            parameters: {
                type: 'object',
                properties: {
                    mysteryThread: {
                        type: 'string',
                        description: 'Mystery thread id, name, key, or alias. Use an exact id when a name is ambiguous.'
                    },
                    fields: {
                        type: 'object',
                        properties: {
                            name: {
                                type: 'string',
                                description: 'Optional new canonical mystery thread name. Must be non-empty when provided.'
                            },
                            status: {
                                type: 'string',
                                enum: ['active', 'inactive', 'concluded'],
                                description: 'Optional replacement thread status.'
                            },
                            keys: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Optional replacement alias/key list. The canonical name is always retained automatically.'
                            },
                            summary: {
                                type: 'string',
                                description: 'Optional replacement private thread summary. May be an empty string to clear the summary.'
                            },
                            constraints: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Optional replacement canonical fact/constraint list.'
                            }
                        },
                        minProperties: 1,
                        additionalProperties: false
                    }
                },
                required: ['mysteryThread', 'fields'],
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
            name: 'getTravelTime',
            description: 'Calculate the shortest known travel time and route from one region/location to another. If fromLocation is omitted, uses the current player location as the origin.',
            parameters: {
                type: 'object',
                properties: {
                    region: {
                        type: 'string',
                        description: 'Destination region ID or name.'
                    },
                    location: {
                        type: 'string',
                        description: 'Destination location ID or name.'
                    },
                    fromRegion: {
                        type: 'string',
                        description: 'Optional origin region ID or name, used to disambiguate fromLocation.'
                    },
                    fromLocation: {
                        type: 'string',
                        description: 'Optional origin location ID or name. Omit to use the current player location.'
                    }
                },
                required: ['region', 'location'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'revealEntity',
            description: 'Mark a hidden character or NPC as visible to the player after you have already resolved any needed opposed check yourself.',
            parameters: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'Character ID or name to reveal.'
                    },
                    description: {
                        type: 'string',
                        description: 'Optional short description of how the character becomes visible.'
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
            name: 'hideEntity',
            description: 'Mark a visible character or NPC as hidden from the player after you have already resolved any needed opposed check yourself.',
            parameters: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'Character ID or name to hide.'
                    },
                    description: {
                        type: 'string',
                        description: 'Optional short description of how the character hides.'
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
                    count: {
                        type: 'integer',
                        minimum: 0,
                        description: 'Optional number of identical items in the created stack. Defaults to 1.'
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
                    requiresCheckToOpen: {
                        type: 'boolean',
                        description: 'Optional checked-open flag for containers. Set true when the player must describe an opening attempt and pass a skill check before the container inventory is shown.'
                    },
                    containerContents: {
                        type: 'array',
                        description: 'Optional pending contents for a container. Each entry names an item stack that will be generated when the container is opened or inspected.',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string' },
                                count: { type: 'integer', minimum: 0 }
                            },
                            required: ['name', 'count'],
                            additionalProperties: false
                        }
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
                            duration: { type: 'string' },
                            attributes: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        name: { type: 'string' },
                                        modifier: { type: 'number' }
                                    },
                                    required: ['name', 'modifier'],
                                    additionalProperties: false
                                }
                            },
                            skills: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        name: { type: 'string' },
                                        modifier: { type: 'number' }
                                    },
                                    required: ['name', 'modifier'],
                                    additionalProperties: false
                                }
                            },
                            needBars: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        name: { type: 'string' },
                                        delta: { type: 'number' }
                                    },
                                    required: ['name', 'delta'],
                                    additionalProperties: false
                                }
                            }
                        },
                        additionalProperties: false
                    },
                    causeStatusEffectOnEquipper: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            description: { type: 'string' },
                            duration: { type: 'string' },
                            attributes: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        name: { type: 'string' },
                                        modifier: { type: 'number' }
                                    },
                                    required: ['name', 'modifier'],
                                    additionalProperties: false
                                }
                            },
                            skills: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        name: { type: 'string' },
                                        modifier: { type: 'number' }
                                    },
                                    required: ['name', 'modifier'],
                                    additionalProperties: false
                                }
                            },
                            needBars: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        name: { type: 'string' },
                                        delta: { type: 'number' }
                                    },
                                    required: ['name', 'delta'],
                                    additionalProperties: false
                                }
                            }
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
            name: 'createNpc',
            description: 'Create an NPC at a location using the single NPC generator. Returns the final created name, which may differ from the requested name after generation and name validation.',
            parameters: {
                type: 'object',
                minProperties: 1,
                properties: {
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
                        description: 'Optional preferred NPC name.'
                    },
                    description: {
                        type: 'string',
                        description: 'Optional long description seed.'
                    },
                    shortDescription: {
                        type: 'string',
                        description: 'Optional short description seed.'
                    },
                    role: {
                        type: 'string',
                        description: 'Optional narrative role seed, such as guard, merchant, rival, or witness.'
                    },
                    class: {
                        type: 'string',
                        description: 'Optional class/profession/archetype seed.'
                    },
                    race: {
                        type: 'string',
                        description: 'Optional species/ancestry seed.'
                    },
                    level: {
                        type: 'integer',
                        description: 'Optional absolute desired level. Do not provide when relativeLevel is provided.'
                    },
                    relativeLevel: {
                        type: 'integer',
                        description: 'Optional level delta from the target location base level. Do not provide when level is provided.'
                    },
                    currency: {
                        type: 'integer',
                        description: 'Optional starting currency.'
                    },
                    isHostile: {
                        type: 'boolean',
                        description: 'Optional hostile flag.'
                    },
                    hiddenFromPlayer: {
                        type: 'boolean',
                        description: 'Optional hidden flag for NPCs that start present but unnoticed.'
                    },
                    aiNotes: {
                        type: 'string',
                        description: 'Optional private AI notes to persist on the NPC.'
                    },
                    notes: {
                        type: 'string',
                        description: 'Optional extra generation instructions. These are prompt guidance and are not persisted directly.'
                    }
                },
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'deleteThing',
            description: 'Delete an existing item or scenery thing after explicit player confirmation. Use an exact Thing id when possible; ambiguous names must be retried with an id.',
            parameters: {
                type: 'object',
                properties: {
                    thing: {
                        type: 'string',
                        description: 'Thing ID or exact name for the item/scenery to delete.'
                    }
                },
                required: ['thing'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'setRelationship',
            description: 'Set a short persisted relationship label from one non-player character to another. Neither character may be the current player. Available to regular prose, generic/scheduled mutation, and plot-analysis prompts. Provide reciprocalRelationship only when the reverse relationship should also be set; omit it to leave the reverse edge unchanged.',
            parameters: {
                type: 'object',
                properties: {
                    characterA: {
                        type: 'string',
                        description: 'Source character ID or exact/unique character name. Must not be the current player.'
                    },
                    characterB: {
                        type: 'string',
                        description: 'Target character ID or exact/unique character name. Must not be the current player.'
                    },
                    relationship: {
                        type: 'string',
                        description: 'Short label for how characterA relates to characterB. Must be six words or fewer.'
                    },
                    reciprocalRelationship: {
                        type: 'string',
                        description: 'Optional short label for how characterB relates to characterA. Must be six words or fewer. Omit or leave blank to leave the reverse edge unchanged.'
                    },
                    items: {
                        type: 'array',
                        minItems: 1,
                        description: 'Optional batch mode. Each item is one relationship update with characterA, characterB, relationship, and optional reciprocalRelationship. When provided, every item is attempted and item-level errors are reported without blocking later items.',
                        items: {
                            type: 'object',
                            properties: {
                                characterA: {
                                    type: 'string',
                                    description: 'Source character ID or exact/unique character name. Must not be the current player.'
                                },
                                characterB: {
                                    type: 'string',
                                    description: 'Target character ID or exact/unique character name. Must not be the current player.'
                                },
                                relationship: {
                                    type: 'string',
                                    description: 'Short label for how characterA relates to characterB. Must be six words or fewer.'
                                },
                                reciprocalRelationship: {
                                    type: 'string',
                                    description: 'Optional short label for how characterB relates to characterA. Must be six words or fewer. Omit or leave blank to leave the reverse edge unchanged.'
                                }
                            },
                            required: ['characterA', 'characterB', 'relationship'],
                            additionalProperties: false
                        }
                    }
                },
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'addTracker',
            description: 'Create a persisted plot tracker for an important changing value. Available to regular prose, generic/scheduled mutation, and plot-analysis prompts. For countdown trackers, provide a concrete duration until the deadline; the game stores the absolute target time and displays remaining time automatically. Include concrete LLM guidance for when future tool calls should update it.',
            parameters: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'Short display name for the tracked plot value.'
                    },
                    type: {
                        type: 'string',
                        enum: TRACKER_TYPE_VALUES,
                        description: 'Tracker value type.'
                    },
                    value: {
                        type: 'string',
                        description: 'Initial value. For countdown use a concrete duration such as "29 days", "1 hour 30 minutes", or "00:45"; use x/total for x_out_of_total, a number with optional % for percentage, and at most the configured word limit for short_string.'
                    },
                    hiddenFromPlayer: {
                        type: 'boolean',
                        description: 'Optional. Set true when the player should not normally see this tracker.'
                    },
                    description: {
                        type: 'string',
                        description: 'One paragraph of private LLM guidance explaining what the tracker means and exactly when to update it.'
                    },
                    note: {
                        type: 'string',
                        description: 'Optional private LLM note explaining why the initial value is what it is. Must be 100 words or fewer.'
                    },
                    items: {
                        type: 'array',
                        minItems: 1,
                        description: 'Optional batch mode. Each item is one tracker creation with name, type, value, hiddenFromPlayer, description, and optional note. When provided, every item is attempted and item-level errors are reported without blocking later items.',
                        items: {
                            type: 'object',
                            properties: {
                                name: {
                                    type: 'string',
                                    description: 'Short display name for the tracked plot value.'
                                },
                                type: {
                                    type: 'string',
                                    enum: TRACKER_TYPE_VALUES,
                                    description: 'Tracker value type.'
                                },
                                value: {
                                    type: 'string',
                                    description: 'Initial value. For countdown use a concrete duration such as "29 days", "1 hour 30 minutes", or "00:45"; use x/total for x_out_of_total, a number with optional % for percentage, and at most the configured word limit for short_string.'
                                },
                                hiddenFromPlayer: {
                                    type: 'boolean',
                                    description: 'Optional. Set true when the player should not normally see this tracker.'
                                },
                                description: {
                                    type: 'string',
                                    description: 'One paragraph of private LLM guidance explaining what the tracker means and exactly when to update it.'
                                },
                                note: {
                                    type: 'string',
                                    description: 'Optional private LLM note explaining why the initial value is what it is. Must be 100 words or fewer.'
                                }
                            },
                            required: ['name', 'type', 'value', 'description'],
                            additionalProperties: false
                        }
                    }
                },
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'updateTracker',
            description: 'Update only the value of an existing plot tracker and stamp its last-updated time. Countdown tracker values reset the stored deadline to current game time plus the supplied duration; do not update countdowns just to tick time down. Use the tracker id when possible; ambiguous names must be retried with an id.',
            parameters: {
                type: 'object',
                properties: {
                    tracker: {
                        type: 'string',
                        description: 'Tracker ID or exact/unique tracker name.'
                    },
                    value: {
                        type: 'string',
                        description: 'New value using the tracker type format. For countdown, provide a concrete duration until the new deadline. For percentage, use a number with optional %.'
                    },
                    note: {
                        type: 'string',
                        description: 'Optional replacement private LLM note explaining why the new value is what it is. Must be 100 words or fewer. Omit to keep the current note unchanged.'
                    },
                    items: {
                        type: 'array',
                        minItems: 1,
                        description: 'Optional batch mode. Each item is one tracker update with tracker, value, and optional note. When provided, every item is attempted and item-level errors are reported without blocking later items.',
                        items: {
                            type: 'object',
                            properties: {
                                tracker: {
                                    type: 'string',
                                    description: 'Tracker ID or exact/unique tracker name.'
                                },
                                value: {
                                    type: 'string',
                                    description: 'New value using the tracker type format. For countdown, provide a concrete duration until the new deadline. For percentage, use a number with optional %.'
                                },
                                note: {
                                    type: 'string',
                                    description: 'Optional replacement private LLM note explaining why the new value is what it is. Must be 100 words or fewer. Omit to keep the current note unchanged.'
                                }
                            },
                            required: ['tracker', 'value'],
                            additionalProperties: false
                        }
                    }
                },
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'removeTracker',
            description: 'Remove an existing plot tracker that is no longer active. Use the tracker id when possible; ambiguous names must be retried with an id.',
            parameters: {
                type: 'object',
                properties: {
                    tracker: {
                        type: 'string',
                        description: 'Tracker ID or exact/unique tracker name.'
                    },
                    items: {
                        type: 'array',
                        minItems: 1,
                        description: 'Optional batch mode. Each item is one tracker removal with tracker. When provided, every item is attempted and item-level errors are reported without blocking later items.',
                        items: {
                            type: 'object',
                            properties: {
                                tracker: {
                                    type: 'string',
                                    description: 'Tracker ID or exact/unique tracker name.'
                                }
                            },
                            required: ['tracker'],
                            additionalProperties: false
                        }
                    }
                },
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'createQuest',
            description: 'Create or update a player quest from a concise quest summary using the same quest-generation and confirmation path as received_quest events. Requires an active client when a new quest needs player confirmation.',
            parameters: {
                type: 'object',
                properties: {
                    summary: {
                        type: 'string',
                        description: 'Concise description of the quest or task the player has taken on.'
                    },
                    giver: {
                        type: 'string',
                        description: 'Optional quest giver ID or exact/unique character name. Omit or leave blank when no giver applies.'
                    }
                },
                required: ['summary'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'scheduleEvent',
            description: 'Schedule a planned future event at a specific region and location. Provide exactly one timing mode: either in for a future duration such as "2 hours", or at for canonical world time { dayIndex, timeMinutes }.',
            parameters: {
                type: 'object',
                properties: {
                    event: {
                        type: 'string',
                        description: 'What is planned to happen later. Include enough concrete context for the later resolution prompt to decide if it still makes sense.'
                    },
                    region: {
                        type: 'string',
                        description: 'Region ID or exact region name where the event is planned.'
                    },
                    location: {
                        type: 'string',
                        description: 'Location ID or exact location name where the event is planned.'
                    },
                    in: {
                        oneOf: [
                            { type: 'string' },
                            { type: 'number' }
                        ],
                        description: 'Optional duration in the future, such as "2 hours", "45 minutes", or numeric minutes. Do not provide when at is provided.'
                    },
                    at: {
                        type: 'object',
                        properties: {
                            dayIndex: {
                                type: 'integer',
                                description: 'Absolute world day index, matching base context.'
                            },
                            timeMinutes: {
                                type: 'integer',
                                description: 'Minutes after midnight on dayIndex, matching base context.'
                            }
                        },
                        required: ['dayIndex', 'timeMinutes'],
                        additionalProperties: false,
                        description: 'Optional canonical absolute world time. Do not provide when in is provided.'
                    }
                },
                required: ['event', 'region', 'location'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'alterThing',
            description: 'Regenerate an existing thing after an open-ended transformation using the thing alteration prompt flow. Alters the whole resolved thing stack. For an exact update to an allowlisted field such as description, use updateObjectFields instead so unrelated fields remain unchanged.',
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
            name: 'recreateThing',
            description: 'Atomically regenerate an existing Thing in place. Use this when asked to recreate, rebuild, or comprehensively replace an item or scenery definition. The original stable id and placement are preserved; generation or validation failure leaves it unchanged. Do not follow this tool with createThing or deleteThing for the same target.',
            parameters: {
                type: 'object',
                properties: {
                    thing: {
                        type: 'string',
                        description: 'Exact Thing id or uniquely resolving name.'
                    },
                    instructions: {
                        type: 'string',
                        description: 'Complete description of how the replacement should be regenerated.'
                    }
                },
                required: ['thing', 'instructions'],
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
            description: `Directly update allowed persisted fields on an NPC without running the alter_npc event flow. Only use simple character fields from this allowlist: ${ADMIN_UPDATE_CHARACTER_FIELD_NAMES.join(', ')}. Do not use this for equipment, inventory, barter inventory, party membership, quests, location, dispositions, or other object-graph state.`,
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
            name: 'bulkUpdateCharacterFields',
            description: `Bulk-update allowed persisted fields on one or more NPCs from one strict XML document. Generic-prompt mutation tool only. The document must have one <characters> root, with one <character> per exact full NPC name and one or more <field><key>...</key><value>...</value></field> entries. Each value is parsed as JSON when valid JSON and otherwise used as text. All targets and fields are validated before mutation. Allowed fields: ${ADMIN_UPDATE_CHARACTER_FIELD_NAMES.join(', ')}.`,
            parameters: {
                type: 'object',
                properties: {
                    xml: {
                        type: 'string',
                        minLength: 1,
                        description: 'Strict XML document in the form <characters><character><name>Full NPC Name</name><field><key>fieldName</key><value>value</value></field></character></characters>. Escape XML-special characters in text values. Use JSON syntax inside <value> for numbers, booleans, null, arrays, or objects.'
                    }
                },
                required: ['xml'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'updateObjectFields',
            description: `Directly update allowed persisted fields on a specific object without running alter prompts. Prefer this tool when exact replacement values are known, and include only the fields that should change so all unrelated state is preserved. Identify by exact ID when possible; names and aliases are accepted where applicable, but ambiguous names return candidate JSON and must be retried by ID. Character updates are NPC-only. For locations, hasWeather accepts "yes", "no", "sheltered", or null; legacy "outside" is accepted as "sheltered". Allowed object types: ${UPDATE_OBJECT_TYPE_VALUES.join(', ')}.`,
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
            name: 'upsertFactionFields',
            description: `Create a new faction or directly update allowed persisted fields on an existing faction. Provide individual field/value pairs in fields. For create, fields.name is required and must not duplicate an existing faction name. For update, faction is required and resolves by id or name. Allowed fields: ${ADMIN_UPDATE_OBJECT_FIELD_NAMES_BY_TYPE.faction.join(', ')}.`,
            parameters: {
                type: 'object',
                properties: {
                    operation: {
                        type: 'string',
                        enum: UPSERT_FACTION_OPERATION_VALUES,
                        description: 'Use create for a new faction, or update for an existing faction.'
                    },
                    faction: {
                        type: 'string',
                        description: 'Required for update: faction ID or exact faction name. Omit for create.'
                    },
                    fields: {
                        type: 'object',
                        description: 'Object of allowed faction field names to new values, such as { "name": "...", "goals": ["..."], "relations": { "faction_1": { "status": "rival", "notes": "..." } } }.'
                    }
                },
                required: ['operation', 'fields'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'updatePartyMembers',
            description: 'Add and/or remove multiple NPCs from the current player party in one mutation. Added characters may be at any location and become off-location party members; removed characters stay at the current player location. Generic/scheduled mutation tool only.',
            parameters: {
                type: 'object',
                minProperties: 1,
                properties: {
                    add: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'NPC ids, exact names, or aliases to add to the party. Omit when only removing characters.'
                    },
                    remove: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'NPC ids, exact names, or aliases to remove from the party. Removed NPCs are placed at the current player location.'
                    }
                },
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

const cloneToolDefinition = (toolDefinition) => JSON.parse(JSON.stringify(toolDefinition));

const entityFieldSchema = (field) => {
    const type = typeof field?.type === 'string' && field.type.trim()
        ? field.type.trim()
        : 'string';
    const schema = field?.toolSchema && typeof field.toolSchema === 'object' && !Array.isArray(field.toolSchema)
        ? JSON.parse(JSON.stringify(field.toolSchema))
        : {
            type: type === 'integer' ? 'integer' : type
        };
    if (!schema.type) {
        schema.type = type === 'integer' ? 'integer' : type;
    }
    if (typeof field?.description === 'string' && field.description.trim()) {
        schema.description = field.description.trim();
    }
    if (schema.type === 'array' && !schema.items) {
        schema.items = {};
    }
    return schema;
};

const buildRegisteredThingFieldDescriptionContext = ({ getActiveSettingSnapshot } = {}) => ({
    setting: typeof getActiveSettingSnapshot === 'function'
        ? getActiveSettingSnapshot()
        : (global.currentSetting || null)
});

const getRegisteredEntityFields = (modExtensionRegistry, entityType, filter = {}, options = {}) => {
    if (!modExtensionRegistry || typeof modExtensionRegistry.getEntityFields !== 'function') {
        return [];
    }
    return modExtensionRegistry.getEntityFields(entityType, {
        ...filter,
        descriptionContext: buildRegisteredThingFieldDescriptionContext(options)
    });
};

const getRegisteredThingFields = (modExtensionRegistry, filter = {}, options = {}) => (
    getRegisteredEntityFields(modExtensionRegistry, 'thing', filter, options)
);

const getRegisteredPlayerFields = (modExtensionRegistry, filter = {}, options = {}) => (
    getRegisteredEntityFields(modExtensionRegistry, 'player', filter, options)
);

const applyRegisteredThingFieldsToToolDefinition = (toolDefinition, {
    modExtensionRegistry = null,
    getActiveSettingSnapshot = null
} = {}) => {
    const functionName = toolDefinition?.function?.name;
    if (functionName === 'createThing') {
        const createFields = getRegisteredThingFields(
            modExtensionRegistry,
            { exposeToCreateTool: true },
            { getActiveSettingSnapshot }
        );
        if (!createFields.length) {
            return toolDefinition;
        }
        const properties = toolDefinition.function.parameters.properties;
        for (const field of createFields) {
            properties[field.fieldName] = entityFieldSchema(field);
        }
        return toolDefinition;
    }

    if (functionName === 'createNpc') {
        const createFields = getRegisteredPlayerFields(
            modExtensionRegistry,
            { exposeToCreateTool: true },
            { getActiveSettingSnapshot }
        );
        if (!createFields.length) {
            return toolDefinition;
        }
        const properties = toolDefinition.function.parameters.properties;
        for (const field of createFields) {
            properties[field.fieldName] = entityFieldSchema(field);
        }
        return toolDefinition;
    }

    if (functionName === 'updateCharacterFields' || functionName === 'bulkUpdateCharacterFields') {
        const updateFields = getRegisteredPlayerFields(
            modExtensionRegistry,
            { exposeToUpdateTool: true },
            { getActiveSettingSnapshot }
        );
        if (updateFields.length) {
            const fieldNames = updateFields.map(field => field.fieldName).join(', ');
            toolDefinition.function.description = `${toolDefinition.function.description} Registered Player fields may also be updated when exposed by enabled mods: ${fieldNames}.`;
        }
        return toolDefinition;
    }

    if (functionName === 'updateObjectFields') {
        const updateFields = getRegisteredThingFields(
            modExtensionRegistry,
            { exposeToUpdateTool: true },
            { getActiveSettingSnapshot }
        );
        if (updateFields.length) {
            const fieldNames = updateFields.map(field => field.fieldName).join(', ');
            toolDefinition.function.description = `${toolDefinition.function.description} Registered Thing fields may also be updated when exposed by enabled mods: ${fieldNames}.`;
        }
        const playerUpdateFields = getRegisteredPlayerFields(
            modExtensionRegistry,
            { exposeToUpdateTool: true },
            { getActiveSettingSnapshot }
        );
        if (playerUpdateFields.length) {
            const fieldNames = playerUpdateFields.map(field => field.fieldName).join(', ');
            toolDefinition.function.description = `${toolDefinition.function.description} Registered Player fields may also be updated for character objects when exposed by enabled mods: ${fieldNames}.`;
        }
        return toolDefinition;
    }

    return toolDefinition;
};

const assertCanonicalThingToolSchemaCoverage = (toolDefinition, modExtensionRegistry = null) => {
    const functionName = toolDefinition?.function?.name;
    if (functionName === 'createThing') {
        const properties = toolDefinition.function.parameters?.properties || {};
        const preferredBoundaryName = new Map([
            ['thingType', 'itemOrScenery'],
            ['itemTypeDetail', 'type']
        ]);
        const expectedFields = [
            ...ThingFieldRegistry.BUILTIN_FIELDS.filter(field => field.exposeToCreateTool === true),
            ...getRegisteredThingFields(modExtensionRegistry, { exposeToCreateTool: true })
        ];
        for (const field of expectedFields) {
            const boundaryName = preferredBoundaryName.get(field.fieldName) || field.fieldName;
            if (!Object.prototype.hasOwnProperty.call(properties, boundaryName)) {
                throw new Error(
                    `createThing schema is missing canonical Thing field "${field.fieldName}" (boundary name "${boundaryName}").`
                );
            }
        }
    }
    if (functionName === 'updateObjectFields') {
        const canonicalNames = new Set(
            ThingFieldRegistry.BUILTIN_FIELDS
                .filter(field => field.exposeToUpdateTool === true)
                .map(field => field.fieldName)
        );
        for (const fieldName of ADMIN_UPDATE_OBJECT_FIELD_NAMES_BY_TYPE.thing) {
            if (!canonicalNames.has(fieldName)) {
                throw new Error(`updateObjectFields exposes noncanonical Thing field "${fieldName}".`);
            }
        }
    }
    return toolDefinition;
};

const applyConfiguredTrackerLimitsToToolDefinition = (toolDefinition) => {
    if (toolDefinition?.function?.name !== 'addTracker') {
        return toolDefinition;
    }

    const valueSchema = toolDefinition.function.parameters.properties.value;
    const description = `Initial value. For countdown use a concrete duration such as "29 days", "1 hour 30 minutes", or "00:45"; use x/total for x_out_of_total, a number with optional % for percentage, and at most ${Tracker.shortStringMaxWordsText()} words for short_string.`;
    valueSchema.description = description;
    const batchValueSchema = toolDefinition.function.parameters.properties.items?.items?.properties?.value;
    if (batchValueSchema) {
        batchValueSchema.description = description;
    }
    return toolDefinition;
};

const applyDirectShortDescriptionToolPolicy = (
    toolDefinition,
    { allowDirectShortDescriptionUpdates = false } = {}
) => {
    if (typeof allowDirectShortDescriptionUpdates !== 'boolean') {
        throw new TypeError('allowDirectShortDescriptionUpdates must be a boolean.');
    }
    if (allowDirectShortDescriptionUpdates) {
        if (toolDefinition?.function?.name === 'updateCharacterFields') {
            toolDefinition.function.description = `${toolDefinition.function.description} When updating fields on multiple NPCs, prefer one bulkUpdateCharacterFields call instead of repeated updateCharacterFields calls.`;
        }
        return toolDefinition;
    }
    const functionName = toolDefinition?.function?.name;
    if (functionName === 'updateCharacterFields') {
        toolDefinition.function.description = `Directly update allowed persisted fields on an NPC without running the alter_npc event flow. Only use simple character fields from this allowlist: ${UPDATE_CHARACTER_FIELD_NAMES.join(', ')}. Changing description automatically refreshes the NPC's concise summary. Do not use this for equipment, inventory, barter inventory, party membership, quests, location, dispositions, or other object-graph state.`;
    } else if (functionName === 'bulkUpdateCharacterFields') {
        toolDefinition.function.description = `Bulk-update allowed persisted fields on one or more NPCs from one strict XML document. Generic-prompt mutation tool only. The document must have one <characters> root, with one <character> per exact full NPC name and one or more <field><key>...</key><value>...</value></field> entries. Each value is parsed as JSON when valid JSON and otherwise used as text. All targets and fields are validated before mutation. Allowed fields: ${UPDATE_CHARACTER_FIELD_NAMES.join(', ')}. Changing description automatically refreshes the NPC's concise summary.`;
    } else if (functionName === 'updateObjectFields') {
        toolDefinition.function.description = `${toolDefinition.function.description} Changing an entity's description automatically refreshes its concise summary when that entity type has one.`;
    } else if (functionName === 'upsertFactionFields') {
        toolDefinition.function.description = `Create a new faction or directly update allowed persisted fields on an existing faction. Provide individual field/value pairs in fields. For create, fields.name is required and must not duplicate an existing faction name. For update, faction is required and resolves by id or name. Allowed fields: ${UPDATE_OBJECT_FIELD_NAMES_BY_TYPE.faction.join(', ')}. Changing description automatically refreshes the faction's concise summary.`;
    }
    return toolDefinition;
};

const getChatToolDefinitions = ({
    modExtensionRegistry = null,
    getActiveSettingSnapshot = null,
    allowDirectShortDescriptionUpdates = false
} = {}) => CHAT_TOOL_DEFINITIONS
    .map(toolDefinition => applyConfiguredTrackerLimitsToToolDefinition(
        assertCanonicalThingToolSchemaCoverage(
            applyRegisteredThingFieldsToToolDefinition(
                applyDirectShortDescriptionToolPolicy(
                    cloneToolDefinition(toolDefinition),
                    { allowDirectShortDescriptionUpdates }
                ),
                { modExtensionRegistry, getActiveSettingSnapshot }
            ),
            modExtensionRegistry
        )
    ));

const requireExplicitSkillCheckActors = (toolDefinitions = []) => {
    if (!Array.isArray(toolDefinitions)) {
        throw new TypeError('Explicit skill-check actor schemas require an array of tool definitions.');
    }
    return toolDefinitions.map(toolDefinition => {
        const toolName = typeof toolDefinition?.function?.name === 'string'
            ? toolDefinition.function.name.trim()
            : '';
        if (!SKILL_CHECK_TOOL_NAMES.has(toolName)) {
            return toolDefinition;
        }
        const clonedDefinition = cloneToolDefinition(toolDefinition);
        const parameters = clonedDefinition?.function?.parameters;
        if (!parameters?.properties?.actor) {
            throw new Error(`Skill-check tool "${toolName}" is missing its actor schema.`);
        }
        const required = Array.isArray(parameters.required) ? parameters.required.slice() : [];
        if (!required.includes('actor')) {
            required.unshift('actor');
        }
        parameters.required = required;
        parameters.properties.actor.description = 'Required exact acting character name or "player". Identify the character whose skill and attribute are being rolled; never omit this field.';
        return clonedDefinition;
    });
};

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

const randomBigIntBelow = (exclusiveUpperBound) => {
    if (typeof exclusiveUpperBound !== 'bigint' || exclusiveUpperBound <= 0n) {
        throw new Error('randomBigIntBelow requires a positive BigInt upper bound.');
    }

    const bitLength = exclusiveUpperBound.toString(2).length;
    const byteLength = Math.ceil(bitLength / 8);
    const sampleSpace = 1n << BigInt(byteLength * 8);
    const rejectionCutoff = sampleSpace - (sampleSpace % exclusiveUpperBound);

    for (let attempt = 0; attempt < 1024; attempt += 1) {
        const sample = BigInt(`0x${randomBytes(byteLength).toString('hex')}`);
        if (sample < rejectionCutoff) {
            return sample % exclusiveUpperBound;
        }
    }

    throw new Error('Unable to generate an unbiased random integer after 1024 attempts.');
};

const executeGenerateRandomIntegerTool = (args = {}) => {
    const min = args?.min;
    const max = args?.max;
    if (!Number.isSafeInteger(min)) {
        throw new ToolVisibleError('generateRandomInteger "min" must be a safe integer.', {
            code: 'invalid_arguments'
        });
    }
    if (!Number.isSafeInteger(max)) {
        throw new ToolVisibleError('generateRandomInteger "max" must be a safe integer.', {
            code: 'invalid_arguments'
        });
    }
    if (min > max) {
        throw new ToolVisibleError('generateRandomInteger requires min <= max.', {
            code: 'invalid_arguments'
        });
    }

    const minBigInt = BigInt(min);
    const range = BigInt(max) - minBigInt + 1n;
    const value = Number(minBigInt + randomBigIntBelow(range));
    const lines = [
        '<randomIntegerResult>',
        `  <min>${xmlEscapeText(min)}</min>`,
        `  <max>${xmlEscapeText(max)}</max>`,
        `  <value>${xmlEscapeText(value)}</value>`,
        '</randomIntegerResult>'
    ];

    return {
        content: lines.join('\n'),
        metadata: {
            status: 'success',
            min,
            max,
            value
        }
    };
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

const summarizeHistoryEntryStructuredContent = (entry) => {
    if (!entry || typeof entry !== 'object') {
        return '';
    }

    const summaryItems = Array.isArray(entry.summaryItems)
        ? entry.summaryItems
            .map(item => {
                if (!item || typeof item !== 'object') {
                    return '';
                }
                const icon = typeof item.icon === 'string' ? item.icon.trim() : '';
                const text = typeof item.text === 'string' ? item.text.trim() : '';
                return [icon, text].filter(Boolean).join(' ');
            })
            .filter(Boolean)
        : [];
    if (summaryItems.length) {
        return summaryItems.join('\n');
    }

    const checkResults = Array.isArray(entry.checkResults)
        ? entry.checkResults
            .map(record => {
                if (!record || typeof record !== 'object') {
                    return '';
                }
                const sequence = Number.isInteger(Number(record.sequence))
                    ? `${Number(record.sequence)}.`
                    : '';
                const summary = typeof record.summary === 'string' ? record.summary.trim() : '';
                const status = typeof record.status === 'string' ? `Status: ${record.status.trim()}` : '';
                return [sequence, summary, status].filter(Boolean).join(' ');
            })
            .filter(Boolean)
        : [];
    if (checkResults.length) {
        return checkResults.join('\n');
    }

    const toolCalls = Array.isArray(entry.toolCalls)
        ? entry.toolCalls
            .map(record => {
                if (!record || typeof record !== 'object') {
                    return '';
                }
                const sequence = Number.isInteger(Number(record.sequence))
                    ? `${Number(record.sequence)}.`
                    : '';
                const name = typeof record.name === 'string' ? record.name.trim() : '';
                const status = typeof record.status === 'string' ? `Status: ${record.status.trim()}` : '';
                return [sequence, name, status].filter(Boolean).join(' ');
            })
            .filter(Boolean)
        : [];
    if (toolCalls.length) {
        return toolCalls.join('\n');
    }

    const structuredFields = [
        entry.plausibility,
        entry.slopRemoval,
        entry.skillCheck,
        entry.resolution,
        entry.attackSummary,
        entry.attackCheck
    ];
    const structuredValues = structuredFields.flatMap(toSearchableValues);
    return structuredValues.join('\n').trim();
};

const getHistoryEntrySearchText = (entry, { includeAllEntryTypes = false } = {}) => {
    if (!entry || typeof entry !== 'object') {
        return '';
    }

    const content = typeof entry.content === 'string' ? entry.content : '';
    if (content.trim()) {
        return content;
    }

    if (!includeAllEntryTypes) {
        return '';
    }

    const summary = typeof entry.summary === 'string' ? entry.summary : '';
    if (summary.trim()) {
        return summary;
    }

    return summarizeHistoryEntryStructuredContent(entry);
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

const normalizeSceneSummaryDetailsForTool = (value) => {
    if (value === null || value === undefined) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw new ToolVisibleError(
            'editSceneSummary "details" must be an array of strings when provided.',
            { code: 'invalid_scene_summary_details' }
        );
    }
    return value.map((entry, index) => {
        if (typeof entry !== 'string') {
            throw new ToolVisibleError(
                `editSceneSummary details[${index}] must be a string.`,
                { code: 'invalid_scene_summary_details' }
            );
        }
        return entry.trim();
    }).filter(Boolean);
};

const normalizeSceneSummaryQuotesForTool = (value) => {
    if (value === null || value === undefined) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw new ToolVisibleError(
            'editSceneSummary "quotes" must be an array when provided.',
            { code: 'invalid_scene_summary_quotes' }
        );
    }
    return value.map((quote, index) => {
        if (!quote || typeof quote !== 'object' || Array.isArray(quote)) {
            throw new ToolVisibleError(
                `editSceneSummary quotes[${index}] must be an object.`,
                { code: 'invalid_scene_summary_quotes' }
            );
        }
        const character = typeof quote.character === 'string' ? quote.character.trim() : '';
        const text = typeof quote.text === 'string' ? quote.text.trim() : '';
        if (!character || !text) {
            throw new ToolVisibleError(
                `editSceneSummary quotes[${index}] requires non-empty character and text fields.`,
                { code: 'invalid_scene_summary_quotes' }
            );
        }
        return { character, text };
    });
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
    summarizeScenesForHistoryRange = null,
    persistSceneSummaries = null,
    isAssistantProseLikeEntry,
    serializeNpcForClient,
    buildLocationResponse,
    getCurrentPlayer,
    createLocationFromEvent,
    createRegionStubFromEvent,
    generateItemsByNames,
    generateNpcFromEvent = null,
    ensureExitConnection,
    findRegionByLocationId,
    alterThingByPrompt = null,
    alterNpcByEvent = null,
    alterLocationByEvent = null,
    resolveAttack = null,
    resolveAreaAttack = null,
    resolvePlausibilityCheck = null,
    resolveOpposedPlausibilityCheck = null,
    scheduleEvent = null,
    createQuestFromEvent = null,
    getCurrentWorldMinute = null,
    formatTrackerLastUpdated = null,
    formatTrackerCountdownValue = null,
    deleteThingById = null,
    LLMClient,
    Player,
    Thing,
    Location,
    Region,
    getGameLocations,
    getFactions,
    getRegionsMap,
    getPendingRegionStubs,
    clearLocationImageVariants = null,
    regenerateShortDescription = null,
    requestUserInput = null,
    getModExtensionRegistry = null
} = {}) => {
    ensureFunction(getConfig, 'getConfig');
    ensureFunction(getChatHistory, 'getChatHistory');
    if (summarizeScenesForHistoryRange !== null && summarizeScenesForHistoryRange !== undefined) {
        ensureFunction(summarizeScenesForHistoryRange, 'summarizeScenesForHistoryRange');
    }
    if (persistSceneSummaries !== null && persistSceneSummaries !== undefined) {
        ensureFunction(persistSceneSummaries, 'persistSceneSummaries');
    }
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
    if (clearLocationImageVariants !== null && clearLocationImageVariants !== undefined) {
        ensureFunction(clearLocationImageVariants, 'clearLocationImageVariants');
    }
    if (regenerateShortDescription !== null && regenerateShortDescription !== undefined) {
        ensureFunction(regenerateShortDescription, 'regenerateShortDescription');
    }
    if (getModExtensionRegistry !== null && getModExtensionRegistry !== undefined) {
        ensureFunction(getModExtensionRegistry, 'getModExtensionRegistry');
    }
    if (scheduleEvent !== null && scheduleEvent !== undefined) {
        ensureFunction(scheduleEvent, 'scheduleEvent');
    }
    if (createQuestFromEvent !== null && createQuestFromEvent !== undefined) {
        ensureFunction(createQuestFromEvent, 'createQuestFromEvent');
    }
    if (getCurrentWorldMinute !== null && getCurrentWorldMinute !== undefined) {
        ensureFunction(getCurrentWorldMinute, 'getCurrentWorldMinute');
    }
    if (formatTrackerLastUpdated !== null && formatTrackerLastUpdated !== undefined) {
        ensureFunction(formatTrackerLastUpdated, 'formatTrackerLastUpdated');
    }
    if (formatTrackerCountdownValue !== null && formatTrackerCountdownValue !== undefined) {
        ensureFunction(formatTrackerCountdownValue, 'formatTrackerCountdownValue');
    }
    if (deleteThingById !== null && deleteThingById !== undefined) {
        ensureFunction(deleteThingById, 'deleteThingById');
    }
    ensureModel(LLMClient, 'LLMClient');
    ensureModel(Player, 'Player');
    ensureModel(Thing, 'Thing');
    ensureModel(Location, 'Location');
    ensureModel(Region, 'Region');
    const thingFieldRegistry = new ThingFieldRegistry({ getModExtensionRegistry });
    const thingMutationService = new ThingMutationService({
        ThingClass: Thing,
        getModExtensionRegistry,
        fieldRegistry: thingFieldRegistry
    });

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

    const getRegistry = () => (typeof getModExtensionRegistry === 'function'
        ? getModExtensionRegistry()
        : null);

    const getRegisteredEntityFieldsForRuntime = (entityType, filter = {}) => {
        const registry = getRegistry();
        if (!registry || typeof registry.getEntityFields !== 'function') {
            return [];
        }
        return registry.getEntityFields(entityType, filter);
    };

    const normalizeRegisteredEntityFieldValue = (rawValue, field, { functionName } = {}) => {
        if (rawValue === null || rawValue === undefined || rawValue === '') {
            return null;
        }
        switch (field.type) {
            case 'string':
                return normalizeOptionalString(rawValue);
            case 'number':
                return normalizeOptionalNumber(rawValue, { functionName, fieldName: field.fieldName });
            case 'integer':
                return normalizeOptionalInteger(rawValue, { functionName, fieldName: field.fieldName });
            case 'boolean':
                return normalizeOptionalBoolean(rawValue, { functionName, fieldName: field.fieldName });
            case 'array':
                if (!Array.isArray(rawValue)) {
                    throw new ToolVisibleError(
                        `${functionName} "${field.fieldName}" must be an array when provided.`,
                        { code: 'invalid_arguments' }
                    );
                }
                return rawValue;
            case 'object':
                if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
                    throw new ToolVisibleError(
                        `${functionName} "${field.fieldName}" must be an object when provided.`,
                        { code: 'invalid_arguments' }
                    );
                }
                return rawValue;
            default:
                throw new ToolVisibleError(
                    `${functionName} registered field "${field.fieldName}" has unsupported type "${field.type}".`,
                    { code: 'invalid_arguments' }
                );
        }
    };

    const hasMeaningfulRegisteredEntityFieldValue = (value) => {
        if (value === undefined || value === null) {
            return false;
        }
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            return Boolean(normalized && normalized !== 'n/a' && normalized !== 'none');
        }
        if (Array.isArray(value)) {
            return value.length > 0;
        }
        if (typeof value === 'object') {
            return Object.keys(value).length > 0;
        }
        return true;
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

    const getCacheKeyForToolCall = (functionName, args, roundKey, toolCallId = null) => {
        if (!args || typeof args !== 'object') {
            return null;
        }
        if (MUTATING_CHAT_TOOL_NAMES.has(functionName)) {
            const normalizedToolCallId = normalizeCacheKeyPart(toolCallId);
            if (!normalizedToolCallId) {
                throw new Error(`Mutating tool "${functionName}" requires a stable tool-call id for idempotency.`);
            }
            return stableCacheKey({
                type: 'mutation',
                round: roundKey,
                tool: functionName,
                toolCallId: normalizedToolCallId
            });
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

    const describePartyMemberCandidate = (character) => ({
        ...describeCharacterCandidate(character),
        isNPC: isNpcEntity(character),
        isInPlayerParty: Boolean(character?.isInPlayerParty)
    });

    const resolvePartyMemberReference = (rawQuery, { fieldName = 'character' } = {}) => {
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
        const exactMatches = allCharacters.filter(character => {
            if (toTrimmedString(character?.name).toLowerCase() === lowerQuery) {
                return true;
            }
            return npcAliasesForMatching(character).some(alias => alias.toLowerCase() === lowerQuery);
        });
        const includesMatches = allCharacters.filter(character => {
            if (toTrimmedString(character?.name).toLowerCase().includes(lowerQuery)) {
                return true;
            }
            return npcAliasesForMatching(character).some(alias => alias.toLowerCase().includes(lowerQuery));
        });
        const matches = exactMatches.length ? exactMatches : includesMatches;

        if (!matches.length) {
            throw new ToolVisibleError(
                `No ${fieldName} matches "${query}".`,
                { code: 'character_not_found' }
            );
        }

        if (matches.length > 1) {
            throw new ToolVisibleError(
                `Multiple ${fieldName} matches found for "${query}". Call updatePartyMembers again with the exact id from one candidate.`,
                {
                    code: 'ambiguous_character',
                    candidates: matches
                        .map(describePartyMemberCandidate)
                        .sort(candidateSort)
                }
            );
        }

        return matches[0];
    };

    const normalizePartyMemberReferenceList = (value, { functionName, fieldName } = {}) => {
        if (value === undefined) {
            return [];
        }
        if (!Array.isArray(value)) {
            throw new ToolVisibleError(
                `${functionName} "${fieldName}" must be an array of character ids, names, or aliases when provided.`,
                { code: 'invalid_arguments' }
            );
        }
        return value.map((entry, index) => normalizeRequiredString(entry, {
            functionName,
            fieldName: `${fieldName}[${index}]`
        }));
    };

    const getCurrentPartyMemberIdSet = (currentPlayer, { functionName } = {}) => {
        if (!currentPlayer || typeof currentPlayer.getPartyMembers !== 'function') {
            throw new ToolVisibleError(
                `${functionName} requires the current player to support getPartyMembers().`,
                { code: 'tool_unavailable' }
            );
        }
        const rawMembers = currentPlayer.getPartyMembers();
        const membersArray = Array.isArray(rawMembers)
            ? rawMembers
            : (rawMembers instanceof Set ? Array.from(rawMembers) : null);
        if (!membersArray) {
            throw new ToolVisibleError(
                `${functionName} getPartyMembers() must return an array or Set.`,
                { code: 'invalid_party_state' }
            );
        }
        return new Set(membersArray
            .map(member => (typeof member === 'string' ? member : toTrimmedString(member?.id)))
            .map(memberId => toTrimmedString(memberId))
            .filter(Boolean));
    };

    const getCurrentPlayerLocationForPartyTool = (currentPlayer, { functionName } = {}) => {
        let location = currentPlayer?.currentLocationObject || null;
        if (!location) {
            const locationId = toTrimmedString(currentPlayer?.currentLocation)
                || toTrimmedString(currentPlayer?.locationId)
                || toTrimmedString(typeof currentPlayer?.location === 'string'
                    ? currentPlayer.location
                    : currentPlayer?.location?.id);
            location = getLocationByIdLoose(locationId);
        }
        if (!location) {
            throw new ToolVisibleError(
                `${functionName} cannot remove party members because the current player location is unknown.`,
                { code: 'missing_current_location' }
            );
        }
        if (typeof location.addNpcId !== 'function') {
            throw new ToolVisibleError(
                `${functionName} cannot remove party members because current location "${location.name || location.id}" cannot register NPC ids.`,
                { code: 'invalid_location_state' }
            );
        }
        return location;
    };

    const resolvePartyMemberTargets = (queries, { functionName, fieldName } = {}) => {
        return queries.map((query) => {
            const character = resolvePartyMemberReference(query, { fieldName });
            const id = toTrimmedString(character?.id);
            if (!id) {
                throw new ToolVisibleError(
                    `${functionName} resolved "${query}" to a character without an id.`,
                    { code: 'invalid_party_target' }
                );
            }
            if (!isNpcEntity(character)) {
                throw new ToolVisibleError(
                    `${functionName} can only change NPC party membership; "${character?.name || query}" is not an NPC.`,
                    {
                        code: 'invalid_party_target',
                        candidates: [describePartyMemberCandidate(character)]
                    }
                );
            }
            return {
                query,
                id,
                character,
                beforeLocation: describeLocationSummary(character.currentLocation || character.locationId || null)
            };
        });
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

    const summarizeLocationForTravelTool = (location) => ({
        locationId: toTrimmedString(location?.id) || null,
        locationName: toTrimmedString(location?.name) || null,
        regionId: locationRegionId(location),
        regionName: locationRegionName(location)
    });

    const executeGetTravelTimeTool = ({
        region,
        location,
        fromRegion = null,
        fromLocation = null
    } = {}) => {
        const functionName = 'getTravelTime';
        const destinationRegionQuery = normalizeRequiredString(region, { functionName, fieldName: 'region' });
        const destinationLocationQuery = normalizeRequiredString(location, { functionName, fieldName: 'location' });
        const originRegionQuery = normalizeOptionalString(fromRegion);
        const originLocationQuery = normalizeOptionalString(fromLocation);

        if (originRegionQuery && !originLocationQuery) {
            throw new ToolVisibleError(
                'getTravelTime "fromRegion" requires "fromLocation"; omit both to use the current player location.',
                { code: 'invalid_arguments' }
            );
        }

        const destinationLocation = resolveLocationReference(destinationLocationQuery, {
            fieldName: 'location',
            regionQuery: destinationRegionQuery
        });

        let originLocation = null;
        if (originLocationQuery) {
            originLocation = resolveLocationReference(originLocationQuery, {
                fieldName: 'fromLocation',
                regionQuery: originRegionQuery
            });
        } else {
            const currentPlayer = getCurrentPlayer();
            const currentLocationId = toTrimmedString(currentPlayer?.currentLocation || currentPlayer?.locationId);
            if (!currentLocationId) {
                throw new ToolVisibleError(
                    'getTravelTime could not use the current player location because the current player has no location.',
                    { code: 'current_location_unavailable' }
                );
            }
            originLocation = getLocationByIdLoose(currentLocationId);
            if (!originLocation) {
                throw new ToolVisibleError(
                    `getTravelTime could not resolve current player location "${currentLocationId}".`,
                    { code: 'current_location_unavailable' }
                );
            }
        }

        if (!Location || typeof Location.findShortestTravelRoute !== 'function') {
            throw new Error('getTravelTime requires Location.findShortestTravelRoute.');
        }

        const routeResult = Location.findShortestTravelRoute(originLocation, destinationLocation);
        const originSummary = summarizeLocationForTravelTool(originLocation);
        const destinationSummary = summarizeLocationForTravelTool(destinationLocation);
        const reachable = Boolean(routeResult);
        const routeSteps = reachable && Array.isArray(routeResult.steps)
            ? routeResult.steps
            : [];
        const travelTimeMinutes = reachable
            ? routeResult.travelTimeMinutes
            : null;

        const lines = [
            '<getTravelTimeResult>',
            ...renderXmlNode('origin', originSummary, 1),
            ...renderXmlNode('destination', destinationSummary, 1),
            `  <reachable>${reachable ? 'true' : 'false'}</reachable>`,
            ...renderXmlNode('travelTimeMinutes', travelTimeMinutes, 1),
            `  <route count="${routeSteps.length}">`
        ];
        routeSteps.forEach((step, index) => {
            lines.push(...renderXmlNode('step', step, 2, { index: index + 1 }));
        });
        lines.push('  </route>');
        lines.push('</getTravelTimeResult>');

        return {
            content: lines.join('\n'),
            metadata: {
                origin: originSummary,
                destination: destinationSummary,
                reachable,
                travelTimeMinutes,
                route: routeSteps
            }
        };
    };

    const executeSetEntityHiddenFromPlayerTool = ({
        name,
        description = '',
        hiddenFromPlayer,
        functionName
    } = {}) => {
        const entityName = normalizeRequiredString(name, { functionName, fieldName: 'name' });
        const targetCharacter = resolveCharacterReference(entityName, { fieldName: 'name' });
        const effectiveHiddenFromPlayer = Boolean(hiddenFromPlayer) && !Boolean(targetCharacter.isDead);
        targetCharacter.hiddenFromPlayer = effectiveHiddenFromPlayer;

        const lines = [
            `<${functionName}Result>`,
            ...renderXmlNode('entity', {
                id: targetCharacter.id || null,
                name: targetCharacter.name || null,
                isNPC: Boolean(targetCharacter.isNPC),
                hidden: Boolean(effectiveHiddenFromPlayer),
                description: normalizeOptionalString(description)
            }, 1),
            `</${functionName}Result>`
        ];

        return {
            content: lines.join('\n'),
            metadata: {
                entityId: targetCharacter.id || null,
                entityName: targetCharacter.name || null,
                hiddenFromPlayer: Boolean(effectiveHiddenFromPlayer),
                locationRefreshRequested: true
            }
        };
    };

    const executeRevealEntityTool = (args = {}) => executeSetEntityHiddenFromPlayerTool({
        ...args,
        hiddenFromPlayer: false,
        functionName: 'revealEntity'
    });

    const executeHideEntityTool = (args = {}) => executeSetEntityHiddenFromPlayerTool({
        ...args,
        hiddenFromPlayer: true,
        functionName: 'hideEntity'
    });

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
        count = null,
        isVehicle = null,
        isCraftingStation = null,
        isProcessingStation = null,
        isHarvestable = null,
        isSalvageable = null,
        isContainer = null,
        requiresCheckToOpen = null,
        containerContents = null,
        attributeBonuses = null,
        causeStatusEffectOnTarget = null,
        causeStatusEffectOnEquipper = null,
        properties = null,
        ...extensionFieldInputs
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
            const normalizeModifierEntries = (entries, collectionName, valueFieldName) => {
                if (entries === null || entries === undefined) {
                    return null;
                }
                if (!Array.isArray(entries)) {
                    throw new ToolVisibleError(
                        `createThing "${fieldName}.${collectionName}" must be an array when provided.`,
                        { code: 'invalid_arguments' }
                    );
                }
                return entries.map((entry, index) => {
                    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                        throw new ToolVisibleError(
                            `createThing "${fieldName}.${collectionName}[${index}]" must be an object.`,
                            { code: 'invalid_arguments' }
                        );
                    }
                    const entryName = normalizeRequiredString(entry.name, {
                        functionName,
                        fieldName: `${fieldName}.${collectionName}[${index}].name`
                    });
                    const numericValue = normalizeOptionalNumber(entry[valueFieldName], {
                        functionName,
                        fieldName: `${fieldName}.${collectionName}[${index}].${valueFieldName}`
                    });
                    if (numericValue === null) {
                        throw new ToolVisibleError(
                            `createThing "${fieldName}.${collectionName}[${index}].${valueFieldName}" is required.`,
                            { code: 'invalid_arguments' }
                        );
                    }
                    return { name: entryName, [valueFieldName]: numericValue };
                });
            };
            const attributes = normalizeModifierEntries(rawValue.attributes, 'attributes', 'modifier');
            const skills = normalizeModifierEntries(rawValue.skills, 'skills', 'modifier');
            const needBars = normalizeModifierEntries(rawValue.needBars, 'needBars', 'delta');
            if (
                !effectName
                && !effectDescription
                && !effectDuration
                && attributes === null
                && skills === null
                && needBars === null
            ) {
                return null;
            }
            const normalizedEffect = {
                name: effectName || '',
                description: effectDescription || '',
                duration: effectDuration || ''
            };
            if (attributes !== null) normalizedEffect.attributes = attributes;
            if (skills !== null) normalizedEffect.skills = skills;
            if (needBars !== null) normalizedEffect.needBars = needBars;
            return normalizedEffect;
        };

        const seed = {
            shortDescription: shortDescriptionValue,
            itemOrScenery: itemOrSceneryValue
        };

        const registeredCreateFields = getRegisteredEntityFieldsForRuntime('thing', { exposeToCreateTool: true });
        const registeredCreateFieldMap = new Map(registeredCreateFields.map(field => [field.fieldName, field]));
        const unknownExtensionFieldNames = Object.keys(extensionFieldInputs).filter(fieldName => !registeredCreateFieldMap.has(fieldName));
        if (unknownExtensionFieldNames.length) {
            throw new ToolVisibleError(
                `createThing cannot use unsupported field "${unknownExtensionFieldNames[0]}".`,
                { code: 'unsupported_field', details: { fieldName: unknownExtensionFieldNames[0] } }
            );
        }
        const extensionFieldValues = {};
        for (const field of registeredCreateFields) {
            if (!Object.prototype.hasOwnProperty.call(extensionFieldInputs, field.fieldName)) {
                continue;
            }
            const value = normalizeRegisteredEntityFieldValue(extensionFieldInputs[field.fieldName], field, { functionName });
            if (value !== null) {
                seed[field.fieldName] = value;
                extensionFieldValues[field.fieldName] = value;
            }
        }

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
        if (registeredCreateFields.some(field => (
            field.clearThingSlotWhenPresent === true
            && hasMeaningfulRegisteredEntityFieldValue(extensionFieldValues[field.fieldName])
        ))) {
            seed.slot = null;
        }
        const rarityValue = normalizeOptionalString(rarity);
        if (rarityValue) seed.rarity = rarityValue;

        const valueNumber = normalizeOptionalNumber(value, { functionName, fieldName: 'value' });
        if (valueNumber !== null) seed.value = valueNumber;
        const weightNumber = normalizeOptionalNumber(weight, { functionName, fieldName: 'weight' });
        if (weightNumber !== null) seed.weight = weightNumber;
        const relativeLevelInteger = normalizeOptionalInteger(relativeLevel, { functionName, fieldName: 'relativeLevel' });
        if (relativeLevelInteger !== null) seed.relativeLevel = relativeLevelInteger;
        const countInteger = normalizeOptionalInteger(count, { functionName, fieldName: 'count' });
        if (countInteger !== null) {
            if (countInteger < 0) {
                throw new ToolVisibleError(
                    'createThing "count" must be zero or greater when provided.',
                    { code: 'invalid_arguments' }
                );
            }
            seed.count = countInteger;
        }

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
        const requiresCheckToOpenValue = normalizeOptionalBoolean(requiresCheckToOpen, { functionName, fieldName: 'requiresCheckToOpen' });
        if (requiresCheckToOpenValue !== null) seed.requiresCheckToOpen = requiresCheckToOpenValue;

        if (containerContents !== null && containerContents !== undefined) {
            if (!Array.isArray(containerContents)) {
                throw new ToolVisibleError(
                    'createThing "containerContents" must be an array when provided.',
                    { code: 'invalid_arguments' }
                );
            }
            seed.containerContents = containerContents.map((entry, index) => {
                if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                    throw new ToolVisibleError(
                        `createThing "containerContents[${index}]" must be an object.`,
                        { code: 'invalid_arguments' }
                    );
                }
                const contentName = normalizeRequiredString(entry.name, {
                    functionName,
                    fieldName: `containerContents[${index}].name`
                });
                const contentCount = normalizeOptionalInteger(entry.count, {
                    functionName,
                    fieldName: `containerContents[${index}].count`
                });
                if (contentCount === null || contentCount < 0) {
                    throw new ToolVisibleError(
                        `createThing "containerContents[${index}].count" must be an integer zero or greater.`,
                        { code: 'invalid_arguments' }
                    );
                }
                return { name: contentName, count: contentCount };
            });
        }

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
                locationId: targetLocation.id || null,
                mutationReceipt: {
                    operation: 'create',
                    thingId: createdThing?.id || null,
                    beforeChecksum: null,
                    afterChecksum: createdThing?.checksum || null,
                    changedFields: typeof createdThing?.toJSON === 'function'
                        ? Object.keys(createdThing.toJSON())
                        : [],
                    placementBefore: null,
                    placementAfter: targetLocation?.id
                        ? { locationId: targetLocation.id }
                        : null,
                    createdIds: createdThing?.id ? [createdThing.id] : [],
                    replacedIds: [],
                    deletedIds: [],
                    committedAt: new Date().toISOString(),
                    committed: true
                }
            }
        };
    };

    const executeCreateNpcTool = async ({
        location = null,
        region = null,
        name = null,
        description = null,
        shortDescription = null,
        role = null,
        class: className = null,
        race = null,
        level = null,
        relativeLevel = null,
        currency = null,
        isHostile = null,
        hiddenFromPlayer = null,
        aiNotes = null,
        notes = null,
        ...registeredPlayerFieldInputs
    } = {}) => {
        const functionName = 'createNpc';
        if (typeof generateNpcFromEvent !== 'function') {
            throw new ToolVisibleError(
                'createNpc is unavailable because the NPC generation helper was not configured.',
                { code: 'tool_unavailable' }
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
                    'createNpc requires "location" when no current player location is available.',
                    { code: 'missing_location' }
                );
            }
            targetLocation = getLocationByIdLoose(currentPlayer.currentLocation);
            if (!targetLocation) {
                throw new ToolVisibleError(
                    `createNpc could not find current player location "${currentPlayer.currentLocation}".`,
                    { code: 'missing_location' }
                );
            }
            if (regionQuery) {
                const regionFilter = resolveRegionReference(regionQuery, {
                    fieldName: 'region',
                    allowPending: true,
                    allowMissing: false
                });
                const targetRegionId = locationRegionId(targetLocation);
                if (regionFilter?.id && targetRegionId !== regionFilter.id) {
                    throw new ToolVisibleError(
                        `Current location "${targetLocation.name || targetLocation.id}" is not in region "${regionFilter.name}".`,
                        { code: 'location_region_mismatch' }
                    );
                }
            }
        }

        const seed = {};
        const requestedName = normalizeOptionalString(name);
        if (requestedName) seed.name = requestedName;
        const descriptionValue = normalizeOptionalString(description);
        if (descriptionValue) seed.description = descriptionValue;
        const shortDescriptionValue = normalizeOptionalString(shortDescription);
        if (shortDescriptionValue) seed.shortDescription = shortDescriptionValue;
        const roleValue = normalizeOptionalString(role);
        if (roleValue) seed.role = roleValue;
        const classValue = normalizeOptionalString(className);
        if (classValue) seed.class = classValue;
        const raceValue = normalizeOptionalString(race);
        if (raceValue) seed.race = raceValue;
        const aiNotesValue = normalizeOptionalString(aiNotes);
        if (aiNotesValue) seed.aiNotes = aiNotesValue;

        const registeredCreateFields = getRegisteredEntityFieldsForRuntime('player', { exposeToCreateTool: true });
        const registeredCreateFieldMap = new Map(registeredCreateFields.map(field => [field.fieldName, field]));
        const unknownPlayerFieldNames = Object.keys(registeredPlayerFieldInputs || {})
            .filter(fieldName => !registeredCreateFieldMap.has(fieldName));
        if (unknownPlayerFieldNames.length) {
            throw new ToolVisibleError(
                `createNpc cannot use unsupported field "${unknownPlayerFieldNames[0]}".`,
                { code: 'unsupported_field', details: { fieldName: unknownPlayerFieldNames[0] } }
            );
        }
        for (const field of registeredCreateFields) {
            if (!Object.prototype.hasOwnProperty.call(registeredPlayerFieldInputs, field.fieldName)) {
                continue;
            }
            const value = normalizeRegisteredEntityFieldValue(registeredPlayerFieldInputs[field.fieldName], field, { functionName });
            if (value !== null) {
                seed[field.fieldName] = value;
            }
        }

        const levelInteger = normalizeOptionalInteger(level, { functionName, fieldName: 'level' });
        const relativeLevelInteger = normalizeOptionalInteger(relativeLevel, { functionName, fieldName: 'relativeLevel' });
        if (levelInteger !== null && relativeLevelInteger !== null) {
            throw new ToolVisibleError(
                'createNpc accepts either "level" or "relativeLevel", not both.',
                { code: 'invalid_arguments' }
            );
        }
        if (relativeLevelInteger !== null) {
            seed.relativeLevel = relativeLevelInteger;
        } else if (levelInteger !== null) {
            const targetRegion = findRegionByLocationId(targetLocation.id) || null;
            const currentPlayer = getCurrentPlayer();
            const locationBaseLevel = Number.isFinite(Number(targetLocation.baseLevel))
                ? Number(targetLocation.baseLevel)
                : (Number.isFinite(Number(targetRegion?.averageLevel))
                    ? Number(targetRegion.averageLevel)
                    : (Number.isFinite(Number(currentPlayer?.level)) ? Number(currentPlayer.level) : 1));
            seed.relativeLevel = levelInteger - locationBaseLevel;
        }

        const currencyInteger = normalizeOptionalInteger(currency, { functionName, fieldName: 'currency' });
        if (currencyInteger !== null) seed.currency = currencyInteger;
        const isHostileValue = normalizeOptionalBoolean(isHostile, { functionName, fieldName: 'isHostile' });
        if (isHostileValue !== null) seed.isHostile = isHostileValue;
        const hiddenFromPlayerValue = normalizeOptionalBoolean(hiddenFromPlayer, { functionName, fieldName: 'hiddenFromPlayer' });
        if (hiddenFromPlayerValue !== null) seed.hiddenFromPlayer = hiddenFromPlayerValue;
        const notesValue = normalizeOptionalString(notes);

        if (!Object.keys(seed).length && !notesValue) {
            throw new ToolVisibleError(
                'createNpc requires at least one NPC seed field or notes.',
                { code: 'invalid_arguments' }
            );
        }

        const targetRegion = findRegionByLocationId(targetLocation.id) || null;
        const generatedNpc = await generateNpcFromEvent({
            name: requestedName || '',
            npc: seed,
            location: targetLocation,
            region: targetRegion,
            additionalInstructions: notesValue || ''
        });

        if (!generatedNpc) {
            throw new ToolVisibleError(
                'NPC generation did not return a created NPC.',
                { code: 'npc_generation_failed' }
            );
        }

        const finalName = normalizeOptionalString(generatedNpc?.name);
        if (!finalName) {
            throw new ToolVisibleError(
                'NPC generation completed but final name is missing.',
                { code: 'npc_generation_failed' }
            );
        }

        const lines = [
            '<createNpcResult>',
            '  <status>success</status>',
            ...renderXmlNode('npc', {
                id: generatedNpc?.id || null,
                requestedName: requestedName || null,
                finalName,
                locationId: targetLocation.id || null,
                locationName: targetLocation.name || null,
                regionId: locationRegionId(targetLocation),
                regionName: locationRegionName(targetLocation)
            }, 1),
            '</createNpcResult>'
        ];

        return {
            content: lines.join('\n'),
            metadata: {
                status: 'success',
                npcId: generatedNpc?.id || null,
                requestedName: requestedName || null,
                finalName,
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

    const executeRecreateThingTool = async ({ thing, instructions } = {}) => {
        const functionName = 'recreateThing';
        const thingQuery = normalizeRequiredString(thing, { functionName, fieldName: 'thing' });
        const replacementInstructions = normalizeRequiredString(instructions, {
            functionName,
            fieldName: 'instructions'
        });
        if (typeof alterThingByPrompt !== 'function') {
            throw new ToolVisibleError(
                'recreateThing is unavailable because the Thing regeneration helper was not configured.',
                { code: 'missing_dependency' }
            );
        }
        const targetThing = resolveThingReference(thingQuery, { fieldName: 'thing' });
        const originalId = normalizeOptionalString(targetThing?.id);
        const originalName = normalizeOptionalString(targetThing?.name);
        const outcome = await alterThingByPrompt({
            thing: targetThing,
            changeDescription: replacementInstructions,
            newName: null
        });
        const recreatedThing = outcome?.thing || targetThing;
        if (!recreatedThing || normalizeOptionalString(recreatedThing.id) !== originalId) {
            throw new ToolVisibleError(
                'recreateThing did not preserve the target Thing id.',
                { code: 'replacement_identity_changed' }
            );
        }
        const finalName = normalizeOptionalString(recreatedThing.name) || originalName;
        const lines = [
            '<recreateThingResult>',
            '  <status>success</status>',
            ...renderXmlNode('thing', {
                id: originalId,
                originalName,
                finalName,
                thingType: normalizeOptionalString(recreatedThing.thingType)
            }, 1),
            ...renderXmlNode('instructions', replacementInstructions, 1),
            '</recreateThingResult>'
        ];
        return {
            content: lines.join('\n'),
            metadata: {
                status: 'success',
                thingId: originalId,
                originalName,
                finalName,
                preservedIdentity: true,
                mutationReceipt: outcome?.mutationReceipt || null
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

    const makeUpdateCharacterFieldOperations = (targetNpc, fieldsObject, {
        functionName,
        allowDirectShortDescriptionUpdates = false
    } = {}) => {
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

        const registeredPlayerUpdateFields = getRegisteredEntityFieldsForRuntime('player', { exposeToUpdateTool: true });
        const registeredPlayerUpdateFieldMap = new Map(registeredPlayerUpdateFields.map(field => [field.fieldName, field]));
        const allowedFields = [
            ...(allowDirectShortDescriptionUpdates
                ? ADMIN_UPDATE_CHARACTER_FIELD_NAMES
                : UPDATE_CHARACTER_FIELD_NAMES),
            ...registeredPlayerUpdateFields.map(field => field.fieldName)
        ];
        const allowedFieldSet = new Set(allowedFields);
        for (const [fieldName] of fieldEntries) {
            if (!allowedFieldSet.has(fieldName)) {
                throw new ToolVisibleError(
                    `${functionName} cannot update field "${fieldName}". Allowed fields: ${allowedFields.join(', ')}.`,
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
            const registeredField = registeredPlayerUpdateFieldMap.get(fieldName) || null;
            if (registeredField) {
                const value = normalizeRegisteredEntityFieldValue(rawValue, registeredField, { functionName });
                addOperation(fieldName, () => {
                    if (targetNpc && typeof targetNpc.setExtensionField === 'function') {
                        targetNpc.setExtensionField(fieldName, value);
                    } else if (targetNpc && typeof targetNpc === 'object') {
                        targetNpc[fieldName] = value;
                    } else {
                        throw new Error(`Target does not support registered field "${fieldName}".`);
                    }
                });
                continue;
            }
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
                case 'personality': {
                    const personalityMap = normalizeCharacterFieldMap(rawValue, { functionName, fieldName });
                    const personalityEntries = Object.entries(personalityMap);
                    if (!personalityEntries.length) {
                        throw new ToolVisibleError(
                            `${functionName} "personality" must include at least one of: ${Object.keys(UPDATE_CHARACTER_PERSONALITY_FIELD_MAP).join(', ')}.`,
                            { code: 'invalid_arguments' }
                        );
                    }
                    for (const [rawPersonalityFieldName, rawPersonalityValue] of personalityEntries) {
                        const personalityFieldName = normalizeCharacterFieldString(rawPersonalityFieldName, {
                            functionName,
                            fieldName: 'personality key',
                            requireNonEmpty: true
                        });
                        const targetFieldName = UPDATE_CHARACTER_PERSONALITY_FIELD_MAP[personalityFieldName];
                        if (!targetFieldName) {
                            throw new ToolVisibleError(
                                `${functionName} cannot update personality subfield "${personalityFieldName}". Allowed subfields: ${Object.keys(UPDATE_CHARACTER_PERSONALITY_FIELD_MAP).join(', ')}.`,
                                {
                                    code: 'unsupported_field',
                                    details: { fieldName: `personality.${personalityFieldName}` }
                                }
                            );
                        }
                        const value = normalizeCharacterFieldString(rawPersonalityValue, {
                            functionName,
                            fieldName: `personality.${personalityFieldName}`
                        });
                        addOperation(`personality.${personalityFieldName}`, () => {
                            targetNpc[targetFieldName] = value;
                        });
                    }
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
                case 'relationships': {
                    const value = normalizeCharacterFieldMap(rawValue, { functionName, fieldName });
                    if (typeof targetNpc.setRelationships !== 'function') {
                        throw new ToolVisibleError(`${functionName} cannot update "relationships" on this NPC.`, { code: 'unsupported_field' });
                    }
                    addOperation(fieldName, () => targetNpc.setRelationships(value));
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
                `Multiple ${objectType} matches found for "${query}". Call ${functionName || 'the tool'} again with the exact id from one candidate.`,
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
            'vehicleType',
            'properties'
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
            'weight',
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
            'requiresCheckToOpen',
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
            'containerContents',
            'statusEffects',
            'randomEvents',
            'characterConcepts',
            'enemyConcepts',
            'secrets',
            'tags',
            'goals',
            'rewardItems',
            'rewardNpcDispositions',
            'rewardBenefits',
            'rewardNotes',
            'attributes',
            'skills',
            'needBars'
        ]);
        const objectFields = new Set([
            'needBarApplicability',
            'relationships',
            'generationHints',
            'weatherState',
            'relations',
            'assets',
            'reputationTiers',
            'rewardFactionReputation',
            'causeStatusEffectOnTarget',
            'causeStatusEffectOnEquipper'
        ]);

        if (objectType === 'location' && fieldName === 'hasWeather') {
            try {
                return normalizeWeatherExposure(rawValue, `${functionName} location hasWeather`);
            } catch (error) {
                throw new ToolVisibleError(
                    error?.message || `${functionName} location hasWeather is invalid.`,
                    { code: 'invalid_arguments' }
                );
            }
        }

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
            if (objectType === 'quest' && fieldName === 'rewardBenefits') {
                const currentPlayer = getCurrentPlayer();
                return questRewardBenefitRegistry.validateAll(rawValue, {
                    player: currentPlayer,
                    findActorById: id => getAllCharacters().find(actor => toTrimmedString(actor?.id) === id) || null
                });
            }
            if (objectType === 'quest' && fieldName === 'rewardNotes') {
                return Quest.normalizeRewardNotes(rawValue);
            }
            if (objectType === 'quest' && fieldName === 'rewardItems') {
                return Quest.normalizeRewardItems(rawValue);
            }
            return rawValue;
        }
        if (objectFields.has(fieldName)) {
            if (rawValue === null && ['causeStatusEffectOnTarget', 'causeStatusEffectOnEquipper'].includes(fieldName)) {
                return null;
            }
            return normalizeCharacterFieldMap(rawValue, { functionName, fieldName });
        }
        return rawValue;
    };

    const makeUpdateObjectFieldOperations = (target, fieldsObject, {
        functionName,
        objectType,
        allowDirectShortDescriptionUpdates = false
    } = {}) => {
        if (objectType === 'character') {
            return makeUpdateCharacterFieldOperations(target.record, fieldsObject, {
                functionName,
                allowDirectShortDescriptionUpdates
            });
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

        const registeredThingUpdateFields = objectType === 'thing'
            ? getRegisteredEntityFieldsForRuntime('thing', { exposeToUpdateTool: true })
            : [];
        const registeredThingUpdateFieldMap = new Map(registeredThingUpdateFields.map(field => [field.fieldName, field]));
        const allowedFields = [
            ...((allowDirectShortDescriptionUpdates
                ? ADMIN_UPDATE_OBJECT_FIELD_NAMES_BY_TYPE
                : UPDATE_OBJECT_FIELD_NAMES_BY_TYPE)[objectType] || []),
            ...registeredThingUpdateFields.map(field => field.fieldName)
        ];
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
        const addOperation = (fieldName, value, apply) => {
            operations.push({ fieldName, value, apply });
        };

        for (const [fieldName, rawValue] of fieldEntries) {
            const registeredField = registeredThingUpdateFieldMap.get(fieldName) || null;
            const value = registeredField
                ? normalizeRegisteredEntityFieldValue(rawValue, registeredField, { functionName })
                : normalizeUpdateObjectFieldValue(rawValue, { functionName, objectType, fieldName });
            addOperation(fieldName, value, () => {
                if (registeredField) {
                    if (target.record && typeof target.record.setExtensionField === 'function') {
                        target.record.setExtensionField(fieldName, value);
                    } else if (target.record && typeof target.record === 'object') {
                        target.record[fieldName] = value;
                    } else {
                        throw new Error(`Target does not support registered field "${fieldName}".`);
                    }
                    if (
                        registeredField.clearThingSlotWhenPresent === true
                        && hasMeaningfulRegisteredEntityFieldValue(value)
                    ) {
                        target.record.slot = null;
                    }
                } else if (objectType === 'thing' && fieldName === 'value') {
                    const metadata = isPlainObject(target.record.metadata) ? { ...target.record.metadata } : {};
                    metadata.value = value;
                    target.record.metadata = metadata;
                } else if (objectType === 'location' && fieldName === 'hasWeather') {
                    const previousGenerationHints = target.record.generationHints;
                    if (!isPlainObject(previousGenerationHints)) {
                        throw new Error('Location generationHints are unavailable.');
                    }
                    const previousHasWeather = previousGenerationHints.hasWeather ?? null;
                    if (value !== previousHasWeather && typeof clearLocationImageVariants !== 'function') {
                        throw new Error('Location image-variant invalidation is unavailable.');
                    }
                    target.record.generationHints = {
                        ...previousGenerationHints,
                        hasWeather: value
                    };
                    const updatedHasWeather = target.record.generationHints?.hasWeather ?? null;
                    if (updatedHasWeather !== previousHasWeather) {
                        clearLocationImageVariants(target.record);
                    }
                } else if (fieldName === 'averageLevel' && typeof target.record.setAverageLevel === 'function') {
                    target.record.setAverageLevel(value);
                } else if (fieldName === 'statusEffects' && typeof target.record.setStatusEffects === 'function') {
                    target.record.setStatusEffects(value);
                } else {
                    if (objectType === 'quest' && fieldName === 'rewardBenefits') {
                        const existingById = new Map(
                            Quest.normalizeRewardBenefits(target.record.rewardBenefits || [])
                                .map(entry => [entry.id, entry])
                        );
                        const updatedById = new Map(value.map(entry => [entry.id, entry]));
                        for (const appliedId of Quest.normalizeAppliedRewardBenefitIds(target.record.appliedRewardBenefitIds)) {
                            const existing = existingById.get(appliedId);
                            const updated = updatedById.get(appliedId);
                            if (!existing || !updated || existing.type !== updated.type || existing.targetId !== updated.targetId) {
                                throw new Error(`Applied reward benefit "${appliedId}" cannot be removed or retargeted.`);
                            }
                        }
                    }
                    target.record[fieldName] = value;
                }
                if (typeof target.applyReplacement === 'function') {
                    target.applyReplacement(target.record);
                }
            });
        }

        return operations;
    };

    const regenerateConciseSummary = async ({
        objectType,
        record,
        description,
        functionName,
        updates = null
    } = {}) => {
        if (!SHORT_DESCRIPTION_OBJECT_TYPES.has(objectType)) {
            throw new Error(`${functionName} cannot regenerate a concise summary for object type "${objectType}".`);
        }
        if (description === null) {
            return null;
        }
        if (typeof regenerateShortDescription !== 'function') {
            throw new Error(`${functionName} cannot change ${objectType} description because short-description generation is unavailable.`);
        }
        const generated = await regenerateShortDescription({
            objectType,
            record,
            description,
            updates
        });
        const normalized = toTrimmedString(generated);
        if (!normalized) {
            throw new Error(`${functionName} short-description generation returned an empty result for ${objectType}.`);
        }
        return normalized;
    };

    const getFactionMapForUpsert = (functionName) => {
        const factionMap = getFactions();
        if (!(factionMap instanceof Map)) {
            throw new Error(`${functionName} requires getFactions to return a Map.`);
        }
        return factionMap;
    };

    const normalizeUpsertFactionOperation = (value, { functionName } = {}) => {
        const operation = normalizeRequiredString(value, { functionName, fieldName: 'operation' }).toLowerCase();
        if (!UPSERT_FACTION_OPERATION_VALUES.includes(operation)) {
            throw new ToolVisibleError(
                `${functionName} "operation" must be one of: ${UPSERT_FACTION_OPERATION_VALUES.join(', ')}.`,
                { code: 'invalid_arguments' }
            );
        }
        return operation;
    };

    const findFactionByNameForUpsert = (name, factionMap) => {
        const normalizedName = toTrimmedString(name).toLowerCase();
        if (!normalizedName) {
            return null;
        }
        if (factionMap instanceof Map) {
            for (const faction of factionMap.values()) {
                if (toTrimmedString(faction?.name).toLowerCase() === normalizedName) {
                    return faction;
                }
            }
        }
        return typeof Faction?.getByName === 'function'
            ? Faction.getByName(name)
            : null;
    };

    const assertFactionNameAvailableForUpsert = (name, {
        functionName,
        factionMap,
        currentId = null
    } = {}) => {
        const existing = findFactionByNameForUpsert(name, factionMap);
        const existingId = getRecordId(existing);
        if (existing && (!currentId || existingId !== currentId)) {
            throw new ToolVisibleError(
                `${functionName} cannot use duplicate faction name "${name}".`,
                {
                    code: 'duplicate_faction_name',
                    candidates: [buildUpdateObjectCandidate(makeUpdateObjectTarget({
                        objectType: 'faction',
                        record: existing
                    }))]
                }
            );
        }
    };

    const normalizeUpsertFactionStringList = (value, { functionName, fieldName } = {}) => {
        const entries = Array.isArray(value)
            ? value
            : (typeof value === 'string' ? value.split(/\r?\n/) : null);
        if (!entries) {
            throw new ToolVisibleError(
                `${functionName} "${fieldName}" must be an array of strings or newline-delimited string.`,
                { code: 'invalid_arguments' }
            );
        }
        const normalized = [];
        for (const [index, entry] of entries.entries()) {
            if (typeof entry !== 'string') {
                throw new ToolVisibleError(
                    `${functionName} "${fieldName}[${index}]" must be a string.`,
                    { code: 'invalid_arguments' }
                );
            }
            const trimmed = entry.trim();
            if (trimmed) {
                normalized.push(trimmed);
            }
        }
        return normalized;
    };

    const normalizeOptionalUpsertFactionText = (value, { functionName, fieldName } = {}) => {
        if (value === null || value === undefined) {
            return null;
        }
        if (typeof value !== 'string') {
            throw new ToolVisibleError(
                `${functionName} "${fieldName}" must be a non-empty string or null.`,
                { code: 'invalid_arguments' }
            );
        }
        const trimmed = value.trim();
        if (!trimmed) {
            throw new ToolVisibleError(
                `${functionName} "${fieldName}" must be a non-empty string or null.`,
                { code: 'invalid_arguments' }
            );
        }
        return trimmed;
    };

    const normalizeUpsertFactionHomeRegionName = (value, { functionName, fieldName } = {}) => {
        if (value === null || value === undefined) {
            return null;
        }
        if (typeof value !== 'string' || !value.trim()) {
            throw new ToolVisibleError(
                `${functionName} "${fieldName}" must be a non-empty string or null.`,
                { code: 'invalid_arguments' }
            );
        }
        return value.trim();
    };

    const normalizeUpsertFactionAssets = (value, { functionName, fieldName } = {}) => {
        if (!Array.isArray(value)) {
            throw new ToolVisibleError(
                `${functionName} "${fieldName}" must be an array.`,
                { code: 'invalid_arguments' }
            );
        }
        return value.map((asset, index) => {
            if (typeof asset === 'string') {
                const name = asset.trim();
                if (!name) {
                    throw new ToolVisibleError(
                        `${functionName} "${fieldName}[${index}]" must not be blank.`,
                        { code: 'invalid_arguments' }
                    );
                }
                return { name };
            }
            if (!isPlainObject(asset)) {
                throw new ToolVisibleError(
                    `${functionName} "${fieldName}[${index}]" must be an object or string.`,
                    { code: 'invalid_arguments' }
                );
            }
            const name = normalizeRequiredString(asset.name, {
                functionName,
                fieldName: `${fieldName}[${index}].name`
            });
            return {
                ...asset,
                name
            };
        });
    };

    const normalizeUpsertFactionReputationTiers = (value, { functionName, fieldName } = {}) => {
        if (!Array.isArray(value)) {
            throw new ToolVisibleError(
                `${functionName} "${fieldName}" must be an array.`,
                { code: 'invalid_arguments' }
            );
        }
        return value.map((tier, index) => {
            if (!isPlainObject(tier)) {
                throw new ToolVisibleError(
                    `${functionName} "${fieldName}[${index}]" must be an object.`,
                    { code: 'invalid_arguments' }
                );
            }
            const threshold = Number(tier.threshold);
            if (!Number.isFinite(threshold)) {
                throw new ToolVisibleError(
                    `${functionName} "${fieldName}[${index}].threshold" must be a finite number.`,
                    { code: 'invalid_arguments' }
                );
            }
            const label = tier.label === null || tier.label === undefined
                ? ''
                : normalizeCharacterFieldString(tier.label, {
                    functionName,
                    fieldName: `${fieldName}[${index}].label`
                }).trim();
            return {
                threshold,
                label,
                perks: normalizeUpsertFactionStringList(tier.perks || [], {
                    functionName,
                    fieldName: `${fieldName}[${index}].perks`
                }),
                penalties: normalizeUpsertFactionStringList(tier.penalties || [], {
                    functionName,
                    fieldName: `${fieldName}[${index}].penalties`
                })
            };
        });
    };

    const normalizeUpsertFactionRelations = (value, {
        functionName,
        fieldName,
        factionMap,
        currentId = null
    } = {}) => {
        if (!isPlainObject(value)) {
            throw new ToolVisibleError(
                `${functionName} "${fieldName}" must be an object keyed by faction id.`,
                { code: 'invalid_arguments' }
            );
        }
        const validStatuses = new Set(['allied', 'neutral', 'hostile', 'rival']);
        const normalized = {};
        for (const [rawTargetId, rawRelation] of Object.entries(value)) {
            const targetId = normalizeRequiredString(rawTargetId, {
                functionName,
                fieldName: `${fieldName} key`
            });
            if (currentId && targetId === currentId) {
                throw new ToolVisibleError(
                    `${functionName} "${fieldName}" cannot reference the faction itself.`,
                    { code: 'invalid_faction_relation' }
                );
            }
            if (!(factionMap instanceof Map) || !factionMap.has(targetId)) {
                throw new ToolVisibleError(
                    `${functionName} "${fieldName}" references unknown faction id "${targetId}".`,
                    { code: 'invalid_faction_relation' }
                );
            }
            if (!isPlainObject(rawRelation)) {
                throw new ToolVisibleError(
                    `${functionName} "${fieldName}.${targetId}" must be an object with status and notes.`,
                    { code: 'invalid_faction_relation' }
                );
            }
            const status = (toTrimmedString(rawRelation.status) || UPSERT_FACTION_DEFAULT_RELATION_STATUS).toLowerCase();
            if (!validStatuses.has(status)) {
                throw new ToolVisibleError(
                    `${functionName} "${fieldName}.${targetId}.status" must be allied, neutral, hostile, or rival.`,
                    { code: 'invalid_faction_relation' }
                );
            }
            const notes = toTrimmedString(rawRelation.notes) || UPSERT_FACTION_DEFAULT_RELATION_NOTES;
            normalized[targetId] = { status, notes };
        }
        return normalized;
    };

    const normalizeUpsertFactionFields = (fieldsObject, {
        functionName,
        operation,
        factionMap,
        target = null,
        allowDirectShortDescriptionUpdates = false
    } = {}) => {
        if (!isPlainObject(fieldsObject)) {
            throw new ToolVisibleError(
                `${functionName} requires "fields" to be an object.`,
                { code: 'invalid_arguments' }
            );
        }
        const fieldEntries = Object.entries(fieldsObject);
        if (!fieldEntries.length) {
            throw new ToolVisibleError(
                `${functionName} requires at least one faction field.`,
                { code: 'invalid_arguments' }
            );
        }
        const allowedFields = (allowDirectShortDescriptionUpdates
            ? ADMIN_UPDATE_OBJECT_FIELD_NAMES_BY_TYPE
            : UPDATE_OBJECT_FIELD_NAMES_BY_TYPE).faction;
        const allowedFieldSet = new Set(allowedFields);
        for (const [fieldName] of fieldEntries) {
            if (!allowedFieldSet.has(fieldName)) {
                throw new ToolVisibleError(
                    `${functionName} cannot update field "${fieldName}" on faction. Allowed fields: ${allowedFields.join(', ')}.`,
                    {
                        code: 'unsupported_field',
                        details: { objectType: 'faction', fieldName }
                    }
                );
            }
        }
        if (operation === 'create' && !Object.prototype.hasOwnProperty.call(fieldsObject, 'name')) {
            throw new ToolVisibleError(
                `${functionName} create requires "fields.name".`,
                { code: 'invalid_arguments' }
            );
        }

        const currentId = getRecordId(target?.record || target) || null;
        const normalized = {};
        for (const [fieldName, rawValue] of fieldEntries) {
            if (fieldName === 'name') {
                normalized.name = normalizeRequiredString(rawValue, { functionName, fieldName });
            } else if (fieldName === 'description' || fieldName === 'shortDescription') {
                normalized[fieldName] = normalizeOptionalUpsertFactionText(rawValue, { functionName, fieldName });
            } else if (fieldName === 'homeRegionName') {
                normalized.homeRegionName = normalizeUpsertFactionHomeRegionName(rawValue, { functionName, fieldName });
            } else if (fieldName === 'tags' || fieldName === 'goals') {
                normalized[fieldName] = normalizeUpsertFactionStringList(rawValue, { functionName, fieldName });
            } else if (fieldName === 'relations') {
                normalized.relations = normalizeUpsertFactionRelations(rawValue, {
                    functionName,
                    fieldName,
                    factionMap,
                    currentId
                });
            } else if (fieldName === 'assets') {
                normalized.assets = normalizeUpsertFactionAssets(rawValue, { functionName, fieldName });
            } else if (fieldName === 'reputationTiers') {
                normalized.reputationTiers = normalizeUpsertFactionReputationTiers(rawValue, { functionName, fieldName });
            }
        }
        return normalized;
    };

    const buildUpsertFactionResult = ({ operation, faction, updatedFields }) => {
        const factionId = getRecordId(faction);
        const factionName = getRecordName(faction);
        const lines = [
            '<upsertFactionFieldsResult>',
            '  <status>success</status>',
            `  <operation>${xmlEscapeText(operation)}</operation>`,
            ...renderXmlNode('faction', {
                id: factionId,
                name: factionName
            }, 1),
            ...renderXmlNode('updatedFields', updatedFields, 1),
            '</upsertFactionFieldsResult>'
        ];
        return {
            content: lines.join('\n'),
            metadata: {
                status: 'success',
                operation,
                factionId,
                factionName,
                updatedFields
            }
        };
    };

    const executeUpsertFactionFieldsTool = async ({
        operation,
        faction,
        fields
    } = {}, { allowDirectShortDescriptionUpdates = false } = {}) => {
        const functionName = 'upsertFactionFields';
        const normalizedOperation = normalizeUpsertFactionOperation(operation, { functionName });
        const factionMap = getFactionMapForUpsert(functionName);

        if (normalizedOperation === 'create') {
            if (toTrimmedString(faction)) {
                throw new ToolVisibleError(
                    `${functionName} create does not accept "faction"; put the faction name in fields.name.`,
                    { code: 'invalid_arguments' }
                );
            }
            const normalizedFields = normalizeUpsertFactionFields(fields, {
                functionName,
                operation: normalizedOperation,
                factionMap,
                allowDirectShortDescriptionUpdates
            });
            assertFactionNameAvailableForUpsert(normalizedFields.name, {
                functionName,
                factionMap
            });
            if (
                Object.prototype.hasOwnProperty.call(normalizedFields, 'description')
                && !Object.prototype.hasOwnProperty.call(normalizedFields, 'shortDescription')
            ) {
                normalizedFields.shortDescription = await regenerateConciseSummary({
                    objectType: 'faction',
                    record: normalizedFields,
                    description: normalizedFields.description,
                    functionName,
                    updates: normalizedFields
                });
            }
            let createdFaction = null;
            try {
                createdFaction = new Faction(normalizedFields);
            } catch (error) {
                throw new ToolVisibleError(
                    `Failed to create faction "${normalizedFields.name}": ${error?.message || error}`,
                    { code: 'field_update_failed' }
                );
            }
            factionMap.set(createdFaction.id, createdFaction);
            return buildUpsertFactionResult({
                operation: normalizedOperation,
                faction: createdFaction,
                updatedFields: Object.keys(normalizedFields)
            });
        }

        const target = resolveUpdateObjectTarget('faction', faction, { functionName });
        const normalizedFields = normalizeUpsertFactionFields(fields, {
            functionName,
            operation: normalizedOperation,
            factionMap,
            target,
            allowDirectShortDescriptionUpdates
        });
        if (Object.prototype.hasOwnProperty.call(normalizedFields, 'name')) {
            assertFactionNameAvailableForUpsert(normalizedFields.name, {
                functionName,
                factionMap,
                currentId: getRecordId(target.record)
            });
        }
        if (
            Object.prototype.hasOwnProperty.call(normalizedFields, 'description')
            && !Object.prototype.hasOwnProperty.call(normalizedFields, 'shortDescription')
        ) {
            normalizedFields.shortDescription = await regenerateConciseSummary({
                objectType: 'faction',
                record: target.record,
                description: normalizedFields.description,
                functionName,
                updates: normalizedFields
            });
        }
        try {
            target.record.update(normalizedFields);
        } catch (error) {
            throw new ToolVisibleError(
                `Failed to update faction "${target.name || target.id || faction}": ${error?.message || error}`,
                { code: 'field_update_failed' }
            );
        }
        return buildUpsertFactionResult({
            operation: normalizedOperation,
            faction: target.record,
            updatedFields: Object.keys(normalizedFields)
        });
    };

    const executeUpdatePartyMembersTool = ({
        add = undefined,
        remove = undefined
    } = {}) => {
        const functionName = 'updatePartyMembers';
        const currentPlayer = getCurrentPlayer();
        if (!currentPlayer) {
            throw new ToolVisibleError(
                `${functionName} requires a current player.`,
                { code: 'missing_current_player' }
            );
        }

        const addQueries = normalizePartyMemberReferenceList(add, {
            functionName,
            fieldName: 'add'
        });
        const removeQueries = normalizePartyMemberReferenceList(remove, {
            functionName,
            fieldName: 'remove'
        });
        if (!addQueries.length && !removeQueries.length) {
            throw new ToolVisibleError(
                `${functionName} requires at least one character in "add" or "remove".`,
                { code: 'invalid_arguments' }
            );
        }

        if (addQueries.length && typeof currentPlayer.addPartyMember !== 'function') {
            throw new ToolVisibleError(
                `${functionName} cannot add party members because the current player does not support addPartyMember().`,
                { code: 'tool_unavailable' }
            );
        }
        if (removeQueries.length && typeof currentPlayer.removePartyMember !== 'function') {
            throw new ToolVisibleError(
                `${functionName} cannot remove party members because the current player does not support removePartyMember().`,
                { code: 'tool_unavailable' }
            );
        }

        const addTargets = resolvePartyMemberTargets(addQueries, {
            functionName,
            fieldName: 'add'
        });
        const removeTargets = resolvePartyMemberTargets(removeQueries, {
            functionName,
            fieldName: 'remove'
        });

        const assertUniqueTargets = (targets, fieldName) => {
            const seen = new Map();
            for (const target of targets) {
                if (seen.has(target.id)) {
                    throw new ToolVisibleError(
                        `${functionName} received duplicate ${fieldName} target "${target.character?.name || target.id}".`,
                        {
                            code: 'duplicate_party_target',
                            candidates: [describePartyMemberCandidate(target.character)]
                        }
                    );
                }
                seen.set(target.id, target);
            }
            return seen;
        };
        const addTargetMap = assertUniqueTargets(addTargets, 'add');
        const removeTargetMap = assertUniqueTargets(removeTargets, 'remove');
        for (const [targetId, target] of addTargetMap.entries()) {
            if (removeTargetMap.has(targetId)) {
                throw new ToolVisibleError(
                    `${functionName} cannot both add and remove "${target.character?.name || targetId}" in the same call.`,
                    {
                        code: 'conflicting_party_operation',
                        candidates: [describePartyMemberCandidate(target.character)]
                    }
                );
            }
        }

        const partyMemberIdsBefore = getCurrentPartyMemberIdSet(currentPlayer, { functionName });
        for (const target of addTargets) {
            if (partyMemberIdsBefore.has(target.id)) {
                throw new ToolVisibleError(
                    `${functionName} cannot add "${target.character?.name || target.id}" because they are already in the party.`,
                    {
                        code: 'already_in_party',
                        candidates: [describePartyMemberCandidate(target.character)]
                    }
                );
            }
        }
        for (const target of removeTargets) {
            if (!partyMemberIdsBefore.has(target.id)) {
                throw new ToolVisibleError(
                    `${functionName} cannot remove "${target.character?.name || target.id}" because they are not in the party.`,
                    {
                        code: 'not_in_party',
                        candidates: [describePartyMemberCandidate(target.character)]
                    }
                );
            }
        }

        const currentLocation = removeTargets.length
            ? getCurrentPlayerLocationForPartyTool(currentPlayer, { functionName })
            : null;
        const added = [];
        const removed = [];

        for (const target of addTargets) {
            const changed = currentPlayer.addPartyMember(target.id);
            if (!changed) {
                throw new ToolVisibleError(
                    `${functionName} failed to add "${target.character?.name || target.id}" to the party after validation.`,
                    { code: 'party_update_failed' }
                );
            }
            const afterLocation = describeLocationSummary(target.character.currentLocation || target.character.locationId || null);
            if (afterLocation.locationId) {
                throw new ToolVisibleError(
                    `${functionName} added "${target.character?.name || target.id}" but they still have location "${afterLocation.locationName || afterLocation.locationId}".`,
                    { code: 'party_update_failed' }
                );
            }
            added.push({
                id: target.id,
                name: toTrimmedString(target.character?.name) || target.id,
                previousLocationId: target.beforeLocation.locationId,
                previousLocationName: target.beforeLocation.locationName,
                currentLocationId: afterLocation.locationId,
                currentLocationName: afterLocation.locationName
            });
        }

        for (const target of removeTargets) {
            const changed = currentPlayer.removePartyMember(target.id);
            if (!changed) {
                throw new ToolVisibleError(
                    `${functionName} failed to remove "${target.character?.name || target.id}" from the party after validation.`,
                    { code: 'party_update_failed' }
                );
            }
            const afterLocation = describeLocationSummary(target.character.currentLocation || target.character.locationId || null);
            if (currentLocation?.id && afterLocation.locationId !== currentLocation.id) {
                throw new ToolVisibleError(
                    `${functionName} removed "${target.character?.name || target.id}" but did not place them at the current location "${currentLocation.name || currentLocation.id}".`,
                    { code: 'party_update_failed' }
                );
            }
            removed.push({
                id: target.id,
                name: toTrimmedString(target.character?.name) || target.id,
                previousLocationId: target.beforeLocation.locationId,
                previousLocationName: target.beforeLocation.locationName,
                currentLocationId: afterLocation.locationId,
                currentLocationName: afterLocation.locationName
            });
        }

        const partyMemberIdsAfter = Array.from(getCurrentPartyMemberIdSet(currentPlayer, { functionName })).sort();
        const currentPlayerLocation = describeLocationSummary(currentPlayer.currentLocation || currentPlayer.locationId || null);
        const lines = [
            '<updatePartyMembersResult>',
            '  <status>success</status>',
            ...renderXmlNode('currentPlayer', {
                id: toTrimmedString(currentPlayer.id) || null,
                name: toTrimmedString(currentPlayer.name) || null,
                locationId: currentPlayerLocation.locationId,
                locationName: currentPlayerLocation.locationName
            }, 1),
            ...renderXmlNode('added', added, 1, { count: added.length }),
            ...renderXmlNode('removed', removed, 1, { count: removed.length }),
            ...renderXmlNode('partyMemberIds', partyMemberIdsAfter, 1, { count: partyMemberIdsAfter.length }),
            '</updatePartyMembersResult>'
        ];

        return {
            content: lines.join('\n'),
            metadata: {
                status: 'success',
                added,
                removed,
                partyMemberIds: partyMemberIdsAfter,
                currentPlayerId: toTrimmedString(currentPlayer.id) || null,
                currentLocationId: currentPlayerLocation.locationId
            }
        };
    };

    const executeUpdateObjectFieldsTool = async ({
        objectType,
        object,
        fields
    } = {}, { allowDirectShortDescriptionUpdates = false } = {}) => {
        const functionName = 'updateObjectFields';
        const canonicalObjectType = normalizeUpdateObjectType(objectType, { functionName });
        const target = resolveUpdateObjectTarget(canonicalObjectType, object, { functionName });
        const normalizedInputFields = canonicalObjectType === 'thing'
            ? thingFieldRegistry.normalizePatch(fields, {
                filter: { exposeToUpdateTool: true }
            })
            : fields;
        const operations = makeUpdateObjectFieldOperations(target, normalizedInputFields, {
            functionName,
            objectType: canonicalObjectType,
            allowDirectShortDescriptionUpdates
        });
        let regeneratedShortDescription;
        const shouldRegenerateShortDescription = SHORT_DESCRIPTION_OBJECT_TYPES.has(canonicalObjectType)
            && Object.prototype.hasOwnProperty.call(normalizedInputFields, 'description')
            && !Object.prototype.hasOwnProperty.call(normalizedInputFields, 'shortDescription');
        if (shouldRegenerateShortDescription) {
            const normalizedDescription = canonicalObjectType === 'character'
                ? normalizeCharacterFieldString(normalizedInputFields.description, { functionName, fieldName: 'description' })
                : normalizeUpdateObjectFieldValue(normalizedInputFields.description, {
                    functionName,
                    objectType: canonicalObjectType,
                    fieldName: 'description'
                });
            regeneratedShortDescription = await regenerateConciseSummary({
                objectType: canonicalObjectType,
                record: target.record,
                description: normalizedDescription,
                functionName,
                updates: normalizedInputFields
            });
        }
        const updatedFields = [];
        let mutationReceipt = null;
        const supportsAtomicThingMutation = canonicalObjectType === 'thing'
            && typeof Thing === 'function'
            && typeof Thing.fromJSON === 'function'
            && target.record instanceof Thing
            && typeof target.record.replaceStateFrom === 'function';
        if (supportsAtomicThingMutation) {
            try {
                const candidatePatch = Object.fromEntries(
                    operations.map(operation => [operation.fieldName, operation.value])
                );
                if (shouldRegenerateShortDescription) {
                    candidatePatch.shortDescription = regeneratedShortDescription;
                }
                const prepared = thingMutationService.prepareUpdate(target.record, candidatePatch);
                const committed = thingMutationService.commitUpdate(target.record, prepared);
                mutationReceipt = committed.receipt;
                updatedFields.push(...Object.keys(candidatePatch));
            } catch (error) {
                throw new ToolVisibleError(
                    `Failed to atomically update thing "${target.name || target.id || object}": ${error?.message || error}`,
                    { code: 'field_update_failed' }
                );
            }
        } else {
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
            if (shouldRegenerateShortDescription) {
                try {
                    target.record.shortDescription = regeneratedShortDescription;
                    if (typeof target.applyReplacement === 'function') {
                        target.applyReplacement(target.record);
                    }
                    updatedFields.push('shortDescription');
                } catch (error) {
                    throw new ToolVisibleError(
                        `Failed to refresh the concise summary on ${canonicalObjectType} "${target.name || target.id || object}": ${error?.message || error}`,
                        { code: 'field_update_failed' }
                    );
                }
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
                updatedFields,
                ...(mutationReceipt ? { mutationReceipt } : {}),
                updatedValues: JSON.parse(JSON.stringify({
                    ...normalizedInputFields,
                    ...(shouldRegenerateShortDescription
                        ? { shortDescription: regeneratedShortDescription }
                        : {})
                }))
            }
        };
    };

    const directXmlElementChildren = node => Array.from(node?.childNodes || [])
        .filter(child => child?.nodeType === 1);

    const requireNoXmlAttributes = (node, label, functionName) => {
        if (Number(node?.attributes?.length || 0) > 0) {
            throw new ToolVisibleError(
                `${functionName} ${label} must not have XML attributes.`,
                { code: 'invalid_xml' }
            );
        }
    };

    const readBulkCharacterScalarNode = (node, label, functionName, { requireNonEmpty = false } = {}) => {
        requireNoXmlAttributes(node, label, functionName);
        if (directXmlElementChildren(node).length > 0) {
            throw new ToolVisibleError(
                `${functionName} ${label} must contain text, CDATA, or escaped XML characters, not nested elements.`,
                { code: 'invalid_xml' }
            );
        }
        const value = String(node?.textContent || '').trim();
        if (requireNonEmpty && !value) {
            throw new ToolVisibleError(
                `${functionName} ${label} must be non-empty.`,
                { code: 'invalid_xml' }
            );
        }
        return value;
    };

    const parseBulkCharacterFieldValue = (valueText) => {
        if (!valueText) {
            return '';
        }
        try {
            return JSON.parse(valueText);
        } catch (_) {
            return valueText;
        }
    };

    const parseBulkCharacterFieldsXml = (xml) => {
        const functionName = 'bulkUpdateCharacterFields';
        if (typeof xml !== 'string' || !xml.trim()) {
            throw new ToolVisibleError(
                `${functionName} requires a non-empty "xml" string.`,
                { code: 'invalid_arguments' }
            );
        }

        let document;
        try {
            document = Utils.parseXmlDocumentStrict(xml, 'text/xml');
        } catch (error) {
            throw new ToolVisibleError(
                `${functionName} received malformed XML: ${error?.message || error}`,
                { code: 'invalid_xml' }
            );
        }

        const root = document?.documentElement;
        if (!root || root.tagName !== 'characters') {
            throw new ToolVisibleError(
                `${functionName} requires exactly one <characters> root element.`,
                { code: 'invalid_xml' }
            );
        }
        requireNoXmlAttributes(root, '<characters>', functionName);

        const characterNodes = directXmlElementChildren(root);
        const invalidRootChild = characterNodes.find(node => node.tagName !== 'character');
        if (invalidRootChild) {
            throw new ToolVisibleError(
                `${functionName} does not allow <${invalidRootChild.tagName}> directly inside <characters>; expected only <character>.`,
                { code: 'invalid_xml' }
            );
        }
        if (!characterNodes.length) {
            throw new ToolVisibleError(
                `${functionName} requires at least one <character>.`,
                { code: 'invalid_xml' }
            );
        }

        const seenCharacterNames = new Set();
        return characterNodes.map((characterNode, characterIndex) => {
            requireNoXmlAttributes(characterNode, `<character> #${characterIndex + 1}`, functionName);
            const children = directXmlElementChildren(characterNode);
            const unexpectedChild = children.find(node => node.tagName !== 'name' && node.tagName !== 'field');
            if (unexpectedChild) {
                throw new ToolVisibleError(
                    `${functionName} does not allow <${unexpectedChild.tagName}> inside <character> #${characterIndex + 1}; expected one <name> and one or more <field> elements.`,
                    { code: 'invalid_xml' }
                );
            }
            const nameNodes = children.filter(node => node.tagName === 'name');
            const fieldNodes = children.filter(node => node.tagName === 'field');
            if (nameNodes.length !== 1) {
                throw new ToolVisibleError(
                    `${functionName} <character> #${characterIndex + 1} must contain exactly one <name>.`,
                    { code: 'invalid_xml' }
                );
            }
            if (!fieldNodes.length) {
                throw new ToolVisibleError(
                    `${functionName} <character> #${characterIndex + 1} must contain at least one <field>.`,
                    { code: 'invalid_xml' }
                );
            }

            const name = readBulkCharacterScalarNode(
                nameNodes[0],
                `<character> #${characterIndex + 1} <name>`,
                functionName,
                { requireNonEmpty: true }
            );
            const normalizedName = name.toLowerCase();
            if (seenCharacterNames.has(normalizedName)) {
                throw new ToolVisibleError(
                    `${functionName} contains duplicate <character> entries for "${name}". Combine that character's fields into one entry.`,
                    { code: 'duplicate_character' }
                );
            }
            seenCharacterNames.add(normalizedName);

            const fields = {};
            for (const [fieldIndex, fieldNode] of fieldNodes.entries()) {
                requireNoXmlAttributes(
                    fieldNode,
                    `<field> #${fieldIndex + 1} for "${name}"`,
                    functionName
                );
                const fieldChildren = directXmlElementChildren(fieldNode);
                const unexpectedFieldChild = fieldChildren.find(node => node.tagName !== 'key' && node.tagName !== 'value');
                if (unexpectedFieldChild) {
                    throw new ToolVisibleError(
                        `${functionName} does not allow <${unexpectedFieldChild.tagName}> in <field> #${fieldIndex + 1} for "${name}"; expected one <key> and one <value>.`,
                        { code: 'invalid_xml' }
                    );
                }
                const keyNodes = fieldChildren.filter(node => node.tagName === 'key');
                const valueNodes = fieldChildren.filter(node => node.tagName === 'value');
                if (keyNodes.length !== 1 || valueNodes.length !== 1 || fieldChildren.length !== 2) {
                    throw new ToolVisibleError(
                        `${functionName} <field> #${fieldIndex + 1} for "${name}" must contain exactly one <key> and one <value>.`,
                        { code: 'invalid_xml' }
                    );
                }
                const key = readBulkCharacterScalarNode(
                    keyNodes[0],
                    `<field> #${fieldIndex + 1} <key> for "${name}"`,
                    functionName,
                    { requireNonEmpty: true }
                );
                if (Object.prototype.hasOwnProperty.call(fields, key)) {
                    throw new ToolVisibleError(
                        `${functionName} contains duplicate field "${key}" for "${name}".`,
                        { code: 'duplicate_field' }
                    );
                }
                const valueText = readBulkCharacterScalarNode(
                    valueNodes[0],
                    `<field> #${fieldIndex + 1} <value> for "${name}"`,
                    functionName
                );
                fields[key] = parseBulkCharacterFieldValue(valueText);
            }

            return { name, fields };
        });
    };

    const resolveBulkCharacterByFullName = (fullName) => {
        const functionName = 'bulkUpdateCharacterFields';
        const lowerName = fullName.toLowerCase();
        const matches = getAllCharacters().filter(character => (
            toTrimmedString(character?.name).toLowerCase() === lowerName
        ));
        if (!matches.length) {
            throw new ToolVisibleError(
                `${functionName} found no character with the exact full name "${fullName}".`,
                { code: 'character_not_found' }
            );
        }
        if (matches.length > 1) {
            throw new ToolVisibleError(
                `${functionName} found multiple characters with the exact full name "${fullName}"; full names must be unique for this XML format.`,
                {
                    code: 'ambiguous_character',
                    candidates: matches.map(describeCharacterCandidate).sort(candidateSort)
                }
            );
        }
        if (!isNpcEntity(matches[0])) {
            throw new ToolVisibleError(
                `${functionName} can only update NPCs; "${fullName}" is a player character.`,
                { code: 'invalid_target' }
            );
        }
        return matches[0];
    };

    const executeBulkUpdateCharacterFieldsTool = async ({ xml } = {}, {
        allowDirectShortDescriptionUpdates = false
    } = {}) => {
        const functionName = 'bulkUpdateCharacterFields';
        const parsedCharacters = parseBulkCharacterFieldsXml(xml);
        const preparedUpdates = parsedCharacters.map(parsed => {
            const targetNpc = resolveBulkCharacterByFullName(parsed.name);
            const operations = makeUpdateCharacterFieldOperations(targetNpc, parsed.fields, {
                functionName,
                allowDirectShortDescriptionUpdates
            });
            return {
                ...parsed,
                targetNpc,
                operations,
                shouldRegenerateShortDescription: Object.prototype.hasOwnProperty.call(parsed.fields, 'description')
                    && !Object.prototype.hasOwnProperty.call(parsed.fields, 'shortDescription'),
                regeneratedShortDescription: null
            };
        });

        await Promise.all(preparedUpdates.map(async prepared => {
            if (!prepared.shouldRegenerateShortDescription) {
                return;
            }
            prepared.regeneratedShortDescription = await regenerateConciseSummary({
                objectType: 'character',
                record: prepared.targetNpc,
                description: normalizeCharacterFieldString(prepared.fields.description, {
                    functionName,
                    fieldName: 'description'
                }),
                functionName,
                updates: prepared.fields
            });
        }));

        const updatedCharacters = [];
        let totalUpdatedFields = 0;
        for (const prepared of preparedUpdates) {
            const updatedFields = [];
            for (const operation of prepared.operations) {
                try {
                    operation.apply();
                    updatedFields.push(operation.fieldName);
                    totalUpdatedFields += 1;
                } catch (error) {
                    throw new ToolVisibleError(
                        `${functionName} failed to update "${operation.fieldName}" on "${prepared.name}" after ${totalUpdatedFields} field update(s) had been applied: ${error?.message || error}`,
                        { code: 'field_update_failed' }
                    );
                }
            }
            if (prepared.shouldRegenerateShortDescription) {
                try {
                    prepared.targetNpc.shortDescription = prepared.regeneratedShortDescription;
                    updatedFields.push('shortDescription');
                    totalUpdatedFields += 1;
                } catch (error) {
                    throw new ToolVisibleError(
                        `${functionName} failed to refresh the concise summary on "${prepared.name}" after ${totalUpdatedFields} field update(s) had been applied: ${error?.message || error}`,
                        { code: 'field_update_failed' }
                    );
                }
            }
            updatedCharacters.push({
                npcId: normalizeOptionalString(prepared.targetNpc?.id),
                npcName: normalizeOptionalString(prepared.targetNpc?.name) || prepared.name,
                requestedName: prepared.name,
                updatedFields,
                updatedValues: JSON.parse(JSON.stringify({
                    ...prepared.fields,
                    ...(prepared.shouldRegenerateShortDescription
                        ? { shortDescription: prepared.regeneratedShortDescription }
                        : {})
                }))
            });
        }

        const lines = [
            '<bulkUpdateCharacterFieldsResult>',
            '  <status>success</status>',
            `  <charactersUpdated>${updatedCharacters.length}</charactersUpdated>`,
            `  <fieldsUpdated>${totalUpdatedFields}</fieldsUpdated>`,
            ...renderXmlNode('characters', updatedCharacters.map(character => ({
                id: character.npcId,
                name: character.npcName,
                updatedFields: character.updatedFields
            })), 1, { count: updatedCharacters.length }),
            '</bulkUpdateCharacterFieldsResult>'
        ];
        return {
            content: lines.join('\n'),
            metadata: {
                status: 'success',
                charactersUpdated: updatedCharacters.length,
                fieldsUpdated: totalUpdatedFields,
                characters: updatedCharacters
            }
        };
    };

    const executeUpdateCharacterFieldsTool = async ({
        character,
        fields
    } = {}, { allowDirectShortDescriptionUpdates = false } = {}) => {
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

        const operations = makeUpdateCharacterFieldOperations(targetNpc, fields, {
            functionName,
            allowDirectShortDescriptionUpdates
        });
        let regeneratedShortDescription;
        const shouldRegenerateShortDescription = Object.prototype.hasOwnProperty.call(fields, 'description')
            && !Object.prototype.hasOwnProperty.call(fields, 'shortDescription');
        if (shouldRegenerateShortDescription) {
            regeneratedShortDescription = await regenerateConciseSummary({
                objectType: 'character',
                record: targetNpc,
                description: normalizeCharacterFieldString(fields.description, {
                    functionName,
                    fieldName: 'description'
                }),
                functionName,
                updates: fields
            });
        }
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
        if (shouldRegenerateShortDescription) {
            try {
                targetNpc.shortDescription = regeneratedShortDescription;
                updatedFields.push('shortDescription');
            } catch (error) {
                throw new ToolVisibleError(
                    `Failed to refresh the concise summary on "${targetNpc?.name || characterQuery}": ${error?.message || error}`,
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

    const resolveAttackToolAttackerForVisibility = (rawName) => {
        const name = toTrimmedString(rawName);
        if (!name) {
            return null;
        }

        const current = getCurrentPlayer();
        const normalized = name.toLowerCase();
        if (current) {
            const currentNames = [
                'player',
                'the player',
                'you',
                toTrimmedString(current.id),
                toTrimmedString(current.name)
            ].filter(Boolean).map(value => value.toLowerCase());
            if (currentNames.includes(normalized)) {
                return current;
            }
        }

        const allCharacters = getAllCharacters();
        const idMatch = allCharacters.find(character => toTrimmedString(character?.id) === name) || null;
        if (idMatch) {
            return idMatch;
        }

        return allCharacters.find(character => (
            toTrimmedString(character?.name).toLowerCase() === normalized
        )) || null;
    };

    const revealAttackToolAttackerIfHidden = (rawName) => {
        const attacker = resolveAttackToolAttackerForVisibility(rawName);
        if (!attacker || attacker.hiddenFromPlayer !== true || attacker.isDead === true) {
            return false;
        }
        attacker.hiddenFromPlayer = false;
        return true;
    };

    const buildResolveAttackHitContent = ({ resolved, damage }) => {
        const application = resolved?.application && typeof resolved.application === 'object'
            ? resolved.application
            : {};
        const summary = resolved?.summary && typeof resolved.summary === 'object'
            ? resolved.summary
            : {};
        const attackOutcomeTarget = resolved?.attackOutcome?.target
            && typeof resolved.attackOutcome.target === 'object'
            ? resolved.attackOutcome.target
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
            summaryTarget.totalHealth,
            attackOutcomeTarget.maxHealth,
            attackOutcomeTarget.maximumHealth,
            attackOutcomeTarget.totalHealth
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
            summaryTarget.rawRemainingHealth,
            attackOutcomeTarget.remainingHealth,
            attackOutcomeTarget.rawRemainingHealth
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

        const defeated = typeof application.defeated === 'boolean'
            ? application.defeated
            : (typeof summaryTarget.defeated === 'boolean'
                ? summaryTarget.defeated
                : (typeof attackOutcomeTarget.defeated === 'boolean'
                    ? attackOutcomeTarget.defeated
                    : remainingHealthPercent <= 0));
        const defeatedText = defeated
            ? 'YES — portray the target as incapacitated or dead.'
            : 'NO — the target remains alive and is not incapacitated or defeated by this attack.';
        return [
            `Damage: ${damagePercent}%`,
            `Remaining health: ${remainingHealthPercent}%`,
            `Defeated by this attack: ${defeatedText}`
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
    } = {}, { dieRollOverride = null } = {}) => {
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

        const resolved = await resolveAttack({
            attackEntry,
            dieRollOverride: Number.isInteger(dieRollOverride) ? dieRollOverride : null
        });
        if (!resolved || typeof resolved !== 'object') {
            throw new ToolVisibleError(
                'resolveAttack completed without returning an attack result.',
                { code: 'attack_resolution_failed' }
            );
        }
        const attackerRevealedFromHidden = revealAttackToolAttackerIfHidden(attackerName);

        if (!resolved.hit) {
            return {
                content: 'Miss. The defender is not defeated by this attack.',
                metadata: {
                    result: 'miss',
                    hit: false,
                    summary: resolved.summary || null,
                    attacker: attackerName,
                    defender: defenderName,
                    locationRefreshRequested: Boolean(resolved.locationRefreshRequested || attackerRevealedFromHidden)
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
            content: buildResolveAttackHitContent({
                resolved,
                damage
            }),
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
                locationRefreshRequested: Boolean(resolved.locationRefreshRequested || resolved.application || attackerRevealedFromHidden),
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

            const defeated = typeof result.defeated === 'boolean'
                ? result.defeated
                : remainingHealthPercent <= 0;
            const defeatedText = defeated
                ? 'YES — portray the target as incapacitated or dead.'
                : 'NO — the target remains alive and is not incapacitated or defeated by this attack.';
            const effectName = normalizeOptionalString(result.secondaryEffect || result.effect);
            const effectText = result.secondaryEffectApplied && effectName
                ? `, effect: ${effectName}`
                : '';
            lines.push(`- ${target}: hit, Damage: ${damagePercent}%, Remaining health: ${remainingHealthPercent}%, Defeated by this attack: ${defeatedText}${effectText}`);
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
    } = {}, { dieRollOverride = null } = {}) => {
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

        const resolved = await resolveAreaAttack({
            areaAttackEntry,
            dieRollOverride: Number.isInteger(dieRollOverride) ? dieRollOverride : null
        });
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
        const attackerRevealedFromHidden = revealAttackToolAttackerIfHidden(attackerName);

        return {
            content: buildResolveAreaAttackContent({ resolved, summary }),
            metadata: {
                kind: 'area-attack',
                result: hitCount > 0 ? (hitCount === targetCount ? 'all-hit' : 'mixed') : 'miss',
                hitCount,
                targetCount,
                locationRefreshRequested: Boolean(resolved.locationRefreshRequested || attackerRevealedFromHidden),
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
    } = {}, {
        defaultActorName = null,
        toolName = 'resolveSkillCheck',
        forcedSkillCheckRoll = null,
        dieRollOverride = null
    } = {}) => {
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

        const resolvedDieRollOverride = typeof forcedSkillCheckRoll === 'function'
            ? await forcedSkillCheckRoll({
                toolName: functionName,
                checkType: 'unopposed',
                actor: actorName,
                reason: reasonText,
                skill: skillName,
                attribute: attributeName,
                difficultyLevel: difficultyName,
                circumstanceModifiers: modifiers
            })
            : (Number.isInteger(dieRollOverride) ? dieRollOverride : null);

        const resolved = await resolvePlausibilityCheck({
            actor: actorName,
            plausibility,
            dieRollOverride: Number.isInteger(resolvedDieRollOverride) ? resolvedDieRollOverride : null
        });
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
    } = {}, {
        defaultActorName = null,
        toolName = 'resolveOpposedSkillCheck',
        forcedSkillCheckRoll = null,
        dieRollOverride = null
    } = {}) => {
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

        const resolvedDieRollOverride = typeof forcedSkillCheckRoll === 'function'
            ? await forcedSkillCheckRoll({
                toolName: functionName,
                checkType: 'opposed',
                actor: actorName,
                reason: reasonText,
                skill: skillName,
                attribute: attributeName,
                opponent: opponentName,
                opponentSkill: opponentSkillName,
                opponentAttribute: opponentAttributeName,
                circumstanceModifiers: modifiers
            })
            : (Number.isInteger(dieRollOverride) ? dieRollOverride : null);

        const resolved = await resolveOpposedPlausibilityCheck({
            actor: actorName,
            plausibility,
            dieRollOverride: Number.isInteger(resolvedDieRollOverride) ? resolvedDieRollOverride : null
        });
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
            if (shouldExcludeEntryFromPromptHistory(entry)) {
                continue;
            }
            if (!includeAllEntryTypes && !isAssistantProseLikeEntry(entry)) {
                continue;
            }
            const content = getHistoryEntrySearchText(entry, { includeAllEntryTypes });
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

    const truncateToolPreview = (value, maxLength = 500) => {
        const text = typeof value === 'string' ? value : '';
        if (text.length <= maxLength) {
            return text;
        }
        return `${text.slice(0, maxLength)}...`;
    };

    const getMutableChatHistory = (functionName) => {
        const chatHistory = getChatHistory();
        if (!Array.isArray(chatHistory)) {
            throw new ToolVisibleError(
                `Chat history is unavailable for ${functionName}.`,
                { code: 'chat_history_unavailable' }
            );
        }
        return chatHistory;
    };

    const applyPlainTextChatLogEdit = (target, content) => {
        if (!target || typeof target !== 'object') {
            throw new ToolVisibleError(
                'Cannot edit an invalid chat log entry.',
                { code: 'invalid_entry' }
            );
        }

        const oldContent = getHistoryEntrySearchText(target, { includeAllEntryTypes: true });
        target.content = content;

        const entryType = typeof target.type === 'string' ? target.type.trim().toLowerCase() : '';
        const hasStructuredDisplay = entryType === 'event-summary'
            || entryType === 'status-summary'
            || entryType === 'check-results'
            || entryType === 'tool-call-debug'
            || entryType === 'plausibility'
            || entryType === 'slop-remover'
            || entryType === 'skill-check'
            || entryType === 'attack-check'
            || Array.isArray(target.summaryItems)
            || Array.isArray(target.checkResults)
            || Array.isArray(target.toolCalls)
            || Boolean(target.plausibility && typeof target.plausibility === 'object')
            || Boolean(target.slopRemoval && typeof target.slopRemoval === 'object')
            || Boolean(target.skillCheck && typeof target.skillCheck === 'object')
            || Boolean(target.resolution && typeof target.resolution === 'object')
            || Boolean(target.attackSummary && typeof target.attackSummary === 'object')
            || Boolean(target.attackCheck && typeof target.attackCheck === 'object');

        if (typeof target.summary === 'string' || hasStructuredDisplay) {
            target.summary = content;
        }

        if (entryType === 'event-summary' || entryType === 'status-summary' || Array.isArray(target.summaryItems)) {
            target.summaryItems = [{
                icon: '•',
                text: content
            }];
            target.summaryTitle = target.summaryTitle || (entryType === 'status-summary'
                ? '🌀 Status Changes'
                : 'Event Summary');
        }
        if (Array.isArray(target.checkResults) || entryType === 'check-results') {
            target.checkResults = [];
        }
        if (Array.isArray(target.toolCalls) || entryType === 'tool-call-debug') {
            target.toolCalls = [];
        }
        if (target.plausibility && typeof target.plausibility === 'object') {
            target.plausibility = null;
        }
        if (target.slopRemoval && typeof target.slopRemoval === 'object') {
            target.slopRemoval = null;
        }
        if (target.skillCheck && typeof target.skillCheck === 'object') {
            target.skillCheck = null;
        }
        if (target.resolution && typeof target.resolution === 'object') {
            target.resolution = null;
        }
        if (target.attackSummary && typeof target.attackSummary === 'object') {
            target.attackSummary = null;
        }
        if (target.attackCheck && typeof target.attackCheck === 'object') {
            target.attackCheck = null;
        }

        if (hasStructuredDisplay) {
            target.metadata = {
                ...(target.metadata && typeof target.metadata === 'object' ? target.metadata : {}),
                editedPlainText: true,
                originalStructuredType: typeof target.type === 'string' && target.type.trim()
                    ? target.type.trim()
                    : null
            };
        }

        return {
            oldContent,
            replacedStructuredDisplay: hasStructuredDisplay
        };
    };

    const resolveChatLogEntryIndex = ({ entry = null, index = null } = {}) => {
        const chatHistory = getMutableChatHistory('editChatLogEntry');
        const hasEntryReference = entry !== null && entry !== undefined && String(entry).trim() !== '';
        const hasIndexReference = index !== null && index !== undefined && index !== '';

        if (!hasEntryReference && !hasIndexReference) {
            throw new ToolVisibleError(
                'editChatLogEntry requires either "entry" or "index".',
                { code: 'missing_entry_reference' }
            );
        }

        const resolveByIndex = (rawValue, label) => {
            const numeric = Number(rawValue);
            if (!Number.isInteger(numeric) || numeric < 0) {
                throw new ToolVisibleError(
                    `editChatLogEntry "${label}" must be a zero-based non-negative integer.`,
                    { code: 'invalid_entry_index' }
                );
            }
            if (numeric >= chatHistory.length || !chatHistory[numeric]) {
                throw new ToolVisibleError(
                    `No chat log entry exists at zero-based index ${numeric}.`,
                    { code: 'entry_not_found' }
                );
            }
            return numeric;
        };

        const resolveByEntry = (rawValue) => {
            const reference = String(rawValue).trim();
            const byId = chatHistory.findIndex(candidate => (
                candidate && typeof candidate.id === 'string' && candidate.id === reference
            ));
            if (byId !== -1) {
                return byId;
            }
            const byTimestamp = chatHistory.findIndex(candidate => (
                candidate && typeof candidate.timestamp === 'string' && candidate.timestamp === reference
            ));
            if (byTimestamp !== -1) {
                return byTimestamp;
            }
            if (/^\d+$/.test(reference)) {
                return resolveByIndex(Number(reference), 'entry');
            }
            throw new ToolVisibleError(
                `Chat log entry "${reference}" was not found by id, timestamp, or zero-based index.`,
                { code: 'entry_not_found' }
            );
        };

        const resolvedFromEntry = hasEntryReference ? resolveByEntry(entry) : null;
        const resolvedFromIndex = hasIndexReference ? resolveByIndex(index, 'index') : null;
        if (
            resolvedFromEntry !== null
            && resolvedFromIndex !== null
            && resolvedFromEntry !== resolvedFromIndex
        ) {
            throw new ToolVisibleError(
                `editChatLogEntry entry and index refer to different chat log entries (${resolvedFromEntry} vs ${resolvedFromIndex}).`,
                { code: 'conflicting_entry_reference' }
            );
        }
        return resolvedFromIndex !== null ? resolvedFromIndex : resolvedFromEntry;
    };

    const executeRegexReplaceTool = ({ pattern, replacement, flags = 'g', scope = '' } = {}) => {
        const result = applyRegexReplace({
            pattern,
            replacement,
            flags,
            scope,
            chatHistory: getMutableChatHistory('regexReplace'),
            players: Player.getAll(),
            locations: Location.getAll(),
            things: Thing.getAll()
        });
        const lines = [
            '<regexReplaceResult>',
            '  <status>success</status>',
            `  <totalReplacements>${result.totalReplacements}</totalReplacements>`,
            `  <modifiedTextValues>${result.modifiedTextValues}</modifiedTextValues>`,
            `  <modifiedMessages>${result.modifiedChatEntries}</modifiedMessages>`,
            `  <modifiedMemories>${result.modifiedMemories}</modifiedMemories>`,
            `  <modifiedNpcFields>${result.modifiedNpcFields}</modifiedNpcFields>`,
            `  <modifiedLocationFields>${result.modifiedLocationFields}</modifiedLocationFields>`,
            `  <modifiedItemFields>${result.modifiedItemFields}</modifiedItemFields>`
        ];
        if (result.scope) {
            lines.push(`  <scope>${xmlEscapeText(result.scope)}</scope>`);
        }
        lines.push('</regexReplaceResult>');
        return {
            content: lines.join('\n'),
            metadata: {
                status: 'success',
                ...result
            }
        };
    };

    const executeEditChatLogEntryTool = ({ entry = null, index = null, content, reason = null } = {}) => {
        if (typeof content !== 'string' || !content.trim()) {
            throw new ToolVisibleError(
                'editChatLogEntry requires non-empty replacement content.',
                { code: 'invalid_content' }
            );
        }

        const chatHistory = getMutableChatHistory('editChatLogEntry');
        const resolvedIndex = resolveChatLogEntryIndex({ entry, index });
        const target = chatHistory[resolvedIndex];
        if (!target || typeof target !== 'object') {
            throw new ToolVisibleError(
                `No chat log entry exists at zero-based index ${resolvedIndex}.`,
                { code: 'entry_not_found' }
            );
        }

        const editResult = applyPlainTextChatLogEdit(target, content);
        target.lastEditedAt = new Date().toISOString();
        if (typeof target.timestamp !== 'string' || !target.timestamp.trim()) {
            target.timestamp = new Date().toISOString();
        }

        const entryId = typeof target.id === 'string' && target.id.trim() ? target.id.trim() : null;
        const timestamp = typeof target.timestamp === 'string' && target.timestamp.trim() ? target.timestamp.trim() : null;
        const entryType = typeof target.type === 'string' && target.type.trim() ? target.type.trim() : null;
        const role = typeof target.role === 'string' && target.role.trim() ? target.role.trim() : null;
        const safeReason = toTrimmedString(reason) || null;

        const lines = [
            '<editChatLogEntryResult>',
            `  <status>success</status>`,
            `  <index>${resolvedIndex}</index>`
        ];
        if (entryId) {
            lines.push(`  <id>${xmlEscapeText(entryId)}</id>`);
        }
        if (timestamp) {
            lines.push(`  <timestamp>${xmlEscapeText(timestamp)}</timestamp>`);
        }
        if (entryType) {
            lines.push(`  <type>${xmlEscapeText(entryType)}</type>`);
        }
        if (role) {
            lines.push(`  <role>${xmlEscapeText(role)}</role>`);
        }
        if (safeReason) {
            lines.push(`  <reason>${xmlEscapeText(safeReason)}</reason>`);
        }
        lines.push(
            `  <oldContentPreview>${xmlEscapeText(truncateToolPreview(editResult.oldContent))}</oldContentPreview>`,
            `  <newContentPreview>${xmlEscapeText(truncateToolPreview(content))}</newContentPreview>`,
            '</editChatLogEntryResult>'
        );

        return {
            content: lines.join('\n'),
            metadata: {
                status: 'success',
                entryId,
                timestamp,
                type: entryType,
                role,
                index: resolvedIndex,
                oldContentLength: editResult.oldContent.length,
                newContentLength: content.length,
                replacedStructuredDisplay: editResult.replacedStructuredDisplay,
                reason: safeReason
            }
        };
    };

    const executeRerunSceneSummaryTool = async ({ sceneNumber, reason = null } = {}) => {
        const normalizedSceneNumber = normalizeRequiredPositiveInteger(
            sceneNumber,
            'sceneNumber',
            'rerunSceneSummary'
        );
        if (typeof summarizeScenesForHistoryRange !== 'function') {
            throw new ToolVisibleError(
                'Scene summary rerun is unavailable in this runtime.',
                { code: 'scene_summary_rerun_unavailable' }
            );
        }

        const scenes = getOrderedSceneSummaries();
        if (scenes.length === 0) {
            throw new ToolVisibleError(
                'No scene summaries are stored.',
                { code: 'scene_summary_not_found' }
            );
        }
        if (normalizedSceneNumber > scenes.length) {
            throw new ToolVisibleError(
                `Scene summary ${normalizedSceneNumber} is out of range; stored scenes: ${scenes.length}.`,
                { code: 'scene_summary_not_found' }
            );
        }

        const scene = scenes[normalizedSceneNumber - 1];
        const startIndex = Number(scene?.startIndex);
        const endIndex = Number(scene?.endIndex);
        if (!Number.isInteger(startIndex) || startIndex <= 0) {
            throw new ToolVisibleError(
                `Scene summary ${normalizedSceneNumber} has an invalid startIndex.`,
                { code: 'invalid_scene_summary_range' }
            );
        }
        if (!Number.isInteger(endIndex) || endIndex < startIndex) {
            throw new ToolVisibleError(
                `Scene summary ${normalizedSceneNumber} has an invalid endIndex.`,
                { code: 'invalid_scene_summary_range' }
            );
        }

        const chatHistory = getMutableChatHistory('rerunSceneSummary');
        const summaryResult = await summarizeScenesForHistoryRange({
            chatHistory,
            startIndex,
            endIndex,
            redo: true
        });
        if (!summaryResult || typeof summaryResult !== 'object') {
            throw new ToolVisibleError(
                'Scene summary rerun returned no result.',
                { code: 'scene_summary_rerun_failed' }
            );
        }

        const persisted = typeof persistSceneSummaries === 'function'
            ? Boolean(await persistSceneSummaries())
            : false;
        const safeReason = toTrimmedString(reason) || null;
        const rerunRange = summaryResult.range && typeof summaryResult.range === 'object'
            ? summaryResult.range
            : {};
        const summarizedRange = summaryResult.summarizedRange && typeof summaryResult.summarizedRange === 'object'
            ? summaryResult.summarizedRange
            : {};
        const sceneCount = Array.isArray(summaryResult.scenes) ? summaryResult.scenes.length : 0;
        const nullableInteger = (value) => {
            if (value === null || value === undefined || value === '') {
                return null;
            }
            const numeric = Number(value);
            return Number.isInteger(numeric) ? numeric : null;
        };

        const lines = [
            '<rerunSceneSummaryResult>',
            `  <status>success</status>`,
            `  <sceneNumber>${normalizedSceneNumber}</sceneNumber>`,
            `  <originalRange start="${xmlEscapeAttribute(startIndex)}" end="${xmlEscapeAttribute(endIndex)}"/>`,
            `  <rerunRange start="${xmlEscapeAttribute(rerunRange.start ?? '')}" end="${xmlEscapeAttribute(rerunRange.end ?? '')}"/>`,
            `  <summarizedRange start="${xmlEscapeAttribute(summarizedRange.start ?? '')}" end="${xmlEscapeAttribute(summarizedRange.end ?? '')}"/>`,
            `  <sceneCount>${sceneCount}</sceneCount>`,
            `  <persisted>${persisted ? 'true' : 'false'}</persisted>`
        ];
        if (safeReason) {
            lines.push(`  <reason>${xmlEscapeText(safeReason)}</reason>`);
        }
        lines.push('</rerunSceneSummaryResult>');

        return {
            content: lines.join('\n'),
            metadata: {
                status: 'success',
                sceneNumber: normalizedSceneNumber,
                originalRange: { start: startIndex, end: endIndex },
                rerunRange: {
                    start: nullableInteger(rerunRange.start),
                    end: nullableInteger(rerunRange.end)
                },
                summarizedRange: {
                    start: nullableInteger(summarizedRange.start),
                    end: nullableInteger(summarizedRange.end)
                },
                sceneCount,
                persisted,
                reason: safeReason
            }
        };
    };

    const executeEditSceneSummaryTool = async ({
        sceneNumber,
        summary,
        details = null,
        quotes = null,
        reason = null
    } = {}) => {
        const normalizedSceneNumber = normalizeRequiredPositiveInteger(
            sceneNumber,
            'sceneNumber',
            'editSceneSummary'
        );
        const replacementSummary = normalizeRequiredString(summary, {
            functionName: 'editSceneSummary',
            fieldName: 'summary'
        });

        const sceneSummaries = typeof getSceneSummaries === 'function'
            ? getSceneSummaries()
            : null;
        if (!sceneSummaries || typeof sceneSummaries.getScenesInOrder !== 'function') {
            throw new ToolVisibleError(
                'Scene summaries are unavailable for editSceneSummary.',
                { code: 'scene_summaries_unavailable' }
            );
        }
        if (typeof sceneSummaries.updateSceneAtDisplayIndex !== 'function') {
            throw new ToolVisibleError(
                'Scene summaries cannot be edited in this runtime.',
                { code: 'scene_summary_edit_unavailable' }
            );
        }

        const scenes = sceneSummaries.getScenesInOrder();
        if (!Array.isArray(scenes) || scenes.length === 0) {
            throw new ToolVisibleError(
                'No scene summaries are stored.',
                { code: 'scene_summary_not_found' }
            );
        }
        if (normalizedSceneNumber > scenes.length) {
            throw new ToolVisibleError(
                `Scene summary ${normalizedSceneNumber} is out of range; stored scenes: ${scenes.length}.`,
                { code: 'scene_summary_not_found' }
            );
        }

        const updates = {
            summary: replacementSummary,
            details: normalizeSceneSummaryDetailsForTool(details),
            quotes: normalizeSceneSummaryQuotesForTool(quotes)
        };
        const updatedScene = sceneSummaries.updateSceneAtDisplayIndex(normalizedSceneNumber, updates);
        const persisted = typeof persistSceneSummaries === 'function'
            ? Boolean(await persistSceneSummaries())
            : false;
        const safeReason = toTrimmedString(reason) || null;

        const lines = [
            '<editSceneSummaryResult>',
            `  <status>success</status>`,
            `  <sceneNumber>${normalizedSceneNumber}</sceneNumber>`,
            `  <persisted>${persisted ? 'true' : 'false'}</persisted>`,
            `  <summary>${xmlEscapeText(replacementSummary)}</summary>`,
            `  <detailCount>${updates.details.length}</detailCount>`,
            `  <quoteCount>${updates.quotes.length}</quoteCount>`
        ];
        if (safeReason) {
            lines.push(`  <reason>${xmlEscapeText(safeReason)}</reason>`);
        }
        lines.push('</editSceneSummaryResult>');

        return {
            content: lines.join('\n'),
            metadata: {
                status: 'success',
                sceneNumber: normalizedSceneNumber,
                persisted,
                updatedScene,
                reason: safeReason
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

    const executeDeleteThingTool = async (args = {}, { requestUserInputHandler = null } = {}) => {
        const functionName = 'deleteThing';
        const target = resolveUpdateObjectTarget('thing', args.thing, { functionName });
        const targetThing = target.record;
        const thingId = getRecordId(targetThing) || target.id;
        const thingName = getRecordName(targetThing) || target.name || args.thing;
        const thingType = toTrimmedString(targetThing?.thingType).toLowerCase();
        if (!thingId) {
            throw new ToolVisibleError(
                `deleteThing could not resolve a stable id for "${thingName || args.thing}".`,
                { code: 'invalid_target' }
            );
        }
        if (!['item', 'scenery'].includes(thingType)) {
            throw new ToolVisibleError(
                `deleteThing can only delete items or scenery; "${thingName || thingId}" is "${thingType || 'unknown'}".`,
                { code: 'invalid_target' }
            );
        }
        if (typeof deleteThingById !== 'function') {
            throw new ToolVisibleError(
                'deleteThing is unavailable in this prompt.',
                { code: 'thing_deletion_unavailable' }
            );
        }

        const handler = typeof requestUserInputHandler === 'function'
            ? requestUserInputHandler
            : (typeof requestUserInput === 'function' ? requestUserInput : null);
        if (!handler) {
            throw new ToolVisibleError(
                'deleteThing requires active client confirmation before deleting.',
                { code: 'user_confirmation_unavailable' }
            );
        }

        let confirmation = null;
        const readableType = thingType === 'scenery' ? 'scenery' : 'item';
        try {
            confirmation = await handler({
                mode: 'confirmation',
                title: 'Delete Thing',
                question: `Delete ${readableType} "${thingName || thingId}"? This cannot be undone.`,
                confirmLabel: 'Delete Thing',
                cancelLabel: 'Cancel'
            });
        } catch (error) {
            throw new ToolVisibleError(
                error?.message || 'The player did not confirm deletion.',
                { code: toTrimmedString(error?.code) || 'user_confirmation_unavailable' }
            );
        }

        if (!confirmation || confirmation.confirmed !== true) {
            throw new ToolVisibleError(
                `The player cancelled deletion of "${thingName || thingId}".`,
                { code: 'thing_deletion_cancelled' }
            );
        }

        let deleteResult = null;
        try {
            deleteResult = deleteThingById(thingId);
        } catch (error) {
            throw new ToolVisibleError(
                error?.message || `Failed to delete "${thingName || thingId}".`,
                { code: 'thing_deletion_failed' }
            );
        }

        if (!deleteResult || deleteResult.success !== true) {
            throw new ToolVisibleError(
                deleteResult?.error || `Failed to delete "${thingName || thingId}".`,
                {
                    code: deleteResult?.status === 409
                        ? 'thing_deletion_conflict'
                        : 'thing_deletion_failed'
                }
            );
        }

        const affectedLocationIds = Array.isArray(deleteResult.locationIds) ? deleteResult.locationIds : [];
        const affectedPlayerIds = Array.isArray(deleteResult.playerIds) ? deleteResult.playerIds : [];
        const affectedNpcIds = Array.isArray(deleteResult.npcIds) ? deleteResult.npcIds : [];
        const affectedContainerIds = Array.isArray(deleteResult.containerIds) ? deleteResult.containerIds : [];
        const lines = [
            '<deleteThingResult>',
            '  <status>deleted</status>',
            '  <thing>',
            `    <id>${xmlEscapeText(thingId)}</id>`,
            `    <name>${xmlEscapeText(thingName)}</name>`,
            `    <thingType>${xmlEscapeText(thingType)}</thingType>`,
            '  </thing>',
            ...renderXmlNode('affectedLocationIds', affectedLocationIds, 1),
            ...renderXmlNode('affectedPlayerIds', affectedPlayerIds, 1),
            ...renderXmlNode('affectedNpcIds', affectedNpcIds, 1),
            ...renderXmlNode('affectedContainerIds', affectedContainerIds, 1),
            '</deleteThingResult>'
        ];

        return {
            content: lines.join('\n'),
            metadata: {
                functionName,
                status: 'deleted',
                thingId,
                thingName,
                thingType,
                confirmationRequestId: toTrimmedString(confirmation?.requestId) || null,
                affectedLocationIds,
                affectedPlayerIds,
                affectedNpcIds,
                affectedContainerIds
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

    const buildMysteryBoxUpdateCandidate = (box) => {
        const data = typeof box?.toJSON === 'function' ? box.toJSON() : box;
        return {
            id: toTrimmedString(data?.id) || null,
            name: toTrimmedString(data?.name) || null,
            keys: Array.isArray(data?.keys) ? data.keys.filter(entry => typeof entry === 'string') : [],
            toJSON: serializeUpdateObjectRecord(box)
        };
    };

    const resolveMysteryBoxUpdateTarget = (rawQuery, { functionName } = {}) => {
        const query = normalizeRequiredString(rawQuery, {
            functionName,
            fieldName: 'mysteryBox'
        });
        const exactMatch = MysteryBox.getById(query) || MysteryBox.getByKey(query);
        if (exactMatch) {
            return exactMatch;
        }

        const matches = MysteryBox.findByNameOrKey(query);
        if (!matches.length) {
            throw new ToolVisibleError(
                `No mystery box matches "${query}".`,
                { code: 'mystery_box_not_found' }
            );
        }
        if (matches.length > 1) {
            throw new ToolVisibleError(
                `Multiple mystery boxes match "${query}". Call ${functionName} again with the exact id from one candidate.`,
                {
                    code: 'ambiguous_mystery_box',
                    candidates: matches
                        .map(buildMysteryBoxUpdateCandidate)
                        .sort(candidateSort)
                }
            );
        }
        return matches[0];
    };

    const normalizeMysteryBoxFieldPatch = (box, fieldsObject, { functionName } = {}) => {
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

        const next = {
            name: box.name,
            keys: Array.isArray(box.keys) ? [...box.keys] : [],
            text: box.text
        };
        const updatedFields = [];
        for (const [fieldName, rawValue] of fieldEntries) {
            if (!UPDATE_MYSTERY_BOX_FIELD_SET.has(fieldName)) {
                throw new ToolVisibleError(
                    `${functionName} cannot update field "${fieldName}". Allowed fields: ${UPDATE_MYSTERY_BOX_FIELD_NAMES.join(', ')}.`,
                    {
                        code: 'unsupported_field',
                        details: { fieldName }
                    }
                );
            }

            if (fieldName === 'name') {
                next.name = normalizeCharacterFieldString(rawValue, {
                    functionName,
                    fieldName,
                    requireNonEmpty: true
                });
            } else if (fieldName === 'keys') {
                next.keys = normalizeCharacterFieldArrayOfStrings(rawValue, {
                    functionName,
                    fieldName
                });
            } else if (fieldName === 'text') {
                next.text = normalizeCharacterFieldString(rawValue, {
                    functionName,
                    fieldName,
                    allowNullAsEmpty: false,
                    requireNonEmpty: false
                });
            }
            updatedFields.push(fieldName);
        }

        return { next, updatedFields };
    };

    const executeUpdateMysteryBoxFieldsTool = ({
        mysteryBox,
        fields
    } = {}) => {
        const functionName = 'updateMysteryBoxFields';
        const box = resolveMysteryBoxUpdateTarget(mysteryBox, { functionName });
        const { next, updatedFields } = normalizeMysteryBoxFieldPatch(box, fields, { functionName });
        try {
            box.applyManualEdit(next);
        } catch (error) {
            throw new ToolVisibleError(
                `Failed to update mystery box "${box.name || box.id || mysteryBox}": ${error?.message || error}`,
                { code: 'field_update_failed' }
            );
        }

        const data = box.toJSON();
        const lines = [
            '<updateMysteryBoxFieldsResult>',
            '  <status>success</status>',
            '  <mysteryBox>',
            `    <id>${xmlEscapeText(data.id)}</id>`,
            `    <name>${xmlEscapeText(data.name)}</name>`,
            '  </mysteryBox>',
            '  <updatedFields>',
            ...updatedFields.map(fieldName => `    <field>${xmlEscapeText(fieldName)}</field>`),
            '  </updatedFields>',
            '</updateMysteryBoxFieldsResult>'
        ];
        return {
            content: lines.join('\n'),
            metadata: {
                status: 'success',
                id: data.id,
                name: data.name,
                updatedFields
            }
        };
    };

    const buildMysteryThreadUpdateCandidate = (thread) => {
        const data = typeof thread?.toJSON === 'function' ? thread.toJSON() : thread;
        return {
            id: toTrimmedString(data?.id) || null,
            name: toTrimmedString(data?.name) || null,
            status: toTrimmedString(data?.status) || null,
            keys: Array.isArray(data?.keys) ? data.keys.filter(entry => typeof entry === 'string') : [],
            toJSON: serializeUpdateObjectRecord(thread)
        };
    };

    const resolveMysteryThreadUpdateTarget = (rawQuery, { functionName } = {}) => {
        const query = normalizeRequiredString(rawQuery, {
            functionName,
            fieldName: 'mysteryThread'
        });
        const exactMatch = MysteryThread.getById(query) || MysteryThread.getByKey(query);
        if (exactMatch) {
            return exactMatch;
        }

        const matches = MysteryThread.findByNameOrKey(query);
        if (!matches.length) {
            throw new ToolVisibleError(
                `No mystery thread matches "${query}".`,
                { code: 'mystery_thread_not_found' }
            );
        }
        if (matches.length > 1) {
            throw new ToolVisibleError(
                `Multiple mystery threads match "${query}". Call ${functionName} again with the exact id from one candidate.`,
                {
                    code: 'ambiguous_mystery_thread',
                    candidates: matches
                        .map(buildMysteryThreadUpdateCandidate)
                        .sort(candidateSort)
                }
            );
        }
        return matches[0];
    };

    const normalizeMysteryThreadFieldPatch = (thread, fieldsObject, { functionName } = {}) => {
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

        const next = {
            name: thread.name,
            status: thread.status,
            keys: Array.isArray(thread.keys) ? [...thread.keys] : [],
            summary: thread.summary,
            constraints: Array.isArray(thread.constraints) ? [...thread.constraints] : [],
            boxIds: Array.isArray(thread.boxIds) ? [...thread.boxIds] : []
        };
        const updatedFields = [];
        for (const [fieldName, rawValue] of fieldEntries) {
            if (!UPDATE_MYSTERY_THREAD_FIELD_SET.has(fieldName)) {
                throw new ToolVisibleError(
                    `${functionName} cannot update field "${fieldName}". Allowed fields: ${UPDATE_MYSTERY_THREAD_FIELD_NAMES.join(', ')}.`,
                    {
                        code: 'unsupported_field',
                        details: { fieldName }
                    }
                );
            }

            if (fieldName === 'name') {
                next.name = normalizeCharacterFieldString(rawValue, {
                    functionName,
                    fieldName,
                    requireNonEmpty: true
                });
            } else if (fieldName === 'status') {
                const status = normalizeCharacterFieldString(rawValue, {
                    functionName,
                    fieldName,
                    allowNullAsEmpty: false,
                    requireNonEmpty: true
                });
                if (!['active', 'inactive', 'concluded'].includes(status)) {
                    throw new ToolVisibleError(
                        `${functionName} "status" must be one of: active, inactive, concluded.`,
                        { code: 'invalid_arguments' }
                    );
                }
                next.status = status;
            } else if (fieldName === 'keys') {
                next.keys = normalizeCharacterFieldArrayOfStrings(rawValue, {
                    functionName,
                    fieldName
                });
            } else if (fieldName === 'summary') {
                next.summary = normalizeCharacterFieldString(rawValue, {
                    functionName,
                    fieldName,
                    allowNullAsEmpty: false,
                    requireNonEmpty: false
                });
            } else if (fieldName === 'constraints') {
                next.constraints = normalizeCharacterFieldArrayOfStrings(rawValue, {
                    functionName,
                    fieldName
                });
            }
            updatedFields.push(fieldName);
        }

        return { next, updatedFields };
    };

    const executeUpdateMysteryThreadFieldsTool = ({
        mysteryThread,
        fields
    } = {}) => {
        const functionName = 'updateMysteryThreadFields';
        const thread = resolveMysteryThreadUpdateTarget(mysteryThread, { functionName });
        const { next, updatedFields } = normalizeMysteryThreadFieldPatch(thread, fields, { functionName });
        try {
            thread.applyManualEdit(next);
        } catch (error) {
            throw new ToolVisibleError(
                `Failed to update mystery thread "${thread.name || thread.id || mysteryThread}": ${error?.message || error}`,
                { code: 'field_update_failed' }
            );
        }

        const data = thread.toJSON();
        const lines = [
            '<updateMysteryThreadFieldsResult>',
            '  <status>success</status>',
            '  <mysteryThread>',
            `    <id>${xmlEscapeText(data.id)}</id>`,
            `    <name>${xmlEscapeText(data.name)}</name>`,
            `    <threadStatus>${xmlEscapeText(data.status)}</threadStatus>`,
            '  </mysteryThread>',
            '  <updatedFields>',
            ...updatedFields.map(fieldName => `    <field>${xmlEscapeText(fieldName)}</field>`),
            '  </updatedFields>',
            '</updateMysteryThreadFieldsResult>'
        ];
        return {
            content: lines.join('\n'),
            metadata: {
                status: 'success',
                id: data.id,
                name: data.name,
                threadStatus: data.status,
                updatedFields
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

    const getTrackerCurrentWorldMinute = (functionName) => {
        if (typeof getCurrentWorldMinute !== 'function') {
            throw new Error(`${functionName} requires getCurrentWorldMinute to be configured.`);
        }
        const minute = getCurrentWorldMinute();
        if (!Number.isInteger(minute) || minute < 0) {
            throw new Error(`${functionName} getCurrentWorldMinute must return a non-negative integer.`);
        }
        return minute;
    };

    const formatTrackerUpdatedAt = (worldMinute) => {
        if (typeof formatTrackerLastUpdated === 'function') {
            const formatted = toTrimmedString(formatTrackerLastUpdated(worldMinute));
            if (formatted) {
                return formatted;
            }
        }
        return `${worldMinute} minutes from game start`;
    };

    const formatTrackerCountdown = (worldMinute) => {
        if (typeof formatTrackerCountdownValue === 'function') {
            const formatted = toTrimmedString(formatTrackerCountdownValue(worldMinute));
            if (formatted) {
                return formatted;
            }
        }
        return '';
    };

    const buildTrackerCandidate = (tracker) => {
        const data = typeof tracker?.toJSON === 'function' ? tracker.toJSON() : tracker;
        return {
            id: toTrimmedString(data?.id) || null,
            name: toTrimmedString(data?.name) || null,
            type: toTrimmedString(data?.type) || null,
            value: toTrimmedString(data?.value) || null,
            hiddenFromPlayer: data?.hiddenFromPlayer === true,
            countdownUntilWorldMinute: Number.isInteger(data?.countdownUntilWorldMinute)
                ? data.countdownUntilWorldMinute
                : null,
            toJSON: serializeUpdateObjectRecord(tracker)
        };
    };

    const resolveTrackerTarget = (rawQuery, { functionName } = {}) => {
        const query = normalizeRequiredString(rawQuery, {
            functionName,
            fieldName: 'tracker'
        });
        const exactMatch = Tracker.getById(query);
        if (exactMatch) {
            return exactMatch;
        }

        const matches = Tracker.findByNameOrKey(query);
        if (!matches.length) {
            throw new ToolVisibleError(
                `No tracker matches "${query}".`,
                { code: 'tracker_not_found' }
            );
        }
        if (matches.length > 1) {
            throw new ToolVisibleError(
                `Multiple trackers match "${query}". Call ${functionName} again with the exact id from one candidate.`,
                {
                    code: 'ambiguous_tracker',
                    candidates: matches
                        .map(buildTrackerCandidate)
                        .sort(candidateSort)
                }
            );
        }
        return matches[0];
    };

    const buildTrackerResultLines = (resultTag, tracker) => {
        const data = tracker.toClientJSON({
            formatLastUpdated: formatTrackerUpdatedAt,
            formatCountdownValue: formatTrackerCountdown
        });
        data.note = typeof tracker?.note === 'string' ? tracker.note : '';
        return {
            data,
            lines: [
                `<${resultTag}>`,
                '  <status>success</status>',
                '  <tracker>',
                `    <id>${xmlEscapeText(data.id)}</id>`,
                `    <name>${xmlEscapeText(data.name)}</name>`,
                `    <type>${xmlEscapeText(data.type)}</type>`,
                `    <value>${xmlEscapeText(data.value)}</value>`,
                `    <hiddenFromPlayer>${data.hiddenFromPlayer === true}</hiddenFromPlayer>`,
                `    <lastUpdated>${xmlEscapeText(data.lastUpdated)}</lastUpdated>`,
                `    <lastUpdatedWorldMinute>${data.lastUpdatedWorldMinute}</lastUpdatedWorldMinute>`,
                `    <note>${xmlEscapeText(data.note)}</note>`,
                data.countdownUntilWorldMinute === null || data.countdownUntilWorldMinute === undefined
                    ? ''
                    : `    <countdownUntilWorldMinute>${data.countdownUntilWorldMinute}</countdownUntilWorldMinute>`,
                '  </tracker>',
                `</${resultTag}>`
            ].filter(line => line !== '')
        };
    };

    const buildBatchItemError = (functionName, error) => {
        const visibleError = error instanceof ToolVisibleError
            ? error
            : new ToolVisibleError(
                error?.message || `${functionName} item failed.`,
                { code: 'tool_execution_error' }
            );
        return {
            status: 'error',
            code: visibleError.code,
            message: visibleError.message,
            candidates: Array.isArray(visibleError.candidates) ? visibleError.candidates : []
        };
    };

    const executeBatchToolItems = ({ functionName, resultTag, items, executeItem }) => {
        if (!Array.isArray(items)) {
            throw new ToolVisibleError(
                `${functionName} "items" must be a non-empty array when provided.`,
                { code: 'invalid_arguments' }
            );
        }
        if (!items.length) {
            throw new ToolVisibleError(
                `${functionName} "items" must include at least one item.`,
                { code: 'invalid_arguments' }
            );
        }
        if (typeof executeItem !== 'function') {
            throw new Error(`${functionName} batch executor is not configured.`);
        }

        const itemResults = [];
        for (let index = 0; index < items.length; index += 1) {
            const item = items[index];
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                itemResults.push({
                    index,
                    status: 'error',
                    code: 'invalid_arguments',
                    message: `${functionName} item ${index + 1} must be an object.`,
                    candidates: []
                });
                continue;
            }

            try {
                const result = executeItem(item);
                const metadata = result?.metadata && typeof result.metadata === 'object'
                    ? result.metadata
                    : {};
                itemResults.push({
                    index,
                    ...metadata,
                    status: 'success'
                });
            } catch (error) {
                itemResults.push({
                    index,
                    ...buildBatchItemError(functionName, error)
                });
            }
        }

        const successCount = itemResults.filter(item => item.status === 'success').length;
        const failureCount = itemResults.length - successCount;
        const status = failureCount
            ? (successCount ? 'partial_success' : 'failed')
            : 'success';
        const lines = [
            `<${resultTag}>`,
            `  <status>${xmlEscapeText(status)}</status>`,
            `  <successCount>${successCount}</successCount>`,
            `  <failureCount>${failureCount}</failureCount>`,
            '  <items>'
        ];
        for (const itemResult of itemResults) {
            lines.push(...renderXmlNode('item', itemResult, 2, {
                index: itemResult.index,
                status: itemResult.status
            }));
        }
        lines.push('  </items>');
        lines.push(`</${resultTag}>`);

        return {
            content: lines.join('\n'),
            metadata: {
                status,
                successCount,
                failureCount,
                items: itemResults
            }
        };
    };

    const normalizeToolRelationshipLabel = (value, { functionName, fieldName, required = true } = {}) => {
        if (!required && (value === null || value === undefined || value === '')) {
            return null;
        }
        const normalized = normalizeRequiredString(value, { functionName, fieldName });
        if (normalized.split(/\s+/).length > RELATIONSHIP_LABEL_MAX_WORDS) {
            throw new ToolVisibleError(
                `${functionName} "${fieldName}" must be ${RELATIONSHIP_LABEL_MAX_WORDS_TEXT} words or fewer.`,
                { code: 'invalid_relationship' }
            );
        }
        return normalized;
    };

    const buildRelationshipCharacterSummary = (character) => ({
        id: normalizeOptionalString(character?.id),
        name: normalizeOptionalString(character?.name)
    });

    const isCurrentPlayerRelationshipCharacter = (character, summary, currentPlayer) => {
        if (!character) {
            return false;
        }
        if (currentPlayer && character === currentPlayer) {
            return true;
        }
        const currentPlayerId = normalizeOptionalString(currentPlayer?.id);
        const characterId = normalizeOptionalString(summary?.id || character?.id);
        if (currentPlayerId && characterId) {
            return currentPlayerId === characterId;
        }
        return !currentPlayerId && character?.isNPC === false;
    };

    const assertRelationshipCharactersExcludeCurrentPlayer = ({
        sourceCharacter,
        targetCharacter,
        sourceSummary,
        targetSummary
    }) => {
        const currentPlayer = getCurrentPlayer();
        if (
            isCurrentPlayerRelationshipCharacter(sourceCharacter, sourceSummary, currentPlayer)
            || isCurrentPlayerRelationshipCharacter(targetCharacter, targetSummary, currentPlayer)
        ) {
            throw new ToolVisibleError(
                'setRelationship cannot involve the current player; both characterA and characterB must be non-player characters.',
                { code: 'invalid_relationship' }
            );
        }
    };

    const executeSingleSetRelationshipTool = ({
        action = null,
        characterA,
        characterB,
        relationship,
        reciprocalRelationship = null
    } = {}, {
        allowRelationshipRemoval = false
    } = {}) => {
        const functionName = 'setRelationship';
        const normalizedAction = (normalizeOptionalString(action) || 'set').toLowerCase();
        if (!['add', 'update', 'set', 'remove', 'delete'].includes(normalizedAction)) {
            throw new ToolVisibleError(
                'setRelationship "action" must be add, update, set, remove, or delete when provided.',
                { code: 'invalid_relationship' }
            );
        }
        const shouldRemoveRelationship = normalizedAction === 'remove' || normalizedAction === 'delete';
        if (shouldRemoveRelationship && allowRelationshipRemoval !== true) {
            throw new ToolVisibleError(
                'setRelationship action "remove" is only available to parser-driven housekeeping.',
                { code: 'unsupported_relationship_action' }
            );
        }
        const characterAQuery = normalizeRequiredString(characterA, {
            functionName,
            fieldName: 'characterA'
        });
        const characterBQuery = normalizeRequiredString(characterB, {
            functionName,
            fieldName: 'characterB'
        });
        const relationshipLabel = shouldRemoveRelationship
            ? null
            : normalizeToolRelationshipLabel(relationship, {
                functionName,
                fieldName: 'relationship'
            });
        const reciprocalRelationshipLabel = shouldRemoveRelationship
            ? null
            : normalizeToolRelationshipLabel(reciprocalRelationship, {
                functionName,
                fieldName: 'reciprocalRelationship',
                required: false
            });

        const sourceCharacter = resolveCharacterReference(characterAQuery, { fieldName: 'characterA' });
        const targetCharacter = resolveCharacterReference(characterBQuery, { fieldName: 'characterB' });
        const sourceSummary = buildRelationshipCharacterSummary(sourceCharacter);
        const targetSummary = buildRelationshipCharacterSummary(targetCharacter);

        assertRelationshipCharactersExcludeCurrentPlayer({
            sourceCharacter,
            targetCharacter,
            sourceSummary,
            targetSummary
        });

        if (sourceSummary.id && targetSummary.id && sourceSummary.id === targetSummary.id) {
            throw new ToolVisibleError(
                'setRelationship requires two different characters.',
                { code: 'invalid_relationship' }
            );
        }
        if (shouldRemoveRelationship && typeof sourceCharacter?.removeRelationship !== 'function') {
            throw new ToolVisibleError(
                `setRelationship cannot remove relationships on "${sourceSummary.name || characterAQuery}".`,
                { code: 'unsupported_field' }
            );
        }
        if (!shouldRemoveRelationship && typeof sourceCharacter?.setRelationship !== 'function') {
            throw new ToolVisibleError(
                `setRelationship cannot update relationships on "${sourceSummary.name || characterAQuery}".`,
                { code: 'unsupported_field' }
            );
        }
        if (reciprocalRelationshipLabel !== null && typeof targetCharacter?.setRelationship !== 'function') {
            throw new ToolVisibleError(
                `setRelationship cannot update reciprocal relationships on "${targetSummary.name || characterBQuery}".`,
                { code: 'unsupported_field' }
            );
        }

        const previousRelationship = typeof sourceCharacter?.getRelationship === 'function'
            ? normalizeOptionalString(sourceCharacter.getRelationship(targetCharacter))
            : null;
        const previousReciprocalRelationship = reciprocalRelationshipLabel !== null
            && typeof targetCharacter?.getRelationship === 'function'
            ? normalizeOptionalString(targetCharacter.getRelationship(sourceCharacter))
            : null;
        let storedRelationship;
        let storedReciprocalRelationship = null;
        if (shouldRemoveRelationship) {
            if (!previousRelationship) {
                throw new ToolVisibleError(
                    `No relationship from "${sourceSummary.name || characterAQuery}" to "${targetSummary.name || characterBQuery}" exists to remove.`,
                    { code: 'relationship_not_found' }
                );
            }
            try {
                sourceCharacter.removeRelationship(targetCharacter);
                storedRelationship = null;
            } catch (error) {
                throw new ToolVisibleError(
                    `Failed to remove relationship from "${sourceSummary.name || characterAQuery}" to "${targetSummary.name || characterBQuery}": ${error?.message || error}`,
                    { code: 'invalid_relationship' }
                );
            }
        } else {
            try {
                storedRelationship = sourceCharacter.setRelationship(targetCharacter, relationshipLabel);
                if (reciprocalRelationshipLabel !== null) {
                    storedReciprocalRelationship = targetCharacter.setRelationship(sourceCharacter, reciprocalRelationshipLabel);
                }
            } catch (error) {
                throw new ToolVisibleError(
                    `Failed to set relationship between "${sourceSummary.name || characterAQuery}" and "${targetSummary.name || characterBQuery}": ${error?.message || error}`,
                    { code: 'invalid_relationship' }
                );
            }
        }

        const lines = [
            '<setRelationshipResult>',
            '  <status>success</status>',
            '  <characterA>',
            `    <id>${xmlEscapeText(sourceSummary.id || '')}</id>`,
            `    <name>${xmlEscapeText(sourceSummary.name || '')}</name>`,
            '  </characterA>',
            '  <characterB>',
            `    <id>${xmlEscapeText(targetSummary.id || '')}</id>`,
            `    <name>${xmlEscapeText(targetSummary.name || '')}</name>`,
            '  </characterB>',
            `  <relationship>${xmlEscapeText(storedRelationship || '')}</relationship>`,
            `  <relationshipAction>${shouldRemoveRelationship ? 'deleted' : (previousRelationship ? 'updated' : 'added')}</relationshipAction>`
        ];
        if (storedReciprocalRelationship !== null) {
            lines.push(`  <reciprocalRelationship>${xmlEscapeText(storedReciprocalRelationship)}</reciprocalRelationship>`);
        }
        lines.push('</setRelationshipResult>');

        return {
            content: lines.join('\n'),
            metadata: {
                status: 'success',
                characterA: sourceSummary,
                characterB: targetSummary,
                previousRelationship,
                relationship: storedRelationship,
                relationshipAction: shouldRemoveRelationship ? 'deleted' : (previousRelationship ? 'updated' : 'added'),
                previousReciprocalRelationship,
                reciprocalRelationship: storedReciprocalRelationship,
                reciprocalRelationshipAction: storedReciprocalRelationship !== null
                    ? (previousReciprocalRelationship ? 'updated' : 'added')
                    : null
            }
        };
    };

    const executeSetRelationshipTool = (args = {}, options = {}) => {
        if (Object.prototype.hasOwnProperty.call(args || {}, 'items')) {
            return executeBatchToolItems({
                functionName: 'setRelationship',
                resultTag: 'setRelationshipBatchResult',
                items: args.items,
                executeItem: item => executeSingleSetRelationshipTool(item, options)
            });
        }
        return executeSingleSetRelationshipTool(args, options);
    };

    const executeSingleAddTrackerTool = ({
        name,
        type,
        value,
        hiddenFromPlayer = false,
        description,
        note
    } = {}) => {
        const functionName = 'addTracker';
        const normalizedName = normalizeRequiredString(name, { functionName, fieldName: 'name' });
        const normalizedType = normalizeRequiredString(type, { functionName, fieldName: 'type' });
        const normalizedValue = normalizeRequiredString(value, { functionName, fieldName: 'value' });
        const normalizedDescription = normalizeRequiredString(description, { functionName, fieldName: 'description' });
        const normalizedNote = normalizeOptionalString(note) || '';
        const normalizedHidden = normalizeOptionalBoolean(hiddenFromPlayer, {
            functionName,
            fieldName: 'hiddenFromPlayer'
        }) === true;
        const worldMinute = getTrackerCurrentWorldMinute(functionName);

        let tracker = null;
        try {
            tracker = new Tracker({
                name: normalizedName,
                type: normalizedType,
                value: normalizedValue,
                hiddenFromPlayer: normalizedHidden,
                lastUpdatedWorldMinute: worldMinute,
                deriveCountdownUntilWorldMinute: normalizedType === 'countdown',
                description: normalizedDescription,
                note: normalizedNote
            });
        } catch (error) {
            throw new ToolVisibleError(
                `Failed to add tracker: ${error?.message || error}`,
                { code: 'invalid_tracker' }
            );
        }

        const { data, lines } = buildTrackerResultLines('addTrackerResult', tracker);
        return {
            content: lines.join('\n'),
            metadata: {
                status: 'success',
                id: data.id,
                name: data.name,
                type: data.type,
                value: data.value,
                hiddenFromPlayer: data.hiddenFromPlayer === true,
                lastUpdated: data.lastUpdated,
                lastUpdatedWorldMinute: data.lastUpdatedWorldMinute,
                countdownUntilWorldMinute: data.countdownUntilWorldMinute,
                note: data.note
            }
        };
    };

    const executeAddTrackerTool = (args = {}) => {
        if (Object.prototype.hasOwnProperty.call(args || {}, 'items')) {
            return executeBatchToolItems({
                functionName: 'addTracker',
                resultTag: 'addTrackerBatchResult',
                items: args.items,
                executeItem: executeSingleAddTrackerTool
            });
        }
        return executeSingleAddTrackerTool(args);
    };

    const executeSingleUpdateTrackerTool = ({ tracker, value, note } = {}) => {
        const functionName = 'updateTracker';
        const target = resolveTrackerTarget(tracker, { functionName });
        const normalizedValue = normalizeRequiredString(value, { functionName, fieldName: 'value' });
        const hasNote = note !== undefined;
        const normalizedNote = hasNote ? normalizeOptionalString(note) || '' : null;
        const worldMinute = getTrackerCurrentWorldMinute(functionName);
        try {
            target.updateValue(normalizedValue, {
                worldMinute,
                ...(hasNote ? { note: normalizedNote } : {})
            });
        } catch (error) {
            throw new ToolVisibleError(
                `Failed to update tracker "${target.name || target.id || tracker}": ${error?.message || error}`,
                { code: 'invalid_tracker_value' }
            );
        }

        const { data, lines } = buildTrackerResultLines('updateTrackerResult', target);
        return {
            content: lines.join('\n'),
            metadata: {
                status: 'success',
                id: data.id,
                name: data.name,
                type: data.type,
                value: data.value,
                hiddenFromPlayer: data.hiddenFromPlayer === true,
                lastUpdated: data.lastUpdated,
                lastUpdatedWorldMinute: data.lastUpdatedWorldMinute,
                countdownUntilWorldMinute: data.countdownUntilWorldMinute,
                note: data.note
            }
        };
    };

    const executeUpdateTrackerTool = (args = {}) => {
        if (Object.prototype.hasOwnProperty.call(args || {}, 'items')) {
            return executeBatchToolItems({
                functionName: 'updateTracker',
                resultTag: 'updateTrackerBatchResult',
                items: args.items,
                executeItem: executeSingleUpdateTrackerTool
            });
        }
        return executeSingleUpdateTrackerTool(args);
    };

    const executeSingleRemoveTrackerTool = ({ tracker } = {}) => {
        const functionName = 'removeTracker';
        const target = resolveTrackerTarget(tracker, { functionName });
        const removed = Tracker.removeById(target.id);
        if (!removed) {
            throw new Error(`Tracker "${target.id}" disappeared during removeTracker.`);
        }
        const data = typeof removed.toClientJSON === 'function'
            ? removed.toClientJSON({
                formatLastUpdated: formatTrackerUpdatedAt,
                formatCountdownValue: formatTrackerCountdown
            })
            : buildTrackerCandidate(removed);
        const lines = [
            '<removeTrackerResult>',
            '  <status>success</status>',
            '  <tracker>',
            `    <id>${xmlEscapeText(data.id)}</id>`,
            `    <name>${xmlEscapeText(data.name)}</name>`,
            '  </tracker>',
            '</removeTrackerResult>'
        ];
        return {
            content: lines.join('\n'),
            metadata: {
                status: 'success',
                id: data.id,
                name: data.name,
                type: data.type,
                value: data.value,
                hiddenFromPlayer: data.hiddenFromPlayer === true,
                lastUpdated: data.lastUpdated,
                lastUpdatedWorldMinute: data.lastUpdatedWorldMinute,
                countdownUntilWorldMinute: data.countdownUntilWorldMinute,
                note: data.note
            }
        };
    };

    const executeRemoveTrackerTool = (args = {}) => {
        if (Object.prototype.hasOwnProperty.call(args || {}, 'items')) {
            return executeBatchToolItems({
                functionName: 'removeTracker',
                resultTag: 'removeTrackerBatchResult',
                items: args.items,
                executeItem: executeSingleRemoveTrackerTool
            });
        }
        return executeSingleRemoveTrackerTool(args);
    };

    const executeCreateQuestTool = async ({ summary, giver = null } = {}, { promptStream = null } = {}) => {
        const functionName = 'createQuest';
        if (typeof createQuestFromEvent !== 'function') {
            throw new Error('createQuest handler is not configured.');
        }

        const normalizedSummary = normalizeRequiredString(summary, {
            functionName,
            fieldName: 'summary'
        });
        const normalizedGiver = normalizeOptionalString(giver);
        const request = { summary: normalizedSummary };
        if (normalizedGiver) {
            request.giver = normalizedGiver;
        }
        if (promptStream) {
            request.stream = promptStream;
        }

        const result = await createQuestFromEvent(request);
        if (!result || typeof result !== 'object') {
            throw new Error('createQuest handler must return quest creation details.');
        }

        const questsAwarded = Array.isArray(result.questsAwarded)
            ? result.questsAwarded
            : [];
        const updatedQuests = Array.isArray(result.updatedQuests)
            ? result.updatedQuests
            : [];
        const declinedQuests = Array.isArray(result.declinedQuests)
            ? result.declinedQuests
            : [];
        const status = questsAwarded.length || updatedQuests.length
            ? 'success'
            : declinedQuests.length
                ? 'declined'
                : 'not_created';
        const lines = [
            '<createQuestResult>',
            `  <status>${xmlEscapeText(status)}</status>`,
            '  <questsAwarded>'
        ];
        for (const quest of questsAwarded) {
            lines.push('    <quest>');
            lines.push(`      <id>${xmlEscapeText(toTrimmedString(quest?.id))}</id>`);
            lines.push(`      <name>${xmlEscapeText(toTrimmedString(quest?.name))}</name>`);
            if (toTrimmedString(quest?.summary)) {
                lines.push(`      <summary>${xmlEscapeText(toTrimmedString(quest.summary))}</summary>`);
            }
            if (toTrimmedString(quest?.giver)) {
                lines.push(`      <giver>${xmlEscapeText(toTrimmedString(quest.giver))}</giver>`);
            }
            if (typeof quest?.accepted === 'boolean') {
                lines.push(`      <accepted>${quest.accepted ? 'true' : 'false'}</accepted>`);
            }
            lines.push('    </quest>');
        }
        lines.push('  </questsAwarded>');
        lines.push('  <updatedQuests>');
        for (const quest of updatedQuests) {
            lines.push('    <quest>');
            lines.push(`      <id>${xmlEscapeText(toTrimmedString(quest?.id))}</id>`);
            lines.push(`      <name>${xmlEscapeText(toTrimmedString(quest?.name))}</name>`);
            if (toTrimmedString(quest?.summary)) {
                lines.push(`      <summary>${xmlEscapeText(toTrimmedString(quest.summary))}</summary>`);
            }
            lines.push('    </quest>');
        }
        lines.push('  </updatedQuests>');
        lines.push('  <declinedQuests>');
        for (const quest of declinedQuests) {
            lines.push('    <quest>');
            lines.push(`      <id>${xmlEscapeText(toTrimmedString(quest?.id))}</id>`);
            lines.push(`      <name>${xmlEscapeText(toTrimmedString(quest?.name))}</name>`);
            if (toTrimmedString(quest?.summary)) {
                lines.push(`      <summary>${xmlEscapeText(toTrimmedString(quest.summary))}</summary>`);
            }
            if (toTrimmedString(quest?.giver)) {
                lines.push(`      <giver>${xmlEscapeText(toTrimmedString(quest.giver))}</giver>`);
            }
            lines.push('      <accepted>false</accepted>');
            lines.push('    </quest>');
        }
        lines.push('  </declinedQuests>');
        if (status === 'declined') {
            lines.push('  <instruction>The player declined this quest offer. The createQuest request is resolved; do not retry it.</instruction>');
        }
        lines.push('</createQuestResult>');

        return {
            content: lines.join('\n'),
            metadata: {
                status,
                questsAwarded,
                updatedQuests,
                declinedQuests
            }
        };
    };

    const hasProvidedScheduleTimingValue = (value) => {
        if (value === null || value === undefined) {
            return false;
        }
        if (typeof value === 'string') {
            return value.trim() !== '';
        }
        return true;
    };

    const executeScheduleEventTool = async (args = {}) => {
        if (typeof scheduleEvent !== 'function') {
            throw new Error('scheduleEvent handler is not configured.');
        }
        const event = toTrimmedString(args.event);
        const region = toTrimmedString(args.region);
        const location = toTrimmedString(args.location);
        if (!event) {
            throw new ToolVisibleError('scheduleEvent requires a non-empty event string.', { code: 'invalid_schedule_event' });
        }
        if (!region) {
            throw new ToolVisibleError('scheduleEvent requires a non-empty region string.', { code: 'invalid_schedule_event' });
        }
        if (!location) {
            throw new ToolVisibleError('scheduleEvent requires a non-empty location string.', { code: 'invalid_schedule_event' });
        }

        const hasIn = hasProvidedScheduleTimingValue(args.in);
        const hasAt = hasProvidedScheduleTimingValue(args.at);
        if (hasIn === hasAt) {
            throw new ToolVisibleError('Provide exactly one of in or at for scheduleEvent.', { code: 'invalid_schedule_event_timing' });
        }

        const scheduleArgs = { event, region, location };
        if (hasIn) {
            scheduleArgs.in = args.in;
        } else {
            scheduleArgs.at = args.at;
        }

        const scheduled = await scheduleEvent(scheduleArgs);
        if (!scheduled || typeof scheduled !== 'object') {
            throw new Error('scheduleEvent handler must return the scheduled event details.');
        }
        const id = toTrimmedString(scheduled.id);
        if (!id) {
            throw new Error('scheduleEvent handler returned a scheduled event without an id.');
        }

        const lines = [
            '<scheduleEventResult>',
            `  <id>${xmlEscapeText(id)}</id>`,
            `  <event>${xmlEscapeText(toTrimmedString(scheduled.event) || event)}</event>`,
            `  <region>${xmlEscapeText(toTrimmedString(scheduled.region) || region)}</region>`,
            `  <location>${xmlEscapeText(toTrimmedString(scheduled.location) || location)}</location>`
        ];
        if (Number.isInteger(scheduled.dayIndex)) {
            lines.push(`  <dayIndex>${scheduled.dayIndex}</dayIndex>`);
        }
        if (Number.isInteger(scheduled.timeMinutes)) {
            lines.push(`  <timeMinutes>${scheduled.timeMinutes}</timeMinutes>`);
        }
        const dateLabel = toTrimmedString(scheduled.dateLabel);
        if (dateLabel) {
            lines.push(`  <dateLabel>${xmlEscapeText(dateLabel)}</dateLabel>`);
        }
        const timeLabel = toTrimmedString(scheduled.timeLabel);
        if (timeLabel) {
            lines.push(`  <timeLabel>${xmlEscapeText(timeLabel)}</timeLabel>`);
        }
        lines.push('</scheduleEventResult>');

        return {
            content: lines.join('\n'),
            metadata: {
                status: 'success',
                id,
                event: toTrimmedString(scheduled.event) || event,
                region: toTrimmedString(scheduled.region) || region,
                location: toTrimmedString(scheduled.location) || location,
                dayIndex: Number.isInteger(scheduled.dayIndex) ? scheduled.dayIndex : null,
                timeMinutes: Number.isInteger(scheduled.timeMinutes) ? scheduled.timeMinutes : null
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

    const isFatalToolExecutionError = (error) => Boolean(error?.fatalToolExecution);

    const buildToolCallAttemptsExhaustedResult = (functionName, maxRounds) => buildToolVisibleErrorResult(
        functionName,
        new ToolVisibleError(
            `The prompt has exhausted its tool call attempts after ${maxRounds} tool-call round${maxRounds === 1 ? '' : 's'}. Do not call any more tools. Continue by writing the final response using the information already available.`,
            { code: 'tool_call_attempts_exhausted' }
        )
    );

    const resolveDeclaredToolNames = requestOptions => {
        const explicitDefinitionSources = [
            { value: requestOptions.tools, label: 'requestOptions.tools', legacy: false },
            {
                value: requestOptions.additionalPayload?.tools,
                label: 'requestOptions.additionalPayload.tools',
                legacy: false
            },
            { value: requestOptions.functions, label: 'requestOptions.functions', legacy: true },
            {
                value: requestOptions.additionalPayload?.functions,
                label: 'requestOptions.additionalPayload.functions',
                legacy: true
            }
        ].filter(source => source.value !== undefined && source.value !== null);

        const explicitlyDisablesToolCalls = [
            requestOptions.tool_choice,
            requestOptions.function_call,
            requestOptions.additionalPayload?.tool_choice,
            requestOptions.additionalPayload?.function_call
        ].some(value => typeof value === 'string' && value.trim().toLowerCase() === 'none');
        if (explicitlyDisablesToolCalls) {
            return new Set();
        }

        const definitionSources = explicitDefinitionSources.length
            ? explicitDefinitionSources
            : [
                { value: CHAT_TOOL_DEFINITIONS, label: 'default chat tools', legacy: false },
                {
                    value: (() => {
                        const registry = typeof getModExtensionRegistry === 'function'
                            ? getModExtensionRegistry()
                            : null;
                        return registry && typeof registry.getChatToolDefinitions === 'function'
                            ? registry.getChatToolDefinitions()
                            : [];
                    })(),
                    label: 'default mod chat tools',
                    legacy: false
                }
            ];

        const names = new Set();
        for (const source of definitionSources) {
            if (!Array.isArray(source.value)) {
                throw new TypeError(`${source.label} must be an array when provided.`);
            }
            for (const [index, definition] of source.value.entries()) {
                const rawName = source.legacy
                    ? definition?.name
                    : definition?.function?.name;
                const name = toTrimmedString(rawName);
                if (!name) {
                    throw new Error(`${source.label}[${index}] is missing a tool function name.`);
                }
                names.add(name);
            }
        }
        return names;
    };

    const buildUndeclaredToolCallResult = (functionName, declaredToolNames) => {
        const safeFunctionName = toTrimmedString(functionName) || 'unknownTool';
        const allowedNames = [...declaredToolNames].sort();
        const allowedInstruction = allowedNames.length
            ? `Use only these declared tools: ${allowedNames.join(', ')}.`
            : 'No tools are declared for this prompt checkpoint.';
        return buildToolVisibleErrorResult(
            safeFunctionName,
            new ToolVisibleError(
                `Tool "${safeFunctionName}" is not declared for this prompt checkpoint. Do not call it. ${allowedInstruction}`,
                { code: 'tool_not_declared' }
            )
        );
    };

    const executeChatToolCall = async (
        toolCall,
        {
            resultCache = null,
            defaultActorName = null,
            requireExplicitSkillCheckActor = false,
            allowedSkillCheckActors = null,
            includeAllHistoryEntryTypes = false,
            requestUserInputHandler = null,
            forcedSkillCheckRoll = null,
            dieRollOverride = null,
            promptStream = null,
            allowRelationshipRemoval = false,
            allowDirectShortDescriptionUpdates = false
        } = {}
    ) => {
        if (!toolCall || typeof toolCall !== 'object') {
            throw new Error('Tool execution requires a tool call object.');
        }
        if (typeof allowDirectShortDescriptionUpdates !== 'boolean') {
            throw new TypeError('allowDirectShortDescriptionUpdates must be a boolean.');
        }
        try {
            const argumentsObject = {
                ...(toolCall.argumentsObject || {})
            };
            if (SKILL_CHECK_TOOL_NAMES.has(toolCall.functionName) && allowedSkillCheckActors !== null) {
                if (!allowedSkillCheckActors.length) {
                    throw new ToolVisibleError(
                        `${toolCall.functionName} cannot run because the checked-action actor checkpoint selected NONE. Do not resolve a skill check in this draft.`,
                        { code: 'skill_check_actor_not_planned' }
                    );
                }
                const suppliedActor = normalizeOptionalString(argumentsObject.actor)
                    || normalizeOptionalString(defaultActorName);
                if (!suppliedActor) {
                    throw new ToolVisibleError(
                        `${toolCall.functionName} requires an explicit actor chosen by the checked-action actor checkpoint.`,
                        { code: 'missing_explicit_actor' }
                    );
                }
                const canonicalActor = allowedSkillCheckActors.find(
                    actorName => actorName.toLowerCase() === suppliedActor.toLowerCase()
                );
                if (!canonicalActor) {
                    throw new ToolVisibleError(
                        `${toolCall.functionName} actor "${suppliedActor}" was not selected by the checked-action actor checkpoint. Use one of: ${allowedSkillCheckActors.join(', ')}.`,
                        { code: 'skill_check_actor_not_planned' }
                    );
                }
                argumentsObject.actor = canonicalActor;
            }
            if (
                requireExplicitSkillCheckActor
                && SKILL_CHECK_TOOL_NAMES.has(toolCall.functionName)
                && !normalizeOptionalString(argumentsObject.actor)
            ) {
                throw new ToolVisibleError(
                    `${toolCall.functionName} requires an explicit actor for this player-action prompt. Supply the exact acting character name or "player"; do not infer the actor from the reason or prose.`,
                    { code: 'missing_explicit_actor' }
                );
            }
            const cacheKey = resultCache
                ? getCacheKeyForToolCall(toolCall.functionName, argumentsObject, resultCache.roundKey, toolCall.id)
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
                if (MUTATING_CHAT_TOOL_NAMES.has(toolCall.functionName)) {
                    cachedResult.content = `${cachedResult.content.trimEnd()}\n\nThis exact mutating tool call already committed; this is its original result.`;
                } else {
                    appendCachedCheckToolCallNote(cachedResult);
                }
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
            } else if (toolCall.functionName === 'editChatLogEntry') {
                toolResult = executeEditChatLogEntryTool(argumentsObject);
            } else if (toolCall.functionName === 'regexReplace') {
                toolResult = executeRegexReplaceTool(argumentsObject);
            } else if (toolCall.functionName === 'rerunSceneSummary') {
                toolResult = executeRerunSceneSummaryTool(argumentsObject);
            } else if (toolCall.functionName === 'editSceneSummary') {
                toolResult = executeEditSceneSummaryTool(argumentsObject);
            } else if (toolCall.functionName === 'requestUserInput') {
                toolResult = executeRequestUserInputTool(argumentsObject, {
                    requestUserInputHandler
                });
            } else if (toolCall.functionName === 'generateRandomInteger') {
                toolResult = executeGenerateRandomIntegerTool(argumentsObject);
            } else if (toolCall.functionName === 'listMysteryBoxes') {
                toolResult = executeListMysteryBoxesTool(argumentsObject);
            } else if (toolCall.functionName === 'findMysteryBoxes') {
                toolResult = executeFindMysteryBoxesTool(argumentsObject);
            } else if (toolCall.functionName === 'getMysteryBox') {
                toolResult = executeGetMysteryBoxTool(argumentsObject);
            } else if (toolCall.functionName === 'updateMysteryBoxFields') {
                toolResult = executeUpdateMysteryBoxFieldsTool(argumentsObject);
            } else if (toolCall.functionName === 'listMysteryThreads') {
                toolResult = executeListMysteryThreadsTool(argumentsObject);
            } else if (toolCall.functionName === 'getMysteryThread') {
                toolResult = executeGetMysteryThreadTool(argumentsObject);
            } else if (toolCall.functionName === 'updateMysteryThreadFields') {
                toolResult = executeUpdateMysteryThreadFieldsTool(argumentsObject);
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
            } else if (toolCall.functionName === 'getTravelTime') {
                toolResult = executeGetTravelTimeTool(argumentsObject);
            } else if (toolCall.functionName === 'revealEntity') {
                toolResult = executeRevealEntityTool(argumentsObject);
            } else if (toolCall.functionName === 'hideEntity') {
                toolResult = executeHideEntityTool(argumentsObject);
            } else if (toolCall.functionName === 'createThing') {
                toolResult = executeCreateThingTool(argumentsObject);
            } else if (toolCall.functionName === 'createNpc') {
                toolResult = executeCreateNpcTool(argumentsObject);
            } else if (toolCall.functionName === 'deleteThing') {
                toolResult = executeDeleteThingTool(argumentsObject, {
                    requestUserInputHandler
                });
            } else if (toolCall.functionName === 'setRelationship') {
                toolResult = executeSetRelationshipTool(argumentsObject, {
                    allowRelationshipRemoval
                });
            } else if (toolCall.functionName === 'addTracker') {
                toolResult = executeAddTrackerTool(argumentsObject);
            } else if (toolCall.functionName === 'updateTracker') {
                toolResult = executeUpdateTrackerTool(argumentsObject);
            } else if (toolCall.functionName === 'removeTracker') {
                toolResult = executeRemoveTrackerTool(argumentsObject);
            } else if (toolCall.functionName === 'createQuest') {
                toolResult = executeCreateQuestTool(argumentsObject, {
                    promptStream
                });
            } else if (toolCall.functionName === 'scheduleEvent') {
                toolResult = executeScheduleEventTool(argumentsObject);
            } else if (toolCall.functionName === 'alterThing') {
                toolResult = executeAlterThingTool(argumentsObject);
            } else if (toolCall.functionName === 'recreateThing') {
                toolResult = executeRecreateThingTool(argumentsObject);
            } else if (toolCall.functionName === 'alterNpc') {
                toolResult = executeAlterNpcTool(argumentsObject);
            } else if (toolCall.functionName === 'updateCharacterFields') {
                toolResult = executeUpdateCharacterFieldsTool(argumentsObject, { allowDirectShortDescriptionUpdates });
            } else if (toolCall.functionName === 'bulkUpdateCharacterFields') {
                toolResult = executeBulkUpdateCharacterFieldsTool(argumentsObject, { allowDirectShortDescriptionUpdates });
            } else if (toolCall.functionName === 'updateObjectFields') {
                toolResult = executeUpdateObjectFieldsTool(argumentsObject, { allowDirectShortDescriptionUpdates });
            } else if (toolCall.functionName === 'upsertFactionFields') {
                toolResult = executeUpsertFactionFieldsTool(argumentsObject, { allowDirectShortDescriptionUpdates });
            } else if (toolCall.functionName === 'updatePartyMembers') {
                toolResult = executeUpdatePartyMembersTool(argumentsObject);
            } else if (toolCall.functionName === 'alterLocation') {
                toolResult = executeAlterLocationTool(argumentsObject);
            } else if (toolCall.functionName === 'resolveAttack') {
                toolResult = executeResolveAttackTool(argumentsObject, { dieRollOverride });
            } else if (toolCall.functionName === 'resolveAreaAttack') {
                toolResult = executeResolveAreaAttackTool(argumentsObject, { dieRollOverride });
            } else if (toolCall.functionName === 'resolveSkillCheck' || toolCall.functionName === 'resolvePlausibilityCheck') {
                toolResult = executeResolvePlausibilityCheckTool(argumentsObject, {
                    defaultActorName,
                    toolName: toolCall.functionName,
                    forcedSkillCheckRoll,
                    dieRollOverride
                });
            } else if (toolCall.functionName === 'resolveOpposedSkillCheck' || toolCall.functionName === 'resolveOpposedPlausibilityCheck') {
                toolResult = executeResolveOpposedPlausibilityCheckTool(argumentsObject, {
                    defaultActorName,
                    toolName: toolCall.functionName,
                    forcedSkillCheckRoll,
                    dieRollOverride
                });
            } else if (toolCall.functionName === 'locateNpcs') {
                toolResult = executeLocateNpcsTool(argumentsObject);
            } else if (toolCall.functionName === 'locateThings') {
                toolResult = executeLocateThingsTool(argumentsObject);
            } else {
                const registry = typeof getModExtensionRegistry === 'function'
                    ? getModExtensionRegistry()
                    : null;
                const registeredTool = registry && typeof registry.getChatToolRecord === 'function'
                    ? registry.getChatToolRecord(toolCall.functionName)
                    : null;
                if (registeredTool && typeof registeredTool.executor === 'function') {
                    toolResult = registeredTool.executor(argumentsObject, {
                        toolCall,
                        defaultActorName,
                        includeAllHistoryEntryTypes,
                        requestUserInputHandler,
                        getCurrentPlayer,
                        Player,
                        Thing,
                        Location,
                        Region
                    });
                } else {
                    throw new Error(`Unsupported tool call function "${toolCall.functionName}".`);
                }
            }
            const resolvedToolResult = await toolResult;
            const toolFailed = resolvedToolResult?.metadata?.error === true;
            if (cacheKey && !toolFailed) {
                if (MUTATING_CHAT_TOOL_NAMES.has(toolCall.functionName) && (!resolvedToolResult.metadata || typeof resolvedToolResult.metadata !== 'object')) {
                    resolvedToolResult.metadata = {};
                }
                if (resolvedToolResult?.metadata && typeof resolvedToolResult.metadata === 'object') {
                    const mutationReceipt = MUTATING_CHAT_TOOL_NAMES.has(toolCall.functionName)
                        ? (resolvedToolResult.metadata.mutationReceipt || {
                            operationId: cacheKey,
                            toolName: toolCall.functionName,
                            committedAt: new Date().toISOString(),
                            committed: true
                        })
                        : null;
                    resolvedToolResult.metadata = {
                        ...resolvedToolResult.metadata,
                        cached: false,
                        cacheKey,
                        ...(mutationReceipt ? { mutationReceipt: {
                            ...mutationReceipt,
                            operationId: mutationReceipt.operationId || cacheKey,
                            toolName: mutationReceipt.toolName || toolCall.functionName,
                            committed: true
                        } } : {})
                    };
                }
                resultCache.entries.set(cacheKey, cloneToolResult(resolvedToolResult));
            }
            return resolvedToolResult;
        } catch (error) {
            if (isFatalToolExecutionError(error)) {
                throw error;
            }
            return buildToolExecutionErrorResult(toolCall.functionName, error);
        }
    };

    const runChatCompletionWithToolLoop = async ({
        requestOptions,
        streamEmitter = null,
        metadataLabel = 'chat',
        toolResultCache = null,
        validateToolCall = null,
        resolvePreResolvedToolCall = null,
        onToolCallDebug = null,
        onToolCallEvent = null,
        defaultToolActor = null,
        includeAllHistoryEntryTypes = false,
        requestUserInput: requestUserInputHandler = null,
        forcedSkillCheckRoll = null,
        dieRollOverride = null,
        requireExplicitSkillCheckActor = false,
        allowedSkillCheckActors = null,
        promptLogFile = null,
        terminalResponseAfterToolCalls = null,
        allowDirectShortDescriptionUpdates = false
    }) => {
        if (!requestOptions || typeof requestOptions !== 'object') {
            throw new Error('runChatCompletionWithToolLoop requires requestOptions.');
        }
        if (!Array.isArray(requestOptions.messages) || !requestOptions.messages.length) {
            throw new Error('runChatCompletionWithToolLoop requires non-empty requestOptions.messages.');
        }
        if (typeof allowDirectShortDescriptionUpdates !== 'boolean') {
            throw new TypeError('runChatCompletionWithToolLoop allowDirectShortDescriptionUpdates must be a boolean.');
        }
        if (onToolCallDebug !== null && onToolCallDebug !== undefined && typeof onToolCallDebug !== 'function') {
            throw new Error('runChatCompletionWithToolLoop onToolCallDebug must be a function when provided.');
        }
        if (onToolCallEvent !== null && onToolCallEvent !== undefined && typeof onToolCallEvent !== 'function') {
            throw new Error('runChatCompletionWithToolLoop onToolCallEvent must be a function when provided.');
        }
        if (validateToolCall !== null && validateToolCall !== undefined && typeof validateToolCall !== 'function') {
            throw new Error('runChatCompletionWithToolLoop validateToolCall must be a function when provided.');
        }
        if (
            resolvePreResolvedToolCall !== null
            && resolvePreResolvedToolCall !== undefined
            && typeof resolvePreResolvedToolCall !== 'function'
        ) {
            throw new Error('runChatCompletionWithToolLoop resolvePreResolvedToolCall must be a function when provided.');
        }
        if (forcedSkillCheckRoll !== null && forcedSkillCheckRoll !== undefined && typeof forcedSkillCheckRoll !== 'function') {
            throw new Error('runChatCompletionWithToolLoop forcedSkillCheckRoll must be a function when provided.');
        }
        if (dieRollOverride !== null && dieRollOverride !== undefined && !Number.isInteger(dieRollOverride)) {
            throw new Error('runChatCompletionWithToolLoop dieRollOverride must be an integer when provided.');
        }
        if (typeof requireExplicitSkillCheckActor !== 'boolean') {
            throw new Error('runChatCompletionWithToolLoop requireExplicitSkillCheckActor must be a boolean.');
        }
        if (
            allowedSkillCheckActors !== null
            && (
                !Array.isArray(allowedSkillCheckActors)
                || allowedSkillCheckActors.some(actor => typeof actor !== 'string' || !actor.trim())
            )
        ) {
            throw new Error('runChatCompletionWithToolLoop allowedSkillCheckActors must be null or an array of non-empty names.');
        }
        if (promptLogFile !== null && promptLogFile !== undefined && typeof promptLogFile !== 'string') {
            throw new Error('runChatCompletionWithToolLoop promptLogFile must be a string when provided.');
        }
        if (
            terminalResponseAfterToolCalls !== null
            && terminalResponseAfterToolCalls !== undefined
            && typeof terminalResponseAfterToolCalls !== 'function'
        ) {
            throw new Error('runChatCompletionWithToolLoop terminalResponseAfterToolCalls must be a function when provided.');
        }

        const config = getConfig();
        const hasMaxToolCalls = config && Object.prototype.hasOwnProperty.call(config, 'max_tool_calls');
        const configuredMaxToolCalls = Number(config?.max_tool_calls);
        const legacyConfiguredMaxRounds = Number(config?.ai?.max_tool_rounds);
        let maxRounds = null;
        if (hasMaxToolCalls) {
            if (!Number.isInteger(configuredMaxToolCalls) || configuredMaxToolCalls <= 0) {
                throw new Error('Configuration error: max_tool_calls must be a positive integer.');
            }
            maxRounds = configuredMaxToolCalls;
        } else if (Number.isInteger(legacyConfiguredMaxRounds) && legacyConfiguredMaxRounds > 0) {
            maxRounds = legacyConfiguredMaxRounds;
        } else {
            throw new Error('Configuration error: max_tool_calls must be configured as a positive integer.');
        }
        const originalOnResponse = typeof requestOptions.onResponse === 'function'
            ? requestOptions.onResponse
            : null;
        const messages = requestOptions.messages.map(message => (
            message && typeof message === 'object'
                ? JSON.parse(JSON.stringify(message))
                : message
        ));
        const declaredToolNames = resolveDeclaredToolNames(requestOptions);

        let aiResponse = '';
        let lastResponse = null;
        let rounds = 0;
        let completed = false;
        let toolLoopActivated = false;
        let toolRoundsUsed = 0;
        let toolsDisabledAfterExhaustion = false;
        let exhaustionErrorRounds = 0;
        let lastAssistantMessage = null;
        const toolInvocations = [];
        const resultCache = normalizeToolResultCache(toolResultCache, { metadataLabel });
        const defaultActorName = normalizeOptionalString(defaultToolActor);
        const allowedSkillCheckActorNames = allowedSkillCheckActors === null
            ? null
            : allowedSkillCheckActors.map(actor => actor.trim());
        if (
            allowedSkillCheckActorNames
            && new Set(allowedSkillCheckActorNames.map(actor => actor.toLowerCase())).size !== allowedSkillCheckActorNames.length
        ) {
            throw new Error('runChatCompletionWithToolLoop allowedSkillCheckActors contains duplicate names.');
        }
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
            if (LLMClient && typeof LLMClient.writeLogFile === 'function') {
                try {
                    LLMClient.writeLogFile({
                        prefix: 'tool_call_failed',
                        metadataLabel: `${metadataLabel || 'chat'}_${functionName}`,
                        serializeJson: true,
                        onFailureMessage: `Failed to write chat tool failure log for "${functionName}"`,
                        payload: {
                            metadataLabel: metadataLabel || 'chat',
                            toolCalled: functionName,
                            toolCallId: toTrimmedString(toolCall?.id) || null,
                            parameters: toolCall?.argumentsObject && typeof toolCall.argumentsObject === 'object'
                                ? toolCall.argumentsObject
                                : {},
                            rawArguments: toTrimmedString(toolCall?.argumentsText) || '{}',
                            error: {
                                code,
                                message
                            },
                            backtrace: stack || '(no backtrace captured)'
                        }
                    });
                } catch (logError) {
                    console.warn(`Failed to write chat tool failure log for "${functionName}":`, logError?.message || logError);
                }
            }
            if (LLMClient && typeof LLMClient.logPrompt === 'function') {
                try {
                    const toolErrorDetails = [
                        `Tool: ${functionName}`,
                        `Arguments: ${toTrimmedString(toolCall?.argumentsText) || '{}'}`,
                        `Code: ${code}`,
                        `Message: ${message}`,
                        `Result: ${toolResult?.content || ''}`
                    ].join('\n');
                    const promptLogResult = promptLogFile
                        ? LLMClient.logPrompt({
                            filePath: promptLogFile,
                            append: true,
                            sections: [
                                { title: `${metadataLabel || 'chat'} tool error`, content: toolErrorDetails },
                                ...(stack ? [{ title: 'Stack', content: stack }] : [])
                            ],
                            output: 'silent'
                        })
                        : LLMClient.logPrompt({
                            prefix: `${metadataLabel || 'chat'}_tool_call_error`,
                            metadataLabel: `${metadataLabel || 'chat'}_tool_call_error`,
                            systemPrompt: '',
                            generationPrompt: toolErrorDetails,
                            response: toolResult?.content || '',
                            sections: stack ? [{ title: 'Stack', content: stack }] : [],
                            output: 'silent'
                        });
                    if (promptLogFile && promptLogResult !== promptLogFile) {
                        throw new Error(`Failed to append tool error "${functionName}" to prompt log ${promptLogFile}.`);
                    }
                } catch (logError) {
                    if (promptLogFile) {
                        throw logError;
                    }
                    console.warn(`Failed to write chat tool error log for "${functionName}":`, logError?.message || logError);
                }
            }
        };

        const runToolLoop = async () => {
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
                    if (
                        roundOptions.additionalPayload
                        && typeof roundOptions.additionalPayload === 'object'
                        && !Array.isArray(roundOptions.additionalPayload)
                    ) {
                        roundOptions.additionalPayload = {
                            ...roundOptions.additionalPayload
                        };
                        delete roundOptions.additionalPayload.tools;
                        delete roundOptions.additionalPayload.functions;
                        delete roundOptions.additionalPayload.parallel_tool_calls;
                        roundOptions.additionalPayload.tool_choice = 'none';
                        roundOptions.additionalPayload.function_call = 'none';
                    }
                }
    
                aiResponse = await LLMClient.chatCompletion(roundOptions);
                lastResponse = roundResponse;
    
                const assistantMessage = roundResponse?.data?.choices?.[0]?.message || null;
                lastAssistantMessage = assistantMessage;
                const rawToolCalls = Array.isArray(assistantMessage?.tool_calls)
                    ? assistantMessage.tool_calls
                    : [];
                const toolCalls = normalizeToolCallsForExecution(rawToolCalls, {
                    sourceLabel: `${metadataLabel} round ${rounds}`
                });
    
                if ((promptLogFile && toolCalls.length) || (!promptLogFile && (toolLoopActivated || toolCalls.length))) {
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
                    const toolRoundLogPath = LLMClient.logPrompt({
                        prefix: roundLabel,
                        metadataLabel: roundLabel,
                        systemPrompt: '',
                        generationPrompt: LLMClient.formatMessagesForErrorLog(messages),
                        response: aiResponse || '',
                        responseLabel: `${metadataLabel} tool round ${rounds} LLM response`,
                        markResponseBoundaries: Boolean(promptLogFile),
                        sections: [
                            {
                                title: 'TOOL CALLS',
                                content: toolCallSummary
                            }
                        ],
                        filePath: promptLogFile || null,
                        append: Boolean(promptLogFile),
                        output: promptLogFile ? 'silent' : 'stdout'
                    });
                    if (promptLogFile && toolRoundLogPath !== promptLogFile) {
                        throw new Error(`Failed to append tool round ${rounds} to prompt log ${promptLogFile}.`);
                    }
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
                    const toolNames = toolCalls.map(toolCall => toolCall.functionName);
                    const toolNameSummary = toolNames.join(', ');
                    streamEmitter.status(toolStatusStage, {
                        round: rounds,
                        toolCallCount: toolCalls.length,
                        toolNames,
                        message: toolCallsExhausted
                            ? `Tool call attempts exhausted; returning ${toolCalls.length} error${toolCalls.length === 1 ? '' : 's'} for ${toolNameSummary}...`
                            : (toolCalls.length === 1
                                ? `Running tool: ${toolNameSummary}...`
                                : `Running ${toolCalls.length} tools: ${toolNameSummary}...`)
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
                        const executeTool = async () => {
                            if (validateToolCall) {
                                await validateToolCall({
                                    name: toolCall.functionName,
                                    functionName: toolCall.functionName,
                                    argumentsObject: JSON.parse(JSON.stringify(toolCall.argumentsObject || {}))
                                });
                            }
                            if (resolvePreResolvedToolCall) {
                                const preResolvedResult = await resolvePreResolvedToolCall({
                                    name: toolCall.functionName,
                                    functionName: toolCall.functionName,
                                    argumentsObject: JSON.parse(JSON.stringify(toolCall.argumentsObject || {}))
                                });
                                if (preResolvedResult !== null && preResolvedResult !== undefined) {
                                    return preResolvedResult;
                                }
                            }
                            return executeChatToolCall(toolCall, {
                                resultCache,
                                defaultActorName,
                                requireExplicitSkillCheckActor,
                                allowedSkillCheckActors: allowedSkillCheckActorNames,
                                includeAllHistoryEntryTypes,
                                requestUserInputHandler,
                                forcedSkillCheckRoll,
                                dieRollOverride,
                                promptStream: streamEmitter,
                                allowDirectShortDescriptionUpdates
                            });
                        };
                        if (toolCallsExhausted) {
                            toolResult = buildToolCallAttemptsExhaustedResult(
                                toolCall.functionName,
                                maxRounds
                            );
                        } else if (!declaredToolNames.has(toolCall.functionName)) {
                            toolResult = buildUndeclaredToolCallResult(
                                toolCall.functionName,
                                declaredToolNames
                            );
                        } else if (
                            requestOptions.queueReservation
                            && CHAT_TOOLS_THAT_MAY_LAUNCH_PROMPTS.has(toolCall.functionName)
                        ) {
                            if (typeof LLMClient.withPromptQueueReservationYield !== 'function') {
                                throw new Error(
                                    `Tool "${toolCall.functionName}" requires prompt queue reservation yielding, but LLMClient does not provide it.`
                                );
                            }
                            toolResult = await LLMClient.withPromptQueueReservationYield(
                                requestOptions.queueReservation,
                                executeTool
                            );
                        } else {
                            toolResult = await executeTool();
                        }
                        if (!toolResult || typeof toolResult.content !== 'string' || !toolResult.content.trim()) {
                            throw new Error(`Tool "${toolCall.functionName}" returned empty content.`);
                        }
                    } catch (error) {
                        if (isFatalToolExecutionError(error)) {
                            await notifyToolCallLifecycle({
                                ...debugBase,
                                phase: 'error',
                                error: {
                                    message: error?.message || String(error),
                                    code: toTrimmedString(error?.code) || 'fatal_tool_execution_error'
                                }
                            });
                            throw error;
                        }
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
                            argumentsObject: JSON.parse(JSON.stringify(toolCall.argumentsObject || {})),
                            metadata: toolResult.metadata || null
                        });
                        messages.push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            name: toolCall.functionName,
                            content: toolResult.content
                        });
                        if (promptLogFile) {
                            const toolResultLogPath = LLMClient.logPrompt({
                                filePath: promptLogFile,
                                append: true,
                                sections: [{
                                    title: `${metadataLabel} tool result ${toolCall.functionName}`,
                                    content: toolResult.content
                                }],
                                output: 'silent'
                            });
                            if (toolResultLogPath !== promptLogFile) {
                                throw new Error(`Failed to append tool result "${toolCall.functionName}" to prompt log ${promptLogFile}.`);
                            }
                        }
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
                if (typeof terminalResponseAfterToolCalls === 'function') {
                    const terminalResponse = await terminalResponseAfterToolCalls({
                        toolInvocations: toolInvocations.map(invocation => JSON.parse(JSON.stringify(invocation))),
                        messages: messages.map(message => JSON.parse(JSON.stringify(message)))
                    });
                    if (terminalResponse !== null && terminalResponse !== undefined) {
                        if (typeof terminalResponse !== 'string' || !terminalResponse.trim()) {
                            throw new Error('terminalResponseAfterToolCalls must return null or a non-empty string.');
                        }
                        aiResponse = terminalResponse.trim();
                        lastAssistantMessage = { role: 'assistant', content: aiResponse };
                        completed = true;
                    }
                }
            }
    
            const conversationMessages = messages.map(message => (
                message && typeof message === 'object'
                    ? JSON.parse(JSON.stringify(message))
                    : message
            ));
            const terminalAssistantMessage = lastAssistantMessage && typeof lastAssistantMessage === 'object'
                ? JSON.parse(JSON.stringify(lastAssistantMessage))
                : { role: 'assistant', content: aiResponse };
            terminalAssistantMessage.role = 'assistant';
            terminalAssistantMessage.content = aiResponse;
            delete terminalAssistantMessage.tool_calls;
            conversationMessages.push(terminalAssistantMessage);
    
            return {
                aiResponse,
                response: lastResponse,
                rounds,
                toolInvocations,
                conversationMessages
            };
        };

        const runToolLoopWithCommittedReceipts = async () => {
            try {
                return await runToolLoop();
            } catch (error) {
                const committedMutationReceipts = toolInvocations
                    .map(invocation => invocation?.metadata?.mutationReceipt || null)
                    .filter(receipt => receipt?.committed === true)
                    .map(receipt => JSON.parse(JSON.stringify(receipt)));
                if (committedMutationReceipts.length && error && typeof error === 'object') {
                    error.committedMutationReceipts = committedMutationReceipts;
                    const existingMessage = typeof error.message === 'string'
                        ? error.message
                        : String(error);
                    if (!existingMessage.includes('Committed mutations before failure:')) {
                        const operationIds = committedMutationReceipts
                            .map(receipt => receipt.operationId || receipt.toolName || 'unknown-operation')
                            .join(', ');
                        error.message = `${existingMessage} Committed mutations before failure: ${operationIds}.`;
                    }
                }
                throw error;
            }
        };

        const progressGroupMethods = [
            LLMClient?.withPromptProgressGroup,
            LLMClient?.clearPromptProgressGroup,
            LLMClient?.hasActivePromptProgressGroup
        ];
        const availableProgressGroupMethodCount = progressGroupMethods
            .filter(method => typeof method === 'function')
            .length;
        if (availableProgressGroupMethodCount !== 0 && availableProgressGroupMethodCount !== progressGroupMethods.length) {
            throw new Error('LLMClient prompt progress grouping support is incomplete.');
        }

        const callerOwnsProgressGroup = (
            requestOptions.progressGroupId !== null
            && requestOptions.progressGroupId !== undefined
        ) || (
            requestOptions.progressGroupTargetLabel !== null
            && requestOptions.progressGroupTargetLabel !== undefined
        );
        const hasInheritedProgressGroup = availableProgressGroupMethodCount === progressGroupMethods.length
            ? LLMClient.hasActivePromptProgressGroup()
            : false;
        if (
            availableProgressGroupMethodCount === 0
            || callerOwnsProgressGroup
            || hasInheritedProgressGroup
        ) {
            return await runToolLoopWithCommittedReceipts();
        }

        const progressGroupTargetLabel = normalizeOptionalString(metadataLabel) || 'chat';
        const progressGroupId = `tool_loop_${progressGroupTargetLabel.replace(/[^a-z0-9]+/gi, '_')}_${randomBytes(8).toString('hex')}`;
        return await LLMClient.withPromptProgressGroup({
            progressGroupId,
            progressGroupTargetLabel
        }, async () => {
            let recordOutputCharacters = false;
            try {
                const result = await runToolLoopWithCommittedReceipts();
                recordOutputCharacters = true;
                return result;
            } finally {
                LLMClient.clearPromptProgressGroup(progressGroupId, {
                    recordOutputCharacters
                });
            }
        });
    };

    return {
        CHAT_TOOL_DEFINITIONS,
        collectHistoryMatches,
        executeChatToolCall,
        getChatToolDefinitions,
        runChatCompletionWithToolLoop
    };
};

module.exports = {
    CHAT_TOOL_DEFINITIONS,
    UPDATE_OBJECT_FIELD_NAMES_BY_TYPE,
    UPDATE_OBJECT_TYPE_VALUES,
    chatToolMayLaunchPrompts,
    createChatToolRuntime,
    getChatToolDefinitions,
    requireExplicitSkillCheckActors
};
