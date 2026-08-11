const SanitizedStringSet = require("./SanitizedStringSet.js");
const Utils = require("./Utils.js");
const Thing = require("./Thing.js");
const Globals = require("./Globals.js");
const Player = require("./Player.js");
const Quest = require("./Quest.js");
const Faction = require("./Faction.js");
const LLMClient = require("./LLMClient.js");
const StatusEffect = require("./StatusEffect.js");
const VehicleInfo = require("./VehicleInfo.js");
const MysteryBox = require("./MysteryBox.js");
const MysteryThread = require("./MysteryThread.js");
const Tracker = require("./Tracker.js");
const { CHAT_TOOL_DEFINITIONS, createChatToolRuntime } = require("./chat_tool_calls.js");
const { resolveQuestDispositionRewardDelta } = require("./quest_disposition_reward_delta.js");
const {
    createTinyBrainContinuationState,
    requireNonWhitespaceResponse,
    parseResponseOrNa,
} = require("./TinyBrainPromptRunner.js");
const {
    configureTinyBrainPromptContext,
    isTinyBrainPromptEnabled,
    runTinyBrainPromptProgram,
} = require("./TinyBrainPromptFamilies.js");
const {
    parseNeedBarCharactersResult,
    parseQuestRewardResult,
} = require("./TinyBrainPromptParsers.js");

const BASE_TIMEOUT_MS = 120000;
const DEFAULT_STATUS_DURATION = 3;
const MAJOR_STATUS_DURATION = 5;
const MYSTERY_BOX_UPDATE_TOOL_NAMES = new Set([
    "listMysteryBoxes",
    "findMysteryBoxes",
    "getMysteryBox",
    "listMysteryThreads",
    "getMysteryThread",
]);
const MYSTERY_BOX_UPDATE_CHAT_TOOLS = CHAT_TOOL_DEFINITIONS.filter((toolDefinition) =>
    MYSTERY_BOX_UPDATE_TOOL_NAMES.has(toolDefinition?.function?.name)
);

const TINY_BRAIN_EVENT_TAG_TO_KEY = Object.freeze({
    newExitDiscovered: "new_exit_discovered",
    alterLocation: "alter_location",
    currency: "currency",
    itemAppear: "item_appear",
    sceneryAppear: "scenery_appear",
    harvestableResourceAppear: "harvestable_resource_appear",
    pickUpItem: "pick_up_item",
    putItemInContainer: "put_item_in_container",
    removeItemFromContainer: "remove_item_from_container",
    revealHiddenNpc: "reveal_hidden_npc",
    hideVisibleNpc: "hide_visible_npc",
    dropItem: "drop_item",
    transferItem: "transfer_item",
    consumeItem: "consume_item",
    alterItem: "alter_item",
    harvestGather: "harvest_gather",
    itemInflict: "item_inflict",
    itemIngest: "item_ingest",
    itemToNpc: "item_to_npc",
    attackDamage: "attack_damage",
    alterNpc: "alter_npc",
    statusEffectChange: "status_effect_change",
    npcArrival: "npc_arrival_departure",
    npcDeparture: "npc_arrival_departure",
    thingArrival: "thing_arrival_departure",
    thingDeparture: "thing_arrival_departure",
    thingMoveWithCharacter: "thing_move_with_character",
    npcFirstAppearance: "npc_first_appearance",
    mysteryBoxMention: "mystery_box_mention",
    partyChange: "party_change",
    tradeAvailability: "trade_availability",
    environmentalStatusDamage: "environmental_status_damage",
    healRecover: "heal_recover",
    hostileToFriendly: "hostile_to_friendly",
    deathIncapacitation: "death_incapacitation",
    receivedQuest: "received_quest",
    completedQuestObjective: "completed_quest_objective",
    defeatedEnemy: "defeated_enemy",
    experienceCheck: "experience_check",
    factionReputationChange: "faction_reputation_change",
    dispositionCheck: "disposition_check",
    triggeredAbility: "triggered_abilities",
    timePassed: "time_passed",
    inCombat: "in_combat",
    anyQuestObjectivesCompleted: "any_quest_objectives_completed",
    trackerUpdates: "tracker_updates",
});

const TINY_BRAIN_IGNORED_MOVEMENT_EVENT_TAGS = new Set([
    "moveLocation",
    "moveNewLocation",
    "arriveAtLocation",
]);

const TINY_BRAIN_EVENT_REQUIRED_FIELDS = Object.freeze({
    newExitDiscovered: Object.freeze([
        "destinationType",
        "destination.regionName",
        "destination.locationName",
        "destinationHasNewExits",
        "vehicleType",
        "description",
        "origin.regionName",
        "origin.locationName",
        "travelTime",
    ]),
    alterLocation: Object.freeze(["currentLocationName", "newLocationName", "changeDescription"]),
    currency: Object.freeze(["amount"]),
    itemAppear: Object.freeze(["fullItemName", "quantity", "description"]),
    sceneryAppear: Object.freeze(["sceneryName", "description"]),
    harvestableResourceAppear: Object.freeze(["resourceName", "description"]),
    pickUpItem: Object.freeze(["actorName", "fullItemName", "quantity"]),
    putItemInContainer: Object.freeze(["fullItemName", "quantity", "containerName"]),
    removeItemFromContainer: Object.freeze(["fullItemName", "quantity", "containerName"]),
    revealHiddenNpc: Object.freeze(["npcName", "description", "useOpposedCheck"]),
    hideVisibleNpc: Object.freeze(["npcName", "description"]),
    dropItem: Object.freeze(["actorName", "fullItemName", "quantity"]),
    transferItem: Object.freeze(["giverName", "fullItemName", "quantity", "receiverName"]),
    consumeItem: Object.freeze(["fullItemName", "quantity", "reason"]),
    alterItem: Object.freeze(["originalItemName", "quantity", "newItemName", "changeDescription"]),
    harvestGather: Object.freeze(["harvesterName", "fullItemName", "quantity"]),
    itemInflict: Object.freeze(["fullItemName", "targetName", "statusEffect"]),
    itemIngest: Object.freeze(["fullItemName", "consumerName"]),
    itemToNpc: Object.freeze(["sourceThingName", "npcName", "description"]),
    attackDamage: Object.freeze(["attackerName", "targetName"]),
    alterNpc: Object.freeze(["npcName", "alterationCategory", "changeDescription"]),
    statusEffectChange: Object.freeze(["entityName", "statusEffectName", "action"]),
    npcArrival: Object.freeze(["npcName", "hideFromPlayer"]),
    npcDeparture: Object.freeze([
        "npcName",
        "destinationRegion",
        "destinationLocation",
        "hideFromPlayer",
    ]),
    thingArrival: Object.freeze(["thingName"]),
    thingDeparture: Object.freeze(["thingName", "destinationRegion", "destinationLocation"]),
    thingMoveWithCharacter: Object.freeze(["thingName", "characterName"]),
    npcFirstAppearance: Object.freeze(["npcName"]),
    mysteryBoxMention: Object.freeze(["name", "context"]),
    partyChange: Object.freeze(["npcName", "action"]),
    tradeAvailability: Object.freeze(["npcName", "willingToTrade", "reason"]),
    environmentalStatusDamage: Object.freeze(["actorName", "effect", "severity", "reason"]),
    healRecover: Object.freeze(["characterName", "magnitude", "reason"]),
    hostileToFriendly: Object.freeze([
        "npcName",
        "previousDisposition",
        "newDisposition",
        "reason",
    ]),
    deathIncapacitation: Object.freeze(["actorName", "outcome"]),
    receivedQuest: Object.freeze(["summary"]),
    defeatedEnemy: Object.freeze(["enemyName"]),
    experienceCheck: Object.freeze(["amount", "reason"]),
    factionReputationChange: Object.freeze(["factionName", "direction", "magnitude", "reason"]),
    triggeredAbility: Object.freeze(["characterName", "abilityName"]),
    inCombat: Object.freeze(["value"]),
    anyQuestObjectivesCompleted: Object.freeze(["value"]),
    trackerUpdate: Object.freeze(["trackerName", "type", "action", "newValue", "reason"]),
});

const TINY_BRAIN_EVENT_STAGE_DEFINITIONS = Object.freeze([
    Object.freeze({
        id: "scene",
        label: "scene and location",
        instructions:
            "Extract lasting scene/location changes, newly discovered exits, first appearances of inanimate things, and arrivals or departures of existing inanimate things.",
        tags: Object.freeze([
            "newExitDiscovered",
            "alterLocation",
            "itemAppear",
            "sceneryAppear",
            "harvestableResourceAppear",
            "thingArrival",
            "thingDeparture",
        ]),
    }),
    Object.freeze({
        id: "items",
        label: "items and inventory",
        instructions:
            "Extract currency changes and every relevant item acquisition, transfer, container interaction, consumption, alteration, harvest, ingestion, status infliction, or transformation into an animate entity.",
        tags: Object.freeze([
            "currency",
            "pickUpItem",
            "putItemInContainer",
            "removeItemFromContainer",
            "dropItem",
            "transferItem",
            "consumeItem",
            "alterItem",
            "harvestGather",
            "itemInflict",
            "itemIngest",
            "itemToNpc",
        ]),
    }),
    Object.freeze({
        id: "characters",
        label: "characters and presence",
        instructions:
            "Extract changes to characters, visibility, status effects, presence, party membership, trade availability, and first physical appearances. Compare the supplied Characters at location list with the CURRENT prose. When the prose physically places a named character in the current scene but that character is absent from the supplied list, emit npcArrival even if the character arrives or remains hidden from the player; set hideFromPlayer accordingly. A plan, memory, dialogue mention, or offscreen action alone is not physical presence and does not qualify.",
        tags: Object.freeze([
            "revealHiddenNpc",
            "hideVisibleNpc",
            "alterNpc",
            "statusEffectChange",
            "npcArrival",
            "npcDeparture",
            "npcFirstAppearance",
            "partyChange",
            "tradeAvailability",
        ]),
    }),
    Object.freeze({
        id: "combat",
        label: "combat and recovery",
        instructions:
            "Extract attacks, environmental or status damage, healing, hostility changes, incapacitations, deaths, and defeated enemies. Whenever a defeated enemy is currently at zero health, include exactly one deathIncapacitation event declaring whether that enemy is dead or incapacitated; defeatedEnemy alone does not resolve the actor's persistent condition.",
        tags: Object.freeze([
            "attackDamage",
            "environmentalStatusDamage",
            "healRecover",
            "hostileToFriendly",
            "deathIncapacitation",
            "defeatedEnemy",
        ]),
    }),
    Object.freeze({
        id: "progression",
        label: "quests and progression",
        instructions:
            "Extract quests, completed objectives, experience, reputation or disposition changes, and mystery-box mentions.",
        tags: Object.freeze([
            "receivedQuest",
            "experienceCheck",
            "factionReputationChange",
            "mysteryBoxMention",
        ]),
    }),
    Object.freeze({
        id: "final",
        label: "final state and missed events",
        instructions:
            "Report final combat and quest-objective flags, triggered abilities, and any supported non-tracker event missed by an earlier stage. Do not repeat an accepted event.",
        requiredTags: Object.freeze([
            "inCombat",
            "anyQuestObjectivesCompleted",
        ]),
        tags: Object.freeze([
            "triggeredAbility",
            "inCombat",
            "anyQuestObjectivesCompleted",
        ]),
    }),
]);

const TINY_BRAIN_EVENT_SECTION_KINDS = new Set([
    "current",
    "origin",
    "between",
    "destination",
    "tracker",
]);

const EVENT_PROMPT_ORDER = [
    // Location stuff
    [
        {
            key: "_instructions_",
            text: `Note: All item quantities should be listed as unitless positive integers. If someone picks up an armload of sticks, the item name should be singular and the quantity should be the total number of sticks. If someone picks up something that's not reasonable to give a quantity to, like a handful of sand, the item name should be 'Handful of Sand' and the quantity should be 1, as opposed to 'Sand' with a quantity of '1 handful'.`
        },
        {
            key: "dummy_event",
            prompt: `Did the text reveal, unlock, unblock, or otherwise create a new exit?`,
        },
        {
            key: "new_exit_discovered",
            prompt: `Did the text reveal, unlock, unblock, or otherwise discover a new exit or vehicle to another region or location (Note: roads, trails, paths, doors, portals, etc are exits and not scenery)? Or, did the player or any other entity create a new exit, clear a path, make a door, etc? If so, reply in the form [destination location name, or destination region name if this is an exit to a region] → [the word "location" or "region"] → [type of vehicle or "none"] → [description of the location, region, or exit in 1-2 sentences] → [Exact travel time to the destination in minutes and/or hours "3 hours, 5 minutes" or "30 minutes" or "1 hour"] → [exit/source location name, or "current location" if this exit is at the current location] → [exit/source region name, or "current region" if this exit is at the current location] → [destination region name, or "none" if unknown/not needed]. In case of more than one, separate them with vertical bars. Otherwise answer N/A. An exit to a region may take the form of a vehicle to that region. If the new location or region is already known to the player or if it isn't, list it here. The exit may be to an existing location, but an exit to that new location may not already exist in the listed exit/source location.`,
        },
        // This dummy event gets the LLM to choose between mutually exclusive types of movement.
        {
            key: "dummy_event",
            prompt: `Did the player or party move at all? If so, give the most appropriate answer.  It should be one of: 'moved to new region', 'moved to new location', 'moved to a new room (location)', 'moved into a large building or structure (region)', 'moved within location to somewhere fully visible', 'moved within location to somewhere not fully visible (sublocation)', 'moved to different existing location', 'sitting down or resting' or 'hiding/taking cover in this location'. If the player did not physically move, answer N/A.`,
        },
        {
            key: "dummy_event",
            prompt: `Did you answer question 3 with 'moved within location to somewhere fully visible'? If so, give the exact name of the scenery.`,
        },
        {
            key: "dummy_event",
            prompt: `Did you answer question 3 with 'hiding/taking cover in this location'? If so, give the exact name of the scenery they used to hide/take cover.`,
        },
        {
            key: "dummy_event",
            prompt:
                'Did the player or party move to a different location or just *talk* about moving? Answer "moved", "talked about moving", or "N/A" if neither.',
        },
        {
            key: "move_new_location",
            prompt: `The starting location is %CURRENT_LOCATION%. If you answered 'moved to new region', 'moved to new location', 'moved into a large building or structure (region)', or 'moved to a new room (location)'  to question 3, come up with a new location name and reply in the form [describe what is different from %CURRENT_LOCATION%] → [change the name and put it here] → [the word "location" or "region"] → [type of vehicle or "none"] → [description of what makes this new destination distinct in 1-2 sentences]. The new location/region may not have the same name as the current one. Moving into a large building or structure should be listed as "region".`,
        },
        {
            key: "move_new_location",
            prompt: `The starting location is %CURRENT_LOCATION%. If you answered question 3 with 'moved within location to somewhere not fully visible (sublocation)', come up with an appropriate sub-location and reply in the form [describe what is different from %CURRENT_LOCATION%] → [change the name and put it here] → [the word "sublocation"] → [type of vehicle or "none"] → [description of what makes this new destination distinct in 1-2 sentences]. The sublocation may not have the same name as the current location. Otherwise answer N/A.`,
        },
        {
            key: "move_location",
            prompt: `The starting location is %CURRENT_LOCATION%. Did the player travel to or end up in a different existing location? If so, answer with the exact name; otherwise answer N/A. If you don't know where they ended up, pick an existing location nearby.`,
        },
        {
            key: "alter_location",
            prompt: `Has the visual description of the location changed? If so, answer in the format "[current location name] → [new location name] → [1 sentence description of alteration]". If not (or if the player moved from one location to another, which isn't a change to the current location), answer N/A. Note that it is not necessary to change the name of the location if it remains appropriate after the alteration; in this case, simply repeat the same name for new location name.`,
        },

        //],
        // Item stuff
        //[
        {
            key: "currency",
            prompt: `Did the player gain or lose currency? If so, how much? Respond with a positive or negative integer. Otherwise, respond N/A. Do not include currency changes in any answers below, as currency is tracked separately from items.`,
        },
        {
            key: "dummy_event",
            prompt: `Track how item were interacted with, including changes in possession or state. Respond in this format: [item name] → [action] → [brief description]. Actions are one of:picked up, dropped, given to someone, taken from someone, put on (as in worn or donned), equipped, partially consumed, completely consumed, altered permanently, altered temporarily, aggregated. Important: For permanent physical changes to the item itself (e.g., broken, enchanted, upgraded), use altered permanently. Changes o the character wearing the item are not an alteration of the item. Note that this is for ITEMS, not CHARACTERS. Wrong: "Bob → put on → Jacket". Right: "Jacket → put on → Bob put on the Jacket"`,
        },
        {
            key: "item_inflict",
            prompt: `Did anyone use (or eat/drink) an item or have an item used on them that might activate or inflict that item's status effect? For example: eating or drinking something, applying a healing bandage to someone, injecting something, reading a cursed tome, and so on. They don't need to have consumed the entire item. If so, list them in this format: "[exact name of item] → [exact name of target] → [status effect]" separated by vertical bars. Otherwise, answer N/A.`,
        },
        {
            key: "item_ingest",
            prompt: `Did anyone eat, drink, or otherwise ingest anything? If so, list them in this format: "[exact name of item] → [exact name of person]". If multiple, separate with vertical bars. Otherwise, answer N/A.`,
        },
        {
            key: "item_to_npc",
            prompt: `Did any inanimate object (e.g., robot, drone, statue, furniture, machinery, or any other scenery) become capable of movement or act as an independent entity? If so, respond in this format: "[exact item or scenery name] → [new npc/entity name] → [5-10 word description of what happened]". Separate multiple entries with vertical bars. If none, respond N/A.`,
        },
        {
            key: "alter_item",
            prompt: `Was an item or piece of scenery in the scene or any inventory PERMANENTLY altered in any way (e.g., upgraded, modified, enchanted, broken, filled with items, etc.)? If so, answer in the format "[exact item name] → [quantity altererd as a positive integer] → [new item name or same item name] → [1 sentence description of alteration]". If multiple items were altered, separate multiple entries with vertical bars. If it doesn't make sense for the name to change, use the same name for new item name. Note that if a meaningful fraction of an an object was consumed (a slice of cake, but not a single piece of wood from a large pile), this is considered an alteration. If the *entire* thing was consumed, this is considered completely consumed and not alteration. Being given, taken, worn, equipped, removed, dropped, etc, is not considered an alteration.`,
        },
        {
            key: "consume_item",
            prompt: `Were any items or pieces of scenery completely used up (leaving none left) or aggregated or assembled into something else, either by becoming a part of something else (like a crafted item, a pile of items, etc), by being eaten or drunk, or by being otherwise completely destroyed? If so, list them in this format: "[exact name of item] → [quantity consumed as a positive integer] → [how item was consumed]" separated by vertical bars. Otherwise, answer N/A. Harvesting, gathering, or otherwise picking up an item does NOT consume it.`,
        },
        {
            key: "transfer_item",
            prompt: `Did anyone hand, trade, or give an item to someone else? If so, list "[exact name of the giver] → [item] → [quantity transferred as a positive integer] → [exact name of the receiver]". If there are multiple entries, separate them with vertical bars. Otherwise, answer N/A.`,
        },
        {
            key: "pick_up_item",
            prompt: `Of any items not listed as consumed or altered, did anyone obtain one or more tangible carryable items or resources (not buildings or furniture) by any method other than harvesting or gathering? If so, list the full name of the person who obtained the item as seen in the location context ("player" if it was the player), the exact item name, and the quantity obtained as a positive integer. Use the format: "[name] → [item] → [quantity] | [name] → [item] → [quantity]". Otherwise, answer N/A. Note that even if an item was crafted with multiple ingredients, it should only be listed once here as a new item, with the correct quantity.`,
        },
        {
            key: "harvest_gather",
            prompt: `Did anyone harvest or gather from any natural or man-made resources or collections (for instance, a berry bush, a pile of wood, a copper vein, a crate of spare parts, etc)? If so, answer with the full name of the person who did so as seen in the location context ("player" if it was the player), the exact name of the item(s) they would obtain, the quantity obtained as a positive integer, and what it was harvested from. If multiple items would be gathered this way, separate with vertical bars. Prefer this format: "[name] → [item] → [quantity] → [source]". If source is genuinely unknown, use "[name] → [item] → [quantity]". Otherwise, answer N/A. For example, if harvesting from a "Raspberry Bush", the item obtained would be "Raspberries", "Ripe Raspberries", or similar.`,
        },
        {
            key: "item_appear",
            prompt: `Did any new inanimate items appear in the scene for the first time, either as newly created items or items that were mentioned as already existing but had not been previously described in the scene context? If so, list them in the format "[exact item name] → [quantity as a positive integer] → [description]" with multiple items separated by vertical bars. Otherwise, answer N/A. Note that even if an item was crafted with multiple ingredients, it should only be listed once here as a new item, with the correct quantity.`,
        },
        {
            key: "put_item_in_container",
            prompt: `Did anyone put one or more items into a container? If so, list "[exact character name, or player, or omit if no character] → [exact item name] → [quantity as a positive integer] → [exact container name]". If there are multiple entries, separate them with vertical bars. Otherwise, answer N/A.`,
        },
        {
            key: "remove_item_from_container",
            prompt: `Did anyone remove one or more items from a container? If so, list "[exact character name, or player, or omit if no character] → [exact item name] → [quantity as a positive integer] → [exact container name]". If no character is named, the item is removed into the current location. If there are multiple entries, separate them with vertical bars. Otherwise, answer N/A.`,
        },
        {
            key: "drop_item",
            prompt: `Of any items not listed above, were any items dropped, placed, or set down from an entity's inventory onto the scene? If so, list the full name of the person who dropped the item as seen in the location context ("player" if it was the player), the exact item name, and the quantity dropped as a positive integer. Items are not considered dropped/placed/set down if they're being used to assemble something in the scene (furniture, a pile of items, or other scenery) and should not be listed here. Use the format: "[exact character name] → [exact item name] → [quantity] | [exact character name] → [exact item name] → [quantity]". Otherwise, answer N/A.`,
        },
        {
            key: "scenery_appear",
            prompt: `Of anything you did not list above, did any new scenery, furniture, buildings, workstations, containers, piles/stacks of things, or other non-carryable items appear (assembled, built, dropped, manifested, etc) in the scene for the first time, either as newly created items or items that were mentioned as already existing but had not been previously described in the scene context? If so, list them in the format format as "[exact thing name] → [description]" with multiple items separated by vertical bars. Otherwise, answer N/A.`,
        },
        {
            key: "thing_arrival_departure",
            prompt: `Did any existing, non-animate item or scenery leave the scene for another destination without being picked up, dropped, transferred, consumed, destroyed, or transformed into an NPC? If so, list it as "[exact thing name] → left → [destination region] → [destination location]". The destination must not be unknown and must not be the current location. If no existing item or scenery left this way, answer N/A.`,
            postProcess: (entry) => ({ ...entry, action: entry?.action || "left" }),
        },
        {
            key: "thing_arrival_departure",
            prompt: `Did any existing, non-animate item or scenery arrive at the current location from elsewhere without being newly created? If so, list it as "[exact thing name] → arrived". Do not include new items or scenery appearing for the first time. If no existing item or scenery arrived this way, answer N/A.`,
            postProcess: (entry) => ({
                ...entry,
                action: entry?.action || "arrived",
            }),
        },
        {
            key: "harvestable_resource_appear",
            prompt: `Of anything you did not list above, did any harvestable or gatherable resources (e.g., plants, minerals, fields, planters, machines that create resources or other harvestable/gatherable scenery) appear in the scene for the first time, either as newly created scenery or scenery that was mentioned as already existing but had not been previously described in the scene context? If so, list them in the format format as "[exact thing name] → [description]" with multiple items separated by vertical bars. Otherwise, answer N/A.`,
        },
    ],
    // NPC stuff
    [
        {
            key: "attack_damage",
            prompt: `Did any entity attack any other entity?  If so, answer in the format "[attacker] → [target]". If there are multiple attackers, separate multiple entries with vertical bars. Note that an attack only took place if the attacker did something that could cause physical damage to the target. Things like shoving, grappling, healing spells, buffs, debuffs, or other contact that's not intended to cause physical damage don't count. If no attack, answer N/A.`,
        },
        {
            key: "alter_npc",
            prompt: `Were any animate entities (NPCs, animals, monsters, robots, or anything else capable of moving on its own) physically changed permanently in any way, such as being transformed, upgraded, downgraded, enhanced, damaged, repaired, healed, modified, or otherwise physically altered in a significant way, by anything other than damage from an attack? If so, answer in the format "[exact character name] → [injury|status effect|gear|attire|mental change|temporary physical change|physical transformation] → [1-2 sentence description of the change]". If multiple characters were altered, separate multiple entries with vertical bars. Note that things like temporary magical polymorphs and being turned to stone (where it's possible that it may be reversed) are better expressed as status effects and should not be mentioned here. If no characters were altered (which will be the case most of the time), answer N/A.`,
        },
        {
            key: "status_effect_change",
            prompt: `Did any animate entities (NPCs, animals, monsters, robots, or anything else capable of moving on its own) gain or lose any temporary status effects that you didn't list above as permanent changes? If so, list them in this format: "[exact entity name] → [Exact name of status effect] → [gained/lost] [→ integer status effect level, if gained]". If there are multiple entries, separate them with vertical bars. Otherwise answer N/A.  Don't use redundant wording in the status effect description. We already know if the status is gained or lost, so just say 'Bob → drunk → gained → 5' or 'Bob → drunk → lost'. When losing a status effect, use the exact name listed with the character XML. The status effect level should generally be the level of the cause of the status effect, be it an item or character. If the effect isn't from an item or a result of something a character did, just use the location level. If the status effect doesn't already have a name, make one up. Note that 'lost' means that an existing status effect goes away, so it doesn't make sense to say a status effect is 'lost' if it's not already a listed status effect for the character.`,
        },
        {
            key: "reveal_hidden_npc",
            prompt: `Did a previously hidden NPC or animate entity become visible to the player? If so, list it as "[exact name] → [one sentence description] → [true|false for whether to use an opposed check]". If no hidden NPC became visible, answer N/A.`,
        },
        {
            key: "hide_visible_npc",
            prompt: `Did a previously visible NPC or animate entity hide from the player? If so, list it as "[exact name] → [one sentence description]". If no visible NPC hid, answer N/A.`,
        },
        {
            key: "npc_arrival_departure",
            prompt: `Did any animate entities (NPCs, animals, monsters, robots, or anything else capable of moving on its own) leave the scene? If so, list the full names of those entities as seen in the location context (capitalized as Proper Nouns) separated by vertical bars. Decide what concrete location and region they went to. The destination must not be unknown and must not be the current location. If a party member stops accompanying the player and goes to a destination, list them here so they can leave the party before moving there. Use the format: "[name] → left → [destination region] → [destination location] → [true|false if attempting to hide at destination]". If you don't know exactly where they went, use what makes the most sense. Otherwise, answer N/A.`,
            postProcess: (entry) => ({ ...entry, action: entry?.action || "left" }),
        },
        {
            key: "npc_arrival_departure",
            prompt: `Did any animate entities (NPCs, animals, monsters, robots, or anything else capable of moving on its own) arrive at this location from elsewhere or otherwise newly appear on the scene (summoned, etc)? If so, list the full names of those entities as seen in the location context (capitalized as Proper Nouns) separated by vertical bars. Use the format: "[name] → arrived → [true|false if attempting to hide from the player]". Otherwise, answer N/A.`,
            postProcess: (entry) => ({
                ...entry,
                action: entry?.action || "arrived",
            }),
        },
        {
            key: "thing_move_with_character",
            prompt: `Did any existing, non-animate item or scenery move with a character who traveled, departed, or otherwise moved to another location? If so, list it as "[exact thing name] → [exact character name]". Use this for carried, driven, ridden, or otherwise character-moved objects, including objects that moved with the player or a party member during travel. Do not list animate entities here. If no existing item or scenery moved with a character, answer N/A.`,
        },
        {
            key: "npc_first_appearance",
            prompt: `List all physically present entities (NPCs, animals, monsters, robots, etc., including those without proper names) mentioned in textToCheck except those only mentioned in dialogue. This is to catch any characters who are present that the system isn't already aware of. Separate entries with vertical bars. For instance, "Android 609|Bob|Dire Wolf". Capitalize them as proper nouns if they aren't already capitalized. DO NOT include entites that are not present (mentioned in conversation, on the telephone, on a TV, in a crystal ball, or whatever), even if they are able to communicate with people at the location. If none, answer N/A.`,
        },
        {
            key: "npc_first_appearance",
            prompt: `List all physically present entities (NPCs, animals, monsters, robots, etc.) that acted (interacted with the player, spoke, or did anything else) in textToCheck which aren't already listed in your answers above, in the player's party, or in the list of present entities. Separate entries with vertical bars. DO NOT include entites that are not present (mentioned in conversation, on the telephone, on a TV, in a crystal ball, or whatever), even if they are able to communicate with people at the location. For instance, "Android 609|Bob|Dire Wolf". If none, answer N/A.`,
        },
        {
            key: "party_change",
            prompt: `Is any physically present entity (including ones you may have listed above) that is not listed in playerParty currently leading, following, or otherwise willingly accompanying the player? If yes, list "[npc name] → joined". For anyone who began leading or following (even temporarily), also list them as "[npc name] → joined". If anyone left the party without moving to another known destination, list "[npc name] → left". Separate multiple entries with vertical bars. If no party status occurred, respond with N/A.`,
        },
        {
            key: "trade_availability",
            prompt: `Did an event explicitly make an NPC willing or unwilling to trade or barter with the player? If so, answer in the format "[exact NPC name] → [true|false] → [one sentence reason]". Use false for refusals, temporary trade bans, or a character deciding they will not buy/sell; use true for merchants opening trade or a character deciding they will buy/sell. Separate multiple entries with vertical bars. Otherwise, answer N/A.`,
        },
        {
            key: "environmental_status_damage",
            prompt: `Did any animate entities take environmental damage or damage from an ongoing status effect? Were they healed by the environment or an ongoing status effect? If so, answer in the format "[exact name] → [damage|healing] → [low|medium|high] → [1 sentence describing why damage was taken]". If there are multiple instances of damage, separate multiple entries with vertical bars. Otherwise, answer N/A.`,
        },
        {
            key: "heal_recover",
            prompt: `Did anyone heal or recover health? If so, answer in the format "[character] → [small|medium|large|all] → [reason]". If there are multiple characters, separate multiple entries with vertical bars. Otherwise, answer N/A. Health recovery from natural regeneration, food, resting tends to be small or medium, whereas healing from potions, spells, bed rest, or medical treatment tends to be medium or large. Consider the context of the event, the skill of the healer (if applicable), the rarity and properties of any healing items used, etc.`,
        },
        /*{
            key: "needbar_change",
            prompt: `Does anything that happened in this turn affect any need bars for any characters (NPCs, party members, or player)? If so, for each character whose need bars are affected in any way, answer with the following four arguments: "[exact name of character] → [exact name of need bar] → [increase or decrease] → [none|small|medium|large|all] | ..." for each of their need bars (including unchanged ones), separating multiple adjustments with vertical bars (multiple characters may have multiple need bar changes). Pay attention to the need bar descriptions to see how much they should change based on the situation. Also consider the descriptions of items involved, which may override those. Need bars are affected fully even if the character takes the same action multiple times in a row or continues the same action over multiple turns. Err on the side of being generous with need bar increases. If no changes to need bars, answer N/A.`,
        },*/
        {
            key: "hostile_to_friendly",
            prompt: `Did any NPCs or entities that were previously hostile or unfriendly to the player become neutral, friendly, or allied? If so, respond with "[exact name of NPC/entity] → [previous disposition] → [new disposition] → [reason in one sentence]". If multiple, separate with vertical bars. Otherwise, respond N/A.`,
        },
        //],
        // Misc stuff
        //[
        {
            key: "in_combat",
            prompt: `Could the player be considered to be in physical combat at the moment? This can be true even if the player did not attack and was not directly attacked. Answer Yes or No.`,
        },
        {
            key: "received_quest",
            prompt: `Did the player become aware of one or more quests or tasks this turn (by reading them, hearing about them, having them directly requested, etc), even if they didn't actively acknowledge or accept it? Also include quests that the player thought of themselves ("I need to go collect some iron so I can craft a new dagger", etc), or that the player tells someone that they will do. If so, answer in the following format: "[exact name of quest giver] → [1 sentence description of quest] | ..."`,
        },
        //        { key: 'completed_quest_objective', prompt: `Based on the entire provided context (including gameHistory), has the player already completed one or more quest objectives listed in the xml &lt;quests&gt; block? If so, answer in the following format: "[exact name of quest] → [index completed objective] | ..."` },
        {
            key: "death_incapacitation",
            prompt: `Did any entity die or become incapacitated? If so, reply in this format: "[exact name of character/entity] → ["dead" or "incapacitated"]. If multiple, separate with vertical bars. Otherwise answer N/A.`,
        },
        {
            key: "defeated_enemy",
            prompt: `Did the player defeat an enemy this turn? If so, respond with the exact name of the enemy. If there are multiple enemies, separate multiple names with vertical bars. Otherwise, respond N/A.`,
        },
        {
            key: "experience_check",
            prompt: `Did the player do something (other than defeating an enemy) that would cause them to gain experience points? If so, respond with "[integer from 1-100] → [reason in one sentence]" (note that experience cannot be gained just because something happened to the player; the player must have taken a specific action that contributes to their growth or development). Otherwise, respond N/A. See the sampleExperiencePointValues section for examples of actions that might grant experience points and how much.`,
        },
        /*{
            key: "disposition_check",
            prompt: `Did any NPC's disposition toward the player change in a significant way? If so, respond with "[exact name of NPC] → [how they felt before] → [how they feel now] → [reason in one sentence]". If multiple NPCs' dispositions changed, separate multiple entries with vertical bars. Otherwise, respond N/A.  If they feel the same way as they did before, the change isn't significant and shouldn't be listed here.`,
        },*/
        {
            key: "faction_reputation_change",
            prompt: `Would the player's reputation with any factions increase or decrease in a significant way (whether due to their own actions or events beyond their control)? If so, respond with "[exact name of faction] → [increased/decreased] [a little/a lot] → [reason in one sentence]". If multiple factions' reputations changed, separate multiple entries with vertical bars. Otherwise, respond N/A. If the reputation change is very minor and doesn't have a meaningful impact on how that faction would treat the player, it may not be necessary to list it here.`,
        },
        {
            key: "dummy_event",
            prompt: `Itemize any activities that happened in the text, and list how long, in minutes and/or hours, they would have realistically happened in wall clock time, in this format: "[activity] -> [time]", separated with vertical bars in the case of multiple entries.`,
        },
        {
            key: "time_passed",
            prompt: `How long did the things that happened in the text for the turn realistically take in elapsed wall-clock time (consider whether some of the above activities could have happened in parallel)? Estimate the duration of the concrete actions described, not how long the prose takes to read and not how long a simple game action usually takes. If the text summarizes an extended activity such as cleaning, searching, crafting, repairing, cooking, resting, training, travel, or careful investigation, estimate the full real-world time required. Consider whether multiple characters worked in parallel; use elapsed wall-clock time rather than summing every person's labor. First briefly identify the time-consuming actions and any parallel work, then provide one best duration estimate. Answer in the format "[brief breakdown/reasoning] -> [time taken]". Format time taken with one of: "HH:MM", "[INTEGER] [minutes/hours]", or "[INTEGER] hours, [INTEGER] minutes". Do NOT use time ranges ("10-20 minutes"); use exact times only (just pick a reasonable amount of time).  If no time passed, answer "Nothing time-consuming happened -> 0".`,
        },
        {
            key: "tracker_updates",
            prompt: `Did any plot trackers need to be added, updated, or removed? If so, list each change as "[exact tracker name] → [countdown|numerical_count|x_out_of_total|percentage|short_string] → [add|update|remove] → [new tracker value, or none for remove] → [one sentence reason]". Percentage values may include or omit a percent sign. Separate multiple entries with vertical bars. Otherwise answer N/A.`,
        },
        {
            key: "triggered_abilities",
            prompt: `Were any character's triggered abilities triggered this turn? If so, list them in the format "[exact character name] → [exact ability name]", separated by '|' if multiple. If none, answer N/A.`,
        } /*,
        {
            key: "dummy_event",
            prompt: `Did any of the answers to the above questions feel ambiguous? Which ones, and why?`,
        },
        {
            key: "dummy_event",
            prompt: `Taken as a whole, do any of your answers conflict with other answers? Which ones, and why?`,
        },*/
    ],
];

const EVENT_PROMPT_ORDER_FLAT = EVENT_PROMPT_ORDER.flat();

const NO_EVENT_TOKENS = new Set(["n/a", "na", "none", "nothing"]);
const FACTION_REPUTATION_DELTA_SMALL = 1;
const FACTION_REPUTATION_DELTA_LARGE = 4;

const DISPOSITION_POSITIVE_KEYWORDS = new Set([
    "ally",
    "allied",
    "appreciative",
    "approving",
    "calm",
    "comfortable",
    "cooperative",
    "fond",
    "friendly",
    "grateful",
    "happy",
    "helpful",
    "kind",
    "liked",
    "likes",
    "loyal",
    "neutral",
    "respectful",
    "safe",
    "supportive",
    "sympathetic",
    "trust",
    "trusted",
    "trusting",
    "warm",
]);

const DISPOSITION_NEGATIVE_KEYWORDS = new Set([
    "afraid",
    "aggressive",
    "angry",
    "annoyed",
    "cold",
    "contempt",
    "contemptuous",
    "distrust",
    "distrustful",
    "fear",
    "fearful",
    "frustrated",
    "furious",
    "hateful",
    "hostile",
    "intimidated",
    "resentful",
    "rude",
    "scared",
    "suspicious",
    "tense",
    "threatened",
    "unfriendly",
    "upset",
    "wary",
]);

function isBlank(value) {
    return !value || (typeof value === "string" && !value.trim());
}

function normalizeString(value) {
    return typeof value === "string" ? value.trim() : "";
}

function normalizeDestinationMatchKey(value) {
    return normalizeString(value).toLowerCase().replace(/\s+/g, " ");
}

function splitPipeList(raw) {
    if (isBlank(raw)) {
        return [];
    }
    return raw
        .split("|")
        .map((part) => part.trim())
        .filter(
            (part) => part.length > 0 && !NO_EVENT_TOKENS.has(part.toLowerCase()),
        );
}

function normalizeArrowDelimiters(raw) {
    if (typeof raw !== "string") {
        return "";
    }

    const unescaped = raw.replace(/&gt;/gi, ">").replace(/&lt;/gi, "<");
    return unescaped
        .replace(/\s*(?:→|⇒|⟶|⟹|➜|➡|->)\s*/g, " → ")
        .replace(/\s*→\s*/g, " → ")
        .trim();
}

function splitArrowParts(raw, expectedParts) {
    if (isBlank(raw)) {
        return [];
    }

    const normalized = normalizeArrowDelimiters(raw);

    const parts = normalized
        .split("→")
        .map((part) => part.trim())
        .filter(Boolean);

    if (!expectedParts || parts.length < expectedParts) {
        return parts;
    }

    if (expectedParts === 2) {
        return [parts[0], parts.slice(1).join(" → ")];
    }

    if (expectedParts === 3) {
        return [parts[0], parts[1], parts.slice(2).join(" → ")];
    }

    if (expectedParts === 4) {
        return [parts[0], parts[1], parts[2], parts.slice(3).join(" → ")];
    }

    if (expectedParts === 5) {
        return [parts[0], parts[1], parts[2], parts[3], parts.slice(4).join(" → ")];
    }

    return parts;
}

function stripAfterFirstArrow(raw) {
    const normalized = normalizeArrowDelimiters(raw);
    const arrowIndex = normalized.indexOf("→");
    const segment = arrowIndex === -1 ? normalized : normalized.slice(0, arrowIndex);
    return segment.trim();
}

function stripBeforeLastArrow(raw) {
    const normalized = normalizeArrowDelimiters(raw);
    const arrowIndex = normalized.lastIndexOf("→");
    const segment = arrowIndex === -1 ? normalized : normalized.slice(arrowIndex + 1);
    return segment.trim();
}

function parseRequiredEventQuantity(rawQuantity, { eventKey, entryText }) {
    const normalizedQuantity = typeof rawQuantity === "string"
        ? rawQuantity.trim()
        : String(rawQuantity ?? "").trim();
    if (!normalizedQuantity) {
        throw new Error(`${eventKey} entry is missing required quantity: ${entryText}`);
    }

    const parsedQuantity = Number(normalizedQuantity);
    if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
        throw new Error(
            `${eventKey} entry has invalid quantity "${normalizedQuantity}": ${entryText}`,
        );
    }

    return parsedQuantity;
}

function normalizeOptionalEventActorName(value) {
    const trimmed = normalizeString(value);
    if (!trimmed) {
        return null;
    }
    const normalized = trimmed.toLowerCase();
    if (
        NO_EVENT_TOKENS.has(normalized) ||
        normalized === "null" ||
        normalized === "unknown" ||
        normalized === "omitted" ||
        normalized === "omit"
    ) {
        return null;
    }
    return trimmed;
}

function parseRequiredEventQuantityOrAll(rawQuantity, { eventKey, entryText }) {
    const normalizedQuantity = typeof rawQuantity === "string"
        ? rawQuantity.trim()
        : String(rawQuantity ?? "").trim();
    if (normalizedQuantity.toLowerCase() === "all") {
        return "all";
    }
    return parseRequiredEventQuantity(normalizedQuantity, { eventKey, entryText });
}

function parseContainerItemMovementEvent(raw, { eventKey }) {
    return splitPipeList(raw)
        .map((entry) => {
            if (typeof entry !== "string") {
                return null;
            }
            const parts = splitArrowParts(entry, 4);
            let character = null;
            let item = "";
            let rawQuantity = "";
            let containerName = "";

            if (parts.length === 4) {
                [character, item, rawQuantity, containerName] = parts;
            } else if (parts.length === 3) {
                [item, rawQuantity, containerName] = parts;
            } else {
                return null;
            }

            if (!item || !containerName) {
                return null;
            }

            return {
                character: normalizeOptionalEventActorName(character),
                item: item.trim(),
                quantity: parseRequiredEventQuantity(rawQuantity, {
                    eventKey,
                    entryText: entry,
                }),
                containerName: containerName.trim(),
            };
        })
        .filter(Boolean);
}

function locationHasExitToDestination(location, destinationId) {
    const normalizedDestinationId =
        typeof destinationId === "string" ? destinationId.trim() : "";
    if (
        !location ||
        !normalizedDestinationId ||
        typeof location.getAvailableDirections !== "function" ||
        typeof location.getExit !== "function"
    ) {
        return false;
    }

    return location.getAvailableDirections().some((direction) => {
        const exit = location.getExit(direction);
        return exit && exit.destination === normalizedDestinationId;
    });
}

function findExitToDestination(location, destinationId) {
    const normalizedDestinationId =
        typeof destinationId === "string" ? destinationId.trim() : "";
    if (
        !location ||
        !normalizedDestinationId ||
        typeof location.getAvailableDirections !== "function" ||
        typeof location.getExit !== "function"
    ) {
        return null;
    }

    for (const direction of location.getAvailableDirections()) {
        const exit = location.getExit(direction);
        if (exit && exit.destination === normalizedDestinationId) {
            return { direction, exit };
        }
    }

    return null;
}

function normalizeOptionalEventLocationField(value) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (!trimmed) {
        return "";
    }
    const normalized = trimmed.toLowerCase();
    if (
        normalized === "n/a" ||
        normalized === "na" ||
        normalized === "none" ||
        normalized === "null" ||
        normalized === "unknown" ||
        normalized === "omitted" ||
        normalized === "omit" ||
        normalized === "current" ||
        normalized === "current location" ||
        normalized === "current region" ||
        normalized === "same location" ||
        normalized === "same region"
    ) {
        return "";
    }
    return trimmed;
}

function resolveEventRegionByName({ regions, pendingRegionStubs, findRegionByNameLoose } = {}, regionName) {
    const trimmed = normalizeOptionalEventLocationField(regionName);
    if (!trimmed) {
        return null;
    }

    if (regions instanceof Map) {
        const direct = regions.get(trimmed) || null;
        if (direct) {
            return direct;
        }
        const normalized = trimmed.toLowerCase();
        for (const region of regions.values()) {
            if (!region || typeof region !== "object") {
                continue;
            }
            const id = typeof region.id === "string" ? region.id.trim().toLowerCase() : "";
            const name = typeof region.name === "string" ? region.name.trim().toLowerCase() : "";
            if (id === normalized || name === normalized) {
                return region;
            }
        }
    }

    if (pendingRegionStubs instanceof Map) {
        const direct = pendingRegionStubs.get(trimmed) || null;
        if (direct) {
            return direct;
        }
        const normalized = trimmed.toLowerCase();
        for (const pending of pendingRegionStubs.values()) {
            if (!pending || typeof pending !== "object") {
                continue;
            }
            const candidates = [
                pending.id,
                pending.name,
                pending.originalName,
                pending.targetRegionName,
            ];
            if (candidates.some(candidate =>
                typeof candidate === "string" && candidate.trim().toLowerCase() === normalized
            )) {
                return pending;
            }
        }
    }

    if (typeof findRegionByNameLoose === "function") {
        return findRegionByNameLoose(trimmed) || null;
    }

    return null;
}

function resolveEventLocationByName({
    Location,
    gameLocations,
    findLocationByNameLoose,
    region = null,
} = {}, locationName) {
    const trimmed = normalizeOptionalEventLocationField(locationName);
    if (!trimmed) {
        return null;
    }

    const matchesLocationName = (candidate) => {
        if (!candidate || typeof candidate !== "object") {
            return false;
        }
        const normalized = trimmed.toLowerCase();
        const id = typeof candidate.id === "string" ? candidate.id.trim().toLowerCase() : "";
        const name = typeof candidate.name === "string" ? candidate.name.trim().toLowerCase() : "";
        return id === normalized || name === normalized;
    };

    if (region && Array.isArray(region.locationIds)) {
        for (const locationId of region.locationIds) {
            let candidate = null;
            if (Location && typeof Location.get === "function") {
                try {
                    candidate = Location.get(locationId) || null;
                } catch (_) {
                    candidate = null;
                }
            }
            if (!candidate && gameLocations instanceof Map) {
                candidate = gameLocations.get(locationId) || null;
            }
            if (matchesLocationName(candidate)) {
                return candidate;
            }
        }
    }

    if (Location && typeof Location.get === "function") {
        try {
            const candidate = Location.get(trimmed) || null;
            if (candidate && (!region || locationBelongsToEventRegion(candidate, region))) {
                return candidate;
            }
        } catch (_) {
            // Continue to name lookup.
        }
    }

    if (Location && typeof Location.findByName === "function") {
        try {
            const candidate = Location.findByName(trimmed) || null;
            if (candidate && (!region || locationBelongsToEventRegion(candidate, region))) {
                return candidate;
            }
        } catch (_) {
            // Continue to loose lookup.
        }
    }

    if (typeof findLocationByNameLoose === "function") {
        const candidate = findLocationByNameLoose(trimmed) || null;
        if (candidate && (!region || locationBelongsToEventRegion(candidate, region))) {
            return candidate;
        }
    }

    return null;
}

function locationBelongsToEventRegion(location, region) {
    if (!location || !region) {
        return false;
    }
    const locationId = typeof location.id === "string" ? location.id.trim() : "";
    if (locationId && Array.isArray(region.locationIds) && region.locationIds.includes(locationId)) {
        return true;
    }
    const regionId = typeof region.id === "string" ? region.id.trim() : "";
    if (!regionId) {
        return false;
    }
    return location.regionId === regionId
        || location.stubMetadata?.regionId === regionId
        || location.stubMetadata?.targetRegionId === regionId;
}

async function resolveExitDiscoveryOrigin(entry, context, deps, eventLabel) {
    const explicitLocationName = normalizeOptionalEventLocationField(entry?.exitLocationName);
    const explicitRegionName = normalizeOptionalEventLocationField(entry?.exitRegionName);

    if (!explicitLocationName && !explicitRegionName) {
        const originLocation = context.location || null;
        const originRegion = context.region
            || (typeof deps.findRegionByLocationId === "function" && originLocation?.id
                ? deps.findRegionByLocationId(originLocation.id) || null
                : originLocation?.region || null);
        return { originLocation, originRegion };
    }

    if (!explicitLocationName) {
        throw new Error(
            `[${eventLabel}] origin/source region requires a location name.`,
        );
    }

    const explicitRegion = resolveEventRegionByName(deps, explicitRegionName);
    if (explicitRegionName && !explicitRegion) {
        throw new Error(
            `[${eventLabel}] Unable to resolve exit/source region "${explicitRegionName}".`,
        );
    }

    let originLocation = resolveEventLocationByName({
        ...deps,
        region: explicitRegion,
    }, explicitLocationName);

    if (!originLocation && explicitRegion && typeof deps.createLocationFromEvent === "function") {
        try {
            originLocation = await deps.createLocationFromEvent({
                name: explicitLocationName,
                originLocation: context?.location || null,
                descriptionHint:
                    entry?.originDescription ||
                    `A known location in ${explicitRegion.name || explicitRegionName}.`,
                expandStub: false,
                targetRegionId: explicitRegion.id || null,
                createOriginExit: false,
            });
        } catch (error) {
            throw new Error(
                `[${eventLabel}] Failed to create exit/source location "${explicitLocationName}": ${error.message}`,
            );
        }
    }

    if (!originLocation) {
        const regionSuffix = explicitRegionName ? ` in region "${explicitRegionName}"` : "";
        throw new Error(
            `[${eventLabel}] Unable to resolve exit/source location "${explicitLocationName}"${regionSuffix}.`,
        );
    }

    const originRegion = explicitRegion
        || (typeof deps.findRegionByLocationId === "function" && originLocation?.id
            ? deps.findRegionByLocationId(originLocation.id) || null
            : originLocation?.region || null);

    return { originLocation, originRegion };
}

async function applyExitDiscovery(
    eventsInstance,
    entries = [],
    context = {},
    {
        movePlayer = false,
        eventLabel = "new_exit_discovered",
        moveLabel = "move_location",
    } = {},
) {
    if (!Array.isArray(entries) || !entries.length) {
        return;
    }

    const deps = eventsInstance._deps || {};
    const {
        Location,
        findLocationByNameLoose,
        findRegionByNameLoose,
        findRegionByLocationId,
        createLocationFromEvent,
        createRegionStubFromEvent,
        ensureExitConnection,
        regenerateLocationName,
        gameLocations,
        regions,
        pendingRegionStubs,
    } = deps;

    if (
        typeof Location?.get !== "function" ||
        typeof ensureExitConnection !== "function"
    ) {
        if (movePlayer && entries && entries.length > 0) {
            console.warn(
                `[${eventLabel}] Skipping move/exit creation because required location dependencies are missing.`,
            );
        }
        return;
    }

    const processedDestinations = new SanitizedStringSet();

    for (const entry of entries) {
        //console.log(`Processing exit discovery entry: ${entry.name}`);
        //console.trace();
        let exitName = typeof entry?.name === "string" ? entry.name.trim() : "";
        if (!exitName) {
            continue;
        }

        const { originLocation, originRegion } = await resolveExitDiscoveryOrigin(
            entry,
            context,
            {
                Location,
                gameLocations,
                regions,
                pendingRegionStubs,
                findLocationByNameLoose,
                findRegionByNameLoose,
                findRegionByLocationId,
                createLocationFromEvent,
            },
            eventLabel,
        );
        if (!originLocation) {
            if (movePlayer) {
                console.warn(
                    `[${eventLabel}] Skipping move/exit creation because context.location is missing.`,
                );
            }
            continue;
        }

        const originNameFromEntry =
            typeof entry?.origin === "string" ? entry.origin.trim() : "";
        const originLocationName = originLocation?.name
            ? originLocation.name.trim()
            : "";
        const originReference = originNameFromEntry || originLocationName || null;
        const originRegionId =
            typeof originLocation?.regionId === "string"
                ? originLocation.regionId.trim() || null
                : typeof originLocation?.stubMetadata?.regionId === "string"
                    ? originLocation.stubMetadata.regionId.trim() || null
                    : typeof originLocation?.stubMetadata?.targetRegionId === "string"
                        ? originLocation.stubMetadata.targetRegionId.trim() || null
                        : null;
        const originIsLocationVehicle = Boolean(originLocation?.isVehicle === true);
        const originIsRegionVehicle = Boolean(originRegion?.isVehicle === true);

        //console.log(`entry for exit discovery: ${JSON.stringify(entry)}`);

        //console.log(`Checking exit "${exitName}" from origin "${originReference}"`);
        const exitNameMatchesOrigin =
            originLocationName &&
            entry.name.toLowerCase().trim() === originLocationName.toLowerCase();
        if (
            exitNameMatchesOrigin &&
            typeof regenerateLocationName === "function"
        ) {
            try {
                const regenInput = {
                    name: exitName,
                    description:
                        entry?.description || `A location connected to ${originReference}.`,
                    regionId: originRegionId,
                    baseLevel: Number.isFinite(originLocation?.baseLevel)
                        ? originLocation.baseLevel
                        : 1,
                    stubMetadata: originLocation?.stubMetadata || {},
                };
                const regenResult = await regenerateLocationName(regenInput);
                if (regenResult?.name) {
                    exitName = regenResult.name.trim();
                    entry.name = exitName;
                    console.debug(
                        `[${eventLabel}] Renamed destination via regenerateLocationName.`,
                        {
                            originalName: originReference,
                            newName: exitName,
                        },
                    );
                }
            } catch (error) {
                console.debug([error]);
            }
        }

        const isRegion = entry?.kind === "region";
        const destinationRegionName = normalizeOptionalEventLocationField(
            entry?.destinationRegionName,
        );
        const destinationRegion = resolveEventRegionByName(
            { regions, pendingRegionStubs, findRegionByNameLoose },
            destinationRegionName,
        );
        if (!isRegion && destinationRegionName && !destinationRegion) {
            throw new Error(
                `[${eventLabel}] Unable to resolve destination region "${destinationRegionName}" for exit "${exitName}".`,
            );
        }

        const processedDestinationKey = [
            originLocation?.id || originLocationName || "unknown-origin",
            isRegion ? "region" : "location",
            exitName,
            destinationRegion?.id || destinationRegionName || "",
        ].join(" → ");
        if (processedDestinations.has(processedDestinationKey)) {
            continue;
        }

        processedDestinations.add(processedDestinationKey);

        let destination = null;
        let createdRegionStub = false;

        if (!isRegion) {
            destination = resolveEventLocationByName({
                Location,
                gameLocations,
                findLocationByNameLoose,
                region: destinationRegion,
            }, exitName);
        } else if (!destinationRegionName) {
            if (typeof findLocationByNameLoose === "function") {
                destination = findLocationByNameLoose(exitName) || null;
            }
            if (!destination && typeof Location.findByName === "function") {
                try {
                    destination = Location.findByName(exitName);
                } catch (_) {
                    destination = null;
                }
            }
        }

        const suppressLocationVehicleExitCreation = originIsLocationVehicle;
        const suppressRegionVehicleRegionExitCreation =
            !originIsLocationVehicle && originIsRegionVehicle && isRegion;

        let existingRegionDestination = null;
        if (!destination && isRegion) {
            try {
                const matchedRegion =
                    destinationRegion ||
                    (typeof findRegionByNameLoose === "function"
                        ? findRegionByNameLoose(exitName) || null
                        : null);
                const entranceLocationId =
                    typeof matchedRegion?.entranceLocationId === "string"
                        ? matchedRegion.entranceLocationId.trim()
                        : "";
                if (
                    matchedRegion &&
                    entranceLocationId &&
                    gameLocations instanceof Map &&
                    gameLocations.has(entranceLocationId)
                ) {
                    existingRegionDestination =
                        gameLocations.get(entranceLocationId) || null;
                    destination = existingRegionDestination;
                }
            } catch (_) {
                existingRegionDestination = null;
            }
        }

        const alreadyHasMatchingExit =
            destination?.id && locationHasExitToDestination(originLocation, destination.id)
                ? true
                : Boolean(
                    existingRegionDestination?.id &&
                    locationHasExitToDestination(originLocation, existingRegionDestination.id),
                );

        if (
            (suppressLocationVehicleExitCreation || suppressRegionVehicleRegionExitCreation) &&
            !alreadyHasMatchingExit
        ) {
            const originVehicleLabel =
                originLocation?.name || originLocation?.id || "unknown location vehicle";
            if (suppressLocationVehicleExitCreation) {
                console.warn(
                    `[${eventLabel}] Suppressed event-created exit from location vehicle `
                    + `"${originVehicleLabel}" to "${exitName}".`,
                );
            } else {
                const originRegionLabel =
                    originRegion?.name || originRegion?.id || "unknown region vehicle";
                console.warn(
                    `[${eventLabel}] Suppressed event-created region exit from region vehicle `
                    + `"${originRegionLabel}" to "${exitName}".`,
                );
            }
            continue;
        }

        if (
            !destination &&
            isRegion &&
            typeof createRegionStubFromEvent === "function"
        ) {
            try {
                destination =
                    (await createRegionStubFromEvent({
                        name: exitName,
                        originLocation,
                        description: entry?.description || `Entrance to ${exitName}.`,
                        travelTimeMinutes: Number.isFinite(entry?.travelTimeMinutes)
                            ? entry.travelTimeMinutes
                            : undefined,
                        vehicleType: entry?.vehicleType || null,
                        isVehicle: Boolean(entry?.vehicleType),
                    })) || null;
                createdRegionStub = Boolean(destination);
            } catch (error) {
                throw new Error(
                    `[${eventLabel}] Failed to create region stub for "${exitName}": ${error.message}`,
                );
            }
        }

        if (!destination && typeof createLocationFromEvent === "function") {
            try {
                destination = await createLocationFromEvent({
                    name: exitName,
                    originLocation,
                    descriptionHint:
                        entry?.description || `A path leading to ${exitName}.`,
                    travelTimeMinutes: Number.isFinite(entry?.travelTimeMinutes)
                        ? entry.travelTimeMinutes
                        : undefined,
                    vehicleType: entry?.vehicleType || null,
                    isVehicle: Boolean(entry?.vehicleType),
                    expandStub: false,
                    targetRegionId: destinationRegion?.id || null,
                });
            } catch (error) {
                throw new Error(
                    `[${eventLabel}] Failed to create destination "${exitName}": ${error.message}`,
                );
            }
        }

        if (!destination) {
            throw new Error(
                `[${eventLabel}] Unable to resolve destination for exit "${exitName}".`,
            );
        }

        if (
            destination?.id &&
            originLocation?.id &&
            destination.id === originLocation.id
        ) {
            if (movePlayer) {
                await movePlayerToDestination(eventsInstance, destination, context, {
                    fallbackName: exitName,
                    label: moveLabel,
                });
            }
            continue;
        }

        const destinationRegionRaw = isRegion
            ? destination?.stubMetadata?.regionId ||
            destination?.stubMetadata?.targetRegionId ||
            destination?.regionId ||
            null
            : typeof destination?.regionId === "string"
                ? destination.regionId
                : typeof destination?.stubMetadata?.regionId === "string"
                    ? destination.stubMetadata.regionId
                    : typeof destination?.stubMetadata?.targetRegionId === "string"
                        ? destination.stubMetadata.targetRegionId
                        : null;

        const destinationRegionId =
            typeof destinationRegionRaw === "string"
                ? destinationRegionRaw.trim() || null
                : destinationRegionRaw === null
                    ? null
                    : undefined;

        if (isRegion && !destinationRegionId) {
            throw new Error(
                `[${eventLabel}] Destination region metadata missing for exit "${exitName}".`,
            );
        }

        const exitDescription =
            entry?.description || `Path to ${destination.name || exitName}`;
        const vehicleType = entry?.vehicleType || null;
        const isVehicleExit = Boolean(vehicleType);
        let originExit = null;

        if (!createdRegionStub) {
            try {
                originExit = ensureExitConnection(originLocation, destination, {
                    description: exitDescription,
                    bidirectional: !isRegion,
                    destinationRegion: destinationRegionId,
                    travelTimeMinutes: Number.isFinite(entry?.travelTimeMinutes)
                        ? entry.travelTimeMinutes
                        : undefined,
                    isVehicle: isVehicleExit,
                    vehicleType,
                });
            } catch (error) {
                throw new Error(
                    `[${eventLabel}] Failed to ensure exit connection to "${destination.name || exitName}": ${error.message}`,
                );
            }
        } else {
            originExit = findExitToDestination(originLocation, destination.id)?.exit || null;
        }

        entry.originLocationId = originLocation?.id || null;
        entry.exitLocationId = originLocation?.id || null;
        entry.originRegionId = originRegion?.id || originRegionId || null;
        entry.exitRegionId = originRegion?.id || originRegionId || null;
        entry.destinationId = destination?.id || null;
        entry.destinationKind = isRegion ? "region" : "location";
        entry.destinationRegionId = destinationRegionId || destinationRegion?.id || null;
        if (originExit?.id) {
            entry.exitId = originExit.id;
        }
        if (!entry.exitLocationName && originLocationName) {
            entry.exitLocationName = originLocationName;
        }
        if (!entry.exitRegionName && originRegion?.name) {
            entry.exitRegionName = originRegion.name;
        }
        if (!entry.destinationLocationName && !isRegion && destination?.name) {
            entry.destinationLocationName = destination.name;
        }

        if (!isRegion) {
            try {
                ensureExitConnection(destination, originLocation, {
                    description:
                        entry?.reverseDescription ||
                        `Path back to ${originLocation.name || originLocation.id || "origin"}`,
                    bidirectional: true,
                    destinationRegion: originRegionId,
                    travelTimeMinutes: Number.isFinite(entry?.travelTimeMinutes)
                        ? entry.travelTimeMinutes
                        : undefined,
                    isVehicle: isVehicleExit,
                    vehicleType,
                });
            } catch (error) {
                throw new Error(
                    `[${eventLabel}] Failed to ensure reverse exit from "${destination.name || exitName}": ${error.message}`,
                );
            }
        }

        if (movePlayer) {
            try {
                await movePlayerToDestination(eventsInstance, destination, context, {
                    fallbackName: exitName,
                    label: moveLabel,
                });
            } catch (error) {
                throw new Error(
                    `[${eventLabel}] Failed to move player to "${exitName}": ${error.message}`,
                );
            }
        }
    }
}

async function movePlayerToDestination(
    eventsInstance,
    destination,
    context = {},
    { fallbackName = null, label = "move_location" } = {},
) {
    const player = context.player || eventsInstance.currentPlayer;
    const enforceSinglePlayerMovePerTurn =
        !player?.isNPC && context?.allowAdditionalPlayerMoves !== true;

    const { Location, findLocationByNameLoose, createLocationFromEvent } =
        eventsInstance._deps || {};

    if (
        !player ||
        typeof player.setLocation !== "function" ||
        !Location ||
        typeof Location.get !== "function"
    ) {
        throw new Error(
            `[${label}] Missing movement dependencies (player/setLocation/Location.get).`,
        );
    }

    let destinationObject = null;
    let destinationName = null;

    if (destination && typeof destination === "object") {
        destinationObject = destination;
        destinationName =
            typeof destination.name === "string" ? destination.name.trim() : null;
        if (!destinationName && typeof destination.id === "string") {
            destinationName = destination.id;
        }
    } else if (typeof destination === "string") {
        destinationName = destination.trim();
    }

    if (!destinationName && typeof fallbackName === "string") {
        destinationName = fallbackName.trim();
    }

    if (!destinationName) {
        throw new Error(`[${label}] Missing destination name.`);
    }

    // Prevent multi-hop movement in one turn: once the player has already moved,
    // suppress any additional event-driven move attempts, even to a different destination.
    if (enforceSinglePlayerMovePerTurn && Globals.processedMove) {
        return;
    }

    if (!destinationObject) {
        try {
            destinationObject = Location.get(destinationName);
        } catch (_) {
            destinationObject = null;
        }

        if (!destinationObject && typeof Location.findByName === "function") {
            try {
                destinationObject = Location.findByName(destinationName);
            } catch (_) {
                destinationObject = null;
            }
        }

        if (!destinationObject) {
            destinationObject = findLocationByNameLoose(destinationName) || null;
        }

        if (!destinationObject) {
            let originLocation = context.location || null;
            if (!originLocation && player?.currentLocation) {
                try {
                    originLocation = Location.get(player.currentLocation) || null;
                } catch (_) {
                    originLocation = null;
                }
            }
            if (!originLocation) {
                throw new Error(
                    `[${label}] Unable to resolve destination "${destinationName}" and origin location is unknown.`,
                );
            }
            try {
                destinationObject = await createLocationFromEvent({
                    name: destinationName,
                    originLocation,
                    descriptionHint: `Path leading from ${originLocation.name || originLocation.id} toward ${destinationName}.`,
                    expandStub: false,
                });
            } catch (error) {
                throw new Error(
                    `[${label}] Failed to create destination "${destinationName}": ${error.message}`,
                );
            }
        }
    }

    if (!destinationObject || !destinationObject.id) {
        throw new Error(
            `[${label}] Unable to resolve destination "${destinationName}".`,
        );
    }

    const trackingName =
        destinationObject.name || destinationName || destinationObject.id;
    // Destination-name de-dupe for repeated entries targeting the same place.
    // Cross-destination double moves are prevented by the Globals.processedMove guard above.
    if (trackingName && eventsInstance.movedLocations.has(trackingName)) {
        return;
    }

    const destinationId = destinationObject.id;
    const originLocation = resolveEventMoveOriginLocation({
        Location,
        player,
        context,
        label,
    });
    if (
        eventMoveTargetsActiveVehicleDestination({
            eventsInstance,
            Location,
            player,
            originLocation,
            destinationObject,
            destinationName,
        })
    ) {
        context.suppressedActiveVehicleDestinationMove = true;
        console.warn(
            `[${label}] Suppressing event move to active in-motion vehicle destination "${trackingName}". Vehicle arrival must be resolved by elapsed time.`,
        );
        return;
    }

    await maybeBackfillEventMoveTravelTimes({
        eventsInstance,
        originLocation,
        destinationLocation: destinationObject,
        player
    });

    if (!player.isNPC && typeof Globals.recordPlayerArrivalVisitState === "function") {
        Globals.recordPlayerArrivalVisitState(destinationObject);
    }
    player.setLocation(destinationObject.id);
    // setLocation may refuse unresolved ids; treat that as move failure so we do not emit
    // downstream "move happened" effects for a move that never actually applied.
    if (player.currentLocation !== destinationId) {
        throw new Error(
            `[${label}] Player location did not resolve to destination id "${destinationId}".`,
        );
    }
    context.location = destinationObject;
    // Track destination only after successful location application.
    if (trackingName) {
        eventsInstance.movedLocations.add(trackingName);
    }
    applyEventMoveTravelTime({
        eventsInstance,
        Location,
        player,
        context,
        originLocation,
        destinationObject,
        label,
    });
    // Mark processedMove only after success so turn systems stay consistent.
    if (!player.isNPC) {
        Globals.processedMove = true;
    }
}

function resolveEventMoveOriginLocation({ Location, player, context = {}, label = "move_location" } = {}) {
    if (context.location && typeof context.location === "object") {
        return context.location;
    }

    const currentLocationId = typeof player?.currentLocation === "string"
        ? player.currentLocation.trim()
        : "";
    if (!currentLocationId) {
        return null;
    }

    if (!Location || typeof Location.get !== "function") {
        throw new Error(`[${label}] Cannot resolve movement origin without Location.get.`);
    }

    return Location.get(currentLocationId) || null;
}

function eventLocationContextRepresentsVehicle(eventsInstance, location) {
    if (!location || typeof location !== "object") {
        return false;
    }

    if (
        location.isVehicle === true ||
        (location.vehicleInfo && typeof location.vehicleInfo === "object" && !Array.isArray(location.vehicleInfo))
    ) {
        return true;
    }

    const findRegionByLocationId = eventsInstance?._deps?.findRegionByLocationId;
    if (typeof findRegionByLocationId !== "function" || !location.id) {
        return false;
    }

    const region = findRegionByLocationId(location.id);
    return Boolean(
        region &&
        (
            region.isVehicle === true ||
            (region.vehicleInfo && typeof region.vehicleInfo === "object" && !Array.isArray(region.vehicleInfo))
        )
    );
}

function getEventLocationRegion(eventsInstance, location) {
    if (!location || typeof location !== "object") {
        return null;
    }
    if (location.region && typeof location.region === "object") {
        return location.region;
    }
    const findRegionByLocationId = eventsInstance?._deps?.findRegionByLocationId;
    if (typeof findRegionByLocationId !== "function" || !location.id) {
        return null;
    }
    return findRegionByLocationId(location.id) || null;
}

function resolveEventTravelTimeBackfillRegionIdentity(eventsInstance, location) {
    if (!location || typeof location !== "object") {
        return { id: null, region: null };
    }

    const region = getEventLocationRegion(eventsInstance, location);
    const regionId = typeof region?.id === "string" && region.id.trim()
        ? region.id.trim()
        : (typeof location.regionId === "string" && location.regionId.trim()
            ? location.regionId.trim()
            : (typeof location.stubMetadata?.regionId === "string" && location.stubMetadata.regionId.trim()
                ? location.stubMetadata.regionId.trim()
                : (typeof location.stubMetadata?.targetRegionId === "string" && location.stubMetadata.targetRegionId.trim()
                    ? location.stubMetadata.targetRegionId.trim()
                    : null)));

    return {
        id: regionId,
        region
    };
}

async function maybeBackfillEventMoveTravelTimes({
    eventsInstance,
    originLocation = null,
    destinationLocation = null,
    player = null
} = {}) {
    if (player?.isNPC) {
        return null;
    }
    if (!destinationLocation || typeof destinationLocation !== "object") {
        return null;
    }

    const backfillRegionExitTravelTimes = eventsInstance?._deps?.backfillRegionExitTravelTimes;
    if (typeof backfillRegionExitTravelTimes !== "function") {
        return null;
    }

    const destinationRegion = resolveEventTravelTimeBackfillRegionIdentity(eventsInstance, destinationLocation);
    if (!destinationRegion.id && !destinationRegion.region) {
        return null;
    }

    const originRegion = resolveEventTravelTimeBackfillRegionIdentity(eventsInstance, originLocation);
    if (originRegion.id && destinationRegion.id && originRegion.id === destinationRegion.id) {
        return null;
    }

    try {
        if (destinationRegion.region) {
            return await backfillRegionExitTravelTimes({ region: destinationRegion.region, locationOverride: destinationLocation });
        }
        return await backfillRegionExitTravelTimes({ regionId: destinationRegion.id, locationOverride: destinationLocation });
    } catch (error) {
        console.warn('Event travel-time backfill failed; continuing without updated exit travel times:', error?.message || error);
        return null;
    }
}

function vehicleStateIsInMotion(vehicleState) {
    if (!vehicleState || typeof vehicleState !== "object") {
        return false;
    }
    const vehicleInfo =
        vehicleState.vehicleInfo &&
            typeof vehicleState.vehicleInfo === "object" &&
            !Array.isArray(vehicleState.vehicleInfo)
            ? vehicleState.vehicleInfo
            : vehicleState;

    if (vehicleState.isUnderway === true || vehicleInfo.isUnderway === true) {
        return vehicleState.hasArrived !== true && vehicleInfo.hasArrived !== true;
    }
    if (vehicleState.hasArrived === true || vehicleInfo.hasArrived === true) {
        return false;
    }

    const normalizedVehicleInfo = new VehicleInfo(vehicleInfo);
    return normalizedVehicleInfo.isUnderway && !normalizedVehicleInfo.hasArrived;
}

function collectActiveVehicleStates(eventsInstance, player, originLocation) {
    const states = [];
    const currentVehicle = player?.currentVehicle;
    if (currentVehicle && typeof currentVehicle === "object") {
        states.push(currentVehicle);
    }
    if (
        originLocation &&
        typeof originLocation === "object" &&
        (
            originLocation.isVehicle === true ||
            (originLocation.vehicleInfo && typeof originLocation.vehicleInfo === "object" && !Array.isArray(originLocation.vehicleInfo))
        )
    ) {
        states.push({
            name: originLocation.name || originLocation.id || "",
            vehicleInfo: originLocation.vehicleInfo || {},
        });
    }

    const originRegion = getEventLocationRegion(eventsInstance, originLocation);
    if (
        originRegion &&
        (
            originRegion.isVehicle === true ||
            (originRegion.vehicleInfo && typeof originRegion.vehicleInfo === "object" && !Array.isArray(originRegion.vehicleInfo))
        )
    ) {
        states.push({
            name: originRegion.name || originRegion.id || "",
            vehicleInfo: originRegion.vehicleInfo || {},
        });
    }

    return states;
}

function buildVehicleDestinationCandidates(vehicleState, { Location, eventsInstance } = {}) {
    const candidates = {
        locationIds: new Set(),
        locationNames: new Set(),
        regionIds: new Set(),
        regionNames: new Set(),
    };
    const vehicleInfo =
        vehicleState?.vehicleInfo &&
            typeof vehicleState.vehicleInfo === "object" &&
            !Array.isArray(vehicleState.vehicleInfo)
            ? vehicleState.vehicleInfo
            : vehicleState;

    const addLocationId = (value) => {
        const id = normalizeString(value);
        if (!id) {
            return;
        }
        candidates.locationIds.add(id);
        let location = null;
        if (Location && typeof Location.get === "function") {
            location = Location.get(id) || null;
        }
        if (location) {
            addLocationName(location.name);
            const region = getEventLocationRegion(eventsInstance, location);
            addRegionId(region?.id);
            addRegionName(region?.name);
        }
    };
    const addLocationName = (value) => {
        const key = normalizeDestinationMatchKey(value);
        if (key) {
            candidates.locationNames.add(key);
        }
    };
    const addRegionId = (value) => {
        const id = normalizeString(value);
        if (id) {
            candidates.regionIds.add(id);
        }
    };
    const addRegionName = (value) => {
        const key = normalizeDestinationMatchKey(value);
        if (key) {
            candidates.regionNames.add(key);
        }
    };
    const addRawDestinationText = (value) => {
        const text = normalizeString(value);
        if (!text) {
            return;
        }
        addLocationName(text);
        for (const part of text.split("|")) {
            addLocationName(part);
            addRegionName(part);
        }
    };

    addLocationName(vehicleState?.destination);
    addRawDestinationText(vehicleState?.destination);
    addLocationId(vehicleInfo?.currentDestination);

    const pendingDestination =
        vehicleState?.pendingDestination &&
            typeof vehicleState.pendingDestination === "object" &&
            !Array.isArray(vehicleState.pendingDestination)
            ? vehicleState.pendingDestination
            : vehicleInfo?.pendingDestination;
    if (pendingDestination && typeof pendingDestination === "object") {
        addLocationId(pendingDestination.locationId);
        addLocationName(pendingDestination.locationName);
        addRegionId(pendingDestination.regionId);
        addRegionName(pendingDestination.regionName);
        addRawDestinationText(pendingDestination.rawText);
    }

    return candidates;
}

function destinationMatchesVehicleDestination(
    eventsInstance,
    Location,
    destinationObject,
    destinationName,
    candidates,
) {
    const destinationId = normalizeString(destinationObject?.id);
    if (destinationId && candidates.locationIds.has(destinationId)) {
        return true;
    }
    const destinationReference = normalizeString(destinationName);
    if (
        destinationReference &&
        (
            candidates.locationIds.has(destinationReference) ||
            candidates.regionIds.has(destinationReference)
        )
    ) {
        return true;
    }

    const destinationNameKey = normalizeDestinationMatchKey(
        destinationObject?.name || destinationName,
    );
    if (
        destinationNameKey &&
        (
            candidates.locationNames.has(destinationNameKey) ||
            candidates.regionNames.has(destinationNameKey)
        )
    ) {
        return true;
    }

    const destinationRegion = getEventLocationRegion(eventsInstance, destinationObject);
    const destinationRegionId = normalizeString(destinationRegion?.id || destinationObject?.regionId);
    if (destinationRegionId && candidates.regionIds.has(destinationRegionId)) {
        return true;
    }
    const destinationRegionNameKey = normalizeDestinationMatchKey(destinationRegion?.name);
    return Boolean(
        destinationRegionNameKey &&
        candidates.regionNames.has(destinationRegionNameKey)
    );
}

function eventMoveTargetsActiveVehicleDestination({
    eventsInstance,
    Location,
    player,
    originLocation,
    destinationObject = null,
    destinationName = null,
} = {}) {
    const vehicleStates = collectActiveVehicleStates(eventsInstance, player, originLocation);
    for (const vehicleState of vehicleStates) {
        if (!vehicleStateIsInMotion(vehicleState)) {
            continue;
        }
        const candidates = buildVehicleDestinationCandidates(vehicleState, {
            Location,
            eventsInstance,
        });
        if (
            destinationMatchesVehicleDestination(
                eventsInstance,
                Location,
                destinationObject,
                destinationName,
                candidates,
            )
        ) {
            return true;
        }
    }
    return false;
}

function structuredTravelMoveTargetsActiveVehicleDestination(
    eventsInstance,
    structured,
    { Location, player, originLocation } = {},
) {
    const parsed = structured?.parsed;
    if (!parsed || typeof parsed !== "object") {
        return false;
    }
    const destinationNames = [];
    if (Array.isArray(parsed.move_location)) {
        destinationNames.push(
            ...parsed.move_location.filter((entry) => typeof entry === "string"),
        );
    }
    if (Array.isArray(parsed.move_new_location)) {
        destinationNames.push(
            ...parsed.move_new_location
                .map((entry) => entry?.name)
                .filter((entry) => typeof entry === "string"),
        );
    }
    return destinationNames.some((destinationName) =>
        eventMoveTargetsActiveVehicleDestination({
            eventsInstance,
            Location,
            player,
            originLocation,
            destinationName,
        }),
    );
}

function resolveEventMoveTravelTimeMinutes({ Location, originLocation, destinationLocation, label = "move_location" } = {}) {
    if (!originLocation || !destinationLocation) {
        return 0;
    }
    if (originLocation.id && destinationLocation.id && originLocation.id === destinationLocation.id) {
        return 0;
    }
    if (!Location || typeof Location.findShortestTravelTimeMinutes !== "function") {
        throw new Error(`[${label}] Cannot calculate event movement travel time without Location.findShortestTravelTimeMinutes.`);
    }

    const originReference =
        typeof originLocation.id === "string" && originLocation.id.trim()
            ? originLocation.id
            : originLocation;
    const destinationReference =
        typeof destinationLocation.id === "string" && destinationLocation.id.trim()
            ? destinationLocation.id
            : destinationLocation;

    const shortestTravelTimeMinutes = Location.findShortestTravelTimeMinutes(originReference, destinationReference);
    if (shortestTravelTimeMinutes === null) {
        return 1;
    }
    if (
        !Number.isFinite(shortestTravelTimeMinutes) ||
        !Number.isInteger(shortestTravelTimeMinutes) ||
        shortestTravelTimeMinutes < 0
    ) {
        throw new Error(`[${label}] Event movement travel-time helper returned an invalid minute value.`);
    }
    return shortestTravelTimeMinutes;
}

function applyEventMoveTravelTime({
    eventsInstance,
    Location,
    player,
    context = {},
    originLocation,
    destinationObject,
    label = "move_location",
} = {}) {
    if (!player || player.isNPC || context.suppressTimeAdvance) {
        return;
    }

    // Once movement succeeds, route/exit travel time is authoritative for this
    // event pass. A prompt-authored time_passed entry should only apply when no
    // travel happened, even if this specific route has no positive time cost.
    context.suppressTimeAdvance = true;

    if (eventLocationContextRepresentsVehicle(eventsInstance, originLocation)) {
        return;
    }

    const travelTimeMinutes = resolveEventMoveTravelTimeMinutes({
        Location,
        originLocation,
        destinationLocation: destinationObject,
        label,
    });
    if (travelTimeMinutes <= 0) {
        return;
    }

    context.timeProgress = Globals.advanceTime(travelTimeMinutes, { source: "event_move_travel" });
    applyTimeBasedNeedBarEffectsAfterTimeAdvance(context);
}

function applyTimeBasedNeedBarEffectsAfterTimeAdvance(context = {}) {
    const adjustments = Player.applyStatusEffectNeedBarsToAll();
    if (Array.isArray(adjustments) && adjustments.length) {
        if (!Array.isArray(context.timeBasedNeedBarAdjustments)) {
            context.timeBasedNeedBarAdjustments = [];
        }
        context.timeBasedNeedBarAdjustments.push(...adjustments);
    }
    return adjustments;
}

function extractInteger(raw) {
    if (typeof raw !== "string") {
        return null;
    }
    const match = raw.match(/(-?\d+)/);
    return match ? parseInt(match[1], 10) : null;
}

function ensureArray(value) {
    if (Array.isArray(value)) {
        return value;
    }
    if (value === null || value === undefined) {
        return [];
    }
    return [value];
}

function flattenAndFilter(list) {
    const result = [];
    for (const entry of list) {
        if (Array.isArray(entry)) {
            result.push(...entry);
        } else if (entry !== null && entry !== undefined) {
            result.push(entry);
        }
    }
    return result;
}

function makeStatusEffect(description, duration = null) {
    return new StatusEffect({
        description,
        duration,
    });
}

function extractStatusEffectDescription(effectLike) {
    if (!effectLike || typeof effectLike !== "object") {
        return "";
    }
    if (
        typeof effectLike.description === "string" &&
        effectLike.description.trim()
    ) {
        return effectLike.description.trim();
    }
    if (typeof effectLike.name === "string" && effectLike.name.trim()) {
        return effectLike.name.trim();
    }
    if (typeof effectLike.text === "string" && effectLike.text.trim()) {
        return effectLike.text.trim();
    }
    return "";
}

function normalizeStatusEffectDescription(value) {
    if (typeof value !== "string") {
        return "";
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return "";
    }
    return trimmed.replace(/\s+/g, " ").toLowerCase();
}

function buildItemActorPairKey(itemName, actorName) {
    const normalizedItem = normalizeString(itemName).toLowerCase();
    const normalizedActor = normalizeString(actorName).toLowerCase();
    if (!normalizedItem || !normalizedActor) {
        return "";
    }
    return `${normalizedItem}|${normalizedActor}`;
}

function normalizeItemTargetEntries(entries, { includeStatus = false } = {}) {
    if (!Array.isArray(entries) || !entries.length) {
        return [];
    }

    const normalizedEntries = [];
    for (const entry of entries) {
        if (!entry) {
            continue;
        }

        let itemName = "";
        let targetName = "";
        let status = null;

        if (typeof entry === "string") {
            const [item, target, rawStatus] = splitArrowParts(entry, includeStatus ? 3 : 2);
            itemName = item ? String(item).trim() : "";
            targetName = target ? String(target).trim() : "";
            status = rawStatus ? String(rawStatus).trim() : null;
        } else {
            itemName =
                typeof entry.item === "string"
                    ? entry.item.trim()
                    : (typeof entry.itemName === "string" ? entry.itemName.trim() : "");
            targetName =
                typeof entry.target === "string"
                    ? entry.target.trim()
                    : (typeof entry.targetName === "string" ? entry.targetName.trim() : "");
            if (typeof entry.status === "string" && entry.status.trim()) {
                status = entry.status.trim();
            }
        }

        if (!itemName || !targetName) {
            continue;
        }

        const normalizedEntry = { itemName, targetName };
        if (includeStatus) {
            normalizedEntry.status = status;
        }
        normalizedEntries.push(normalizedEntry);
    }

    return normalizedEntries;
}

function collectItemTargetStatusEffects(item) {
    const effects = [];

    const addEffect = (effectLike) => {
        if (!effectLike) {
            return;
        }
        if (Array.isArray(effectLike)) {
            effectLike.forEach(addEffect);
            return;
        }
        if (typeof effectLike !== "object") {
            return;
        }

        if (Object.prototype.hasOwnProperty.call(effectLike, "applyToTarget")) {
            if (!effectLike.applyToTarget) {
                return;
            }
        }

        effects.push(effectLike);
    };

    addEffect(item?.causeStatusEffectOnTarget);
    addEffect(item?.metadata?.causeStatusEffectOnTarget);

    const legacyEffect = item?.causeStatusEffect;
    if (Array.isArray(legacyEffect)) {
        legacyEffect.forEach((entry) => {
            if (entry?.applyToTarget) {
                addEffect(entry);
            }
        });
    } else if (legacyEffect?.applyToTarget) {
        addEffect(legacyEffect);
    }

    const deduped = [];
    const seen = new Set();
    for (const effect of effects) {
        const key = normalizeStatusEffectDescription(
            extractStatusEffectDescription(effect) || effect?.name || "",
        );
        if (key && seen.has(key)) {
            continue;
        }
        if (key) {
            seen.add(key);
        }
        deduped.push(effect);
    }

    return deduped;
}

async function applyItemTriggeredStatuses(eventsInstance, entries, context = {}, {
    eventLabel,
    skipPairKeys = null,
    requireStatusField = false,
} = {}) {
    if (!Array.isArray(entries) || !entries.length) {
        return;
    }
    if (!eventLabel || typeof eventLabel !== "string") {
        throw new Error("applyItemTriggeredStatuses requires an eventLabel.");
    }

    const { findThingByName, findActorByName } = eventsInstance._deps;
    if (typeof findThingByName !== "function") {
        throw new Error(
            `${eventLabel} handler requires findThingByName dependency.`,
        );
    }
    if (typeof findActorByName !== "function") {
        throw new Error(
            `${eventLabel} handler requires findActorByName dependency.`,
        );
    }

    const normalizedEntries = normalizeItemTargetEntries(entries, {
        includeStatus: requireStatusField,
    });
    const missingItems = new Set();

    for (const entry of normalizedEntries) {
        if (!findThingByName(entry.itemName)) {
            missingItems.add(entry.itemName);
        }
    }

    if (missingItems.size) {
        await eventsInstance._ensureItemsExist(
            Array.from(missingItems),
            context.location,
            { recordNewItems: false },
        );
    }

    for (const entry of normalizedEntries) {
        const pairKey = buildItemActorPairKey(entry.itemName, entry.targetName);
        if (pairKey && skipPairKeys instanceof Set && skipPairKeys.has(pairKey)) {
            console.debug(
                `[${eventLabel}] Skipping "${entry.itemName}" for "${entry.targetName}" because item_ingest already applied it this turn.`,
            );
            continue;
        }

        const item = findThingByName(entry.itemName);
        if (!item) {
            console.warn(
                `[${eventLabel}] Unable to locate item "${entry.itemName}".`,
            );
            continue;
        }
        const target = findActorByName(entry.targetName);
        if (!target || typeof target.addStatusEffect !== "function") {
            console.warn(
                `[${eventLabel}] Unable to locate target "${entry.targetName}" for "${entry.itemName}".`,
            );
            continue;
        }

        const effects = collectItemTargetStatusEffects(item);
        if (!effects.length) {
            continue;
        }

        for (const effect of effects) {
            const effectDescription = extractStatusEffectDescription(effect);
            if (!effectDescription) {
                console.warn(
                    `[${eventLabel}] "${entry.itemName}" has no target status effect description; skipping application to "${entry.targetName}".`,
                );
                continue;
            }

            try {
                const effectToApply = effect instanceof StatusEffect
                    ? effect.toJSON()
                    : { ...effect };
                // Item effects are reusable templates. Let Player stamp every
                // application with the receiving actor's current world minute.
                delete effectToApply.appliedAt;
                const appliedEffect = target.addStatusEffect(
                    effectToApply,
                    effect.duration ?? 1,
                );
                eventsInstance.alteredCharacters.add(entry.targetName);

                if (!Array.isArray(context.itemTriggeredStatusChanges)) {
                    context.itemTriggeredStatusChanges = [];
                }
                if (!(context.itemTriggeredStatusChangeKeys instanceof Set)) {
                    context.itemTriggeredStatusChangeKeys = new Set();
                }

                const resolvedTargetName =
                    typeof target.name === "string" && target.name.trim()
                        ? target.name.trim()
                        : entry.targetName;
                const resolvedDescription =
                    extractStatusEffectDescription(appliedEffect) ||
                    effectDescription;
                const changeKey = `${normalizeString(
                    resolvedTargetName,
                ).toLowerCase()}|gained|${normalizeStatusEffectDescription(
                    resolvedDescription,
                )}`;

                if (
                    !context.itemTriggeredStatusChangeKeys.has(changeKey)
                ) {
                    context.itemTriggeredStatusChangeKeys.add(changeKey);
                    context.itemTriggeredStatusChanges.push({
                        entity: resolvedTargetName,
                        action: "gained",
                        name:
                            typeof appliedEffect?.name === "string" && appliedEffect.name.trim()
                                ? appliedEffect.name.trim()
                                : (typeof effect?.name === "string" && effect.name.trim()
                                    ? effect.name.trim()
                                    : null),
                        detail: resolvedDescription,
                        description: resolvedDescription,
                        itemName: entry.itemName,
                        source: eventLabel,
                    });
                }
            } catch (error) {
                console.warn(
                    `Failed to apply ${eventLabel} status effect from "${entry.itemName}" to "${entry.targetName}":`,
                    error?.message || error,
                );
            }
        }
    }
}

function resolveFactionByReference(rawValue) {
    const key = normalizeString(rawValue);
    if (!key) {
        return null;
    }

    if (typeof Faction.getById === "function") {
        const byId = Faction.getById(key);
        if (byId) {
            return byId;
        }
    }

    if (typeof Faction.getByName === "function") {
        const byName = Faction.getByName(key);
        if (byName) {
            return byName;
        }
    }

    return null;
}

function scoreDispositionText(rawValue) {
    const normalized = normalizeString(rawValue).toLowerCase();
    if (!normalized) {
        return 0;
    }

    const tokens = normalized
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean);

    if (!tokens.length) {
        return 0;
    }

    let score = 0;
    for (const token of tokens) {
        if (DISPOSITION_POSITIVE_KEYWORDS.has(token)) {
            score += 1;
            continue;
        }
        if (DISPOSITION_NEGATIVE_KEYWORDS.has(token)) {
            score -= 1;
        }
    }

    return score;
}

function resolveDispositionDirection(beforeText, afterText) {
    const beforeNormalized = normalizeString(beforeText).toLowerCase();
    const afterNormalized = normalizeString(afterText).toLowerCase();
    if (!beforeNormalized && !afterNormalized) {
        return 0;
    }
    if (beforeNormalized === afterNormalized) {
        return 0;
    }

    const beforeScore = scoreDispositionText(beforeNormalized);
    const afterScore = scoreDispositionText(afterNormalized);
    if (afterScore > beforeScore) {
        return 1;
    }
    if (afterScore < beforeScore) {
        return -1;
    }

    // Handle phrasing like "less suspicious", "no longer hostile", "more trusting".
    const hasLessQualifier =
        /\bless\b/.test(afterNormalized) || /\bno longer\b/.test(afterNormalized);
    const hasMoreQualifier =
        /\bmore\b/.test(afterNormalized) || /\bincreasingly\b/.test(afterNormalized);
    if (beforeScore !== 0) {
        if (hasLessQualifier) {
            return -Math.sign(beforeScore);
        }
        if (hasMoreQualifier) {
            return Math.sign(beforeScore);
        }
    }

    if (/\bbetter\b|\bfriendlier\b|\bwarmer\b/.test(afterNormalized)) {
        return 1;
    }
    if (/\bworse\b|\bhostile\b|\bangrier\b|\bcolder\b/.test(afterNormalized)) {
        return -1;
    }

    return 0;
}

class Events {
    static DEFAULT_STATUS_DURATION = DEFAULT_STATUS_DURATION;
    static MAJOR_STATUS_DURATION = MAJOR_STATUS_DURATION;
    static PROMPT_LAUNCH_STAGGER_MS = 4000;
    static _deps = {};
    static _parsers = {};
    static _aggregators = {};
    static _handlers = {};
    static _baseTimeout = BASE_TIMEOUT_MS;
    static _maintenancePromptTurnCounters = {
        housekeepingTurnCounter: 0,
        questCheckTurnCounter: 0,
    };

    static resolvePromptLaunchStaggerMs(configOverride = Globals?.config) {
        const raw = configOverride?.stagger_concurrent_prompts;
        if (raw === undefined || raw === null || raw === "") {
            return this.PROMPT_LAUNCH_STAGGER_MS;
        }
        const seconds = Number(raw);
        if (!Number.isFinite(seconds) || seconds < 0) {
            throw new Error("stagger_concurrent_prompts must be a non-negative finite number of seconds when provided.");
        }
        return seconds * 1000;
    }

    static runAfterPromptLaunchDelay(delayMs, task) {
        if (typeof task !== "function") {
            return Promise.reject(new Error("runAfterPromptLaunchDelay requires a task function."));
        }
        if (typeof delayMs !== "number" || !Number.isFinite(delayMs) || delayMs < 0) {
            return Promise.reject(new Error("runAfterPromptLaunchDelay requires a non-negative finite delayMs number."));
        }
        if (delayMs === 0) {
            return Promise.resolve().then(task);
        }
        return new Promise((resolve) => {
            setTimeout(resolve, delayMs);
        }).then(task);
    }

    static _resolveMaintenancePromptInterval(rawInterval, configPath) {
        if (rawInterval === undefined || rawInterval === null || rawInterval === "") {
            return 1;
        }
        const interval = Number(rawInterval);
        if (!Number.isInteger(interval) || interval < 1) {
            throw new Error(`${configPath} must be an integer greater than or equal to 1 when provided.`);
        }
        return interval;
    }

    static resolveHousekeepingInterval(configOverride = this.config || Globals?.config) {
        return this._resolveMaintenancePromptInterval(
            configOverride?.housekeeping?.interval,
            "housekeeping.interval",
        );
    }

    static resolveQuestCheckInterval(configOverride = this.config || Globals?.config) {
        return this._resolveMaintenancePromptInterval(
            configOverride?.quest_checks?.interval,
            "quest_checks.interval",
        );
    }

    static resetMaintenancePromptTurnCounters() {
        this._maintenancePromptTurnCounters = {
            housekeepingTurnCounter: 0,
            questCheckTurnCounter: 0,
        };
    }

    static resetQuestCheckTurnCounter() {
        this._maintenancePromptTurnCounters.questCheckTurnCounter = 0;
    }

    static hydrateMaintenancePromptTurnCounters(metadata = {}) {
        const resolveCounter = (value) => {
            const numeric = Number(value);
            return Number.isInteger(numeric) && numeric >= 0 ? numeric : 0;
        };
        this._maintenancePromptTurnCounters = {
            housekeepingTurnCounter: resolveCounter(metadata?.housekeepingTurnCounter),
            questCheckTurnCounter: resolveCounter(metadata?.questCheckTurnCounter),
        };
        return this.getMaintenancePromptTurnCounters();
    }

    static getMaintenancePromptTurnCounters() {
        return { ...this._maintenancePromptTurnCounters };
    }

    static eventResultIndicatesAnyQuestObjectivesCompleted(eventResult) {
        const parsed = eventResult?.structured?.parsed || eventResult?.parsed || null;
        if (!parsed || typeof parsed !== "object") {
            return false;
        }
        const signal = parsed.any_quest_objectives_completed;
        return Array.isArray(signal)
            ? signal.some((value) => value === true)
            : signal === true;
    }

    static async resolveEventSignaledQuestCheck({
        eventResult = null,
        existingQuestResult = null,
    } = {}) {
        if (!this.eventResultIndicatesAnyQuestObjectivesCompleted(eventResult)) {
            return existingQuestResult;
        }

        const questResult = existingQuestResult === null || existingQuestResult === undefined
            ? await this.runQuestChecks({ bypassInterval: true })
            : existingQuestResult;
        if (questResult !== null && questResult !== undefined) {
            this.resetQuestCheckTurnCounter();
        }
        return questResult;
    }

    static shouldRunAutomaticHousekeepingThisTurn(configOverride = this.config || Globals?.config) {
        const interval = this.resolveHousekeepingInterval(configOverride);
        this._maintenancePromptTurnCounters.housekeepingTurnCounter += 1;
        return this._maintenancePromptTurnCounters.housekeepingTurnCounter % interval === 0;
    }

    static _shouldRunQuestCheckThisTurn(configOverride = this.config || Globals?.config) {
        const interval = this.resolveQuestCheckInterval(configOverride);
        this._maintenancePromptTurnCounters.questCheckTurnCounter += 1;
        return this._maintenancePromptTurnCounters.questCheckTurnCounter % interval === 0;
    }

    static animatedItems = new SanitizedStringSet();
    static alteredItems = new SanitizedStringSet();
    static newItems = new SanitizedStringSet();
    static obtainedItems = new SanitizedStringSet();
    static destroyedItems = new SanitizedStringSet();
    static droppedItems = new SanitizedStringSet();

    static alteredCharacters = new SanitizedStringSet();
    static newCharacters = new SanitizedStringSet();
    static arrivedCharacters = new SanitizedStringSet();
    static departedCharacters = new SanitizedStringSet();
    static defeatedEnemies = new SanitizedStringSet();

    static movedLocations = new SanitizedStringSet();

    static _resetTrackingSets() {
        Events.animatedItems.clear();
        Events.alteredItems.clear();
        Events.newItems.clear();
        Events.obtainedItems.clear();
        Events.destroyedItems.clear();
        Events.droppedItems.clear();

        Events.alteredCharacters.clear();
        Events.newCharacters.clear();
        Events.arrivedCharacters.clear();
        Events.departedCharacters.clear();
        Events.defeatedEnemies.clear();

        Events.movedLocations.clear();
    }

    static _isItemAlreadyTracked(name) {
        if (typeof name !== "string") {
            return false;
        }
        const trimmed = name.trim();
        if (!trimmed) {
            return false;
        }
        return this.newItems.has(trimmed) || this.obtainedItems.has(trimmed);
    }

    static _formatEventEntryForLog(entry) {
        if (entry === null || entry === undefined) {
            return String(entry);
        }
        if (typeof entry === "string") {
            return entry;
        }
        try {
            return JSON.stringify(entry);
        } catch (_) {
            return String(entry);
        }
    }

    static _formatEventErrorForLog(error) {
        if (error instanceof Error && error.message) {
            return error.message;
        }
        if (error && typeof error.message === "string") {
            return error.message;
        }
        return String(error);
    }

    static _warnEventEntryFailures(eventKey, failures = []) {
        const normalizedFailures = Array.isArray(failures)
            ? failures.filter((failure) => failure?.error)
            : [];
        if (!normalizedFailures.length) {
            return;
        }

        const entryLabel = normalizedFailures.length === 1 ? "entry" : "entries";
        const details = normalizedFailures
            .map((failure, index) => {
                const entryText = this._formatEventEntryForLog(failure.entry);
                const errorText = this._formatEventErrorForLog(failure.error);
                return `${index + 1}. ${entryText}: ${errorText}`;
            })
            .join("\n");
        console.warn(
            `${eventKey}: skipped ${normalizedFailures.length} ${entryLabel} after per-entry failure:\n${details}`,
        );
    }

    static async _applyIndependentEventEntries(eventKey, entries, applyEntry) {
        const failures = [];
        for (const entry of entries) {
            try {
                // eslint-disable-next-line no-await-in-loop
                await applyEntry(entry);
            } catch (error) {
                failures.push({ entry, error });
            }
        }
        this._warnEventEntryFailures(eventKey, failures);
        return failures;
    }

    static _buildSceneItemNameSet(location, eventLabel = "item_appear") {
        const resolvedLocation = this.resolveLocationCandidate(location);
        if (!resolvedLocation) {
            throw new Error(
                `[${eventLabel}] Cannot compare new items against scene contents without a valid location.`,
            );
        }
        const sceneThings = resolvedLocation.things;
        if (!Array.isArray(sceneThings)) {
            throw new Error(
                `[${eventLabel}] Location things are unavailable for duplicate checks.`,
            );
        }
        const sceneItemNames = new SanitizedStringSet();
        for (const thing of sceneThings) {
            if (thing && typeof thing.name === "string") {
                sceneItemNames.add(thing.name);
            }
        }
        return sceneItemNames;
    }

    static _findSceneThingByExactName(location, name, eventLabel = "item_appear") {
        const resolvedLocation = this.resolveLocationCandidate(location);
        if (!resolvedLocation) {
            throw new Error(
                `[${eventLabel}] Cannot compare new items against scene contents without a valid location.`,
            );
        }
        const sceneThings = resolvedLocation.things;
        if (!Array.isArray(sceneThings)) {
            throw new Error(
                `[${eventLabel}] Location things are unavailable for duplicate checks.`,
            );
        }
        const normalizedName = normalizeString(name).toLowerCase();
        if (!normalizedName) {
            return null;
        }
        return sceneThings.find((thing) => (
            thing
            && typeof thing.name === "string"
            && thing.name.trim().toLowerCase() === normalizedName
        )) || null;
    }

    static _addQuantityToSceneThingStack(thing, quantity) {
        if (!thing) {
            return false;
        }
        if (!Number.isInteger(quantity) || quantity <= 0) {
            throw new Error(
                `_addQuantityToSceneThingStack requires a positive integer quantity; got "${quantity}".`,
            );
        }

        const updatedCount = this._getThingCount(thing) + quantity;
        thing.count = updatedCount;

        const metadata = thing.metadata && typeof thing.metadata === "object"
            ? thing.metadata
            : {};
        thing.metadata = {
            ...metadata,
            count: updatedCount,
        };

        return true;
    }

    static _parseNeedBarPromptResponse(responseText) {
        if (typeof responseText !== "string" || !responseText.trim()) {
            return [];
        }

        const charactersBlockMatch = responseText.match(
            /<characters\b[\s\S]*<\/characters>/i,
        );
        if (!charactersBlockMatch) {
            throw new Error(
                "Need-bar event check response is missing a <characters> block.",
            );
        }

        const doc = Utils.parseXmlDocument(charactersBlockMatch[0], "text/xml");
        const root = doc?.documentElement;
        if (!root || root.tagName !== "characters") {
            throw new Error(
                "Need-bar event check response did not parse into a <characters> document.",
            );
        }

        const getText = (node, tagName) => {
            if (!node || typeof node.getElementsByTagName !== "function") {
                return "";
            }
            const child = node.getElementsByTagName(tagName)?.[0] || null;
            const text = child?.textContent;
            return typeof text === "string" ? text.trim() : "";
        };

        const sanitizeReason = (value) => {
            if (typeof value !== "string") {
                return null;
            }
            const trimmed = value.trim();
            if (!trimmed || trimmed.toLowerCase() === "n/a") {
                return null;
            }
            return trimmed;
        };

        const entries = [];
        const characterNodes = Array.from(root.getElementsByTagName("character"));
        for (const characterNode of characterNodes) {
            const characterName = getText(characterNode, "name");
            const affectedNeedBarsNode =
                characterNode.getElementsByTagName("affectedNeedBars")?.[0] || null;
            if (!affectedNeedBarsNode) {
                continue;
            }

            const needBarNodes = Array.from(
                affectedNeedBarsNode.getElementsByTagName("needBar"),
            );
            if (!needBarNodes.length) {
                continue;
            }

            if (!characterName) {
                throw new Error(
                    "Need-bar event check response has a <character> with affected need bars but no <name>.",
                );
            }

            for (const needBarNode of needBarNodes) {
                const barId = getText(needBarNode, "id");
                const direction = getText(needBarNode, "changeDirection").toLowerCase();
                const magnitude = getText(needBarNode, "change").toLowerCase();
                const reason = sanitizeReason(getText(needBarNode, "reason"));

                if (!barId || !direction || !magnitude) {
                    throw new Error(
                        `Need-bar event check response entry for "${characterName}" is missing required fields.`,
                    );
                }
                if (magnitude === "none") {
                    continue;
                }

                entries.push({
                    character: characterName,
                    bar: barId,
                    direction,
                    magnitude,
                    reason,
                });
            }
        }

        return entries;
    }

    static _serializeNeedBarPromptEntries(entries = []) {
        if (!Array.isArray(entries) || !entries.length) {
            return "";
        }

        return entries
            .map((entry) => {
                if (!entry) {
                    return "";
                }
                const parts = [
                    entry.character,
                    entry.bar,
                    entry.direction,
                    entry.magnitude,
                ];
                if (entry.reason) {
                    parts.push(entry.reason);
                }
                return parts
                    .map((part) => (typeof part === "string" ? part.trim() : ""))
                    .filter(Boolean)
                    .join(" → ");
            })
            .filter(Boolean)
            .join(" | ");
    }

    static _injectNeedBarPromptEntriesIntoStructured(structured, entries = []) {
        const needBarPromptEntries = Array.isArray(entries) ? entries : [];
        if (!structured || !needBarPromptEntries.length) {
            return;
        }
        if (!structured.parsed || typeof structured.parsed !== "object") {
            structured.parsed = {};
        }
        const existingNeedBarEntries = Array.isArray(structured.parsed.needbar_change)
            ? structured.parsed.needbar_change
            : [];
        structured.parsed.needbar_change = [
            ...existingNeedBarEntries,
            ...needBarPromptEntries,
        ];

        if (!structured.rawEntries || typeof structured.rawEntries !== "object") {
            structured.rawEntries = {};
        }
        const serializedNeedBarEntries =
            this._serializeNeedBarPromptEntries(needBarPromptEntries);
        if (serializedNeedBarEntries) {
            const existingRawNeedBarEntries =
                typeof structured.rawEntries.needbar_change === "string"
                    ? structured.rawEntries.needbar_change.trim()
                    : "";
            structured.rawEntries.needbar_change = existingRawNeedBarEntries
                ? `${existingRawNeedBarEntries} | ${serializedNeedBarEntries}`
                : serializedNeedBarEntries;
        }
    }

    static _normalizeIgnoredEventKeys(ignoredEventKeys = []) {
        const aliases = new Map([
            ["needbarchange", "needbar_change"],
            ["needbar_change", "needbar_change"],
            ["npcarrival", "npc_arrival_departure"],
            ["npc_arrival", "npc_arrival_departure"],
            ["npcdeparture", "npc_arrival_departure"],
            ["npc_departure", "npc_arrival_departure"],
            ["npcarrivaldeparture", "npc_arrival_departure"],
            ["npc_arrival_departure", "npc_arrival_departure"],
            ["thingarrival", "thing_arrival_departure"],
            ["thing_arrival", "thing_arrival_departure"],
            ["thingdeparture", "thing_arrival_departure"],
            ["thing_departure", "thing_arrival_departure"],
            ["thingarrivaldeparture", "thing_arrival_departure"],
            ["thing_arrival_departure", "thing_arrival_departure"],
            ["thingmovewithcharacter", "thing_move_with_character"],
            ["thing_move_with_character", "thing_move_with_character"],
        ]);
        const sourceValues =
            ignoredEventKeys &&
            typeof ignoredEventKeys !== "string" &&
            typeof ignoredEventKeys[Symbol.iterator] === "function"
                ? Array.from(ignoredEventKeys)
                : ensureArray(ignoredEventKeys);
        const normalized = new Set();
        for (const value of sourceValues) {
            const key = typeof value === "string" ? value.trim() : "";
            if (!key) {
                continue;
            }
            const compact = key.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();
            const snake = key
                .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
                .replace(/[^a-zA-Z0-9]+/g, "_")
                .replace(/^_+|_+$/g, "")
                .toLowerCase();
            normalized.add(aliases.get(compact) || aliases.get(snake) || snake);
        }
        return normalized;
    }

    static _removeIgnoredEventKeysFromStructured(structured, ignoredEventKeys = []) {
        const ignored = this._normalizeIgnoredEventKeys(ignoredEventKeys);
        if (!structured || !ignored.size) {
            return structured;
        }
        if (structured.rawEntries && typeof structured.rawEntries === "object") {
            for (const key of ignored) {
                delete structured.rawEntries[key];
            }
        }
        if (structured.parsed && typeof structured.parsed === "object") {
            for (const key of ignored) {
                delete structured.parsed[key];
            }
        }
        return structured;
    }

    static async _runNeedBarEventChecks({
        baseContext,
        textToCheck,
        actionText = "",
        includePlayerActionBlock = false,
        promptEnv,
        parseXMLTemplate,
    } = {}) {
        if (!Array.isArray(baseContext?.needBarDefinitions) || !baseContext.needBarDefinitions.length) {
            return { responseText: "", entries: [] };
        }

        const useTinyBrainNeedBarChecks = isTinyBrainPromptEnabled(
            Globals.config?.ai,
            "need_bar_event_checks",
        );
        const templateContext = {
            ...baseContext,
            promptType: "need-bars",
            textToCheck,
            actionText,
            includePlayerActionBlock,
            omitGameHistory: true,
        };
        const tinyBrain = useTinyBrainNeedBarChecks
            ? configureTinyBrainPromptContext(
                templateContext,
                "need_bar_event_checks",
            )
            : null;
        const rendered = promptEnv.render("base-context.xml.njk", templateContext);

        const parsedTemplate = parseXMLTemplate(rendered);
        if (!parsedTemplate?.systemPrompt || !parsedTemplate?.generationPrompt) {
            throw new Error("Need-bar event check template did not produce prompts.");
        }

        let requestPayloadForLog = null;
        let responsePayloadForLog = null;
        const responseText = useTinyBrainNeedBarChecks
            ? await this._runTinyBrainNeedBarEventChecks({
                initialRenderedTemplate: rendered,
                templateContext,
                tinyBrain,
                promptEnv,
                parseXMLTemplate,
            })
            : await LLMClient.chatCompletion({
                messages: [
                    { role: "system", content: parsedTemplate.systemPrompt },
                    { role: "user", content: parsedTemplate.generationPrompt },
                ],
                metadataLabel: "need_bar_event_checks",
                timeoutMs: this._baseTimeout,
                temperature: 0,
                validateXML: false,
                requiredRegex: /<characters>[\s\S]*<\/characters>/i,
                dumpReasoningToConsole: true,
                stream: true,
                // captureRequestPayload: (payload) => { requestPayloadForLog = payload; },
                // captureResponsePayload: (payload) => { responsePayloadForLog = payload; }
            });

        if (!useTinyBrainNeedBarChecks) {
            this.logEventCheck({
                systemPrompt: parsedTemplate.systemPrompt,
                generationPrompt: parsedTemplate.generationPrompt,
                responseText,
                metadataLabel: "need_bar_event_checks",
                prefix: "need_bar_event_checks",
                requestPayload: requestPayloadForLog,
                responsePayload: responsePayloadForLog,
            });
        }

        return {
            responseText,
            entries: this._parseNeedBarPromptResponse(responseText),
        };
    }

    static async _runTinyBrainNeedBarEventChecks({
        initialRenderedTemplate,
        templateContext,
        tinyBrain,
        promptEnv,
        parseXMLTemplate,
    }) {
        const configuredRetries = Number(Globals.config?.ai?.retryAttempts);
        const retryAttempts =
            Number.isInteger(configuredRetries) && configuredRetries >= 0
                ? configuredRetries
                : 1;
        const allowedNeedBarIds = Array.isArray(templateContext?.needBarDefinitions)
            ? templateContext.needBarDefinitions
                .map(definition => definition?.id)
                .filter(id => typeof id === "string" && id.trim())
            : [];
        const result = await runTinyBrainPromptProgram({
            initialRenderedTemplate,
            templateContext,
            tinyBrain,
            runnerOptions: {
                promptEnv,
                parseXMLTemplate,
                retryAttempts,
                metadataLabel: "need_bar_event_checks",
                logPrefix: "need_bar_event_checks_tinybrain",
                finalParser: response => parseNeedBarCharactersResult(
                    response,
                    allowedNeedBarIds,
                ),
                complete: async ({ messages, queueReservation }) => {
                    const response = await LLMClient.chatCompletion({
                        messages,
                        queueReservation,
                        metadataLabel: "need_bar_event_checks",
                        metadata: {
                            eventPipeline: "need-bars-tinybrain",
                            promptType: "need-bars",
                        },
                        timeoutMs: this._baseTimeout,
                        temperature: 0,
                        validateXML: false,
                        dumpReasoningToConsole: true,
                        stream: true,
                    });
                    return {
                        aiResponse: response,
                        conversationMessages: [
                            ...messages.map(message => ({ ...message })),
                            { role: "assistant", content: response },
                        ],
                        toolInvocations: [],
                    };
                },
            },
        });
        return result.aiResponse;
    }

    static _trackItemsFromParsing(parsedEntries = {}) {
        const animated = parsedEntries.item_to_npc;
        if (Array.isArray(animated)) {
            for (const entry of animated) {
                const itemName = entry?.item;
                if (!itemName) {
                    continue;
                }
                this.animatedItems.add(itemName);
                this.destroyedItems.add(itemName);
            }
        }

        const altered = parsedEntries.alter_item;
        if (Array.isArray(altered)) {
            for (const entry of altered) {
                const originalName = entry?.from || entry?.originalName;
                const newName = entry?.to || entry?.newName;

                if (originalName) {
                    this.alteredItems.add(originalName);
                }
                if (newName) {
                    this.alteredItems.add(newName);
                }

                if (!entry?.from && originalName) {
                    entry.from = originalName;
                }
                if (!entry?.to && newName) {
                    entry.to = newName;
                }
                if (!entry?.description && entry?.changeDescription) {
                    entry.description = entry.changeDescription;
                }
            }
        }

        const consumed = parsedEntries.consume_item;
        if (Array.isArray(consumed)) {
            for (const entry of consumed) {
                const itemName = entry?.item;
                if (!itemName) {
                    continue;
                }
                this.destroyedItems.add(itemName);
            }
        }
    }

    static _pruneExcludedItemEntries(parsedEntries = {}) {
        const shouldSkip = (itemName) =>
            typeof itemName === "string" &&
            (this.animatedItems.has(itemName) ||
                this.destroyedItems.has(itemName) ||
                this.alteredItems.has(itemName));

        const filterByItem = (key) => {
            if (!Array.isArray(parsedEntries[key])) {
                return;
            }
            if (key === "consume_item") {
                parsedEntries[key] = parsedEntries[key].filter((entry) => {
                    const name = entry?.item;
                    if (!name) {
                        return Boolean(entry);
                    }
                    return !this.alteredItems.has(name);
                });
            } else {
                parsedEntries[key] = parsedEntries[key].filter((entry) => {
                    const name = entry?.item;
                    if (!name) {
                        return Boolean(entry);
                    }
                    return !shouldSkip(name);
                });
            }
        };

        filterByItem("transfer_item");
        filterByItem("harvest_gather");
        filterByItem("pick_up_item");
        filterByItem("put_item_in_container");
        filterByItem("remove_item_from_container");
        filterByItem("drop_item");
        filterByItem("consume_item");

        if (Array.isArray(parsedEntries.item_appear)) {
            parsedEntries.item_appear = parsedEntries.item_appear.filter(
                (entry) => !shouldSkip(entry?.name),
            );
        }
    }

    static initialize(deps = {}) {
        if (!deps) {
            throw new Error("Events.initialize requires a dependency object.");
        }

        this._deps = { ...deps };
        this.resetMaintenancePromptTurnCounters();
        this._baseTimeout =
            Number.isFinite(deps.baseTimeoutMilliseconds) &&
                deps.baseTimeoutMilliseconds > 0
                ? deps.baseTimeoutMilliseconds
                : BASE_TIMEOUT_MS;

        this.DEFAULT_STATUS_DURATION =
            deps.defaultStatusDuration ?? DEFAULT_STATUS_DURATION;
        this.MAJOR_STATUS_DURATION =
            deps.majorStatusDuration ?? MAJOR_STATUS_DURATION;

        this._parsers = this._buildParsers();
        this._aggregators = this._buildAggregators();
        this._handlers = this._buildHandlers();
    }

    static setHousekeepingPromptRunner(runner) {
        if (runner !== null && runner !== undefined && typeof runner !== "function") {
            throw new Error("Events.setHousekeepingPromptRunner requires a function or null.");
        }
        this._housekeepingPromptRunner = runner || null;
    }

    static _getHousekeepingPromptRunner() {
        return typeof this._housekeepingPromptRunner === "function"
            ? this._housekeepingPromptRunner
            : (typeof this._deps?.runHousekeepingPrompt === "function"
                ? this._deps.runHousekeepingPrompt
                : null);
    }

    static _scheduleHousekeepingForEventChecks({
        depth = 0,
        suppressHousekeeping = false,
    } = {}) {
        if (depth > 0 || suppressHousekeeping) {
            return false;
        }
        const runner = this._getHousekeepingPromptRunner();
        if (!runner) {
            return false;
        }
        return this.shouldRunAutomaticHousekeepingThisTurn();
    }

    static async _runHousekeepingAfterEventChecks({
        depth = 0,
        suppressHousekeeping = false,
        textToCheck = "",
        actionText = "",
        stream = null,
        location = null,
        eventResult = null,
        entryCollector = null,
        housekeepingScheduled = false,
    } = {}) {
        if (depth > 0 || suppressHousekeeping || !housekeepingScheduled) {
            return null;
        }
        const runner = this._getHousekeepingPromptRunner();
        if (!runner) {
            return null;
        }
        return runner({
            textToCheck,
            actionText,
            stream,
            locationOverride: location || null,
            eventResult,
            entryCollector,
        });
    }

    static async runQuestChecks({
        allowWithoutEventChecks = false,
        recentTextOverride = null,
        bypassInterval = false,
    } = {}) {
        const config = this.config || Globals.config || {};
        if (config?.event_checks?.enabled === false && !allowWithoutEventChecks) {
            console.info("Quest checks skipped: event_checks.enabled is false.");
            return null;
        }
        if (config?.event_checks?.enabled === false && allowWithoutEventChecks) {
            console.info("Quest checks running without event checks.");
        }
        if (config?.quest_checks?.enabled !== true) {
            console.info("Quest checks skipped: quest_checks.enabled is not true.");
            return null;
        }

        // Build a stable quest list for prompt rendering using the player's canonical quest order.
        let currentQuestPromptList = [];
        const player = this.currentPlayer;
        if (player && Array.isArray(player.currentQuests)) {
            const activeQuests = Quest.filterActiveQuests(player.currentQuests, {
                includePaused: false,
            });
            if (activeQuests.length && typeof player.getQuestByIndex !== "function") {
                throw new Error(
                    "Quest checks require player.getQuestByIndex to resolve active quest prompt indices.",
                );
            }
            const questIndexMap = new Map();
            if (activeQuests.length) {
                for (let idx = 0; ; idx += 1) {
                    const quest = player.getQuestByIndex(idx);
                    if (!quest) {
                        break;
                    }
                    const questId = quest.id || `quest_${idx}`;
                    questIndexMap.set(questId, idx + 1); // store as 1-based to match prompt expectations
                }
            }

            currentQuestPromptList = activeQuests
                .map((quest) => {
                    const questId = quest?.id || null;
                    const questIndex = questId ? questIndexMap.get(questId) : null;
                    return {
                        ...quest,
                        index: Number.isFinite(questIndex) ? questIndex : null,
                    };
                })
                .sort((a, b) => {
                    const aIndex = Number.isFinite(a.index)
                        ? a.index
                        : Number.MAX_SAFE_INTEGER;
                    const bIndex = Number.isFinite(b.index)
                        ? b.index
                        : Number.MAX_SAFE_INTEGER;
                    return aIndex - bIndex;
                });

            const unresolved = currentQuestPromptList.filter(
                (entry) => !Number.isFinite(entry.index),
            );
            if (unresolved.length) {
                const labels = unresolved
                    .map((entry) => entry.name || entry.id || "Unknown quest")
                    .join(", ");
                throw new Error(
                    `Failed to resolve prompt indices for quests: ${labels}`,
                );
            }
        }

        if (!currentQuestPromptList.length) {
            console.info("Quest checks skipped: no active quests.");
            return null;
        }
        if (bypassInterval) {
            this.resolveQuestCheckInterval(config);
            console.info("Quest checks running this turn from an event objective-completion signal.");
        } else if (!this._shouldRunQuestCheckThisTurn(config)) {
            console.info("Quest checks skipped: quest_checks.interval cadence not reached.");
            return null;
        }

        const promptEnv = this._deps.promptEnv;
        const parseXMLTemplate = this._deps.parseXMLTemplate;
        const prepareBasePromptContext = this._deps.prepareBasePromptContext;
        const findRegionByLocationId = this._deps.findRegionByLocationId;

        const baseContext = await prepareBasePromptContext();
        if (
            typeof recentTextOverride === "string" &&
            recentTextOverride.trim()
        ) {
            const supplementalLine = `[Storyteller] ${recentTextOverride.trim()}`;
            const existingRecentHistory =
                typeof baseContext.recentGameHistory === "string"
                    ? baseContext.recentGameHistory.trim()
                    : "";
            baseContext.recentGameHistory = existingRecentHistory
                ? `${existingRecentHistory}\n${supplementalLine}`
                : supplementalLine;
        }

        const renderedQuestCheck = promptEnv.render("base-context.xml.njk", {
            ...baseContext,
            suppressQuestList: true,
            promptType: "quest-check",
            omitGameHistory: true,
            currentQuestPromptList,
        });

        const parsedQuestTemplate = parseXMLTemplate(renderedQuestCheck);

        if (
            !parsedQuestTemplate?.systemPrompt ||
            !parsedQuestTemplate?.generationPrompt
        ) {
            throw new Error(`Quest check template did not produce prompts.`);
        }

        const questMessages = [
            { role: "system", content: parsedQuestTemplate.systemPrompt },
            { role: "user", content: parsedQuestTemplate.generationPrompt },
        ];

        const questRequestOptions = {
            messages: questMessages,
            metadataLabel: "quest_check",
            timeoutMs: this._baseTimeout,
            temperature: 0,
            validateXML: true,
            dumpReasoningToConsole: true,
        };

        const questResponseText =
            await LLMClient.chatCompletion(questRequestOptions);

        LLMClient.logPrompt({
            systemPrompt: parsedQuestTemplate.systemPrompt,
            generationPrompt: parsedQuestTemplate.generationPrompt,
            response: questResponseText,
            metadataLabel: "quest_check",
        });

        return questResponseText;
    }

    static _createEventCheckAccumulator() {
        return {
            experienceAwards: [],
            currencyChanges: [],
            environmentalDamageEvents: [],
            needBarChanges: [],
            dispositionChanges: [],
            factionReputationChanges: [],
            questsAwarded: [],
            questRewards: [],
            questObjectivesCompleted: [],
            itemTriggeredStatusChanges: [],
            suppressedStatusEffectChanges: [],
            hiddenNpcChecks: [],
            locationRefreshRequested: false,
            timeProgress: null,
        };
    }

    static _mergeOutcomeContextIntoAccumulator(outcomeContext, accumulator) {
        if (!outcomeContext || !accumulator) {
            return;
        }
        const mergeArray = (fromKey, toKey = fromKey) => {
            const values = outcomeContext[fromKey];
            if (Array.isArray(values) && values.length) {
                accumulator[toKey].push(...values);
            }
        };

        mergeArray("experienceAwards");
        mergeArray("currencyChanges");
        mergeArray("environmentalDamageEvents");
        mergeArray("needBarChanges");
        mergeArray("dispositionChanges");
        mergeArray("factionReputationChanges");
        mergeArray("questsAwarded");
        mergeArray("questCompletionRewards", "questRewards");
        mergeArray("completedQuestObjectives", "questObjectivesCompleted");
        mergeArray("itemTriggeredStatusChanges");
        mergeArray("suppressedStatusEffectChanges");
        mergeArray("hiddenNpcChecks");

        if (
            outcomeContext.timeProgress &&
            typeof outcomeContext.timeProgress === "object"
        ) {
            accumulator.timeProgress = outcomeContext.timeProgress;
        }
        if (outcomeContext.locationRefreshRequested) {
            accumulator.locationRefreshRequested = true;
        }
    }

    static _clearEnvironmentalEvents(structured) {
        if (!structured || typeof structured !== "object") {
            return;
        }
        if (structured.parsed && typeof structured.parsed === "object") {
            structured.parsed.environmental_status_damage = [];
        }
        if (structured.rawEntries && typeof structured.rawEntries === "object") {
            structured.rawEntries.environmental_status_damage = "";
        }
    }

    static _resolveTrackedCharacterNames(values) {
        const findActorByName = this._deps?.findActorByName;
        return Array.from(
            new Set(
                Array.from(values || [])
                    .map((value) => {
                        const trimmed = typeof value === "string" ? value.trim() : "";
                        if (!trimmed) {
                            return "";
                        }
                        if (typeof findActorByName !== "function") {
                            return trimmed;
                        }
                        const actor = findActorByName(trimmed);
                        const canonicalName = typeof actor?.name === "string"
                            ? actor.name.trim()
                            : "";
                        return canonicalName || trimmed;
                    })
                    .filter(Boolean),
            ),
        );
    }

    static _buildEventCheckNpcUpdateState(Location) {
        const findLocationByNameLoose = this._deps?.findLocationByNameLoose;
        const resolveMovedLocationName = (name) => {
            const trimmed = typeof name === "string" ? name.trim() : "";
            if (!trimmed) {
                return "";
            }
            let resolved = null;
            if (Location && typeof Location.get === "function") {
                try {
                    resolved = Location.get(trimmed);
                } catch (_) {
                    resolved = null;
                }
            }
            if (
                !resolved &&
                Location &&
                typeof Location.findByName === "function"
            ) {
                try {
                    resolved = Location.findByName(trimmed);
                } catch (_) {
                    resolved = null;
                }
            }
            if (!resolved && typeof findLocationByNameLoose === "function") {
                resolved = findLocationByNameLoose(trimmed) || null;
            }
            return resolved?.name || trimmed;
        };

        const addedCharacters = this._resolveTrackedCharacterNames(this.newCharacters);
        const departedCharacters = this._resolveTrackedCharacterNames(this.departedCharacters);
        const movedLocationNames = Array.from(
            new Set(
                Array.from(this.movedLocations)
                    .map(resolveMovedLocationName)
                    .filter(Boolean),
            ),
        );

        return {
            addedCharacters,
            departedCharacters,
            movedLocationNames,
            addedSet: new Set(addedCharacters),
            departedSet: new Set(departedCharacters),
            movedSet: new Set(movedLocationNames),
            locationRefreshRequested: Boolean(
                addedCharacters.length ||
                departedCharacters.length ||
                movedLocationNames.length,
            ),
        };
    }

    static _mergeFollowupNpcUpdates(followup, npcState) {
        if (!followup?.npcUpdates || !npcState) {
            return;
        }
        if (Array.isArray(followup.npcUpdates.added)) {
            followup.npcUpdates.added.forEach((name) => {
                if (name && !npcState.addedSet.has(name)) {
                    npcState.addedSet.add(name);
                    npcState.addedCharacters.push(name);
                }
            });
        }
        if (Array.isArray(followup.npcUpdates.departed)) {
            followup.npcUpdates.departed.forEach((name) => {
                if (name && !npcState.departedSet.has(name)) {
                    npcState.departedSet.add(name);
                    npcState.departedCharacters.push(name);
                }
            });
        }
        if (Array.isArray(followup.npcUpdates.movedLocations)) {
            followup.npcUpdates.movedLocations.forEach((name) => {
                if (name && !npcState.movedSet.has(name)) {
                    npcState.movedSet.add(name);
                    npcState.movedLocationNames.push(name);
                }
            });
        }
    }

    static async _applyStructuredEventsForRun(structured, context, accumulator) {
        if (!structured || !structured.parsed) {
            return null;
        }
        try {
            const outcomeContext = await this.applyEventOutcomes(structured, {
                ...context,
                experienceAwards: [],
                currencyChanges: [],
                environmentalDamageEvents: [],
                needBarChanges: [],
                dispositionChanges: [],
                factionReputationChanges: [],
            });
            this._mergeOutcomeContextIntoAccumulator(outcomeContext, accumulator);
            return outcomeContext;
        } catch (error) {
            console.warn("Failed to apply event outcomes:", error.message);
            return null;
        }
    }

    static async _runXmlEventChecks({
        textToCheck,
        normalizedActionText,
        includePlayerActionBlock,
        stream,
        allowEnvironmentalEffects,
        isNpcTurn,
        suppressMoveEvents,
        allowMoveTurnAppearances,
        suppressTimeAdvance,
        location,
        region,
        currentPlayer,
        baseContext,
        promptEnv,
        parseXMLTemplate,
        Location,
        findRegionByLocationId,
        activeFollowupQueue,
        depth,
        ignoredEventKeys,
        eventCheckIgnoreInstructions,
        suppressNeedBarEventChecks,
        suppressHousekeeping,
        eventSectionKind,
        eventMode,
        suppressTrackerUpdates,
        tinyBrainAcceptedEventXml,
        tinyBrainEventSequence,
        authoritativeMovementCompanionNames,
        preResolvedHiddenNpcChecks,
        initialTimeProgress,
        entryCollector,
        housekeepingScheduled,
    }) {
        const normalizedIgnoredEventKeys =
            this._normalizeIgnoredEventKeys(ignoredEventKeys);
        const useTinyBrainEventChecks = isTinyBrainPromptEnabled(
            Globals.config?.ai,
            "event_checks",
        );
        const eventSequence = tinyBrainEventSequence
            ? this._requireTinyBrainEventSequence(tinyBrainEventSequence)
            : null;
        if (eventSequence && !useTinyBrainEventChecks) {
            throw new Error(
                "A Tiny-brain event sequence cannot be used when TinyBrain event checks are disabled.",
            );
        }
        const sequentialAcceptedEventXml = this._buildTinyBrainAcceptedEventXml(
            eventSequence,
        );
        const templateContext = {
            ...baseContext,
            promptType: "events-xml",
            textToCheck,
            actionText: normalizedActionText,
            shortStringTrackerMaxWords: Tracker.shortStringMaxWords(),
            includePlayerActionBlock,
            eventCheckIgnoredEventKeys: Array.from(normalizedIgnoredEventKeys),
            eventCheckIgnoreInstructions:
                typeof eventCheckIgnoreInstructions === "string"
                    ? eventCheckIgnoreInstructions.trim()
                    : "",
            tinyBrainEventSectionKind: this._normalizeTinyBrainEventSectionKind(
                eventSectionKind,
            ),
            tinyBrainEventSectionLabel: this._normalizeTinyBrainEventSectionKind(
                eventSectionKind,
            ).toUpperCase(),
            tinyBrainAcceptedEventXml:
                typeof tinyBrainAcceptedEventXml === "string"
                    ? tinyBrainAcceptedEventXml.trim() || sequentialAcceptedEventXml
                    : sequentialAcceptedEventXml,
            tinyBrainAuthoritativeMovementCompanionNames:
                authoritativeMovementCompanionNames,
            omitGameHistory: true,
        };
        if (useTinyBrainEventChecks) {
            templateContext.tinyBrainEventStages = this._buildTinyBrainEventStages({
                eventSectionKind,
                eventMode,
                ignoredEventKeys: normalizedIgnoredEventKeys,
                suppressTimeAdvance,
                suppressTrackerUpdates,
                hasRegisteredModEvents: Array.isArray(baseContext?.modEventPromptSchemas)
                    && baseContext.modEventPromptSchemas.length > 0,
            });
        }
        const tinyBrain = useTinyBrainEventChecks
            ? configureTinyBrainPromptContext(templateContext, "event_checks")
            : null;
        const rendered = promptEnv.render("base-context.xml.njk", templateContext);

        const parsedTemplate = parseXMLTemplate(rendered);
        if (!parsedTemplate?.systemPrompt || !parsedTemplate?.generationPrompt) {
            throw new Error("XML event check template did not produce prompts.");
        }

        let requestPayloadForLog = null;
        let responsePayloadForLog = null;
        const eventCheckPromise = useTinyBrainEventChecks
            ? this._runTinyBrainEventXmlPrompt({
                initialRenderedTemplate: rendered,
                templateContext,
                tinyBrain,
                promptEnv,
                parseXMLTemplate,
                tinyBrainEventSequence: eventSequence,
                eventLocation: location,
            })
            : LLMClient.chatCompletion({
                messages: [
                    { role: "system", content: parsedTemplate.systemPrompt },
                    { role: "user", content: parsedTemplate.generationPrompt },
                ],
                metadataLabel: "event_checks",
                errorLogLabel: "events-xml",
                metadata: { eventPipeline: "xml", promptType: "events-xml" },
                timeoutMs: this._baseTimeout,
                temperature: 0,
                validateXML: false,
                requiredRegex: /<events\b[\s\S]*<\/events>/i,
                dumpReasoningToConsole: true,
                stream: true,
                // captureRequestPayload: (payload) => { requestPayloadForLog = payload; },
                // captureResponsePayload: (payload) => { responsePayloadForLog = payload; }
            });
        const promptLaunchStaggerMs = this.resolvePromptLaunchStaggerMs();
        const needBarEventCheckPromise = suppressNeedBarEventChecks
            ? Promise.resolve({ responseText: "", entries: [] })
            : this.runAfterPromptLaunchDelay(promptLaunchStaggerMs, () => this._runNeedBarEventChecks({
                baseContext,
                textToCheck,
                actionText: normalizedActionText,
                includePlayerActionBlock,
                promptEnv,
                parseXMLTemplate,
            }));
        const [responseText, needBarEventCheck] = await Promise.all([
            eventCheckPromise,
            needBarEventCheckPromise,
        ]);

        this.logEventCheck({
            systemPrompt: parsedTemplate.systemPrompt,
            generationPrompt: parsedTemplate.generationPrompt,
            responseText,
            metadataLabel: "event_checks",
            prefix: "event_checks_xml",
            requestPayload: requestPayloadForLog,
            responsePayload: responsePayloadForLog,
        });

        const xmlEvents = this._parseXmlEventCheckResponse(responseText, {
            ignoredEventKeys: normalizedIgnoredEventKeys,
        });
        const needBarPromptEntries = Array.isArray(needBarEventCheck?.entries)
            ? needBarEventCheck.entries
            : [];
        if (needBarPromptEntries.length) {
            this._injectNeedBarPromptEntriesIntoStructured(
                xmlEvents.beforeTravel.structured,
                needBarPromptEntries,
            );
            xmlEvents.structured = this._mergeStructuredEventSets(
                xmlEvents.beforeTravel.structured,
                xmlEvents.travelMove.structured,
                xmlEvents.afterTravel.structured,
            );
        }
        if (!allowEnvironmentalEffects) {
            this._clearEnvironmentalEvents(xmlEvents.beforeTravel.structured);
            this._clearEnvironmentalEvents(xmlEvents.travelMove.structured);
            this._clearEnvironmentalEvents(xmlEvents.afterTravel.structured);
            this._clearEnvironmentalEvents(xmlEvents.structured);
        }

        const cleaned = xmlEvents.xml;
        const html = this.escapeHtml(cleaned).replace(/\n/g, "<br>");
        const accumulator = this._createEventCheckAccumulator();
        if (initialTimeProgress && typeof initialTimeProgress === "object") {
            accumulator.timeProgress = initialTimeProgress;
        }
        const suppressActiveVehicleDestinationTravelMove =
            Boolean(xmlEvents.hasTravelBoundary) &&
            structuredTravelMoveTargetsActiveVehicleDestination(
                this,
                xmlEvents.travelMove.structured,
                {
                    Location,
                    player: currentPlayer,
                    originLocation: location,
                },
            );
        const commonContext = {
            player: currentPlayer,
            textToCheck,
            actionText: normalizedActionText,
            allowEnvironmentalEffects: Boolean(allowEnvironmentalEffects),
            isNpcTurn: Boolean(isNpcTurn),
            suppressTimeAdvance: Boolean(suppressTimeAdvance),
            suppressTimePassedEvents: Boolean(
                xmlEvents.hasTravelBoundary &&
                !suppressActiveVehicleDestinationTravelMove,
            ),
            timeProgress: initialTimeProgress || null,
            stream,
            preResolvedHiddenNpcChecks,
            consumedPreResolvedHiddenNpcCheckIndexes: new Set(),
            followupQueue: activeFollowupQueue,
            _originatedFromEventChecks: true,
        };

        await this._applyStructuredEventsForRun(
            xmlEvents.beforeTravel.structured,
            {
                ...commonContext,
                location,
                region,
                suppressMoveEvents: Boolean(suppressMoveEvents),
                allowMoveTurnAppearances: Boolean(allowMoveTurnAppearances),
            },
            accumulator,
        );

        let destinationLocation = location;
        let destinationRegion = region;
        if (xmlEvents.hasTravelBoundary) {
            await this._applyStructuredEventsForRun(
                xmlEvents.travelMove.structured,
                {
                    ...commonContext,
                    location,
                    region,
                    suppressMoveEvents: Boolean(
                        suppressMoveEvents ||
                        suppressActiveVehicleDestinationTravelMove,
                    ),
                    allowMoveTurnAppearances: Boolean(allowMoveTurnAppearances),
                },
                accumulator,
            );

            const travelBoundaryDestinationLocation =
                suppressActiveVehicleDestinationTravelMove
                    ? null
                    : this._resolveStructuredTravelMoveDestinationLocation(
                        xmlEvents.travelMove.structured,
                    );
            if (travelBoundaryDestinationLocation) {
                destinationLocation = travelBoundaryDestinationLocation;
            } else if (
                currentPlayer?.currentLocation &&
                Location &&
                typeof Location.get === "function"
            ) {
                try {
                    destinationLocation = Location.get(currentPlayer.currentLocation) || location;
                } catch (_) {
                    destinationLocation = location;
                }
            }
            if (
                destinationLocation &&
                typeof findRegionByLocationId === "function"
            ) {
                try {
                    destinationRegion =
                        findRegionByLocationId(destinationLocation.id) || region;
                } catch (_) {
                    destinationRegion = region;
                }
            }

            const applyAfterTravelEvents = () =>
                this._applyStructuredEventsForRun(
                    xmlEvents.afterTravel.structured,
                    {
                        ...commonContext,
                        location: destinationLocation,
                        region: destinationRegion,
                        suppressMoveEvents: true,
                        allowMoveTurnAppearances: true,
                    },
                    accumulator,
                );
            const needsTemporaryArrivalPlayerLocation = Boolean(
                suppressMoveEvents &&
                destinationLocation?.id &&
                currentPlayer &&
                currentPlayer.currentLocation !== destinationLocation.id,
            );
            if (needsTemporaryArrivalPlayerLocation) {
                await this._withTemporaryPlayerLocation(
                    currentPlayer,
                    destinationLocation,
                    applyAfterTravelEvents,
                );
            } else {
                await applyAfterTravelEvents();
            }
        }

        this._removeSuppressedStatusEffectChangesFromStructured(
            xmlEvents.structured,
            accumulator.suppressedStatusEffectChanges,
        );
        this._mergeItemTriggeredStatusChangesIntoStructured(
            xmlEvents.structured,
            accumulator.itemTriggeredStatusChanges,
        );
        this.mergeQuestOutcomesIntoStructured(xmlEvents.structured, {
            questRewards: accumulator.questRewards,
            questObjectivesCompleted: accumulator.questObjectivesCompleted,
        });

        const npcState = this._buildEventCheckNpcUpdateState(Location);
        const followupResults = [];
        if (
            depth === 0 &&
            Array.isArray(activeFollowupQueue) &&
            activeFollowupQueue.length
        ) {
            const seen = new Set();
            while (activeFollowupQueue.length) {
                const pendingTexts = activeFollowupQueue.splice(
                    0,
                    activeFollowupQueue.length,
                );
                for (const followupText of pendingTexts) {
                    if (typeof followupText !== "string") {
                        continue;
                    }
                    const trimmedFollowup = followupText.trim();
                    if (!trimmedFollowup || seen.has(trimmedFollowup)) {
                        continue;
                    }
                    seen.add(trimmedFollowup);
                    try {
                        const followup = await this.runEventChecks({
                            textToCheck: trimmedFollowup,
                            stream,
                            allowEnvironmentalEffects,
                            isNpcTurn,
                            suppressMoveEvents,
                            allowMoveTurnAppearances,
                            suppressTimeAdvance: true,
                            ignoredEventKeys: Array.from(normalizedIgnoredEventKeys),
                            eventCheckIgnoreInstructions,
                            suppressNeedBarEventChecks: Boolean(suppressNeedBarEventChecks),
                            eventSectionKind,
                            eventMode,
                            suppressTrackerUpdates: Boolean(suppressTrackerUpdates),
                            tinyBrainAcceptedEventXml,
                            tinyBrainEventSequence: eventSequence,
                            _depth: depth + 1,
                            followupQueue: activeFollowupQueue,
                        });
                        if (!followup) {
                            continue;
                        }

                        followupResults.push({
                            raw: followup.raw,
                            html: followup.html,
                            structured: followup.structured,
                        });

                        this._mergeOutcomeContextIntoAccumulator(
                            {
                                experienceAwards: followup.experienceAwards,
                                currencyChanges: followup.currencyChanges,
                                environmentalDamageEvents:
                                    followup.environmentalDamageEvents,
                                needBarChanges: followup.needBarChanges,
                                dispositionChanges: followup.dispositionChanges,
                                factionReputationChanges:
                                    followup.factionReputationChanges,
                                questsAwarded: followup.questsAwarded,
                                questCompletionRewards: followup.questRewards,
                                completedQuestObjectives:
                                    followup.questObjectivesCompleted,
                                timeProgress: followup.timeProgress,
                            },
                            accumulator,
                        );

                        if (followup.locationRefreshRequested) {
                            npcState.locationRefreshRequested = true;
                        }
                        this._mergeFollowupNpcUpdates(followup, npcState);
                    } catch (error) {
                        console.warn(
                            "Failed to process follow-up event text:",
                            error.message,
                        );
                    }
                }
            }
        }

        console.debug(
            "[QuestDebug] runEventChecks returning quests:",
            accumulator.questsAwarded,
        );

        const eventResult = {
            raw: cleaned,
            html,
            structured: xmlEvents.structured,
            xmlEvents,
            experienceAwards: accumulator.experienceAwards,
            currencyChanges: accumulator.currencyChanges,
            environmentalDamageEvents: accumulator.environmentalDamageEvents,
            needBarChanges: accumulator.needBarChanges,
            dispositionChanges: accumulator.dispositionChanges,
            factionReputationChanges: accumulator.factionReputationChanges,
            npcUpdates: {
                added: npcState.addedCharacters,
                departed: npcState.departedCharacters,
                movedLocations: npcState.movedLocationNames,
            },
            locationRefreshRequested: Boolean(npcState.locationRefreshRequested || accumulator.locationRefreshRequested),
            questObjectivesCompleted: accumulator.questObjectivesCompleted,
            questRewards: accumulator.questRewards,
            questsAwarded: accumulator.questsAwarded,
            followupResults,
            hiddenNpcChecks: accumulator.hiddenNpcChecks,
            timeProgress: accumulator.timeProgress,
        };

        await this._runHousekeepingAfterEventChecks({
            depth,
            suppressHousekeeping: Boolean(suppressHousekeeping),
            textToCheck,
            actionText: normalizedActionText,
            stream,
            location: destinationLocation || location || null,
            eventResult,
            entryCollector,
            housekeepingScheduled,
        });

        return eventResult;
    }

    static async runEventChecks({
        textToCheck,
        actionText = null,
        stream = null,
        allowEnvironmentalEffects = true,
        isNpcTurn = false,
        suppressMoveEvents = false,
        allowMoveTurnAppearances = false,
        suppressTimeAdvance = false,
        locationOverride = null,
        ignoredEventKeys = [],
        eventCheckIgnoreInstructions = "",
        suppressNeedBarEventChecks = false,
        suppressHousekeeping = false,
        eventSectionKind = "current",
        eventMode = "events",
        suppressTrackerUpdates = false,
        tinyBrainAcceptedEventXml = "",
        tinyBrainEventSequence = null,
        authoritativeMovementCompanionNames = [],
        preResolvedHiddenNpcChecks = [],
        initialTimeProgress = null,
        entryCollector = null,
        _depth = 0,
        followupQueue = null,
    } = {}) {
        const config = this.config || Globals.config || {};
        if (config?.event_checks?.enabled === false) {
            console.info("Event checks skipped: event_checks.enabled is false.");
            return null;
        }

        const startOfText =
            typeof textToCheck === "string" ? textToCheck.slice(0, 20) : "";
        console.log(`✅ Starting event checks for text: ${startOfText}...`);
        if (isBlank(textToCheck)) {
            console.warn("No text to check for events; skipping event analysis.");
            return null;
        }
        if (actionText !== null && actionText !== undefined && typeof actionText !== "string") {
            throw new Error("runEventChecks actionText must be a string when provided.");
        }
        const normalizedActionText =
            typeof actionText === "string" ? actionText.trim() : "";
        const includePlayerActionBlock = normalizedActionText.length > 0;
        const normalizedIgnoredEventKeys =
            this._normalizeIgnoredEventKeys(ignoredEventKeys);
        const normalizedEventSectionKind =
            this._normalizeTinyBrainEventSectionKind(eventSectionKind);
        const normalizedEventMode = typeof eventMode === "string"
            ? eventMode.trim().toLowerCase()
            : "";
        if (normalizedEventMode !== "events" && normalizedEventMode !== "trackers") {
            throw new Error(`Unknown event extraction mode "${eventMode}".`);
        }
        if (typeof tinyBrainAcceptedEventXml !== "string") {
            throw new Error("runEventChecks tinyBrainAcceptedEventXml must be a string.");
        }
        if (tinyBrainEventSequence !== null) {
            this._requireTinyBrainEventSequence(tinyBrainEventSequence);
        }
        if (!Array.isArray(authoritativeMovementCompanionNames)
            || authoritativeMovementCompanionNames.some((name) => (
                typeof name !== "string" || !name.trim()
            ))) {
            throw new Error(
                "runEventChecks authoritativeMovementCompanionNames must be an array of non-empty strings.",
            );
        }
        const normalizedAuthoritativeMovementCompanionNames = Array.from(new Set(
            authoritativeMovementCompanionNames.map((name) => name.trim()),
        ));
        if (!Array.isArray(preResolvedHiddenNpcChecks)
            || preResolvedHiddenNpcChecks.some((entry) => (
                !entry || typeof entry !== "object" || Array.isArray(entry)
            ))) {
            throw new Error(
                "runEventChecks preResolvedHiddenNpcChecks must be an array of objects.",
            );
        }
        let normalizedInitialTimeProgress = null;
        if (initialTimeProgress !== null && initialTimeProgress !== undefined) {
            if (typeof initialTimeProgress !== "object" || Array.isArray(initialTimeProgress)) {
                throw new Error("runEventChecks initialTimeProgress must be an object when provided.");
            }
            normalizedInitialTimeProgress = initialTimeProgress;
        }

        this._resetTrackingSets();
        const depth = Number.isFinite(_depth) ? _depth : 0;
        let activeFollowupQueue = Array.isArray(followupQueue)
            ? followupQueue
            : null;
        if (!activeFollowupQueue) {
            activeFollowupQueue = [];
        } else if (depth === 0) {
            activeFollowupQueue.length = 0;
        }

        const promptEnv = this._deps.promptEnv;
        const parseXMLTemplate = this._deps.parseXMLTemplate;
        const prepareBasePromptContext = this._deps.prepareBasePromptContext;
        const Location = this._deps.Location;
        const findRegionByLocationId = this._deps.findRegionByLocationId;

        const PlayerLevel = Globals.currentPlayer?.level;

        if (typeof promptEnv?.render !== "function") {
            throw new Error("promptEnv.render dependency is not configured.");
        }
        if (typeof parseXMLTemplate !== "function") {
            throw new Error("parseXMLTemplate dependency is not configured.");
        }
        if (typeof prepareBasePromptContext !== "function") {
            throw new Error("prepareBasePromptContext dependency is not configured.");
        }

        const aiConfig = config?.ai;

        if (!aiConfig) {
            console.warn("AI configuration missing; skipping event analysis.");
            return null;
        }

        const currentPlayer = this.currentPlayer;
        let location = null;
        if (locationOverride) {
            if (typeof locationOverride === "string") {
                if (!Location || typeof Location.get !== "function") {
                    throw new Error("runEventChecks locationOverride id requires Location.get.");
                }
                location = Location.get(locationOverride) || null;
            } else if (typeof locationOverride === "object") {
                location = locationOverride;
            }
            if (!location) {
                throw new Error("runEventChecks locationOverride could not be resolved.");
            }
        } else if (
            currentPlayer?.currentLocation &&
            Location &&
            typeof Location.get === "function"
        ) {
            try {
                location = Location.get(currentPlayer.currentLocation) || null;
            } catch (_) {
                location = null;
            }
        }

        let region = null;
        if (location && typeof findRegionByLocationId === "function") {
            try {
                region = findRegionByLocationId(location.id);
            } catch (_) {
                region = null;
            }
        }

        const baseContext = await prepareBasePromptContext({
            locationOverride: location,
        });
        const housekeepingScheduled = this._scheduleHousekeepingForEventChecks({
            depth,
            suppressHousekeeping: Boolean(suppressHousekeeping),
        });

        if (config?.event_checks?.use_xml !== false) {
            return this._runXmlEventChecks({
                textToCheck,
                normalizedActionText,
                includePlayerActionBlock,
                stream,
                allowEnvironmentalEffects,
                isNpcTurn,
                suppressMoveEvents,
                allowMoveTurnAppearances,
                suppressTimeAdvance,
                location,
                region,
                currentPlayer,
                baseContext,
                promptEnv,
                parseXMLTemplate,
                Location,
                findRegionByLocationId,
                activeFollowupQueue,
                depth,
                ignoredEventKeys: normalizedIgnoredEventKeys,
                eventCheckIgnoreInstructions,
                suppressNeedBarEventChecks: Boolean(suppressNeedBarEventChecks),
                suppressHousekeeping: Boolean(suppressHousekeeping),
                eventSectionKind: normalizedEventSectionKind,
                eventMode: normalizedEventMode,
                suppressTrackerUpdates: Boolean(suppressTrackerUpdates),
                tinyBrainAcceptedEventXml: tinyBrainAcceptedEventXml.trim(),
                tinyBrainEventSequence,
                authoritativeMovementCompanionNames:
                    normalizedAuthoritativeMovementCompanionNames,
                preResolvedHiddenNpcChecks,
                initialTimeProgress: normalizedInitialTimeProgress,
                entryCollector,
                housekeepingScheduled,
            });
        }

        const promptGroups = EVENT_PROMPT_ORDER;

        const promptLaunchStaggerMs = this.resolvePromptLaunchStaggerMs();
        const needBarEventCheckPromise = suppressNeedBarEventChecks
            ? Promise.resolve({ responseText: "", entries: [] })
            : this.runAfterPromptLaunchDelay(promptLaunchStaggerMs, () => this._runNeedBarEventChecks({
                baseContext,
                textToCheck,
                actionText: normalizedActionText,
                includePlayerActionBlock,
                promptEnv,
                parseXMLTemplate,
            }));
        const groupResponsesPromise = Promise.all(
            promptGroups.map(async (group, groupIndex) => {
                const questions = group.map((definition) => {
                    if (location?.name && typeof definition.prompt === "string") {
                        return definition.prompt.replace(
                            /%CURRENT_LOCATION%/g,
                            location.name,
                        );
                    }
                    return definition.prompt;
                });

                const rendered = promptEnv.render("base-context.xml.njk", {
                    ...baseContext,
                    promptType: "event-checks",
                    textToCheck,
                    actionText: normalizedActionText,
                    includePlayerActionBlock,
                    eventQuestions: questions,
                    eventCheckIgnoredEventKeys: Array.from(normalizedIgnoredEventKeys),
                    eventCheckIgnoreInstructions:
                        typeof eventCheckIgnoreInstructions === "string"
                            ? eventCheckIgnoreInstructions.trim()
                            : "",
                    omitGameHistory: true,
                });

                const parsedTemplate = parseXMLTemplate(rendered);

                if (
                    !parsedTemplate?.systemPrompt ||
                    !parsedTemplate?.generationPrompt
                ) {
                    throw new Error(
                        `Event check template did not produce prompts for group ${groupIndex + 1}.`,
                    );
                }

                const messages = [
                    { role: "system", content: parsedTemplate.systemPrompt },
                    { role: "user", content: parsedTemplate.generationPrompt },
                ];

                let requestPayloadForLog = null;
                let responsePayloadForLog = null;
                const requestOptions = {
                    messages,
                    metadataLabel: "event_checks",
                    metadata: { eventGroup: groupIndex },
                    timeoutMs: this._baseTimeout,
                    temperature: 0,
                    validateXML: false,
                    requiredRegex: /<final>[\s\S]*\S[\s\S]*<\/final>/i,
                    dumpReasoningToConsole: true,
                    stream: true,
                    // captureRequestPayload: (payload) => { requestPayloadForLog = payload; },
                    // captureResponsePayload: (payload) => { responsePayloadForLog = payload; }
                };

                const [responseText, questResponseText] = await Promise.all([
                    LLMClient.chatCompletion(requestOptions),
                ]);

                this.logEventCheck({
                    systemPrompt: parsedTemplate.systemPrompt,
                    generationPrompt: parsedTemplate.generationPrompt,
                    responseText,
                    label: `group_${groupIndex + 1}`,
                    requestPayload: requestPayloadForLog,
                    responsePayload: responsePayloadForLog,
                });

                return {
                    responseText,
                    groupIndex,
                };
            }),
        );
        const [groupResponses, needBarEventCheck] = await Promise.all([
            groupResponsesPromise,
            needBarEventCheckPromise,
        ]);

        const totalQuestions = EVENT_PROMPT_ORDER_FLAT.length;
        const combinedLines = [];
        let globalIndex = 1;

        groupResponses.forEach(({ responseText, groupIndex }) => {
            const finalBlock = this._extractFinalEventBlock(responseText);
            const numbered = this._extractNumberedResponses(finalBlock);
            const group = EVENT_PROMPT_ORDER[groupIndex];
            group.forEach((definition, localIndex) => {
                const answer = numbered.get(localIndex + 1) || "N/A";
                combinedLines.push(`${globalIndex}. ${answer}`);
                globalIndex += 1;
            });
        });

        if (combinedLines.length < totalQuestions) {
            for (let i = combinedLines.length; i < totalQuestions; i += 1) {
                combinedLines.push(`${i + 1}. N/A`);
            }
        }

        const combinedResponseText = combinedLines.join("\n");

        if (isBlank(combinedResponseText)) {
            return null;
        }

        const cleaned = this.cleanEventResponseText(combinedResponseText);
        const html = this.escapeHtml(cleaned).replace(/\n/g, "<br>");

        const structured = this._parseEventPromptResponse(cleaned, {
            isFinalBlock: true,
        });
        const needBarPromptEntries = Array.isArray(needBarEventCheck?.entries)
            ? needBarEventCheck.entries
            : [];
        this._injectNeedBarPromptEntriesIntoStructured(
            structured,
            needBarPromptEntries,
        );
        this._removeIgnoredEventKeysFromStructured(
            structured,
            normalizedIgnoredEventKeys,
        );
        if (!allowEnvironmentalEffects) {
            if (Array.isArray(structured.parsed.environmental_status_damage)) {
                structured.parsed.environmental_status_damage = [];
            }
            if (
                Object.prototype.hasOwnProperty.call(
                    structured.rawEntries,
                    "environmental_status_damage",
                )
            ) {
                structured.rawEntries.environmental_status_damage = "";
            }
        }

        let experienceAwards = [];
        let currencyChanges = [];
        let environmentalDamageEvents = [];
        let needBarChanges = [];
        let dispositionChanges = [];
        let factionReputationChanges = [];
        let questsAwarded = [];
        let questRewards = [];
        let questObjectivesCompleted = [];
        let itemTriggeredStatusChanges = [];
        let hiddenNpcChecks = [];
        let outcomeLocationRefreshRequested = false;
        let timeProgress = normalizedInitialTimeProgress;

        try {
            const outcomeContext = await this.applyEventOutcomes(structured, {
                player: currentPlayer,
                location,
                region,
                experienceAwards: [],
                currencyChanges: [],
                environmentalDamageEvents: [],
                needBarChanges: [],
                dispositionChanges: [],
                factionReputationChanges: [],
                allowEnvironmentalEffects: Boolean(allowEnvironmentalEffects),
                isNpcTurn: Boolean(isNpcTurn),
                suppressMoveEvents: Boolean(suppressMoveEvents),
                allowMoveTurnAppearances: Boolean(allowMoveTurnAppearances),
                suppressTimeAdvance: Boolean(suppressTimeAdvance),
                timeProgress: normalizedInitialTimeProgress,
                textToCheck,
                actionText: normalizedActionText,
                stream,
                preResolvedHiddenNpcChecks,
                consumedPreResolvedHiddenNpcCheckIndexes: new Set(),
                followupQueue: activeFollowupQueue,
                _originatedFromEventChecks: true,
            });

            if (
                Array.isArray(outcomeContext?.experienceAwards) &&
                outcomeContext.experienceAwards.length
            ) {
                experienceAwards = outcomeContext.experienceAwards;
            }
            if (
                Array.isArray(outcomeContext?.currencyChanges) &&
                outcomeContext.currencyChanges.length
            ) {
                currencyChanges = outcomeContext.currencyChanges;
            }
            if (
                Array.isArray(outcomeContext?.environmentalDamageEvents) &&
                outcomeContext.environmentalDamageEvents.length
            ) {
                environmentalDamageEvents = outcomeContext.environmentalDamageEvents;
            }
            if (
                Array.isArray(outcomeContext?.needBarChanges) &&
                outcomeContext.needBarChanges.length
            ) {
                needBarChanges = outcomeContext.needBarChanges;
            }
            if (
                Array.isArray(outcomeContext?.dispositionChanges) &&
                outcomeContext.dispositionChanges.length
            ) {
                dispositionChanges = outcomeContext.dispositionChanges;
            }
            if (
                Array.isArray(outcomeContext?.factionReputationChanges) &&
                outcomeContext.factionReputationChanges.length
            ) {
                factionReputationChanges = outcomeContext.factionReputationChanges;
            }
            if (
                Array.isArray(outcomeContext?.questsAwarded) &&
                outcomeContext.questsAwarded.length
            ) {
                questsAwarded = outcomeContext.questsAwarded;
            }
            if (
                Array.isArray(outcomeContext?.questCompletionRewards) &&
                outcomeContext.questCompletionRewards.length
            ) {
                questRewards = outcomeContext.questCompletionRewards;
            }
            if (
                Array.isArray(outcomeContext?.itemTriggeredStatusChanges) &&
                outcomeContext.itemTriggeredStatusChanges.length
            ) {
                itemTriggeredStatusChanges = outcomeContext.itemTriggeredStatusChanges;
            }
            if (
                Array.isArray(outcomeContext?.hiddenNpcChecks) &&
                outcomeContext.hiddenNpcChecks.length
            ) {
                hiddenNpcChecks = outcomeContext.hiddenNpcChecks;
            }
            if (outcomeContext?.locationRefreshRequested) {
                outcomeLocationRefreshRequested = true;
            }
            if (
                Array.isArray(outcomeContext?.completedQuestObjectives) &&
                outcomeContext.completedQuestObjectives.length
            ) {
                questObjectivesCompleted = outcomeContext.completedQuestObjectives;
            }
            if (outcomeContext?.timeProgress && typeof outcomeContext.timeProgress === "object") {
                timeProgress = outcomeContext.timeProgress;
            }
        } catch (error) {
            console.warn("Failed to apply event outcomes:", error.message);
        }

        this._mergeItemTriggeredStatusChangesIntoStructured(
            structured,
            itemTriggeredStatusChanges,
        );

        this.mergeQuestOutcomesIntoStructured(structured, {
            questRewards,
            questObjectivesCompleted,
        });

        const findLocationByNameLoose = this._deps?.findLocationByNameLoose;
        const resolveMovedLocationName = (name) => {
            const trimmed = typeof name === "string" ? name.trim() : "";
            if (!trimmed) {
                return "";
            }
            let resolved = null;
            if (Location && typeof Location.get === "function") {
                try {
                    resolved = Location.get(trimmed);
                } catch (_) {
                    resolved = null;
                }
            }
            if (!resolved && Location && typeof Location.findByName === "function") {
                try {
                    resolved = Location.findByName(trimmed);
                } catch (_) {
                    resolved = null;
                }
            }
            if (!resolved && typeof findLocationByNameLoose === "function") {
                resolved = findLocationByNameLoose(trimmed) || null;
            }
            return resolved?.name || trimmed;
        };

        const addedCharacters = this._resolveTrackedCharacterNames(this.newCharacters);
        const departedCharacters = this._resolveTrackedCharacterNames(this.departedCharacters);
        const movedLocationNames = Array.from(
            new Set(Array.from(this.movedLocations).map(resolveMovedLocationName).filter(Boolean)),
        );
        const addedSet = new Set(addedCharacters);
        const departedSet = new Set(departedCharacters);
        const movedSet = new Set(movedLocationNames);

        const npcUpdates = {
            added: addedCharacters,
            departed: departedCharacters,
            movedLocations: movedLocationNames,
        };

        let locationRefreshRequested = Boolean(
            (addedCharacters && addedCharacters.length) ||
            (departedCharacters && departedCharacters.length) ||
            (movedLocationNames && movedLocationNames.length) ||
            outcomeLocationRefreshRequested,
        );

        const followupResults = [];
        if (
            depth === 0 &&
            Array.isArray(activeFollowupQueue) &&
            activeFollowupQueue.length
        ) {
            const seen = new Set();
            while (activeFollowupQueue.length) {
                const pendingTexts = activeFollowupQueue.splice(
                    0,
                    activeFollowupQueue.length,
                );
                for (const followupText of pendingTexts) {
                    if (typeof followupText !== "string") {
                        continue;
                    }
                    const trimmedFollowup = followupText.trim();
                    if (!trimmedFollowup || seen.has(trimmedFollowup)) {
                        continue;
                    }
                    seen.add(trimmedFollowup);
                    try {
                        const followup = await this.runEventChecks({
                            textToCheck: trimmedFollowup,
                            stream,
                            allowEnvironmentalEffects,
                            isNpcTurn,
                            suppressMoveEvents,
                            allowMoveTurnAppearances,
                            suppressTimeAdvance: true,
                            ignoredEventKeys: Array.from(normalizedIgnoredEventKeys),
                            eventCheckIgnoreInstructions,
                            suppressNeedBarEventChecks: Boolean(suppressNeedBarEventChecks),
                            _depth: depth + 1,
                            followupQueue: activeFollowupQueue,
                        });
                        if (!followup) {
                            continue;
                        }

                        followupResults.push({
                            raw: followup.raw,
                            html: followup.html,
                            structured: followup.structured,
                        });

                        if (
                            Array.isArray(followup.experienceAwards) &&
                            followup.experienceAwards.length
                        ) {
                            experienceAwards.push(...followup.experienceAwards);
                        }
                        if (
                            Array.isArray(followup.currencyChanges) &&
                            followup.currencyChanges.length
                        ) {
                            currencyChanges.push(...followup.currencyChanges);
                        }
                        if (
                            Array.isArray(followup.environmentalDamageEvents) &&
                            followup.environmentalDamageEvents.length
                        ) {
                            environmentalDamageEvents.push(
                                ...followup.environmentalDamageEvents,
                            );
                        }
                        if (
                            Array.isArray(followup.needBarChanges) &&
                            followup.needBarChanges.length
                        ) {
                            needBarChanges.push(...followup.needBarChanges);
                        }
                        if (
                            Array.isArray(followup.dispositionChanges) &&
                            followup.dispositionChanges.length
                        ) {
                            dispositionChanges.push(...followup.dispositionChanges);
                        }
                        if (
                            Array.isArray(followup.factionReputationChanges) &&
                            followup.factionReputationChanges.length
                        ) {
                            factionReputationChanges.push(
                                ...followup.factionReputationChanges,
                            );
                        }
                        if (
                            Array.isArray(followup.questsAwarded) &&
                            followup.questsAwarded.length
                        ) {
                            questsAwarded.push(...followup.questsAwarded);
                        }
                        if (
                            Array.isArray(followup.questRewards) &&
                            followup.questRewards.length
                        ) {
                            questRewards.push(...followup.questRewards);
                        }
                        if (
                            Array.isArray(followup.questObjectivesCompleted) &&
                            followup.questObjectivesCompleted.length
                        ) {
                            questObjectivesCompleted.push(
                                ...followup.questObjectivesCompleted,
                            );
                        }
                        if (followup.locationRefreshRequested) {
                            locationRefreshRequested = true;
                        }
                        if (followup.npcUpdates) {
                            if (Array.isArray(followup.npcUpdates.added)) {
                                followup.npcUpdates.added.forEach((name) => {
                                    if (name && !addedSet.has(name)) {
                                        addedSet.add(name);
                                        addedCharacters.push(name);
                                    }
                                });
                            }
                            if (Array.isArray(followup.npcUpdates.departed)) {
                                followup.npcUpdates.departed.forEach((name) => {
                                    if (name && !departedSet.has(name)) {
                                        departedSet.add(name);
                                        departedCharacters.push(name);
                                    }
                                });
                            }
                            if (Array.isArray(followup.npcUpdates.movedLocations)) {
                                followup.npcUpdates.movedLocations.forEach((name) => {
                                    if (name && !movedSet.has(name)) {
                                        movedSet.add(name);
                                        movedLocationNames.push(name);
                                    }
                                });
                            }
                        }
                    } catch (error) {
                        console.warn(
                            "Failed to process follow-up event text:",
                            error.message,
                        );
                    }
                }
            }
        }

        console.debug(
            "[QuestDebug] runEventChecks returning quests:",
            questsAwarded,
        );

        const eventResult = {
            raw: cleaned,
            html,
            structured,
            experienceAwards,
            currencyChanges,
            environmentalDamageEvents,
            needBarChanges,
            dispositionChanges,
            factionReputationChanges,
            npcUpdates,
            locationRefreshRequested,
            questObjectivesCompleted,
            questRewards,
            questsAwarded,
            followupResults,
            hiddenNpcChecks,
            timeProgress,
        };

        await this._runHousekeepingAfterEventChecks({
            depth,
            suppressHousekeeping: Boolean(suppressHousekeeping),
            textToCheck,
            actionText: normalizedActionText,
            stream,
            location,
            eventResult,
            entryCollector,
            housekeepingScheduled,
        });

        return eventResult;
    }

    static mergeQuestOutcomesIntoStructured(
        structured,
        { questRewards = [], questObjectivesCompleted = [] } = {},
    ) {
        if (!structured || typeof structured !== "object") {
            return;
        }

        const ensureParsed = () => {
            if (!structured.parsed || typeof structured.parsed !== "object") {
                structured.parsed = {};
            }
            return structured.parsed;
        };

        const ensureRawEntries = () => {
            if (!structured.rawEntries || typeof structured.rawEntries !== "object") {
                structured.rawEntries = {};
            }
            return structured.rawEntries;
        };

        if (Array.isArray(questRewards) && questRewards.length) {
            const parsedContainer = ensureParsed();
            const normalizedRewards = questRewards.map((reward) => ({
                questId: reward.questId || null,
                questName: reward.questName || null,
                items: Array.isArray(reward.items) ? reward.items.slice() : [],
                xp: Number.isFinite(reward.xp) ? reward.xp : 0,
                currency: Number.isFinite(reward.currency) ? reward.currency : 0,
                factionReputation: Array.isArray(reward.factionReputation)
                    ? reward.factionReputation
                        .map((entry) => ({
                            factionId: entry?.factionId || null,
                            factionName: entry?.factionName || null,
                            amount: Number.isFinite(entry?.amount) ? entry.amount : 0,
                            before: Number.isFinite(entry?.before) ? entry.before : null,
                            after: Number.isFinite(entry?.after) ? entry.after : null,
                        }))
                        .filter((entry) => entry.amount !== 0)
                    : [],
                npcDispositions: Array.isArray(reward.npcDispositions)
                    ? reward.npcDispositions
                        .map((entry) => ({
                            npcId: entry?.npcId || null,
                            npcName: entry?.npcName || null,
                            typeKey: entry?.typeKey || null,
                            typeLabel: entry?.typeLabel || null,
                            typeIcon: entry?.typeIcon || null,
                            intensity: Number.isFinite(entry?.intensity) ? entry.intensity : null,
                            delta: Number.isFinite(entry?.delta) ? entry.delta : null,
                            previousValue: Number.isFinite(entry?.previousValue) ? entry.previousValue : null,
                            newValue: Number.isFinite(entry?.newValue) ? entry.newValue : null,
                            reason: entry?.reason || null,
                        }))
                        .filter((entry) => Number.isFinite(entry.delta) && entry.delta !== 0)
                    : [],
                message: reward.message || null,
            }));
            if (Array.isArray(parsedContainer.quest_rewards)) {
                parsedContainer.quest_rewards.push(...normalizedRewards);
            } else {
                parsedContainer.quest_rewards = normalizedRewards;
            }

            if (structured.rawEntries && typeof structured.rawEntries === "object") {
                const rewardMessages = questRewards
                    .map((entry) =>
                        typeof entry.message === "string" ? entry.message.trim() : "",
                    )
                    .filter(Boolean);
                if (rewardMessages.length) {
                    structured.rawEntries.quest_rewards = rewardMessages.join(" | ");
                }
            }
        }

        if (
            Array.isArray(questObjectivesCompleted) &&
            questObjectivesCompleted.length
        ) {
            const parsedContainer = ensureParsed();
            const normalizedObjectives = questObjectivesCompleted.map((entry) => ({
                questId: entry.questId || null,
                questName: entry.questName || null,
                objectiveIndex: Number.isFinite(entry.objectiveIndex)
                    ? entry.objectiveIndex
                    : null,
                objectiveNumber: Number.isFinite(entry.objectiveNumber)
                    ? entry.objectiveNumber
                    : null,
                objectiveDescription: entry.objectiveDescription || null,
                reason:
                    typeof entry?.reason === "string" && entry.reason.trim()
                        ? entry.reason.trim()
                        : null,
                questCompleted: Boolean(entry.questCompleted),
                questJustCompleted: Boolean(entry.questJustCompleted),
            }));
            if (Array.isArray(parsedContainer.completed_quest_objective)) {
                parsedContainer.completed_quest_objective.push(...normalizedObjectives);
            } else {
                parsedContainer.completed_quest_objective = normalizedObjectives;
            }

            const rawEntries = ensureRawEntries();
            const rawSegments = normalizedObjectives
                .map((entry) => {
                    const questLabel = entry.questName || entry.questId || "Quest";
                    const description =
                        entry.objectiveDescription ||
                        (entry.objectiveNumber
                            ? `Objective ${entry.objectiveNumber}`
                            : null) ||
                        (entry.objectiveIndex !== null
                            ? `Objective ${entry.objectiveIndex + 1}`
                            : null);
                    const reason =
                        typeof entry?.reason === "string" && entry.reason.trim()
                            ? entry.reason.trim()
                            : "";
                    const baseText = `${questLabel} → ${description || "Objective completed"}`;
                    return reason ? `${baseText} (${reason})` : baseText;
                })
                .filter(Boolean);
            if (rawSegments.length) {
                rawEntries.completed_quest_objective = rawSegments.join(" | ");
            }
        }
    }

    static _mergeItemTriggeredStatusChangesIntoStructured(
        structured,
        itemTriggeredStatusChanges = [],
    ) {
        if (
            !structured ||
            typeof structured !== "object" ||
            !Array.isArray(itemTriggeredStatusChanges) ||
            !itemTriggeredStatusChanges.length
        ) {
            return;
        }

        if (!structured.parsed || typeof structured.parsed !== "object") {
            structured.parsed = {};
        }

        const statusEntries = Array.isArray(structured.parsed.status_effect_change)
            ? structured.parsed.status_effect_change
            : [];
        structured.parsed.status_effect_change = statusEntries;

        const existingKeys = new Set(
            statusEntries
                .map((entry) => {
                    const entity = normalizeString(entry?.entity).toLowerCase();
                    const action = normalizeString(entry?.action).toLowerCase() || "gained";
                    const detail = normalizeStatusEffectDescription(
                        entry?.description || entry?.detail,
                    );
                    if (!entity || !detail) {
                        return "";
                    }
                    return `${entity}|${action}|${detail}`;
                })
                .filter(Boolean),
        );

        for (const change of itemTriggeredStatusChanges) {
            const entity = normalizeString(change?.entity);
            const action =
                normalizeString(change?.action).toLowerCase() || "gained";
            const detail = normalizeString(change?.description || change?.detail);
            const detailKey = normalizeStatusEffectDescription(detail);
            const entityKey = entity.toLowerCase();
            if (!entity || !detail || !detailKey) {
                continue;
            }

            const key = `${entityKey}|${action}|${detailKey}`;
            if (existingKeys.has(key)) {
                continue;
            }

            const entry = {
                entity,
                detail,
                description: detail,
                action,
                source:
                    typeof change?.source === "string" && change.source.trim()
                        ? change.source.trim()
                        : "item_inflict",
            };

            if (Number.isFinite(change?.level)) {
                entry.level = change.level;
            } else {
                entry.level = null;
            }

            if (typeof change?.itemName === "string" && change.itemName.trim()) {
                entry.item = change.itemName.trim();
            }

            statusEntries.push(entry);
            existingKeys.add(key);
        }
    }

    static _removeSuppressedStatusEffectChangesFromStructured(
        structured,
        suppressedStatusEffectChanges = [],
    ) {
        const statusEntries = structured?.parsed?.status_effect_change;
        if (
            !Array.isArray(statusEntries)
            || !statusEntries.length
            || !Array.isArray(suppressedStatusEffectChanges)
            || !suppressedStatusEffectChanges.length
        ) {
            return;
        }

        const buildKey = (entry) => {
            const entity = normalizeString(entry?.entity).toLowerCase();
            const detail = normalizeStatusEffectDescription(
                entry?.description || entry?.detail,
            );
            const action = normalizeString(entry?.action).toLowerCase() || "gained";
            const level = Number.isFinite(entry?.level) ? String(entry.level) : "";
            return entity && detail
                ? `${entity}|${detail}|${action}|${level}`
                : "";
        };
        const suppressedKeys = new Set(
            suppressedStatusEffectChanges.map(buildKey).filter(Boolean),
        );
        if (!suppressedKeys.size) {
            return;
        }

        structured.parsed.status_effect_change = statusEntries.filter(
            (entry) => !suppressedKeys.has(buildKey(entry)),
        );
    }

    static async processQuestObjectiveCompletionEntries(
        entries = [],
        context = {},
    ) {
        if (!Array.isArray(entries) || !entries.length) {
            console.warn("completed_quest_objective handler called with no entries.");
            return;
        }

        const player = context.player || this.currentPlayer;
        if (!player || typeof player.getQuestByName !== "function") {
            throw new Error(
                "completed_quest_objective handler requires a valid player with quests.",
            );
        }

        if (!Array.isArray(context.completedQuestObjectives)) {
            context.completedQuestObjectives = [];
        }
        if (!Array.isArray(context.questCompletionRewards)) {
            context.questCompletionRewards = [];
        }
        if (!Array.isArray(context.experienceAwards)) {
            context.experienceAwards = [];
        }
        if (!Array.isArray(context.currencyChanges)) {
            context.currencyChanges = [];
        }
        if (!Array.isArray(context.factionStandingChanges)) {
            context.factionStandingChanges = [];
        }
        if (!Array.isArray(context.dispositionChanges)) {
            context.dispositionChanges = [];
        }
        if (!Array.isArray(context.followupQueue)) {
            context.followupQueue = [];
        }
        if (!Array.isArray(context.followupResults)) {
            context.followupResults = [];
        }

        const {
            generateItemsByNames,
            getCurrencyLabel,
            promptEnv,
            parseXMLTemplate,
            prepareBasePromptContext,
        } = this._deps;
        if (
            typeof promptEnv?.render !== "function" ||
            typeof parseXMLTemplate !== "function" ||
            typeof prepareBasePromptContext !== "function"
        ) {
            throw new Error(
                "completed_quest_objective handler is missing prompt dependencies.",
            );
        }
        const currencyContext = this.config?.setting || Globals.config || {};
        const rewardLabel = (amount) => {
            if (typeof getCurrencyLabel === "function") {
                try {
                    return getCurrencyLabel(amount, currencyContext);
                } catch (_) {
                    // ignore
                }
            }
            return Math.abs(Number(amount)) === 1 ? "coin" : "coins";
        };

        const rewardedQuestIds = new Set();
        let rewardPromptContext = context._questRewardPromptContext || null;

        for (const entry of entries) {
            const questIndexValue = Number(entry?.questIndex) - 1;
            const objectiveIndexValue = Number(entry?.objectiveIndex) - 1;
            if (
                !Number.isFinite(questIndexValue) ||
                !Number.isFinite(objectiveIndexValue)
            ) {
                console.warn(
                    "completed_quest_objective handler called with invalid entry:",
                    entry,
                );
                continue;
            }

            const quest =
                typeof player.getQuestByIndex === "function"
                    ? player.getQuestByIndex(Math.max(0, Math.round(questIndexValue)))
                    : null;
            if (!quest) {
                console.warn(
                    `completed_quest_objective: Quest index ${questIndexValue + 1} not found on player.`,
                );
                continue;
            }

            const zeroBasedIndex = Math.max(0, Math.round(objectiveIndexValue));
            if (
                !Array.isArray(quest.objectives) ||
                !quest.objectives[zeroBasedIndex]
            ) {
                console.warn(
                    `completed_quest_objective: Quest "${quest.name}" objective index ${objectiveIndexValue} is invalid.`,
                );
                continue;
            }

            const objective = quest.objectives[zeroBasedIndex];
            const objectiveWasCompleted = objective.completed;
            const questWasComplete = quest.completed;
            if (!objectiveWasCompleted) {
                objective.completed = true;
            }
            const questIsComplete = quest.completed;
            const questJustCompleted = !questWasComplete && questIsComplete;

            if (!objectiveWasCompleted) {
                context.completedQuestObjectives.push({
                    questId: quest.id,
                    questName: quest.name,
                    questIndex: Math.max(0, Math.round(questIndexValue)),
                    objectiveIndex: zeroBasedIndex,
                    objectiveNumber: zeroBasedIndex + 1,
                    objectiveDescription: objective.description || null,
                    reason:
                        typeof entry?.statusReason === "string" && entry.statusReason.trim()
                            ? entry.statusReason.trim()
                            : (typeof entry?.reason === "string" && entry.reason.trim()
                                ? entry.reason.trim()
                                : null),
                    questCompleted: questIsComplete,
                    questJustCompleted,
                });
            }

            if (
                !quest.completed ||
                quest.rewardClaimed ||
                rewardedQuestIds.has(quest.id)
            ) {
                continue;
            }

            rewardedQuestIds.add(quest.id);

            const rewardItems = Array.isArray(quest.rewardItems)
                ? quest.rewardItems.filter(Boolean)
                : [];
            const rewardCurrency = Number.isFinite(quest.rewardCurrency)
                ? Math.max(0, quest.rewardCurrency)
                : 0;
            const rewardXp = Number.isFinite(quest.rewardXp)
                ? Math.max(0, quest.rewardXp)
                : 0;
            const rewardFactionReputationRaw =
                quest.rewardFactionReputation && typeof quest.rewardFactionReputation === "object"
                    ? quest.rewardFactionReputation
                    : {};
            const rewardFactionReputation = {};
            for (const [rawFactionId, rawAmount] of Object.entries(rewardFactionReputationRaw)) {
                const factionId = typeof rawFactionId === "string" ? rawFactionId.trim() : "";
                if (!factionId) {
                    continue;
                }
                const amount = Number(rawAmount);
                if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount === 0) {
                    continue;
                }
                rewardFactionReputation[factionId] = amount;
            }

            const grantedItems = [];
            if (rewardItems.length && typeof generateItemsByNames !== "function") {
                throw new Error(
                    `Quest "${quest.name}" has item rewards, but generateItemsByNames is unavailable.`,
                );
            }
            for (let rewardIndex = 0; rewardIndex < rewardItems.length; rewardIndex += 1) {
                const requestedItemName = typeof rewardItems[rewardIndex] === "string"
                    ? rewardItems[rewardIndex].trim()
                    : "";
                if (!requestedItemName) {
                    continue;
                }
                const existingRewardItem = typeof player.getInventoryItems === "function"
                    ? player.getInventoryItems().find((item) => (
                        item?.metadata?.questRewardQuestId === quest.id
                        && Number(item?.metadata?.questRewardIndex) === rewardIndex
                    )) || null
                    : null;
                if (existingRewardItem) {
                    grantedItems.push(existingRewardItem.name || requestedItemName);
                    continue;
                }

                const createdItems = await generateItemsByNames({
                    itemNames: [requestedItemName],
                    owner: player,
                    seeds: [{
                        name: requestedItemName,
                        itemOrScenery: "item",
                    }],
                    options: {
                        mergeStacks: false,
                        creationMetadata: {
                            questRewardQuestId: quest.id,
                            questRewardIndex: rewardIndex,
                        },
                    },
                });
                if (!Array.isArray(createdItems) || createdItems.length !== 1) {
                    throw new Error(
                        `Quest "${quest.name}" reward item "${requestedItemName}" did not generate exactly once.`,
                    );
                }
                const createdItemName = typeof createdItems[0]?.name === "string"
                    ? createdItems[0].name.trim()
                    : "";
                if (!createdItemName) {
                    throw new Error(
                        `Quest "${quest.name}" generated a reward item without a canonical name.`,
                    );
                }
                grantedItems.push(createdItemName);
            }

            if (rewardCurrency > 0) {
                if (typeof player.adjustCurrency !== "function") {
                    throw new Error(
                        `Quest "${quest.name}" has a currency reward, but player.adjustCurrency is unavailable.`,
                    );
                }
                const before = typeof player.getCurrency === "function"
                    ? player.getCurrency()
                    : Number(player.currency) || 0;
                const after = player.adjustCurrency(rewardCurrency);
                context.currencyChanges.push({
                    amount: rewardCurrency,
                    before,
                    after,
                    reason: `Completed quest: ${quest.name}`,
                });
            }
            if (rewardXp > 0 && typeof player.addExperience === "function") {
                player.addExperience(rewardXp);
                context.experienceAwards.push({
                    amount: rewardXp,
                    reason: `Completed quest: ${quest.name}`,
                });
            }

            const appliedFactionStandingChanges = [];
            for (const [factionId, delta] of Object.entries(rewardFactionReputation)) {
                const normalizedFactionId = typeof factionId === "string" ? factionId.trim() : "";
                if (!normalizedFactionId) {
                    continue;
                }
                const faction = typeof Faction.getById === "function"
                    ? Faction.getById(normalizedFactionId)
                    : null;
                if (!faction) {
                    console.warn(
                        `Quest "${quest.name}" has reputation reward for unknown faction "${normalizedFactionId}"; skipping entry.`,
                    );
                    continue;
                }
                if (typeof player.getFactionStanding !== "function" || typeof player.setFactionStanding !== "function") {
                    console.warn(
                        `Quest "${quest.name}" has faction reputation rewards, but player standing helpers are unavailable.`,
                    );
                    break;
                }

                const beforeRaw = player.getFactionStanding(normalizedFactionId);
                const before = Number.isFinite(beforeRaw) ? beforeRaw : 0;
                const after = before + delta;
                try {
                    player.setFactionStanding(normalizedFactionId, after);
                } catch (error) {
                    console.warn(
                        `Failed to apply quest faction standing reward for faction "${normalizedFactionId}":`,
                        error?.message || error,
                    );
                    continue;
                }

                appliedFactionStandingChanges.push({
                    factionId: normalizedFactionId,
                    factionName: faction.name || normalizedFactionId,
                    amount: delta,
                    before,
                    after
                });
            }

            if (appliedFactionStandingChanges.length) {
                context.factionStandingChanges.push(...appliedFactionStandingChanges);
            }

            const appliedNpcDispositionRewards = Events._applyQuestNpcDispositionRewards(
                quest,
                context,
            );

            quest.rewardClaimed = true;

            const rewardLines = [];
            grantedItems.filter(Boolean).forEach((itemName) => {
                rewardLines.push(itemName);
            });
            if (rewardXp > 0) {
                rewardLines.push(`${rewardXp} XP`);
            }
            if (rewardCurrency > 0) {
                rewardLines.push(`${rewardCurrency} ${rewardLabel(rewardCurrency)}`);
            }
            for (const change of appliedFactionStandingChanges) {
                const amount = Number(change.amount);
                const signed = amount > 0 ? `+${amount}` : `${amount}`;
                rewardLines.push(`${signed} reputation with ${change.factionName}`);
            }
            for (const change of appliedNpcDispositionRewards) {
                const amount = Number(change.delta);
                if (!Number.isFinite(amount) || amount === 0) {
                    continue;
                }
                const signed = amount > 0 ? `+${Math.round(amount)}` : `${Math.round(amount)}`;
                const typeLabel = change.typeLabel || change.typeKey || "disposition";
                const npcName = change.npcName || change.npcId || "NPC";
                rewardLines.push(`${signed} ${typeLabel} disposition with ${npcName}`);
            }

            if (!rewardLines.length) {
                continue;
            }

            let rewardProse = "";
            const useTinyBrainQuestReward = isTinyBrainPromptEnabled(
                Globals.config?.ai,
                "quest_reward_prose",
            );
            const fallbackList = [
                "Received item summary (shorten these item names to a reasonable size):",
                ...rewardLines.map((line) => `* ${line}`),
            ].join("\n");
            try {
                if (!rewardPromptContext) {
                    const rewardLocation = context.location || null;
                    rewardPromptContext = await prepareBasePromptContext({
                        locationOverride: rewardLocation,
                    });
                    context._questRewardPromptContext = rewardPromptContext;
                }
                const rewardTemplateContext = {
                    ...rewardPromptContext,
                    promptType: "quest-reward-prose",
                    questRewards: rewardLines,
                };
                const tinyBrain = useTinyBrainQuestReward
                    ? configureTinyBrainPromptContext(
                        rewardTemplateContext,
                        "quest_reward_prose",
                    )
                    : null;
                const renderedRewardPrompt = promptEnv.render(
                    "base-context.xml.njk",
                    rewardTemplateContext,
                );
                const parsedRewardTemplate = parseXMLTemplate(renderedRewardPrompt);
                if (
                    !parsedRewardTemplate?.systemPrompt ||
                    !parsedRewardTemplate?.generationPrompt
                ) {
                    throw new Error(
                        "Quest reward prose template did not produce prompts.",
                    );
                }
                if (useTinyBrainQuestReward) {
                    const configuredRetries = Number(Globals.config?.ai?.retryAttempts);
                    const retryAttempts = Number.isInteger(configuredRetries) && configuredRetries >= 0
                        ? configuredRetries
                        : 1;
                    let result;
                    if (Globals.config?.ai?.live_deslop === true) {
                        if (typeof Globals.runTinyBrainNarrativePrompt !== "function") {
                            throw new Error(
                                "Shared live-deslop tiny-brain runner is unavailable for quest reward prose.",
                            );
                        }
                        const tinyBrainRun = await Globals.runTinyBrainNarrativePrompt({
                            family: "quest_reward_prose",
                            initialRenderedTemplate: renderedRewardPrompt,
                            templateContext: rewardTemplateContext,
                            tinyBrain,
                            metadataLabel: "quest_reward_prose",
                            finalParser: response => parseQuestRewardResult(
                                response,
                                rewardLines,
                            ),
                            requestOptions: {
                                metadataLabel: "quest_reward_prose",
                                validateXML: false,
                            },
                        });
                        result = tinyBrainRun.result;
                    } else {
                        result = await runTinyBrainPromptProgram({
                            initialRenderedTemplate: renderedRewardPrompt,
                            templateContext: rewardTemplateContext,
                            tinyBrain,
                            runnerOptions: {
                                promptEnv,
                                parseXMLTemplate,
                                retryAttempts,
                                metadataLabel: "quest_reward_prose",
                                logPrefix: "quest_reward_prose_tinybrain",
                                finalParser: response => parseQuestRewardResult(
                                    response,
                                    rewardLines,
                                ),
                                complete: async ({ messages, queueReservation }) => {
                                    const response = await LLMClient.chatCompletion({
                                        messages,
                                        queueReservation,
                                        metadataLabel: "quest_reward_prose",
                                        validateXML: false,
                                    });
                                    return {
                                        aiResponse: response,
                                        conversationMessages: [
                                            ...messages.map(message => ({ ...message })),
                                            { role: "assistant", content: response },
                                        ],
                                        toolInvocations: [],
                                    };
                                },
                            },
                        });
                    }
                    rewardProse = parseQuestRewardResult(
                        result.aiResponse,
                        rewardLines,
                    ).value.prose;
                } else {
                    const rewardMessages = [
                        { role: "system", content: parsedRewardTemplate.systemPrompt },
                        { role: "user", content: parsedRewardTemplate.generationPrompt },
                    ];
                    const rewardResponse = await LLMClient.chatCompletion({
                        messages: rewardMessages,
                        metadataLabel: "quest_reward_prose",
                        validateXML: false,
                    });
                    LLMClient.logPrompt({
                        prefix: "quest_reward_prose",
                        metadataLabel: "quest_reward_prose",
                        systemPrompt: parsedRewardTemplate.systemPrompt,
                        generationPrompt: parsedRewardTemplate.generationPrompt,
                        response: rewardResponse,
                    });
                    if (typeof rewardResponse === "string" && rewardResponse.trim()) {
                        rewardProse = rewardResponse.trim();
                    }
                }
            } catch (error) {
                if (useTinyBrainQuestReward) {
                    throw error;
                }
                console.warn("Failed to generate quest reward prose:", error.message);
                console.debug(error);
            }

            if (!rewardProse) {
                rewardProse = fallbackList;
            }

            if (Globals.config?.slop_buster === true) {
                const slopRemover = Globals.applySlopRemoval;
                if (typeof slopRemover !== "function") {
                    throw new Error("Slop remover is unavailable for quest reward prose.");
                }
                rewardProse = await slopRemover(rewardProse);
            }

            context.questCompletionRewards.push({
                questId: quest.id,
                questName: quest.name,
                items: grantedItems.slice(),
                xp: rewardXp,
                currency: rewardCurrency,
                factionReputation: appliedFactionStandingChanges.map((entry) => ({
                    factionId: entry.factionId,
                    factionName: entry.factionName,
                    amount: entry.amount,
                    before: entry.before,
                    after: entry.after
                })),
                npcDispositions: appliedNpcDispositionRewards.map((entry) => ({
                    npcId: entry.npcId || null,
                    npcName: entry.npcName || null,
                    typeKey: entry.typeKey || null,
                    typeLabel: entry.typeLabel || null,
                    typeIcon: entry.typeIcon || null,
                    intensity: Number.isFinite(entry.intensity) ? entry.intensity : null,
                    delta: Number.isFinite(entry.delta) ? entry.delta : null,
                    previousValue: Number.isFinite(entry.previousValue) ? entry.previousValue : null,
                    newValue: Number.isFinite(entry.newValue) ? entry.newValue : null,
                    reason: entry.reason || null
                })),
                message: rewardProse,
                rewards: rewardLines.slice(),
            });
        }
    }

    static _parseEventPromptResponse(responseText, { isFinalBlock = false } = {}) {
        if (typeof responseText !== "string") {
            throw new Error("Event check response must be a string.");
        }
        const finalBlock = isFinalBlock
            ? responseText
            : this._extractFinalEventBlock(responseText);
        const numbered = this._extractNumberedResponses(finalBlock);
        const rawGroups = new Map();
        const parsedGroups = new Map();

        EVENT_PROMPT_ORDER_FLAT.forEach((definition, position) => {
            const raw = numbered.get(position + 1) || "";
            if (!rawGroups.has(definition.key)) {
                rawGroups.set(definition.key, []);
                parsedGroups.set(definition.key, []);
            }

            rawGroups.get(definition.key).push(raw);
            const parser = this._parsers[definition.key];
            const parsed = parser ? parser(raw) : raw;
            const value =
                typeof definition.postProcess === "function"
                    ? ensureArray(parsed).map((entry) => definition.postProcess(entry))
                    : parsed;
            parsedGroups.get(definition.key).push(value);
        });

        const rawEntries = {};
        const parsedEntries = {};

        for (const [key, segments] of rawGroups.entries()) {
            const compactRaw = segments
                .map((segment) => (typeof segment === "string" ? segment.trim() : ""))
                .filter(
                    (segment) =>
                        segment.length > 0 && !NO_EVENT_TOKENS.has(segment.toLowerCase()),
                )
                .join(" | ");
            rawEntries[key] = compactRaw;

            const aggregator =
                this._aggregators[key] || ((items) => flattenAndFilter(items));
            const combined = aggregator(parsedGroups.get(key) || []);
            parsedEntries[key] = combined;
        }

        const itemAndSceneryNames = this.extractItemAndSceneryNames(rawEntries);
        if (itemAndSceneryNames instanceof SanitizedStringSet) {
            const filterOutItems = (entries, pickName) => {
                if (!Array.isArray(entries)) {
                    return entries;
                }
                return entries.filter((entry) => {
                    const candidate = pickName(entry);
                    return !itemAndSceneryNames.has(candidate);
                });
            };

            parsedEntries.new_exit_discovered = filterOutItems(
                parsedEntries.new_exit_discovered,
                (entry) => entry?.name,
            );
            parsedEntries.move_new_location = filterOutItems(
                parsedEntries.move_new_location,
                (entry) => entry?.name,
            );
            parsedEntries.move_location = filterOutItems(
                parsedEntries.move_location,
                (entry) => entry,
            );
        }

        if (
            parsedEntries.new_exit_discovered.length === 0 &&
            parsedEntries.move_location.length === 0
        ) {
            const firstAppearance = parsedEntries.npc_first_appearance || [];
            if (firstAppearance.length) {
                const arrivals = firstAppearance
                    .map((name) => normalizeString(name))
                    .filter((name) => name.length > 0)
                    .map((name) => ({
                        name,
                        action: "arrived",
                        destination: null,
                        firstAppearance: true,
                    }));

                if (!Array.isArray(parsedEntries.npc_arrival_departure)) {
                    parsedEntries.npc_arrival_departure = [];
                }

                // Check if the NPC already exists and is in this location (see Player.js and Location.js)
                // so we can avoid redundant arrivals
                const existingNames = Globals.location.getNPCNames();
                const uniqueArrivals = arrivals.filter(
                    (entry) => !existingNames.includes(entry.name),
                );

                parsedEntries.npc_arrival_departure.push(...uniqueArrivals);
            }
        }

        this._trackItemsFromParsing(parsedEntries);
        this._pruneExcludedItemEntries(parsedEntries);

        return { rawEntries, parsed: parsedEntries };
    }

    static _extractEventsXmlBlock(responseText) {
        if (typeof responseText !== "string") {
            throw new Error("Event XML response must be a string.");
        }
        const match = responseText.match(/<events\b[\s\S]*<\/events>/i);
        if (!match || !match[0] || !match[0].trim()) {
            throw new Error("Event XML response missing <events> block.");
        }
        return match[0].trim();
    }

    static createTinyBrainEventSequence() {
        return {
            continuationState: createTinyBrainContinuationState(),
            acceptedXmlFragments: [],
        };
    }

    static _requireTinyBrainEventSequence(sequence) {
        if (!sequence || typeof sequence !== "object" || Array.isArray(sequence)) {
            throw new Error("Tiny-brain event sequence must be an object.");
        }
        if (
            !sequence.continuationState
            || typeof sequence.continuationState !== "object"
            || Array.isArray(sequence.continuationState)
        ) {
            throw new Error("Tiny-brain event sequence is missing continuationState.");
        }
        if (!Array.isArray(sequence.acceptedXmlFragments)) {
            throw new Error("Tiny-brain event sequence acceptedXmlFragments must be an array.");
        }
        if (sequence.acceptedXmlFragments.some((value) => typeof value !== "string" || !value.trim())) {
            throw new Error("Tiny-brain event sequence acceptedXmlFragments must contain non-empty strings.");
        }
        return sequence;
    }

    static _buildTinyBrainAcceptedEventXml(sequence) {
        if (!sequence) {
            return "";
        }
        const validatedSequence = this._requireTinyBrainEventSequence(sequence);
        if (!validatedSequence.acceptedXmlFragments.length) {
            return "";
        }
        return `<events>\n${validatedSequence.acceptedXmlFragments.join("\n")}\n</events>`;
    }

    static _collectTinyBrainAcceptedItemStatusApplications(
        completedCheckpoints = {},
    ) {
        if (
            !completedCheckpoints
            || typeof completedCheckpoints !== "object"
            || Array.isArray(completedCheckpoints)
        ) {
            throw new Error(
                "Tiny-brain completed event checkpoints must be an object.",
            );
        }

        const findThingByName = this._deps?.findThingByName;
        if (typeof findThingByName !== "function") {
            return [];
        }

        const applications = [];
        const seen = new Set();
        for (const completed of Object.values(completedCheckpoints)) {
            const fragment = completed?.value?.xml;
            if (typeof fragment !== "string" || !fragment.trim()) {
                continue;
            }

            let doc;
            try {
                doc = Utils.parseXmlDocumentStrict(
                    `<events>${fragment}</events>`,
                    "text/xml",
                );
            } catch (error) {
                throw new Error(
                    `Failed to inspect accepted tiny-brain item events: ${error.message}`,
                );
            }

            for (const node of this._getXmlElementChildren(doc?.documentElement)) {
                if (node?.tagName !== "itemInflict" && node?.tagName !== "itemIngest") {
                    continue;
                }
                const itemName = this._getXmlDirectChildText(
                    node,
                    "fullItemName",
                );
                const targetName = this._getXmlDirectChildText(
                    node,
                    node.tagName === "itemIngest" ? "consumerName" : "targetName",
                );
                const item = itemName ? findThingByName(itemName) : null;
                if (!item || !targetName) {
                    continue;
                }

                for (const effect of collectItemTargetStatusEffects(item)) {
                    const effectName = normalizeString(effect?.name);
                    const effectDescription = extractStatusEffectDescription(effect);
                    const key = [
                        normalizeString(targetName).toLowerCase(),
                        normalizeString(itemName).toLowerCase(),
                        normalizeStatusEffectDescription(effectName),
                        normalizeStatusEffectDescription(effectDescription),
                    ].join("|");
                    if (seen.has(key)) {
                        continue;
                    }
                    seen.add(key);
                    applications.push({
                        targetName,
                        itemName,
                        effectName,
                        effectDescription,
                        sourceTag: node.tagName,
                    });
                }
            }
        }

        return applications;
    }

    static _normalizeTinyBrainEventSectionKind(value) {
        const normalized = typeof value === "string"
            ? value.trim().toLowerCase()
            : "";
        const sectionKind = normalized || "current";
        if (!TINY_BRAIN_EVENT_SECTION_KINDS.has(sectionKind)) {
            throw new Error(
                `Unknown tiny-brain event section kind "${value}".`,
            );
        }
        return sectionKind;
    }

    static _buildTinyBrainEventStages({
        eventSectionKind = "current",
        eventMode = "events",
        ignoredEventKeys = [],
        suppressTimeAdvance = false,
        suppressTrackerUpdates = false,
        hasRegisteredModEvents = false,
    } = {}) {
        const sectionKind = this._normalizeTinyBrainEventSectionKind(
            eventSectionKind,
        );
        const normalizedMode = typeof eventMode === "string"
            ? eventMode.trim().toLowerCase()
            : "";
        if (normalizedMode !== "events" && normalizedMode !== "trackers") {
            throw new Error(
                `Unknown tiny-brain event extraction mode "${eventMode}".`,
            );
        }
        const ignoredKeys = this._normalizeIgnoredEventKeys(ignoredEventKeys);
        const tagIsAllowed = (tagName) => {
            const eventKey = TINY_BRAIN_EVENT_TAG_TO_KEY[tagName];
            if (!eventKey || ignoredKeys.has(eventKey)) {
                return false;
            }
            if (tagName === "timePassed" && suppressTimeAdvance) {
                return false;
            }
            return true;
        };
        const makeStage = ({
            id,
            label,
            instructions,
            tags,
            requiredTags = [],
            allowRegisteredXmlEvents = false,
        }) => {
            const allowedTags = Array.from(new Set(tags.filter(tagIsAllowed)));
            const stageRequiredTags = Array.from(
                new Set(requiredTags.filter((tagName) => allowedTags.includes(tagName))),
            );
            if (!allowedTags.length && !allowRegisteredXmlEvents) {
                return null;
            }
            return {
                id,
                label,
                instructions,
                allowedTags,
                requiredTags: stageRequiredTags,
                allowedTagList: allowedTags.map((tag) => `<${tag}>`).join(", "),
                allowRegisteredXmlEvents: Boolean(allowRegisteredXmlEvents),
            };
        };

        if (normalizedMode === "trackers" || sectionKind === "tracker") {
            const trackerStage = suppressTrackerUpdates
                ? null
                : makeStage({
                    id: "trackers",
                    label: "tracker updates",
                    instructions:
                        "Using the complete turn prose and current tracker context, report only trackers that must be added, updated, or removed. Countdown trackers already display elapsed time and should change only when their deadline changes or resolves.",
                    tags: ["trackerUpdates"],
                });
            return trackerStage ? [trackerStage] : [];
        }

        if (sectionKind === "between") {
            const transitStage = makeStage({
                id: "transit",
                label: "things carried during movement",
                instructions:
                    "Report only existing inanimate items or scenery that moved with a character during this transit prose. Player movement, character movement, travel time, and all other event categories are authoritative elsewhere.",
                tags: ["thingMoveWithCharacter"],
            });
            const finalTransitStage = makeStage({
                id: "final",
                label: "final transit sweep",
                instructions:
                    "Check once more for a missed existing inanimate thing that moved with a character. Do not repeat an accepted event. No other event type is valid in transit prose.",
                tags: ["thingMoveWithCharacter"],
            });
            return [transitStage, finalTransitStage].filter(Boolean);
        }

        const stages = [];
        const allRegularTags = [];
        for (const definition of TINY_BRAIN_EVENT_STAGE_DEFINITIONS) {
            if (definition.id === "final") {
                continue;
            }
            const stage = makeStage(definition);
            if (!stage) {
                continue;
            }
            stages.push(stage);
            allRegularTags.push(...stage.allowedTags);
        }

        const finalDefinition = TINY_BRAIN_EVENT_STAGE_DEFINITIONS.find(
            (definition) => definition.id === "final",
        );
        const finalTags = [
            ...allRegularTags,
            ...(finalDefinition?.tags || []),
        ];
        const finalStage = makeStage({
            ...finalDefinition,
            tags: finalTags,
            allowRegisteredXmlEvents: Boolean(hasRegisteredModEvents),
        });
        if (finalStage) {
            stages.push(finalStage);
        }

        if (!suppressTrackerUpdates) {
            const trackerStage = makeStage({
                id: "trackers",
                label: "tracker updates",
                instructions:
                    "After all ordinary events are accepted, report only trackers that must be added, updated, or removed. Countdown trackers already display elapsed time and should change only when their deadline changes or resolves.",
                tags: ["trackerUpdates"],
            });
            if (trackerStage) {
                stages.push(trackerStage);
            }
        }

        return stages;
    }

    static _normalizeTinyBrainXmlEventSignature(node) {
        return node
            .toString()
            .replace(/>\s+</g, "><")
            .replace(/\s+/g, " ")
            .trim();
    }

    static _requireTinyBrainXmlEventFields(node, sectionKind, stageId) {
        const requiredFields = TINY_BRAIN_EVENT_REQUIRED_FIELDS[node?.tagName] || [];
        for (const fieldPath of requiredFields) {
            const parts = fieldPath.split(".");
            let currentNode = node;
            for (const part of parts) {
                currentNode = this._getXmlDirectChildNode(currentNode, part);
                if (!currentNode) {
                    break;
                }
            }
            const value = typeof currentNode?.textContent === "string"
                ? currentNode.textContent.trim()
                : "";
            if (!currentNode || !value) {
                throw new Error(
                    `Tiny-brain ${sectionKind}/${stageId} <${node?.tagName}> requires a non-empty <${fieldPath}> value.`,
                );
            }
        }
    }

    static parseTinyBrainEventXmlStage(response, {
        sectionKind = "current",
        stageId = "events",
        allowedTags = [],
        requiredTags = [],
        allowRegisteredXmlEvents = false,
        acceptedSignatures = [],
        acceptedDeathOutcomeNames = [],
        acceptedItemStatusApplications = [],
        authoritativeMovementCompanionNames = [],
        eventLocation = null,
    } = {}) {
        const normalizedSectionKind = this._normalizeTinyBrainEventSectionKind(
            sectionKind,
        );
        const normalizedStageId = typeof stageId === "string" && stageId.trim()
            ? stageId.trim()
            : "events";
        const normalized = requireNonWhitespaceResponse(
            response,
            `Tiny-brain ${normalizedSectionKind}/${normalizedStageId} event stage`,
        );
        if (!Array.isArray(requiredTags)) {
            throw new Error(
                `Tiny-brain ${normalizedSectionKind}/${normalizedStageId} requiredTags must be an array.`,
            );
        }
        const normalizedRequiredTags = Array.from(new Set(
            requiredTags
                .map((tagName) => typeof tagName === "string" ? tagName.trim() : "")
                .filter(Boolean),
        ));
        if (!Array.isArray(authoritativeMovementCompanionNames)
            || authoritativeMovementCompanionNames.some((name) => (
                typeof name !== "string" || !name.trim()
            ))) {
            throw new Error(
                `Tiny-brain ${normalizedSectionKind}/${normalizedStageId} authoritativeMovementCompanionNames must be an array of non-empty strings.`,
            );
        }
        const authoritativeMovementCompanionNameSet = new Set(
            authoritativeMovementCompanionNames.map((name) => name.trim().toLowerCase()),
        );
        const hasDoneTag = /<done\b/i.test(normalized);
        const hasEventsTag = /<events\b/i.test(normalized);
        if (hasDoneTag && !hasEventsTag) {
            if (normalizedRequiredTags.length) {
                throw new Error(
                    `Tiny-brain ${normalizedSectionKind}/${normalizedStageId} event stage must include required tags: ${normalizedRequiredTags.join(", ")}.`,
                );
            }
            return {
                response: normalized.trim(),
                value: { xml: "", signatures: [] },
            };
        }
        if (!hasEventsTag) {
            const naCheck = parseResponseOrNa(normalized);
            if (naCheck.value === false) {
                if (normalizedRequiredTags.length) {
                    throw new Error(
                        `Tiny-brain ${normalizedSectionKind}/${normalizedStageId} event stage must include required tags: ${normalizedRequiredTags.join(", ")}.`,
                    );
                }
                return {
                    response: normalized.trim(),
                    value: { xml: "", signatures: [] },
                };
            }
        }

        if (!Array.isArray(allowedTags)) {
            throw new Error(
                `Tiny-brain ${normalizedSectionKind}/${normalizedStageId} allowedTags must be an array.`,
            );
        }
        const allowedTagSet = new Set(
            allowedTags
                .map((tagName) => typeof tagName === "string" ? tagName.trim() : "")
                .filter(Boolean),
        );

        let xml;
        if (hasEventsTag) {
            xml = this._extractEventsXmlBlock(normalized);
        } else {
            let bareRoot = null;
            try {
                const bareDoc = Utils.parseXmlDocumentStrict(normalized, "text/xml");
                const candidateRoot = bareDoc?.documentElement || null;
                if (candidateRoot && allowedTagSet.has(candidateRoot.tagName)) {
                    bareRoot = candidateRoot;
                }
            } catch (_error) {
                // Preserve the canonical missing-envelope error below. Malformed
                // XML must not be mistaken for harmless wrapper omission.
            }
            xml = bareRoot
                ? `<events>${bareRoot.toString()}</events>`
                : this._extractEventsXmlBlock(normalized);
        }
        const existingSignatures = new Set(
            Array.isArray(acceptedSignatures)
                ? acceptedSignatures.filter((value) => typeof value === "string" && value)
                : [],
        );
        let doc;
        try {
            doc = Utils.parseXmlDocumentStrict(xml, "text/xml");
        } catch (error) {
            throw new Error(
                `Failed to parse tiny-brain ${normalizedSectionKind}/${normalizedStageId} event stage: ${error.message}`,
            );
        }
        const root = doc?.documentElement;
        if (!root || root.tagName !== "events") {
            throw new Error(
                `Tiny-brain ${normalizedSectionKind}/${normalizedStageId} event stage must have an <events> root element.`,
            );
        }
        const rawEventElements = this._getXmlElementChildren(root);
        const eventElements = rawEventElements.filter(
            (node) => !TINY_BRAIN_IGNORED_MOVEMENT_EVENT_TAGS.has(node?.tagName),
        );
        if (eventElements.length === 0) {
            if (rawEventElements.length > 0) {
                if (normalizedRequiredTags.length) {
                    throw new Error(
                        `Tiny-brain ${normalizedSectionKind}/${normalizedStageId} event stage must include required tags: ${normalizedRequiredTags.join(", ")}.`,
                    );
                }
                return {
                    response: normalized.trim(),
                    value: { xml: "", signatures: [] },
                };
            }
            throw new Error(
                `Tiny-brain ${normalizedSectionKind}/${normalizedStageId} event stage contained no event elements; output <events><done/></events> when there are none.`,
            );
        }
        const wrappedDoneElements = eventElements.filter(
            (node) => node?.tagName === "done",
        );
        if (wrappedDoneElements.length) {
            const wrappedDone = wrappedDoneElements[0];
            const hasDoneAttributes = Number(wrappedDone?.attributes?.length || 0) > 0;
            const hasDoneContent = typeof wrappedDone?.textContent === "string"
                && wrappedDone.textContent.trim().length > 0;
            const hasDoneChildren = this._getXmlElementChildren(wrappedDone).length > 0;
            if (
                wrappedDoneElements.length !== 1
                || eventElements.length !== 1
                || hasDoneAttributes
                || hasDoneContent
                || hasDoneChildren
            ) {
                throw new Error(
                    `Tiny-brain ${normalizedSectionKind}/${normalizedStageId} event stage may use <done/> only as the sole empty child of <events>.`,
                );
            }
            if (normalizedRequiredTags.length) {
                throw new Error(
                    `Tiny-brain ${normalizedSectionKind}/${normalizedStageId} event stage must include required tags: ${normalizedRequiredTags.join(", ")}.`,
                );
            }
            return {
                response: normalized.trim(),
                value: { xml: "", signatures: [] },
            };
        }

        const registry = Globals.modExtensionRegistry
            || this._deps?.modExtensionRegistry
            || null;
        const rawEventLists = {};
        const signatures = [];
        const singletonTags = new Set([
            "inCombat",
            "anyQuestObjectivesCompleted",
            "trackerUpdates",
        ]);
        const seenSingletonTags = new Set();
        const seenTags = new Set();
        for (const node of eventElements) {
            const tagName = node?.tagName || "";
            seenTags.add(tagName);
            const registeredEvent = allowRegisteredXmlEvents
                && registry
                && typeof registry.getXmlEventByTagName === "function"
                ? registry.getXmlEventByTagName(tagName)
                : null;
            if (!allowedTagSet.has(tagName) && !registeredEvent) {
                const allowedDescription = [
                    ...allowedTagSet,
                    ...(allowRegisteredXmlEvents ? ["registered mod event tags"] : []),
                ].join(", ");
                throw new Error(
                    `Tiny-brain ${normalizedSectionKind}/${normalizedStageId} event stage does not allow <${tagName}>; allowed: ${allowedDescription || "none"}.`,
                );
            }
            if (singletonTags.has(tagName)) {
                if (seenSingletonTags.has(tagName)) {
                    throw new Error(
                        `Tiny-brain ${normalizedSectionKind}/${normalizedStageId} event stage may contain <${tagName}> at most once.`,
                    );
                }
                seenSingletonTags.add(tagName);
            }

            const signature = this._normalizeTinyBrainXmlEventSignature(node);
            if (existingSignatures.has(signature) || signatures.includes(signature)) {
                throw new Error(
                    `Tiny-brain ${normalizedSectionKind}/${normalizedStageId} event stage repeated an already accepted <${tagName}> block.`,
                );
            }
            signatures.push(signature);

            if (tagName === "trackerUpdates") {
                const trackerUpdateNodes = this._getXmlElementChildren(node);
                if (!trackerUpdateNodes.length) {
                    throw new Error(
                        "<trackerUpdates> must contain at least one <trackerUpdate>; output <done/> when no trackers changed.",
                    );
                }
                const trackerUpdateSignatures = new Set();
                for (const trackerUpdateNode of trackerUpdateNodes) {
                    if (trackerUpdateNode.tagName !== "trackerUpdate") {
                        throw new Error(
                            "<trackerUpdates> may only contain <trackerUpdate> entries.",
                        );
                    }
                    this._requireTinyBrainXmlEventFields(
                        trackerUpdateNode,
                        normalizedSectionKind,
                        normalizedStageId,
                    );
                    const trackerUpdateSignature =
                        this._normalizeTinyBrainXmlEventSignature(trackerUpdateNode);
                    if (trackerUpdateSignatures.has(trackerUpdateSignature)) {
                        throw new Error(
                            `Tiny-brain ${normalizedSectionKind}/${normalizedStageId} event stage repeated an identical <trackerUpdate> block.`,
                        );
                    }
                    trackerUpdateSignatures.add(trackerUpdateSignature);
                    this._appendXmlRawEvent(
                        rawEventLists,
                        "tracker_updates",
                        this._formatXmlTrackerUpdateRawEntry(trackerUpdateNode),
                    );
                }
                continue;
            }

            if (!registeredEvent) {
                this._requireTinyBrainXmlEventFields(
                    node,
                    normalizedSectionKind,
                    normalizedStageId,
                );
            }
            if (
                authoritativeMovementCompanionNameSet.size > 0
                && (tagName === "npcArrival"
                    || tagName === "npcDeparture"
                    || tagName === "npcArrivalDeparture")
            ) {
                const emittedName = this._getXmlDirectChildText(node, "npcName");
                const resolvedActor = typeof this._deps?.findActorByName === "function"
                    ? this._deps.findActorByName(emittedName)
                    : null;
                const canonicalName = typeof resolvedActor?.name === "string"
                    ? resolvedActor.name.trim()
                    : "";
                if (
                    authoritativeMovementCompanionNameSet.has(emittedName.toLowerCase())
                    || (canonicalName
                        && authoritativeMovementCompanionNameSet.has(canonicalName.toLowerCase()))
                ) {
                    throw new Error(
                        `Tiny-brain ${normalizedSectionKind}/${normalizedStageId} must not emit <${tagName}> for authoritative player-movement companion "${canonicalName || emittedName}". Omit that event; the player movement endpoint moves this character exactly once.`,
                    );
                }
            }
            if (tagName === "thingArrival") {
                const emittedName = this._getXmlDirectChildText(node, "thingName");
                const eventLocationId = typeof eventLocation?.id === "string"
                    ? eventLocation.id.trim()
                    : "";
                const candidates = this._findThingsByExactName(emittedName);
                const arrivingThing = candidates.length
                    ? (
                        eventLocationId
                            ? candidates.find(
                                (thing) => this._thingLocationId(thing) !== eventLocationId,
                            ) || candidates[0]
                            : candidates[0]
                    )
                    : (
                        typeof this._deps?.findThingByName === "function"
                            ? this._deps.findThingByName(emittedName)
                            : null
                    );
                const currentPlacement = arrivingThing
                    ? this._resolveThingPlacement(arrivingThing, {
                        location: eventLocation,
                    })
                    : null;
                if (currentPlacement?.type === "owner") {
                    const ownerName = typeof currentPlacement.owner?.name === "string"
                        ? currentPlacement.owner.name.trim()
                        : "its current owner";
                    throw new Error(
                        `Tiny-brain ${normalizedSectionKind}/${normalizedStageId} must not emit <thingArrival> for owned thing "${arrivingThing.name || emittedName}" carried by "${ownerName}". Carried inventory remains owned during travel unless a separate structured drop or transfer event changes possession.`,
                    );
                }
                if (currentPlacement?.type === "container") {
                    throw new Error(
                        `Tiny-brain ${normalizedSectionKind}/${normalizedStageId} must not emit <thingArrival> for contained thing "${arrivingThing.name || emittedName}". A contained item does not independently arrive in the scene.`,
                    );
                }
            }
            const { key, raw } = this._mapXmlEventNodeToLegacyRaw(node);
            const normalizedRaw = typeof raw === "string" ? raw.trim() : "";
            if (!normalizedRaw || NO_EVENT_TOKENS.has(normalizedRaw.toLowerCase())) {
                throw new Error(
                    `Tiny-brain ${normalizedSectionKind}/${normalizedStageId} <${tagName}> did not contain a usable event value.`,
                );
            }
            this._appendXmlRawEvent(rawEventLists, key, normalizedRaw);
        }

        const missingRequiredTags = normalizedRequiredTags.filter(
            (tagName) => !seenTags.has(tagName),
        );
        if (missingRequiredTags.length) {
            throw new Error(
                `Tiny-brain ${normalizedSectionKind}/${normalizedStageId} event stage is missing required tags: ${missingRequiredTags.join(", ")}.`,
            );
        }

        const structured = this._buildStructuredEventsFromRawLists(
            rawEventLists,
            { trackItems: false },
        );
        for (const [eventKey, rawEntries] of Object.entries(rawEventLists)) {
            if (!Object.prototype.hasOwnProperty.call(structured.parsed, eventKey)) {
                throw new Error(
                    `Tiny-brain ${normalizedSectionKind}/${normalizedStageId} event <${eventKey}> failed semantic parsing.`,
                );
            }
            if (
                rawEntries.length > 0
                && Array.isArray(structured.parsed[eventKey])
                && structured.parsed[eventKey].length === 0
            ) {
                throw new Error(
                    `Tiny-brain ${normalizedSectionKind}/${normalizedStageId} event <${eventKey}> produced no valid entries.`,
                );
            }
        }

        const normalizeThingName = (value) =>
            typeof value === "string" ? value.trim().toLowerCase() : "";
        const consumedQuantityByName = new Map();
        for (const entry of structured.parsed.consume_item || []) {
            const itemName = normalizeThingName(entry?.item);
            const quantity = Number(entry?.quantity);
            if (!itemName || !Number.isInteger(quantity) || quantity <= 0) {
                continue;
            }
            consumedQuantityByName.set(
                itemName,
                (consumedQuantityByName.get(itemName) || 0) + quantity,
            );
        }
        const containedQuantityByName = new Map();
        for (const entry of structured.parsed.put_item_in_container || []) {
            const itemName = normalizeThingName(entry?.item);
            const quantity = Number(entry?.quantity);
            if (!itemName || !Number.isInteger(quantity) || quantity <= 0) {
                continue;
            }
            containedQuantityByName.set(
                itemName,
                (containedQuantityByName.get(itemName) || 0) + quantity,
            );
        }
        const findThingByNameForQuantity = this._deps?.findThingByName;
        if (typeof findThingByNameForQuantity === "function") {
            for (const [itemName, consumedQuantity] of consumedQuantityByName) {
                const containedQuantity = containedQuantityByName.get(itemName) || 0;
                if (containedQuantity <= 0) {
                    continue;
                }
                const thing = findThingByNameForQuantity(itemName);
                if (!thing) {
                    continue;
                }
                const availableQuantity = this._getThingCount(thing);
                if (consumedQuantity + containedQuantity > availableQuantity) {
                    throw new Error(
                        `Tiny-brain ${normalizedSectionKind}/${normalizedStageId} cannot consume ${consumedQuantity} and put ${containedQuantity} of "${thing.name || itemName}" into a container when only ${availableQuantity} exists. Remove the impossible duplicate item event.`,
                    );
                }
            }
        }

        const normalizeActorName = (value) =>
            typeof value === "string" ? value.trim().toLowerCase() : "";
        const resolvedDeathOutcomeNames = new Set(
            Array.isArray(acceptedDeathOutcomeNames)
                ? acceptedDeathOutcomeNames.map(normalizeActorName).filter(Boolean)
                : [],
        );
        const currentDeathOutcomeNames = Array.isArray(
            structured.parsed.death_incapacitation,
        )
            ? structured.parsed.death_incapacitation
                .map((entry) => normalizeActorName(entry?.name))
                .filter(Boolean)
            : [];
        for (const name of currentDeathOutcomeNames) {
            resolvedDeathOutcomeNames.add(name);
        }

        const defeatedEnemyNames = Array.isArray(structured.parsed.defeated_enemy)
            ? structured.parsed.defeated_enemy
            : [];
        const findActorByName = this._deps?.findActorByName;
        if (typeof findActorByName === "function") {
            const rejectDeadActorTarget = (entries, resolveName, tagName) => {
                if (!Array.isArray(entries)) {
                    return;
                }
                for (const entry of entries) {
                    const actorName = normalizeString(resolveName(entry));
                    const actor = actorName ? findActorByName(actorName) : null;
                    if (actor?.isDead !== true) {
                        continue;
                    }
                    throw new Error(
                        `Tiny-brain ${normalizedSectionKind}/${normalizedStageId} cannot use <${tagName}> on dead actor "${actorName}" because the event schema has no resurrection operation. Output no event for an ineffective attempt.`,
                    );
                }
            };

            rejectDeadActorTarget(
                structured.parsed.item_inflict,
                (entry) => entry?.target,
                "itemInflict",
            );
            rejectDeadActorTarget(
                structured.parsed.item_ingest,
                (entry) => entry?.target,
                "itemIngest",
            );
            rejectDeadActorTarget(
                structured.parsed.heal_recover,
                (entry) => entry?.character || entry?.recipient,
                "healRecover",
            );
            rejectDeadActorTarget(
                Array.isArray(structured.parsed.environmental_status_damage)
                    ? structured.parsed.environmental_status_damage.filter(
                        (entry) => normalizeString(entry?.effect).toLowerCase() === "healing",
                    )
                    : [],
                (entry) => entry?.name,
                "environmentalStatusDamage",
            );

            const statusChanges = Array.isArray(
                structured.parsed.status_effect_change,
            )
                ? structured.parsed.status_effect_change
                : [];
            for (const statusChange of statusChanges) {
                const actorName = normalizeString(statusChange?.entity);
                const statusName = normalizeStatusEffectDescription(
                    statusChange?.detail,
                );
                const action = normalizeString(statusChange?.action).toLowerCase();
                const actor = actorName ? findActorByName(actorName) : null;
                if (!actor || !statusName || (action !== "gained" && action !== "lost")) {
                    continue;
                }

                if (action === "gained" && actor.isDead === true) {
                    throw new Error(
                        `Tiny-brain ${normalizedSectionKind}/${normalizedStageId} cannot gain status "${statusChange.detail}" for dead actor "${actorName}" because the event schema has no resurrection operation. Output no event for an ineffective attempt.`,
                    );
                }

                if (action === "gained") {
                    const duplicateItemApplication = Array.isArray(
                        acceptedItemStatusApplications,
                    )
                        ? acceptedItemStatusApplications.find((application) => {
                            const targetName = normalizeActorName(
                                application?.targetName,
                            );
                            if (!targetName || targetName !== normalizeActorName(actorName)) {
                                return false;
                            }
                            const itemName = normalizeStatusEffectDescription(
                                application?.itemName,
                            );
                            const effectName = normalizeStatusEffectDescription(
                                application?.effectName,
                            );
                            const effectDescription = normalizeStatusEffectDescription(
                                application?.effectDescription,
                            );
                            return Boolean(
                                (effectName && (
                                    statusName === effectName
                                    || statusName.startsWith(effectName)
                                ))
                                || (effectDescription && statusName === effectDescription)
                                || (itemName && statusName.startsWith(itemName)),
                            );
                        })
                        : null;
                    if (duplicateItemApplication) {
                        throw new Error(
                            `Tiny-brain ${normalizedSectionKind}/${normalizedStageId} cannot gain status "${statusChange.detail}" for "${actorName}" because accepted <${duplicateItemApplication.sourceTag}> for "${duplicateItemApplication.itemName}" already applies its authoritative configured status. Omit the item-caused duplicate; report only a separate independently caused status.`,
                        );
                    }
                }

                let currentEffects = [];
                if (typeof actor.getStatusEffects === "function") {
                    currentEffects = actor.getStatusEffects();
                } else if (Array.isArray(actor.statusEffects)) {
                    currentEffects = actor.statusEffects;
                }
                const hasStatus = Array.isArray(currentEffects) && currentEffects.some(
                    (effect) => {
                        const effectName = normalizeStatusEffectDescription(
                            effect?.name,
                        );
                        const effectDescription = normalizeStatusEffectDescription(
                            effect?.description || effect?.text,
                        );
                        return statusName === effectName || statusName === effectDescription;
                    },
                );

                if (action === "gained" && hasStatus) {
                    throw new Error(
                        `Tiny-brain ${normalizedSectionKind}/${normalizedStageId} cannot gain status "${statusChange.detail}" for "${actorName}" because that actor already has it. Output only new status changes; an attack/item tool result may already have applied this effect.`,
                    );
                }
                if (action === "lost" && !hasStatus) {
                    throw new Error(
                        `Tiny-brain ${normalizedSectionKind}/${normalizedStageId} cannot lose status "${statusChange.detail}" for "${actorName}" because that actor does not currently have it.`,
                    );
                }
            }

            for (const enemyName of defeatedEnemyNames) {
                const actor = findActorByName(enemyName);
                const health = Number(actor?.health);
                const normalizedEnemyName = normalizeActorName(enemyName);
                if (
                    actor
                    && actor.isDead !== true
                    && Number.isFinite(health)
                    && health <= 0
                    && !resolvedDeathOutcomeNames.has(normalizedEnemyName)
                ) {
                    throw new Error(
                        `Tiny-brain ${normalizedSectionKind}/${normalizedStageId} defeated zero-health actor "${enemyName}" without a matching <deathIncapacitation> outcome. Declare that actor dead or incapacitated in the same event sequence.`,
                    );
                }
            }
        }

        return {
            value: {
                xml: eventElements.map((node) => node.toString()).join("\n"),
                signatures,
                deathOutcomeNames: currentDeathOutcomeNames,
            },
        };
    }

    static parseTinyBrainEventXmlChunk(response) {
        const allowedTags = Object.keys(TINY_BRAIN_EVENT_TAG_TO_KEY);
        const parsed = this.parseTinyBrainEventXmlStage(response, {
            sectionKind: "current",
            stageId: "legacy_chunk",
            allowedTags,
            allowRegisteredXmlEvents: true,
        });
        if (!parsed.value.xml) {
            return {
                terminate: true,
                response: parsed.response,
                value: false,
            };
        }
        return parsed;
    }

    static async _runTinyBrainEventXmlPrompt({
        initialRenderedTemplate,
        templateContext,
        tinyBrain,
        promptEnv,
        parseXMLTemplate,
        tinyBrainEventSequence = null,
        eventLocation = null,
    }) {
        const configuredRetries = Number(Globals.config?.ai?.retryAttempts);
        const retryAttempts =
            Number.isInteger(configuredRetries) && configuredRetries >= 0
                ? configuredRetries
                : 1;
        const eventSequence = tinyBrainEventSequence
            ? this._requireTinyBrainEventSequence(tinyBrainEventSequence)
            : null;
        const result = await runTinyBrainPromptProgram({
            initialRenderedTemplate,
            templateContext,
            tinyBrain,
            continuationState: eventSequence?.continuationState || null,
            refreshContinuationBaseContext: Boolean(eventSequence),
            runnerOptions: {
                promptEnv,
                parseXMLTemplate,
                retryAttempts,
                metadataLabel: "event_checks",
                logPrefix: "events_tinybrain",
                parsers: {
                    event_xml_stage: (
                        response,
                        sectionKind,
                        stageId,
                        allowedTags,
                        requiredTags,
                        allowRegisteredXmlEvents,
                    ) => {
                        const acceptedSignatures = Object.values(
                            tinyBrain.renderState.completedCheckpoints || {},
                        ).flatMap((completed) =>
                            Array.isArray(completed?.value?.signatures)
                                ? completed.value.signatures
                                : [],
                        );
                        const acceptedDeathOutcomeNames = Object.values(
                            tinyBrain.renderState.completedCheckpoints || {},
                        ).flatMap((completed) =>
                            Array.isArray(completed?.value?.deathOutcomeNames)
                                ? completed.value.deathOutcomeNames
                                : [],
                        );
                        const acceptedItemStatusApplications =
                            this._collectTinyBrainAcceptedItemStatusApplications(
                                tinyBrain.renderState.completedCheckpoints || {},
                            );
                        return this.parseTinyBrainEventXmlStage(response, {
                            sectionKind,
                            stageId,
                            allowedTags,
                            requiredTags,
                            allowRegisteredXmlEvents,
                            acceptedSignatures,
                            acceptedDeathOutcomeNames,
                            acceptedItemStatusApplications,
                            authoritativeMovementCompanionNames:
                                templateContext.tinyBrainAuthoritativeMovementCompanionNames,
                            eventLocation,
                        });
                    },
                },
                resultBuilders: {
                    event_xml_result: () => {
                        const fragments = Object.keys(
                            tinyBrain.renderState.completedCheckpoints || {},
                        )
                            .sort((a, b) => Number(a) - Number(b))
                            .map((key) =>
                                tinyBrain.renderState.completedCheckpoints[key]?.value?.xml,
                            )
                            .filter((xml) => typeof xml === "string" && xml.trim())
                            .map((xml) => xml.trim());
                        return `<events>\n${fragments.join("\n")}\n</events>`;
                    },
                },
                complete: async ({ messages, queueReservation }) => {
                const response = await LLMClient.chatCompletion({
                    messages,
                    queueReservation,
                    metadataLabel: "event_checks",
                    errorLogLabel: "events-xml",
                    metadata: {
                        eventPipeline: "xml-tinybrain",
                        promptType: "events-xml",
                    },
                    timeoutMs: this._baseTimeout,
                    temperature: 0,
                    validateXML: false,
                    dumpReasoningToConsole: true,
                    stream: true,
                });
                return {
                    aiResponse: response,
                    conversationMessages: [
                        ...messages.map((message) => ({ ...message })),
                        { role: "assistant", content: response },
                    ],
                    toolInvocations: [],
                };
                },
            },
        });
        if (eventSequence) {
            const completedValues = Object.keys(
                tinyBrain.renderState.completedCheckpoints || {},
            )
                .sort((a, b) => Number(a) - Number(b))
                .map((key) => tinyBrain.renderState.completedCheckpoints[key]?.value)
                .filter((value) => value && typeof value === "object");
            for (const value of completedValues) {
                if (typeof value.xml === "string" && value.xml.trim()) {
                    eventSequence.acceptedXmlFragments.push(value.xml.trim());
                }
            }
        }
        return result.aiResponse;
    }

    static _extractHousekeepingXmlBlock(responseText) {
        if (typeof responseText !== "string") {
            throw new Error("Housekeeping XML response must be a string.");
        }
        const match = responseText.match(/<housekeeping\b[\s\S]*<\/housekeeping>/i);
        if (!match || !match[0] || !match[0].trim()) {
            throw new Error("Housekeeping XML response missing <housekeeping> block.");
        }
        return match[0].trim();
    }

    static _parseHousekeepingBoolean(value, { fieldName = "value" } = {}) {
        const normalized = normalizeString(value).toLowerCase();
        if (normalized === "true") {
            return true;
        }
        if (normalized === "false") {
            return false;
        }
        throw new Error(`Housekeeping ${fieldName} must be true or false.`);
    }

    static _parseHousekeepingXmlResponse(responseText) {
        const xml = this._extractHousekeepingXmlBlock(responseText);
        let doc;
        try {
            doc = Utils.parseXmlDocumentStrict(xml, "text/xml");
        } catch (error) {
            throw new Error(`Failed to parse housekeeping XML response: ${error.message}`);
        }

        const root = doc?.documentElement;
        if (!root || root.tagName !== "housekeeping") {
            throw new Error("Housekeeping XML response did not parse into a <housekeeping> document.");
        }

        const rootChildren = this._getXmlElementChildren(root);
        const allowedRootTags = new Set(["quests", "trackers", "relationships"]);
        for (const child of rootChildren) {
            if (!allowedRootTags.has(child.tagName)) {
                throw new Error(`Unknown <housekeeping> child <${child.tagName}>.`);
            }
        }

        const questCalls = [];
        const trackerAdds = [];
        const trackerUpdates = [];
        const trackerRemovals = [];
        const relationshipItems = [];

        for (const questsNode of rootChildren.filter(child => child.tagName === "quests")) {
            for (const questNode of this._getXmlElementChildren(questsNode)) {
                if (questNode.tagName !== "quest") {
                    throw new Error("<quests> may only contain <quest> entries.");
                }
                const summary = this._getXmlDirectChildText(questNode, "summary");
                const giver = this._getXmlDirectChildText(questNode, "giver");
                const args = { summary };
                if (giver) {
                    args.giver = giver;
                }
                questCalls.push({
                    functionName: "createQuest",
                    argumentsObject: args,
                });
            }
        }

        for (const trackersNode of rootChildren.filter(child => child.tagName === "trackers")) {
            for (const trackerNode of this._getXmlElementChildren(trackersNode)) {
                if (trackerNode.tagName !== "tracker") {
                    throw new Error("<trackers> may only contain <tracker> entries.");
                }
                const action = this._getXmlDirectChildText(trackerNode, "action").toLowerCase();
                if (!["add", "update", "remove"].includes(action)) {
                    throw new Error("Housekeeping tracker action must be add, update, or remove.");
                }

                if (action === "add") {
                    const item = {
                        name: this._getXmlDirectChildText(trackerNode, "name"),
                        type: this._getXmlDirectChildText(trackerNode, "type"),
                        value: this._getXmlDirectChildText(trackerNode, "value"),
                        description: this._getXmlDirectChildText(trackerNode, "description"),
                    };
                    const hiddenNode = this._getXmlDirectChildNode(trackerNode, "hiddenFromPlayer");
                    if (hiddenNode) {
                        item.hiddenFromPlayer = this._parseHousekeepingBoolean(
                            hiddenNode.textContent,
                            { fieldName: "hiddenFromPlayer" },
                        );
                    }
                    const noteNode = this._getXmlDirectChildNode(trackerNode, "note");
                    if (noteNode) {
                        item.note = normalizeString(noteNode.textContent);
                    }
                    trackerAdds.push(item);
                } else if (action === "update") {
                    const item = {
                        tracker: this._getXmlDirectChildText(trackerNode, "target"),
                        value: this._getXmlDirectChildText(trackerNode, "value"),
                    };
                    const noteNode = this._getXmlDirectChildNode(trackerNode, "note");
                    if (noteNode) {
                        item.note = normalizeString(noteNode.textContent);
                    }
                    trackerUpdates.push(item);
                } else if (action === "remove") {
                    trackerRemovals.push({
                        tracker: this._getXmlDirectChildText(trackerNode, "target"),
                    });
                }
            }
        }

        for (const relationshipsNode of rootChildren.filter(child => child.tagName === "relationships")) {
            for (const relationshipNode of this._getXmlElementChildren(relationshipsNode)) {
                if (relationshipNode.tagName !== "relationship") {
                    throw new Error("<relationships> may only contain <relationship> entries.");
                }
                const rawAction = this._getXmlDirectChildText(relationshipNode, "action").toLowerCase();
                const action = rawAction || "set";
                if (!["add", "update", "set", "remove", "delete"].includes(action)) {
                    throw new Error("Housekeeping relationship action must be add, update, set, remove, or delete.");
                }
                const item = {
                    characterA: this._getXmlDirectChildText(relationshipNode, "characterA"),
                    characterB: this._getXmlDirectChildText(relationshipNode, "characterB"),
                };
                if (action === "remove" || action === "delete") {
                    item.action = "remove";
                } else {
                    item.relationship = this._getXmlDirectChildText(relationshipNode, "relationshipLabel");
                    const reciprocalRelationship = this._getXmlDirectChildText(
                        relationshipNode,
                        "reciprocalRelationship",
                    );
                    if (reciprocalRelationship) {
                        item.reciprocalRelationship = reciprocalRelationship;
                    }
                }
                relationshipItems.push(item);
            }
        }

        const toolCalls = [...questCalls];
        if (trackerAdds.length) {
            toolCalls.push({
                functionName: "addTracker",
                argumentsObject: { items: trackerAdds },
            });
        }
        if (trackerUpdates.length) {
            toolCalls.push({
                functionName: "updateTracker",
                argumentsObject: { items: trackerUpdates },
            });
        }
        if (trackerRemovals.length) {
            toolCalls.push({
                functionName: "removeTracker",
                argumentsObject: { items: trackerRemovals },
            });
        }
        if (relationshipItems.length) {
            toolCalls.push({
                functionName: "setRelationship",
                argumentsObject: { items: relationshipItems },
            });
        }

        return { xml, toolCalls };
    }

    static _escapeHousekeepingXmlText(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    static async _applyHousekeepingXmlResponse(responseText, {
        executeChatToolCall,
        onToolCallDebug = null,
        metadataLabel = "housekeeping",
        startingSequence = 0,
        includeAllHistoryEntryTypes = true,
        requestUserInputHandler = null,
        promptStream = null,
    } = {}) {
        if (typeof executeChatToolCall !== "function") {
            throw new Error("Housekeeping XML application requires executeChatToolCall.");
        }
        if (onToolCallDebug !== null && onToolCallDebug !== undefined && typeof onToolCallDebug !== "function") {
            throw new Error("Housekeeping XML onToolCallDebug must be a function when provided.");
        }

        const parsed = this._parseHousekeepingXmlResponse(responseText);
        const toolInvocations = [];
        let sequence = Number.isInteger(startingSequence) && startingSequence >= 0
            ? startingSequence
            : 0;

        for (const parsedToolCall of parsed.toolCalls) {
            sequence += 1;
            const functionName = parsedToolCall.functionName;
            const argumentsObject = parsedToolCall.argumentsObject || {};
            const toolCall = {
                id: `housekeeping_xml_${sequence}`,
                functionName,
                argumentsObject,
                argumentsText: JSON.stringify(argumentsObject),
            };
            const debugBase = {
                metadataLabel,
                round: null,
                sequence,
                id: toolCall.id,
                name: functionName,
                parameters: argumentsObject,
                argumentsText: toolCall.argumentsText,
            };

            if (typeof onToolCallDebug === "function") {
                await onToolCallDebug({
                    ...debugBase,
                    phase: "started",
                });
            }

            let toolResult = null;
            try {
                toolResult = await executeChatToolCall(toolCall, {
                    includeAllHistoryEntryTypes,
                    requestUserInputHandler,
                    promptStream,
                    allowRelationshipRemoval: true,
                });
                if (!toolResult || typeof toolResult.content !== "string" || !toolResult.content.trim()) {
                    throw new Error(`Housekeeping XML tool "${functionName}" returned empty content.`);
                }
            } catch (error) {
                const message = error?.message || String(error);
                toolResult = {
                    content: [
                        "<toolError>",
                        `  <tool>${this._escapeHousekeepingXmlText(functionName)}</tool>`,
                        `  <message>${this._escapeHousekeepingXmlText(message)}</message>`,
                        "</toolError>",
                    ].join("\n"),
                    metadata: {
                        error: true,
                        functionName,
                        code: "tool_execution_error",
                        message,
                        stack: typeof error?.stack === "string" ? error.stack : null,
                    },
                };
            }

            const metadata = toolResult?.metadata && typeof toolResult.metadata === "object"
                ? toolResult.metadata
                : {};
            if (typeof onToolCallDebug === "function") {
                if (metadata.error) {
                    await onToolCallDebug({
                        ...debugBase,
                        phase: "error",
                        error: {
                            message: metadata.message || `Tool "${functionName}" failed.`,
                            code: metadata.code || "tool_error",
                            result: {
                                content: toolResult.content,
                                metadata,
                            },
                        },
                    });
                } else {
                    await onToolCallDebug({
                        ...debugBase,
                        phase: "completed",
                        result: {
                            content: toolResult.content,
                            metadata,
                        },
                    });
                }
            }

            toolInvocations.push({
                id: toolCall.id,
                name: functionName,
                metadata,
            });
        }

        return {
            ...parsed,
            toolInvocations,
        };
    }

    static _getXmlElementChildren(node) {
        return Array.from(node?.childNodes || []).filter(
            (child) => child && child.nodeType === 1,
        );
    }

    static _getXmlDirectChildText(node, tagName) {
        if (!node || typeof tagName !== "string" || !tagName.trim()) {
            return "";
        }
        const directChild = this._getXmlDirectChildNode(node, tagName);
        const text = directChild?.textContent;
        return typeof text === "string" ? text.trim() : "";
    }

    static _getXmlDirectChildNode(node, tagName) {
        if (!node || typeof tagName !== "string" || !tagName.trim()) {
            return null;
        }
        return this._getXmlElementChildren(node).find(
            (child) => child.tagName === tagName,
        ) || null;
    }

    static _formatXmlLegacyRawEntry(node, fields) {
        const parts = fields.map((field) => {
            if (Array.isArray(field)) {
                const [tagName, fallback] = field;
                const text = this._getXmlDirectChildText(node, tagName);
                return text || fallback || "";
            }
            return this._getXmlDirectChildText(node, field);
        });
        return parts.join(" → ");
    }

    static _formatRegisteredXmlEventRaw(node) {
        const toPlainValue = (currentNode) => {
            const children = this._getXmlElementChildren(currentNode);
            if (!children.length) {
                const text = currentNode?.textContent;
                return typeof text === "string" ? text.trim() : "";
            }
            const result = {};
            for (const child of children) {
                const key = child?.tagName;
                if (!key) {
                    continue;
                }
                const value = toPlainValue(child);
                if (Object.prototype.hasOwnProperty.call(result, key)) {
                    if (!Array.isArray(result[key])) {
                        result[key] = [result[key]];
                    }
                    result[key].push(value);
                } else {
                    result[key] = value;
                }
            }
            return result;
        };
        return JSON.stringify(toPlainValue(node));
    }

    static _normalizeTrackerUpdateAction(value) {
        const action = normalizeString(value).toLowerCase();
        if (!["add", "update", "remove"].includes(action)) {
            throw new Error("tracker update action must be add, update, or remove.");
        }
        return action;
    }

    static _normalizeTrackerUpdateType(value) {
        const rawType = normalizeString(value);
        if (!rawType) {
            throw new Error("tracker update type is required.");
        }
        const normalized = rawType
            .toLowerCase()
            .replace(/%/g, "percentage")
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "");
        const aliases = new Map([
            ["count", "numerical_count"],
            ["number", "numerical_count"],
            ["numeric_count", "numerical_count"],
            ["numerical", "numerical_count"],
            ["numerical_count", "numerical_count"],
            ["countdown", "countdown"],
            ["x_out_of_total", "x_out_of_total"],
            ["x_of_total", "x_out_of_total"],
            ["x_total", "x_out_of_total"],
            ["out_of_total", "x_out_of_total"],
            ["percentage", "percentage"],
            ["percent", "percentage"],
            ["short_string", "short_string"],
            ["short_text", "short_string"],
        ]);
        const type = aliases.get(normalized) || normalized;
        if (!Tracker.validTypes.includes(type)) {
            throw new Error(
                `tracker update type must be one of: ${Tracker.validTypes.join(", ")}.`,
            );
        }
        return type;
    }

    static _normalizeTrackerUpdateValue(value, type, { required = true } = {}) {
        const normalizedType = this._normalizeTrackerUpdateType(type);
        const text = normalizeString(value);
        const lowered = text.toLowerCase();
        if (!text || NO_EVENT_TOKENS.has(lowered)) {
            if (required) {
                throw new Error("tracker update value is required.");
            }
            return "";
        }

        if (normalizedType === "percentage") {
            const match = text.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*%?$/);
            if (!match || !Number.isFinite(Number(match[1]))) {
                throw new Error("tracker percentage update value must be a finite number with optional %.");
            }
            return `${match[1]}%`;
        }

        if (normalizedType === "x_out_of_total") {
            const match = text.match(/^(\d+)\s*\/\s*(\d+)$/);
            if (!match) {
                throw new Error("tracker x_out_of_total update value must use x/total format.");
            }
            const current = Number.parseInt(match[1], 10);
            const total = Number.parseInt(match[2], 10);
            if (
                !Number.isSafeInteger(current) ||
                !Number.isSafeInteger(total) ||
                current < 0 ||
                total < 0
            ) {
                throw new Error("tracker x_out_of_total update value must use non-negative integer parts.");
            }
        }

        if (normalizedType === "short_string") {
            const words = text.split(/\s+/).filter(Boolean);
            const maxWords = Tracker.shortStringMaxWords();
            if (words.length > maxWords) {
                throw new Error(`tracker short_string update value must be ${Tracker.shortStringMaxWordsText()} words or fewer.`);
            }
        }

        return text;
    }

    static _parseTrackerUpdateRawEntry(entry) {
        const rawEntry = typeof entry === "string" ? entry : String(entry ?? "");
        const parts = splitArrowParts(rawEntry, 5);
        if (parts.length < 3) {
            throw new Error("tracker update entries require tracker name, type, and action.");
        }

        const trackerName = normalizeString(parts[0]);
        if (!trackerName) {
            throw new Error("tracker update trackerName is required.");
        }

        const type = this._normalizeTrackerUpdateType(parts[1]);
        const action = this._normalizeTrackerUpdateAction(parts[2]);
        let newValue = "";
        let reason = "";
        if (action === "remove") {
            if (parts.length >= 5) {
                newValue = this._normalizeTrackerUpdateValue(parts[3], type, {
                    required: false,
                });
                reason = normalizeString(parts[4]);
            } else {
                reason = normalizeString(parts[3]);
            }
        } else {
            newValue = this._normalizeTrackerUpdateValue(parts[3], type);
            reason = normalizeString(parts[4]);
        }

        const record = {
            trackerName,
            type,
            action,
            reason,
        };
        if (action !== "remove" || newValue) {
            record.newValue = newValue;
        }
        return record;
    }

    static _formatTrackerUpdateRawEntry(entry) {
        const trackerName = normalizeString(entry?.trackerName || entry?.name || entry?.tracker);
        const type = this._normalizeTrackerUpdateType(entry?.type);
        const action = this._normalizeTrackerUpdateAction(entry?.action);
        const rawValue = action === "remove"
            ? normalizeString(entry?.newValue ?? entry?.value) || "none"
            : this._normalizeTrackerUpdateValue(entry?.newValue ?? entry?.value, type);
        const reason = normalizeString(entry?.reason);
        if (!trackerName) {
            throw new Error("tracker update trackerName is required.");
        }
        return [
            trackerName,
            type,
            action,
            rawValue,
            reason,
        ].join(" → ");
    }

    static _formatXmlTrackerUpdateRawEntry(node) {
        return this._formatTrackerUpdateRawEntry({
            trackerName: this._getXmlDirectChildText(node, "trackerName"),
            type: this._getXmlDirectChildText(node, "type"),
            action: this._getXmlDirectChildText(node, "action"),
            newValue: this._getXmlDirectChildText(node, "newValue"),
            reason: this._getXmlDirectChildText(node, "reason"),
        });
    }

    static _logTrackerUpdateEntryError(entry, error) {
        const entryText = this._formatEventEntryForLog(entry);
        const errorText = this._formatEventErrorForLog(error);
        console.error(`tracker_updates: skipped entry after per-entry failure: ${entryText}: ${errorText}`);
    }

    static _resolveTrackerUpdateTarget(rawQuery) {
        const query = normalizeString(rawQuery);
        if (!query) {
            throw new Error("tracker update target is required.");
        }

        const exactMatch = Tracker.getById(query);
        if (exactMatch) {
            return exactMatch;
        }

        const matches = Tracker.findByNameOrKey(query);
        if (!matches.length) {
            throw new Error(`No tracker matches "${query}".`);
        }
        if (matches.length > 1) {
            const candidates = matches
                .map((tracker) => `${tracker.id} (${tracker.name})`)
                .join(", ");
            throw new Error(`Multiple trackers match "${query}": ${candidates}.`);
        }
        return matches[0];
    }

    static _getTrackerUpdateWorldMinute() {
        const worldMinute = Globals.getTotalWorldMinutes();
        if (!Number.isInteger(worldMinute) || worldMinute < 0) {
            throw new Error("tracker update world minute must be a non-negative integer.");
        }
        return worldMinute;
    }

    static _mapXmlEventNodeToLegacyRaw(node) {
        const tagName = node?.tagName;
        switch (tagName) {
            case "newExitDiscovered": {
                const destinationNode = this._getXmlDirectChildNode(node, "destination");
                const originNode = this._getXmlDirectChildNode(node, "origin");
                const destinationType = this._getXmlDirectChildText(node, "destinationType");
                const normalizedType = destinationType.trim().toLowerCase();
                const destinationHasNewExits = this._getXmlDirectChildText(node, "destinationHasNewExits");
                const normalizedHasNewExits = destinationHasNewExits.trim().toLowerCase();
                const effectiveDestinationType =
                    normalizedType === "region" || normalizedHasNewExits === "true"
                        ? "region"
                        : destinationType;
                const effectiveNormalizedType = effectiveDestinationType.trim().toLowerCase();
                const legacyDestinationName =
                    this._getXmlDirectChildText(node, "destinationName");
                let destinationLocationName =
                    this._getXmlDirectChildText(destinationNode, "locationName")
                    || this._getXmlDirectChildText(node, "destinationLocationName");
                let destinationRegionName =
                    this._getXmlDirectChildText(destinationNode, "regionName")
                    || this._getXmlDirectChildText(node, "destinationRegionName");
                if (normalizedType === "location" && normalizedHasNewExits === "true") {
                    const promotedRegionName =
                        destinationLocationName || legacyDestinationName || destinationRegionName;
                    destinationRegionName = promotedRegionName;
                    destinationLocationName = "";
                }
                const destinationName = effectiveNormalizedType === "region"
                    ? destinationRegionName || legacyDestinationName || destinationLocationName
                    : destinationLocationName || legacyDestinationName || destinationRegionName;
                const exitLocationName =
                    this._getXmlDirectChildText(originNode, "locationName")
                    || this._getXmlDirectChildText(node, "originLocationName");
                const exitRegionName =
                    this._getXmlDirectChildText(originNode, "regionName")
                    || this._getXmlDirectChildText(node, "originRegionName");
                return {
                    key: "new_exit_discovered",
                    raw: [
                        destinationName || "none",
                        effectiveDestinationType || "none",
                        this._getXmlDirectChildText(node, "vehicleType") || "none",
                        this._getXmlDirectChildText(node, "description") || "none",
                        this._getXmlDirectChildText(node, "travelTime") || "none",
                        exitLocationName || "none",
                        exitRegionName || "none",
                        destinationRegionName || "none",
                        destinationLocationName || "none",
                    ].join(" → "),
                };
            }
            case "moveLocation": {
                const destination = this._getXmlDirectChildText(node, "destinationName")
                    || (this._getXmlElementChildren(node).length ? "" : normalizeString(node.textContent));
                return { key: "move_location", raw: destination };
            }
            case "moveNewLocation":
                return {
                    key: "move_new_location",
                    raw: this._formatXmlLegacyRawEntry(node, [
                        "originDifference",
                        "destinationName",
                        "destinationKind",
                        ["vehicleType", "none"],
                        "description",
                    ]),
                };
            case "alterLocation":
                return {
                    key: "alter_location",
                    raw: this._formatXmlLegacyRawEntry(node, [
                        "currentLocationName",
                        "newLocationName",
                        "changeDescription",
                    ]),
                };
            case "currency":
                return {
                    key: "currency",
                    raw: this._getXmlDirectChildText(node, "amount"),
                };
            case "itemAppear":
                return {
                    key: "item_appear",
                    raw: this._formatXmlLegacyRawEntry(node, [
                        "fullItemName",
                        "quantity",
                        "description",
                    ]),
                };
            case "sceneryAppear":
                return {
                    key: "scenery_appear",
                    raw: this._formatXmlLegacyRawEntry(node, [
                        "sceneryName",
                        "description",
                    ]),
                };
            case "harvestableResourceAppear":
                return {
                    key: "harvestable_resource_appear",
                    raw: this._formatXmlLegacyRawEntry(node, [
                        "resourceName",
                        "description",
                    ]),
                };
            case "pickUpItem":
                return {
                    key: "pick_up_item",
                    raw: this._formatXmlLegacyRawEntry(node, [
                        "actorName",
                        "fullItemName",
                        "quantity",
                    ]),
                };
            case "putItemInContainer":
                return {
                    key: "put_item_in_container",
                    raw: this._formatXmlLegacyRawEntry(node, [
                        "character",
                        "fullItemName",
                        "quantity",
                        "containerName",
                    ]),
                };
            case "removeItemFromContainer":
                return {
                    key: "remove_item_from_container",
                    raw: this._formatXmlLegacyRawEntry(node, [
                        "character",
                        "fullItemName",
                        "quantity",
                        "containerName",
                    ]),
                };
            case "dropItem":
                return {
                    key: "drop_item",
                    raw: this._formatXmlLegacyRawEntry(node, [
                        "actorName",
                        "fullItemName",
                        "quantity",
                    ]),
                };
            case "transferItem":
                return {
                    key: "transfer_item",
                    raw: this._formatXmlLegacyRawEntry(node, [
                        "giverName",
                        "fullItemName",
                        "quantity",
                        "receiverName",
                    ]),
                };
            case "consumeItem":
                return {
                    key: "consume_item",
                    raw: this._formatXmlLegacyRawEntry(node, [
                        "fullItemName",
                        "quantity",
                        "reason",
                    ]),
                };
            case "alterItem":
                return {
                    key: "alter_item",
                    raw: this._formatXmlLegacyRawEntry(node, [
                        "originalItemName",
                        "quantity",
                        "newItemName",
                        "changeDescription",
                    ]),
                };
            case "harvestGather":
                return {
                    key: "harvest_gather",
                    raw: this._formatXmlLegacyRawEntry(node, [
                        "harvesterName",
                        "fullItemName",
                        "quantity",
                        "sourceName",
                    ]),
                };
            case "itemInflict":
                return {
                    key: "item_inflict",
                    raw: this._formatXmlLegacyRawEntry(node, [
                        "fullItemName",
                        "targetName",
                        "statusEffect",
                    ]),
                };
            case "itemIngest":
                return {
                    key: "item_ingest",
                    raw: this._formatXmlLegacyRawEntry(node, [
                        "fullItemName",
                        "consumerName",
                    ]),
                };
            case "itemToNpc":
                return {
                    key: "item_to_npc",
                    raw: this._formatXmlLegacyRawEntry(node, [
                        "sourceThingName",
                        "npcName",
                        "description",
                    ]),
                };
            case "attackDamage":
                return {
                    key: "attack_damage",
                    raw: this._formatXmlLegacyRawEntry(node, [
                        "attackerName",
                        "targetName",
                    ]),
                };
            case "alterNpc":
                return {
                    key: "alter_npc",
                    raw: this._formatXmlLegacyRawEntry(node, [
                        "npcName",
                        "alterationCategory",
                        "changeDescription",
                    ]),
                };
            case "statusEffectChange": {
                const parts = [
                    this._getXmlDirectChildText(node, "entityName"),
                    this._getXmlDirectChildText(node, "statusEffectName"),
                    this._getXmlDirectChildText(node, "action"),
                ];
                const level = this._getXmlDirectChildText(node, "level");
                if (level) {
                    parts.push(level);
                }
                return { key: "status_effect_change", raw: parts.join(" → ") };
            }
            case "revealHiddenNpc":
            case "revealHiddenNPC": {
                const parts = [
                    this._getXmlDirectChildText(node, "npcName"),
                    this._getXmlDirectChildText(node, "description"),
                ];
                const useOpposedCheck = this._getXmlDirectChildText(node, "useOpposedCheck");
                if (useOpposedCheck) {
                    parts.push(useOpposedCheck);
                }
                return { key: "reveal_hidden_npc", raw: parts.join(" → ") };
            }
            case "hideVisibleNpc":
            case "hideVisibleNPC":
                return {
                    key: "hide_visible_npc",
                    raw: this._formatXmlLegacyRawEntry(node, [
                        "npcName",
                        "description",
                    ]),
                };
            case "npcArrivalDeparture": {
                const parts = [
                    this._getXmlDirectChildText(node, "npcName"),
                    this._getXmlDirectChildText(node, "action"),
                ];
                const destinationRegion = this._getXmlDirectChildText(
                    node,
                    "destinationRegion",
                );
                const destinationLocation = this._getXmlDirectChildText(
                    node,
                    "destinationLocation",
                );
                if (destinationRegion || destinationLocation) {
                    parts.push(destinationRegion, destinationLocation);
                }
                const hideFromPlayer = this._getXmlDirectChildText(node, "hideFromPlayer");
                if (hideFromPlayer) {
                    parts.push(hideFromPlayer);
                }
                return { key: "npc_arrival_departure", raw: parts.join(" → ") };
            }
            case "npcArrival": {
                const npcName = this._getXmlDirectChildText(node, "npcName");
                const hideFromPlayer = this._getXmlDirectChildText(node, "hideFromPlayer");
                return {
                    key: "npc_arrival_departure",
                    raw: hideFromPlayer ? `${npcName} → arrived → ${hideFromPlayer}` : `${npcName} → arrived`,
                };
            }
            case "npcDeparture": {
                const parts = [
                    this._getXmlDirectChildText(node, "npcName"),
                    "left",
                    this._getXmlDirectChildText(node, "destinationRegion"),
                    this._getXmlDirectChildText(node, "destinationLocation"),
                ];
                const hideFromPlayer = this._getXmlDirectChildText(node, "hideFromPlayer");
                if (hideFromPlayer) {
                    parts.push(hideFromPlayer);
                }
                return { key: "npc_arrival_departure", raw: parts.join(" → ") };
            }
            case "thingArrival": {
                const thingName = this._getXmlDirectChildText(node, "thingName");
                return {
                    key: "thing_arrival_departure",
                    raw: `${thingName} → arrived`,
                };
            }
            case "thingDeparture": {
                const parts = [
                    this._getXmlDirectChildText(node, "thingName"),
                    "left",
                    this._getXmlDirectChildText(node, "destinationRegion"),
                    this._getXmlDirectChildText(node, "destinationLocation"),
                ];
                return { key: "thing_arrival_departure", raw: parts.join(" → ") };
            }
            case "thingMoveWithCharacter":
                return {
                    key: "thing_move_with_character",
                    raw: this._formatXmlLegacyRawEntry(node, [
                        "thingName",
                        "characterName",
                    ]),
                };
            case "npcFirstAppearance":
                return {
                    key: "npc_first_appearance",
                    raw: this._getXmlDirectChildText(node, "npcName"),
                };
            case "mysteryBoxMention":
                return {
                    key: "mystery_box_mention",
                    raw: this._formatXmlLegacyRawEntry(node, ["name", "context"]),
                };
            case "partyChange":
                return {
                    key: "party_change",
                    raw: this._formatXmlLegacyRawEntry(node, ["npcName", "action"]),
                };
            case "tradeAvailability":
                return {
                    key: "trade_availability",
                    raw: this._formatXmlLegacyRawEntry(node, [
                        "npcName",
                        "willingToTrade",
                        "reason",
                    ]),
                };
            case "environmentalStatusDamage":
                return {
                    key: "environmental_status_damage",
                    raw: this._formatXmlLegacyRawEntry(node, [
                        "actorName",
                        "effect",
                        "severity",
                        "reason",
                    ]),
                };
            case "healRecover":
                return {
                    key: "heal_recover",
                    raw: this._formatXmlLegacyRawEntry(node, [
                        "characterName",
                        "magnitude",
                        "reason",
                    ]),
                };
            case "hostileToFriendly":
                return {
                    key: "hostile_to_friendly",
                    raw: this._formatXmlLegacyRawEntry(node, [
                        "npcName",
                        "previousDisposition",
                        "newDisposition",
                        "reason",
                    ]),
                };
            case "deathIncapacitation":
                return {
                    key: "death_incapacitation",
                    raw: this._formatXmlLegacyRawEntry(node, [
                        "actorName",
                        "outcome",
                    ]),
                };
            case "inCombat":
                return {
                    key: "in_combat",
                    raw: this._getXmlDirectChildText(node, "value"),
                };
            case "anyQuestObjectivesCompleted":
                return {
                    key: "any_quest_objectives_completed",
                    raw: this._getXmlDirectChildText(node, "value"),
                };
            case "receivedQuest": {
                const giverName = this._getXmlDirectChildText(node, "giverName");
                const summary = this._getXmlDirectChildText(node, "summary");
                return {
                    key: "received_quest",
                    raw: giverName ? `${giverName} → ${summary}` : summary,
                };
            }
            case "completedQuestObjective": {
                const parts = [
                    this._getXmlDirectChildText(node, "questIndex"),
                    this._getXmlDirectChildText(node, "objectiveIndex"),
                ];
                const statusReason = this._getXmlDirectChildText(
                    node,
                    "statusReason",
                );
                if (statusReason) {
                    parts.push(statusReason);
                }
                return {
                    key: "completed_quest_objective",
                    raw: parts.join(" → "),
                };
            }
            case "defeatedEnemy":
                return {
                    key: "defeated_enemy",
                    raw: this._getXmlDirectChildText(node, "enemyName"),
                };
            case "experienceCheck":
                return {
                    key: "experience_check",
                    raw: this._formatXmlLegacyRawEntry(node, ["amount", "reason"]),
                };
            case "factionReputationChange": {
                const factionName = this._getXmlDirectChildText(node, "factionName");
                const direction = this._getXmlDirectChildText(node, "direction");
                const magnitude = this._getXmlDirectChildText(node, "magnitude");
                const reason = this._getXmlDirectChildText(node, "reason");
                return {
                    key: "faction_reputation_change",
                    raw: `${factionName} → ${direction}d ${magnitude} → ${reason}`,
                };
            }
            case "dispositionCheck":
                return {
                    key: "disposition_check",
                    raw: this._formatXmlLegacyRawEntry(node, [
                        "npcName",
                        "before",
                        "after",
                        "reason",
                    ]),
                };
            case "needBarChange":
                return {
                    key: "needbar_change",
                    raw: this._formatXmlLegacyRawEntry(node, [
                        "characterName",
                        "needBarId",
                        "direction",
                        "magnitude",
                        "reason",
                    ]),
                };
            case "timePassed":
                return {
                    key: "time_passed",
                    raw: this._formatXmlLegacyRawEntry(node, [
                        "reasoning",
                        "duration",
                    ]),
                };
            case "trackerUpdates": {
                const entries = [];
                for (const child of this._getXmlElementChildren(node)) {
                    if (child.tagName !== "trackerUpdate") {
                        this._logTrackerUpdateEntryError(
                            child?.tagName || child,
                            new Error("<trackerUpdates> may only contain <trackerUpdate> entries."),
                        );
                        continue;
                    }
                    try {
                        entries.push(this._formatXmlTrackerUpdateRawEntry(child));
                    } catch (error) {
                        this._logTrackerUpdateEntryError(
                            this._formatRegisteredXmlEventRaw(child),
                            error,
                        );
                    }
                }
                return {
                    key: "tracker_updates",
                    raw: entries.join(" | "),
                };
            }
            case "triggeredAbility":
                return {
                    key: "triggered_abilities",
                    raw: this._formatXmlLegacyRawEntry(node, [
                        "characterName",
                        "abilityName",
                    ]),
                };
            default:
                {
                    const registry = Globals.modExtensionRegistry || this._deps?.modExtensionRegistry || null;
                    const registeredEvent = registry && typeof registry.getXmlEventByTagName === "function"
                        ? registry.getXmlEventByTagName(tagName)
                        : null;
                    if (registeredEvent) {
                        return {
                            key: registeredEvent.eventKey,
                            raw: this._formatRegisteredXmlEventRaw(node),
                        };
                    }
                }
                throw new Error(`Unknown event XML tag <${tagName}>.`);
        }
    }

    static _appendXmlRawEvent(rawEventLists, key, raw) {
        if (!key) {
            throw new Error("Cannot append XML event without a legacy event key.");
        }
        const normalizedRaw =
            typeof raw === "string" ? raw.trim() : String(raw ?? "").trim();
        if (!normalizedRaw || NO_EVENT_TOKENS.has(normalizedRaw.toLowerCase())) {
            return;
        }
        if (!Array.isArray(rawEventLists[key])) {
            rawEventLists[key] = [];
        }
        rawEventLists[key].push(normalizedRaw);
    }

    static _buildStructuredEventsFromRawLists(rawEventLists = {}, options = {}) {
        const { trackItems = true } = options || {};
        const rawEntries = {};
        const parsedEntries = {};
        const builtParsers =
            this._parsers && Object.keys(this._parsers).length
                ? this._parsers
                : this._buildParsers();
        const registry = Globals.modExtensionRegistry || this._deps?.modExtensionRegistry || null;
        const modParsers = registry && typeof registry.getXmlEventParsers === "function"
            ? registry.getXmlEventParsers()
            : {};
        const parsers = {
            ...builtParsers,
            ...modParsers,
        };
        const aggregators =
            this._aggregators && Object.keys(this._aggregators).length
                ? this._aggregators
                : this._buildAggregators();

        for (const [key, segments] of Object.entries(rawEventLists || {})) {
            const normalizedSegments = ensureArray(segments)
                .map((segment) =>
                    typeof segment === "string" ? segment.trim() : String(segment ?? "").trim(),
                )
                .filter(
                    (segment) =>
                        segment.length > 0 && !NO_EVENT_TOKENS.has(segment.toLowerCase()),
                );
            if (!normalizedSegments.length) {
                continue;
            }

            rawEntries[key] = normalizedSegments.join(" | ");
            const parser = parsers[key];
            const parsedSegments = normalizedSegments.map((segment) =>
                typeof parser === "function" ? parser(segment) : segment,
            );
            const aggregator =
                aggregators[key] || ((items) => flattenAndFilter(items));
            const combined = aggregator(parsedSegments);
            if (
                Array.isArray(combined) &&
                combined.length === 0 &&
                !Object.prototype.hasOwnProperty.call(rawEventLists, key)
            ) {
                continue;
            }
            parsedEntries[key] = combined;
        }

        const itemAndSceneryNames = this.extractItemAndSceneryNames(rawEntries);
        if (itemAndSceneryNames instanceof SanitizedStringSet) {
            const filterOutItems = (entries, pickName) => {
                if (!Array.isArray(entries)) {
                    return entries;
                }
                return entries.filter((entry) => {
                    const candidate = pickName(entry);
                    return !itemAndSceneryNames.has(candidate);
                });
            };

            parsedEntries.new_exit_discovered = filterOutItems(
                parsedEntries.new_exit_discovered,
                (entry) => entry?.name,
            );
            parsedEntries.move_new_location = filterOutItems(
                parsedEntries.move_new_location,
                (entry) => entry?.name,
            );
            parsedEntries.move_location = filterOutItems(
                parsedEntries.move_location,
                (entry) => entry,
            );
        }

        const newExitEntries = Array.isArray(parsedEntries.new_exit_discovered)
            ? parsedEntries.new_exit_discovered
            : [];
        const moveLocationEntries = Array.isArray(parsedEntries.move_location)
            ? parsedEntries.move_location
            : [];
        if (newExitEntries.length === 0 && moveLocationEntries.length === 0) {
            const firstAppearance = Array.isArray(parsedEntries.npc_first_appearance)
                ? parsedEntries.npc_first_appearance
                : [];
            if (firstAppearance.length) {
                const arrivals = firstAppearance
                    .map((name) => normalizeString(name))
                    .filter((name) => name.length > 0)
                    .map((name) => ({
                        name,
                        action: "arrived",
                        destination: null,
                        firstAppearance: true,
                    }));

                if (!Array.isArray(parsedEntries.npc_arrival_departure)) {
                    parsedEntries.npc_arrival_departure = [];
                }

                const existingNames =
                    typeof Globals.location?.getNPCNames === "function"
                        ? Globals.location.getNPCNames()
                        : [];
                const uniqueArrivals = arrivals.filter(
                    (entry) => !existingNames.includes(entry.name),
                );

                parsedEntries.npc_arrival_departure.push(...uniqueArrivals);
            }
        }

        if (trackItems) {
            this._trackItemsFromParsing(parsedEntries);
            this._pruneExcludedItemEntries(parsedEntries);
        }

        return { rawEntries, parsed: parsedEntries };
    }

    static _mergeStructuredEventSets(...structuredSets) {
        const rawEventLists = {};
        for (const structured of structuredSets) {
            const rawEntries = structured?.rawEntries;
            if (!rawEntries || typeof rawEntries !== "object") {
                continue;
            }
            for (const [key, raw] of Object.entries(rawEntries)) {
                if (typeof raw !== "string" || !raw.trim()) {
                    continue;
                }
                if (!Array.isArray(rawEventLists[key])) {
                    rawEventLists[key] = [];
                }
                rawEventLists[key].push(...splitPipeList(raw));
            }
        }
        return this._buildStructuredEventsFromRawLists(rawEventLists, {
            trackItems: false,
        });
    }

    static _resolveStructuredTravelMoveDestinationLocation(structuredEvents) {
        const parsed = structuredEvents?.parsed;
        if (!parsed || typeof parsed !== "object") {
            return null;
        }

        let destinationName = "";
        if (Array.isArray(parsed.move_location) && parsed.move_location.length) {
            const lastMove = parsed.move_location[parsed.move_location.length - 1];
            destinationName = typeof lastMove === "string" ? lastMove.trim() : "";
        }
        if (
            !destinationName &&
            Array.isArray(parsed.move_new_location) &&
            parsed.move_new_location.length
        ) {
            const lastMove =
                parsed.move_new_location[parsed.move_new_location.length - 1];
            destinationName =
                typeof lastMove?.name === "string" ? lastMove.name.trim() : "";
        }
        if (!destinationName) {
            return null;
        }

        return resolveEventLocationByName({
            Location: this._deps.Location,
            gameLocations: this._deps.gameLocations,
            findLocationByNameLoose: this._deps.findLocationByNameLoose,
        }, destinationName);
    }

    static async _withTemporaryPlayerLocation(player, location, callback) {
        if (!player || typeof callback !== "function") {
            throw new Error(
                "Temporary player-location scope requires a player and callback.",
            );
        }
        if (!location || typeof location.id !== "string" || !location.id.trim()) {
            throw new Error(
                "Temporary player-location scope requires a destination location.",
            );
        }
        if (typeof player.setLocation !== "function") {
            throw new Error(
                "Temporary player-location scope requires player.setLocation.",
            );
        }

        const destinationId = location.id.trim();
        const originalLocationId =
            typeof player.currentLocation === "string" &&
                player.currentLocation.trim()
                ? player.currentLocation.trim()
                : null;

        if (originalLocationId === destinationId) {
            return callback();
        }

        player.setLocation(location);
        if (player.currentLocation !== destinationId) {
            throw new Error(
                `Unable to set player location to travel arrival destination "${destinationId}".`,
            );
        }

        let callbackResult;
        let callbackError = null;
        try {
            callbackResult = await callback();
        } catch (error) {
            callbackError = error;
        }

        if (originalLocationId) {
            player.setLocation(originalLocationId);
            if (player.currentLocation !== originalLocationId) {
                throw new Error(
                    `Unable to restore player location to "${originalLocationId}" after travel arrival events.`,
                );
            }
        } else {
            player.setLocation(null);
            if (
                player.currentLocation !== null &&
                player.currentLocation !== undefined
            ) {
                throw new Error(
                    "Unable to restore player location to empty state after travel arrival events.",
                );
            }
        }

        if (callbackError) {
            throw callbackError;
        }
        return callbackResult;
    }

    static _parseXmlEventCheckResponse(responseText, options = {}) {
        const ignoredEventKeys = this._normalizeIgnoredEventKeys(
            options?.ignoredEventKeys || [],
        );
        const xml = this._extractEventsXmlBlock(responseText);
        let doc;
        try {
            doc = Utils.parseXmlDocumentStrict(xml, "text/xml");
        } catch (error) {
            throw new Error(`Failed to parse event XML response: ${error.message}`);
        }

        const root = doc?.documentElement;
        if (!root || root.tagName !== "events") {
            throw new Error("Event XML response did not parse into an <events> document.");
        }

        const beforeRawLists = {};
        const travelMoveRawLists = {};
        const afterRawLists = {};
        const ignoredDuringEvents = [];
        let phase = "before";
        let hasTravelBoundary = false;
        let hasArrived = false;

        for (const child of this._getXmlElementChildren(root)) {
            const tagName = child.tagName;
            if (tagName === "arriveAtLocation") {
                if (!hasTravelBoundary) {
                    throw new Error(
                        "Event XML contains <arriveAtLocation/> without a preceding move boundary.",
                    );
                }
                if (hasArrived) {
                    throw new Error(
                        "Event XML contains multiple travel arrival markers.",
                    );
                }
                hasArrived = true;
                phase = "after";
                continue;
            }

            const isMoveBoundary =
                tagName === "moveLocation" || tagName === "moveNewLocation";
            if (isMoveBoundary) {
                if (hasTravelBoundary) {
                    throw new Error(
                        "Event XML contains multiple travel boundaries in one <events> block.",
                    );
                }
                if (hasArrived) {
                    throw new Error(
                        "Event XML contains multiple travel boundaries in one <events> block.",
                    );
                }
                hasTravelBoundary = true;
                phase = "during";
                const { key, raw } = this._mapXmlEventNodeToLegacyRaw(child);
                if (ignoredEventKeys.has(key)) {
                    ignoredDuringEvents.push({ tagName, key, raw, ignored: true });
                    continue;
                }
                this._appendXmlRawEvent(travelMoveRawLists, key, raw);
                continue;
            }

            const { key, raw } = this._mapXmlEventNodeToLegacyRaw(child);
            if (ignoredEventKeys.has(key)) {
                ignoredDuringEvents.push({ tagName, key, raw, ignored: true });
                continue;
            }
            if (phase === "before") {
                this._appendXmlRawEvent(beforeRawLists, key, raw);
            } else if (phase === "during") {
                if (key === "thing_move_with_character") {
                    this._appendXmlRawEvent(afterRawLists, key, raw);
                } else {
                    ignoredDuringEvents.push({ tagName, key, raw });
                }
            } else {
                this._appendXmlRawEvent(afterRawLists, key, raw);
            }
        }

        if (hasTravelBoundary && Array.isArray(beforeRawLists.thing_move_with_character)) {
            const moveWithCharacterRaw = beforeRawLists.thing_move_with_character;
            delete beforeRawLists.thing_move_with_character;
            afterRawLists.thing_move_with_character = [
                ...moveWithCharacterRaw,
                ...(Array.isArray(afterRawLists.thing_move_with_character)
                    ? afterRawLists.thing_move_with_character
                    : []),
            ];
        }

        if (hasTravelBoundary && !hasArrived) {
            throw new Error(
                "Event XML travel boundary requires <arriveAtLocation/>.",
            );
        }

        const beforeTravel = {
            rawEventLists: beforeRawLists,
            structured: this._buildStructuredEventsFromRawLists(beforeRawLists),
        };
        const travelMove = {
            rawEventLists: travelMoveRawLists,
            structured: this._buildStructuredEventsFromRawLists(travelMoveRawLists),
        };
        const afterTravel = {
            rawEventLists: afterRawLists,
            structured: this._buildStructuredEventsFromRawLists(afterRawLists),
        };
        const structured = this._mergeStructuredEventSets(
            beforeTravel.structured,
            travelMove.structured,
            afterTravel.structured,
        );

        return {
            xml,
            hasTravelBoundary,
            ignoredDuringEvents,
            beforeTravel,
            travelMove,
            afterTravel,
            structured,
        };
    }

    static _extractFinalEventBlock(responseText) {
        if (typeof responseText !== "string") {
            throw new Error("Event check response must be a string.");
        }
        const match = responseText.match(/<final>([\s\S]*?)<\/final>/i);
        if (!match || !match[1] || !match[1].trim()) {
            throw new Error("Event check response missing <final> block.");
        }
        return match[1].trim();
    }

    static _extractNumberedResponses(responseText) {
        const cleaned = this.cleanEventResponseText(responseText);
        const lines = cleaned.split(/\n/);
        const entries = new Map();
        let currentIndex = null;
        let buffer = [];

        const flush = () => {
            if (currentIndex === null) {
                buffer = [];
                return;
            }
            const combined = buffer.join(" ").trim();
            entries.set(currentIndex, combined);
            currentIndex = null;
            buffer = [];
        };

        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) {
                continue;
            }
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
        return entries;
    }

    static async applyEventOutcomes(parsedEvents, context = {}) {
        if (!parsedEvents || !parsedEvents.parsed) {
            return context;
        }

        if (!Array.isArray(context.followupQueue)) {
            context.followupQueue = [];
        }

        const config = this.config || {};
        const omitNpcGeneration = Boolean(config?.omit_npc_generation);
        const omitItemGeneration = Boolean(config?.omit_item_generation);

        const suppressedNpc = omitNpcGeneration
            ? new Set(["npc_arrival_departure", "alter_npc"])
            : null;
        const suppressedItems = omitItemGeneration
            ? new Set([
                "item_appear",
                "scenery_appear",
                "harvestable_resource_appear",
                "alter_item",
            ])
            : null;
        const suppressedMoves = context?.suppressMoveEvents
            ? new Set(["move_location", "move_new_location"])
            : null;

        if (!omitNpcGeneration) {
            await this._ensureNpcMentions(parsedEvents, context);
        }

        /* Keeping this here for reference in case we want to backtrack. */
        /*
            const executionOrder = [
                'new_exit_discovered',
                'alter_location',
                'currency',
                'item_to_npc',
                'consume_item',
                'alter_item',
                'transfer_item',
                'item_appear',
                'harvest_gather',
                'pick_up_item',
                'drop_item',
                'scenery_appear',
                'harvestable_resource_appear',
                'alter_npc',
                'status_effect_change',
                'npc_arrival_departure',
                'party_change',
                'environmental_status_damage',
                'heal_recover',
                'needbar_change',
                'attack_damage',
                'death_incapacitation',
                'defeated_enemy',
                'experience_check',
                'move_location'
            ];
            */

        // Get executionOrder from EVENT_PROMPT_ORDER to ensure consistency
        const executionOrder = EVENT_PROMPT_ORDER_FLAT.map((def) => def.key);

        const parsedMap = parsedEvents.parsed;

        const itemIngestPairKeys = new Set();
        if (Array.isArray(parsedMap.item_ingest)) {
            for (const entry of parsedMap.item_ingest) {
                const pairKey = buildItemActorPairKey(entry?.item, entry?.target);
                if (pairKey) {
                    itemIngestPairKeys.add(pairKey);
                }
            }
        }
        if (itemIngestPairKeys.size) {
            context.itemIngestPairKeys = itemIngestPairKeys;
            if (Array.isArray(parsedMap.item_inflict)) {
                parsedMap.item_inflict = parsedMap.item_inflict.filter((entry) => {
                    const pairKey = buildItemActorPairKey(entry?.item, entry?.target);
                    const shouldKeep = !pairKey || !itemIngestPairKeys.has(pairKey);
                    if (!shouldKeep) {
                        console.debug(
                            `[item_inflict] Ignoring "${entry?.item}" for "${entry?.target}" because item_ingest already covers that pair this turn.`,
                        );
                    }
                    return shouldKeep;
                });
            }
        }

        const seen = new Set();
        const orderedKeys = [];

        executionOrder.forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(parsedMap, key)) {
                orderedKeys.push(key);
                seen.add(key);
            }
        });

        Object.keys(parsedMap).forEach((key) => {
            if (!seen.has(key)) {
                orderedKeys.push(key);
            }
        });

        let processedKeys = new Set();
        for (const key of orderedKeys) {
            if (processedKeys.has(key)) {
                continue;
            }
            processedKeys.add(key);
            if (suppressedNpc?.has(key) || suppressedItems?.has(key) || suppressedMoves?.has(key)) {
                continue;
            }
            const registry = Globals.modExtensionRegistry || this._deps?.modExtensionRegistry || null;
            const modHandlers = registry && typeof registry.getXmlEventHandlers === "function"
                ? registry.getXmlEventHandlers()
                : {};
            const handler = this._handlers[key] || modHandlers[key];
            if (typeof handler !== "function") {
                continue;
            }
            const entries = parsedMap[key];
            try {
                await handler.call(
                    this,
                    entries,
                    context,
                    parsedEvents.rawEntries?.[key],
                );
            } catch (error) {
                console.warn(`Failed to apply ${key} events:`, error.message);
                // log error trace
                console.debug(error);
            }
        }

        return context;
    }

    static async _ensureNpcMentions(parsedEvents, context = {}) {
        const parsed = parsedEvents?.parsed;
        if (!parsed || typeof parsed !== "object") {
            return;
        }

        const { ensureNpcByName, findActorByName } = this._deps;
        if (
            typeof ensureNpcByName !== "function" ||
            typeof findActorByName !== "function"
        ) {
            throw new Error(
                "Event NPC ensuring requires ensureNpcByName and findActorByName dependencies.",
            );
        }

        const rawEntries = parsedEvents.rawEntries || {};
        const namesToEnsure = new Map();
        const playerAliases = new Set([
            "player",
            "the player",
            "you",
            "self",
            "your character",
        ]);

        const currentPlayerName =
            typeof this.currentPlayer?.name === "string"
                ? this.currentPlayer.name.trim()
                : "";
        if (currentPlayerName) {
            playerAliases.add(currentPlayerName.toLowerCase());
        }

        const registerName = (value) => {
            const trimmed = normalizeString(value);
            if (!trimmed) {
                return;
            }
            const key = trimmed.toLowerCase();
            if (playerAliases.has(key)) {
                return;
            }
            if (!namesToEnsure.has(key)) {
                namesToEnsure.set(key, trimmed);
            }
        };

        const registerFromArray = (entries, extractor) => {
            if (!Array.isArray(entries)) {
                return;
            }
            for (const entry of entries) {
                const names = extractor(entry);
                if (Array.isArray(names)) {
                    names.forEach(registerName);
                } else {
                    registerName(names);
                }
            }
        };

        const registerFromRaw = (raw, extractor) => {
            if (typeof raw !== "string" || !raw.trim()) {
                return;
            }
            splitPipeList(raw).forEach((entry) => {
                const names = extractor(entry);
                if (Array.isArray(names)) {
                    names.forEach(registerName);
                } else {
                    registerName(names);
                }
            });
        };

        registerFromArray(parsed.attack_damage, (entry) => [
            entry?.attacker,
            entry?.target,
        ]);
        registerFromArray(parsed.alter_npc, (entry) => entry?.name);
        registerFromArray(parsed.status_effect_change, (entry) => entry?.entity);
        registerFromArray(parsed.environmental_status_damage, (entry) => entry?.name);
        registerFromArray(parsed.needbar_change, (entry) => entry?.character);
        registerFromArray(parsed.disposition_check, (entry) => entry?.npcName);
        registerFromArray(parsed.heal_recover, (entry) => [
            entry?.character,
            entry?.healer,
            entry?.recipient,
        ]);
        registerFromArray(parsed.npc_arrival_departure, (entry) => {
            const action =
                typeof entry?.action === "string" ? entry.action.trim().toLowerCase() : "";
            if (action === "left") {
                return [];
            }
            return entry?.name;
        });
        registerFromArray(parsed.npc_first_appearance, (entry) => entry);
        registerFromArray(parsed.party_change, (entry) => entry?.name);
        registerFromArray(parsed.hostile_to_friendly, (entry) => entry?.name);
        registerFromArray(parsed.transfer_item, (entry) => [
            entry?.giver,
            entry?.receiver,
        ]);
        registerFromArray(parsed.item_inflict, (entry) => entry?.target);
        registerFromArray(parsed.item_ingest, (entry) => entry?.target);
        registerFromArray(parsed.harvest_gather, (entry) => entry?.harvester);
        registerFromArray(parsed.pick_up_item, (entry) => entry?.name);
        registerFromArray(parsed.put_item_in_container, (entry) => entry?.character);
        registerFromArray(parsed.remove_item_from_container, (entry) => entry?.character);
        registerFromArray(parsed.drop_item, (entry) => entry?.name);
        registerFromArray(parsed.received_quest, (entry) => entry?.giver);

        registerFromRaw(rawEntries.triggered_abilities, (entry) => {
            const [name] = splitArrowParts(entry, 2);
            return name ? name.trim() : "";
        });
        registerFromRaw(rawEntries.disposition_check, (entry) => {
            const [name] = splitArrowParts(entry, 4);
            return name ? name.trim() : "";
        });

        if (!namesToEnsure.size) {
            return;
        }

        const resolvedNameMap = new Map();

        for (const [key, originalName] of namesToEnsure.entries()) {
            const existing = findActorByName(originalName);
            if (existing) {
                const existingName =
                    typeof existing.name === "string" ? existing.name.trim() : "";
                if (existingName && existingName !== originalName) {
                    resolvedNameMap.set(key, existingName);
                }
                continue;
            }

            const ensuredNpc = await ensureNpcByName(originalName, context);
            if (!ensuredNpc || typeof ensuredNpc.name !== "string") {
                throw new Error(`Failed to ensure NPC "${originalName}".`);
            }

            const ensuredName = ensuredNpc.name.trim();
            if (!ensuredName) {
                throw new Error(`Ensured NPC "${originalName}" has no name.`);
            }

            if (ensuredName.toLowerCase() !== key) {
                resolvedNameMap.set(key, ensuredName);
            } else if (ensuredName !== originalName) {
                resolvedNameMap.set(key, ensuredName);
            }

            this.newCharacters.add(ensuredName);
            this.arrivedCharacters.add(ensuredName);
        }

        if (!resolvedNameMap.size) {
            return;
        }

        const resolveName = (value) => {
            const trimmed = normalizeString(value);
            if (!trimmed) {
                return value;
            }
            const key = trimmed.toLowerCase();
            return resolvedNameMap.get(key) || value;
        };

        const updateArrayEntries = (entries, updater) => {
            if (!Array.isArray(entries)) {
                return;
            }
            entries.forEach((entry) => {
                if (entry) {
                    updater(entry);
                }
            });
        };

        updateArrayEntries(parsed.attack_damage, (entry) => {
            entry.attacker = resolveName(entry.attacker);
            entry.target = resolveName(entry.target);
        });
        updateArrayEntries(parsed.alter_npc, (entry) => {
            entry.name = resolveName(entry.name);
        });
        updateArrayEntries(parsed.status_effect_change, (entry) => {
            entry.entity = resolveName(entry.entity);
        });
        updateArrayEntries(parsed.environmental_status_damage, (entry) => {
            entry.name = resolveName(entry.name);
        });
        updateArrayEntries(parsed.needbar_change, (entry) => {
            entry.character = resolveName(entry.character);
        });
        updateArrayEntries(parsed.disposition_check, (entry) => {
            entry.npcName = resolveName(entry.npcName);
        });
        updateArrayEntries(parsed.heal_recover, (entry) => {
            if (entry.character) {
                entry.character = resolveName(entry.character);
            }
            if (entry.healer) {
                entry.healer = resolveName(entry.healer);
            }
            if (entry.recipient) {
                entry.recipient = resolveName(entry.recipient);
            }
        });
        updateArrayEntries(parsed.npc_arrival_departure, (entry) => {
            entry.name = resolveName(entry.name);
        });
        if (Array.isArray(parsed.npc_first_appearance)) {
            parsed.npc_first_appearance = parsed.npc_first_appearance.map((name) =>
                resolveName(name),
            );
        }
        updateArrayEntries(parsed.party_change, (entry) => {
            entry.name = resolveName(entry.name);
        });
        updateArrayEntries(parsed.hostile_to_friendly, (entry) => {
            entry.name = resolveName(entry.name);
        });
        updateArrayEntries(parsed.transfer_item, (entry) => {
            if (entry.giver) {
                entry.giver = resolveName(entry.giver);
            }
            if (entry.receiver) {
                entry.receiver = resolveName(entry.receiver);
            }
        });
        updateArrayEntries(parsed.item_inflict, (entry) => {
            if (entry.target) {
                entry.target = resolveName(entry.target);
            }
        });
        updateArrayEntries(parsed.item_ingest, (entry) => {
            if (entry.target) {
                entry.target = resolveName(entry.target);
            }
        });
        updateArrayEntries(parsed.harvest_gather, (entry) => {
            entry.harvester = resolveName(entry.harvester);
            if (entry.source && typeof entry.source === "string") {
                entry.source = entry.source.trim();
            }
        });
        updateArrayEntries(parsed.pick_up_item, (entry) => {
            entry.name = resolveName(entry.name);
        });
        updateArrayEntries(parsed.put_item_in_container, (entry) => {
            if (entry.character) {
                entry.character = resolveName(entry.character);
            }
        });
        updateArrayEntries(parsed.remove_item_from_container, (entry) => {
            if (entry.character) {
                entry.character = resolveName(entry.character);
            }
        });
        updateArrayEntries(parsed.drop_item, (entry) => {
            entry.name = resolveName(entry.name);
        });
        updateArrayEntries(parsed.received_quest, (entry) => {
            entry.giver = resolveName(entry.giver);
        });
    }

    static _parseBooleanish(value, { defaultValue = null } = {}) {
        if (value === null || value === undefined) {
            return defaultValue;
        }
        if (typeof value === "boolean") {
            return value;
        }
        const normalized = String(value).trim().toLowerCase();
        if (!normalized) {
            return defaultValue;
        }
        if (["true", "yes", "y", "1", "on", "hidden"].includes(normalized)) {
            return true;
        }
        if (["false", "no", "n", "0", "off", "visible"].includes(normalized)) {
            return false;
        }
        return defaultValue;
    }

    static _normalizeHiddenNpcSkill(value) {
        const text = normalizeString(value);
        if (!text || text.toLowerCase() === "n/a" || text.toLowerCase() === "none") {
            return null;
        }
        return text;
    }

    static _getHidePerceptionSettings() {
        const setting = typeof this._deps.getActiveSettingSnapshot === "function"
            ? this._deps.getActiveSettingSnapshot()
            : null;
        const hidingAttribute = normalizeString(setting?.hidingAttribute);
        const perceptionAttribute = normalizeString(setting?.perceptionAttribute);
        if (!hidingAttribute || !perceptionAttribute) {
            throw new Error("Hidden NPC opposed checks require hidingAttribute and perceptionAttribute settings.");
        }
        return {
            hidingAttribute,
            hidingSkill: this._normalizeHiddenNpcSkill(setting?.hidingSkill),
            perceptionAttribute,
            perceptionSkill: this._normalizeHiddenNpcSkill(setting?.perceptionSkill),
        };
    }

    static _buildHiddenNpcOpposedPlausibility({
        actor,
        opponent,
        actorAttribute,
        actorSkill,
        opponentAttribute,
        opponentSkill,
        reason
    } = {}) {
        const actorName = normalizeString(actor?.name) || "Actor";
        const opponentName = normalizeString(opponent?.name) || "opponent";
        return {
            type: "Plausible",
            reason: normalizeString(reason) || `${actorName} makes an opposed check against ${opponentName}.`,
            skillCheck: {
                reason: normalizeString(reason) || `${actorName} makes an opposed check against ${opponentName}.`,
                skill: actorSkill || null,
                attribute: actorAttribute,
                difficulty: "Opposed",
                checkType: "opposed",
                circumstanceModifiers: [],
                opposedCheck: {
                    opponent: opponentName,
                    opponentSkill: opponentSkill || null,
                    opponentAttribute,
                },
            },
        };
    }

    static _runHiddenNpcOpposedCheck({
        actor,
        opponent,
        reason,
        actorAttribute,
        actorSkill,
        opponentAttribute,
        opponentSkill,
        context = {},
        action = "hidden_npc_check",
        automatic = false
    } = {}) {
        const resolveActionOutcome = this._deps.resolveActionOutcome;
        if (typeof resolveActionOutcome !== "function") {
            throw new Error("Hidden NPC opposed checks require resolveActionOutcome dependency.");
        }
        const plausibility = this._buildHiddenNpcOpposedPlausibility({
            actor,
            opponent,
            actorAttribute,
            actorSkill,
            opponentAttribute,
            opponentSkill,
            reason,
        });
        const resolution = resolveActionOutcome({ plausibility, player: actor });
        if (!resolution || typeof resolution !== "object") {
            throw new Error("Hidden NPC opposed check did not return an action resolution.");
        }
        if (!Array.isArray(context.hiddenNpcChecks)) {
            context.hiddenNpcChecks = [];
        }
        context.hiddenNpcChecks.push({
            action,
            automatic: Boolean(automatic),
            actorId: actor?.id || null,
            actorName: actor?.name || null,
            npcId: opponent?.isNPC ? opponent.id || null : actor?.id || null,
            npcName: opponent?.isNPC ? opponent.name || null : actor?.name || null,
            success: resolution.success === true,
            resolution,
        });
        return resolution;
    }

    static _consumeMatchingPreResolvedHiddenNpcCheck({
        context = {},
        actor,
        opponent,
        actorAttribute,
        actorSkill,
        opponentAttribute,
        opponentSkill,
    } = {}) {
        const candidates = Array.isArray(context.preResolvedHiddenNpcChecks)
            ? context.preResolvedHiddenNpcChecks
            : [];
        if (!candidates.length) {
            return null;
        }
        if (!(context.consumedPreResolvedHiddenNpcCheckIndexes instanceof Set)) {
            context.consumedPreResolvedHiddenNpcCheckIndexes = new Set();
        }

        const normalize = (value) => normalizeString(value).toLowerCase();
        const matchesActorReference = (candidateName, target) => {
            const normalizedCandidate = normalize(candidateName);
            if (!normalizedCandidate || !target) {
                return false;
            }
            if (normalizedCandidate === "player"
                || normalizedCandidate === "the player"
                || normalizedCandidate === "you") {
                return target?.isNPC !== true;
            }
            return normalizedCandidate === normalize(target.name)
                || (Array.isArray(target.aliases)
                    && target.aliases.some((alias) => normalize(alias) === normalizedCandidate));
        };
        const matchesConfiguredMechanic = ({
            actualAttribute,
            actualSkill,
            expectedAttribute,
            expectedSkill,
        }) => {
            const normalizedExpectedSkill = normalize(expectedSkill);
            const normalizedActualSkill = normalize(actualSkill);
            if (normalizedExpectedSkill) {
                return normalizedActualSkill === normalizedExpectedSkill;
            }
            return !normalizedActualSkill
                && Boolean(normalize(actualAttribute))
                && normalize(actualAttribute) === normalize(expectedAttribute);
        };

        for (let index = 0; index < candidates.length; index += 1) {
            if (context.consumedPreResolvedHiddenNpcCheckIndexes.has(index)) {
                continue;
            }
            const candidate = candidates[index];
            const resolution = candidate?.actionResolution;
            const opposed = resolution?.opponent;
            if (!resolution || typeof resolution !== "object"
                || !opposed || typeof opposed !== "object") {
                continue;
            }
            const toolName = normalize(candidate.toolName);
            if (toolName !== "resolveopposedskillcheck"
                && toolName !== "resolveopposedplausibilitycheck") {
                continue;
            }
            if (!matchesActorReference(candidate.actorName, actor)) {
                continue;
            }
            const opponentIdMatches = normalize(opposed.id)
                && normalize(opponent?.id)
                && normalize(opposed.id) === normalize(opponent.id);
            const opponentNameMatches = normalize(opposed.name) === normalize(opponent?.name)
                || (Array.isArray(opponent?.aliases)
                    && opponent.aliases.some((alias) => normalize(alias) === normalize(opposed.name)));
            if (!opponentIdMatches && !opponentNameMatches) {
                continue;
            }
            if (!matchesConfiguredMechanic({
                actualAttribute: resolution.attribute,
                actualSkill: resolution.skill,
                expectedAttribute: actorAttribute,
                expectedSkill: actorSkill,
            }) || !matchesConfiguredMechanic({
                actualAttribute: opposed.attribute,
                actualSkill: opposed.skill,
                expectedAttribute: opponentAttribute,
                expectedSkill: opponentSkill,
            })) {
                continue;
            }

            context.consumedPreResolvedHiddenNpcCheckIndexes.add(index);
            return resolution;
        }
        return null;
    }

    static _resolveHiddenNpcTarget(name) {
        const trimmed = normalizeString(name);
        if (!trimmed || typeof this._deps.findActorByName !== "function") {
            return null;
        }
        return this._deps.findActorByName(trimmed) || null;
    }

    static _buildParsers() {
        return {
            new_exit_discovered: (raw) =>
                splitPipeList(raw)
                    .map((entry) => {
                        const parts = splitArrowParts(entry);
                        if (parts.length < 4) {
                            return null;
                        }
                        const [name, kind, vehicle] = parts;
                        let descriptionParts = [];
                        let travelTimeText = "";
                        let exitLocationName = "";
                        let exitRegionName = "";
                        let destinationRegionName = "";
                        let destinationLocationName = "";
                        if (parts.length >= 9) {
                            descriptionParts = parts.slice(3, -5);
                            travelTimeText = parts[parts.length - 5];
                            exitLocationName = parts[parts.length - 4];
                            exitRegionName = parts[parts.length - 3];
                            destinationRegionName = parts[parts.length - 2];
                            destinationLocationName = parts[parts.length - 1];
                        } else if (parts.length >= 8) {
                            descriptionParts = parts.slice(3, -4);
                            travelTimeText = parts[parts.length - 4];
                            exitLocationName = parts[parts.length - 3];
                            exitRegionName = parts[parts.length - 2];
                            destinationRegionName = parts[parts.length - 1];
                        } else if (parts.length >= 5) {
                            descriptionParts = parts.slice(3, -1);
                            travelTimeText = parts[parts.length - 1];
                        } else {
                            descriptionParts = parts.slice(3);
                        }
                        const description = descriptionParts.join(" → ");
                        const normalizedKind = (kind || "").toLowerCase();
                        if (
                            !name ||
                            !description ||
                            (normalizedKind !== "location" && normalizedKind !== "region")
                        ) {
                            return null;
                        }
                        const vehicleType = normalizeString(vehicle);
                        let travelTimeMinutes = null;
                        const normalizedTravelTimeText =
                            normalizeOptionalEventLocationField(travelTimeText);
                        if (normalizedTravelTimeText) {
                            travelTimeMinutes = Utils.parseDurationToMinutes(normalizedTravelTimeText, {
                                fieldName: "new_exit_discovered travel time",
                            });
                        }
                        const result = {
                            name: name.trim(),
                            kind: normalizedKind,
                            vehicleType:
                                vehicleType && vehicleType.toLowerCase() !== "none"
                                    ? vehicleType
                                    : null,
                            description: description.trim(),
                            travelTimeMinutes,
                        };
                        const normalizedExitLocationName =
                            normalizeOptionalEventLocationField(exitLocationName);
                        const normalizedExitRegionName =
                            normalizeOptionalEventLocationField(exitRegionName);
                        const normalizedDestinationRegionName =
                            normalizeOptionalEventLocationField(destinationRegionName);
                        const normalizedDestinationLocationName =
                            normalizeOptionalEventLocationField(destinationLocationName);
                        if (normalizedExitLocationName) {
                            result.exitLocationName = normalizedExitLocationName;
                        }
                        if (normalizedExitRegionName) {
                            result.exitRegionName = normalizedExitRegionName;
                        }
                        if (normalizedDestinationRegionName) {
                            result.destinationRegionName = normalizedDestinationRegionName;
                        }
                        if (normalizedDestinationLocationName) {
                            result.destinationLocationName = normalizedDestinationLocationName;
                        }
                        return result;
                    })
                    .filter(Boolean),
            move_new_location: (raw) => {
                return splitPipeList(raw)
                    .map((entry) => {
                        if (typeof entry !== "string") {
                            return null;
                        }

                        const rawParts = splitArrowParts(entry);
                        if (!rawParts.length) {
                            return null;
                        }

                        let origin = null;
                        let parts = rawParts;
                        if (parts.length === 5) {
                            origin = parts.shift();
                        }

                        if (parts.length < 4) {
                            return null;
                        }

                        let [name, kind, vehicle, ...descriptionParts] = parts;
                        let normalizedKind = (kind || "").toLowerCase();

                        // Sublocations intentionally promote to full locations so they create new
                        // location stubs when move_new_location is applied (unless move events are
                        // suppressed for travel-prose splits).
                        if (normalizedKind === "sublocation") normalizedKind = "location";
                        if (
                            !name ||
                            !descriptionParts.length ||
                            (normalizedKind !== "location" && normalizedKind !== "region")
                        ) {
                            return null;
                        }

                        // if (normalizedKind === 'location') {
                        //     Events.movedLocations.add(name);
                        // }

                        const vehicleType = normalizeString(vehicle);
                        return {
                            origin: origin ? origin.trim() : null,
                            name: name.trim(),
                            kind: normalizedKind,
                            vehicleType:
                                vehicleType && vehicleType.toLowerCase() !== "none"
                                    ? vehicleType
                                    : null,
                            description: descriptionParts.join(" → ").trim(),
                        };
                    })
                    .filter(Boolean);
            },
            alter_location: (raw) => {
                if (Globals.processedMove) {
                    return [];
                }

                return splitPipeList(raw)
                    .map((entry) => {
                        const parts = splitArrowParts(entry, 3);
                        if (!parts.length) {
                            return null;
                        }

                        const currentName = parts[0] ? parts[0].trim() : "";
                        let newName = parts.length > 1 ? parts[1].trim() : "";
                        let description = parts.length > 2 ? parts[2].trim() : "";

                        if (!description && parts.length === 2) {
                            description = newName;
                            newName = currentName;
                        }

                        if (!currentName && !description) {
                            return null;
                        }

                        const normalizedCurrent = currentName || null;
                        const normalizedNew = newName || normalizedCurrent;

                        return {
                            currentName: normalizedCurrent,
                            newName: normalizedNew,
                            description: description ? description.trim() : null,
                        };
                    })
                    .filter((entry) => entry && entry.description);
            },
            currency: (raw) => {
                const amount = extractInteger(raw);
                return Number.isFinite(amount) ? amount : null;
            },
            time_passed: (raw) => {
                if (raw === null || raw === undefined) {
                    return null;
                }
                const text = typeof raw === "string" ? raw.trim() : String(raw).trim();
                if (!text || NO_EVENT_TOKENS.has(text.toLowerCase())) {
                    return null;
                }
                const durationText = stripBeforeLastArrow(text);
                if (!durationText || NO_EVENT_TOKENS.has(durationText.toLowerCase())) {
                    return null;
                }
                try {
                    return Utils.parseDurationToMinutes(durationText, {
                        fieldName: "time_passed",
                    });
                } catch (error) {
                    console.warn("Skipping invalid time_passed duration entry:", {
                        value: text,
                        durationText,
                        error: error?.message || error,
                    });
                    return null;
                }
            },
            tracker_updates: (raw) => {
                const parsed = [];
                for (const entry of splitPipeList(raw)) {
                    try {
                        parsed.push(this._parseTrackerUpdateRawEntry(entry));
                    } catch (error) {
                        this._logTrackerUpdateEntryError(entry, error);
                    }
                }
                return parsed;
            },
            in_combat: (raw) => {
                if (typeof raw !== "string") {
                    return null;
                }
                const normalized = raw.trim().toLowerCase();

                return normalized === "yes" || normalized === "true";
            },
            any_quest_objectives_completed: (raw) => {
                const normalized = typeof raw === "string"
                    ? raw.trim().toLowerCase()
                    : "";
                if (normalized === "true") {
                    return true;
                }
                if (normalized === "false") {
                    return false;
                }
                throw new Error(
                    "anyQuestObjectivesCompleted.value must be exactly true or false.",
                );
            },
            item_to_npc: (raw) =>
                splitPipeList(raw)
                    .map((entry) => {
                        const [item, npc, description] = splitArrowParts(entry, 3);
                        if (!npc) {
                            return null;
                        }
                        return {
                            item: item ? item.trim() : null,
                            npc: npc.trim(),
                            description: description ? description.trim() : null,
                        };
                    })
                    .filter(Boolean),
            consume_item: (raw) =>
                splitPipeList(raw)
                    .map((entry) => {
                        if (typeof entry !== "string") {
                            return null;
                        }
                        const [item, rawQuantity, reason] = splitArrowParts(entry.trim(), 3);
                        if (!item) {
                            return null;
                        }
                        const record = {
                            item: item.trim(),
                            quantity: parseRequiredEventQuantity(rawQuantity, {
                                eventKey: "consume_item",
                                entryText: entry,
                            }),
                        };
                        if (reason) {
                            record.reason = reason.trim();
                        }
                        return record;
                    })
                    .filter(Boolean),
            item_inflict: (raw) =>
                splitPipeList(raw)
                    .map((entry) => {
                        const [item, target, status] = splitArrowParts(entry, 3);
                        if (!item || !target) {
                            return null;
                        }
                        return {
                            item: item.trim(),
                            target: target.trim(),
                            status: status ? status.trim() : null,
                        };
                    })
                    .filter(Boolean),
            item_ingest: (raw) =>
                splitPipeList(raw)
                    .map((entry) => {
                        const [item, target] = splitArrowParts(entry, 2);
                        if (!item || !target) {
                            return null;
                        }
                        return {
                            item: item.trim(),
                            target: target.trim(),
                        };
                    })
                    .filter(Boolean),
            alter_item: (raw) =>
                splitPipeList(raw)
                    .map((entry) => {
                        const parts = splitArrowParts(entry, 4);
                        if (!parts.length) {
                            return null;
                        }

                        const originalName = parts[0] ? parts[0].trim() : "";
                        const rawQuantity = parts.length > 1 ? parts[1] : "";
                        const quantity = parseRequiredEventQuantityOrAll(rawQuantity, {
                            eventKey: "alter_item",
                            entryText: entry,
                        });
                        let newNameInput = parts.length > 2 ? parts[2].trim() : "";
                        const description = parts.length > 3 ? parts[3].trim() : "";

                        if (newNameInput && newNameInput.toLowerCase() === "n/a") {
                            return null;
                        }

                        if (!originalName && !newNameInput) {
                            return null;
                        }

                        const normalized = {
                            originalName: originalName || null,
                            quantity,
                            newName: newNameInput || null,
                            changeDescription: description || null,
                        };

                        if (!normalized.newName && normalized.originalName) {
                            normalized.newName = normalized.originalName;
                        }

                        normalized.from = normalized.originalName;
                        normalized.to = normalized.newName;
                        normalized.description = normalized.changeDescription;

                        return normalized;
                    })
                    .filter(Boolean),
            transfer_item: (raw) =>
                splitPipeList(raw)
                    .map((entry) => {
                        const [giver, item, rawQuantity, receiver] = splitArrowParts(entry, 4);
                        if (!item) {
                            return null;
                        }
                        return {
                            giver: giver ? giver.trim() : null,
                            item: item.trim(),
                            quantity: parseRequiredEventQuantity(rawQuantity, {
                                eventKey: "transfer_item",
                                entryText: entry,
                            }),
                            receiver: receiver ? receiver.trim() : null,
                        };
                    })
                    .filter(Boolean),
            harvest_gather: (raw) =>
                splitPipeList(raw)
                    .map((entry) => {
                        const parts = splitArrowParts(entry);
                        if (parts.length < 3) {
                            return null;
                        }
                        const [name, item, rawQuantity] = parts;
                        const source = parts.length > 3 ? parts.slice(3).join(" → ") : null;
                        if (!name || !item || !rawQuantity) {
                            return null;
                        }
                        const normalizedSource =
                            typeof source === "string" && source.trim()
                                ? source.trim()
                                : null;
                        return {
                            harvester: name.trim(),
                            item: item.trim(),
                            quantity: parseRequiredEventQuantity(rawQuantity, {
                                eventKey: "harvest_gather",
                                entryText: entry,
                            }),
                            source: normalizedSource,
                        };
                    })
                    .filter(Boolean),
            pick_up_item: (raw) =>
                splitPipeList(raw)
                    .map((entry) => {
                        const [name, item, rawQuantity] = splitArrowParts(entry, 3);
                        if (!name || !item || !rawQuantity) {
                            return null;
                        }
                        return {
                            name: name.trim(),
                            item: item.trim(),
                            quantity: parseRequiredEventQuantity(rawQuantity, {
                                eventKey: "pick_up_item",
                                entryText: entry,
                            }),
                        };
                    })
                    .filter(Boolean),
            put_item_in_container: (raw) =>
                parseContainerItemMovementEvent(raw, {
                    eventKey: "put_item_in_container",
                }),
            remove_item_from_container: (raw) =>
                parseContainerItemMovementEvent(raw, {
                    eventKey: "remove_item_from_container",
                }),
            drop_item: (raw) =>
                splitPipeList(raw)
                    .map((entry) => {
                        const [name, item, rawQuantity] = splitArrowParts(entry, 3);
                        if (!name || !item || !rawQuantity) {
                            return null;
                        }
                        return {
                            name: name.trim(),
                            item: item.trim(),
                            quantity: parseRequiredEventQuantity(rawQuantity, {
                                eventKey: "drop_item",
                                entryText: entry,
                            }),
                        };
                    })
                    .filter(Boolean),
            item_appear: (raw) =>
                splitPipeList(raw)
                    .map((entry) => {
                        const [name, rawQuantity, description] = splitArrowParts(entry, 3);
                        if (!name || Events.alteredItems.has(name)) {
                            return null;
                        }
                        return {
                            name: name.trim(),
                            quantity: parseRequiredEventQuantity(rawQuantity, {
                                eventKey: "item_appear",
                                entryText: entry,
                            }),
                            description: description ? description.trim() : null,
                        };
                    })
                    .filter(Boolean),
            scenery_appear: (raw) =>
                splitPipeList(raw)
                    .map((entry) => {
                        const [name] = splitArrowParts(entry, 2);

                        // Remove any items that are in newItems
                        if (
                            !name ||
                            Events.newItems.has(name) ||
                            Events.alteredItems.has(name)
                        ) {
                            return null;
                        }
                        return name ? name.trim() : null;
                    })
                    .filter(Boolean),
            harvestable_resource_appear: (raw) =>
                splitPipeList(raw)
                    .map((entry) => {
                        const [name] = splitArrowParts(entry, 2);
                        return name ? name.trim() : null;
                    })
                    .filter(Boolean),
            alter_npc: (raw) =>
                splitPipeList(raw)
                    .map((entry) => {
                        const [name, type, description] = splitArrowParts(entry, 3);
                        if (!name) {
                            return null;
                        }

                        // remove all non-letter characters from type for comparison
                        const normalizedType = (type || "")
                            .toLowerCase()
                            .replace(/[^a-z]/g, "");

                        if (normalizedType.toLowerCase() !== "physicaltransformation") {
                            return null;
                        }

                        // Remove any where the name is "you", "your character", "player", "the player", or the player's name
                        const lowerName = name.trim().toLowerCase();
                        const playerName = (
                            Globals.currentPlayer?.name || ""
                        ).toLowerCase();
                        if (
                            [
                                "you",
                                "your character",
                                "player",
                                "the player",
                                playerName,
                            ].includes(lowerName)
                        ) {
                            return null;
                        }

                        return {
                            name: name.trim(),
                            description: description ? description.trim() : null,
                        };
                    })
                    .filter(Boolean),
            status_effect_change: (raw) =>
                splitPipeList(raw)
                    .map((entry) => {
                        const [entity, detail, action, levelRaw] = splitArrowParts(
                            entry,
                            4,
                        );
                        if (!entity || !detail || !action) {
                            return null;
                        }
                        let level = null;
                        if (levelRaw !== undefined && levelRaw !== null) {
                            const parsed = Number(levelRaw);
                            if (Number.isFinite(parsed)) {
                                level = parsed;
                            }
                        }
                        return {
                            entity: entity.trim(),
                            detail: detail.trim(),
                            action: action.trim().toLowerCase(),
                            level,
                        };
                    })
                    .filter(Boolean),
            reveal_hidden_npc: (raw) =>
                splitPipeList(raw)
                    .map((entry) => {
                        const parts = splitArrowParts(entry);
                        if (!parts.length) {
                            return null;
                        }
                        const name = parts[0]?.trim();
                        if (!name) {
                            return null;
                        }
                        let useOpposedCheck = true;
                        let descriptionParts = parts.slice(1);
                        if (descriptionParts.length > 0) {
                            const parsedBoolean = this._parseBooleanish(descriptionParts[descriptionParts.length - 1], { defaultValue: null });
                            if (parsedBoolean !== null) {
                                useOpposedCheck = parsedBoolean;
                                descriptionParts = descriptionParts.slice(0, -1);
                            }
                        }
                        return {
                            name,
                            description: descriptionParts.join(" → ").trim(),
                            useOpposedCheck,
                        };
                    })
                    .filter(Boolean),
            hide_visible_npc: (raw) =>
                splitPipeList(raw)
                    .map((entry) => {
                        const [name, description] = splitArrowParts(entry, 2);
                        if (!name) {
                            return null;
                        }
                        return {
                            name: name.trim(),
                            description: description ? description.trim() : "",
                        };
                    })
                    .filter(Boolean),
            npc_arrival_departure: (raw) =>
                splitPipeList(raw)
                    .map((entry) => {
                        const parts = splitArrowParts(entry);

                        if (parts.length < 2) {
                            return null;
                        }

                        const name = parts[0];
                        const action = parts[1]?.toLowerCase();
                        let remaining = parts.slice(2);

                        if (!name || !action) {
                            return null;
                        }

                        let hideFromPlayer = false;
                        if (remaining.length > 0) {
                            const parsedHide = this._parseBooleanish(remaining[remaining.length - 1], { defaultValue: null });
                            if (parsedHide !== null) {
                                hideFromPlayer = parsedHide;
                                remaining = remaining.slice(0, -1);
                            }
                        }

                        let destinationRegion = null;
                        let destinationLocation = null;

                        if (remaining.length === 1) {
                            destinationLocation = remaining[0];
                        } else if (remaining.length >= 2) {
                            destinationRegion = remaining[0] || null;
                            destinationLocation = remaining[1] || null;
                        }

                        const destination =
                            destinationLocation || destinationRegion || null;

                        const result = {
                            name,
                            action,
                            destination,
                            destinationRegion,
                            destinationLocation,
                        };
                        if (hideFromPlayer === true) {
                            result.hideFromPlayer = true;
                        }
                        return result;
                    })
                    .filter(Boolean),
            thing_arrival_departure: (raw) =>
                splitPipeList(raw)
                    .map((entry) => {
                        const parts = splitArrowParts(entry);

                        if (parts.length < 2) {
                            return null;
                        }

                        const name = parts[0];
                        const action = parts[1]?.toLowerCase();
                        const remaining = parts.slice(2);

                        if (!name || !action) {
                            return null;
                        }

                        let destinationRegion = null;
                        let destinationLocation = null;

                        if (remaining.length === 1) {
                            destinationLocation = remaining[0];
                        } else if (remaining.length >= 2) {
                            destinationRegion = remaining[0] || null;
                            destinationLocation = remaining[1] || null;
                        }

                        const destination =
                            destinationLocation || destinationRegion || null;

                        return {
                            name,
                            action,
                            destination,
                            destinationRegion,
                            destinationLocation,
                        };
                    })
                    .filter(Boolean),
            thing_move_with_character: (raw) =>
                splitPipeList(raw)
                    .map((entry) => {
                        const [thingName, characterName] = splitArrowParts(entry, 2);
                        if (!thingName || !characterName) {
                            return null;
                        }
                        return {
                            thingName: thingName.trim(),
                            characterName: characterName.trim(),
                        };
                    })
                    .filter(Boolean),
            npc_first_appearance: (raw) =>
                splitPipeList(raw)
                    .map((entry) => stripAfterFirstArrow(entry))
                    .filter(Boolean),
            mystery_box_mention: (raw) =>
                splitPipeList(raw)
                    .map((entry) => {
                        const [name, context] = splitArrowParts(entry, 2);
                        if (!name || !context) {
                            return null;
                        }
                        return {
                            name: name.trim(),
                            context: context.trim(),
                        };
                    })
                    .filter(Boolean),
            party_change: (raw) =>
                splitPipeList(raw)
                    .map((entry) => {
                        const [name, action] = splitArrowParts(entry, 2);
                        if (!name || !action) {
                            return null;
                        }
                        return { name: name.trim(), action: action.trim().toLowerCase() };
                    })
                    .filter(Boolean),
            trade_availability: (raw) =>
                splitPipeList(raw)
                    .map((entry) => {
                        const [name, willingRaw, reason] = splitArrowParts(entry, 3);
                        if (!name || !willingRaw) {
                            return null;
                        }
                        const normalized = willingRaw.trim().toLowerCase();
                        if (!["true", "false", "yes", "no"].includes(normalized)) {
                            return null;
                        }
                        return {
                            name: name.trim(),
                            willingToTrade: normalized === "true" || normalized === "yes",
                            reason: reason ? reason.trim() : "",
                        };
                    })
                    .filter(Boolean),
            environmental_status_damage: (raw) =>
                splitPipeList(raw)
                    .map((entry) => {
                        const parts = splitArrowParts(entry, 4);
                        if (!parts.length) {
                            return null;
                        }
                        if (parts.length === 4) {
                            const [name, effect, severity, reason] = parts;
                            return {
                                name: name.trim(),
                                effect: (effect || "damage").trim().toLowerCase(),
                                severity: (severity || "medium").trim().toLowerCase(),
                                reason: reason ? reason.trim() : "",
                            };
                        }
                        const [name, severity, reason] = parts;
                        if (!name) {
                            return null;
                        }
                        return {
                            name: name.trim(),
                            effect: "damage",
                            severity: (severity || "medium").trim().toLowerCase(),
                            reason: reason ? reason.trim() : "",
                        };
                    })
                    .filter(Boolean),
            heal_recover: (raw) =>
                splitPipeList(raw)
                    .map((entry) => {
                        const parts = splitArrowParts(entry, 3);
                        if (!parts.length) {
                            return null;
                        }
                        if (parts.length >= 3) {
                            return {
                                character: parts[0].trim(),
                                magnitude: parts[1].trim().toLowerCase(),
                                reason: parts[2] ? parts[2].trim() : null,
                            };
                        }
                        const [healer, recipient, effect] = parts;
                        return {
                            healer: healer ? healer.trim() : null,
                            recipient: recipient ? recipient.trim() : null,
                            effect: effect ? effect.trim() : null,
                        };
                    })
                    .filter(Boolean),
            needbar_change: (raw) =>
                splitPipeList(raw)
                    .map((entry) => {
                        const [name, bar, direction, magnitude, reason] = splitArrowParts(
                            entry,
                            5,
                        );
                        const magnitudeText =
                            typeof magnitude === "string" ? magnitude.trim() : "";
                        if (
                            !name ||
                            !bar ||
                            !direction ||
                            !magnitudeText ||
                            magnitudeText.toLowerCase() === "none"
                        ) {
                            return null;
                        }
                        return {
                            character: name.trim(),
                            bar: bar.trim(),
                            direction: direction.trim().toLowerCase(),
                            magnitude: magnitudeText.toLowerCase(),
                            reason: reason ? reason.trim() : null,
                        };
                    })
                    .filter(Boolean),
            hostile_to_friendly: (raw) =>
                splitPipeList(raw)
                    .map((entry) => {
                        const [name, previousDisposition, newDisposition, reason] =
                            splitArrowParts(entry, 4);
                        if (!name) {
                            return null;
                        }
                        return {
                            name: name.trim(),
                            previousDisposition: previousDisposition
                                ? previousDisposition.trim()
                                : null,
                            newDisposition: newDisposition ? newDisposition.trim() : null,
                            reason: reason ? reason.trim() : null,
                        };
                    })
                    .filter(Boolean),
            attack_damage: (raw) =>
                splitPipeList(raw)
                    .map((entry) => {
                        const [attacker, target] = splitArrowParts(entry, 2);
                        if (!attacker || !target) {
                            return null;
                        }
                        return { attacker: attacker.trim(), target: target.trim() };
                    })
                    .filter(Boolean),
            death_incapacitation: (raw) =>
                splitPipeList(raw)
                    .map((entry) => {
                        const [name, status] = splitArrowParts(entry, 2);
                        if (!name) {
                            return null;
                        }
                        return {
                            name: name.trim(),
                            status: status ? status.trim().toLowerCase() : "dead",
                        };
                    })
                    .filter(Boolean),
            defeated_enemy: (raw) =>
                splitPipeList(raw)
                    .map((entry) => entry.trim())
                    .filter(Boolean),
            experience_check: (raw) =>
                splitPipeList(raw)
                    .map((entry) => {
                        const [amount, reason] = splitArrowParts(entry, 2);
                        const value = extractInteger(amount);
                        if (!Number.isFinite(value)) {
                            return null;
                        }
                        return { amount: value, reason: reason ? reason.trim() : "" };
                    })
                    .filter(Boolean),
            disposition_check: (raw) =>
                splitPipeList(raw)
                    .map((entry) => {
                        const [npcName, before, after, reason] = splitArrowParts(
                            entry,
                            4,
                        );
                        if (!npcName || !before || !after) {
                            return null;
                        }
                        return {
                            npcName: npcName.trim(),
                            before: before.trim(),
                            after: after.trim(),
                            reason: reason ? reason.trim() : null,
                        };
                    })
                    .filter(Boolean),
            faction_reputation_change: (raw) =>
                splitPipeList(raw)
                    .map((entry) => {
                        const [rawFaction, rawDirectionMagnitude, reason] =
                            splitArrowParts(entry, 3);
                        if (!rawFaction || !rawDirectionMagnitude) {
                            return null;
                        }

                        const normalizedDirectionMagnitude = rawDirectionMagnitude
                            .trim()
                            .toLowerCase()
                            .replace(/\s+/g, " ");
                        let sign = 0;
                        if (
                            normalizedDirectionMagnitude.includes("increased") ||
                            normalizedDirectionMagnitude.includes("increase")
                        ) {
                            sign = 1;
                        } else if (
                            normalizedDirectionMagnitude.includes("decreased") ||
                            normalizedDirectionMagnitude.includes("decrease")
                        ) {
                            sign = -1;
                        }
                        if (sign === 0) {
                            return null;
                        }

                        let absoluteAmount = 0;
                        if (normalizedDirectionMagnitude.includes("a lot")) {
                            absoluteAmount = FACTION_REPUTATION_DELTA_LARGE;
                        } else if (
                            normalizedDirectionMagnitude.includes("a little")
                        ) {
                            absoluteAmount = FACTION_REPUTATION_DELTA_SMALL;
                        }
                        if (!absoluteAmount) {
                            return null;
                        }

                        const faction = resolveFactionByReference(rawFaction);
                        return {
                            factionId: faction?.id || null,
                            factionName:
                                faction?.name || normalizeString(rawFaction) || null,
                            amount: sign * absoluteAmount,
                            reason: reason ? reason.trim() : null,
                            rawFaction: rawFaction.trim(),
                            rawDirectionMagnitude: rawDirectionMagnitude.trim(),
                        };
                    })
                    .filter(Boolean),
            move_location: (raw) => {
                if (Globals.processedMove) {
                    return [];
                }
                return splitPipeList(raw)
                    .map((entry) => {
                        if (typeof entry !== "string") {
                            return null;
                        }
                        const parts = splitArrowParts(entry);
                        if (parts.length === 5) {
                            parts.shift();
                            return parts.join(" → ").trim();
                        }
                        return normalizeArrowDelimiters(entry);
                    })
                    .filter(Boolean);
            },
            received_quest: (raw) => {
                if (!Globals.config?.quests?.enabled) {
                    return [];
                }
                if (typeof raw !== "string") {
                    return [];
                }
                const normalized = raw.trim();
                if (!normalized) {
                    return [];
                }
                if (
                    /^n\/?a$/i.test(normalized) ||
                    normalized.toLowerCase() === "none"
                ) {
                    return [];
                }

                return splitPipeList(normalized)
                    .map((entry) => {
                        if (typeof entry !== "string") {
                            return null;
                        }
                        const parts = splitArrowParts(entry, 2)
                            .map((part) => part && part.trim())
                            .filter(Boolean);
                        if (!parts.length) {
                            return null;
                        }

                        let giver = parts[0] || "";
                        let summary = parts.length > 1 ? parts.slice(1).join(" → ") : "";

                        if (!summary && giver) {
                            summary = giver;
                            giver = "";
                        }

                        if (!summary) {
                            return null;
                        }

                        return {
                            giver: giver || "",
                            summary,
                        };
                    })
                    .filter(Boolean);
            },
            completed_quest_objective: (raw) => {
                if (typeof raw !== "string") {
                    return [];
                }
                return splitPipeList(raw)
                    .map((entry) => {
                        if (typeof entry !== "string") {
                            return null;
                        }
                        const [questIndexRaw, objectiveIndexRaw, statusReasonRaw] = splitArrowParts(
                            entry,
                            3,
                        );
                        if (!questIndexRaw || !objectiveIndexRaw) {
                            return null;
                        }
                        const questIndexValue = extractInteger(questIndexRaw);
                        const objectiveIndexValue = extractInteger(objectiveIndexRaw);
                        if (
                            !Number.isFinite(questIndexValue) ||
                            !Number.isFinite(objectiveIndexValue)
                        ) {
                            return null;
                        }
                        const record = {
                            questIndex: questIndexValue,
                            objectiveIndex: objectiveIndexValue,
                        };
                        const statusReason = normalizeString(statusReasonRaw);
                        if (statusReason) {
                            record.statusReason = statusReason;
                        }
                        return record;
                    })
                    .filter(Boolean);
            },
        };
    }

    static extractItemAndSceneryNames(rawEvents = {}) {
        const results = new SanitizedStringSet();

        if (!rawEvents || typeof rawEvents !== "object") {
            return results;
        }

        const parsers = this._buildParsers();
        const keys = [
            "harvest_gather",
            "pick_up_item",
            "put_item_in_container",
            "remove_item_from_container",
            "drop_item",
            "item_appear",
            "scenery_appear",
            "harvestable_resource_appear",
            "thing_arrival_departure",
            "thing_move_with_character",
        ];

        const addName = (name) => {
            results.add(name);
        };

        const normalizeInput = (parserFn, value) => {
            if (value === null || value === undefined) {
                return [];
            }
            if (Array.isArray(value)) {
                return value.flatMap((item) => normalizeInput(parserFn, item));
            }
            if (typeof value === "string") {
                try {
                    const parsed = parserFn(value);
                    return Array.isArray(parsed) ? parsed : [];
                } catch (error) {
                    console.debug("Failed to parse event entries", {
                        error: error?.message || error,
                        value,
                    });
                    return [];
                }
            }
            if (typeof value === "object") {
                return [value];
            }
            return [];
        };

        for (const key of keys) {
            const parserFn = typeof parsers[key] === "function" ? parsers[key] : null;
            if (!parserFn) {
                continue;
            }

            const rawValue = rawEvents[key];
            if (rawValue === undefined) {
                continue;
            }

            const parsedEntries = normalizeInput(parserFn, rawValue);
            if (!Array.isArray(parsedEntries) || !parsedEntries.length) {
                continue;
            }

            switch (key) {
                case "harvest_gather":
                case "pick_up_item":
                case "put_item_in_container":
                case "remove_item_from_container":
                case "drop_item":
                    parsedEntries.forEach((entry) => {
                        if (entry && typeof entry === "object") {
                            addName(entry.item);
                            addName(entry.containerName);
                        }
                    });
                    break;
                case "item_appear":
                    parsedEntries.forEach((entry) => {
                        if (entry && typeof entry === "object") {
                            addName(entry.name);
                        }
                    });
                    break;
                case "scenery_appear":
                case "harvestable_resource_appear":
                    parsedEntries.forEach(addName);
                    break;
                case "thing_arrival_departure":
                case "thing_move_with_character":
                    parsedEntries.forEach((entry) => {
                        if (entry && typeof entry === "object") {
                            addName(entry.name || entry.thingName);
                        }
                    });
                    break;
                default:
                    break;
            }
        }

        return results;
    }

    static _buildAggregators() {
        return {
            currency: (list) => {
                const numbers = flattenAndFilter(list)
                    .map(Number)
                    .filter(Number.isFinite);
                if (!numbers.length) {
                    return 0;
                }
                return numbers.reduce((total, value) => total + value, 0);
            },
            time_passed: (list) => {
                const numbers = flattenAndFilter(list)
                    .map(Number)
                    .filter(Number.isFinite);
                if (!numbers.length) {
                    return null;
                }
                return numbers.reduce((total, value) => total + value, 0);
            },
            in_combat: (list) => {
                const values = flattenAndFilter(list);
                if (!values.length) {
                    return false;
                }
                return Boolean(values[values.length - 1]);
            },
            any_quest_objectives_completed: (list) =>
                flattenAndFilter(list).some((value) => value === true),
            consume_item: (list) => {
                const entries = flattenAndFilter(list);
                const normalized = [];

                const copyKnownFields = (source, target) => {
                    for (const [key, value] of Object.entries(source)) {
                        if (value === null || value === undefined) {
                            continue;
                        }
                        if (typeof value === "string") {
                            const trimmed = value.trim();
                            if (trimmed) {
                                target[key] = trimmed;
                            }
                        } else if (typeof value === "number") {
                            target[key] = value;
                        }
                    }
                };

                for (const entry of entries) {
                    if (!entry) {
                        continue;
                    }
                    if (typeof entry === "string") {
                        const itemName = entry.trim();
                        if (itemName) {
                            normalized.push({ item: itemName });
                        }
                        continue;
                    }
                    if (typeof entry === "object") {
                        const normalizedEntry = {};
                        copyKnownFields(entry, normalizedEntry);

                        if (!normalizedEntry.item && typeof entry.name === "string") {
                            const nameTrimmed = entry.name.trim();
                            if (nameTrimmed) {
                                normalizedEntry.item = nameTrimmed;
                            }
                        }

                        if (!normalizedEntry.item && typeof entry.item === "string") {
                            const itemTrimmed = entry.item.trim();
                            if (itemTrimmed) {
                                normalizedEntry.item = itemTrimmed;
                            }
                        }

                        if (!normalizedEntry.item) {
                            continue;
                        }

                        if (normalizedEntry.user) {
                            normalizedEntry.user = normalizedEntry.user.trim();
                        }

                        normalized.push(normalizedEntry);
                    }
                }
                return normalized;
            },
        };
    }

    static _getMysteryBoxIndexForPrompt() {
        return MysteryBox.getAll()
            .filter((box) => !box.resolved)
            .map((box) => ({
                id: box.id,
                name: box.name,
                keys: [...box.keys],
                text: box.text,
            }));
    }

    static _resolveMysteryThreadMaxActive(config = this.config || {}) {
        const configured = Number(config?.mystery_threads?.max_active);
        if (Number.isInteger(configured) && configured >= 0) {
            return configured;
        }
        return 2;
    }

    static _serializeMysteryThreadForPrompt(thread, { includeBoxes = true } = {}) {
        const serialized = {
            id: thread.id,
            name: thread.name,
            status: thread.status,
            keys: [...thread.keys],
            summary: thread.summary,
            constraints: [...thread.constraints],
            boxIds: [...thread.boxIds],
        };
        if (includeBoxes) {
            serialized.mysteryBoxes = thread.boxIds
                .map((boxId) => MysteryBox.getById(boxId))
                .filter(Boolean)
                .filter((box) => !box.resolved)
                .map((box) => ({
                    id: box.id,
                    name: box.name,
                    keys: [...box.keys],
                    text: box.text,
                }));
        }
        return serialized;
    }

    static _getMysteryThreadIndexForPrompt() {
        return MysteryThread.getAll().map((thread) => this._serializeMysteryThreadForPrompt(thread, {
            includeBoxes: false,
        }));
    }

    static _getActiveMysteryThreadsForPrompt(maxActive) {
        return MysteryThread.getActive({ max: maxActive }).map((thread) =>
            this._serializeMysteryThreadForPrompt(thread, { includeBoxes: true })
        );
    }

    static _parseMysteryBoxUpdateResponse(responseText) {
        const xml = Utils.extractFinalXmlRootBlock(responseText || "", "mysteryBoxUpdate");
        if (!xml) {
            throw new Error("Mystery box update response missing <mysteryBoxUpdate> root.");
        }

        let doc;
        try {
            doc = Utils.parseXmlDocumentStrict(xml, "text/xml");
        } catch (error) {
            throw new Error(`Failed to parse mystery box update XML: ${error.message}`);
        }

        const root = doc?.documentElement;
        if (!root || root.tagName !== "mysteryBoxUpdate") {
            throw new Error("Mystery box update response did not parse into <mysteryBoxUpdate>.");
        }

        const action = this._getXmlDirectChildText(root, "action").trim().toLowerCase();
        if (action !== "create" && action !== "update" && action !== "skip") {
            throw new Error('Mystery box update <action> must be "create", "update", or "skip".');
        }

        if (action === "skip") {
            return {
                action,
                reason: normalizeString(this._getXmlDirectChildText(root, "reason")),
            };
        }

        const name = normalizeString(this._getXmlDirectChildText(root, "name"));
        if (!name) {
            throw new Error("Mystery box update requires non-empty <name> as the canonical key.");
        }
        const text = normalizeString(this._getXmlDirectChildText(root, "text"));
        if (!text) {
            throw new Error("Mystery box update requires non-empty <text>.");
        }

        const keysNode = this._getXmlDirectChildNode(root, "keys");
        const keys = keysNode
            ? this._getXmlElementChildren(keysNode)
                .filter((child) => child.tagName === "key")
                .map((child) => normalizeString(child.textContent))
                .filter(Boolean)
            : [];

        const threadNode = this._getXmlDirectChildNode(root, "thread");
        let thread = null;
        if (threadNode) {
            const threadKeysNode = this._getXmlDirectChildNode(threadNode, "keys");
            const threadConstraintsNode = this._getXmlDirectChildNode(threadNode, "constraints");
            thread = {
                id: normalizeString(this._getXmlDirectChildText(threadNode, "id")),
                name: normalizeString(this._getXmlDirectChildText(threadNode, "name")),
                status: normalizeString(this._getXmlDirectChildText(threadNode, "status")),
                keys: threadKeysNode
                    ? this._getXmlElementChildren(threadKeysNode)
                        .filter((child) => child.tagName === "key")
                        .map((child) => normalizeString(child.textContent))
                        .filter(Boolean)
                    : [],
                summary: normalizeString(this._getXmlDirectChildText(threadNode, "summary")),
                constraints: threadConstraintsNode
                    ? this._getXmlElementChildren(threadConstraintsNode)
                        .filter((child) => child.tagName === "constraint")
                        .map((child) => normalizeString(child.textContent))
                        .filter(Boolean)
                    : [],
            };
        }

        return {
            action,
            name,
            keys,
            text,
            thread,
        };
    }

    static _parseMysteryThreadCheckResponse(responseText) {
        const xml = Utils.extractFinalXmlRootBlock(responseText || "", "resolvedMysteries");
        if (!xml) {
            throw new Error("Mystery thread check response missing <resolvedMysteries> root.");
        }

        let doc;
        try {
            doc = Utils.parseXmlDocumentStrict(xml, "text/xml");
        } catch (error) {
            throw new Error(`Failed to parse mystery thread check XML: ${error.message}`);
        }

        const root = doc?.documentElement;
        if (!root || root.tagName !== "resolvedMysteries") {
            throw new Error("Mystery thread check response did not parse into <resolvedMysteries>.");
        }

        const threads = this._getXmlElementChildren(root)
            .filter((child) => child.tagName === "mysteryThread")
            .map((child) => ({
                name: normalizeString(this._getXmlDirectChildText(child, "name")),
                reasoning: normalizeString(this._getXmlDirectChildText(child, "reasoning")),
            }))
            .filter((entry) => {
                if (entry.name) {
                    return true;
                }
                console.warn("Mystery thread check returned a resolved mysteryThread entry without a name; ignoring it.");
                return false;
            });

        const boxes = this._getXmlElementChildren(root)
            .filter((child) => child.tagName === "mysteryBox")
            .map((child) => ({
                name: normalizeString(this._getXmlDirectChildText(child, "name")),
            }))
            .filter((entry) => {
                if (entry.name) {
                    return true;
                }
                console.warn("Mystery thread check returned a resolved mysteryBox entry without a name; ignoring it.");
                return false;
            });

        return { threads, boxes };
    }

    static _parseMysteryCleanupBoolean(value, label) {
        const normalized = normalizeString(value).toLowerCase();
        if (normalized === "true") {
            return true;
        }
        if (normalized === "false") {
            return false;
        }
        throw new Error(`${label} must be true or false.`);
    }

    static _parseMysteryBoxCleanupResponse(responseText) {
        const xml = Utils.extractFinalXmlRootBlock(responseText || "", "mysteryThreads");
        if (!xml) {
            throw new Error("Mystery box cleanup response missing <mysteryThreads> root.");
        }

        let doc;
        try {
            doc = Utils.parseXmlDocumentStrict(xml, "text/xml");
        } catch (error) {
            throw new Error(`Failed to parse mystery box cleanup XML: ${error.message}`);
        }

        const root = doc?.documentElement;
        if (!root || root.tagName !== "mysteryThreads") {
            throw new Error("Mystery box cleanup response did not parse into <mysteryThreads>.");
        }

        const threads = this._getXmlElementChildren(root)
            .filter((child) => child.tagName === "mysteryThread")
            .map((threadNode) => {
                const id = normalizeString(this._getXmlDirectChildText(threadNode, "id"));
                if (!id) {
                    console.warn("Mystery box cleanup returned a mysteryThread entry without an id; ignoring it.");
                    return null;
                }
                const boxesNode = this._getXmlElementChildren(threadNode)
                    .find((child) => child.tagName === "mysteryBoxes");
                const boxes = boxesNode
                    ? this._getXmlElementChildren(boxesNode)
                        .filter((child) => child.tagName === "mysteryBox")
                        .map((boxNode) => {
                            const boxId = normalizeString(this._getXmlDirectChildText(boxNode, "id"));
                            if (!boxId) {
                                console.warn(`Mystery box cleanup returned a mysteryBox entry without an id for thread "${id}"; ignoring it.`);
                                return null;
                            }
                            return {
                                id: boxId,
                                thoughts: normalizeString(this._getXmlDirectChildText(boxNode, "thoughts")),
                                revealed: this._parseMysteryCleanupBoolean(
                                    this._getXmlDirectChildText(boxNode, "revealed"),
                                    `Mystery box cleanup revealed value for "${boxId}"`
                                ),
                            };
                        })
                        .filter(Boolean)
                    : [];

                return {
                    id,
                    thoughts: normalizeString(this._getXmlDirectChildText(threadNode, "thoughts")),
                    resolved: this._parseMysteryCleanupBoolean(
                        this._getXmlDirectChildText(threadNode, "resolved"),
                        `Mystery box cleanup resolved value for "${id}"`
                    ),
                    boxes,
                };
            })
            .filter(Boolean);

        return { threads };
    }

    static _summarizeMysteryBoxCleanupDecisions(cleanupResult = {}, cleanupThreads = []) {
        if (!cleanupResult || typeof cleanupResult !== "object" || Array.isArray(cleanupResult)) {
            throw new Error("Cannot summarize empty mystery box cleanup result.");
        }
        if (!Array.isArray(cleanupThreads)) {
            throw new Error("Mystery cleanup candidate threads must be an array.");
        }

        const threadCandidatesById = new Map();
        const boxCandidatesById = new Map();
        for (const threadCandidate of cleanupThreads) {
            const threadId = normalizeString(threadCandidate?.id);
            if (!threadId) {
                continue;
            }
            const threadName = normalizeString(threadCandidate?.name);
            threadCandidatesById.set(threadId, {
                id: threadId,
                name: threadName,
            });

            const boxCandidates = Array.isArray(threadCandidate?.mysteryBoxes)
                ? threadCandidate.mysteryBoxes
                : [];
            for (const boxCandidate of boxCandidates) {
                const boxId = normalizeString(boxCandidate?.id);
                if (!boxId) {
                    continue;
                }
                boxCandidatesById.set(boxId, {
                    id: boxId,
                    name: normalizeString(boxCandidate?.name),
                    threadId,
                    threadName,
                });
            }
        }

        const resolvedThreads = [];
        const resolvedBoxes = [];
        const seenThreadIds = new Set();
        const seenBoxIds = new Set();
        const threadEntries = Array.isArray(cleanupResult.threads) ? cleanupResult.threads : [];

        for (const threadEntry of threadEntries) {
            const threadId = normalizeString(threadEntry?.id);
            if (threadEntry?.resolved === true) {
                const threadCandidate = threadCandidatesById.get(threadId);
                if (!threadCandidate) {
                    console.warn(`Mystery box cleanup returned resolved thread "${threadId}", but it was not listed as a cleanup candidate; continuing.`);
                } else if (!seenThreadIds.has(threadCandidate.id)) {
                    seenThreadIds.add(threadCandidate.id);
                    resolvedThreads.push({
                        id: threadCandidate.id,
                        name: threadCandidate.name,
                        thoughts: normalizeString(threadEntry?.thoughts),
                    });
                }
            }

            const boxEntries = Array.isArray(threadEntry?.boxes) ? threadEntry.boxes : [];
            for (const boxEntry of boxEntries) {
                if (boxEntry?.revealed !== true) {
                    continue;
                }
                const boxId = normalizeString(boxEntry?.id);
                const boxCandidate = boxCandidatesById.get(boxId);
                if (!boxCandidate) {
                    console.warn(`Mystery box cleanup returned revealed box "${boxId}", but it was not listed as a cleanup candidate; continuing.`);
                    continue;
                }
                if (seenBoxIds.has(boxCandidate.id)) {
                    continue;
                }
                seenBoxIds.add(boxCandidate.id);
                resolvedBoxes.push({
                    id: boxCandidate.id,
                    name: boxCandidate.name,
                    thoughts: normalizeString(boxEntry?.thoughts),
                    threadId: boxCandidate.threadId,
                    threadName: boxCandidate.threadName,
                });
            }
        }

        return { resolvedThreads, resolvedBoxes };
    }

    static _applyMysteryBoxCleanupResult(cleanupResult = {}) {
        if (!cleanupResult || typeof cleanupResult !== "object" || Array.isArray(cleanupResult)) {
            throw new Error("Cannot apply empty mystery box cleanup result.");
        }
        const resolvedThreads = [];
        const resolvedBoxes = [];
        const seenThreadIds = new Set();
        const seenBoxIds = new Set();
        const threadEntries = Array.isArray(cleanupResult.threads) ? cleanupResult.threads : [];

        for (const threadEntry of threadEntries) {
            const threadId = normalizeString(threadEntry?.id);
            const thread = threadId ? MysteryThread.getById(threadId) : null;
            if (threadEntry?.resolved === true) {
                if (!threadId) {
                    console.warn("Mystery box cleanup returned a resolved thread without an id; ignoring it.");
                } else if (!thread) {
                    console.warn(`Mystery box cleanup returned resolved thread "${threadId}", but it does not match any mystery thread; continuing.`);
                } else if (thread.status !== "active") {
                    console.warn(`Mystery box cleanup returned resolved thread "${thread.name}", but it is not active; continuing.`);
                } else if (!seenThreadIds.has(thread.id)) {
                    thread.applyUpdate({ status: "inactive" });
                    seenThreadIds.add(thread.id);
                    resolvedThreads.push({
                        id: thread.id,
                        name: thread.name,
                        thoughts: normalizeString(threadEntry?.thoughts),
                    });
                }
            }

            const boxEntries = Array.isArray(threadEntry?.boxes) ? threadEntry.boxes : [];
            for (const boxEntry of boxEntries) {
                if (boxEntry?.revealed !== true) {
                    continue;
                }
                const boxId = normalizeString(boxEntry?.id);
                if (!boxId) {
                    console.warn("Mystery box cleanup returned a revealed box without an id; ignoring it.");
                    continue;
                }
                if (seenBoxIds.has(boxId)) {
                    continue;
                }
                const box = MysteryBox.getById(boxId);
                if (!box) {
                    console.warn(`Mystery box cleanup returned revealed box "${boxId}", but it does not match any mystery box; continuing.`);
                    continue;
                }
                const containingThread = MysteryThread.getContainingBox(box.id) || thread || null;
                box.markResolved();
                seenBoxIds.add(box.id);
                resolvedBoxes.push({
                    id: box.id,
                    name: box.name,
                    thoughts: normalizeString(boxEntry?.thoughts),
                    threadId: containingThread?.id || null,
                    threadName: containingThread?.name || null,
                });
            }
        }

        return { resolvedThreads, resolvedBoxes };
    }

    static _markResolvedMysteryThreadsInactive(resolvedThreads = []) {
        if (!Array.isArray(resolvedThreads) || !resolvedThreads.length) {
            return [];
        }

        const inactivated = [];
        for (const resolved of resolvedThreads) {
            const name = normalizeString(resolved?.name);
            if (!name) {
                console.warn("Mystery thread check returned a resolved thread without a name; ignoring it.");
                continue;
            }

            const thread = MysteryThread.getById(name)
                || MysteryThread.getByKey(name)
                || MysteryThread.findByNameOrKey(name).find((candidate) => candidate.status === "active");
            if (!thread || thread.status !== "active") {
                console.warn(`Mystery thread check returned resolved thread "${name}", but it does not match any active thread; continuing.`);
                continue;
            }

            thread.applyUpdate({ status: "inactive" });
            inactivated.push({
                id: thread.id,
                name: thread.name,
                reasoning: normalizeString(resolved?.reasoning),
            });
        }

        return inactivated;
    }

    static _markResolvedMysteryBoxes(resolvedBoxes = []) {
        if (!Array.isArray(resolvedBoxes) || !resolvedBoxes.length) {
            return [];
        }

        const resolved = [];
        for (const entry of resolvedBoxes) {
            const name = normalizeString(entry?.name);
            if (!name) {
                console.warn("Mystery thread check returned a resolved box without a name; ignoring it.");
                continue;
            }

            const box = MysteryBox.getById(name) || MysteryBox.getByKey(name);
            if (!box) {
                console.warn(`Mystery thread check returned resolved box "${name}", but it does not match any mystery box; continuing.`);
                continue;
            }

            box.markResolved();
            resolved.push({
                id: box.id,
                name: box.name,
            });
        }

        return resolved;
    }

    static _applyMysteryBoxUpdate(update, mention = {}, context = {}) {
        if (!update || typeof update !== "object") {
            throw new Error("Cannot apply empty mystery box update.");
        }

        if (update.action === "skip") {
            return null;
        }

        const mentionName = normalizeString(mention?.name);
        const canonicalName = normalizeString(update.name);
        if (!canonicalName) {
            throw new Error("Mystery box update requires a non-empty canonical name.");
        }
        const lookupKeys = [
            canonicalName,
            mentionName,
            ...(Array.isArray(update.keys) ? update.keys : []),
        ].filter(Boolean);

        let box = null;
        for (const key of lookupKeys) {
            box = MysteryBox.getByKey(key);
            if (box) {
                break;
            }
        }

        const mentionRecord = {
            name: mentionName || canonicalName,
            context: normalizeString(mention?.context),
            sourceEntryId: normalizeString(context?.sourceEntryId),
            worldTime: context?.worldTime || Globals.getSerializedWorldTime?.() || null,
        };

        const updateKeys = [
            mentionName,
            ...(Array.isArray(update.keys) ? update.keys : []),
        ].filter(Boolean);

        if (update.action === "update") {
            if (!box) {
                throw new Error(`Mystery box update targeted "${canonicalName}" but no matching mystery box exists.`);
            }
            box = box.applyUpdate({
                name: canonicalName,
                keys: updateKeys,
                text: update.text,
                mention: mentionRecord,
            });
        } else if (box) {
            box = box.applyUpdate({
                name: canonicalName,
                keys: updateKeys,
                text: update.text,
                mention: mentionRecord,
            });
        } else {
            box = new MysteryBox({
                name: canonicalName,
                keys: updateKeys,
                text: update.text,
                mentions: [mentionRecord],
            });
        }

        this._applyMysteryThreadUpdateForBox(update.thread, box, {
            action: update.action,
            canonicalName,
            config: this.config || {},
        });

        return box;
    }

    static _applyMysteryThreadUpdateForBox(threadUpdate, box, { action = "update", canonicalName = "", config = {} } = {}) {
        if (!box) {
            throw new Error("Cannot attach mystery thread update without a mystery box.");
        }

        let thread = null;
        const threadLookupKeys = [
            threadUpdate?.id,
            threadUpdate?.name,
            ...(Array.isArray(threadUpdate?.keys) ? threadUpdate.keys : []),
        ].filter(Boolean);
        for (const key of threadLookupKeys) {
            thread = MysteryThread.getById(key) || MysteryThread.getByKey(key);
            if (thread) {
                break;
            }
        }
        if (!thread) {
            thread = MysteryThread.getContainingBox(box.id);
        }

        const maxActive = this._resolveMysteryThreadMaxActive(config);
        const activeThreadCount = MysteryThread.getActive({ max: Number.MAX_SAFE_INTEGER }).length;
        const requestedStatus = normalizeString(threadUpdate?.status);
        const newThreadStatus = requestedStatus || "active";

        if (!thread) {
            const threadName = normalizeString(threadUpdate?.name) || canonicalName;
            if (!threadName) {
                throw new Error("Mystery box update requires a parent mystery thread name.");
            }
            if (newThreadStatus === "active" && activeThreadCount >= maxActive) {
                throw new Error(`Cannot create active mystery thread "${threadName}"; mystery_threads.max_active is ${maxActive}.`);
            }
            thread = new MysteryThread({
                name: threadName,
                status: newThreadStatus,
                keys: Array.isArray(threadUpdate?.keys) ? threadUpdate.keys : [],
                summary: normalizeString(threadUpdate?.summary),
                constraints: Array.isArray(threadUpdate?.constraints) ? threadUpdate.constraints : [],
                boxIds: [box.id],
            });
            return thread;
        }

        if (requestedStatus === "active" && thread.status !== "active" && activeThreadCount >= maxActive) {
            throw new Error(`Cannot activate mystery thread "${thread.name}"; mystery_threads.max_active is ${maxActive}.`);
        }

        thread.applyUpdate({
            name: normalizeString(threadUpdate?.name) || null,
            keys: Array.isArray(threadUpdate?.keys) ? threadUpdate.keys : [],
            status: requestedStatus || null,
            summary: typeof threadUpdate?.summary === "string" ? threadUpdate.summary : null,
            constraints: Array.isArray(threadUpdate?.constraints) ? threadUpdate.constraints : null,
            boxId: box.id,
        });

        return thread;
    }

    static _createMysteryBoxToolRuntime() {
        const unavailable = (name) => () => {
            throw new Error(`${name} is not available in mystery-box-update tool scope.`);
        };
        return createChatToolRuntime({
            getConfig: () => this.config || {},
            getChatHistory: () => [],
            isAssistantProseLikeEntry: () => true,
            serializeNpcForClient: () => ({}),
            buildLocationResponse: () => ({}),
            getCurrentPlayer: () => this.currentPlayer || {},
            createLocationFromEvent: unavailable("createLocationFromEvent"),
            createRegionStubFromEvent: unavailable("createRegionStubFromEvent"),
            generateItemsByNames: unavailable("generateItemsByNames"),
            ensureExitConnection: unavailable("ensureExitConnection"),
            findRegionByLocationId: () => null,
            LLMClient,
            Player,
            Thing,
            Location: this._deps.Location || {},
            Region: this._deps.Region || {},
            getGameLocations: () => new Map(),
            getFactions: () => [],
            getRegionsMap: () => new Map(),
            getPendingRegionStubs: () => new Map(),
        });
    }

    static async _runMysteryThreadCheckPrompt(context = {}) {
        const promptEnv = this._deps.promptEnv;
        const parseXMLTemplate = this._deps.parseXMLTemplate;
        const prepareBasePromptContext = this._deps.prepareBasePromptContext;
        if (!promptEnv || typeof promptEnv.render !== "function") {
            throw new Error("promptEnv.render dependency is not configured.");
        }
        if (typeof parseXMLTemplate !== "function") {
            throw new Error("parseXMLTemplate dependency is not configured.");
        }
        if (typeof prepareBasePromptContext !== "function") {
            throw new Error("prepareBasePromptContext dependency is not configured.");
        }

        const activeMysteryThreads = MysteryThread.getActive({ max: Number.MAX_SAFE_INTEGER })
            .map((thread) => this._serializeMysteryThreadForPrompt(thread, { includeBoxes: true }));
        if (!activeMysteryThreads.length) {
            return {
                inactivatedThreads: [],
                resolvedBoxes: [],
            };
        }

        const baseContext = await prepareBasePromptContext({
            locationOverride: context?.location || null,
        });
        const config = this.config || {};
        const mysteryThreadMaxActive = this._resolveMysteryThreadMaxActive(config);
        const rendered = promptEnv.render("base-context.xml.njk", {
            ...baseContext,
            promptType: "mystery-thread-check",
            activeMysteryThreads,
            mysteryThreadMaxActive,
            mysteryThreadCheckText: typeof context?.textToCheck === "string" ? context.textToCheck : "",
            mysteryThreadCheckActionText: typeof context?.actionText === "string" ? context.actionText : "",
            omitGameHistory: true,
        });
        const parsedTemplate = parseXMLTemplate(rendered);
        if (!parsedTemplate?.systemPrompt || !parsedTemplate?.generationPrompt) {
            throw new Error("Mystery thread check template did not produce prompts.");
        }

        const responseText = await LLMClient.chatCompletion({
            messages: [
                { role: "system", content: parsedTemplate.systemPrompt },
                { role: "user", content: parsedTemplate.generationPrompt },
            ],
            metadataLabel: "mystery_thread_check",
            timeoutMs: this._baseTimeout,
            temperature: 0,
            validateXML: false,
            requiredRegex: /<resolvedMysteries[\s>]/,
        });

        LLMClient.logPrompt({
            prefix: "mystery_thread_check",
            metadataLabel: "mystery_thread_check",
            systemPrompt: parsedTemplate.systemPrompt || "",
            generationPrompt: parsedTemplate.generationPrompt || "",
            response: responseText || "",
        });

        const resolvedMysteries = this._parseMysteryThreadCheckResponse(responseText);
        return {
            inactivatedThreads: this._markResolvedMysteryThreadsInactive(resolvedMysteries.threads),
            resolvedBoxes: this._markResolvedMysteryBoxes(resolvedMysteries.boxes),
        };
    }

    static async _runMysteryBoxUpdatePrompt(mention, context = {}) {
        const promptEnv = this._deps.promptEnv;
        const parseXMLTemplate = this._deps.parseXMLTemplate;
        const prepareBasePromptContext = this._deps.prepareBasePromptContext;
        if (!promptEnv || typeof promptEnv.render !== "function") {
            throw new Error("promptEnv.render dependency is not configured.");
        }
        if (typeof parseXMLTemplate !== "function") {
            throw new Error("parseXMLTemplate dependency is not configured.");
        }
        if (typeof prepareBasePromptContext !== "function") {
            throw new Error("prepareBasePromptContext dependency is not configured.");
        }

        const baseContext = await prepareBasePromptContext({
            locationOverride: context?.location || null,
        });
        const config = this.config || {};
        const mysteryThreadMaxActive = this._resolveMysteryThreadMaxActive(config);
        const activeMysteryThreads = this._getActiveMysteryThreadsForPrompt(mysteryThreadMaxActive);
        const activeThreadCount = MysteryThread.getActive({ max: Number.MAX_SAFE_INTEGER }).length;
        const rendered = promptEnv.render("base-context.xml.njk", {
            ...baseContext,
            promptType: "mystery-box-update",
            mysteryBoxMention: mention,
            mysteryBoxEventText: typeof context?.textToCheck === "string" ? context.textToCheck : "",
            mysteryBoxActionText: typeof context?.actionText === "string" ? context.actionText : "",
            mysteryBoxes: this._getMysteryBoxIndexForPrompt(),
            mysteryThreads: this._getMysteryThreadIndexForPrompt(),
            activeMysteryThreads,
            mysteryThreadMaxActive,
            mysteryThreadActiveCount: activeThreadCount,
            mysteryThreadCapacityFull: activeThreadCount >= mysteryThreadMaxActive,
            omitGameHistory: true,
        });
        const parsedTemplate = parseXMLTemplate(rendered);
        if (!parsedTemplate?.systemPrompt || !parsedTemplate?.generationPrompt) {
            throw new Error("Mystery box update template did not produce prompts.");
        }

        const toolRuntime = this._createMysteryBoxToolRuntime();
        const toolLoopResult = await toolRuntime.runChatCompletionWithToolLoop({
            requestOptions: {
                messages: [
                    { role: "system", content: parsedTemplate.systemPrompt },
                    { role: "user", content: parsedTemplate.generationPrompt },
                ],
                metadataLabel: "mystery_box_update",
                errorLogLabel: "mystery-box-update",
                timeoutMs: this._baseTimeout,
                temperature: 0,
                validateXML: false,
                additionalPayload: {
                    tools: MYSTERY_BOX_UPDATE_CHAT_TOOLS,
                    tool_choice: "auto",
                },
            },
            metadataLabel: "mystery_box_update",
        });
        const responseText = toolLoopResult.aiResponse || "";

        LLMClient.logPrompt({
            prefix: "mystery_box_update",
            metadataLabel: "mystery_box_update",
            systemPrompt: parsedTemplate.systemPrompt || "",
            generationPrompt: parsedTemplate.generationPrompt || "",
            response: responseText || "",
        });

        const update = this._parseMysteryBoxUpdateResponse(responseText);
        return this._applyMysteryBoxUpdate(update, mention, context);
    }

    static _buildHandlers() {
        return {
            new_exit_discovered: async function (entries = [], context = {}) {
                await applyExitDiscovery(this, entries, context, {
                    movePlayer: false,
                    eventLabel: "new_exit_discovered",
                    moveLabel: "move_location",
                });
            },
            move_new_location: async function (entries = [], context = {}) {
                //console.log('Processing move_new_location events:', entries);
                const stream = context?.stream || null;
                await applyExitDiscovery(this, entries, context, {
                    movePlayer: true,
                    eventLabel: "move_new_location",
                    moveLabel: "move_new_location",
                });
                if (entries && entries.length > 0) {
                    //console.log('Recording move events in context for move_new_location.');
                    // Initialize moveEvents array if it doesn't exist
                    if (!Array.isArray(context.moveEvents)) {
                        context.moveEvents = [];
                    }

                    // Add event data for each move entry
                    for (const entry of entries) {
                        //console.log('Recording move event for entry:', entry);
                        if (entry && entry.name) {
                            Events.movedLocations.add(entry.name);
                            const moveEventData = {
                                type: "move_new_location",
                                destination: entry.name,
                                description: entry.description || "",
                                kind: entry.kind || "location",
                                vehicleType: entry.vehicleType || null,
                                timestamp: Date.now(),
                            };

                            // Add the current location info if available
                            if (context.location) {
                                moveEventData.newLocation = {
                                    id: context.location.id,
                                    name: context.location.name,
                                    description: context.location.description,
                                };
                            }

                            //console.log('Move event data to record:', moveEventData);
                            context.moveEvents.push(moveEventData);
                            if (stream && typeof stream.status === "function") {
                                stream.status("spinner:start", {
                                    message: `Moving to ${entry.name}...`,
                                });
                                console.log(
                                    `Spinner start status emitted for moving to ${entry.name}.`,
                                );
                            }
                        }
                    }
                }
            },
            alter_location: async function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }

                const currentLocationName =
                    context.location?.name || Globals.location.name;
                const validEntries = entries.filter(
                    (entry) => entry?.currentName === currentLocationName,
                );
                if (!validEntries.length) {
                    return;
                }

                const {
                    Location,
                    promptEnv,
                    parseXMLTemplate,
                    prepareBasePromptContext,
                    fs,
                    path,
                    baseDir,
                    generatedImages,
                } = this._deps;

                const warnSkippedAlteration = (entry, reason) => {
                    console.warn(`[alter_location] ${reason}`);
                    if (entry) {
                        console.warn("[alter_location] entry:", entry);
                    }
                    console.trace();
                };

                if (!context.location) {
                    validEntries.forEach((entry) =>
                        warnSkippedAlteration(entry, "No context.location available."),
                    );
                    return;
                }

                if (
                    typeof promptEnv?.render !== "function" ||
                    typeof parseXMLTemplate !== "function" ||
                    typeof prepareBasePromptContext !== "function"
                ) {
                    validEntries.forEach((entry) =>
                        warnSkippedAlteration(
                            entry,
                            "Missing required prompt dependencies.",
                        ),
                    );
                    return;
                }

                const config = this.config || {};
                if (!config?.ai) {
                    validEntries.forEach((entry) =>
                        warnSkippedAlteration(entry, "AI configuration incomplete."),
                    );
                    return;
                }

                let location = context.location;
                if (
                    !location &&
                    context.player?.currentLocation &&
                    Location &&
                    typeof Location.get === "function"
                ) {
                    try {
                        location = Location.get(context.player.currentLocation);
                    } catch (_) {
                        location = null;
                    }
                }
                if (
                    !location &&
                    this.currentPlayer?.currentLocation &&
                    Location &&
                    typeof Location.get === "function"
                ) {
                    try {
                        location = Location.get(this.currentPlayer.currentLocation);
                    } catch (_) {
                        location = null;
                    }
                }

                if (!location) {
                    validEntries.forEach((entry) =>
                        warnSkippedAlteration(
                            entry,
                            "Unable to resolve current location object.",
                        ),
                    );
                    return;
                }

                const locationDetails =
                    typeof location.getDetails === "function"
                        ? location.getDetails()
                        : null;
                const baseSnapshot = {
                    name: locationDetails?.name || location.name || "Unknown Location",
                    description:
                        locationDetails?.description ||
                        location.description ||
                        "No description available.",
                    baseLevel: Number.isFinite(locationDetails?.baseLevel)
                        ? locationDetails.baseLevel
                        : location.baseLevel,
                    relativeLevel:
                        locationDetails?.generationHints?.relativeLevel ?? null,
                    numNpcs: locationDetails?.generationHints?.numNpcs ?? null,
                    numItems: locationDetails?.generationHints?.numItems ?? null,
                    numScenery: locationDetails?.generationHints?.numScenery ?? null,
                    numHostiles: locationDetails?.generationHints?.numHostiles ?? null,
                    statusEffects:
                        typeof location.getStatusEffects === "function"
                            ? location.getStatusEffects()
                            : [],
                };

                const alteredSummaries = [];

                for (const entry of validEntries) {
                    if (!entry) {
                        continue;
                    }

                    const changeDescription =
                        typeof entry.description === "string"
                            ? entry.description.trim()
                            : "";
                    if (!changeDescription) {
                        entry.description = "";
                        entry.changeDescription = "";
                        continue;
                    }

                    entry.description = changeDescription;
                    entry.changeDescription = changeDescription;
                    if (!entry.name) {
                        entry.name =
                            entry.newName ||
                            entry.currentName ||
                            location.name ||
                            baseSnapshot.name;
                    }

                    try {
                        const baseContext = await prepareBasePromptContext({
                            locationOverride: location,
                        });
                        const oldName =
                            entry.currentName || location.name || baseSnapshot.name;
                        const desiredName =
                            entry.newName || location.name || baseSnapshot.name;

                        const locationSeed = {
                            name: desiredName,
                            description: location.description,
                            baseLevel: location.baseLevel,
                            oldName,
                        };

                        const preserveBaseLevel = context.preserveBaseLevel === true
                            || entry.preserveBaseLevel === true;

                        const promptPayload = {
                            ...baseContext,
                            promptType: "location-alter",
                            changeDescription,
                            alteredLocation: baseSnapshot,
                            locationSeed,
                            preserveBaseLevel,
                        };

                        let renderedTemplate;
                        try {
                            renderedTemplate = promptEnv.render(
                                "base-context.xml.njk",
                                promptPayload,
                            );
                        } catch (renderError) {
                            console.warn(
                                "Failed to render location alteration prompt:",
                                renderError.message,
                            );
                            warnSkippedAlteration(entry, "Template rendering failed.");
                            continue;
                        }

                        let parsedTemplate;
                        try {
                            parsedTemplate = parseXMLTemplate(renderedTemplate);
                        } catch (templateError) {
                            console.warn(
                                "Failed to parse location alteration template:",
                                templateError.message,
                            );
                            warnSkippedAlteration(entry, "Template parsing failed.");
                            continue;
                        }

                        if (
                            !parsedTemplate?.systemPrompt ||
                            !parsedTemplate?.generationPrompt
                        ) {
                            console.warn("Alter location template missing prompts.");
                            warnSkippedAlteration(entry, "Template missing prompts.");
                            continue;
                        }

                        const messages = [
                            { role: "system", content: parsedTemplate.systemPrompt },
                            { role: "user", content: parsedTemplate.generationPrompt },
                        ];

                        const requestStart = Date.now();
                        const requestOptions = {
                            messages,
                            metadataLabel: "alter_location",
                            timeoutMs: this._baseTimeout,
                        };

                        if (typeof parsedTemplate.temperature === "number") {
                            requestOptions.temperature = parsedTemplate.temperature;
                        } else if (Number.isInteger(config.ai.temperature)) {
                            requestOptions.temperature = config.ai.temperature;
                        }

                        let aiContent;
                        try {
                            aiContent = await LLMClient.chatCompletion(requestOptions);
                        } catch (requestError) {
                            console.warn(
                                "Alter location request failed:",
                                requestError.message,
                            );
                            warnSkippedAlteration(entry, "AI request failed.");
                            continue;
                        }

                        this._logAlterLocation({
                            fs,
                            path,
                            baseDir,
                            locationName: desiredName,
                            systemPrompt: parsedTemplate.systemPrompt,
                            generationPrompt: parsedTemplate.generationPrompt,
                            responseText: aiContent,
                            durationSeconds: (Date.now() - requestStart) / 1000,
                        });

                        if (!aiContent.trim()) {
                            warnSkippedAlteration(entry, "Empty AI response.");
                            continue;
                        }

                        const parsedLocation = this._parseLocationAlterXml(aiContent);
                        if (!parsedLocation) {
                            warnSkippedAlteration(entry, "Failed to parse AI response.");
                            continue;
                        }

                        const summary = this._applyLocationAlteration({
                            location,
                            parsedLocation,
                            changeDescription,
                            generatedImages,
                            preserveBaseLevel,
                        });

                        if (summary) {
                            alteredSummaries.push(summary);

                            entry.changeDescription =
                                summary.changeDescription || changeDescription;
                            entry.description = entry.changeDescription;
                            entry.name =
                                summary.newName || summary.originalName || entry.name;
                            if (summary.originalName && !entry.currentName) {
                                entry.currentName = summary.originalName;
                            }
                            if (summary.newName) {
                                entry.newName = summary.newName;
                            }

                            baseSnapshot.name = location.name || baseSnapshot.name;
                            baseSnapshot.description =
                                location.description || baseSnapshot.description;
                            baseSnapshot.baseLevel = location.baseLevel;
                            baseSnapshot.statusEffects =
                                typeof location.getStatusEffects === "function"
                                    ? location.getStatusEffects()
                                    : baseSnapshot.statusEffects;
                        } else {
                            warnSkippedAlteration(
                                entry,
                                "Failed to apply location alteration summary.",
                            );
                        }
                    } catch (error) {
                        console.warn(
                            "Failed to process alter_location entry:",
                            error.message,
                        );
                        warnSkippedAlteration(
                            entry,
                            "Unexpected error during alteration processing.",
                        );
                    }
                }

                if (alteredSummaries.length) {
                    if (!Array.isArray(context.alteredLocations)) {
                        context.alteredLocations = [];
                    }
                    context.alteredLocations.push(...alteredSummaries);
                }
            },
            received_quest: async function (
                entries = [],
                context = {},
                rawValue = null,
            ) {
                const questEntries = Array.isArray(entries)
                    ? entries.filter(
                        (entry) =>
                            entry &&
                            typeof entry.summary === "string" &&
                            entry.summary.trim(),
                    )
                    : [];

                if (!questEntries.length) {
                    return;
                }

                const {
                    promptEnv,
                    parseXMLTemplate,
                    prepareBasePromptContext,
                    findActorByName,
                    Location,
                    findRegionByLocationId,
                    fs,
                    path,
                    baseDir,
                    confirmQuestWithPlayer,
                } = this._deps;

                if (
                    typeof promptEnv?.render !== "function" ||
                    typeof parseXMLTemplate !== "function" ||
                    typeof prepareBasePromptContext !== "function"
                ) {
                    throw new Error(
                        "received_quest handler is missing required prompt dependencies.",
                    );
                }

                if (typeof confirmQuestWithPlayer !== "function") {
                    throw new Error(
                        "received_quest handler is missing confirmQuestWithPlayer dependency.",
                    );
                }

                const player = context.player || this.currentPlayer;
                if (!player || typeof player.addQuest !== "function") {
                    throw new Error(
                        "received_quest handler requires a valid player with addQuest.",
                    );
                }

                const baseTimeout = this._baseTimeout || BASE_TIMEOUT_MS;

                let location = context.location || null;
                if (
                    !location &&
                    player.currentLocation &&
                    Location &&
                    typeof Location.get === "function"
                ) {
                    try {
                        location = Location.get(player.currentLocation) || null;
                    } catch (_) {
                        location = null;
                    }
                }
                if (!context.location && location) {
                    context.location = location;
                }

                if (
                    !context.region &&
                    location &&
                    typeof findRegionByLocationId === "function"
                ) {
                    try {
                        context.region = findRegionByLocationId(location.id) || null;
                    } catch (_) {
                        context.region = null;
                    }
                }

                let baseContext = {};
                try {
                    baseContext = await prepareBasePromptContext({
                        locationOverride: location,
                    });
                } catch (error) {
                    console.warn(
                        "Failed to prepare base context for quest generation:",
                        error.message,
                    );
                    throw error;
                }

                if (!Array.isArray(context.questsAwarded)) {
                    context.questsAwarded = [];
                }
                if (!Array.isArray(context.declinedQuests)) {
                    context.declinedQuests = [];
                }

                let lastQuestCreated = null;

                for (const questEntry of questEntries) {
                    const questSummaryRaw = questEntry.summary.trim();
                    const questSummary =
                        questSummaryRaw ||
                        "Provide a concise, engaging summary of the newly assigned quest.";
                    let questGiverName = questEntry.giver ? questEntry.giver.trim() : "";
                    if (
                        /^n\/?a$/i.test(questGiverName) ||
                        questGiverName.toLowerCase() === "none"
                    ) {
                        questGiverName = "";
                    }

                    const questSeed = {
                        name: "",
                        description: questSummary,
                        giver: questGiverName,
                    };

                    const renderedTemplate = promptEnv.render("base-context.xml.njk", {
                        ...baseContext,
                        promptType: "quest-generate",
                        shortDescription: questSummary,
                        quest: questSeed,
                    });

                    if (
                        typeof renderedTemplate !== "string" ||
                        !renderedTemplate.trim()
                    ) {
                        console.warn(
                            "Quest generation template rendered empty output; skipping quest.",
                            {
                                summary: questSummary,
                                giver: questGiverName,
                            },
                        );
                        continue;
                    }

                    const parsedTemplate = parseXMLTemplate(renderedTemplate);
                    if (
                        !parsedTemplate?.systemPrompt ||
                        !parsedTemplate?.generationPrompt
                    ) {
                        throw new Error(
                            "Quest generation template did not produce prompts.",
                        );
                    }

                    const questMessages = [
                        { role: "system", content: parsedTemplate.systemPrompt },
                        { role: "user", content: parsedTemplate.generationPrompt },
                    ];

                    const questRequestOptions = {
                        messages: questMessages,
                        metadataLabel: "quest_generate",
                        timeoutMs: baseTimeout,
                    };

                    if (
                        Number.isFinite(parsedTemplate.maxTokens) &&
                        parsedTemplate.maxTokens > 0
                    ) {
                        questRequestOptions.maxTokens = parsedTemplate.maxTokens;
                    }
                    if (typeof parsedTemplate.temperature === "number") {
                        questRequestOptions.temperature = parsedTemplate.temperature;
                    }

                    const requestStart = Date.now();
                    const questResponse =
                        await LLMClient.chatCompletion(questRequestOptions);
                    const durationSeconds = (Date.now() - requestStart) / 1000;

                    console.log("Quest generation response received:", questResponse);
                    Events._logQuestGeneration({
                        fs,
                        path,
                        baseDir,
                        systemPrompt: parsedTemplate.systemPrompt,
                        generationPrompt: parsedTemplate.generationPrompt,
                        responseText: questResponse,
                        metadata: { summary: questSummary, giver: questGiverName },
                        durationSeconds,
                    });

                    if (typeof questResponse !== "string" || !questResponse.trim()) {
                        console.warn(
                            "Quest generation returned empty response; skipping quest creation.",
                            {
                                summary: questSummary,
                                giver: questGiverName,
                            },
                        );
                        continue;
                    }

                    const questData = Events._parseQuestXml(questResponse);
                    if (!questData) {
                        throw new Error("Quest generation did not return a usable quest.");
                    }

                    const questName =
                        questData.name || Events._generateQuestName(questSummary);
                    const questDescription = questData.description || questSummary;

                    const rewardItems =
                        Array.isArray(questData.rewardItems) && questData.rewardItems.length
                            ? questData.rewardItems
                            : [];

                    const rewardCurrency = Number.isFinite(questData.rewardCurrency)
                        ? Math.max(0, questData.rewardCurrency)
                        : 0;
                    const rewardXp = Number.isFinite(questData.rewardXp)
                        ? Math.max(0, questData.rewardXp)
                        : 0;
                    const rewardFactionReputation = Events._resolveQuestFactionRewardMap(
                        questData.rewardFactionReputation,
                    );
                    const rewardNpcDispositions = Events._resolveQuestNpcDispositionRewards(
                        questData.rewardNpcDispositions || [],
                        {
                            findActorByName,
                            warn: console.warn,
                            contextLabel: `Generated quest "${questName}" NPC disposition reward`
                        },
                    );

                    const questOptions = {
                        name: questName,
                        description: questDescription,
                        secretNotes: questData.secretNotes || "",
                        rewardItems,
                        rewardCurrency,
                        rewardXp,
                        rewardFactionReputation,
                        rewardNpcDispositions,
                    };

                    const effectiveGiverName = questData.giver || questGiverName;
                    if (effectiveGiverName) {
                        questOptions.giverName = effectiveGiverName;
                    }
                    if (effectiveGiverName && typeof findActorByName === "function") {
                        try {
                            const questGiver = findActorByName(effectiveGiverName);
                            if (questGiver) {
                                questOptions.giver = questGiver;
                            }
                        } catch (error) {
                            console.warn(
                                `Failed to resolve quest giver "${effectiveGiverName}":`,
                                error.message,
                            );
                        }
                    }

                    const objectiveDescriptions =
                        Array.isArray(questData.objectives) && questData.objectives.length
                            ? questData.objectives
                            : questSummary
                                ? [questSummary]
                                : [];

                    const normalizeObjectiveKey = (description) =>
                        typeof description === "string" && description.trim()
                            ? description.trim().toLowerCase()
                            : "";

                    const existingQuest =
                        typeof player.getQuestByName === "function"
                            ? player.getQuestByName(questName)
                            : null;

                    if (existingQuest) {
                        existingQuest.description = questDescription;
                        if (typeof questData.secretNotes === "string") {
                            existingQuest.secretNotes = questData.secretNotes;
                        }
                        existingQuest.rewardItems = rewardItems.slice();
                        existingQuest.rewardCurrency = rewardCurrency;
                        existingQuest.rewardXp = rewardXp;
                        existingQuest.rewardFactionReputation = {
                            ...rewardFactionReputation,
                        };
                        existingQuest.rewardNpcDispositions = Quest.normalizeRewardNpcDispositions(
                            rewardNpcDispositions,
                        );
                        if (questOptions.giver) {
                            existingQuest.giver = questOptions.giver;
                        } else if (questOptions.giverName) {
                            existingQuest.giverName = questOptions.giverName;
                        }

                        const existingObjectiveStates = new Map();
                        if (Array.isArray(existingQuest.objectives)) {
                            for (const objective of existingQuest.objectives) {
                                const key = normalizeObjectiveKey(objective?.description);
                                if (!key) {
                                    continue;
                                }
                                const current = existingObjectiveStates.get(key);
                                if (!current || (objective.completed && !current.completed)) {
                                    existingObjectiveStates.set(key, {
                                        description: objective.description,
                                        optional: Boolean(objective.optional),
                                        completed: Boolean(objective.completed),
                                    });
                                }
                            }
                        }

                        existingQuest.objectives = [];
                        const seenKeys = new Set();

                        const addObjective = (
                            description,
                            optional = false,
                            completed = false,
                        ) => {
                            existingQuest.addObjective(description, optional);
                            if (completed) {
                                const lastObjective =
                                    existingQuest.objectives[existingQuest.objectives.length - 1];
                                if (lastObjective) {
                                    lastObjective.completed = true;
                                }
                            }
                        };

                        for (const objective of objectiveDescriptions) {
                            let description = "";
                            let optional = false;
                            let completed = false;
                            if (typeof objective === "string") {
                                description = objective.trim();
                            } else if (objective && typeof objective === "object") {
                                description =
                                    typeof objective.description === "string"
                                        ? objective.description.trim()
                                        : "";
                                optional = Boolean(objective.optional);
                                completed = Boolean(objective.completed);
                            }
                            if (!description) {
                                continue;
                            }
                            const key = normalizeObjectiveKey(description);
                            const preserved = existingObjectiveStates.get(key);
                            const shouldComplete =
                                (preserved && preserved.completed) || completed;
                            addObjective(description, optional, shouldComplete);
                            if (key) {
                                seenKeys.add(key);
                            }
                        }

                        for (const [key, state] of existingObjectiveStates.entries()) {
                            if (!state.completed || seenKeys.has(key)) {
                                continue;
                            }
                            addObjective(state.description, state.optional, true);
                            seenKeys.add(key);
                        }

                        if (!Array.isArray(context.updatedQuests)) {
                            context.updatedQuests = [];
                        }
                        context.updatedQuests.push({
                            id: existingQuest.id,
                            name: existingQuest.name,
                            summary:
                                questSummary || existingQuest.description || existingQuest.name,
                        });
                        continue;
                    }

                    const quest = new Quest(questOptions);

                    for (const objective of objectiveDescriptions) {
                        try {
                            if (!objective) {
                                continue;
                            }
                            if (typeof objective === "string") {
                                if (objective.trim()) {
                                    quest.addObjective(objective.trim(), false);
                                }
                                continue;
                            }
                            if (typeof objective === "object") {
                                const description =
                                    typeof objective.description === "string"
                                        ? objective.description.trim()
                                        : "";
                                if (!description) {
                                    continue;
                                }
                                const optional = Boolean(objective.optional);
                                quest.addObjective(description, optional);
                                if (typeof objective.completed === "boolean") {
                                    quest.objectives[quest.objectives.length - 1].completed =
                                        objective.completed;
                                }
                            }
                        } catch (error) {
                            console.warn("Failed to add quest objective:", error.message);
                        }
                    }

                    const clientId = context?.stream?.clientId;
                    if (!clientId) {
                        throw new Error(
                            "Quest confirmation requires an active client connection.",
                        );
                    }

                    const questPreview = {
                        id: quest.id,
                        name: quest.name,
                        description: quest.description,
                        secretNotes: quest.secretNotes || "",
                        summary: questSummary,
                        giver: questOptions.giverName || questOptions.giver?.name || "",
                        rewardItems,
                        rewardCurrency,
                        rewardXp,
                        rewardFactionReputation: Events._toQuestFactionRewardPreviewEntries(
                            rewardFactionReputation,
                        ),
                        rewardNpcDispositions,
                        objectives: Array.isArray(quest.objectives)
                            ? quest.objectives
                                .map((entry) => ({
                                    description:
                                        typeof entry?.description === "string"
                                            ? entry.description
                                            : "",
                                    optional: Boolean(entry?.optional),
                                }))
                                .filter((item) => item.description)
                            : [],
                    };

                    const accepted = await confirmQuestWithPlayer({
                        clientId,
                        requestId: context?.stream?.requestId || null,
                        quest: questPreview,
                    });

                    if (!accepted) {
                        console.debug("[QuestDebug] Quest declined by player:", quest.name);
                        context.declinedQuests.push({
                            id: quest.id,
                            name: quest.name,
                            summary: questSummary,
                            giver: questOptions.giverName || questOptions.giver?.name || "",
                            accepted: false,
                        });
                        continue;
                    }

                    player.addQuest(quest);
                    context.questsAwarded.push({
                        id: quest.id,
                        name: quest.name,
                        summary: questSummary,
                        giver: questOptions.giverName || questOptions.giver?.name || "",
                        accepted: true,
                    });
                    console.debug(
                        "[QuestDebug] context after push:",
                        context.questsAwarded,
                    );

                    lastQuestCreated = quest;
                }

                if (lastQuestCreated) {
                    context.lastQuest = lastQuestCreated;
                }
            },
            completed_quest_objective: async function (entries = [], context = {}) {
                return Events.processQuestObjectiveCompletionEntries(entries, context);
            },
            currency: function (delta, context = {}) {
                if (!delta) {
                    return;
                }
                const player = context.player || this.currentPlayer;
                if (!player || typeof player.adjustCurrency !== "function") {
                    return;
                }
                if (!Array.isArray(context.currencyChanges)) {
                    context.currencyChanges = [];
                }
                const before =
                    typeof player.getCurrency === "function"
                        ? player.getCurrency()
                        : Number(player.currency) || 0;
                player.adjustCurrency(delta);
                const after =
                    typeof player.getCurrency === "function"
                        ? player.getCurrency()
                        : Number(player.currency) || 0;
                context.currencyChanges.push({ amount: delta, before, after });
            },
            time_passed: function (value, context = {}) {
                const amount = Number(value);
                if (!Number.isFinite(amount) || amount < 0 || !Number.isInteger(amount)) {
                    console.warn("Invalid time_passed value:", value);
                    console.trace();
                    return;
                }
                if (context.timeProgress && typeof context.timeProgress === "object") {
                    return;
                }
                if (context.isNpcTurn || context.suppressTimeAdvance || context.suppressTimePassedEvents) {
                    return;
                }

                const advancementAmount = amount === 0 ? 1 : amount;
                const advancement = Globals.advanceTime(advancementAmount, { source: "event_check" });
                context.timeProgress = advancement;
                applyTimeBasedNeedBarEffectsAfterTimeAdvance(context);
            },
            tracker_updates: function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }

                const appliedEntries = [];
                if (!Array.isArray(context.trackerUpdates)) {
                    context.trackerUpdates = [];
                }

                for (const entry of entries) {
                    try {
                        const trackerName = normalizeString(
                            entry?.trackerName || entry?.name || entry?.tracker,
                        );
                        if (!trackerName) {
                            throw new Error("tracker update target is required.");
                        }
                        const action = this._normalizeTrackerUpdateAction(entry?.action);
                        const entryType = this._normalizeTrackerUpdateType(entry?.type);
                        const worldMinute = this._getTrackerUpdateWorldMinute();
                        const reason = normalizeString(entry?.reason);

                        if (action === "add") {
                            const existing = Tracker.getAll().find(
                                (tracker) =>
                                    normalizeString(tracker?.name).toLowerCase() ===
                                    trackerName.toLowerCase(),
                            );
                            if (existing) {
                                throw new Error(`Tracker "${trackerName}" already exists.`);
                            }
                            if (!reason) {
                                throw new Error("tracker add requires a reason to use as its description.");
                            }
                            const newValue = this._normalizeTrackerUpdateValue(
                                entry?.newValue ?? entry?.value,
                                entryType,
                            );
                            const tracker = new Tracker({
                                name: trackerName,
                                type: entryType,
                                value: newValue,
                                hiddenFromPlayer: false,
                                lastUpdatedWorldMinute: worldMinute,
                                deriveCountdownUntilWorldMinute: entryType === "countdown",
                                description: reason,
                            });
                            const applied = {
                                action,
                                trackerId: tracker.id,
                                trackerName: tracker.name,
                                type: tracker.type,
                                previousValue: null,
                                newValue: tracker.value,
                                reason,
                            };
                            context.trackerUpdates.push(applied);
                            appliedEntries.push(applied);
                            continue;
                        }

                        const tracker = this._resolveTrackerUpdateTarget(trackerName);
                        if (entryType !== tracker.type) {
                            throw new Error(
                                `Tracker "${tracker.name}" is type ${tracker.type}, not ${entryType}.`,
                            );
                        }

                        if (action === "update") {
                            const previousValue = tracker.value;
                            const newValue = this._normalizeTrackerUpdateValue(
                                entry?.newValue ?? entry?.value,
                                tracker.type,
                            );
                            tracker.updateValue(newValue, { worldMinute });
                            const applied = {
                                action,
                                trackerId: tracker.id,
                                trackerName: tracker.name,
                                type: tracker.type,
                                previousValue,
                                newValue: tracker.value,
                                reason,
                            };
                            context.trackerUpdates.push(applied);
                            appliedEntries.push(applied);
                            continue;
                        }

                        if (action === "remove") {
                            const removed = Tracker.removeById(tracker.id);
                            if (!removed) {
                                throw new Error(`Tracker "${tracker.name || tracker.id}" disappeared before removal.`);
                            }
                            const applied = {
                                action,
                                trackerId: removed.id,
                                trackerName: removed.name,
                                type: removed.type,
                                previousValue: removed.value,
                                newValue: null,
                                reason,
                            };
                            context.trackerUpdates.push(applied);
                            appliedEntries.push(applied);
                        }
                    } catch (error) {
                        this._logTrackerUpdateEntryError(entry, error);
                    }
                }

                entries.length = 0;
                if (appliedEntries.length) {
                    entries.push(...appliedEntries);
                }
            },
            in_combat: function (flag, context = {}) {
                //console.log(`Processing in_combat event: ${JSON.stringify(flag)}`);
                const normalizedFlag = Array.isArray(flag)
                    ? flag[flag.length - 1]
                    : flag;
                //console.log(`Normalized in_combat flag: ${JSON.stringify(normalizedFlag)}`);
                //console.log(`Boolean value: ${Boolean(normalizedFlag)}`);
                Globals.setInCombat(Boolean(normalizedFlag));
                context.inCombat = Globals.inCombat;
            },
            item_to_npc: async function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const {
                    findThingByName,
                    ensureNpcByName,
                    Location,
                    findRegionByLocationId,
                } = this._deps;
                if (
                    typeof ensureNpcByName !== "function" ||
                    typeof findThingByName !== "function"
                ) {
                    throw new Error(
                        "item_to_npc handler requires ensureNpcByName and findThingByName dependencies.",
                    );
                }

                const resolveLocation = (candidate) => {
                    if (!candidate || !Location || typeof Location.get !== "function") {
                        return null;
                    }
                    try {
                        return Location.get(candidate) || null;
                    } catch (_) {
                        return null;
                    }
                };

                const player = context.player || this.currentPlayer;
                await this._applyIndependentEventEntries("item_to_npc", entries, async (entry) => {
                    const itemName = normalizeString(entry.item);
                    const npcName = normalizeString(entry.npc);
                    if (!npcName) {
                        return;
                    }
                    const item = itemName ? findThingByName(itemName) : null;
                    if (!item) {
                        throw new Error(
                            `item_to_npc could not find item "${itemName || "<unknown>"}"`,
                        );
                    }

                    let location = context.location || null;
                    if (!location && item.metadata?.locationId) {
                        location = resolveLocation(item.metadata.locationId);
                    }
                    if (!location && player?.currentLocation) {
                        location = resolveLocation(player.currentLocation);
                    }
                    if (!location) {
                        throw new Error(
                            `item_to_npc could not resolve location for "${npcName}" transformation.`,
                        );
                    }

                    const transformationContext = { ...context, location };
                    if (
                        !transformationContext.region &&
                        typeof findRegionByLocationId === "function"
                    ) {
                        try {
                            transformationContext.region =
                                findRegionByLocationId(location.id) || null;
                        } catch (_) {
                            transformationContext.region = null;
                        }
                    }

                    this._detachThingFromWorld(item);
                    if (itemName) {
                        this.animatedItems.add(itemName);
                        this.destroyedItems.add(itemName);
                    }
                    const npc = await ensureNpcByName(npcName, transformationContext);
                    if (!npc) {
                        throw new Error(
                            `item_to_npc failed to create NPC "${npcName}"`,
                        );
                    }
                    const finalNpcName = normalizeString(npc.name);
                    if (!finalNpcName) {
                        throw new Error(
                            `item_to_npc created NPC "${npcName}" but the actor has no final name.`,
                        );
                    }
                    if (finalNpcName !== npcName) {
                        entry.originalNpc = npcName;
                        entry.npc = finalNpcName;
                    }
                    this.newCharacters.add(finalNpcName);
                    this.arrivedCharacters.add(finalNpcName);
                });
            },
            consume_item: function (items = [], context = {}) {
                if (!Array.isArray(items) || !items.length) {
                    return;
                }
                const { findThingByName } = this._deps;
                if (typeof findThingByName !== "function") {
                    throw new Error(
                        "consume_item handler requires findThingByName dependency.",
                    );
                }

                const failures = [];
                for (const entry of items) {
                    try {
                        const itemName =
                            typeof entry === "string"
                                ? entry.trim()
                                : entry && entry.item
                                    ? String(entry.item).trim()
                                    : "";
                        if (!itemName) {
                            continue;
                        }
                        const quantity = parseRequiredEventQuantity(entry?.quantity, {
                            eventKey: "consume_item",
                            entryText: JSON.stringify(entry),
                        });
                        const item = findThingByName(itemName);
                        if (!item) {
                            console.debug(
                                `[consume_item] Unable to locate item "${itemName}" for consumption.`,
                            );
                            continue;
                        } else {
                            console.debug(`[consume_item] Consuming ${quantity} of "${itemName}".`);
                        }

                        const candidates = this._findThingsByExactName(itemName, {
                            preferredThing: item,
                            location: context.location || null,
                        });
                        let remaining = quantity;
                        for (const candidate of candidates) {
                            if (remaining <= 0) {
                                break;
                            }
                            const candidateCount = this._getThingCount(candidate);
                            const amountToConsume = Math.min(candidateCount, remaining);
                            const result = this._consumeThingQuantity(candidate, amountToConsume, {
                                location: context.location || null,
                            });
                            if (result.decremented) {
                                console.debug(
                                    `[consume_item] Decremented "${itemName}" from ${result.priorCount} to ${result.remainingCount}.`,
                                );
                            } else {
                                console.debug(`[consume_item] Fully removed "${itemName}" from the world.`);
                            }
                            remaining -= amountToConsume;
                        }

                        if (remaining > 0) {
                            throw new Error(
                                `consume_item could not satisfy quantity ${quantity} for "${itemName}". ${remaining} still missing.`,
                            );
                        }
                        this.destroyedItems.add(itemName);
                    } catch (error) {
                        failures.push({ entry, error });
                    }
                }
                this._warnEventEntryFailures("consume_item", failures);
            },
            item_inflict: async function (entries = [], context = {}) {
                await applyItemTriggeredStatuses(this, entries, context, {
                    eventLabel: "item_inflict",
                    skipPairKeys: context.itemIngestPairKeys,
                    requireStatusField: true,
                });
            },
            item_ingest: async function (entries = [], context = {}) {
                await applyItemTriggeredStatuses(this, entries, context, {
                    eventLabel: "item_ingest",
                    requireStatusField: false,
                });
            },
            alter_item: async function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }

                const { findThingByName, alterThingByPrompt, findActorById, Location } =
                    this._deps;
                if (typeof findThingByName !== "function") {
                    throw new Error(
                        "alter_item handler requires findThingByName dependency.",
                    );
                }

                if (typeof alterThingByPrompt !== "function") {
                    throw new Error(
                        "alter_item handler requires alterThingByPrompt dependency.",
                    );
                }

                await this._applyIndependentEventEntries("alter_item", entries, async (entry) => {
                    if (!entry) {
                        return;
                    }

                    const originalName = entry.originalName || entry.from || null;
                    const targetName = entry.newName || entry.to || null;
                    const changeDescription =
                        entry.changeDescription || entry.description || null;

                    const normalizedTargetName =
                        typeof targetName === "string"
                            ? targetName.trim().toLowerCase()
                            : "";
                    if (
                        normalizedTargetName === "consumed" ||
                        normalizedTargetName === "n/a"
                    ) {
                        return;
                    }

                    const lookupCandidates = [originalName, targetName].filter(
                        (candidate) => typeof candidate === "string" && candidate.trim(),
                    );

                    let thing = null;
                    for (const candidate of lookupCandidates) {
                        thing = findThingByName(candidate);
                        if (thing) {
                            break;
                        }
                    }

                    if (!thing) {
                        thing = await this._createPlaceholderThingForAlter(entry, context);
                    }

                    if (!thing) {
                        return;
                    }

                    let thingToAlter = thing;
                    let partialSplitRollback = null;
                    let ownerCandidate = null;

                    const metadataOwnerId = thingToAlter.metadata?.ownerId;
                    if (metadataOwnerId && typeof findActorById === "function") {
                        try {
                            const found = findActorById(metadataOwnerId);
                            if (found) {
                                ownerCandidate = found;
                            }
                        } catch (_) {
                            ownerCandidate = null;
                        }
                    }

                    if (
                        !ownerCandidate &&
                        typeof thingToAlter.whoseInventory === "function"
                    ) {
                        try {
                            const owners = thingToAlter.whoseInventory() || [];
                            if (Array.isArray(owners) && owners.length > 0) {
                                ownerCandidate = owners[0] || null;
                            }
                        } catch (_) {
                            ownerCandidate = null;
                        }
                    }

                    const containerCandidate =
                        this._resolveContainingThing(thingToAlter);

                    let locationCandidate = null;
                    const metadataLocationId = thingToAlter.metadata?.locationId;
                    if (
                        metadataLocationId &&
                        Location &&
                        typeof Location.get === "function"
                    ) {
                        try {
                            locationCandidate =
                                Location.get(metadataLocationId) || null;
                        } catch (_) {
                            locationCandidate = null;
                        }
                    }
                    if (!locationCandidate) {
                        locationCandidate = context.location || null;
                    }
                    if (
                        !locationCandidate &&
                        ownerCandidate?.currentLocation &&
                        Location &&
                        typeof Location.get === "function"
                    ) {
                        try {
                            locationCandidate =
                                Location.get(ownerCandidate.currentLocation) || null;
                        } catch (_) {
                            locationCandidate = null;
                        }
                    }

                    const sourceCount = this._getThingCount(thingToAlter);
                    const quantityIsAll =
                        typeof entry.quantity === "string" &&
                        entry.quantity.trim().toLowerCase() === "all";
                    const requestedQuantity =
                        quantityIsAll
                            ? sourceCount
                            : parseRequiredEventQuantity(entry?.quantity, {
                                eventKey: "alter_item",
                                entryText: JSON.stringify(entry),
                            });
                    if (requestedQuantity > sourceCount) {
                        throw new Error(
                            `alter_item requested ${requestedQuantity} of "${thingToAlter.name}", but the stack only contains ${sourceCount}.`,
                        );
                    }

                    if (requestedQuantity < sourceCount) {
                        const sourceThing = thingToAlter;
                        const originalSourceCount = sourceCount;
                        const originalSourceMetadata =
                            sourceThing.metadata && typeof sourceThing.metadata === "object"
                                ? { ...sourceThing.metadata }
                                : {};
                        let splitThing = null;
                        try {
                            splitThing = this._splitThingForQuantity(
                                sourceThing,
                                requestedQuantity,
                            );
                            this._placeSplitThingWithSourceContext(splitThing, {
                                owner: ownerCandidate,
                                container: containerCandidate,
                                location: locationCandidate,
                            });
                            partialSplitRollback = () => {
                                sourceThing.count = originalSourceCount;
                                sourceThing.metadata = {
                                    ...originalSourceMetadata,
                                    count: originalSourceCount,
                                };
                                if (this.things instanceof Map) {
                                    this.things.delete(splitThing.id);
                                }
                                if (typeof splitThing.delete === "function") {
                                    splitThing.delete();
                                } else {
                                    splitThing.removeFromWorld?.();
                                }
                            };
                            thingToAlter = splitThing;
                        } catch (error) {
                            sourceThing.count = originalSourceCount;
                            sourceThing.metadata = {
                                ...originalSourceMetadata,
                                count: originalSourceCount,
                            };
                            if (splitThing) {
                                if (this.things instanceof Map) {
                                    this.things.delete(splitThing.id);
                                }
                                if (typeof splitThing.delete === "function") {
                                    try {
                                        splitThing.delete();
                                    } catch (_) {
                                        splitThing.removeFromWorld?.();
                                    }
                                } else {
                                    splitThing.removeFromWorld?.();
                                }
                            }
                            throw error;
                        }
                    }

                    let outcome = null;
                    try {
                        outcome = await alterThingByPrompt({
                            thing: thingToAlter,
                            changeDescription,
                            newName: targetName,
                            location: locationCandidate || Globals.location,
                            owner:
                                ownerCandidate ||
                                context.player ||
                                this.currentPlayer ||
                                null,
                        });
                    } catch (error) {
                        if (typeof partialSplitRollback === "function") {
                            partialSplitRollback();
                        }
                        throw error;
                    }

                    if (outcome?.originalName) {
                        this.alteredItems.add(outcome.originalName);
                    }
                    if (outcome?.newName) {
                        this.alteredItems.add(outcome.newName);
                    }

                    entry.originalName =
                        outcome?.originalName || originalName || null;
                    entry.newName = outcome?.newName || targetName || null;
                    entry.changeDescription =
                        outcome?.changeDescription || changeDescription || null;
                    entry.description = entry.changeDescription;
                    entry.from = entry.originalName;
                    entry.to = entry.newName;

                    if (outcome?.thing?.thingType === "scenery") {
                        thingToAlter.drop();
                    }
                });
            },
            transfer_item: async function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const { findActorByName, generateItemsByNames } = this._deps;
                if (typeof findActorByName !== "function") {
                    throw new Error(
                        "transfer_item handler requires findActorByName dependency.",
                    );
                }

                const mergeCandidates = (...candidateGroups) => {
                    const seen = new Set();
                    const merged = [];
                    candidateGroups.flat().forEach((thing) => {
                        if (!thing) {
                            return;
                        }
                        const key = thing.id || thing;
                        if (seen.has(key)) {
                            return;
                        }
                        seen.add(key);
                        merged.push(thing);
                    });
                    return merged;
                };
                const getAvailableQuantity = (candidates = []) => candidates.reduce(
                    (total, candidate) => total + this._getThingCount(candidate),
                    0,
                );
                const markReceiverOwnership = (thing, receiverActor) => {
                    const metadata = { ...(thing.metadata || {}) };
                    if (receiverActor?.id) {
                        metadata.ownerId = receiverActor.id;
                    }
                    delete metadata.ownerID;
                    delete metadata.owner_id;
                    delete metadata.inventoryOwnerId;
                    delete metadata.barterOwnerId;
                    delete metadata.containerId;
                    delete metadata.containerID;
                    delete metadata.container_id;
                    delete metadata.locationId;
                    delete metadata.locationID;
                    delete metadata.location_id;
                    thing.metadata = metadata;
                };

                await this._applyIndependentEventEntries("transfer_item", entries, async (entry) => {
                    const giver = entry.giver ? findActorByName(entry.giver) : null;
                    const receiver = entry.receiver
                        ? findActorByName(entry.receiver)
                        : null;
                    const quantity = parseRequiredEventQuantity(entry?.quantity, {
                        eventKey: "transfer_item",
                        entryText: JSON.stringify(entry),
                    });

                    if (!giver || typeof giver.removeInventoryItem !== "function") {
                        console.warn("transfer_item: No valid giver found.", entry);
                        return;
                    }
                    if (!receiver || typeof receiver.addInventoryItem !== "function") {
                        console.warn("transfer_item: No valid receiver found.", entry);
                        return;
                    }

                    const originalItemName = entry.item;
                    let candidates = this._findThingsByExactName(originalItemName, {
                        owner: giver,
                    });
                    let availableQuantity = getAvailableQuantity(candidates);
                    if (availableQuantity < quantity && context.location) {
                        const locationCandidates = this._findThingsByExactName(
                            originalItemName,
                            {
                                location: context.location,
                                unownedOnly: true,
                            },
                        );
                        candidates = mergeCandidates(candidates, locationCandidates);
                        availableQuantity = getAvailableQuantity(candidates);
                    }

                    if (availableQuantity < quantity) {
                        if (typeof generateItemsByNames !== "function") {
                            throw new Error(
                                "transfer_item handler requires generateItemsByNames dependency to create missing transferred items.",
                            );
                        }
                        const shortfall = quantity - availableQuantity;
                        const generatedItems = await generateItemsByNames({
                            itemNames: [originalItemName],
                            owner: giver,
                        });
                        const generatedThing = Array.isArray(generatedItems)
                            ? generatedItems.find((candidate) => candidate?.name === originalItemName) || generatedItems[0] || null
                            : null;
                        if (!generatedThing) {
                            throw new Error(
                                `Unable to generate item "${originalItemName}" for transfer_item.`,
                            );
                        }
                        const finalItemName = this._getGeneratedThingFinalName(
                            generatedThing,
                            {
                                requestedName: originalItemName,
                                eventKey: "transfer_item",
                            },
                        );
                        if (finalItemName !== originalItemName) {
                            entry.originalItem = entry.item;
                            entry.item = finalItemName;
                        }
                        generatedThing.count = shortfall;
                        const generatedCandidates = this._findThingsByExactName(
                            finalItemName,
                            {
                                owner: giver,
                                preferredThing: generatedThing,
                            },
                        );
                        candidates = mergeCandidates(
                            candidates,
                            generatedCandidates,
                            [generatedThing],
                        );
                    }

                    const selectedThings = this._extractThingQuantityFromCandidates(
                        candidates,
                        quantity,
                        { itemName: entry.item, eventKey: "transfer_item" },
                    );
                    selectedThings.forEach((thing) => {
                        giver.removeInventoryItem(thing, { suppressNpcEquip: true });
                        const added = receiver.addInventoryItem(thing, {
                            suppressNpcEquip: true,
                        });
                        if (added === false) {
                            throw new Error(
                                `transfer_item could not add "${thing?.name || entry.item}" to "${receiver.name || entry.receiver}".`,
                            );
                        }
                        markReceiverOwnership(thing, receiver);
                    });
                    if (entry.item) {
                        this.obtainedItems.add(entry.item);
                    }
                });
            },
            harvest_gather: async function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const { findActorByName, generateItemsByNames } = this._deps;
                if (typeof generateItemsByNames !== "function") {
                    throw new Error(
                        "harvest_gather handler requires generateItemsByNames dependency.",
                    );
                }

                const generationTasks = [];
                for (const entry of entries) {
                    const actor = entry.harvester
                        ? findActorByName?.(entry.harvester)
                        : null;
                    if (
                        actor &&
                        typeof actor.addInventoryItem === "function" &&
                        entry.item
                    ) {
                        generationTasks.push(
                            (async () => {
                                const originalItemName = entry.item;
                                const generatedItems = await generateItemsByNames({
                                    itemNames: [originalItemName],
                                    owner: actor,
                                });
                                const generatedThing = Array.isArray(generatedItems)
                                    ? generatedItems.find((candidate) => candidate?.name === originalItemName) || generatedItems[0] || null
                                    : null;
                                if (!generatedThing) {
                                    throw new Error(
                                        `Failed to generate harvested item "${originalItemName}".`,
                                    );
                                }
                                const finalItemName = this._getGeneratedThingFinalName(
                                    generatedThing,
                                    {
                                        requestedName: originalItemName,
                                        eventKey: "harvest_gather",
                                    },
                                );
                                if (finalItemName !== originalItemName) {
                                    entry.originalItem = originalItemName;
                                    entry.item = finalItemName;
                                }
                                generatedThing.count = entry.quantity;
                                this.obtainedItems.add(finalItemName);
                                return generatedItems;
                            })().catch((error) => {
                                console.warn(
                                    "Failed to generate harvested item:",
                                    error.message,
                                );
                                return [];
                            }),
                        );
                    }
                    if (entry.item) {
                        this.obtainedItems.add(entry.item);
                    }
                }

                if (generationTasks.length) {
                    await Promise.all(generationTasks);
                }
            },
            pick_up_item: async function (entries = [], context = {}) {
                console.log("Processing pick_up_item event with entries:", entries);
                if (!Array.isArray(entries) || !entries.length) {
                    //console.warn('pick_up_item event has no valid entries:', entries);
                    //console.trace();
                    return;
                }

                const { findThingByName, findActorByName, things } = this._deps;

                const resolveAvailableThing = (itemName) => {
                    const normalized =
                        typeof itemName === "string" ? itemName.trim().toLowerCase() : "";
                    if (!normalized) {
                        return null;
                    }

                    if (things instanceof Map) {
                        for (const candidate of things.values()) {
                            if (
                                !candidate?.name ||
                                candidate.name.trim().toLowerCase() !== normalized
                            ) {
                                continue;
                            }
                            const owners =
                                typeof candidate.whoseInventory === "function"
                                    ? candidate.whoseInventory()
                                    : [];
                            if (owners.length > 0) {
                                continue;
                            }
                            return candidate;
                        }
                    }

                    if (typeof findThingByName === "function") {
                        const candidate = findThingByName(itemName);
                        const owners =
                            typeof candidate?.whoseInventory === "function"
                                ? candidate.whoseInventory()
                                : [];
                        if (candidate && owners.length === 0) {
                            return candidate;
                        }
                    }

                    console.log(
                        "pick_up_item event could not resolve available item:",
                        itemName,
                    );

                    return null;
                };

                const seenPickupEntries = new Set();
                const buildPickupEntryKey = (entry, quantity) => {
                    const actorKey = typeof entry?.name === "string"
                        ? entry.name.trim().toLowerCase()
                        : "";
                    const itemKey = typeof entry?.item === "string"
                        ? entry.item.trim().toLowerCase()
                        : "";
                    return `${actorKey}\u0000${itemKey}\u0000${quantity}`;
                };

                await this._applyIndependentEventEntries("pick_up_item", entries, async (entry) => {
                    if (!entry) {
                        console.warn("pick_up_item event entry is invalid:", entry);
                        console.trace();
                        return;
                    }

                    const itemName =
                        typeof entry.item === "string" ? entry.item.trim() : "";
                    if (!itemName) {
                        console.warn(
                            "pick_up_item event entry has no valid item name:",
                            entry,
                        );
                        console.trace();
                        return;
                    }
                    const quantity = parseRequiredEventQuantity(entry?.quantity, {
                        eventKey: "pick_up_item",
                        entryText: JSON.stringify(entry),
                    });

                    const pickupEntryKey = buildPickupEntryKey(entry, quantity);
                    if (seenPickupEntries.has(pickupEntryKey)) {
                        console.warn(
                            "pick_up_item event entry is an exact duplicate:",
                            entry,
                        );
                        return;
                    }
                    seenPickupEntries.add(pickupEntryKey);

                    const actor =
                        typeof findActorByName === "function"
                            ? findActorByName(entry.name)
                            : null;
                    if (!actor || typeof actor.addInventoryItem !== "function") {
                        console.warn(
                            "pick_up_item event could not find valid actor for entry:",
                            entry,
                        );
                        console.trace();
                        return;
                    }

                    let availableThings = this._findThingsByExactName(itemName, {
                        location: context.location || null,
                        unownedOnly: true,
                        preferredThing: resolveAvailableThing(itemName),
                    });

                    const availableQuantity = availableThings.reduce(
                        (total, candidate) => total + this._getThingCount(candidate),
                        0,
                    );
                    if (availableQuantity < quantity) {
                        const existingAvailableThings = availableThings.slice();
                        const generatedItems = await this._generateItemsIntoWorld(
                            [itemName],
                            context.location,
                        );
                        const generatedThing = Array.isArray(generatedItems)
                            ? generatedItems.find((candidate) => candidate?.name === itemName) || generatedItems[0] || null
                            : null;
                        if (!generatedThing) {
                            throw new Error(
                                `Unable to generate item "${itemName}" for pick_up_item.`,
                            );
                        }
                        const finalItemName = this._getGeneratedThingFinalName(
                            generatedThing,
                            {
                                requestedName: itemName,
                                eventKey: "pick_up_item",
                            },
                        );
                        if (finalItemName !== itemName) {
                            entry.originalItem = entry.item;
                            entry.item = finalItemName;
                        }
                        const shortfall = quantity - availableQuantity;
                        generatedThing.count = shortfall;
                        const generatedAvailableThings = this._findThingsByExactName(finalItemName, {
                            location: context.location || null,
                            unownedOnly: true,
                            preferredThing: generatedThing,
                        });
                        availableThings = finalItemName === itemName
                            ? generatedAvailableThings
                            : [...existingAvailableThings, ...generatedAvailableThings];
                    }

                    const selectedThings = this._extractThingQuantityFromCandidates(
                        availableThings,
                        quantity,
                        { itemName: entry.item, eventKey: "pick_up_item" },
                    );
                    selectedThings.forEach((thing) => {
                        actor.addInventoryItem(thing);
                        thing.metadata = { ...(thing.metadata || {}), ownerId: actor.id };
                    });
                    this.obtainedItems.add(entry.item);
                });
            },
            put_item_in_container: function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }

                const { findActorByName } = this._deps;

                const resolveActor = (name) => {
                    const actorName = normalizeOptionalEventActorName(name);
                    if (!actorName) {
                        return null;
                    }
                    if (typeof findActorByName !== "function") {
                        throw new Error(
                            "put_item_in_container handler requires findActorByName dependency when character is specified.",
                        );
                    }
                    const actor = findActorByName(actorName);
                    if (!actor || typeof actor.addInventoryItem !== "function") {
                        throw new Error(
                            `put_item_in_container could not find actor "${actorName}".`,
                        );
                    }
                    return actor;
                };

                const failures = [];
                for (const entry of entries) {
                    try {
                        if (!entry) {
                            continue;
                        }
                        const itemName = normalizeString(entry.item);
                        const containerName = normalizeString(entry.containerName || entry.container);
                        if (!itemName || !containerName) {
                            continue;
                        }
                        const quantity = parseRequiredEventQuantity(entry?.quantity, {
                            eventKey: "put_item_in_container",
                            entryText: JSON.stringify(entry),
                        });
                        const actor = resolveActor(entry.character);
                        const container = this._resolveContainerByExactName(containerName, {
                            actor,
                            location: context.location || null,
                            eventKey: "put_item_in_container",
                        });
                        if (typeof container.addInventoryItem !== "function") {
                            throw new Error(
                                `put_item_in_container resolved "${containerName}" but it cannot hold inventory.`,
                            );
                        }

                        let candidates;
                        if (actor) {
                            candidates = this._findThingsByExactName(itemName, { owner: actor });
                        } else {
                            if (!context.location) {
                                throw new Error(
                                    `put_item_in_container requires a location when no actor is specified for "${itemName}".`,
                                );
                            }
                            candidates = this._findThingsByExactName(itemName, {
                                location: context.location,
                                unownedOnly: true,
                            });
                        }

                        const selectedThings = this._extractThingQuantityFromCandidates(
                            candidates,
                            quantity,
                            { itemName, eventKey: "put_item_in_container" },
                        );
                        selectedThings.forEach((thing) => {
                            container.addInventoryItem(thing);
                        });

                        entry.character = actor?.name || null;
                        entry.containerName = container.name || containerName;
                    } catch (error) {
                        failures.push({ entry, error });
                    }
                }
                this._warnEventEntryFailures("put_item_in_container", failures);
            },
            remove_item_from_container: async function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }

                const { findActorByName } = this._deps;

                const resolveActor = (name) => {
                    const actorName = normalizeOptionalEventActorName(name);
                    if (!actorName) {
                        return null;
                    }
                    if (typeof findActorByName !== "function") {
                        throw new Error(
                            "remove_item_from_container handler requires findActorByName dependency when character is specified.",
                        );
                    }
                    const actor = findActorByName(actorName);
                    if (!actor || typeof actor.addInventoryItem !== "function") {
                        throw new Error(
                            `remove_item_from_container could not find actor "${actorName}".`,
                        );
                    }
                    return actor;
                };

                await this._applyIndependentEventEntries("remove_item_from_container", entries, async (entry) => {
                    if (!entry) {
                        return;
                    }
                    let itemName = normalizeString(entry.item);
                    const containerName = normalizeString(entry.containerName || entry.container);
                    if (!itemName || !containerName) {
                        return;
                    }
                    const quantity = parseRequiredEventQuantity(entry?.quantity, {
                        eventKey: "remove_item_from_container",
                        entryText: JSON.stringify(entry),
                    });
                    const actor = resolveActor(entry.character);
                    const container = this._resolveContainerByExactName(containerName, {
                        actor,
                        location: context.location || null,
                        eventKey: "remove_item_from_container",
                    });
                    if (typeof container.getInventoryItems !== "function") {
                        throw new Error(
                            `remove_item_from_container resolved "${containerName}" but it cannot list inventory.`,
                        );
                    }
                    let candidates = typeof container.getInventoryItems === "function"
                        ? container.getInventoryItems().filter((thing) => (
                            thing?.name &&
                            thing.name.trim().toLowerCase() === itemName.toLowerCase()
                        ))
                        : [];
                    const availableQuantity = candidates.reduce(
                        (total, thing) => total + this._getThingCount(thing),
                        0,
                    );
                    if (availableQuantity < quantity) {
                        const shortfall = quantity - availableQuantity;
                        const generatedItems = await this._generateItemsIntoWorld(
                            [itemName],
                            context.location || null,
                        );
                        const generatedThing = Array.isArray(generatedItems)
                            ? generatedItems.find((candidate) => candidate?.name === itemName) || generatedItems[0] || null
                            : null;
                        if (!generatedThing) {
                            throw new Error(
                                `Unable to generate item "${itemName}" for remove_item_from_container.`,
                            );
                        }
                        const finalItemName = this._getGeneratedThingFinalName(
                            generatedThing,
                            {
                                requestedName: itemName,
                                eventKey: "remove_item_from_container",
                            },
                        );
                        if (finalItemName !== itemName) {
                            entry.originalItem = entry.item;
                            entry.item = finalItemName;
                            itemName = finalItemName;
                        }
                        generatedThing.count = shortfall;
                        container.addInventoryItem(generatedThing);
                        candidates = [...candidates, generatedThing].filter((thing, index, list) => (
                            thing && list.findIndex((candidate) => candidate?.id === thing.id) === index
                        ));
                    }
                    const selectedThings = this._extractThingQuantityFromCandidates(
                        candidates,
                        quantity,
                        { itemName, eventKey: "remove_item_from_container" },
                    );

                    selectedThings.forEach((thing) => {
                        if (actor) {
                            const added = actor.addInventoryItem(thing, {
                                suppressNpcEquip: true,
                            });
                            if (added === false) {
                                throw new Error(
                                    `remove_item_from_container could not add "${thing?.name || itemName}" to "${actor.name || entry.character}".`,
                                );
                            }
                        } else {
                            if (!context.location || typeof context.location.addThingId !== "function") {
                                throw new Error(
                                    `remove_item_from_container requires a valid location when no actor is specified for "${itemName}".`,
                                );
                            }
                            context.location.addThingId(thing.id);
                        }
                    });

                    entry.character = actor?.name || null;
                    entry.containerName = container.name || containerName;
                });
            },
            drop_item: function (entries = [], context = {}) {
                const location = context.location;
                if (!entries.length) {
                    return;
                }
                if (!location) {
                    throw new Error("drop_item events require a valid location.");
                }
                const { findActorByName } = this._deps;
                const failures = [];
                for (const entry of entries) {
                    try {
                        const quantity = parseRequiredEventQuantity(entry?.quantity, {
                            eventKey: "drop_item",
                            entryText: JSON.stringify(entry),
                        });
                        const actor =
                            typeof findActorByName === "function"
                                ? findActorByName(entry.name)
                                : null;
                        if (!actor || typeof actor.hasInventoryItem !== "function") {
                            continue;
                        }
                        const candidates = this._findThingsByExactName(entry.item, {
                            owner: actor,
                        });
                        const selectedThings = this._extractThingQuantityFromCandidates(
                            candidates,
                            quantity,
                            { itemName: entry.item, eventKey: "drop_item" },
                        );
                        selectedThings.forEach((thing) => {
                            location.addThingId(thing.id);
                        });
                        entry.character = actor.name;
                        this.droppedItems.add(entry.item);
                    } catch (error) {
                        failures.push({ entry, error });
                    }
                }
                this._warnEventEntryFailures("drop_item", failures);
            },
            item_appear: async function (items = [], context = {}) {
                if (!Array.isArray(items) || !items.length) {
                    return;
                }

                if (Globals.processedMove && !context.allowMoveTurnAppearances && !context.isNpcTurn) {
                    // If we just processed a move, skip generating new items, as the location generator handles this
                    return;
                }
                const sceneItemNames = this._buildSceneItemNameSet(
                    context.location,
                    "item_appear",
                );
                const failures = [];
                const filteredItems = [];
                for (const entry of items) {
                    try {
                        const name = typeof entry?.name === "string" ? entry.name.trim() : "";
                        if (!name || this._isItemAlreadyTracked(name)) {
                            continue;
                        }
                        if (sceneItemNames.has(name)) {
                            const quantity = parseRequiredEventQuantity(entry?.quantity, {
                                eventKey: "item_appear",
                                entryText: JSON.stringify(entry),
                            });
                            const existingThing = this._findSceneThingByExactName(
                                context.location,
                                name,
                                "item_appear",
                            );
                            if (existingThing) {
                                this._addQuantityToSceneThingStack(existingThing, quantity);
                                this._trackGeneratedItemNames(name, name);
                            }
                            continue;
                        }
                        filteredItems.push(entry);
                    } catch (error) {
                        failures.push({ entry, error });
                    }
                }

                if (!filteredItems.length) {
                    this._warnEventEntryFailures("item_appear", failures);
                    return;
                }

                const { generateItemsByNames } = this._deps;
                if (typeof generateItemsByNames !== "function") {
                    throw new Error(
                        "item_appear handler requires generateItemsByNames dependency.",
                    );
                }

                for (const entry of filteredItems) {
                    try {
                        const originalName = entry.name;
                        const generatedItems = await generateItemsByNames({
                            itemNames: [originalName],
                            location: context.location || null,
                            seeds: [{
                                name: originalName,
                                description: entry.description || undefined,
                            }],
                        });
                        const generatedThing = Array.isArray(generatedItems)
                            ? generatedItems.find((candidate) => candidate?.name === originalName) || generatedItems[0] || null
                            : null;
                        if (!generatedThing) {
                            throw new Error(
                                `item_appear failed to generate "${originalName}".`,
                            );
                        }
                        const finalName = this._getGeneratedThingFinalName(
                            generatedThing,
                            {
                                requestedName: originalName,
                                eventKey: "item_appear",
                            },
                        );
                        if (finalName !== originalName) {
                            entry.originalName = originalName;
                            entry.name = finalName;
                        }
                        generatedThing.count = entry.quantity;
                        this._trackGeneratedItemNames(originalName, finalName);
                    } catch (error) {
                        failures.push({ entry, error });
                    }
                }
                this._warnEventEntryFailures("item_appear", failures);
            },
            scenery_appear: async function (items = [], context = {}) {
                if (!Array.isArray(items) || !items.length) {
                    return;
                }

                if (Globals.processedMove && !context.allowMoveTurnAppearances && !context.isNpcTurn) {
                    // If we just processed a move, skip generating new scenery, as the location generator handles this
                    return;
                }

                // Filter out all items that are in newItems
                const sceneItemNames = this._buildSceneItemNameSet(
                    context.location,
                    "scenery_appear",
                );
                const filteredItems = items
                    .map((item, index) => ({
                        index,
                        name: typeof item === "string" ? item.trim() : "",
                    }))
                    .filter(
                        (item) =>
                            !!item.name &&
                            !this.alteredItems.has(item.name) &&
                            !this._isItemAlreadyTracked(item.name) &&
                            !sceneItemNames.has(item.name),
                    );

                for (const item of filteredItems) {
                    try {
                        const generatedItems = await this._generateItemsIntoWorld(
                            [item.name],
                            context.location,
                            { treatAsScenery: true },
                        );
                        const generatedThing = Array.isArray(generatedItems)
                            ? generatedItems.find((candidate) => candidate?.name === item.name) || generatedItems[0] || null
                            : null;
                        if (!generatedThing) {
                            throw new Error(`scenery_appear failed to generate "${item.name}".`);
                        }
                        const finalName = this._getGeneratedThingFinalName(
                            generatedThing,
                            {
                                requestedName: item.name,
                                eventKey: "scenery_appear",
                            },
                        );
                        if (finalName !== item.name) {
                            items[item.index] = finalName;
                        }
                        this._trackGeneratedItemNames(item.name, finalName);
                    } catch (error) {
                        console.warn("Failed to generate scenery item:", error.message);
                    }
                }
            },
            harvestable_resource_appear: async function (items = [], context = {}) {
                if (!Array.isArray(items) || !items.length) {
                    return;
                }

                const sceneItemNames = this._buildSceneItemNameSet(
                    context.location,
                    "harvestable_resource_appear",
                );
                const filteredItems = items
                    .map((item, index) => ({
                        index,
                        name: typeof item === "string" ? item.trim() : "",
                    }))
                    .filter(
                        (item) =>
                            !!item.name &&
                            !this._isItemAlreadyTracked(item.name) &&
                            !sceneItemNames.has(item.name),
                    );

                if (!filteredItems.length) {
                    return;
                }

                for (const item of filteredItems) {
                    try {
                        const generatedItems = await this._generateItemsIntoWorld(
                            [item.name],
                            context.location,
                            { treatAsResource: true },
                        );
                        const generatedThing = Array.isArray(generatedItems)
                            ? generatedItems.find((candidate) => candidate?.name === item.name) || generatedItems[0] || null
                            : null;
                        if (!generatedThing) {
                            throw new Error(
                                `harvestable_resource_appear failed to generate "${item.name}".`,
                            );
                        }
                        const finalName = this._getGeneratedThingFinalName(
                            generatedThing,
                            {
                                requestedName: item.name,
                                eventKey: "harvestable_resource_appear",
                            },
                        );
                        if (finalName !== item.name) {
                            items[item.index] = finalName;
                        }
                        this._trackGeneratedItemNames(item.name, finalName);
                    } catch (error) {
                        console.warn(
                            "Failed to generate harvestable resource:",
                            error.message,
                        );
                    }
                }
            },
            alter_npc: async function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                await this._handleAlterNpcEvents(entries, context);
            },
            thing_arrival_departure: async function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }

                const {
                    findThingByName,
                    findLocationByNameLoose,
                    findRegionByNameLoose,
                    createLocationFromEvent,
                    createRegionStubFromEvent,
                    Location,
                    regions,
                    gameLocations,
                    pendingRegionStubs,
                } = this._deps;

                if (typeof findThingByName !== "function") {
                    throw new Error(
                        "thing_arrival_departure handler requires findThingByName dependency.",
                    );
                }

                const currentLocation = context.location || null;
                if (!currentLocation || typeof currentLocation.id !== "string") {
                    throw new Error(
                        "thing_arrival_departure events require a valid current location.",
                    );
                }

                const normalize = (value) =>
                    typeof value === "string" ? value.trim() : "";
                const currentLocationId = currentLocation.id.trim();

                const getRegionId = (region) => {
                    const candidates = [
                        region?.id,
                        region?.targetRegionId,
                        region?.regionId,
                        region?.stubMetadata?.targetRegionId,
                        region?.stubMetadata?.regionId,
                    ];
                    for (const candidate of candidates) {
                        const trimmed =
                            typeof candidate === "string" ? candidate.trim() : "";
                        if (trimmed) {
                            return trimmed;
                        }
                    }
                    return null;
                };

                const resolveThingForEvent = (name, action) => {
                    const normalizedName = normalize(name);
                    if (!normalizedName) {
                        return null;
                    }

                    const candidates = this._findThingsByExactName(normalizedName);
                    if (candidates.length) {
                        if (action === "left") {
                            return candidates.find(
                                (thing) => this._thingLocationId(thing) === currentLocationId,
                            ) || candidates[0];
                        }
                        if (action === "arrived") {
                            return candidates.find(
                                (thing) => this._thingLocationId(thing) !== currentLocationId,
                            ) || candidates[0];
                        }
                        return candidates[0];
                    }

                    return findThingByName(normalizedName) || null;
                };

                const resolveCurrentThingLocation = (thing) => {
                    const locationId = this._thingLocationId(thing);
                    if (!locationId) {
                        return null;
                    }
                    return this.resolveLocationCandidate(locationId);
                };

                const placeThingInLocation = (thing, location) => {
                    if (!thing?.id) {
                        throw new Error("Cannot place a thing without an id.");
                    }
                    if (!location || typeof location.addThingId !== "function") {
                        throw new Error(
                            `Cannot place thing "${thing.name || thing.id}": destination location is invalid.`,
                        );
                    }
                    if (typeof thing.putInLocation === "function") {
                        thing.putInLocation(location.id);
                    } else {
                        this.addThingToLocation(thing, location);
                    }
                };

                const isCurrentLocationDestination = (destinationLocationName) => {
                    const trimmedLocation = normalizeOptionalEventLocationField(
                        destinationLocationName,
                    );
                    if (!trimmedLocation) {
                        return false;
                    }
                    return (
                        trimmedLocation.toLowerCase() === currentLocationId.toLowerCase() ||
                        trimmedLocation.toLowerCase() ===
                            normalize(currentLocation.name).toLowerCase()
                    );
                };

                const createOffscreenDepartureLocation = async ({
                    thingName,
                    destinationRegionName,
                    destinationLocationName,
                    originLocation,
                }) => {
                    const trimmedRegion =
                        normalizeOptionalEventLocationField(destinationRegionName);
                    const trimmedLocation =
                        normalizeOptionalEventLocationField(destinationLocationName);

                    if (!trimmedLocation) {
                        console.warn(
                            `Thing departure for ${thingName} did not include a concrete destination location.`,
                        );
                        return null;
                    }
                    if (!trimmedRegion) {
                        console.warn(
                            `Thing departure destination not found for ${thingName}: region='', location='${trimmedLocation}'. ` +
                            "A destination region is required before creating an offscreen tracking stub.",
                        );
                        return null;
                    }
                    if (!originLocation) {
                        console.warn(
                            `Thing departure for ${thingName} cannot create destination stub without an origin location.`,
                        );
                        return null;
                    }

                    let targetRegion = resolveEventRegionByName(
                        { regions, pendingRegionStubs, findRegionByNameLoose },
                        trimmedRegion,
                    );

                    if (
                        !targetRegion &&
                        typeof createRegionStubFromEvent === "function"
                    ) {
                        const regionEntryStub = await createRegionStubFromEvent({
                            name: trimmedRegion,
                            originLocation,
                            description:
                                `Offscreen destination region used to track ${thingName}.`,
                            createOriginExit: false,
                        });
                        const regionId =
                            getRegionId(regionEntryStub) ||
                            getRegionId(regionEntryStub?.stubMetadata);
                        targetRegion =
                            resolveEventRegionByName(
                                { regions, pendingRegionStubs, findRegionByNameLoose },
                                trimmedRegion,
                            ) ||
                            (regionId && pendingRegionStubs instanceof Map
                                ? pendingRegionStubs.get(regionId) || null
                                : null) ||
                            (regionId
                                ? {
                                    id: regionId,
                                    name: trimmedRegion,
                                    locationIds: [],
                                }
                                : null);
                    }

                    if (!targetRegion) {
                        console.warn(
                            `Thing departure destination region could not be created for ${thingName}: region='${trimmedRegion}', location='${trimmedLocation}'.`,
                        );
                        return null;
                    }

                    const targetRegionId = getRegionId(targetRegion);
                    if (!targetRegionId) {
                        console.warn(
                            `Thing departure destination region has no id for ${thingName}: region='${trimmedRegion}', location='${trimmedLocation}'.`,
                        );
                        return null;
                    }

                    if (typeof createLocationFromEvent !== "function") {
                        console.warn(
                            `Thing departure destination location could not be created for ${thingName}: createLocationFromEvent is unavailable.`,
                        );
                        return null;
                    }

                    return createLocationFromEvent({
                        name: trimmedLocation,
                        originLocation,
                        descriptionHint:
                            `Offscreen destination used to track ${thingName} after leaving the scene.`,
                        expandStub: false,
                        targetRegionId,
                        createOriginExit: false,
                    });
                };

                for (const entry of entries) {
                    const action = normalize(entry?.action).toLowerCase();
                    const originalName = normalize(entry?.name);
                    if (!originalName) {
                        continue;
                    }
                    if (action !== "arrived" && action !== "left") {
                        console.warn(
                            `Ignoring thing_arrival_departure with unsupported action "${entry?.action}".`,
                            entry,
                        );
                        continue;
                    }

                    const thing = resolveThingForEvent(originalName, action);
                    if (!thing) {
                        console.warn(
                            `thing_arrival_departure could not find existing thing "${originalName}".`,
                        );
                        continue;
                    }

                    entry.name = thing.name || originalName;

                    if (action === "arrived") {
                        try {
                            placeThingInLocation(thing, currentLocation);
                        } catch (error) {
                            console.warn(
                                `Failed to place arriving thing "${entry.name}" in current location:`,
                                error.message,
                            );
                        }
                        continue;
                    }

                    const destinationLocationName =
                        normalizeOptionalEventLocationField(entry.destinationLocation) ||
                        normalizeOptionalEventLocationField(entry.destination);
                    const destinationRegionName = normalizeOptionalEventLocationField(
                        entry.destinationRegion,
                    );

                    if (isCurrentLocationDestination(destinationLocationName)) {
                        console.warn(
                            `Ignoring thing departure for ${entry.name}: destination is the current location.`,
                        );
                        continue;
                    }

                    const destinationRegion = resolveEventRegionByName(
                        { regions, pendingRegionStubs, findRegionByNameLoose },
                        destinationRegionName,
                    );
                    let targetLocation = resolveEventLocationByName({
                        Location,
                        gameLocations,
                        findLocationByNameLoose,
                        region: destinationRegion || null,
                    }, destinationLocationName);

                    if (!targetLocation) {
                        const originLocation =
                            resolveCurrentThingLocation(thing) || currentLocation;
                        targetLocation = await createOffscreenDepartureLocation({
                            thingName: entry.name,
                            destinationRegionName,
                            destinationLocationName,
                            originLocation,
                        });
                    }

                    if (!targetLocation) {
                        console.warn(
                            `Thing departure destination not found for ${entry.name}: region='${destinationRegionName || ""}', location='${destinationLocationName || ""}'`,
                        );
                        continue;
                    }

                    if (
                        typeof targetLocation.id === "string" &&
                        targetLocation.id.trim() === currentLocationId
                    ) {
                        console.warn(
                            `Ignoring thing departure for ${entry.name}: resolved destination is the current location.`,
                        );
                        continue;
                    }

                    try {
                        placeThingInLocation(thing, targetLocation);
                    } catch (error) {
                        console.warn(
                            `Failed to move thing "${entry.name}" to destination '${targetLocation?.name || destinationLocationName}':`,
                            error.message,
                        );
                    }
                }
            },
            reveal_hidden_npc: async function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const player = context.player || this.currentPlayer || this._deps.getCurrentPlayer?.() || Globals.currentPlayer || null;
                const settings = this._getHidePerceptionSettings();
                const appliedEntries = [];

                for (const entry of entries) {
                    const npc = this._resolveHiddenNpcTarget(entry?.name);
                    if (!npc || npc.isDead === true || npc.hiddenFromPlayer !== true) {
                        continue;
                    }

                    if (entry?.useOpposedCheck !== false) {
                        if (!player) {
                            throw new Error("reveal_hidden_npc requires a current player for opposed checks.");
                        }
                        const preResolved = this._consumeMatchingPreResolvedHiddenNpcCheck({
                            context,
                            actor: player,
                            opponent: npc,
                            actorAttribute: settings.perceptionAttribute,
                            actorSkill: settings.perceptionSkill,
                            opponentAttribute: settings.hidingAttribute,
                            opponentSkill: settings.hidingSkill,
                        });
                        const resolution = preResolved || this._runHiddenNpcOpposedCheck({
                            actor: player,
                            opponent: npc,
                            actorAttribute: settings.perceptionAttribute,
                            actorSkill: settings.perceptionSkill,
                            opponentAttribute: settings.hidingAttribute,
                            opponentSkill: settings.hidingSkill,
                            reason: entry?.description || `The player attempts to notice ${npc.name || entry.name}.`,
                            context,
                            action: "reveal_hidden_npc"
                        });
                        if (resolution.success !== true) {
                            appliedEntries.push({
                                ...entry,
                                npcName: npc.name || entry.name,
                                success: false,
                                ...(preResolved ? { reusedActionCheck: true } : {}),
                            });
                            continue;
                        }

                        if (preResolved) {
                            entry.reusedActionCheck = true;
                        }
                    }

                    npc.hiddenFromPlayer = false;
                    context.locationRefreshRequested = true;
                    appliedEntries.push({ ...entry, npcName: npc.name || entry.name, success: true });
                }

                entries.length = 0;
                if (appliedEntries.length) {
                    entries.push(...appliedEntries);
                }
            },
            hide_visible_npc: async function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const player = context.player || this.currentPlayer || this._deps.getCurrentPlayer?.() || Globals.currentPlayer || null;
                if (!player) {
                    throw new Error("hide_visible_npc requires a current player for opposed checks.");
                }
                const settings = this._getHidePerceptionSettings();
                const appliedEntries = [];

                for (const entry of entries) {
                    const npc = this._resolveHiddenNpcTarget(entry?.name);
                    if (!npc || npc.isDead === true) {
                        continue;
                    }
                    const preResolved = this._consumeMatchingPreResolvedHiddenNpcCheck({
                        context,
                        actor: npc,
                        opponent: player,
                        actorAttribute: settings.hidingAttribute,
                        actorSkill: settings.hidingSkill,
                        opponentAttribute: settings.perceptionAttribute,
                        opponentSkill: settings.perceptionSkill,
                    });
                    const resolution = preResolved || this._runHiddenNpcOpposedCheck({
                        actor: npc,
                        opponent: player,
                        actorAttribute: settings.hidingAttribute,
                        actorSkill: settings.hidingSkill,
                        opponentAttribute: settings.perceptionAttribute,
                        opponentSkill: settings.perceptionSkill,
                        reason: entry?.description || `${npc.name || entry.name} attempts to hide from the player.`,
                        context,
                        action: "hide_visible_npc"
                    });
                    if (resolution.success === true) {
                        npc.hiddenFromPlayer = true;
                        context.locationRefreshRequested = true;
                    }
                    appliedEntries.push({
                        ...entry,
                        npcName: npc.name || entry.name,
                        success: resolution.success === true,
                        ...(preResolved ? { reusedActionCheck: true } : {}),
                    });
                }

                entries.length = 0;
                if (appliedEntries.length) {
                    entries.push(...appliedEntries);
                }
            },
            npc_arrival_departure: async function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const {
                    findActorByName,
                    findActorById,
                    ensureNpcByName,
                    findLocationByNameLoose,
                    findRegionByNameLoose,
                    createLocationFromEvent,
                    createRegionStubFromEvent,
                    Location,
                    regions,
                    gameLocations,
                    pendingRegionStubs,
                } = this._deps;
                const suppressedIndexes = new Set();
                const processedNames = new SanitizedStringSet();
                const playerExcludedNames = new SanitizedStringSet();
                const partyMemberNames = new SanitizedStringSet();
                const partyMemberIds = new Set();
                const partyOwners = [];

                const registerPlayerName = (actor) => {
                    if (!actor || typeof actor.name !== "string") {
                        return;
                    }
                    playerExcludedNames.add(actor.name);
                };

                const registerPartyMember = (actor, memberId = null) => {
                    const resolvedId = typeof memberId === "string" && memberId.trim()
                        ? memberId.trim()
                        : (typeof actor?.id === "string" ? actor.id.trim() : "");
                    if (resolvedId) {
                        partyMemberIds.add(resolvedId);
                    }
                    if (actor && typeof actor.name === "string") {
                        partyMemberNames.add(actor.name);
                    }
                };

                const resolveActorById = (id) => {
                    if (!id) {
                        return null;
                    }
                    if (typeof findActorById === "function") {
                        const resolved = findActorById(id);
                        if (resolved) {
                            return resolved;
                        }
                    }
                    if (this.players instanceof Map && this.players.has(id)) {
                        return this.players.get(id);
                    }
                    return null;
                };

                const normalizePartyMemberList = (value) => {
                    if (Array.isArray(value)) {
                        return value;
                    }
                    if (value && typeof value.forEach === "function") {
                        return Array.from(value);
                    }
                    return [];
                };

                const registerPartyOwner = (actor) => {
                    if (!actor || typeof actor.getPartyMembers !== "function") {
                        return;
                    }
                    if (!partyOwners.includes(actor)) {
                        partyOwners.push(actor);
                    }
                };

                if (Globals.processedMove) {
                    const indexesToRemove = [];
                    for (let index = 0; index < entries.length; index += 1) {
                        const entry = entries[index];
                        const normalizedName = normalizeString(entry?.name);
                        const candidateIds = [
                            typeof entry?.id === "string" ? entry.id.trim() : null,
                            typeof entry?.npcId === "string" ? entry.npcId.trim() : null,
                            typeof entry?.npcID === "string" ? entry.npcID.trim() : null,
                            typeof entry?.actorId === "string" ? entry.actorId.trim() : null,
                        ].filter(Boolean);

                        let existingNpc = null;
                        for (const candidateId of candidateIds) {
                            existingNpc = resolveActorById(candidateId);
                            if (existingNpc) {
                                break;
                            }
                        }
                        if (
                            !existingNpc &&
                            normalizedName &&
                            typeof findActorByName === "function"
                        ) {
                            existingNpc = findActorByName(normalizedName) || null;
                        }
                        if (!existingNpc) {
                            indexesToRemove.push(index);
                        }
                    }

                    if (indexesToRemove.length) {
                        for (let i = indexesToRemove.length - 1; i >= 0; i -= 1) {
                            entries.splice(indexesToRemove[i], 1);
                        }
                    }

                    if (!entries.length) {
                        return;
                    }
                }

                const collectPartyState = (actor) => {
                    if (!actor) {
                        return;
                    }
                    registerPlayerName(actor);
                    if (typeof actor.getPartyMembers !== "function") {
                        return;
                    }
                    registerPartyOwner(actor);
                    const memberIds = normalizePartyMemberList(actor.getPartyMembers());
                    for (const memberId of memberIds) {
                        const member = resolveActorById(memberId);
                        registerPartyMember(member, memberId);
                    }
                };

                collectPartyState(context.player);
                const currentPlayer = this.currentPlayer;
                if (currentPlayer && currentPlayer !== context.player) {
                    collectPartyState(currentPlayer);
                }

                const normalize = (value) =>
                    typeof value === "string" ? value.trim() : "";

                const isAllowedPartyMemberDeparture = (name, action) =>
                    action === "left" && partyMemberNames.has(name);

                const removeDepartingPartyMember = (actor) => {
                    const actorId = typeof actor?.id === "string" ? actor.id.trim() : "";
                    if (!actorId || !partyMemberIds.has(actorId)) {
                        return false;
                    }
                    let removed = false;
                    for (const owner of partyOwners) {
                        if (!owner || owner === actor || typeof owner.removePartyMember !== "function") {
                            continue;
                        }
                        const ownerMemberIds = normalizePartyMemberList(
                            typeof owner.getPartyMembers === "function"
                                ? owner.getPartyMembers()
                                : [],
                        )
                            .map((id) => (typeof id === "string" ? id.trim() : ""))
                            .filter(Boolean);
                        if (!ownerMemberIds.includes(actorId)) {
                            continue;
                        }
                        removed = owner.removePartyMember(actorId) || removed;
                    }
                    return removed;
                };

                const getPartyOwnerLocationIds = () => {
                    const locationIds = new Set();
                    for (const owner of partyOwners) {
                        const locationId =
                            typeof owner?.currentLocation === "string"
                                ? owner.currentLocation.trim()
                                : "";
                        if (locationId) {
                            locationIds.add(locationId);
                        }
                    }
                    return locationIds;
                };

                const isPartyMemberAlreadyWithPlayerAtDestination = (
                    actor,
                    targetLocation,
                ) => {
                    const actorId = typeof actor?.id === "string" ? actor.id.trim() : "";
                    const targetLocationId =
                        typeof targetLocation?.id === "string"
                            ? targetLocation.id.trim()
                            : "";
                    if (!actorId || !targetLocationId || !partyMemberIds.has(actorId)) {
                        return false;
                    }
                    return getPartyOwnerLocationIds().has(targetLocationId);
                };

                const lookupRegionByName = (name) => {
                    const trimmed = normalize(name);
                    if (!trimmed) {
                        return null;
                    }
                    const resolvedRegion = resolveEventRegionByName(
                        { regions, pendingRegionStubs, findRegionByNameLoose },
                        trimmed,
                    );
                    if (resolvedRegion) {
                        return resolvedRegion;
                    }
                    if (typeof findRegionByNameLoose === "function") {
                        const region = findRegionByNameLoose(trimmed);
                        if (region) {
                            return region;
                        }
                    }
                    if (regions instanceof Map) {
                        const lower = trimmed.toLowerCase();
                        for (const region of regions.values()) {
                            if (
                                region &&
                                typeof region.name === "string" &&
                                region.name.trim().toLowerCase() === lower
                            ) {
                                return region;
                            }
                        }
                    }
                    return null;
                };

                const getRegionId = (region) => {
                    const candidates = [
                        region?.id,
                        region?.targetRegionId,
                        region?.regionId,
                        region?.stubMetadata?.targetRegionId,
                        region?.stubMetadata?.regionId,
                    ];
                    for (const candidate of candidates) {
                        const trimmed =
                            typeof candidate === "string" ? candidate.trim() : "";
                        if (trimmed) {
                            return trimmed;
                        }
                    }
                    return null;
                };

                const getLocationId = (location) => {
                    const trimmed =
                        typeof location?.id === "string" ? location.id.trim() : "";
                    return trimmed || null;
                };

                const lookupLocationByName = (name) => {
                    const trimmed = normalize(name);
                    if (!trimmed) {
                        return null;
                    }
                    let location = null;
                    if (Location && typeof Location.findByName === "function") {
                        try {
                            location = Location.findByName(trimmed);
                        } catch (_) {
                            location = null;
                        }
                    }
                    if (
                        !location &&
                        Location &&
                        typeof Location.getByName === "function"
                    ) {
                        try {
                            location = Location.getByName(trimmed);
                        } catch (_) {
                            location = null;
                        }
                    }
                    if (!location && typeof findLocationByNameLoose === "function") {
                        location = findLocationByNameLoose(trimmed) || null;
                    }
                    return location;
                };

                const doesLocationMatchRegion = (location, regionName) => {
                    const trimmedRegion = normalize(regionName);
                    if (!location || !trimmedRegion) {
                        return !trimmedRegion;
                    }
                    const regionId =
                        location.regionId ||
                        location.stubMetadata?.regionId ||
                        location.stubMetadata?.targetRegionId ||
                        null;
                    if (!regionId) {
                        return false;
                    }
                    if (regions instanceof Map) {
                        const regionRecord = regions.get(regionId);
                        if (regionRecord && typeof regionRecord.name === "string") {
                            if (
                                regionRecord.name.trim().toLowerCase() ===
                                trimmedRegion.toLowerCase()
                            ) {
                                return true;
                            }
                        }
                    }
                    const looseRegion = lookupRegionByName(trimmedRegion);
                    if (!looseRegion) {
                        return false;
                    }
                    if (looseRegion.id && looseRegion.id === regionId) {
                        return true;
                    }
                    if (
                        typeof looseRegion.name === "string" &&
                        looseRegion.name.trim().toLowerCase() ===
                        trimmedRegion.toLowerCase()
                    ) {
                        return true;
                    }
                    return false;
                };

                const resolveLocationWithinRegion = (regionName, locationName) => {
                    const trimmedRegion = normalize(regionName);
                    const trimmedLocation = normalize(locationName);
                    if (!trimmedRegion || !trimmedLocation) {
                        return null;
                    }
                    const region = lookupRegionByName(trimmedRegion);
                    if (!region) {
                        return null;
                    }
                    const locationIds = Array.isArray(region.locationIds)
                        ? region.locationIds
                        : [];
                    for (const locationId of locationIds) {
                        let candidate = null;
                        if (Location && typeof Location.get === "function") {
                            candidate = Location.get(locationId);
                        }
                        if (!candidate && gameLocations instanceof Map) {
                            candidate = gameLocations.get(locationId) || null;
                        }
                        if (!candidate || typeof candidate.name !== "string") {
                            continue;
                        }
                        if (
                            candidate.name.trim().toLowerCase() ===
                            trimmedLocation.toLowerCase()
                        ) {
                            return candidate;
                        }
                    }
                    return null;
                };

                const isCurrentLocationDestination = (
                    destinationLocationName,
                    destinationRegionName,
                ) => {
                    const currentLocation = context.location || null;
                    const trimmedLocation = normalize(destinationLocationName);
                    if (!currentLocation || !trimmedLocation) {
                        return false;
                    }
                    const locationMatches =
                        (typeof currentLocation.id === "string" &&
                            currentLocation.id.trim().toLowerCase() ===
                            trimmedLocation.toLowerCase()) ||
                        (typeof currentLocation.name === "string" &&
                            currentLocation.name.trim().toLowerCase() ===
                            trimmedLocation.toLowerCase());
                    if (!locationMatches) {
                        return false;
                    }
                    const trimmedRegion = normalize(destinationRegionName);
                    return !trimmedRegion ||
                        doesLocationMatchRegion(currentLocation, trimmedRegion);
                };

                const createOffscreenDepartureLocation = async ({
                    finalizedName,
                    destinationRegionName,
                    destinationLocationName,
                    originLocation,
                }) => {
                    const trimmedRegion =
                        normalizeOptionalEventLocationField(destinationRegionName);
                    const trimmedLocation =
                        normalizeOptionalEventLocationField(destinationLocationName);
                    if (!trimmedLocation) {
                        console.warn(
                            `NPC departure for ${finalizedName} did not include a concrete destination location.`,
                        );
                        return null;
                    }
                    if (!trimmedRegion) {
                        console.warn(
                            `NPC departure destination not found for ${finalizedName}: region='', location='${trimmedLocation}'. ` +
                            "A destination region is required before creating an offscreen tracking stub.",
                        );
                        return null;
                    }
                    if (!originLocation) {
                        console.warn(
                            `NPC departure for ${finalizedName} cannot create destination stub without an origin location.`,
                        );
                        return null;
                    }

                    let targetRegion = lookupRegionByName(trimmedRegion);

                    if (
                        !targetRegion &&
                        typeof createRegionStubFromEvent === "function"
                    ) {
                        const regionEntryStub = await createRegionStubFromEvent({
                            name: trimmedRegion,
                            originLocation,
                            description:
                                `Offscreen destination region used to track ${finalizedName}.`,
                            createOriginExit: false,
                        });
                        const regionId =
                            getRegionId(regionEntryStub) ||
                            getRegionId(regionEntryStub?.stubMetadata);
                        targetRegion =
                            lookupRegionByName(trimmedRegion) ||
                            (regionId && pendingRegionStubs instanceof Map
                                ? pendingRegionStubs.get(regionId) || null
                                : null) ||
                            (regionId
                                ? {
                                    id: regionId,
                                    name: trimmedRegion,
                                    locationIds: [],
                                }
                                : null);
                    }

                    if (!targetRegion) {
                        console.warn(
                            `NPC departure destination region could not be created for ${finalizedName}: region='${trimmedRegion}', location='${trimmedLocation}'.`,
                        );
                        return null;
                    }

                    const targetRegionId = getRegionId(targetRegion);
                    if (!targetRegionId) {
                        console.warn(
                            `NPC departure destination region has no id for ${finalizedName}: region='${trimmedRegion}', location='${trimmedLocation}'.`,
                        );
                        return null;
                    }

                    if (typeof createLocationFromEvent !== "function") {
                        console.warn(
                            `NPC departure destination location could not be created for ${finalizedName}: createLocationFromEvent is unavailable.`,
                        );
                        return null;
                    }

                    return createLocationFromEvent({
                        name: trimmedLocation,
                        originLocation,
                        descriptionHint:
                            `Offscreen destination used to track ${finalizedName} after leaving the scene.`,
                        expandStub: false,
                        targetRegionId,
                        createOriginExit: false,
                    });
                };

                for (let index = 0; index < entries.length; index += 1) {
                    const entry = entries[index];
                    const action = (entry?.action || "").trim().toLowerCase();
                    const isFirstAppearance = Boolean(entry?.firstAppearance);
                    const originalName = normalizeString(entry?.name);

                    if (!originalName) {
                        suppressedIndexes.add(index);
                        continue;
                    }

                    if (
                        playerExcludedNames.has(originalName) ||
                        (partyMemberNames.has(originalName) &&
                            !isAllowedPartyMemberDeparture(originalName, action))
                    ) {
                        suppressedIndexes.add(index);
                        continue;
                    }

                    if (processedNames.has(originalName)) {
                        suppressedIndexes.add(index);
                        continue;
                    }

                    let finalizedName = originalName;
                    if (action === "arrived" || isFirstAppearance) {
                        try {
                            const ensuredNpc = await ensureNpcByName(originalName, context);
                            if (ensuredNpc && typeof ensuredNpc.name === "string") {
                                const trimmed = ensuredNpc.name.trim();
                                if (trimmed) {
                                    finalizedName = trimmed;
                                }
                            }
                        } catch (error) {
                            console.warn("Failed to ensure NPC arrival:", error.message);
                        }
                    }

                    if (!finalizedName) {
                        suppressedIndexes.add(index);
                        continue;
                    }

                    if (
                        playerExcludedNames.has(finalizedName) ||
                        (partyMemberNames.has(finalizedName) &&
                            !isAllowedPartyMemberDeparture(finalizedName, action))
                    ) {
                        suppressedIndexes.add(index);
                        continue;
                    }

                    const dedupeKey = finalizedName;
                    if (processedNames.has(dedupeKey)) {
                        suppressedIndexes.add(index);
                        continue;
                    }
                    processedNames.add(dedupeKey);
                    if (originalName !== finalizedName) {
                        processedNames.add(originalName);
                    }

                    entry.name = finalizedName;

                    if (action === "arrived" || isFirstAppearance) {
                        this.newCharacters.add(finalizedName);
                        this.arrivedCharacters.add(finalizedName);
                    }

                    const npc = findActorByName?.(finalizedName);
                    if (!npc) {
                        continue;
                    }
                    if (action === "arrived" || isFirstAppearance) {
                        const targetLocation = context.location || null;
                        if (targetLocation) {
                            try {
                                const currentLocationId =
                                    typeof npc.currentLocation === "string"
                                        ? npc.currentLocation
                                        : null;
                                if (
                                    currentLocationId &&
                                    currentLocationId !== targetLocation.id
                                ) {
                                    let currentLocation = null;
                                    try {
                                        currentLocation = Location.get(currentLocationId);
                                    } catch (_) {
                                        currentLocation = null;
                                    }
                                    if (!currentLocation && gameLocations instanceof Map) {
                                        currentLocation =
                                            gameLocations.get(currentLocationId) || null;
                                    }
                                    if (
                                        currentLocation &&
                                        typeof currentLocation.removeNpcId === "function"
                                    ) {
                                        currentLocation.removeNpcId(npc.id);
                                    }
                                }

                                if (typeof npc.setLocation === "function") {
                                    npc.setLocation(targetLocation.id || targetLocation);
                                } else if (typeof npc.setLocationByName === "function") {
                                    npc.setLocationByName(
                                        targetLocation.name || targetLocation.id,
                                    );
                                }

                                if (typeof targetLocation.addNpcId === "function") {
                                    targetLocation.addNpcId(npc.id);
                                }

                                if (gameLocations instanceof Map && targetLocation?.id) {
                                    gameLocations.set(targetLocation.id, targetLocation);
                                }

                                if (entry.hideFromPlayer === true) {
                                    npc.hiddenFromPlayer = true;
                                    context.locationRefreshRequested = true;
                                }
                            } catch (error) {
                                console.warn(
                                    `Failed to place arriving NPC "${finalizedName}" in current location:`,
                                    error.message,
                                );
                                console.debug([error]);
                            }
                        }
                    }
                    if (action === "left") {
                        console.log(
                            `Processing departure of NPC: ${finalizedName} to ${entry.destination || "<unspecified>"}`,
                        );
                        const destinationLocationName =
                            normalizeOptionalEventLocationField(entry.destinationLocation) ||
                            normalizeOptionalEventLocationField(entry.destination);
                        const destinationRegionName = normalizeOptionalEventLocationField(
                            entry.destinationRegion,
                        );

                        if (
                            isCurrentLocationDestination(
                                destinationLocationName,
                                destinationRegionName,
                            )
                        ) {
                            console.warn(
                                `Ignoring NPC departure for ${finalizedName}: destination is the current location.`,
                            );
                            suppressedIndexes.add(index);
                            continue;
                        }

                        let targetLocation = lookupLocationByName(destinationLocationName);
                        console.log(
                            `  Initial resolved location: ${targetLocation ? targetLocation.name : "<none>"}`,
                        );

                        if (
                            targetLocation &&
                            destinationRegionName &&
                            !doesLocationMatchRegion(targetLocation, destinationRegionName)
                        ) {
                            targetLocation = null;
                        }

                        if (
                            !targetLocation &&
                            destinationRegionName &&
                            destinationLocationName
                        ) {
                            targetLocation = resolveLocationWithinRegion(
                                destinationRegionName,
                                destinationLocationName,
                            );
                        }

                        if (!targetLocation) {
                            targetLocation = await createOffscreenDepartureLocation({
                                finalizedName,
                                destinationRegionName,
                                destinationLocationName,
                                originLocation: npc.location || context.location || null,
                            });
                        }

                        if (!targetLocation) {
                            console.warn(
                                `NPC departure destination not found for ${finalizedName}: region='${destinationRegionName || ""}', location='${destinationLocationName || ""}'`,
                            );
                            continue;
                        }

                        if (
                            getLocationId(targetLocation) &&
                            getLocationId(context.location) &&
                            getLocationId(targetLocation) === getLocationId(context.location)
                        ) {
                            console.warn(
                                `Ignoring NPC departure for ${finalizedName}: resolved destination is the current location.`,
                            );
                            suppressedIndexes.add(index);
                            continue;
                        }

                        try {
                            if (
                                isPartyMemberAlreadyWithPlayerAtDestination(
                                    npc,
                                    targetLocation,
                                )
                            ) {
                                suppressedIndexes.add(index);
                                continue;
                            }

                            removeDepartingPartyMember(npc);
                            const originLocation = npc.location || context.location || null;
                            if (
                                originLocation &&
                                typeof originLocation.removeNpcId === "function"
                            ) {
                                originLocation.removeNpcId(npc.id);
                            }
                            if (typeof npc.setLocation === "function") {
                                npc.setLocation(targetLocation);
                                console.log(
                                    `  NPC ${finalizedName} moved to ${targetLocation.name}`,
                                );
                            } else if (typeof npc.setLocationByName === "function") {
                                npc.setLocationByName(
                                    targetLocation.name || destinationLocationName,
                                );
                                console.log(
                                    `  NPC ${finalizedName} moved to ${targetLocation.name || destinationLocationName}`,
                                );
                            } else {
                                console.warn(
                                    `NPC ${finalizedName} cannot move: missing setLocation method.`,
                                );
                                continue;
                            }
                            if (
                                targetLocation &&
                                typeof targetLocation.addNpcId === "function"
                            ) {
                                targetLocation.addNpcId(npc.id);
                            }
                            if (entry.hideFromPlayer === true) {
                                npc.hiddenFromPlayer = true;
                            }
                            this.departedCharacters.add(finalizedName);
                        } catch (error) {
                            console.warn(
                                `Failed to move NPC ${finalizedName} to destination '${targetLocation?.name || destinationLocationName}':`,
                                error.message,
                            );
                        }
                    }
                }

                if (suppressedIndexes.size) {
                    for (let i = entries.length - 1; i >= 0; i -= 1) {
                        if (suppressedIndexes.has(i)) {
                            entries.splice(i, 1);
                        }
                    }
                }
            },
            thing_move_with_character: async function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }

                const {
                    findThingByName,
                    findActorByName,
                    findActorById,
                    gameLocations,
                } = this._deps;

                if (typeof findThingByName !== "function") {
                    throw new Error(
                        "thing_move_with_character handler requires findThingByName dependency.",
                    );
                }

                const normalize = (value) =>
                    typeof value === "string" ? value.trim() : "";
                const normalizeLower = (value) => normalize(value).toLowerCase();
                const player = context.player || this.currentPlayer || Globals.currentPlayer || null;
                const playerAliases = new Set([
                    "player",
                    "the player",
                    "you",
                    "self",
                    "your character",
                ]);
                if (player?.name) {
                    playerAliases.add(normalizeLower(player.name));
                }

                const resolveActorById = (id) => {
                    const trimmedId = normalize(id);
                    if (!trimmedId) {
                        return null;
                    }
                    if (typeof findActorById === "function") {
                        const actor = findActorById(trimmedId);
                        if (actor) {
                            return actor;
                        }
                    }
                    if (this.players instanceof Map) {
                        return this.players.get(trimmedId) || null;
                    }
                    return null;
                };

                const normalizePartyMemberList = (value) => {
                    if (Array.isArray(value)) {
                        return value;
                    }
                    if (value && typeof value.forEach === "function") {
                        return Array.from(value);
                    }
                    return [];
                };

                const partyMemberIds = new Set();
                const partyMemberNames = new SanitizedStringSet();
                if (player && typeof player.getPartyMembers === "function") {
                    for (const memberId of normalizePartyMemberList(player.getPartyMembers())) {
                        const trimmedId = normalize(memberId);
                        if (trimmedId) {
                            partyMemberIds.add(trimmedId);
                        }
                        const member = resolveActorById(trimmedId);
                        if (member?.name) {
                            partyMemberNames.add(member.name);
                        }
                    }
                }

                const isPartyMember = (actor, rawName = "") => {
                    const actorId = normalize(actor?.id);
                    if (actorId && partyMemberIds.has(actorId)) {
                        return true;
                    }
                    const actorName = normalize(actor?.name);
                    if (actorName && partyMemberNames.has(actorName)) {
                        return true;
                    }
                    return rawName && partyMemberNames.has(rawName);
                };

                const resolveActorForEvent = (rawName) => {
                    const characterName = normalize(rawName);
                    if (!characterName) {
                        return null;
                    }
                    const lower = characterName.toLowerCase();
                    if (playerAliases.has(lower)) {
                        return player;
                    }
                    if (
                        player?.name &&
                        normalizeLower(player.name) === lower
                    ) {
                        return player;
                    }
                    if (typeof findActorByName === "function") {
                        const actor = findActorByName(characterName);
                        if (actor) {
                            return actor;
                        }
                    }
                    return null;
                };

                const resolveLocationFromCandidate = (candidate) => {
                    if (!candidate) {
                        return null;
                    }
                    const direct = this.resolveLocationCandidate(candidate);
                    if (direct) {
                        return direct;
                    }
                    const locationId = normalize(candidate?.id || candidate?.locationId);
                    if (locationId) {
                        const byId = this.resolveLocationCandidate(locationId);
                        if (byId) {
                            return byId;
                        }
                    }
                    if (typeof candidate === "string" && gameLocations instanceof Map) {
                        return gameLocations.get(candidate) || null;
                    }
                    return null;
                };

                const resolveActorLocation = (actor, rawName) => {
                    if (!actor) {
                        return null;
                    }
                    const isPlayerActor = actor === player || playerAliases.has(normalizeLower(rawName));
                    if (
                        context.location &&
                        (isPlayerActor || isPartyMember(actor, rawName))
                    ) {
                        return context.location;
                    }

                    const candidates = [
                        actor.currentLocation,
                        actor.location,
                        actor.locationId,
                        actor.metadata?.locationId,
                    ];
                    for (const candidate of candidates) {
                        const location = resolveLocationFromCandidate(candidate);
                        if (location) {
                            return location;
                        }
                    }

                    if (isPlayerActor && context.location) {
                        return context.location;
                    }
                    return null;
                };

                const resolveThingForEvent = (rawName, targetLocation) => {
                    const thingName = normalize(rawName);
                    if (!thingName) {
                        return null;
                    }
                    const targetLocationId = normalize(targetLocation?.id);
                    const candidates = this._findThingsByExactName(thingName);
                    if (candidates.length) {
                        if (targetLocationId) {
                            return (
                                candidates.find(
                                    (thing) => this._thingLocationId(thing) !== targetLocationId,
                                ) || candidates[0]
                            );
                        }
                        return candidates[0];
                    }
                    return findThingByName(thingName) || null;
                };

                const placeThingInLocation = (thing, location) => {
                    if (!thing?.id) {
                        throw new Error("Cannot move a thing without an id.");
                    }
                    if (!location || typeof location.addThingId !== "function") {
                        throw new Error(
                            `Cannot move thing "${thing.name || thing.id}": destination location is invalid.`,
                        );
                    }
                    if (typeof thing.putInLocation === "function") {
                        thing.putInLocation(location.id);
                    } else {
                        this.addThingToLocation(thing, location);
                    }
                };

                for (const entry of entries) {
                    const thingName = normalize(entry?.thingName || entry?.name || entry?.thing);
                    const characterName = normalize(
                        entry?.characterName || entry?.character || entry?.actorName || entry?.actor,
                    );
                    if (!thingName || !characterName) {
                        continue;
                    }

                    const actor = resolveActorForEvent(characterName);
                    if (!actor) {
                        console.warn(
                            `thing_move_with_character could not find character "${characterName}" for thing "${thingName}".`,
                        );
                        continue;
                    }

                    const targetLocation = resolveActorLocation(actor, characterName);
                    if (!targetLocation) {
                        console.warn(
                            `thing_move_with_character could not resolve destination location for character "${characterName}" moving thing "${thingName}".`,
                        );
                        continue;
                    }

                    const thing = resolveThingForEvent(thingName, targetLocation);
                    if (!thing) {
                        console.warn(
                            `thing_move_with_character could not find existing thing "${thingName}".`,
                        );
                        continue;
                    }

                    entry.thingName = thing.name || thingName;
                    entry.characterName = actor.name || characterName;

                    try {
                        placeThingInLocation(thing, targetLocation);
                    } catch (error) {
                        console.warn(
                            `Failed to move thing "${entry.thingName}" with character "${entry.characterName}" to "${targetLocation.name || targetLocation.id}":`,
                            error.message,
                        );
                    }
                }
            },
            mystery_box_mention: async function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                context.mysteryBoxUpdates = Array.isArray(context.mysteryBoxUpdates)
                    ? context.mysteryBoxUpdates
                    : [];
                const mysteryResolution = await this._runMysteryThreadCheckPrompt(context);
                const inactivatedThreads = mysteryResolution.inactivatedThreads || [];
                if (inactivatedThreads.length) {
                    context.inactivatedMysteryThreads = Array.isArray(context.inactivatedMysteryThreads)
                        ? context.inactivatedMysteryThreads
                        : [];
                    context.inactivatedMysteryThreads.push(...inactivatedThreads);
                }
                const resolvedBoxes = mysteryResolution.resolvedBoxes || [];
                if (resolvedBoxes.length) {
                    context.resolvedMysteryBoxes = Array.isArray(context.resolvedMysteryBoxes)
                        ? context.resolvedMysteryBoxes
                        : [];
                    context.resolvedMysteryBoxes.push(...resolvedBoxes);
                }
                for (const entry of entries) {
                    const box = await this._runMysteryBoxUpdatePrompt(entry, context);
                    if (box) {
                        context.mysteryBoxUpdates.push(box);
                    }
                }
            },
            party_change: function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const player = context.player || this.currentPlayer;
                const { findActorByName } = this._deps;

                for (const entry of entries) {
                    const npc = findActorByName?.(entry.name);
                    if (!npc) {
                        continue;
                    }
                    if (entry.action === "joined") {
                        player.addPartyMember(npc.id);
                    } else if (entry.action === "left") {
                        player.removePartyMember(npc.id);
                    }
                }
            },
            trade_availability: function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const { findActorByName } = this._deps;
                if (typeof findActorByName !== "function") {
                    throw new Error(
                        "trade_availability handler requires findActorByName dependency.",
                    );
                }
                const now = typeof Globals.getTotalWorldMinutes === "function"
                    ? Globals.getTotalWorldMinutes()
                    : 0;
                const refusalMinutesRaw =
                    Globals.config?.barter?.refusal_duration_minutes ?? 1440;
                const refusalMinutes = Number(refusalMinutesRaw);
                if (!Number.isInteger(refusalMinutes) || refusalMinutes < 1) {
                    throw new Error(
                        "barter.refusal_duration_minutes must be a positive integer.",
                    );
                }

                for (const entry of entries) {
                    const npc = findActorByName(entry.name);
                    if (!npc || typeof npc.setWillingToTrade !== "function") {
                        continue;
                    }
                    npc.setWillingToTrade(Boolean(entry.willingToTrade), {
                        refusalExpiresAt: entry.willingToTrade
                            ? null
                            : now + refusalMinutes,
                    });
                }
            },
            disposition_check: function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }

                const { findActorByName } = this._deps;
                if (typeof findActorByName !== "function") {
                    throw new Error(
                        "disposition_check handler requires findActorByName dependency.",
                    );
                }

                const definitions = Player.getDispositionDefinitions?.();
                const range = definitions?.range || {};
                const typeDefinitions = Object.values(
                    definitions?.types || {},
                ).filter(Boolean);
                const defaultType =
                    typeDefinitions.find((entry) => entry?.key === "platonic") ||
                    typeDefinitions.find((entry) => entry?.key === "default") ||
                    typeDefinitions[0] ||
                    null;
                if (!defaultType?.key) {
                    throw new Error(
                        "disposition_check handler requires disposition definitions.",
                    );
                }

                const minRange = Number.isFinite(Number(range.min))
                    ? Number(range.min)
                    : null;
                const maxRange = Number.isFinite(Number(range.max))
                    ? Number(range.max)
                    : null;
                const typicalStep = Number.isFinite(Number(range.typicalStep))
                    ? Math.max(1, Math.round(Number(range.typicalStep)))
                    : 1;

                if (!Array.isArray(context.dispositionChanges)) {
                    context.dispositionChanges = [];
                }

                const appliedEntries = [];
                const failures = [];
                for (const entry of entries) {
                    try {
                        const npcName = normalizeString(entry?.npcName);
                        const beforeFeeling = normalizeString(entry?.before);
                        const afterFeeling = normalizeString(entry?.after);
                        if (!npcName || !beforeFeeling || !afterFeeling) {
                            continue;
                        }

                        const direction = resolveDispositionDirection(
                            beforeFeeling,
                            afterFeeling,
                        );
                        if (direction === 0) {
                            continue;
                        }

                        const npc = findActorByName(npcName);
                        if (!npc || npc === (context.player || this.currentPlayer)) {
                            continue;
                        }
                        if (
                            typeof npc.getDispositionTowardsCurrentPlayer !== "function" ||
                            typeof npc.setDispositionTowardsCurrentPlayer !== "function"
                        ) {
                            throw new Error(
                                `disposition_check handler requires disposition methods for ${npc.name || npcName}.`,
                            );
                        }

                        const previousRaw = npc.getDispositionTowardsCurrentPlayer(
                            defaultType.key,
                        );
                        const previousValue = Number.isFinite(Number(previousRaw))
                            ? Number(previousRaw)
                            : 0;
                        let newValue = previousValue + direction * typicalStep;
                        if (Number.isFinite(minRange)) {
                            newValue = Math.max(minRange, newValue);
                        }
                        if (Number.isFinite(maxRange)) {
                            newValue = Math.min(maxRange, newValue);
                        }

                        npc.setDispositionTowardsCurrentPlayer(defaultType.key, newValue);

                        const delta = newValue - previousValue;
                        if (!delta) {
                            continue;
                        }

                        const applied = {
                            npcId: npc.id || null,
                            npcName: npc.name || npcName,
                            typeKey: defaultType.key,
                            typeLabel: defaultType.label || defaultType.key,
                            before: beforeFeeling,
                            after: afterFeeling,
                            reason: entry?.reason ? String(entry.reason).trim() : null,
                            delta,
                            previousValue,
                            newValue,
                        };
                        context.dispositionChanges.push(applied);
                        appliedEntries.push({
                            ...entry,
                            npcName: applied.npcName,
                            delta,
                            previousValue,
                            newValue,
                            typeKey: applied.typeKey,
                            typeLabel: applied.typeLabel,
                        });
                    } catch (error) {
                        failures.push({ entry, error });
                    }
                }
                this._warnEventEntryFailures("disposition_check", failures);

                entries.length = 0;
                if (appliedEntries.length) {
                    entries.push(...appliedEntries);
                }
            },
            faction_reputation_change: function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }

                const player = context.player || this.currentPlayer;
                if (
                    !player ||
                    typeof player.getFactionStanding !== "function" ||
                    typeof player.setFactionStanding !== "function"
                ) {
                    throw new Error(
                        "faction_reputation_change handler requires player faction standing helpers.",
                    );
                }

                if (!Array.isArray(context.factionReputationChanges)) {
                    context.factionReputationChanges = [];
                }

                const witnessByFaction = new Map();
                const addWitnessToMap = (actor) => {
                    if (!actor || typeof actor !== "object") {
                        return;
                    }
                    const factionId =
                        typeof actor.factionId === "string"
                            ? actor.factionId.trim()
                            : "";
                    if (!factionId) {
                        return;
                    }
                    witnessByFaction.set(factionId, true);
                };

                addWitnessToMap(player);
                const partyMemberIdsRaw =
                    typeof player.getPartyMembers === "function"
                        ? player.getPartyMembers()
                        : [];
                const partyMemberIds = Array.isArray(partyMemberIdsRaw)
                    ? partyMemberIdsRaw
                    : [];
                partyMemberIds.forEach((memberId) => {
                    const partyMember = Player.get(memberId);
                    addWitnessToMap(partyMember);
                });

                const location = context.location || null;
                if (location && typeof location.getNPCs === "function") {
                    location.getNPCs().forEach((npc) => addWitnessToMap(npc));
                }

                const appliedEntries = [];
                for (const entry of entries) {
                    const amount = Number(entry?.amount);
                    if (!Number.isFinite(amount) || amount === 0) {
                        continue;
                    }

                    const faction =
                        resolveFactionByReference(entry?.factionId) ||
                        resolveFactionByReference(entry?.factionName) ||
                        resolveFactionByReference(entry?.rawFaction);
                    if (!faction?.id) {
                        console.warn(
                            `faction_reputation_change references unknown faction "${entry?.rawFaction || entry?.factionName || ""}"; skipping.`,
                        );
                        continue;
                    }

                    if (!witnessByFaction.has(faction.id)) {
                        continue;
                    }

                    const beforeRaw = player.getFactionStanding(faction.id);
                    const before = Number.isFinite(beforeRaw) ? beforeRaw : 0;
                    const after = before + amount;
                    player.setFactionStanding(faction.id, after);

                    const applied = {
                        factionId: faction.id,
                        factionName: faction.name || faction.id,
                        amount,
                        before,
                        after,
                        reason: entry?.reason ? String(entry.reason).trim() : null,
                    };
                    context.factionReputationChanges.push(applied);
                    appliedEntries.push({
                        ...entry,
                        factionId: applied.factionId,
                        factionName: applied.factionName,
                        before,
                        after,
                    });
                }

                entries.length = 0;
                if (appliedEntries.length) {
                    entries.push(...appliedEntries);
                }
            },
            hostile_to_friendly: function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }

                const { findActorByName } = this._deps;
                if (typeof findActorByName !== "function") {
                    throw new Error(
                        "hostile_to_friendly handler requires findActorByName dependency.",
                    );
                }

                const dispositionDefinitions = Player.getDispositionDefinitions?.();
                const dispositionTypes = Object.values(
                    dispositionDefinitions?.types || {},
                ).filter(Boolean);

                if (!dispositionTypes.length) {
                    throw new Error(
                        "hostile_to_friendly handler requires disposition definitions.",
                    );
                }

                const filteredEntries = [];
                const failures = [];

                for (const entry of entries) {
                    try {
                        if (!entry?.name) {
                            continue;
                        }

                        const npc = findActorByName(entry.name);
                        if (!npc || npc.isHostile !== true) {
                            continue;
                        }

                        if (
                            typeof npc.getDispositionTowardsCurrentPlayer !== "function" ||
                            typeof npc.setDispositionTowardsCurrentPlayer !== "function"
                        ) {
                            throw new Error(
                                `hostile_to_friendly handler requires disposition methods for ${npc.name || entry.name}.`,
                            );
                        }

                        for (const typeDef of dispositionTypes) {
                            const key = typeDef.key || typeDef.label;
                            if (!key) {
                                continue;
                            }
                            const currentValue =
                                npc.getDispositionTowardsCurrentPlayer(key) ?? 0;
                            const nextValue = Math.max(0, Number(currentValue) || 0);
                            npc.setDispositionTowardsCurrentPlayer(key, nextValue);
                        }

                        npc.isHostile = false;

                        filteredEntries.push(entry);
                    } catch (error) {
                        failures.push({ entry, error });
                    }
                }
                this._warnEventEntryFailures("hostile_to_friendly", failures);

                entries.length = 0;
                if (filteredEntries.length) {
                    entries.push(...filteredEntries);
                }
            },
            status_effect_change: async function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const {
                    findActorByName,
                    promptEnv,
                    parseXMLTemplate,
                    prepareBasePromptContext,
                } = this._deps;
                console.log("Processing status_effect_change entries:", entries);

                const recordSuppressedStatusEffectChange = (entry) => {
                    if (!entry || typeof entry !== "object") {
                        return;
                    }
                    if (!Array.isArray(context.suppressedStatusEffectChanges)) {
                        context.suppressedStatusEffectChanges = [];
                    }
                    context.suppressedStatusEffectChanges.push({
                        entity: entry.entity,
                        detail: entry.detail,
                        description: entry.description,
                        action: entry.action,
                        level: entry.level,
                    });
                };

                const itemInflictByEntity = new Map();
                if (Array.isArray(context.itemTriggeredStatusChanges)) {
                    for (const statusChange of context.itemTriggeredStatusChanges) {
                        const entityKey = normalizeString(
                            statusChange?.entity,
                        ).toLowerCase();
                        const detailKey = normalizeStatusEffectDescription(
                            statusChange?.description || statusChange?.detail,
                        );
                        if (!entityKey || !detailKey) {
                            continue;
                        }
                        if (!itemInflictByEntity.has(entityKey)) {
                            itemInflictByEntity.set(entityKey, []);
                        }
                        const bucket = itemInflictByEntity.get(entityKey);
                        if (!bucket.includes(detailKey)) {
                            bucket.push(detailKey);
                        }
                    }
                }

                if (itemInflictByEntity.size) {
                    const filteredEntries = [];
                    for (const entry of entries) {
                        const action =
                            normalizeString(entry?.action).toLowerCase() || "";
                        if (action !== "gained") {
                            filteredEntries.push(entry);
                            continue;
                        }

                        const entityKey = normalizeString(entry?.entity).toLowerCase();
                        const detailKey = normalizeStatusEffectDescription(
                            entry?.detail,
                        );
                        const itemInflictDescriptions =
                            itemInflictByEntity.get(entityKey) || null;
                        if (
                            !entityKey ||
                            !detailKey ||
                            !Array.isArray(itemInflictDescriptions) ||
                            !itemInflictDescriptions.length
                        ) {
                            filteredEntries.push(entry);
                            continue;
                        }

                        const isDuplicate = itemInflictDescriptions.some(
                            (itemInflictDetail) =>
                                detailKey === itemInflictDetail ||
                                detailKey.startsWith(itemInflictDetail),
                        );

                        if (isDuplicate) {
                            recordSuppressedStatusEffectChange(entry);
                            console.debug(
                                `[status_effect_change] Skipping duplicate "${entry.detail}" for "${entry.entity}" because an item-triggered event already applied the effect.`,
                            );
                            continue;
                        }

                        filteredEntries.push(entry);
                    }

                    entries.length = 0;
                    if (filteredEntries.length) {
                        entries.push(...filteredEntries);
                    }
                    if (!entries.length) {
                        return;
                    }
                }

                const gainEntries = entries.filter(
                    (entry) => entry?.action === "gained" && entry.detail,
                );
                let generatedEffects = null;
                let generatedEffectsByKey = null;
                if (gainEntries.length) {
                    try {
                        const fallbackLevel = Number.isFinite(Globals.location?.baseLevel)
                            ? Globals.location.baseLevel
                            : null;
                        const groupedEffects = new Map();
                        for (const entry of gainEntries) {
                            const detail =
                                typeof entry.detail === "string"
                                    ? entry.detail.trim()
                                    : "";
                            if (!detail) {
                                continue;
                            }
                            const key = detail.toLowerCase();
                            const level = Number.isFinite(entry.level)
                                ? entry.level
                                : fallbackLevel;
                            if (!groupedEffects.has(key)) {
                                groupedEffects.set(key, { detail, level });
                                continue;
                            }
                            const existing = groupedEffects.get(key);
                            if (!Number.isFinite(existing.level) && Number.isFinite(level)) {
                                existing.level = level;
                            } else if (
                                Number.isFinite(existing.level) &&
                                Number.isFinite(level)
                            ) {
                                existing.level = Math.max(existing.level, level);
                            }
                        }

                        const seeds = Array.from(groupedEffects.values()).map(
                            (entry) => ({
                                name: entry.detail,
                                description: entry.detail,
                                level: Number.isFinite(entry.level)
                                    ? entry.level
                                    : fallbackLevel,
                            }),
                        );

                        if (seeds.length) {
                            generatedEffects = StatusEffect.generateFromDescriptions(
                                seeds,
                                { promptEnv, parseXMLTemplate, prepareBasePromptContext },
                            );
                        }
                    } catch (error) {
                        console.warn(
                            "Failed to generate status effects via LLM:",
                            error?.message || error,
                        );
                    }
                }

                const duplicateGeneratedEntries = new Set();
                for (const entry of entries) {
                    entry.description = entry.detail;
                    if (entry.entity) {
                        this.alteredCharacters.add(entry.entity);
                    }
                    const entity = findActorByName?.(entry.entity);
                    if (!entity) {
                        continue;
                    }
                    if (
                        entry.action === "gained" &&
                        typeof entity.addStatusEffect === "function"
                    ) {
                        let effectToApply = null;
                        if (generatedEffects instanceof Promise) {
                            // If generation is async, wait once and reuse.
                            generatedEffects = generatedEffects.catch((err) => {
                                console.warn(
                                    "Status effect generation promise failed:",
                                    err?.message || err,
                                );
                                return null;
                            });
                        }
                        if (
                            generatedEffects &&
                            typeof generatedEffects.then === "function"
                        ) {
                            // eslint-disable-next-line no-await-in-loop
                            generatedEffects = await generatedEffects;
                        }
                        if (generatedEffects instanceof Map) {
                            if (!generatedEffectsByKey) {
                                generatedEffectsByKey = new Map();
                                for (const [sourceDescription, effect] of generatedEffects.entries()) {
                                    if (
                                        typeof sourceDescription === "string" &&
                                        sourceDescription.trim()
                                    ) {
                                        generatedEffectsByKey.set(
                                            sourceDescription.trim().toLowerCase(),
                                            effect,
                                        );
                                    }
                                }
                            }
                            const detailKey =
                                typeof entry.detail === "string"
                                    ? entry.detail.trim().toLowerCase()
                                    : "";
                            if (detailKey && generatedEffectsByKey.has(detailKey)) {
                                effectToApply = generatedEffectsByKey.get(detailKey);
                            }
                        }
                        if (!effectToApply) {
                            effectToApply = makeStatusEffect(
                                entry.detail,
                                this.DEFAULT_STATUS_DURATION,
                            );
                        }
                        const effectOccurrence = effectToApply instanceof StatusEffect
                            ? effectToApply.toJSON()
                            : { ...effectToApply };
                        const generatedNameKey = normalizeStatusEffectDescription(
                            effectOccurrence?.name,
                        );
                        const generatedDescriptionKey = normalizeStatusEffectDescription(
                            effectOccurrence?.description,
                        );
                        const entityKey = normalizeString(entry?.entity).toLowerCase();
                        const duplicatesItemTriggeredEffect = Array.isArray(
                            context.itemTriggeredStatusChanges,
                        ) && context.itemTriggeredStatusChanges.some((change) => {
                            if (
                                normalizeString(change?.entity).toLowerCase()
                                !== entityKey
                            ) {
                                return false;
                            }
                            const itemNameKey = normalizeStatusEffectDescription(
                                change?.name,
                            );
                            const itemDescriptionKey = normalizeStatusEffectDescription(
                                change?.description || change?.detail,
                            );
                            return Boolean(
                                (generatedNameKey && (
                                    generatedNameKey === itemNameKey
                                    || generatedNameKey === itemDescriptionKey
                                ))
                                || (generatedDescriptionKey && (
                                    generatedDescriptionKey === itemNameKey
                                    || generatedDescriptionKey === itemDescriptionKey
                                )),
                            );
                        });
                        if (duplicatesItemTriggeredEffect) {
                            recordSuppressedStatusEffectChange(entry);
                            duplicateGeneratedEntries.add(entry);
                            console.debug(
                                `[status_effect_change] Skipping generated duplicate "${entry.detail}" for "${entry.entity}" because an item-triggered event already applied the same structured effect.`,
                            );
                            continue;
                        }
                        // Generated effects are templates too. A new gain starts
                        // now, regardless of the generator/template timestamp.
                        delete effectOccurrence.appliedAt;
                        entity.addStatusEffect(effectOccurrence);
                    } else if (
                        entry.action === "lost" &&
                        typeof entity.removeStatusEffect === "function"
                    ) {
                        entity.removeStatusEffect(entry.detail);
                    }
                }
                if (duplicateGeneratedEntries.size) {
                    const retainedEntries = entries.filter(
                        (entry) => !duplicateGeneratedEntries.has(entry),
                    );
                    entries.length = 0;
                    entries.push(...retainedEntries);
                }
            },
            heal_recover: function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const { findActorByName } = this._deps;
                for (const entry of entries) {
                    const targetName = entry.character || entry.recipient;
                    const magnitude = entry.magnitude || entry.effect || "small";
                    const actor = targetName ? findActorByName?.(targetName) : null;
                    if (!actor || typeof actor.modifyHealth !== "function") {
                        continue;
                    }
                    const amount = this._estimateHealingAmount(magnitude, actor);
                    actor.modifyHealth(
                        amount,
                        entry.reason || entry.effect || "Recovered",
                    );
                }
            },
            needbar_change: function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const { findActorByName } = this._deps;
                if (!Array.isArray(context.needBarChanges)) {
                    context.needBarChanges = [];
                }
                for (const entry of entries) {
                    const actor = findActorByName?.(entry.character);
                    if (!actor || typeof actor.applyNeedBarChange !== "function") {
                        continue;
                    }
                    if (entry.magnitude.toLowerCase() === "none") {
                        continue;
                    }
                    const change = actor.applyNeedBarChange(entry.bar, {
                        direction: entry.direction,
                        magnitude: entry.magnitude,
                        reason: entry.reason,
                    });
                    if (change) {
                        context.needBarChanges.push(change);
                    }
                    if (entry.character) {
                        this.alteredCharacters.add(entry.character);
                    }
                }
            },
            environmental_status_damage: function (entries = [], context = {}) {
                if (
                    context.allowEnvironmentalEffects === false ||
                    !Array.isArray(entries) ||
                    !entries.length
                ) {
                    return;
                }
                const { findActorByName } = this._deps;
                if (!Array.isArray(context.environmentalDamageEvents)) {
                    context.environmentalDamageEvents = [];
                }
                for (const entry of entries) {
                    const actor = findActorByName?.(entry.name);
                    if (!actor || typeof actor.modifyHealth !== "function") {
                        continue;
                    }
                    const effect = entry.effect || "damage";
                    const severity = entry.severity || "medium";
                    const amount = this._severityToDamage(severity, context);
                    const delta = effect === "healing" ? amount : -amount;
                    const result = actor.modifyHealth(
                        delta,
                        entry.reason || "Environmental effect",
                    );
                    context.environmentalDamageEvents.push({
                        name: entry.name,
                        type: effect === "healing" ? "healing" : "damage",
                        severity,
                        reason: entry.reason || "",
                        amount: result?.change ?? Math.abs(delta),
                    });
                }
            },
            attack_damage: function (entries = [], context = {}) {
                const { findActorByName } = this._deps;
                if (!Array.isArray(entries) || !entries.length || typeof findActorByName !== "function") {
                    return;
                }
                for (const entry of entries) {
                    const attacker = findActorByName(entry?.attacker);
                    if (!attacker || attacker.hiddenFromPlayer !== true || attacker.isDead === true) {
                        continue;
                    }
                    attacker.hiddenFromPlayer = false;
                    context.locationRefreshRequested = true;
                }
            },
            death_incapacitation: function (entries = []) {
                const { findActorByName } = this._deps;
                for (const entry of entries) {
                    const actor = findActorByName?.(entry.name);
                    if (!actor || typeof actor.modifyHealth !== "function") {
                        continue;
                    }
                    if (entry.status === "dead") {
                        if (actor.isNPC && actor.isDead) {
                            continue;
                        }
                        const currentHealth = Number(actor.health);
                        if (Number.isFinite(currentHealth) && currentHealth > 0) {
                            actor.modifyHealth(-currentHealth, "Killed");
                        }
                        actor.isDead = true;
                        if (typeof actor.addStatusEffect === "function") {
                            actor.addStatusEffect(makeStatusEffect("Deceased", null));
                        }
                    } else {
                        if (typeof actor.addStatusEffect === "function") {
                            actor.addStatusEffect(makeStatusEffect("Incapacitated", null));
                        }
                    }
                }
            },
            defeated_enemy: function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const player = context.player || this.currentPlayer;
                if (!player || typeof player.addExperience !== "function") {
                    return;
                }
                const { findActorByName } = this._deps;
                const awards = [];
                for (const name of entries) {
                    const enemy = findActorByName?.(name);
                    const level =
                        Number(enemy?.level) || Number(context.location?.baseLevel) || 1;
                    const xp = Math.ceil(
                        Math.max(25, Math.round(level * 50) / player.level),
                    );
                    awards.push({ amount: xp, reason: `Defeated ${name}` });
                    player.addExperience(xp);
                    if (name) {
                        this.defeatedEnemies.add(name);
                    }
                }
                if (!Array.isArray(context.experienceAwards)) {
                    context.experienceAwards = [];
                }
                context.experienceAwards.push(...awards);
            },
            experience_check: function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const player = context.player || this.currentPlayer;
                if (this.defeatedEnemies.size) {
                    return;
                }
                if (!Array.isArray(context.experienceAwards)) {
                    context.experienceAwards = [];
                }
                for (const entry of entries) {
                    let award = Math.ceil(
                        (entry.amount * Math.max(Globals.location.baseLevel, 1)) /
                        player.level,
                    );
                    player.addExperience(award);
                    context.experienceAwards.push({
                        amount: award,
                        reason: entry.reason || "Accomplishment",
                    });
                }
            },
            move_location: async function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const destinationInput = entries[entries.length - 1];
                const destinationName =
                    typeof destinationInput === "string" ? destinationInput.trim() : "";
                if (!destinationName) {
                    return;
                }
                // De-dupe repeated move events for the same destination in a single turn.
                // Separate protection for second moves to different destinations lives in
                // movePlayerToDestination via Globals.processedMove.
                // Do not pre-add to movedLocations here; movePlayerToDestination records it
                // only after a verified location write.
                if (Events.movedLocations.has(destinationName)) {
                    return;
                }
                try {
                    await movePlayerToDestination(this, destinationName, context, {
                        fallbackName: destinationName,
                        label: "move_location",
                    });
                } catch (error) {
                    throw new Error(
                        `Failed to move player location to "${destinationName}": ${error.message}`,
                    );
                }
            },
        };
    }

    static _getRegisteredPlayerEntityFields(filter = {}) {
        const registry = Globals.modExtensionRegistry || this._deps?.modExtensionRegistry || null;
        if (!registry || typeof registry.getEntityFields !== "function") {
            return [];
        }
        return registry.getEntityFields("player", filter);
    }

    static _normalizeRegisteredPlayerFieldValue(value, field, sourceLabel = "registered Player field") {
        if (value === undefined || value === null) {
            return undefined;
        }
        if (typeof value === "string") {
            const trimmed = value.trim();
            if (!trimmed || trimmed.toLowerCase() === "n/a") {
                return undefined;
            }
            value = trimmed;
        }

        switch (field.type) {
            case "string":
                return String(value).trim();
            case "number": {
                const numeric = Number(value);
                if (!Number.isFinite(numeric)) {
                    throw new Error(`${sourceLabel} "${field.fieldName}" must be a finite number.`);
                }
                return numeric;
            }
            case "integer": {
                const numeric = Number(value);
                if (!Number.isInteger(numeric)) {
                    throw new Error(`${sourceLabel} "${field.fieldName}" must be an integer.`);
                }
                return numeric;
            }
            case "boolean": {
                if (typeof value === "boolean") {
                    return value;
                }
                if (typeof value === "number") {
                    if (value === 1) return true;
                    if (value === 0) return false;
                }
                if (typeof value === "string") {
                    const normalized = value.trim().toLowerCase();
                    if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
                    if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
                }
                throw new Error(`${sourceLabel} "${field.fieldName}" must be true or false.`);
            }
            case "array": {
                const parsed = Array.isArray(value)
                    ? value
                    : (typeof value === "string" ? JSON.parse(value) : value);
                if (!Array.isArray(parsed)) {
                    throw new Error(`${sourceLabel} "${field.fieldName}" must be a JSON array.`);
                }
                return parsed;
            }
            case "object": {
                const parsed = value && typeof value === "object" && !Array.isArray(value)
                    ? value
                    : (typeof value === "string" ? JSON.parse(value) : value);
                if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                    throw new Error(`${sourceLabel} "${field.fieldName}" must be a JSON object.`);
                }
                return parsed;
            }
            default:
                throw new Error(`Unsupported registered Player field type "${field.type}" for "${field.fieldName}".`);
        }
    }

    static _collectPlayerExtensionFieldsForPrompt(actor, status = {}, fields = null) {
        const playerFields = Array.isArray(fields)
            ? fields
            : this._getRegisteredPlayerEntityFields();
        const values = {};
        for (const field of playerFields) {
            if (!field || typeof field.fieldName !== "string") {
                continue;
            }
            let value;
            if (status && Object.prototype.hasOwnProperty.call(status, field.fieldName)) {
                value = status[field.fieldName];
            } else if (actor && typeof actor.getExtensionField === "function") {
                value = actor.getExtensionField(field.fieldName);
            } else if (actor && Object.prototype.hasOwnProperty.call(actor, field.fieldName)) {
                value = actor[field.fieldName];
            }
            if (value === undefined || value === null || (typeof value === "string" && !value.trim())) {
                continue;
            }
            values[field.fieldName] = value;
        }
        return values;
    }

    static _getPlayerExtensionFieldInputsFromXmlNode(node, fields = null, sourceLabel = "registered Player field") {
        if (!node) {
            return {};
        }
        const parserFields = Array.isArray(fields)
            ? fields
            : this._getRegisteredPlayerEntityFields({ exposeToXmlParser: true });
        const inputs = {};
        for (const field of parserFields) {
            const tagName = field?.xmlPrompt?.tagName || field?.fieldName;
            if (!field || typeof field.fieldName !== "string" || typeof tagName !== "string") {
                continue;
            }
            const valueNode = node.getElementsByTagName(tagName)[0] || null;
            if (!valueNode || typeof valueNode.textContent !== "string") {
                continue;
            }
            const value = this._normalizeRegisteredPlayerFieldValue(
                valueNode.textContent,
                field,
                sourceLabel,
            );
            if (value !== undefined) {
                inputs[field.fieldName] = value;
            }
        }
        return inputs;
    }

    static async _handleAlterNpcEvents(entries, context = {}) {
        const {
            findActorByName,
            promptEnv,
            parseXMLTemplate,
            prepareBasePromptContext,
            Location,
            findRegionByLocationId,
            findThingByName,
            generatedImages,
        } = this._deps;

        if (typeof findActorByName !== "function") {
            throw new Error("alter_npc handler requires findActorByName dependency.");
        }
        if (typeof promptEnv?.render !== "function") {
            throw new Error(
                "alter_npc handler requires promptEnv.render dependency.",
            );
        }
        if (typeof parseXMLTemplate !== "function") {
            throw new Error(
                "alter_npc handler requires parseXMLTemplate dependency.",
            );
        }
        if (typeof prepareBasePromptContext !== "function") {
            throw new Error(
                "alter_npc handler requires prepareBasePromptContext dependency.",
            );
        }

        const config = this.config || {};
        const aiConfig = config?.ai;

        if (!aiConfig) {
            throw new Error(
                "AI configuration missing; cannot process alter_npc events.",
            );
        }

        const defaultTemperature =
            typeof aiConfig.temperature === "number" ? aiConfig.temperature : 0.6;

        const summaries = [];

        for (const entry of entries) {
            if (!entry || typeof entry.name !== "string" || !entry.name.trim()) {
                throw new Error("alter_npc entry is missing a character name.");
            }

            const npcName = entry.name.trim();
            const npc = findActorByName(npcName);
            if (!npc) {
                throw new Error(
                    `alter_npc entry references unknown character "${npcName}".`,
                );
            }
            const isNpcEntity =
                typeof npc.isNPC === "function" ? npc.isNPC() : Boolean(npc.isNPC);
            if (!isNpcEntity) {
                console.log("Skipping alteration of player character:", npcName);
                continue;
            }

            let location = context.location || null;
            if (
                !location &&
                npc.currentLocation &&
                Location &&
                typeof Location.get === "function"
            ) {
                try {
                    location = Location.get(npc.currentLocation) || null;
                } catch (error) {
                    location = null;
                }
            }

            if (!context.location && location) {
                context.location = location;
            }

            let region = context.region || null;
            if (!region && location && typeof findRegionByLocationId === "function") {
                try {
                    region = findRegionByLocationId(location.id) || null;
                } catch (error) {
                    region = null;
                }
            }

            if (!context.region && region) {
                context.region = region;
            }

            const baseContext = await prepareBasePromptContext({
                locationOverride: location,
            });
            const npcStatus =
                typeof npc.getStatus === "function"
                    ? npc.getStatus()
                    : typeof npc.toJSON === "function"
                        ? npc.toJSON()
                        : {};
            const registeredPlayerEntityFields = this._getRegisteredPlayerEntityFields();
            const registeredPlayerPromptFields = this._getRegisteredPlayerEntityFields({ exposeToGeneratorPrompt: true })
                .filter(field => field && field.xmlPrompt && typeof field.xmlPrompt.tagName === "string");
            const playerExtensionFields = this._collectPlayerExtensionFieldsForPrompt(
                npc,
                npcStatus,
                registeredPlayerEntityFields,
            );

            const attributeSnapshot = {};
            const attributeDefinitions = npc.attributeDefinitions || {};
            for (const attrName of Object.keys(attributeDefinitions)) {
                if (!attrName) {
                    continue;
                }
                if (typeof npc.getAttributeTextValue === "function") {
                    attributeSnapshot[attrName] = npc.getAttributeTextValue(attrName);
                } else {
                    const info = npcStatus?.attributeInfo?.[attrName];
                    attributeSnapshot[attrName] =
                        info?.modifiedValue ?? info?.value ?? "";
                }
            }

            const existingAbilities = Array.isArray(npcStatus?.abilities)
                ? npcStatus.abilities
                : typeof npc.getAbilities === "function"
                    ? npc.getAbilities()
                    : [];
            const existingStatusEffects = Array.isArray(npcStatus?.statusEffects)
                ? npcStatus.statusEffects
                : typeof npc.getStatusEffects === "function"
                    ? npc.getStatusEffects()
                    : [];
            const existingInventory = Array.isArray(npcStatus?.inventory)
                ? npcStatus.inventory.map((item) => item?.name || item)
                : typeof npc.getInventoryItems === "function"
                    ? npc.getInventoryItems().map((item) => item?.name || item?.id)
                    : [];

            const alteredCharacter = {
                name: npc.name,
                description: npc.description,
                shortDescription: npc.shortDescription,
                role: npcStatus?.role || npcStatus?.class || "",
                class: npcStatus?.class || npc.class,
                race: npcStatus?.race || npc.race,
                ...playerExtensionFields,
                relativeLevel: npcStatus?.relativeLevel ?? null,
                currency:
                    typeof npc.getCurrency === "function"
                        ? npc.getCurrency()
                        : (npcStatus?.currency ?? null),
                attributes: attributeSnapshot,
                personality: {
                    type: npc.personalityType,
                    traits: npc.personalityTraits,
                    notes: npc.personalityNotes,
                    aiNotes: npc.aiNotes,
                },
                aiNotes: npc.aiNotes,
                statusEffects: existingStatusEffects,
                abilities: existingAbilities,
                inventory: existingInventory,
            };

            const characterSeed = {
                name: npc.name,
                description: npc.description,
                shortDescription: npc.shortDescription,
                role: alteredCharacter.role,
                class: npc.class,
                race: npc.race,
                ...playerExtensionFields,
                relativeLevel: alteredCharacter.relativeLevel,
                currency: alteredCharacter.currency,
                personality: {
                    type: npc.personalityType,
                    traits: npc.personalityTraits,
                    notes: npc.personalityNotes,
                    aiNotes: npc.aiNotes,
                },
                aiNotes: npc.aiNotes,
            };

            const changeDescription =
                entry.description || entry.changeDescription || "";
            const promptPayload = {
                ...baseContext,
                promptType: "character-alter",
                changeDescription,
                alteredCharacter,
                characterSeed,
                playerGeneratorPromptFields: registeredPlayerPromptFields.length
                    ? registeredPlayerPromptFields
                    : baseContext.playerGeneratorPromptFields,
            };

            let promptData;
            try {
                const renderedTemplate = promptEnv.render(
                    "base-context.xml.njk",
                    promptPayload,
                );
                promptData = parseXMLTemplate(renderedTemplate);
            } catch (error) {
                throw new Error(
                    `Failed to render character alteration template for "${npcName}": ${error.message}`,
                );
            }

            if (!promptData?.systemPrompt || !promptData?.generationPrompt) {
                throw new Error(
                    `Character alteration template for "${npcName}" did not produce prompts.`,
                );
            }

            const messages = [
                { role: "system", content: promptData.systemPrompt },
                { role: "user", content: promptData.generationPrompt },
            ];

            let requestPayloadForLog = null;
            let responsePayloadForLog = null;
            const requestOptions = {
                messages,
                metadataLabel: "alter_npc",
                timeoutMs: this._baseTimeout,
                requiredRegex: /<npc\b[\s\S]*?<\/npc>/i,
                captureRequestPayload: (payload) => {
                    requestPayloadForLog = payload;
                },
                captureResponsePayload: (payload) => {
                    responsePayloadForLog = payload;
                },
            };

            if (typeof promptData.temperature === "number") {
                requestOptions.temperature = promptData.temperature;
            } else if (Number.isInteger(defaultTemperature)) {
                requestOptions.temperature = defaultTemperature;
            }

            let aiContent;
            try {
                aiContent = await LLMClient.chatCompletion(requestOptions);
            } catch (error) {
                throw new Error(
                    `Alter NPC request failed for "${npcName}": ${error.message}`,
                );
            }

            if (!aiContent.trim()) {
                throw new Error(`Alter NPC response for "${npcName}" was empty.`);
            }

            const safeName =
                (npc.name || "npc")
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "_")
                    .replace(/^_+|_+$/g, "") || "npc";
            LLMClient.logPrompt({
                prefix: `alter_npc_${safeName}`,
                metadataLabel: "alter_npc",
                systemPrompt: promptData.systemPrompt,
                generationPrompt: promptData.generationPrompt,
                response: aiContent.trim() || "(empty response)",
                requestPayload: requestPayloadForLog,
                responsePayload: responsePayloadForLog,
            });

            const parsedCharacter = this._parseCharacterAlterXml(aiContent);
            if (!parsedCharacter) {
                throw new Error(
                    `Failed to parse character alteration response for "${npcName}".`,
                );
            }

            const summary = this._applyCharacterAlteration({
                npc,
                entry: { ...entry, changeDescription },
                parsedCharacter,
                location,
                region,
                generatedImages,
                findThingByName,
            });

            summaries.push(summary);
            if (summary.name) {
                this.alteredCharacters.add(summary.name);
            }
        }

        if (summaries.length) {
            if (!Array.isArray(context.alteredCharacters)) {
                context.alteredCharacters = [];
            }
            context.alteredCharacters.push(...summaries);
        }
    }

    static async _applyCharacterAlteration({
        npc,
        entry,
        parsedCharacter,
        location,
        region,
        generatedImages,
        findThingByName,
    }) {
        if (!npc || !parsedCharacter) {
            throw new Error(
                "applyCharacterAlteration requires an NPC and parsed character data.",
            );
        }

        const summary = {
            npcId: npc.id,
            originalName: npc.name,
            name: npc.name,
            changeDescription: entry?.changeDescription || "",
        };

        let activeLocation = location;
        if (!activeLocation) {
            const { Location } = this._deps;
            if (
                Location &&
                typeof Location.get === "function" &&
                npc.currentLocation
            ) {
                try {
                    activeLocation = Location.get(npc.currentLocation) || null;
                } catch (error) {
                    activeLocation = null;
                }
            }
        }

        if (activeLocation) {
            this._clearLocationImage(activeLocation, generatedImages);
        }

        if (npc.imageId) {
            if (generatedImages instanceof Map) {
                generatedImages.delete(npc.imageId);
            } else if (generatedImages && typeof generatedImages === "object") {
                delete generatedImages[npc.imageId];
            }
            try {
                npc.imageId = null;
            } catch (error) {
                // Ignore immutable imageId setters
            }
        }

        if (
            parsedCharacter.name &&
            parsedCharacter.name.trim() &&
            parsedCharacter.name.trim() !== npc.name
        ) {
            if (typeof npc.setName !== "function") {
                throw new Error(
                    `NPC "${npc.name}" cannot be renamed; missing setName method.`,
                );
            }
            npc.setName(parsedCharacter.name.trim());
            summary.name = npc.name;
        }

        if (parsedCharacter.description && parsedCharacter.description.trim()) {
            npc.description = parsedCharacter.description.trim();
        }

        if (
            parsedCharacter.shortDescription &&
            parsedCharacter.shortDescription.trim()
        ) {
            npc.shortDescription = parsedCharacter.shortDescription.trim();
        }

        if (parsedCharacter.class && parsedCharacter.class.trim()) {
            npc.class = parsedCharacter.class.trim();
        } else if (parsedCharacter.role && parsedCharacter.role.trim()) {
            npc.class = parsedCharacter.role.trim();
        }

        if (parsedCharacter.race && parsedCharacter.race.trim()) {
            npc.race = parsedCharacter.race.trim();
        }

        if (parsedCharacter.personality) {
            if (
                parsedCharacter.personality.type &&
                parsedCharacter.personality.type.trim()
            ) {
                npc.personalityType = parsedCharacter.personality.type.trim();
            }
            if (typeof parsedCharacter.personality.traits === "string") {
                npc.personalityTraits = parsedCharacter.personality.traits.trim();
            }
            if (typeof parsedCharacter.personality.notes === "string") {
                npc.personalityNotes = parsedCharacter.personality.notes.trim();
            }
        }
        if (typeof parsedCharacter.aiNotes === "string") {
            npc.aiNotes = parsedCharacter.aiNotes.trim();
        }

        const registeredPlayerParserFields = this._getRegisteredPlayerEntityFields({ exposeToXmlParser: true });
        for (const field of registeredPlayerParserFields) {
            if (!field || typeof field.fieldName !== "string") {
                continue;
            }
            if (!Object.prototype.hasOwnProperty.call(parsedCharacter, field.fieldName)) {
                continue;
            }
            if (typeof npc.setExtensionField !== "function") {
                throw new Error(`NPC "${npc.name}" cannot update registered Player field "${field.fieldName}".`);
            }
            npc.setExtensionField(field.fieldName, parsedCharacter[field.fieldName]);
            if (!Array.isArray(summary.updatedPlayerFields)) {
                summary.updatedPlayerFields = [];
            }
            summary.updatedPlayerFields.push(field.fieldName);
        }

        if (Number.isFinite(parsedCharacter.currency)) {
            if (typeof npc.setCurrency === "function") {
                npc.setCurrency(parsedCharacter.currency);
            } else if ("currency" in npc) {
                npc.currency = parsedCharacter.currency;
            } else {
                throw new Error(`NPC "${npc.name}" cannot update currency.`);
            }
        }

        if (
            parsedCharacter.attributes &&
            typeof parsedCharacter.attributes === "object"
        ) {
            if (typeof npc.setAttribute !== "function") {
                throw new Error(
                    `NPC "${npc.name}" cannot update attributes; setAttribute missing.`,
                );
            }
            for (const [attributeName, rawValue] of Object.entries(
                parsedCharacter.attributes,
            )) {
                if (!attributeName) {
                    continue;
                }
                const numeric = this._mapAttributeRatingToValue(rawValue);
                if (!Number.isFinite(numeric)) {
                    continue;
                }
                npc.setAttribute(attributeName, numeric);
            }
        }

        if (Array.isArray(parsedCharacter.statusEffects)) {
            if (typeof npc.setStatusEffects !== "function") {
                throw new Error(
                    `NPC "${npc.name}" cannot update status effects; setStatusEffects missing.`,
                );
            }
            const normalizedEffects = parsedCharacter.statusEffects
                .filter(
                    (effect) =>
                        effect && (effect.description || typeof effect === "string"),
                )
                .map((effect) => {
                    if (typeof effect === "string") {
                        return { description: effect, duration: null };
                    }
                    let normalizedDuration = null;
                    if (effect.duration !== null && effect.duration !== undefined) {
                        normalizedDuration = StatusEffect.normalizeDuration(effect.duration);
                    }
                    return {
                        description: effect.description || String(effect).trim(),
                        duration: normalizedDuration,
                    };
                });
            npc.setStatusEffects(normalizedEffects);
        }

        if (Array.isArray(parsedCharacter.abilities)) {
            if (typeof npc.setAbilities !== "function") {
                throw new Error(
                    `NPC "${npc.name}" cannot update abilities; setAbilities missing.`,
                );
            }
            const abilities = parsedCharacter.abilities
                .filter((ability) => ability && ability.name)
                .map((ability) => ({
                    name: ability.name,
                    description: ability.description || "",
                    type: ability.type || "",
                    level: Number.isFinite(Number(ability.level))
                        ? Number(ability.level)
                        : undefined,
                }));
            npc.setAbilities(abilities);
        }

        const desiredInventory = Array.isArray(parsedCharacter.inventory)
            ? parsedCharacter.inventory
                .map((item) => (typeof item === "string" ? item.trim() : ""))
                .filter(Boolean)
            : null;

        const droppedItems = [];
        if (desiredInventory) {
            if (
                typeof npc.getInventoryItems !== "function" ||
                typeof npc.addInventoryItem !== "function" ||
                typeof npc.removeInventoryItem !== "function"
            ) {
                throw new Error(
                    `NPC "${npc.name}" cannot update inventory; inventory methods missing.`,
                );
            }
            if (typeof findThingByName !== "function") {
                throw new Error(
                    "alter_npc handler requires findThingByName dependency for inventory updates.",
                );
            }

            const beforeItems = npc.getInventoryItems();
            const beforeById = new Map(beforeItems.map((item) => [item.id, item]));
            const desiredById = new Map();

            await this._ensureItemsExist(desiredInventory);

            for (const itemName of desiredInventory) {
                const thing = Thing.getByName(itemName);
                try {
                    if (!thing) {
                        throw new Error(
                            `Unable to locate item "${itemName}" while updating inventory for "${npc.name}".`,
                        );
                    }
                    desiredById.set(thing.id, thing);
                    if (!beforeById.has(thing.id)) {
                        npc.addInventoryItem(thing);
                        const metadata = { ...(thing.metadata || {}) };
                        if (metadata.locationId) {
                            this.removeThingFromLocation(thing, metadata.locationId);
                        }
                        metadata.ownerId = npc.id;
                        delete metadata.locationId;
                        thing.metadata = metadata;
                    }
                } catch (error) {
                    console.warn(
                        `Failed to add item "${itemName}" to inventory of "${npc.name}":`,
                        error.message,
                    );
                    console.debug(error);
                }
            }

            /*
                  const shouldDrop = desiredInventory.length === 0 || desiredById.size > 0;
                  if (shouldDrop) {
                      for (const [id, thing] of beforeById) {
                          if (desiredById.has(id)) {
                              continue;
                          }
                          npc.removeInventoryItem(thing);
                          const metadata = { ...(thing.metadata || {}) };
                          delete metadata.ownerId;
                          if (activeLocation) {
                              metadata.locationId = activeLocation.id;
                              thing.metadata = metadata;
                              this.addThingToLocation(thing, activeLocation);
                              droppedItems.push(thing.name || thing.id);
                          } else {
                              thing.metadata = metadata;
                          }
                      }
                  }
                  */
        }

        if (Number.isFinite(parsedCharacter.relativeLevel)) {
            if (typeof npc.setLevel !== "function") {
                throw new Error(
                    `NPC "${npc.name}" cannot update level; setLevel missing.`,
                );
            }
            const baseReference = this._resolveNpcBaseLevelReference({
                npc,
                location: activeLocation,
                region,
            });
            const targetLevel = this._clampLevel(
                baseReference + parsedCharacter.relativeLevel,
                baseReference,
            );
            npc.setLevel(targetLevel);
            summary.relativeLevelAfter = parsedCharacter.relativeLevel;
            summary.levelAfter = targetLevel;
        }

        if (droppedItems.length) {
            summary.droppedItems = droppedItems;
        }

        summary.name = npc.name;
        if (activeLocation) {
            summary.locationId = activeLocation.id;
            summary.locationName = activeLocation.name;
        }

        return summary;
    }

    static _parseLocationAlterXml(xmlContent) {
        if (typeof xmlContent !== "string" || !xmlContent.trim()) {
            return null;
        }

        try {
            const doc = Utils.parseXmlDocument(xmlContent, "text/xml");

            const parserError = doc.getElementsByTagName("parsererror")[0];
            if (parserError) {
                throw new Error(parserError.textContent || "Unknown XML parsing error");
            }

            const locationNode = doc.getElementsByTagName("location")[0];
            if (!locationNode) {
                return null;
            }

            const getText = (tag) =>
                locationNode.getElementsByTagName(tag)[0]?.textContent?.trim() || "";

            const name = getText("name");
            const description = getText("description");
            const baseLevelRaw = getText("baseLevel");
            const shortDescription = getText("shortDescription");
            const baseLevel = Number(baseLevelRaw);

            return {
                name: name || null,
                description: description || "",
                shortDescription: shortDescription || "",
                baseLevel: Number.isFinite(baseLevel) ? baseLevel : null,
            };
        } catch (error) {
            console.warn("Failed to parse altered location XML:", error.message);
            return null;
        }
    }

    static _applyLocationAlteration({
        location,
        parsedLocation,
        changeDescription,
        generatedImages,
        preserveBaseLevel = false,
    }) {
        if (!location || !parsedLocation) {
            return null;
        }

        const originalName = location.name || location.id;
        const originalDescription = location.description || "";
        const originalShortDescription = location.shortDescription || "";
        const originalBaseLevel = Number.isFinite(location.baseLevel)
            ? location.baseLevel
            : null;

        let changed = false;

        const normalizedName = parsedLocation.name && parsedLocation.name.trim();
        if (normalizedName && normalizedName !== location.name) {
            location.name = normalizedName;
            changed = true;
        }

        const trimmedDescription =
            parsedLocation.description && parsedLocation.description.trim();
        if (trimmedDescription && trimmedDescription !== location.description) {
            location.description = trimmedDescription;
            changed = true;
        }

        if (!preserveBaseLevel && Number.isFinite(parsedLocation.baseLevel)) {
            const clampedLevel = this._clampLevel(
                parsedLocation.baseLevel,
                location.baseLevel,
            );
            if (clampedLevel !== location.baseLevel) {
                location.baseLevel = clampedLevel;
                changed = true;
            }
        }

        const trimmedShortDescription =
            parsedLocation.shortDescription && parsedLocation.shortDescription.trim();
        if (trimmedShortDescription && trimmedShortDescription !== location.shortDescription) {
            location.shortDescription = trimmedShortDescription;
            changed = true;
        }

        if (typeof location.addStatusEffect === "function" && changeDescription) {
            location.addStatusEffect(makeStatusEffect(changeDescription, null));
        }

        if (changed) {
            this._clearLocationImage(location, generatedImages);
        }

        return {
            locationId: location.id,
            originalName,
            newName: location.name || originalName,
            baseLevelBefore: originalBaseLevel,
            baseLevelAfter: location.baseLevel,
            changeDescription: changeDescription || "",
            descriptionBefore: originalDescription,
            descriptionAfter: location.description,
            shortDescriptionBefore: originalShortDescription,
            shortDescriptionAfter: location.shortDescription,
            changed,
        };
    }

    static _logAlterLocation({
        fs,
        path,
        baseDir,
        locationName,
        systemPrompt,
        generationPrompt,
        responseText,
        durationSeconds,
    }) {
        if (!fs || !path) {
            return;
        }
        try {
            const logDir = path.join(baseDir || process.cwd(), "logs");
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            const safeNameSource = locationName || "location";
            const safeName =
                safeNameSource
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "_")
                    .replace(/^_+|_+$/g, "") || "location";
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            const logPath = path.join(
                logDir,
                `alter_location_${timestamp}_${safeName}.log`,
            );
            const logLines = [
                typeof durationSeconds === "number"
                    ? `=== API CALL DURATION: ${durationSeconds.toFixed(3)}s ===`
                    : null,
                "=== ALTER LOCATION SYSTEM PROMPT ===",
                systemPrompt || "(none)",
                "",
                "=== ALTER LOCATION GENERATION PROMPT ===",
                generationPrompt || "(none)",
                "",
                "=== ALTER LOCATION RESPONSE ===",
                responseText || "(no response)",
                "",
            ].filter(Boolean);
            fs.writeFileSync(logPath, logLines.join("\n"), "utf8");
        } catch (error) {
            console.warn("Failed to log location alteration prompt:", error.message);
        }
    }

    static _logQuestGeneration({
        fs,
        path,
        baseDir,
        systemPrompt,
        generationPrompt,
        responseText,
        metadata,
        durationSeconds,
    }) {
        if (!fs || !path) {
            return;
        }
        try {
            const logDir = path.join(baseDir || process.cwd(), "logs");
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            const logPath = path.join(logDir, `quest_generate_${timestamp}.log`);
            const logLines = [
                typeof durationSeconds === "number"
                    ? `=== API CALL DURATION: ${durationSeconds.toFixed(3)}s ===`
                    : null,
                metadata?.summary ? `Quest Summary: ${metadata.summary}` : null,
                metadata?.giver ? `Quest Giver: ${metadata.giver}` : null,
                "=== QUEST SYSTEM PROMPT ===",
                systemPrompt || "(none)",
                "",
                "=== QUEST GENERATION PROMPT ===",
                generationPrompt || "(none)",
                "",
                "=== QUEST RESPONSE ===",
                responseText || "(no response)",
                "",
            ].filter(Boolean);
            fs.writeFileSync(logPath, logLines.join("\n"), "utf8");
        } catch (error) {
            console.warn("Failed to log quest generation prompt:", error.message);
        }
    }

    static _resolveQuestFactionRewardMap(rawRewards) {
        if (!rawRewards || typeof rawRewards !== "object") {
            return {};
        }

        const entries = rawRewards instanceof Map
            ? Array.from(rawRewards.entries())
            : Object.entries(rawRewards);
        const resolvedRewards = {};

        for (const [rawFactionKey, rawPoints] of entries) {
            const factionKey = typeof rawFactionKey === "string" ? rawFactionKey.trim() : "";
            if (!factionKey) {
                console.warn("Quest faction reputation reward entry had an empty faction key; skipping.");
                continue;
            }

            const points = Number(rawPoints);
            if (!Number.isFinite(points) || !Number.isInteger(points)) {
                console.warn(
                    `Quest faction reputation reward for "${factionKey}" must be a finite integer; skipping entry.`,
                );
                continue;
            }
            if (points === 0) {
                continue;
            }

            const faction =
                (typeof Faction.getById === "function" ? Faction.getById(factionKey) : null) ||
                (typeof Faction.getByName === "function" ? Faction.getByName(factionKey) : null);
            if (!faction || !faction.id) {
                console.warn(
                    `Quest faction reputation reward references unknown faction "${factionKey}"; skipping entry.`,
                );
                continue;
            }

            const existing = Number(resolvedRewards[faction.id]) || 0;
            const merged = existing + points;
            if (merged === 0) {
                delete resolvedRewards[faction.id];
            } else {
                resolvedRewards[faction.id] = merged;
            }
        }

        return resolvedRewards;
    }

    static _toQuestFactionRewardPreviewEntries(rewardMap) {
        if (!rewardMap || typeof rewardMap !== "object") {
            return [];
        }
        return Object.entries(rewardMap)
            .map(([factionId, points]) => {
                const normalizedFactionId = typeof factionId === "string" ? factionId.trim() : "";
                if (!normalizedFactionId) {
                    return null;
                }
                const numericPoints = Number(points);
                if (!Number.isFinite(numericPoints) || !Number.isInteger(numericPoints) || numericPoints === 0) {
                    return null;
                }
                const faction = typeof Faction.getById === "function"
                    ? Faction.getById(normalizedFactionId)
                    : null;
                return {
                    factionId: normalizedFactionId,
                    factionName: faction?.name || normalizedFactionId,
                    points: numericPoints
                };
            })
            .filter(Boolean);
    }

    static _resolveQuestNpcDispositionRewards(rawRewards, {
        findActorByName = null,
        warn = console.warn,
        contextLabel = "Quest NPC disposition reward"
    } = {}) {
        const normalizedRewards = Quest.normalizeRewardNpcDispositions(rawRewards);
        const resolvedRewards = [];
        const safeWarn = typeof warn === "function" ? warn : () => {};

        const resolveActor = (entry) => {
            const npcId = typeof entry?.npcId === "string" ? entry.npcId.trim() : "";
            if (npcId && typeof Player.getById === "function") {
                const byId = Player.getById(npcId);
                if (byId) {
                    return byId;
                }
            }

            const npcName = typeof entry?.npcName === "string" ? entry.npcName.trim() : "";
            if (npcName && typeof findActorByName === "function") {
                const byName = findActorByName(npcName);
                if (byName) {
                    return byName;
                }
            }
            if (npcName && typeof Player.getByName === "function") {
                return Player.getByName(npcName);
            }
            return null;
        };

        const currentPlayer = this.currentPlayer || Globals.currentPlayer || null;
        for (const entry of normalizedRewards) {
            const actor = resolveActor(entry);
            if (!actor || actor === currentPlayer) {
                safeWarn(
                    `${contextLabel} references unknown NPC "${entry.npcName || entry.npcId || "unknown"}"; skipping disposition reward.`,
                );
                continue;
            }

            resolvedRewards.push({
                npcId: actor.id || entry.npcId || null,
                npcName: actor.name || entry.npcName || entry.npcId || null,
                dispositions: entry.dispositions.map(disposition => ({ ...disposition }))
            });
        }

        return resolvedRewards;
    }

    static _resolveQuestDispositionDelta(intensityValue, definitions) {
        // Shared with the quest confirmation preview so the accepted-quest display
        // and the on-completion award can never diverge.
        return resolveQuestDispositionRewardDelta(intensityValue, definitions);
    }

    static _applyQuestNpcDispositionRewards(quest, context = {}) {
        const rewards = Array.isArray(quest?.rewardNpcDispositions)
            ? quest.rewardNpcDispositions
            : [];
        if (!rewards.length) {
            return [];
        }

        const player = context.player || this.currentPlayer || Globals.currentPlayer || null;
        if (!player || typeof player.id !== "string" || !player.id.trim()) {
            throw new Error("Quest NPC disposition rewards require a player with an id.");
        }

        const resolvedRewards = this._resolveQuestNpcDispositionRewards(rewards, {
            findActorByName: this._deps?.findActorByName,
            warn: console.warn,
            contextLabel: `Quest "${quest?.name || "unknown"}" NPC disposition reward`
        });
        if (!resolvedRewards.length) {
            return [];
        }

        const definitions = Player.getDispositionDefinitions();
        const range = definitions?.range || {};
        const minRange = Number.isFinite(Number(range.min)) ? Number(range.min) : null;
        const maxRange = Number.isFinite(Number(range.max)) ? Number(range.max) : null;
        const firstImpressionMultiplier = Number.isFinite(Number(definitions?.firstImpressionMultiplier))
            ? Number(definitions.firstImpressionMultiplier)
            : null;
        const typeDefinitions = definitions?.types || {};
        const appliedChanges = [];

        const getDispositionValue = (npc, typeKey) => {
            if (typeof npc.getDisposition === "function") {
                return Number(npc.getDisposition(player.id, typeKey)) || 0;
            }
            if (typeof npc.getDispositionTowardsCurrentPlayer === "function") {
                return Number(npc.getDispositionTowardsCurrentPlayer(typeKey)) || 0;
            }
            throw new Error(`NPC "${npc.name || npc.id || "unknown"}" cannot read dispositions.`);
        };

        const setDispositionValue = (npc, typeKey, value) => {
            if (typeof npc.setDisposition === "function") {
                return npc.setDisposition(player.id, typeKey, value);
            }
            if (typeof npc.setDispositionTowardsCurrentPlayer === "function") {
                return npc.setDispositionTowardsCurrentPlayer(typeKey, value);
            }
            throw new Error(`NPC "${npc.name || npc.id || "unknown"}" cannot write dispositions.`);
        };

        for (const npcEntry of resolvedRewards) {
            const npc = (npcEntry.npcId && typeof Player.getById === "function"
                ? Player.getById(npcEntry.npcId)
                : null)
                || (typeof this._deps?.findActorByName === "function"
                    ? this._deps.findActorByName(npcEntry.npcName)
                    : null)
                || (typeof Player.getByName === "function" ? Player.getByName(npcEntry.npcName) : null);
            if (!npc || npc === player) {
                console.warn(
                    `Quest "${quest?.name || "unknown"}" NPC disposition reward references unknown NPC "${npcEntry.npcName || npcEntry.npcId || "unknown"}"; skipping disposition reward.`,
                );
                continue;
            }

            let applyFirstImpression = false;
            if (firstImpressionMultiplier && firstImpressionMultiplier !== 1) {
                let hasNonZeroDisposition = false;
                for (const def of Object.values(typeDefinitions)) {
                    const key = def?.key || def?.label;
                    if (!key) {
                        continue;
                    }
                    const existingValue = getDispositionValue(npc, key);
                    if (Number(existingValue) !== 0) {
                        hasNonZeroDisposition = true;
                        break;
                    }
                }
                applyFirstImpression = !hasNonZeroDisposition;
            }

            for (const dispositionReward of npcEntry.dispositions) {
                const typeDefinition = Player.getDispositionDefinition(dispositionReward.type);
                if (!typeDefinition || !typeDefinition.key) {
                    console.warn(
                        `Quest "${quest?.name || "unknown"}" NPC disposition reward references unknown disposition type "${dispositionReward.type}"; skipping.`,
                    );
                    continue;
                }

                const intensityValue = Number(dispositionReward.intensity);
                if (!Number.isFinite(intensityValue) || intensityValue === 0) {
                    continue;
                }

                let delta = Events._resolveQuestDispositionDelta(intensityValue, definitions);
                if (!Number.isFinite(delta) || delta === 0) {
                    console.warn(
                        `Quest "${quest?.name || "unknown"}" could not resolve disposition delta for "${dispositionReward.type}" intensity ${intensityValue}; skipping.`,
                    );
                    continue;
                }

                if (applyFirstImpression) {
                    const multiplied = delta * firstImpressionMultiplier;
                    if (Number.isFinite(multiplied) && multiplied !== 0) {
                        delta = Math.round(multiplied);
                    }
                }

                const previousValue = getDispositionValue(npc, typeDefinition.key);
                let newValue = previousValue + delta;
                if (Number.isFinite(minRange)) {
                    newValue = Math.max(minRange, newValue);
                }
                if (Number.isFinite(maxRange)) {
                    newValue = Math.min(maxRange, newValue);
                }
                setDispositionValue(npc, typeDefinition.key, newValue);

                const applied = {
                    npcId: npc.id || npcEntry.npcId || null,
                    npcName: npc.name || npcEntry.npcName,
                    typeKey: typeDefinition.key,
                    typeLabel: typeDefinition.label || typeDefinition.key,
                    typeIcon: typeDefinition.icon || null,
                    intensity: intensityValue,
                    delta,
                    previousValue,
                    newValue,
                    reason: dispositionReward.reason || null
                };
                appliedChanges.push(applied);
            }
        }

        if (appliedChanges.length) {
            if (!Array.isArray(context.dispositionChanges)) {
                context.dispositionChanges = [];
            }
            context.dispositionChanges.push(...appliedChanges);
        }

        return appliedChanges;
    }

    static _parseQuestXml(xmlContent) {
        if (typeof xmlContent !== "string" || !xmlContent.trim()) {
            return null;
        }

        try {
            const doc = Utils.parseXmlDocument(xmlContent, "text/xml");
            const parserError = doc.getElementsByTagName("parsererror")[0];
            if (parserError) {
                throw new Error(parserError.textContent || "Unknown XML parsing error");
            }

            const questNode = doc.getElementsByTagName("quest")[0];
            if (!questNode) {
                return null;
            }

            const getText = (tag) =>
                questNode.getElementsByTagName(tag)[0]?.textContent?.trim() || "";

            const rewardsNode = questNode.getElementsByTagName("rewards")[0] || null;
            const rewardItems = rewardsNode
                ? Array.from(rewardsNode.getElementsByTagName("item"))
                    .map((node) => {
                        const descriptionNode =
                            node.getElementsByTagName("description")[0];
                        const value = descriptionNode
                            ? descriptionNode.textContent
                            : node.textContent;
                        return value ? value.trim() : "";
                    })
                    .filter(Boolean)
                : [];

            let rewardCurrency = 0;
            if (rewardsNode) {
                const currencyNode = rewardsNode.getElementsByTagName("currency")[0];
                if (currencyNode) {
                    const currencyText = currencyNode.textContent?.trim() || "";
                    const currencyMatch = currencyText.match(/-?\d+/);
                    if (currencyMatch) {
                        rewardCurrency = Number.parseInt(currencyMatch[0], 10);
                    }
                }
            }

            let rewardXp = 0;
            if (rewardsNode) {
                const xpNode =
                    rewardsNode.getElementsByTagName("xp")[0] ||
                    rewardsNode.getElementsByTagName("experience")[0];
                if (xpNode) {
                    const xpText = xpNode.textContent?.trim() || "";
                    const xpMatch = xpText.match(/-?\d+/);
                    if (xpMatch) {
                        rewardXp = Number.parseInt(xpMatch[0], 10);
                    }
                }
            }

            const rewardFactionReputation = {};
            if (rewardsNode) {
                const factionReputationNode =
                    rewardsNode.getElementsByTagName("factionReputation")[0] ||
                    rewardsNode.getElementsByTagName("faction_reputation")[0];
                const factionRewardNodes = factionReputationNode
                    ? Array.from(factionReputationNode.getElementsByTagName("faction"))
                    : [];

                for (const factionNode of factionRewardNodes) {
                    const nameText = factionNode.getElementsByTagName("name")[0]?.textContent?.trim() || "";
                    if (!nameText) {
                        console.warn("Quest reward faction entry missing <name>; skipping.");
                        continue;
                    }

                    const pointsNode =
                        factionNode.getElementsByTagName("points")[0] ||
                        factionNode.getElementsByTagName("reputation")[0] ||
                        factionNode.getElementsByTagName("standing")[0];
                    const pointsText = pointsNode?.textContent?.trim() || "";
                    const pointsMatch = pointsText.match(/-?\d+/);
                    if (!pointsMatch) {
                        console.warn(
                            `Quest reward faction "${nameText}" missing numeric points; skipping.`,
                        );
                        continue;
                    }
                    const points = Number.parseInt(pointsMatch[0], 10);
                    if (!Number.isFinite(points) || points === 0) {
                        continue;
                    }

                    const existing = Number(rewardFactionReputation[nameText]) || 0;
                    const merged = existing + points;
                    if (merged === 0) {
                        delete rewardFactionReputation[nameText];
                    } else {
                        rewardFactionReputation[nameText] = merged;
                    }
                }
            }

            const rewardNpcDispositions = [];
            if (rewardsNode) {
                const npcDispositionsNode = rewardsNode.getElementsByTagName("npcDispositions")[0] || null;
                const npcRewardNodes = npcDispositionsNode
                    ? Array.from(npcDispositionsNode.getElementsByTagName("npc"))
                    : [];

                for (const npcNode of npcRewardNodes) {
                    const npcName = npcNode.getElementsByTagName("name")[0]?.textContent?.trim() || "";
                    if (!npcName) {
                        console.warn("Quest reward NPC disposition entry missing <name>; skipping.");
                        continue;
                    }

                    const dispositionContainer = npcNode.getElementsByTagName("dispositionsTowardsPlayer")[0] || null;
                    const dispositionNodes = dispositionContainer
                        ? Array.from(dispositionContainer.getElementsByTagName("disposition"))
                        : Array.from(npcNode.getElementsByTagName("disposition"));
                    const dispositions = [];

                    for (const dispositionNode of dispositionNodes) {
                        const type = dispositionNode.getElementsByTagName("type")[0]?.textContent?.trim() || "";
                        if (!type) {
                            console.warn(`Quest reward NPC disposition for "${npcName}" missing <type>; skipping.`);
                            continue;
                        }

                        const intensityText = dispositionNode.getElementsByTagName("intensity")[0]?.textContent?.trim() || "";
                        const intensity = Number.parseInt(intensityText, 10);
                        if (!Number.isFinite(intensity) || intensity === 0) {
                            console.warn(`Quest reward NPC disposition for "${npcName}" ${type} missing numeric intensity; skipping.`);
                            continue;
                        }

                        const reason = dispositionNode.getElementsByTagName("reason")[0]?.textContent?.trim() || null;
                        dispositions.push({
                            type,
                            intensity,
                            reason
                        });
                    }

                    if (dispositions.length) {
                        rewardNpcDispositions.push({
                            npcName,
                            dispositions
                        });
                    }
                }
            }

            const objectives = Array.from(questNode.getElementsByTagName("objective"))
                .map((node) => {
                    const descriptionNode = node.getElementsByTagName("description")[0];
                    const description = descriptionNode
                        ? descriptionNode.textContent?.trim()
                        : node.textContent?.trim() || "";

                    /*
                              const optionalNode = node.getElementsByTagName('optional')[0];
                              const optionalText = optionalNode ? optionalNode.textContent?.trim().toLowerCase() : '';
                              const optional = optionalText === 'true' || optionalText === 'yes';
                              */
                    const optional = false;
                    if (!description) {
                        return null;
                    }

                    return { description, optional };
                })
                .filter(Boolean);

            return {
                name: getText("name"),
                description: getText("description"),
                giver: getText("giver"),
                secretNotes: getText("secretNotes"),
                objectives,
                rewardItems: Array.from(new Set(rewardItems)),
                rewardCurrency,
                rewardXp,
                rewardFactionReputation,
                rewardNpcDispositions,
            };
        } catch (error) {
            console.warn("Failed to parse quest XML:", error.message);
            return null;
        }
    }

    static parseQuestObjectiveStatusXml(xmlContent) {
        if (typeof xmlContent !== "string" || !xmlContent.trim()) {
            return [];
        }

        const player = this.currentPlayer || Globals.currentPlayer || null;
        const truthyCompleted = new Set(["true", "yes", "y", "1", "completed"]);

        const resolveQuestMeta = (questIndexValue, providedName = "") => {
            const meta = { questName: providedName || null, questId: null };
            if (
                !Number.isFinite(questIndexValue) ||
                !player ||
                typeof player.getQuestByIndex !== "function"
            ) {
                return meta;
            }
            const quest = player.getQuestByIndex(
                Math.max(0, Math.round(questIndexValue - 1)),
            );
            if (quest) {
                meta.questName = meta.questName || quest.name || null;
                meta.questId = quest.id || null;
            }
            return meta;
        };

        try {
            const doc = Utils.parseXmlDocument(xmlContent, "text/xml");
            if (!doc) {
                return [];
            }
            const parserError = doc.getElementsByTagName("parsererror")[0];
            if (parserError) {
                throw new Error(
                    parserError.textContent ||
                    "Quest objective XML contained parser errors.",
                );
            }

            const questNodes = Array.from(doc.getElementsByTagName("quest"));
            const entries = [];

            for (const questNode of questNodes) {
                const questName =
                    questNode.getElementsByTagName("name")[0]?.textContent?.trim() || "";
                const questIndexText =
                    questNode.getElementsByTagName("index")[0]?.textContent?.trim() ||
                    questNode.getAttribute?.("index") ||
                    "";
                const questIndexValue = Number.parseInt(questIndexText, 10);
                const questMeta = resolveQuestMeta(questIndexValue, questName);

                const objectiveNodes = Array.from(
                    questNode.getElementsByTagName("objective"),
                );
                for (const objectiveNode of objectiveNodes) {
                    const indexText =
                        objectiveNode
                            .getElementsByTagName("index")[0]
                            ?.textContent?.trim() ||
                        objectiveNode.getAttribute?.("index") ||
                        "";
                    const completedText =
                        objectiveNode
                            .getElementsByTagName("completed")[0]
                            ?.textContent?.trim()
                            .toLowerCase() ||
                        objectiveNode.getAttribute?.("completed")?.trim().toLowerCase() ||
                        "";
                    const hasCompletedFlag = Boolean(completedText);
                    const isCompleted =
                        hasCompletedFlag && truthyCompleted.has(completedText);
                    if (!isCompleted) {
                        continue;
                    }
                    const statusReasonText =
                        objectiveNode
                            .getElementsByTagName("statusReason")[0]
                            ?.textContent?.trim() || "";
                    const indexValue = Number.parseInt(indexText, 10);
                    if (
                        !Number.isFinite(indexValue) ||
                        !Number.isFinite(questIndexValue)
                    ) {
                        continue;
                    }
                    entries.push({
                        quest: questMeta.questName,
                        questId: questMeta.questId,
                        questIndex: questIndexValue,
                        objectiveIndex: indexValue,
                        statusReason:
                            statusReasonText &&
                                statusReasonText.toLowerCase() !== "n/a"
                                ? statusReasonText
                                : null,
                    });
                }
            }

            return entries;
        } catch (error) {
            console.warn(
                "Failed to parse quest objective status XML:",
                error.message,
            );
            return [];
        }
    }

    static _generateQuestName(seed = "") {
        if (typeof seed === "string" && seed.trim()) {
            const base = seed.split(/[.!?]/)[0].trim();
            if (base) {
                const normalized = Utils.capitalizeProperNoun(base).slice(0, 80);
                if (normalized) {
                    return normalized;
                }
            }
        }
        return `Quest ${Date.now().toString(36)}`;
    }

    static _parseCharacterAlterXml(xmlContent) {
        if (typeof xmlContent !== "string" || !xmlContent.trim()) {
            return null;
        }

        try {
            const decoded = xmlContent
                .replace(/&lt;/gi, "<")
                .replace(/&gt;/gi, ">")
                .replace(/&amp;/gi, "&");
            const npcBlockMatch = decoded.match(/<npc\b[\s\S]*?<\/npc>/i);
            const candidateXml = npcBlockMatch ? npcBlockMatch[0] : decoded.trim();
            const doc = Utils.parseXmlDocument(candidateXml, "text/xml");

            const parserError = doc.getElementsByTagName("parsererror")[0];
            if (parserError) {
                throw new Error(parserError.textContent || "Unknown XML parsing error");
            }

            const npcNode = doc.getElementsByTagName("npc")[0];
            if (!npcNode) {
                return null;
            }

            const getText = (tag) =>
                npcNode.getElementsByTagName(tag)[0]?.textContent?.trim() || "";

            const relativeLevelRaw = getText("relativeLevel");
            const relativeLevel = relativeLevelRaw === ""
                ? null
                : Number(relativeLevelRaw);
            const currencyRaw = getText("currency");
            const currency = Number(currencyRaw);

            const attributes = {};
            const attributeNodes = Array.from(
                npcNode.getElementsByTagName("attribute"),
            );
            for (const node of attributeNodes) {
                const name =
                    node.getAttribute("name") ||
                    node.getElementsByTagName("name")[0]?.textContent?.trim();
                if (!name) {
                    continue;
                }
                const valueNode = node.getElementsByTagName("value")[0];
                const textContent = valueNode
                    ? valueNode.textContent
                    : node.textContent;
                const value = textContent ? textContent.trim() : "";
                attributes[name] = value;
            }

            const personalityNode = npcNode.getElementsByTagName("personality")[0];
            const personality = personalityNode
                ? {
                    type:
                        personalityNode
                            .getElementsByTagName("type")[0]
                            ?.textContent?.trim() || "",
                    traits:
                        personalityNode
                            .getElementsByTagName("traits")[0]
                            ?.textContent?.trim() || "",
                    notes:
                        personalityNode
                            .getElementsByTagName("notes")[0]
                            ?.textContent?.trim() || "",
                    aiNotes:
                        personalityNode
                            .getElementsByTagName("aiNotes")[0]
                            ?.textContent?.trim() || "",
                }
                : null;
            const aiNotes = getText("aiNotes") || personality?.aiNotes || "";

            const statusEffects = [];
            const statusParent = npcNode.getElementsByTagName("statusEffects")[0];
            if (statusParent) {
                const effectNodes = Array.from(
                    statusParent.getElementsByTagName("effect"),
                );
                for (const effectNode of effectNodes) {
                    const description =
                        effectNode
                            .getElementsByTagName("description")[0]
                            ?.textContent?.trim() ||
                        effectNode.textContent?.trim() ||
                        "";
                    if (!description) {
                        continue;
                    }
                    const durationText =
                        effectNode
                            .getElementsByTagName("duration")[0]
                            ?.textContent?.trim() || "";
                    let normalizedDuration = null;
                    if (durationText) {
                        normalizedDuration = StatusEffect.normalizeDuration(durationText);
                    }
                    statusEffects.push({
                        description,
                        duration: normalizedDuration,
                    });
                }
            }

            const abilities = [];
            const abilitiesParent = npcNode.getElementsByTagName("abilities")[0];
            if (abilitiesParent) {
                const abilityNodes = Array.from(
                    abilitiesParent.getElementsByTagName("ability"),
                );
                for (const abilityNode of abilityNodes) {
                    const name = abilityNode
                        .getElementsByTagName("name")[0]
                        ?.textContent?.trim();
                    if (!name) {
                        continue;
                    }
                    const description =
                        abilityNode
                            .getElementsByTagName("description")[0]
                            ?.textContent?.trim() || "";
                    const type =
                        abilityNode.getElementsByTagName("type")[0]?.textContent?.trim() ||
                        "";
                    const levelRaw =
                        abilityNode.getElementsByTagName("level")[0]?.textContent?.trim() ||
                        "";
                    const level = Number(levelRaw);
                    abilities.push({
                        name,
                        description,
                        type,
                        level: Number.isFinite(level) ? level : null,
                    });
                }
            }

            const inventory = [];
            const inventoryParent = npcNode.getElementsByTagName("inventory")[0];
            if (inventoryParent) {
                const itemNodes = Array.from(
                    inventoryParent.getElementsByTagName("item"),
                );
                for (const itemNode of itemNodes) {
                    const itemName = itemNode.textContent?.trim();
                    if (itemName) {
                        inventory.push(itemName);
                    }
                }
            }

            return {
                ...this._getPlayerExtensionFieldInputsFromXmlNode(
                    npcNode,
                    this._getRegisteredPlayerEntityFields({ exposeToXmlParser: true }),
                    "altered character Player field",
                ),
                name: getText("name") || null,
                description: getText("description") || "",
                shortDescription: getText("shortDescription") || "",
                role: getText("role") || "",
                class: getText("class") || "",
                race: getText("race") || "",
                relativeLevel: Number.isFinite(relativeLevel) ? relativeLevel : null,
                currency: Number.isFinite(currency) ? currency : null,
                personality,
                aiNotes,
                attributes,
                statusEffects,
                abilities,
                inventory,
            };
        } catch (error) {
            console.warn("Failed to parse altered character XML:", error.message);
            return null;
        }
    }

    static _mapAttributeRatingToValue(raw) {
        if (raw === null || raw === undefined) {
            return null;
        }

        if (Number.isFinite(raw)) {
            return this._clampAttributeValue(raw);
        }

        const text = String(raw).trim();
        if (!text) {
            return null;
        }

        const normalized = text.toLowerCase();
        const mapping = [
            ["terrible", 2],
            ["awful", 2],
            ["poor", 4],
            ["weak", 4],
            ["frail", 4],
            ["below average", 7],
            ["average", 10],
            ["mediocre", 10],
            ["above average", 13],
            ["strong", 13],
            ["tough", 13],
            ["excellent", 16],
            ["mighty", 16],
            ["heroic", 16],
            ["legendary", 19],
            ["mythic", 19],
        ];

        for (const [keyword, value] of mapping) {
            if (normalized.includes(keyword)) {
                return this._clampAttributeValue(value);
            }
        }

        const numeric = Number(text);
        if (Number.isFinite(numeric)) {
            return this._clampAttributeValue(numeric);
        }

        return null;
    }

    static _clampAttributeValue(value) {
        if (!Number.isFinite(value)) {
            return null;
        }
        return Math.max(1, Math.round(value));
    }

    static _clampLevel(value, fallback = 1) {
        const base = Number.isFinite(value)
            ? value
            : Number.isFinite(fallback)
                ? fallback
                : 1;
        return Math.max(1, Math.round(base));
    }

    static _clearLocationImage(location, generatedImages) {
        if (!location) {
            return;
        }
        const previousId =
            typeof location.imageId === "string" ? location.imageId : null;
        if (previousId) {
            if (generatedImages instanceof Map) {
                generatedImages.delete(previousId);
            } else if (generatedImages && typeof generatedImages === "object") {
                delete generatedImages[previousId];
            }
        }
        if (typeof location.clearImageVariants === "function") {
            try {
                const removedVariants = location.clearImageVariants();
                for (const variant of removedVariants || []) {
                    if (!variant?.imageId) {
                        continue;
                    }
                    if (generatedImages instanceof Map) {
                        generatedImages.delete(variant.imageId);
                    } else if (generatedImages && typeof generatedImages === "object") {
                        delete generatedImages[variant.imageId];
                    }
                }
            } catch (error) {
                console.warn("Failed to clear location image variants:", error?.message || error);
            }
        }
        try {
            location.imageId = null;
        } catch (error) {
            // Ignore immutable setters
        }
    }

    static _resolveNpcBaseLevelReference({
        npc,
        location = null,
        region = null,
    }) {
        if (Number.isFinite(npc?.level)) {
            return npc.level;
        }
        if (location && Number.isFinite(location.baseLevel)) {
            return location.baseLevel;
        }
        if (region && Number.isFinite(region.averageLevel)) {
            return region.averageLevel;
        }
        if (Number.isFinite(this.currentPlayer?.level)) {
            return this.currentPlayer.level;
        }
        return 1;
    }

    static _generateItemsIntoWorld(names = [], location = null, options = {}) {
        if (!Array.isArray(names) || !names.length) {
            return Promise.resolve([]);
        }

        const { generateItemsByNames } = this._deps;
        if (typeof generateItemsByNames !== "function") {
            return Promise.reject(
                new Error("generateItemsByNames dependency is not configured."),
            );
        }

        const locationCandidate =
            this.resolveLocationCandidate(location) || location;
        return generateItemsByNames({
            itemNames: names,
            location: locationCandidate,
            options,
        });
    }

    static _getGeneratedThingFinalName(
        generatedThing,
        { requestedName = "", eventKey = "event" } = {},
    ) {
        const finalName = normalizeString(generatedThing?.name);
        if (!finalName) {
            throw new Error(
                `${eventKey} generated "${requestedName || "an item"}" but the generated Thing has no final name.`,
            );
        }
        return finalName;
    }

    static _trackGeneratedItemNames(originalName, finalName) {
        const resolvedFinalName = normalizeString(finalName);
        const resolvedOriginalName = normalizeString(originalName);

        if (resolvedFinalName) {
            this.newItems.add(resolvedFinalName);
        }
        if (
            resolvedOriginalName &&
            resolvedFinalName &&
            resolvedOriginalName.toLowerCase() !== resolvedFinalName.toLowerCase()
        ) {
            this.newItems.add(resolvedOriginalName);
        }
    }

    static async _ensureItemsExist(
        rawNames = [],
        location = null,
        { allowObtained = false, recordNewItems = true } = {},
    ) {
        if (!Array.isArray(rawNames) || !rawNames.length) {
            return [];
        }

        const names = [];
        for (const raw of rawNames) {
            if (typeof raw !== "string") {
                continue;
            }
            const trimmed = raw.trim();
            if (!trimmed) {
                continue;
            }
            if (!allowObtained && this.obtainedItems.has(trimmed)) {
                continue;
            }
            names.push(trimmed);
            if (!allowObtained && this._isItemAlreadyTracked(trimmed)) {
                continue;
            }
        }

        if (!names.length) {
            return [];
        }

        try {
            await this._generateItemsIntoWorld(names, location);
        } catch (error) {
            console.warn("Failed to generate items:", error.message);
            return [];
        }

        if (recordNewItems) {
            for (const name of names) {
                this.newItems.add(name);
            }
        }

        return names;
    }

    static _getThingCount(thing) {
        return Number.isInteger(thing?.count) && thing.count > 0 ? thing.count : 1;
    }

    static _thingLocationId(thing) {
        const metadata = thing?.metadata && typeof thing.metadata === "object"
            ? thing.metadata
            : {};
        const candidates = [metadata.locationId, metadata.locationID, metadata.location_id];
        for (const candidate of candidates) {
            if (typeof candidate === "string" && candidate.trim()) {
                return candidate.trim();
            }
        }
        return null;
    }

    static _thingOwnedByActor(thing, actor) {
        if (!thing || !actor?.id) {
            return false;
        }
        if (typeof thing.whoseInventory === "function") {
            const owners = thing.whoseInventory().filter(Boolean);
            if (owners.some((owner) => owner?.id === actor.id)) {
                return true;
            }
        }
        const metadata = thing.metadata && typeof thing.metadata === "object"
            ? thing.metadata
            : {};
        const ownerCandidates = [metadata.ownerId, metadata.ownerID, metadata.owner_id, metadata.playerId];
        return ownerCandidates.some((candidate) => typeof candidate === "string" && candidate.trim() === actor.id);
    }

    static _findThingsByExactName(itemName, {
        owner = null,
        location = null,
        unownedOnly = false,
        preferredThing = null,
    } = {}) {
        const normalizedName = typeof itemName === "string" ? itemName.trim().toLowerCase() : "";
        if (!normalizedName) {
            return [];
        }

        const sourceThings = this.things instanceof Map
            ? Array.from(this.things.values())
            : Thing.getAll();
        const preferredId = preferredThing?.id || null;
        const locationId = typeof location?.id === "string" ? location.id.trim() : null;

        return sourceThings
            .filter((thing) => {
                if (!thing?.name || thing.name.trim().toLowerCase() !== normalizedName) {
                    return false;
                }

                const owners = typeof thing.whoseInventory === "function"
                    ? thing.whoseInventory().filter(Boolean)
                    : [];
                const hasOwners = owners.length > 0;
                if (owner) {
                    return owners.some((candidate) => candidate?.id === owner.id) || this._thingOwnedByActor(thing, owner);
                }
                if (unownedOnly && hasOwners) {
                    return false;
                }
                if (unownedOnly && locationId) {
                    return this._thingLocationId(thing) === locationId;
                }
                return true;
            })
            .sort((left, right) => {
                const leftPreferred = preferredId && left?.id === preferredId ? 1 : 0;
                const rightPreferred = preferredId && right?.id === preferredId ? 1 : 0;
                if (leftPreferred !== rightPreferred) {
                    return rightPreferred - leftPreferred;
                }

                const leftLocationMatch = locationId && this._thingLocationId(left) === locationId ? 1 : 0;
                const rightLocationMatch = locationId && this._thingLocationId(right) === locationId ? 1 : 0;
                if (leftLocationMatch !== rightLocationMatch) {
                    return rightLocationMatch - leftLocationMatch;
                }

                return this._getThingCount(right) - this._getThingCount(left);
            });
    }

    static _findContainersByExactName(containerName, { actor = null, location = null } = {}) {
        const normalizedName =
            typeof containerName === "string" ? containerName.trim().toLowerCase() : "";
        if (!normalizedName) {
            return [];
        }

        const sourceThings = this.things instanceof Map
            ? Array.from(this.things.values())
            : Thing.getAll();
        const locationId = typeof location?.id === "string" ? location.id.trim() : null;
        const actorId = typeof actor?.id === "string" ? actor.id.trim() : null;

        const scoreContainer = (thing) => {
            let score = 0;
            if (locationId && this._thingLocationId(thing) === locationId) {
                score += 8;
            }
            if (actorId && this._thingOwnedByActor(thing, actor)) {
                score += 4;
            }
            const containingThing = this._resolveContainingThing(thing);
            if (locationId && containingThing && this._thingLocationId(containingThing) === locationId) {
                score += 2;
            }
            if (actorId && containingThing && this._thingOwnedByActor(containingThing, actor)) {
                score += 2;
            }
            return score;
        };
        const hasContext = Boolean(locationId || actorId);

        return sourceThings
            .filter((thing) => (
                thing?.isContainer === true &&
                typeof thing.name === "string" &&
                thing.name.trim().toLowerCase() === normalizedName
            ))
            .filter((thing) => !hasContext || scoreContainer(thing) > 0)
            .sort((left, right) => scoreContainer(right) - scoreContainer(left));
    }

    static _resolveContainerByExactName(containerName, { actor = null, location = null, eventKey = "container_event" } = {}) {
        const candidates = this._findContainersByExactName(containerName, { actor, location });
        if (!candidates.length) {
            throw new Error(
                `${eventKey} could not find container "${containerName}".`,
            );
        }
        return candidates[0];
    }

    static _cloneThingWithQuantity(sourceThing, quantity, { metadataOverrides = {} } = {}) {
        if (!sourceThing) {
            throw new Error("_cloneThingWithQuantity requires a source thing.");
        }
        if (typeof sourceThing.copy !== "function") {
            throw new Error("_cloneThingWithQuantity requires Thing.copy to be available.");
        }
        return sourceThing.copy({
            count: quantity,
            metadataOverrides: {
                ...metadataOverrides,
                count: quantity,
            },
        });
    }

    static _splitThingForQuantity(sourceThing, quantity) {
        const sourceCount = this._getThingCount(sourceThing);
        if (!Number.isInteger(quantity) || quantity <= 0 || quantity >= sourceCount) {
            throw new Error(
                `_splitThingForQuantity requires quantity to be a positive integer less than the source count (${sourceCount}); got "${quantity}".`,
            );
        }

        const sourceMetadata = sourceThing.metadata && typeof sourceThing.metadata === "object"
            ? sourceThing.metadata
            : {};
        const splitThing = this._cloneThingWithQuantity(sourceThing, quantity, {
            metadataOverrides: {},
        });

        sourceThing.count = sourceCount - quantity;
        sourceThing.metadata = {
            ...sourceMetadata,
            count: sourceThing.count,
        };

        return splitThing;
    }

    static _resolveContainingThing(thing) {
        if (!thing) {
            return null;
        }

        if (typeof thing.whoseContainer === "function") {
            const containers = thing.whoseContainer() || [];
            if (Array.isArray(containers) && containers.length > 0) {
                return containers[0] || null;
            }
        }

        const metadata =
            thing.metadata && typeof thing.metadata === "object" ? thing.metadata : {};
        const containerIdCandidates = [
            metadata.containerId,
            metadata.containerID,
            metadata.container_id,
        ];
        for (const candidate of containerIdCandidates) {
            const containerId = typeof candidate === "string" ? candidate.trim() : "";
            if (!containerId) {
                continue;
            }
            const container = Thing.getById(containerId);
            if (container) {
                return container;
            }
        }

        return null;
    }

    static _placeSplitThingWithSourceContext(
        splitThing,
        { owner = null, container = null, location = null } = {},
    ) {
        if (!splitThing) {
            throw new Error("_placeSplitThingWithSourceContext requires a split thing.");
        }

        if (owner && typeof owner.addInventoryItem === "function") {
            const added = owner.addInventoryItem(splitThing, {
                suppressNpcEquip: true,
                mergeStacks: false,
            });
            if (!added) {
                throw new Error(
                    `Unable to place split stack "${splitThing.name}" in owner inventory.`,
                );
            }
            if (this.things instanceof Map) {
                this.things.set(splitThing.id, splitThing);
            }
            return "owner";
        }

        if (container && typeof container.addInventoryItem === "function") {
            const added = container.addInventoryItem(splitThing, { mergeStacks: false });
            if (!added) {
                throw new Error(
                    `Unable to place split stack "${splitThing.name}" in container "${container.name || container.id}".`,
                );
            }
            if (this.things instanceof Map) {
                this.things.set(splitThing.id, splitThing);
            }
            return "container";
        }

        if (location && typeof location.addThingId === "function") {
            location.addThingId(splitThing.id, { mergeStacks: false });
            if (this.things instanceof Map) {
                this.things.set(splitThing.id, splitThing);
            }
            return "location";
        }

        throw new Error(
            `Unable to place split stack "${splitThing.name}" because the source placement could not be resolved.`,
        );
    }

    static _extractThingQuantityFromCandidates(candidates, quantity, { itemName, eventKey }) {
        if (!Array.isArray(candidates) || !candidates.length) {
            throw new Error(`${eventKey} could not find any thing matching "${itemName}".`);
        }

        let remaining = quantity;
        const selected = [];

        for (const candidate of candidates) {
            if (!candidate) {
                continue;
            }
            const candidateCount = this._getThingCount(candidate);
            if (candidateCount <= 0) {
                continue;
            }

            if (candidateCount <= remaining) {
                selected.push(candidate);
                remaining -= candidateCount;
            } else {
                const splitThing = this._splitThingForQuantity(candidate, remaining);
                if (this.things instanceof Map) {
                    this.things.set(splitThing.id, splitThing);
                }
                selected.push(splitThing);
                remaining = 0;
            }

            if (remaining === 0) {
                break;
            }
        }

        if (remaining > 0) {
            throw new Error(
                `${eventKey} could not satisfy quantity ${quantity} for "${itemName}". ${remaining} still missing.`,
            );
        }

        return selected;
    }

    static _consumeThingQuantity(thing, quantity, context = {}) {
        const priorCount = this._getThingCount(thing);
        if (!Number.isInteger(quantity) || quantity <= 0 || quantity > priorCount) {
            throw new Error(
                `_consumeThingQuantity requires a positive integer quantity no greater than the source count (${priorCount}); got "${quantity}".`,
            );
        }

        if (quantity === priorCount) {
            this._spillContainerContentsBeforeDeleting(thing, context);
            this._detachThingFromWorld(thing);
            return {
                deleted: true,
                decremented: false,
                priorCount,
                remainingCount: 0,
                consumedCount: quantity,
            };
        }

        thing.count = priorCount - quantity;
        thing.metadata = {
            ...(thing.metadata && typeof thing.metadata === "object" ? thing.metadata : {}),
            count: thing.count,
        };

        return {
            deleted: false,
            decremented: true,
            priorCount,
            remainingCount: thing.count,
            consumedCount: quantity,
        };
    }

    static _resolveThingPlacement(thing, context = {}) {
        if (!thing) {
            return null;
        }

        const containingThing = this._resolveContainingThing(thing);
        if (containingThing) {
            return { type: "container", container: containingThing };
        }

        if (typeof thing.whoseInventory === "function") {
            const owners = thing.whoseInventory().filter(Boolean);
            if (owners.length > 0) {
                return { type: "owner", owner: owners[0] };
            }
        }

        const metadata = thing.metadata && typeof thing.metadata === "object"
            ? thing.metadata
            : {};
        const ownerIdCandidates = [
            metadata.ownerId,
            metadata.ownerID,
            metadata.owner_id,
            metadata.playerId,
            metadata.player_id,
            metadata.inventoryOwnerId,
            metadata.inventory_owner_id,
        ];
        const findActorById = this._deps?.findActorById;
        for (const candidate of ownerIdCandidates) {
            const ownerId = typeof candidate === "string" ? candidate.trim() : "";
            if (!ownerId || typeof findActorById !== "function") {
                continue;
            }
            const owner = findActorById(ownerId);
            if (owner && typeof owner.addInventoryItem === "function") {
                return { type: "owner", owner };
            }
        }

        const locationId = this._thingLocationId(thing);
        if (locationId) {
            const location = this.resolveLocationCandidate(locationId);
            if (location) {
                return { type: "location", location };
            }
        }

        const contextLocation = this.resolveLocationCandidate(context.location || null);
        if (contextLocation) {
            return { type: "location", location: contextLocation };
        }

        return null;
    }

    static _placeSpilledContainerItem(item, placement) {
        if (!item || !placement) {
            throw new Error("_placeSpilledContainerItem requires an item and destination placement.");
        }

        if (placement.type === "container") {
            const targetContainer = placement.container;
            if (!targetContainer || typeof targetContainer.addInventoryItem !== "function") {
                throw new Error("Container spill destination is not a valid container.");
            }
            targetContainer.addInventoryItem(item);
        } else if (placement.type === "owner") {
            const owner = placement.owner;
            if (!owner || typeof owner.addInventoryItem !== "function") {
                throw new Error("Container spill destination is not a valid inventory owner.");
            }
            const added = owner.addInventoryItem(item, { suppressNpcEquip: true });
            if (!added) {
                throw new Error(`Failed to spill "${item.name || item.id}" into owner inventory.`);
            }
        } else if (placement.type === "location") {
            const location = placement.location;
            if (!location || typeof location.addThingId !== "function") {
                throw new Error("Container spill destination is not a valid location.");
            }
            location.addThingId(item.id);
        } else {
            throw new Error(`Unsupported container spill destination "${placement.type}".`);
        }

        if (this.things instanceof Map && Thing.getById(item.id) === item) {
            this.things.set(item.id, item);
        }
    }

    static _spillContainerContentsBeforeDeleting(thing, context = {}) {
        if (!thing || !thing.isContainer || typeof thing.getInventoryItems !== "function") {
            return [];
        }

        const contents = thing.getInventoryItems();
        if (!contents.length) {
            return [];
        }

        const placement = this._resolveThingPlacement(thing, context);
        if (!placement) {
            throw new Error(
                `Cannot delete non-empty container "${thing.name || thing.id}" because its current placement could not be resolved.`,
            );
        }

        const spilled = [];
        for (const item of contents) {
            if (!item) {
                throw new Error(
                    `Cannot delete non-empty container "${thing.name || thing.id}" because one contained item could not be resolved.`,
                );
            }
            const removed = thing.removeInventoryItem(item, { updateTimestamp: false });
            if (!removed) {
                throw new Error(
                    `Failed to remove "${item.name || item.id}" from container "${thing.name || thing.id}" before deletion.`,
                );
            }
            this._placeSpilledContainerItem(item, placement);
            spilled.push(item);
        }

        if (typeof thing.clearInventory === "function") {
            thing.clearInventory();
        }
        return spilled;
    }

    static _removeItemFromInventories(thing) {
        const { findActorById } = this._deps;
        const metadata = thing.metadata || {};
        if (metadata.ownerId && typeof findActorById === "function") {
            const owner = findActorById(metadata.ownerId);
            if (owner && typeof owner.removeInventoryItem === "function") {
                console.debug(
                    `[consume_item] Removing ${thing.name || thing.id} from owner ${owner.name || owner.id}.`,
                );
                owner.removeInventoryItem(thing);
            } else if (owner) {
                console.debug(
                    `[consume_item] Owner ${owner.name || owner.id} lacks removeInventoryItem.`,
                );
            } else {
                console.debug(
                    `[consume_item] Owner with id ${metadata.ownerId} not found.`,
                );
            }
        } else if (metadata.ownerId) {
            console.debug(
                `[consume_item] Cannot resolve owner ${metadata.ownerId} for ${thing.name || thing.id}.`,
            );
        }
    }

    static _detachThingFromKnownLocation(thing) {
        const metadata = thing.metadata || {};
        if (!metadata.locationId) {
            return;
        }
        this.removeThingFromLocation(thing, metadata.locationId);
        delete metadata.locationId;
        thing.metadata = metadata;
    }

    static _detachThingFromWorld(thing) {
        this._removeItemFromInventories(thing);
        this._detachThingFromKnownLocation(thing);
        if (typeof thing.delete === "function") {
            thing.delete();
        }
        const things = this.things;
        if (things instanceof Map) {
            things.delete(thing.id);
        } else if (Array.isArray(things)) {
            const index = things.findIndex((candidate) => candidate?.id === thing.id);
            if (index >= 0) {
                things.splice(index, 1);
            }
        } else if (things && typeof things === "object" && thing.id) {
            delete things[thing.id];
        }
    }

    static _estimateHealingAmount(magnitude, actor) {
        const max = Number(actor.maxHealth) || 10;
        switch ((magnitude || "").toLowerCase()) {
            case "all":
                return Math.max(1, max);
            case "large":
                return Math.max(1, Math.round(max * 0.75));
            case "medium":
                return Math.max(1, Math.round(max * 0.5));
            default:
                return Math.max(1, Math.round(max * 0.25));
        }
    }

    static _severityToDamage(severity, context = {}) {
        const base =
            Number(context.location?.baseLevel) || Number(context.player?.level) || 1;
        const medium = Math.max(1, Math.round(8 + base * 2));
        if (severity === "high") {
            return Math.round(medium * 1.75);
        }
        if (severity === "low") {
            return Math.max(1, Math.round(medium * 0.25));
        }
        return medium;
    }

    static resolveLocationCandidate(candidate) {
        if (!candidate) {
            return null;
        }
        const { Location } = this._deps;
        if (
            typeof candidate === "string" &&
            Location &&
            typeof Location.get === "function"
        ) {
            try {
                return Location.get(candidate) || null;
            } catch (_) {
                return null;
            }
        }
        if (typeof candidate === "object" && typeof candidate.id === "string") {
            return candidate;
        }
        return null;
    }

    static addThingToLocation(thing, candidate) {
        if (!thing) {
            return;
        }
        const location = this.resolveLocationCandidate(candidate);
        if (!location || typeof location.addThingId !== "function") {
            return;
        }
        location.addThingId(thing.id);
        if (Thing.getById(thing.id) !== thing) {
            return;
        }
        const metadata = thing.metadata || {};
        metadata.locationId = location.id;
        delete metadata.ownerId;
        thing.metadata = metadata;
    }

    static removeThingFromLocation(thing, candidate) {
        if (!thing) {
            return;
        }
        const location = this.resolveLocationCandidate(candidate);
        if (!location || typeof location.removeThingId !== "function") {
            return;
        }
        location.removeThingId(thing.id);
    }

    static cleanEventResponseText(text) {
        if (typeof text !== "string") {
            return "";
        }
        return text.replace(/[\*\[\]]/g, "").trim();
    }

    static escapeHtml(text) {
        if (typeof text !== "string") {
            return "";
        }
        return text.replace(/[&<>'"]/g, (char) => {
            switch (char) {
                case "&":
                    return "&amp;";
                case "<":
                    return "&lt;";
                case ">":
                    return "&gt;";
                case '"':
                    return "&quot;";
                case "'":
                    return "&#39;";
                default:
                    return char;
            }
        });
    }

    static logEventCheck({
        systemPrompt,
        generationPrompt,
        responseText,
        label = null,
        metadataLabel = "event_checks",
        prefix = null,
        requestPayload = null,
        responsePayload = null,
    }) {
        const resolvedMetadataLabel =
            typeof metadataLabel === "string" && metadataLabel.trim()
                ? metadataLabel.trim()
                : "event_checks";
        const resolvedPrefix =
            typeof prefix === "string" && prefix.trim()
                ? prefix.trim()
                : label
                    ? `${resolvedMetadataLabel}_${label}`
                    : resolvedMetadataLabel;
        LLMClient.logPrompt({
            prefix: resolvedPrefix,
            metadataLabel: resolvedMetadataLabel,
            systemPrompt: systemPrompt || "",
            generationPrompt: generationPrompt || "",
            response: responseText || "",
            requestPayload,
            responsePayload,
        });
    }

    static get config() {
        const { getConfig, config } = this._deps;
        if (typeof getConfig === "function") {
            return getConfig();
        }
        return config || {};
    }

    static get currentPlayer() {
        const { getCurrentPlayer, currentPlayer } = this._deps;
        if (typeof getCurrentPlayer === "function") {
            return getCurrentPlayer();
        }
        return currentPlayer || null;
    }

    static get players() {
        return this._deps.players;
    }

    static get things() {
        return this._deps.things;
    }

    static async _createPlaceholderThingForAlter(entry = {}, context = {}) {
        const { things } = this._deps;

        const candidateName =
            typeof entry.newName === "string" && entry.newName.trim()
                ? entry.newName.trim()
                : typeof entry.originalName === "string" && entry.originalName.trim()
                    ? entry.originalName.trim()
                    : null;

        if (!candidateName) {
            return null;
        }

        const description =
            entry.changeDescription && entry.changeDescription.trim()
                ? entry.changeDescription.trim()
                : `An item named ${candidateName}.`;

        const ownerCandidate =
            context.player && typeof context.player.addInventoryItem === "function"
                ? context.player
                : null;

        let locationCandidate = context.location || null;
        if (!locationCandidate && ownerCandidate?.currentLocation) {
            locationCandidate = ownerCandidate.currentLocation;
        }

        const metadata = {};
        if (ownerCandidate && typeof ownerCandidate.id === "string") {
            metadata.ownerId = ownerCandidate.id;
        } else {
            const resolvedLocation =
                this.resolveLocationCandidate(locationCandidate) ||
                this.resolveLocationCandidate(this.currentPlayer?.currentLocation);
            if (resolvedLocation) {
                metadata.locationId = resolvedLocation.id;
                metadata.locationName = resolvedLocation.name || resolvedLocation.id;
            }
        }

        const thing = new Thing({
            name: candidateName,
            description,
            thingType: "item",
            rarity: Thing.getDefaultRarityLabel(),
            count: Number.isInteger(entry.quantity) ? entry.quantity : undefined,
            metadata,
        });

        if (things instanceof Map) {
            things.set(thing.id, thing);
        }

        if (metadata.ownerId && ownerCandidate) {
            try {
                ownerCandidate.addInventoryItem?.(thing);
            } catch (error) {
                console.warn(
                    `Failed to add placeholder item ${candidateName} to owner:`,
                    error.message,
                );
            }
        } else if (metadata.locationId) {
            this.addThingToLocation(thing, metadata.locationId);
        }

        const resolvedLocation =
            this.resolveLocationCandidate(locationCandidate) ||
            this.resolveLocationCandidate(this.currentPlayer?.currentLocation);
        let resolvedRegion = null;
        if (
            resolvedLocation &&
            typeof this._deps.findRegionByLocationId === "function"
        ) {
            try {
                resolvedRegion =
                    this._deps.findRegionByLocationId(resolvedLocation.id) || null;
            } catch (_) {
                resolvedRegion = null;
            }
        }
        if (typeof Globals.ensureThingNamesAllowed !== "function") {
            throw new Error(
                "Globals.ensureThingNamesAllowed is unavailable for item name validation.",
            );
        }
        await Globals.ensureThingNamesAllowed({
            things: [thing],
            location: resolvedLocation,
            region: resolvedRegion,
        });

        return thing;
    }
}

module.exports = Events;
