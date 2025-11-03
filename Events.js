const SanitizedStringSet = require('./SanitizedStringSet.js');
const Utils = require('./Utils.js');
const Thing = require('./Thing.js');
const Globals = require('./Globals.js');
const Quest = require('./Quest.js');
const LLMClient = require('./LLMClient.js');

const BASE_TIMEOUT_MS = 120000;
const DEFAULT_STATUS_DURATION = 3;
const MAJOR_STATUS_DURATION = 5;

const EVENT_PROMPT_ORDER = [
    // Location stuff
    [
        { key: 'dummy_event', prompt: `Did the text reveal, unlock, unblock, or otherwise create a new exit?` },
        { key: 'new_exit_discovered', prompt: `Did the text reveal, unlock, unblock, or otherwise discover a new exit or vehicle to another region or location (Note: roads, trails, paths, doors, portals, etc are exits and not scenery)? Or, did the player or any other entity create a new exit, clear a path, make a door, etc? If so, reply in the form [destination location or region name] -> [the word "location" or "region"] -> [type of vehicle or "none"] -> [description of the location or region in 1-2 sentences]. In case of more than one, separate them with vertical bars. Otherwise answer N/A. An exit to a region may take the form of a vehicle to that region. If the new location or region is already known to the player or if it isn't, list it here. The exit may be to an existing location, but an exit to that new location may not already exist in this current location.` },
        // This dummy event gets the LLM to choose between mutually exclusive types of movement.
        { key: 'dummy_event', prompt: `Did the player or party move at all? If so, give the most appropriate answer.  It should be one of: 'moved to new region', 'moved to new location', 'moved to a new room (location)', 'moved into a large building or structure (region)', 'moved within location to somewhere fully visible', 'moved within location to somewhere not fully visible (sublocation)', 'moved to different existing location', 'sitting down or resting' or 'hiding/taking cover in this location'. If the player did not physically move, answer N/A.` },
        { key: 'dummy_event', prompt: `Did you answer question 3 with 'moved within location to somewhere fully visible'? If so, give the exact name of the scenery.` },
        { key: 'dummy_event', prompt: `Did you answer question 3 with 'hiding/taking cover in this location'? If so, give the exact name of the scenery they used to hide/take cover.` },
        { key: 'move_new_location', prompt: `The starting location is %CURRENT_LOCATION%. If you answered 'moved to new region', 'moved to new location', 'moved into a large building or structure (region)', or 'moved to a new room (location)'  to question 3, come up with a new location name and reply in the form [describe what is different from %CURRENT_LOCATION%] -> [change the name and put it here] -> [the word "location" or "region"] -> [type of vehicle or "none"] -> [description of what makes this new destination distinct in 1-2 sentences]. The new location/region may not have the same name as the current one. Moving into a large building or structure should be listed as "region".` },
        { key: 'move_new_location', prompt: `The starting location is %CURRENT_LOCATION%. If you answered question 3 with 'moved within location to somewhere not fully visible (sublocation)', come up with an appropriate sub-location and reply in the form [describe what is different from %CURRENT_LOCATION%] -> [change the name and put it here] -> [the word "sublocation"] -> [type of vehicle or "none"] -> [description of what makes this new destination distinct in 1-2 sentences]. The sublocation may not have the same name as the current location. Otherwise answer N/A.` },
        { key: 'move_location', prompt: `The starting location is %CURRENT_LOCATION%. Did the player travel to or end up in a different existing location? If so, answer with the exact name; otherwise answer N/A. If you don't know where they ended up, pick an existing location nearby.` },
        { key: 'alter_location', prompt: `Was the current location permanently altered in a significant way (major changes to the location itself, not npcs, items, or scenery)? If so, answer in the format "[current location name] -> [new location name] -> [1 sentence description of alteration]". If not (or if the player moved from one location to another, which isn't an alteration), answer N/A. Pay close attention to things that are listed as sceneryItems in the location context, as these are not the location itself. Note that it is not necessary to change the name of the location if it remains appropriate after the alteration; in this case, simply repeat the same name for new location name.` },
        //],
        // Item stuff
        //[
        { key: 'currency', prompt: `Did the player gain or lose currency? If so, how much? Respond with a positive or negative integer. Otherwise, respond N/A. Do not include currency changes in any answers below, as currency is tracked separately from items.` },
        { key: 'item_to_npc', prompt: `Did any inanimate object (e.g., robot, drone, statue, furniture, machinery, or any other scenery) become capable of movement or act as an independent entity? If so, respond in this format: "[exact item or scenery name] -> [new npc/entity name] -> [5-10 word description of what happened]". Separate multiple entries with vertical bars. If none, respond N/A.` },
        { key: 'alter_item', prompt: `Was an item or piece of scenery in the scene or any inventory permanently altered in any way (e.g., upgraded, modified, enchanted, broken, etc.)? If so, answer in the format "[exact item name] -> [new item name or same item name] -> [1 sentence description of alteration]". If multiple items were altered, separate multiple entries with vertical bars. If it doesn't make sense for the name to change, use the same name for new item name. Note that if a meaningful fraction of an an object was consumed (a slice of cake, but not a single piece of wood from a large pile), this is considered an alteration. If the *entire* thing was consumed, this is considered completely consumed and not alteration.` },
        { key: 'consume_item', prompt: `Were any items or pieces of scenery completely used up (leaving none left), either by being used as components in crafting, by being eaten or drunk, or by being otherwise completely destroyed? If so, list them in this format: "[exact name of item] -> [how item was consumed]" separated by vertical bars. Otherwise, answer N/A. Harvesting, gathering, or otherwise picking up an item does NOT consume it.` },
        { key: 'transfer_item', prompt: `Did anyone hand, trade, or give an item to someone else? If so, list "[exact name of the giver] -> [item] -> [exact name of the receiver]". If there are multiple entries, separate them with vertical bars. Otherwise, answer N/A.` },
        { key: 'pick_up_item', prompt: `Of any items not listed as consumed or altered, did anyone obtain one or more tangible carryable items or resources (not buildings or furniture) by any method other than harvesting or gathering? If so, list the full name of the person who obtained the item as seen in the location context ("player" if it was the player) and the exact names of those items (capitalized as Proper Nouns) separated by vertical bars. Use the format: "[name] -> [item] | [name] -> [item]". Otherwise, answer N/A. Note that even if an item was crafted with multiple ingredients, it should only be listed once here as a new item.` },
        { key: 'harvest_gather', prompt: `Did anyone harvest or gather from any natural or man-made resources or collections (for instance, a berry bush, a pile of wood, a copper vein, a crate of spare parts, etc)? If so, answer with the full name of the person who did so as seen in the location context ("player" if it was the player) and the exact name of the item(s) they would obtain from harvesting or gathering. If multiple items would be gathered this way, separate with vertical bars. Format like this: "[name] -> [item] | [name] -> [item]", up to three items at a time. Otherwise, answer N/A. For example, if harvesting from a "Raspberry Bush", the item obtained would be "Raspberries", "Ripe Raspberries", or similar.` },
        { key: 'item_appear', prompt: `Did any new inanimate items appear in the scene for the first time, either as newly created items or items that were mentioned as already existing but had not been previously described in the scene context? If so, list them in the format format as "[exact item name] -> [description]" with multiple items separated by vertical bars. Otherwise, answer N/A. Note that even if an item was crafted with multiple ingredients, it should only be listed once here as a new item.` },
        { key: 'drop_item', prompt: `Of any items not listed above, were any items dropped, placed, or set down from an entity's inventory onto the scene? If so, list the full name of the person who dropped the item as seen in the location context ("player" if it was the player) and the exact names of those items (capitalized as Proper Nouns) separated by vertical bars. Use the format: "[name] -> [item] | [name] -> [item]". Otherwise, answer N/A.` },
        { key: 'scenery_appear', prompt: `Of anything you did not list above, did any new scenery, furniture, buildings, workstations, containers, or other non-carryable items appear in the scene for the first time, either as newly created items or items that were mentioned as already existing but had not been previously described in the scene context? If so, list them in the format format as "[exact name] -> [description]" with multiple items separated by vertical bars. Otherwise, answer N/A.` },
        { key: 'harvestable_resource_appear', prompt: `Of anything you did not list above, did any harvestable or gatherable resources (e.g., plants, minerals, fields, planters, machines that create resources or other harvestable/gatherable scenery) appear in the scene for the first time, either as newly created scenery or scenery that was mentioned as already existing but had not been previously described in the scene context? If so, list them in the format format as "[exact name] -> [description]" with multiple items separated by vertical bars. Otherwise, answer N/A.` },
        //],
        // NPC stuff
        //[
        { key: 'attack_damage', prompt: `Did any entity attack any other entity?  If so, answer in the format "[attacker] -> [target]". If there are multiple attackers, separate multiple entries with vertical bars. Note that an attack only took place if the attacker did something that could cause physical damage to the target. Things like shoving, grappling, healing spells, buffs, debuffs, or other contact that's not intended to cause physical damage don't count. If no attack, answer N/A.` },
        { key: 'alter_npc', prompt: `Were any animate entities (NPCs, animals, monsters, robots, or anything else capable of moving on its own) physically changed permanently in any way, such as being transformed, upgraded, downgraded, enhanced, damaged, repaired, healed modified, or otherwise physically altered, by anything other than damage from an attack? If so, answer in the format "[exact character name] -> [injury|status effect|gear|mental change|physical transformation] -> [1-2 sentence description of the change]". If multiple characters were altered, separate multiple entries with vertical bars. Note that things like temporary magical polymorphs and being turned to stone (where it's possible that it may be reversed) are better expressed as status effects and should not be mentioned here. If no characters were altered (which will be the case most of the time), answer N/A.` },
        { key: 'status_effect_change', prompt: `Did any animate entities (NPCs, animals, monsters, robots, or anything else capable of moving on its own) gain or lose any temporary status effects that you didn't list above as permanent changes? If so, list them in this format: "[entity] -> [10 or fewer word description of effect] -> [gained/lost]". If there are multiple entries, separate them with vertical bars. Otherwise answer N/A.  Don't use redundant wording in the status effect description. We already know if the status is gained or lost, so just say 'Bob -> drunk -> gained' or 'Bob -> drunk -> lost'. When losing a status effect, use the exact name listed with the character XML.` },
        { key: 'npc_arrival_departure', prompt: `Did any animate entities (NPCs, animals, monsters, robots, or anything else capable of moving on its own) leave the scene? If so, list the full names of those entities as seen in the location context (capitalized as Proper Nouns) separated by vertical bars. Decide what location they went to. Use the format: "[name] left -> [destination region] -> [destination location]". If you don't know exactly where they went, what makes the most sense. Otherwise, answer N/A.`, postProcess: entry => ({ ...entry, action: entry?.action || 'left' }) },
        { key: 'npc_arrival_departure', prompt: `Did any animate entities (NPCs, animals, monsters, robots, or anything else capable of moving on its own) arrive at this location from elsewhere? If so, list the full names of those entities as seen in the location context (capitalized as Proper Nouns) separated by vertical bars. Use the format: "[name] arrived". Otherwise, answer N/A.`, postProcess: entry => ({ ...entry, action: entry?.action || 'arrived' }) },
        { key: 'npc_first_appearance', prompt: `Did any animate entities (NPCs, animals, monsters, robots, or anything else capable of moving on its own) appear for the first time on the scene, or become visible or known to the player, either as newly created entities or entities that were mentioned as already existing but had not been previously described in the scene context? If so, list the full names of those entities as seen in the location context (capitalized as Proper Nouns) separated by vertical bars. Otherwise, answer N/A.` },
        { key: 'npc_first_appearance', prompt: `List all entities (NPCs, animals, monsters, robots, etc.) that the player interacted with in textToCheck which aren't already listed in your answers above, in the player's party, or in the location's context. Separate entries with vertical bars. If none, answer N/A.` },
        { key: 'party_change', prompt: `Is any entity (including ones you may have listed above) that is not listed in playerParty currently leading, following, or otherwise willingly accompanying the player? If yes, list "[npc name] -> joined". For anyone who began leading or following (even temporarily), also list them as "[npc name] -> joined". If anyone left the party, list "[npc name] -> left". Separate multiple entries with vertical bars. If no party status occurred, respond with N/A.` },
        { key: 'environmental_status_damage', prompt: `Did any animate entities take environmental damage or damage from an ongoing status effect? Were they healed by the environment or an ongoing status effect? If so, answer in the format "[exact name] -> [damage|healing] -> [low|medium|high] -> [1 sentence describing why damage was taken]". If there are multiple instances of damage, separate multiple entries with vertical bars. Otherwise, answer N/A.` },
        { key: 'heal_recover', prompt: `Did anyone heal or recover health? If so, answer in the format "[character] -> [small|medium|large|all] -> [reason]". If there are multiple characters, separate multiple entries with vertical bars. Otherwise, answer N/A. Health recovery from natural regeneration, food, resting tends to be small or medium, whereas healing from potions, spells, bed rest, or medical treatment tends to be medium or large. Consider the context of the event, the skill of the healer (if applicable), the rarity and properties of any healing items used, etc.` },
        { key: 'needbar_change', prompt: `Does anything that happened in this turn affect any need bars for any characters (NPCs or player)? If so, for each character rested or acted in any way, answer with the following four arguments: "[exact name of character] -> [exact name of need bar] -> [increase or decrease] -> [none|small|medium|large|all] | ..." for each of their need bars (including unchanged ones), separating multiple adjustments with vertical bars (multiple characters may have multiple need bar changes). Pay attention to the need bar descriptions to see how much they should change based on the situation. Also consider the descriptions of items involved, which may override those. Need bars are affected fully even if the character takes the same action multiple times in a row or continues the same action over multiple turns. Err on the side of being generous with need bar increases. If no changes to need bars, answer N/A.` },
        { key: 'in_combat', prompt: `Could the player be considered to be in physical combat at the moment? This can be true even if the player did not attack and was not directly attacked. Answer Yes or No.` },
        { key: 'received_quest', prompt: `Did the player become aware of one or more quests or tasks this turn (by reading them, hearing about them, having them directly requested, etc), even if they didn't actively acknowledge or accept it? Also include quests that the player thought of themselves ("I need to go collect some iron so I can craft a new dagger", etc). If so, answer in the following format: "[exact name of quest giver] -> [1 sentence description of quest] | ..."` },
        { key: 'completed_quest_objective', prompt: `Did the player complete one or more quest objectives this turn? If so, answer in the following format: "[exact name of quest] -> [index completed objective] | ..."` },
        { key: 'death_incapacitation', prompt: `Did any entity die or become incapacitated? If so, reply in this format: "[exact name of character/entity] -> ["dead" or "incapacitated"]. If multiple, separate with vertical bars. Otherwise answer N/A.` },
        { key: 'defeated_enemy', prompt: `Did the player defeat an enemy this turn? If so, respond with the exact name of the enemy. If there are multiple enemies, separate multiple names with vertical bars. Otherwise, respond N/A.` },
        { key: 'experience_check', prompt: `Did the player do something (other than defeating an enemy) that would cause them to gain experience points? If so, respond with "[integer from 1-100] -> [reason in one sentence]" (note that experience cannot be gained just because something happened to the player; the player must have taken a specific action that contributes to their growth or development). Otherwise, respond N/A. See that sampleExperiencePointValues section for examples of actions that might grant experience points and how much.` },
        { key: 'disposition_check', prompt: `Did any NPC's disposition toward the player change in a significant way? If so, respond with "[exact name of NPC] -> [how they felt before] -> [how they feel now] -> [reason in one sentence]". If multiple NPCs' dispositions changed, separate multiple entries with vertical bars. Otherwise, respond N/A.  If they feel the same way as they did before, the change isn't significant and shouldn't be listed here.` },
        { key: 'time_passed', prompt: `In decimal hours, how much time has passed since the last turn (e.g., 0.5 for half an hour, 1.25 for one hour and fifteen minutes) 8.0 for eight hours, 24.0 for a day, etc.)? If no time has passed, answer 0. Do not specify units.` },
        { key: 'triggered_abilities', prompt: `Were any character's triggered abilities triggered this turn? If so, list them in the format "[exact character name] -> [exact ability name]", separated by '|' if multiple. If none, answer N/A.` },
        { key: 'dummy_event', prompt: `Did any of the answers to the above questions feel ambiguous? Which ones, and why?` }
    ]
];

const EVENT_PROMPT_ORDER_FLAT = EVENT_PROMPT_ORDER.flat();

const NO_EVENT_TOKENS = new Set(['n/a', 'na', 'none', 'nothing']);

function isBlank(value) {
    return !value || (typeof value === 'string' && !value.trim());
}

function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function parsePositiveDecimal(value) {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || value <= 0) {
            return null;
        }
        return value;
    }
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed)) {
        return null;
    }
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return null;
    }
    return numeric;
}

function splitPipeList(raw) {
    if (isBlank(raw)) {
        return [];
    }
    return raw
        .split('|')
        .map(part => part.trim())
        .filter(part => part.length > 0 && !NO_EVENT_TOKENS.has(part.toLowerCase()));
}

function splitArrowParts(raw, expectedParts) {
    if (isBlank(raw)) {
        return [];
    }

    // unescape &gt; and &lt;
    const unescaped = raw
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<');

    const parts = unescaped
        .split('->')
        .map(part => part.trim())
        .filter(Boolean);

    if (!expectedParts || parts.length < expectedParts) {
        return parts;
    }

    if (expectedParts === 2) {
        return [parts[0], parts.slice(1).join(' -> ')];
    }

    if (expectedParts === 3) {
        return [parts[0], parts[1], parts.slice(2).join(' -> ')];
    }

    if (expectedParts === 4) {
        return [parts[0], parts[1], parts[2], parts.slice(3).join(' -> ')];
    }

    return parts;
}

function stripAfterFirstArrow(raw) {
    if (typeof raw !== 'string') {
        return '';
    }
    const arrowIndex = raw.indexOf('->');
    const segment = arrowIndex === -1 ? raw : raw.slice(0, arrowIndex);
    return segment.trim();
}

async function applyExitDiscovery(eventsInstance, entries = [], context = {}, {
    movePlayer = false,
    eventLabel = 'new_exit_discovered',
    moveLabel = 'move_location'
} = {}) {
    if (!Array.isArray(entries) || !entries.length) {
        return;
    }

    const deps = eventsInstance._deps || {};
    const {
        Location,
        findLocationByNameLoose,
        createLocationFromEvent,
        createRegionStubFromEvent,
        ensureExitConnection,
        regenerateLocationName
    } = deps;

    const originLocation = context.location;
    if (!originLocation || typeof Location?.get !== 'function' || typeof ensureExitConnection !== 'function') {
        return;
    }

    const processedDestinations = new SanitizedStringSet();

    for (const entry of entries) {
        //console.log(`Processing exit discovery entry: ${entry.name}`);
        //console.trace();
        let exitName = typeof entry?.name === 'string' ? entry.name.trim() : '';
        if (!exitName) {
            continue;
        }

        const originNameFromEntry = typeof entry?.origin === 'string' ? entry.origin.trim() : '';
        const originLocationName = originLocation?.name ? originLocation.name.trim() : '';
        const originReference = originNameFromEntry || originLocationName || null;

        //console.log(`entry for exit discovery: ${JSON.stringify(entry)}`);

        //console.log(`Checking exit "${exitName}" from origin "${originReference}"`);
        if (entry.name.toLowerCase().trim() === Globals.currentPlayer.getCurrentLocationName().toLowerCase().trim()) {
            try {
                const regenInput = {
                    name: exitName,
                    description: entry?.description || `A location connected to ${originReference}.`,
                    regionId: Globals.currentPlayer.currentLocation.regionId,
                    baseLevel: Number.isFinite(originLocation?.baseLevel) ? originLocation.baseLevel : 1,
                    stubMetadata: originLocation?.stubMetadata || {}
                };
                const regenResult = await regenerateLocationName(regenInput);
                if (regenResult?.name) {
                    exitName = regenResult.name.trim();
                    entry.name = exitName;
                    console.debug(`[${eventLabel}] Renamed destination via regenerateLocationName.`, {
                        originalName: originReference,
                        newName: exitName
                    });
                }
            } catch (error) {
                console.debug([error]);
            }
        }

        if (processedDestinations.has(exitName)) {
            continue;
        }

        processedDestinations.add(exitName);

        let destination = null;
        let createdRegionStub = false;

        if (typeof findLocationByNameLoose === 'function') {
            destination = findLocationByNameLoose(exitName) || null;
        }
        if (!destination && typeof Location.findByName === 'function') {
            try {
                destination = Location.findByName(exitName);
            } catch (_) {
                destination = null;
            }
        }

        const isRegion = entry?.kind === 'region';

        if (!destination && isRegion && typeof createRegionStubFromEvent === 'function') {
            try {
                destination = await createRegionStubFromEvent({
                    name: exitName,
                    originLocation,
                    description: entry?.description || `Entrance to ${exitName}.`,
                    vehicleType: entry?.vehicleType || null,
                    isVehicle: Boolean(entry?.vehicleType)
                }) || null;
                createdRegionStub = Boolean(destination);
            } catch (error) {
                throw new Error(`[${eventLabel}] Failed to create region stub for "${exitName}": ${error.message}`);
            }
        }

        if (!destination && typeof createLocationFromEvent === 'function') {
            try {
                destination = await createLocationFromEvent({
                    name: exitName,
                    originLocation,
                    descriptionHint: entry?.description || `A path leading to ${exitName}.`,
                    vehicleType: entry?.vehicleType || null,
                    isVehicle: Boolean(entry?.vehicleType),
                    expandStub: false
                });
            } catch (error) {
                throw new Error(`[${eventLabel}] Failed to create destination "${exitName}": ${error.message}`);
            }
        }

        if (!destination) {
            throw new Error(`[${eventLabel}] Unable to resolve destination for exit "${exitName}".`);
        }

        if (destination?.id && originLocation?.id && destination.id === originLocation.id) {
            if (movePlayer) {
                await movePlayerToDestination(eventsInstance, destination, context, {
                    fallbackName: exitName,
                    label: moveLabel
                });
            }
            continue;
        }

        const destinationRegionRaw = isRegion
            ? (destination?.stubMetadata?.regionId
                || destination?.stubMetadata?.targetRegionId
                || destination?.regionId
                || null)
            : (typeof destination?.regionId === 'string' ? destination.regionId
                : typeof destination?.stubMetadata?.regionId === 'string' ? destination.stubMetadata.regionId
                    : typeof destination?.stubMetadata?.targetRegionId === 'string' ? destination.stubMetadata.targetRegionId
                        : null);

        const destinationRegionId = typeof destinationRegionRaw === 'string'
            ? destinationRegionRaw.trim() || null
            : destinationRegionRaw === null ? null : undefined;

        if (isRegion && !destinationRegionId) {
            throw new Error(`[${eventLabel}] Destination region metadata missing for exit "${exitName}".`);
        }

        const exitDescription = entry?.description || `Path to ${destination.name || exitName}`;
        const vehicleType = entry?.vehicleType || null;
        const isVehicleExit = Boolean(vehicleType);

        if (!createdRegionStub) {
            try {
                ensureExitConnection(originLocation, destination, {
                    description: exitDescription,
                    bidirectional: !isRegion,
                    destinationRegion: destinationRegionId,
                    isVehicle: isVehicleExit,
                    vehicleType
                });
            } catch (error) {
                throw new Error(`[${eventLabel}] Failed to ensure exit connection to "${destination.name || exitName}": ${error.message}`);
            }
        }

        if (!isRegion) {
            const originRegionRaw = typeof originLocation?.regionId === 'string'
                ? originLocation.regionId
                : typeof originLocation?.stubMetadata?.regionId === 'string'
                    ? originLocation.stubMetadata.regionId
                    : null;
            const originRegionId = originRegionRaw && typeof originRegionRaw === 'string'
                ? originRegionRaw.trim() || null
                : null;

            try {
                ensureExitConnection(destination, originLocation, {
                    description: entry?.reverseDescription || `Path back to ${originLocation.name || originLocation.id || 'origin'}`,
                    bidirectional: true,
                    destinationRegion: originRegionId,
                    isVehicle: isVehicleExit,
                    vehicleType
                });
            } catch (error) {
                throw new Error(`[${eventLabel}] Failed to ensure reverse exit from "${destination.name || exitName}": ${error.message}`);
            }
        }

        if (movePlayer) {
            try {
                await movePlayerToDestination(eventsInstance, destination, context, {
                    fallbackName: exitName,
                    label: moveLabel
                });
            } catch (error) {
                throw new Error(`[${eventLabel}] Failed to move player to "${exitName}": ${error.message}`);
            }
        }
    }
}

async function movePlayerToDestination(eventsInstance, destination, context = {}, {
    fallbackName = null,
    label = 'move_location'
} = {}) {
    const player = context.player || eventsInstance.currentPlayer;

    if (!player.isNPC) {
        Globals.processedMove = true;
    }

    const { Location, findLocationByNameLoose, createLocationFromEvent } = eventsInstance._deps || {};

    if (!player || typeof player.setLocation !== 'function' || !Location || typeof Location.get !== 'function') {
        return;
    }

    let destinationObject = null;
    let destinationName = null;

    if (destination && typeof destination === 'object') {
        destinationObject = destination;
        destinationName = typeof destination.name === 'string' ? destination.name.trim() : null;
        if (!destinationName && typeof destination.id === 'string') {
            destinationName = destination.id;
        }
    } else if (typeof destination === 'string') {
        destinationName = destination.trim();
    }

    if (!destinationName && typeof fallbackName === 'string') {
        destinationName = fallbackName.trim();
    }

    if (!destinationName) {
        throw new Error(`[${label}] Missing destination name.`);
    }

    if (!destinationObject) {
        try {
            destinationObject = Location.get(destinationName);
        } catch (_) {
            destinationObject = null;
        }

        if (!destinationObject && typeof Location.findByName === 'function') {
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
                throw new Error(`[${label}] Unable to resolve destination "${destinationName}" and origin location is unknown.`);
            }
            try {
                destinationObject = await createLocationFromEvent({
                    name: destinationName,
                    originLocation,
                    descriptionHint: `Path leading from ${originLocation.name || originLocation.id} toward ${destinationName}.`,
                    expandStub: false
                });
            } catch (error) {
                throw new Error(`[${label}] Failed to create destination "${destinationName}": ${error.message}`);
            }
        }
    }

    if (!destinationObject || !destinationObject.id) {
        throw new Error(`[${label}] Unable to resolve destination "${destinationName}".`);
    }

    const trackingName = destinationObject.name || destinationName || destinationObject.id;
    if (trackingName && eventsInstance.movedLocations.has(trackingName)) {
        return;
    }

    player.setLocation(destinationObject.id);
    context.location = destinationObject;
    if (trackingName) {
        eventsInstance.movedLocations.add(trackingName);
    }
    if (destinationName && destinationName !== trackingName) {
        eventsInstance.movedLocations.add(destinationName);
    }
    const trimmedFallback = typeof fallbackName === 'string' ? fallbackName.trim() : '';
    if (trimmedFallback && trimmedFallback !== trackingName && trimmedFallback !== destinationName) {
        eventsInstance.movedLocations.add(trimmedFallback);
    }
}

function extractInteger(raw) {
    if (typeof raw !== 'string') {
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
    return { description, duration };
}

class Events {
    static DEFAULT_STATUS_DURATION = DEFAULT_STATUS_DURATION;
    static MAJOR_STATUS_DURATION = MAJOR_STATUS_DURATION;
    static _deps = {};
    static _parsers = {};
    static _aggregators = {};
    static _handlers = {};
    static _baseTimeout = BASE_TIMEOUT_MS;

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
    static _followupEventTexts = [];

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

    static _enqueueFollowupEventCheck(text) {
        if (typeof text !== 'string') {
            return;
        }
        const trimmed = text.trim();
        if (!trimmed) {
            return;
        }
        if (!Array.isArray(this._followupEventTexts)) {
            this._followupEventTexts = [];
        }
        this._followupEventTexts.push(trimmed);
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
        const shouldSkip = itemName => (
            typeof itemName === 'string'
            && (this.animatedItems.has(itemName)
                || this.destroyedItems.has(itemName)
                || this.alteredItems.has(itemName))
        );

        const filterByItem = key => {
            if (!Array.isArray(parsedEntries[key])) {
                return;
            }
            if (key === 'consume_item') {
                parsedEntries[key] = parsedEntries[key].filter(entry => {
                    const name = entry?.item;
                    if (!name) {
                        return Boolean(entry);
                    }
                    return !this.alteredItems.has(name);
                });
            } else {
                parsedEntries[key] = parsedEntries[key].filter(entry => {
                    const name = entry?.item;
                    if (!name) {
                        return Boolean(entry);
                    }
                    return !shouldSkip(name);
                });
            }
        };

        filterByItem('transfer_item');
        filterByItem('harvest_gather');
        filterByItem('pick_up_item');
        filterByItem('drop_item');
        filterByItem('consume_item');

        if (Array.isArray(parsedEntries.item_appear)) {
            parsedEntries.item_appear = parsedEntries.item_appear.filter(itemName => !shouldSkip(itemName));
        }
    }

    static initialize(deps = {}) {
        if (!deps) {
            throw new Error('Events.initialize requires a dependency object.');
        }

        this._deps = { ...deps };
        this._baseTimeout = Number.isFinite(deps.baseTimeoutMilliseconds) && deps.baseTimeoutMilliseconds > 0
            ? deps.baseTimeoutMilliseconds
            : BASE_TIMEOUT_MS;

        this.DEFAULT_STATUS_DURATION = deps.defaultStatusDuration ?? DEFAULT_STATUS_DURATION;
        this.MAJOR_STATUS_DURATION = deps.majorStatusDuration ?? MAJOR_STATUS_DURATION;

        this._parsers = this._buildParsers();
        this._aggregators = this._buildAggregators();
        this._handlers = this._buildHandlers();
    }

    static async runEventChecks({ textToCheck, stream = null, allowEnvironmentalEffects = true, isNpcTurn = false, _depth = 0 } = {}) {
        if (isBlank(textToCheck)) {
            return null;
        }

        this._resetTrackingSets();
        const depth = Number.isFinite(_depth) ? _depth : 0;
        if (depth === 0) {
            this._followupEventTexts = [];
        }

        const promptEnv = this._deps.promptEnv;
        const parseXMLTemplate = this._deps.parseXMLTemplate;
        const prepareBasePromptContext = this._deps.prepareBasePromptContext;
        const Location = this._deps.Location;
        const findRegionByLocationId = this._deps.findRegionByLocationId;

        const PlayerLevel = Globals.currentPlayer?.level;

        if (typeof promptEnv?.render !== 'function') {
            throw new Error('promptEnv.render dependency is not configured.');
        }
        if (typeof parseXMLTemplate !== 'function') {
            throw new Error('parseXMLTemplate dependency is not configured.');
        }
        if (typeof prepareBasePromptContext !== 'function') {
            throw new Error('prepareBasePromptContext dependency is not configured.');
        }

        const config = this.config || {};
        const aiConfig = config?.ai;

        if (!aiConfig) {
            console.warn('AI configuration missing; skipping event analysis.');
            return null;
        }

        const currentPlayer = this.currentPlayer;
        let location = null;
        if (currentPlayer?.currentLocation && Location && typeof Location.get === 'function') {
            try {
                location = Location.get(currentPlayer.currentLocation) || null;
            } catch (_) {
                location = null;
            }
        }

        let region = null;
        if (location && typeof findRegionByLocationId === 'function') {
            try {
                region = findRegionByLocationId(location.id);
            } catch (_) {
                region = null;
            }
        }

        const baseContext = await prepareBasePromptContext({ locationOverride: location });

        const promptGroups = EVENT_PROMPT_ORDER;

        const groupResponses = await Promise.all(promptGroups.map(async (group, groupIndex) => {
            const questions = group.map(definition => {
                if (location?.name && typeof definition.prompt === 'string') {
                    return definition.prompt.replace(/%CURRENT_LOCATION%/g, location.name);
                }
                return definition.prompt;
            });

            const rendered = promptEnv.render('base-context.xml.njk', {
                ...baseContext,
                promptType: 'event-checks',
                textToCheck,
                eventQuestions: questions
            });

            const parsedTemplate = parseXMLTemplate(rendered);
            if (!parsedTemplate?.systemPrompt || !parsedTemplate?.generationPrompt) {
                throw new Error(`Event check template did not produce prompts for group ${groupIndex + 1}.`);
            }

            const messages = [
                { role: 'system', content: parsedTemplate.systemPrompt },
                { role: 'user', content: parsedTemplate.generationPrompt }
            ];

            const requestOptions = {
                messages,
                metadataLabel: 'event_checks',
                metadata: { eventGroup: groupIndex },
                timeoutMs: this._baseTimeout,
                temperature: 0,
                validateXML: false,
                dumpReasoningToConsole: true,
            };

            const responseText = await LLMClient.chatCompletion(requestOptions);

            this.logEventCheck({
                systemPrompt: parsedTemplate.systemPrompt,
                generationPrompt: parsedTemplate.generationPrompt,
                responseText,
                label: `group_${groupIndex + 1}`
            });

            return {
                responseText,
                groupIndex
            };
        }));

        const totalQuestions = EVENT_PROMPT_ORDER_FLAT.length;
        const combinedLines = [];
        let globalIndex = 1;

        groupResponses.forEach(({ responseText, groupIndex }) => {
            const numbered = this._extractNumberedResponses(responseText);
            const group = EVENT_PROMPT_ORDER[groupIndex];
            group.forEach((definition, localIndex) => {
                const answer = numbered.get(localIndex + 1) || 'N/A';
                combinedLines.push(`${globalIndex}. ${answer}`);
                globalIndex += 1;
            });
        });

        if (combinedLines.length < totalQuestions) {
            for (let i = combinedLines.length; i < totalQuestions; i += 1) {
                combinedLines.push(`${i + 1}. N/A`);
            }
        }

        const combinedResponseText = combinedLines.join('\n');

        if (isBlank(combinedResponseText)) {
            return null;
        }

        const cleaned = this.cleanEventResponseText(combinedResponseText);
        const html = this.escapeHtml(cleaned).replace(/\n/g, '<br>');

        const structured = this._parseEventPromptResponse(cleaned);
        if (!allowEnvironmentalEffects) {
            if (Array.isArray(structured.parsed.environmental_status_damage)) {
                structured.parsed.environmental_status_damage = [];
            }
            if (Object.prototype.hasOwnProperty.call(structured.rawEntries, 'environmental_status_damage')) {
                structured.rawEntries.environmental_status_damage = '';
            }
        }

        let experienceAwards = [];
        let currencyChanges = [];
        let environmentalDamageEvents = [];
        let needBarChanges = [];
        let questsAwarded = [];
        let questRewards = [];
        let questObjectivesCompleted = [];

        try {
            const outcomeContext = await this.applyEventOutcomes(structured, {
                player: currentPlayer,
                location,
                region,
                experienceAwards: [],
                currencyChanges: [],
                environmentalDamageEvents: [],
                needBarChanges: [],
                allowEnvironmentalEffects: Boolean(allowEnvironmentalEffects),
                isNpcTurn: Boolean(isNpcTurn),
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
            if (Array.isArray(outcomeContext?.questsAwarded) && outcomeContext.questsAwarded.length) {
                questsAwarded = outcomeContext.questsAwarded;
            }
            if (Array.isArray(outcomeContext?.questCompletionRewards) && outcomeContext.questCompletionRewards.length) {
                questRewards = outcomeContext.questCompletionRewards;
            }
            if (Array.isArray(outcomeContext?.completedQuestObjectives) && outcomeContext.completedQuestObjectives.length) {
                questObjectivesCompleted = outcomeContext.completedQuestObjectives;
            }
        } catch (error) {
            console.warn('Failed to apply event outcomes:', error.message);
        }

        if (questRewards.length) {
            if (structured && typeof structured === 'object') {
                if (!structured.parsed || typeof structured.parsed !== 'object') {
                    structured.parsed = {};
                }
                const normalizedRewards = questRewards.map(reward => ({
                    questId: reward.questId || null,
                    questName: reward.questName || null,
                    items: Array.isArray(reward.items) ? reward.items.slice() : [],
                    xp: Number.isFinite(reward.xp) ? reward.xp : 0,
                    currency: Number.isFinite(reward.currency) ? reward.currency : 0
                }));
                if (Array.isArray(structured.parsed.quest_rewards)) {
                    structured.parsed.quest_rewards.push(...normalizedRewards);
                } else {
                    structured.parsed.quest_rewards = normalizedRewards;
                }

                if (structured.rawEntries && typeof structured.rawEntries === 'object') {
                    const rewardMessages = questRewards
                        .map(entry => (typeof entry.message === 'string' ? entry.message.trim() : ''))
                        .filter(Boolean);
                    if (rewardMessages.length) {
                        structured.rawEntries.quest_rewards = rewardMessages.join(' | ');
                    }
                }
            }
        }

        if (questObjectivesCompleted.length) {
            if (structured && typeof structured === 'object') {
                if (!structured.parsed || typeof structured.parsed !== 'object') {
                    structured.parsed = {};
                }
                const normalizedObjectives = questObjectivesCompleted.map(entry => ({
                    questId: entry.questId || null,
                    questName: entry.questName || null,
                    objectiveIndex: Number.isFinite(entry.objectiveIndex) ? entry.objectiveIndex : null,
                    objectiveNumber: Number.isFinite(entry.objectiveNumber) ? entry.objectiveNumber : null,
                    objectiveDescription: entry.objectiveDescription || null,
                    questCompleted: Boolean(entry.questCompleted),
                    questJustCompleted: Boolean(entry.questJustCompleted)
                }));
                if (Array.isArray(structured.parsed.completed_quest_objective)) {
                    structured.parsed.completed_quest_objective.push(...normalizedObjectives);
                } else {
                    structured.parsed.completed_quest_objective = normalizedObjectives;
                }

                if (!structured.rawEntries || typeof structured.rawEntries !== 'object') {
                    structured.rawEntries = {};
                }
                const rawSegments = normalizedObjectives
                    .map(entry => {
                        const questLabel = entry.questName || entry.questId || 'Quest';
                        const description = entry.objectiveDescription
                            || (entry.objectiveNumber ? `Objective ${entry.objectiveNumber}` : null)
                            || (entry.objectiveIndex !== null ? `Objective ${entry.objectiveIndex + 1}` : null);
                        return `${questLabel} -> ${description || 'Objective completed'}`;
                    })
                    .filter(Boolean);
                if (rawSegments.length) {
                    structured.rawEntries.completed_quest_objective = rawSegments.join(' | ');
                }
            }
        }

        const addedCharacters = Array.from(this.newCharacters);
        const departedCharacters = Array.from(this.departedCharacters);
        const movedLocationNames = Array.from(this.movedLocations);
        const addedSet = new Set(addedCharacters);
        const departedSet = new Set(departedCharacters);
        const movedSet = new Set(movedLocationNames);

        const npcUpdates = {
            added: addedCharacters,
            departed: departedCharacters,
            movedLocations: movedLocationNames
        };

        const locationRefreshRequested = Boolean(
            (addedCharacters && addedCharacters.length)
            || (departedCharacters && departedCharacters.length)
            || (movedLocationNames && movedLocationNames.length)
        );

        const followupResults = [];
        if (depth === 0 && Array.isArray(this._followupEventTexts) && this._followupEventTexts.length) {
            const seen = new Set();
            while (this._followupEventTexts.length) {
                const pendingTexts = this._followupEventTexts.splice(0, this._followupEventTexts.length);
                for (const followupText of pendingTexts) {
                    if (typeof followupText !== 'string') {
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
                            _depth: depth + 1
                        });
                        if (!followup) {
                            continue;
                        }

                        followupResults.push({
                            raw: followup.raw,
                            html: followup.html,
                            structured: followup.structured
                        });

                        if (Array.isArray(followup.experienceAwards) && followup.experienceAwards.length) {
                            experienceAwards.push(...followup.experienceAwards);
                        }
                        if (Array.isArray(followup.currencyChanges) && followup.currencyChanges.length) {
                            currencyChanges.push(...followup.currencyChanges);
                        }
                        if (Array.isArray(followup.environmentalDamageEvents) && followup.environmentalDamageEvents.length) {
                            environmentalDamageEvents.push(...followup.environmentalDamageEvents);
                        }
                        if (Array.isArray(followup.needBarChanges) && followup.needBarChanges.length) {
                            needBarChanges.push(...followup.needBarChanges);
                        }
                        if (Array.isArray(followup.questsAwarded) && followup.questsAwarded.length) {
                            questsAwarded.push(...followup.questsAwarded);
                        }
                        if (Array.isArray(followup.questRewards) && followup.questRewards.length) {
                            questRewards.push(...followup.questRewards);
                        }
                        if (Array.isArray(followup.questObjectivesCompleted) && followup.questObjectivesCompleted.length) {
                            questObjectivesCompleted.push(...followup.questObjectivesCompleted);
                        }
                        if (followup.locationRefreshRequested) {
                            locationRefreshRequested = true;
                        }
                        if (followup.npcUpdates) {
                            if (Array.isArray(followup.npcUpdates.added)) {
                                followup.npcUpdates.added.forEach(name => {
                                    if (name && !addedSet.has(name)) {
                                        addedSet.add(name);
                                        addedCharacters.push(name);
                                    }
                                });
                            }
                            if (Array.isArray(followup.npcUpdates.departed)) {
                                followup.npcUpdates.departed.forEach(name => {
                                    if (name && !departedSet.has(name)) {
                                        departedSet.add(name);
                                        departedCharacters.push(name);
                                    }
                                });
                            }
                            if (Array.isArray(followup.npcUpdates.movedLocations)) {
                                followup.npcUpdates.movedLocations.forEach(name => {
                                    if (name && !movedSet.has(name)) {
                                        movedSet.add(name);
                                        movedLocationNames.push(name);
                                    }
                                });
                            }
                        }
                    } catch (error) {
                        console.warn('Failed to process follow-up event text:', error.message);
                    }
                }
            }
        }

        console.debug('[QuestDebug] runEventChecks returning quests:', questsAwarded);

        return {
            raw: cleaned,
            html,
            structured,
            experienceAwards,
            currencyChanges,
            environmentalDamageEvents,
            needBarChanges,
            npcUpdates,
            locationRefreshRequested,
            questObjectivesCompleted,
            questRewards,
            questsAwarded,
            followupResults
        };
    }

    static _parseEventPromptResponse(responseText) {
        const numbered = this._extractNumberedResponses(responseText);
        const rawGroups = new Map();
        const parsedGroups = new Map();

        EVENT_PROMPT_ORDER_FLAT.forEach((definition, position) => {
            const raw = numbered.get(position + 1) || '';
            if (!rawGroups.has(definition.key)) {
                rawGroups.set(definition.key, []);
                parsedGroups.set(definition.key, []);
            }

            rawGroups.get(definition.key).push(raw);
            const parser = this._parsers[definition.key];
            const parsed = parser ? parser(raw) : raw;
            const value = typeof definition.postProcess === 'function'
                ? ensureArray(parsed).map(entry => definition.postProcess(entry))
                : parsed;
            parsedGroups.get(definition.key).push(value);
        });

        const rawEntries = {};
        const parsedEntries = {};

        for (const [key, segments] of rawGroups.entries()) {
            const compactRaw = segments
                .map(segment => (typeof segment === 'string' ? segment.trim() : ''))
                .filter(segment => segment.length > 0 && !NO_EVENT_TOKENS.has(segment.toLowerCase()))
                .join(' | ');
            rawEntries[key] = compactRaw;

            const aggregator = this._aggregators[key] || (items => flattenAndFilter(items));
            const combined = aggregator(parsedGroups.get(key) || []);
            parsedEntries[key] = combined;
        }

        const itemAndSceneryNames = this.extractItemAndSceneryNames(rawEntries);
        if (itemAndSceneryNames instanceof SanitizedStringSet) {
            const filterOutItems = (entries, pickName) => {
                if (!Array.isArray(entries)) {
                    return entries;
                }
                return entries.filter(entry => {
                    const candidate = pickName(entry);
                    return !itemAndSceneryNames.has(candidate);
                });
            };

            parsedEntries.new_exit_discovered = filterOutItems(parsedEntries.new_exit_discovered, entry => entry?.name);
            parsedEntries.move_new_location = filterOutItems(parsedEntries.move_new_location, entry => entry?.name);
            parsedEntries.move_location = filterOutItems(parsedEntries.move_location, entry => entry);
        }

        if (parsedEntries.new_exit_discovered.length === 0 && parsedEntries.move_location.length === 0) {
            const firstAppearance = parsedEntries.npc_first_appearance || [];
            if (firstAppearance.length) {
                const arrivals = firstAppearance
                    .map(name => normalizeString(name))
                    .filter(name => name.length > 0)
                    .map(name => ({ name, action: 'arrived', destination: null, firstAppearance: true }));

                if (!Array.isArray(parsedEntries.npc_arrival_departure)) {
                    parsedEntries.npc_arrival_departure = [];
                }

                // Check if the NPC already exists and is in this location (see Player.js and Location.js)
                // so we can avoid redundant arrivals
                const existingNames = Globals.location.getNPCNames();
                const uniqueArrivals = arrivals.filter(entry => !existingNames.includes(entry.name));

                parsedEntries.npc_arrival_departure.push(...uniqueArrivals);
            }
        }

        this._trackItemsFromParsing(parsedEntries);
        this._pruneExcludedItemEntries(parsedEntries);

        return { rawEntries, parsed: parsedEntries };
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
            const combined = buffer.join(' ').trim();
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

        const config = this.config || {};
        const omitNpcGeneration = Boolean(config?.omit_npc_generation);
        const omitItemGeneration = Boolean(config?.omit_item_generation);

        const suppressedNpc = omitNpcGeneration ? new Set(['npc_arrival_departure', 'alter_npc']) : null;
        const suppressedItems = omitItemGeneration ? new Set(['item_appear', 'scenery_appear', 'harvestable_resource_appear', 'alter_item']) : null;

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
        const executionOrder = EVENT_PROMPT_ORDER_FLAT.map(def => def.key);

        const parsedMap = parsedEvents.parsed;
        const seen = new Set();
        const orderedKeys = [];

        executionOrder.forEach(key => {
            if (Object.prototype.hasOwnProperty.call(parsedMap, key)) {
                orderedKeys.push(key);
                seen.add(key);
            }
        });

        Object.keys(parsedMap).forEach(key => {
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
            if (suppressedNpc?.has(key) || suppressedItems?.has(key)) {
                continue;
            }
            const handler = this._handlers[key];
            if (typeof handler !== 'function') {
                continue;
            }
            const entries = parsedMap[key];
            try {
                await handler.call(this, entries, context, parsedEvents.rawEntries[key]);
            } catch (error) {
                console.warn(`Failed to apply ${key} events:`, error.message);
                // log error trace
                console.debug(error);
            }
        }

        return context;
    }

    static _buildParsers() {
        return {
            new_exit_discovered: raw => splitPipeList(raw).map(entry => {
                const [name, kind, vehicle, description] = splitArrowParts(entry, 4);
                const normalizedKind = (kind || '').toLowerCase();
                if (!name || !description || (normalizedKind !== 'location' && normalizedKind !== 'region')) {
                    return null;
                }
                const vehicleType = normalizeString(vehicle);
                return {
                    name: name.trim(),
                    kind: normalizedKind,
                    vehicleType: vehicleType && vehicleType.toLowerCase() !== 'none' ? vehicleType : null,
                    description: description.trim()
                };
            }).filter(Boolean),
            move_new_location: raw => {
                return splitPipeList(raw).map(entry => {
                    if (typeof entry !== 'string') {
                        return null;
                    }

                    const rawParts = entry.split('->').map(part => part.trim()).filter(Boolean);
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
                    let normalizedKind = (kind || '').toLowerCase();



                    if (normalizedKind === 'sublocation') normalizedKind = 'location';
                    if (!name || !descriptionParts.length || (normalizedKind !== 'location' && normalizedKind !== 'region')) {
                        return null;
                    }

                    if (normalizedKind === 'location') {
                        Events.movedLocations.add(name);
                    }

                    const vehicleType = normalizeString(vehicle);
                    return {
                        origin: origin ? origin.trim() : null,
                        name: name.trim(),
                        kind: normalizedKind,
                        vehicleType: vehicleType && vehicleType.toLowerCase() !== 'none' ? vehicleType : null,
                        description: descriptionParts.join(' -> ').trim()
                    };
                }).filter(Boolean);
            },
            alter_location: raw => {
                if (Globals.processedMove) {
                    return [];
                }

                return splitPipeList(raw).map(entry => {
                    const parts = splitArrowParts(entry, 3);
                    if (!parts.length) {
                        return null;
                    }

                    const currentName = parts[0] ? parts[0].trim() : '';
                    let newName = parts.length > 1 ? parts[1].trim() : '';
                    let description = parts.length > 2 ? parts[2].trim() : '';

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
                        description: description ? description.trim() : null
                    };
                }).filter(entry => entry && entry.description);
            },
            currency: raw => {
                const amount = extractInteger(raw);
                return Number.isFinite(amount) ? amount : null;
            },
            time_passed: raw => {
                const value = parsePositiveDecimal(raw);
                return value !== null ? value : null;
            },
            in_combat: raw => {
                if (typeof raw !== 'string') {
                    return null;
                }
                const normalized = raw.trim().toLowerCase();

                return (normalized === 'yes' || normalized === 'true');
            },
            item_to_npc: raw => splitPipeList(raw).map(entry => {
                const [item, npc, description] = splitArrowParts(entry, 3);
                if (!npc) {
                    return null;
                }
                return {
                    item: item ? item.trim() : null,
                    npc: npc.trim(),
                    description: description ? description.trim() : null
                };
            }).filter(Boolean),
            consume_item: raw => splitPipeList(raw).map(entry => {
                if (typeof entry !== 'string') {
                    return null;
                }
                const [item, reason] = splitArrowParts(entry.trim(), 2);
                if (!item) {
                    return null;
                }
                const record = { item: item.trim() };
                if (reason) {
                    record.reason = reason.trim();
                }
                return record;
            }).filter(Boolean),
            alter_item: raw => splitPipeList(raw).map(entry => {
                const parts = splitArrowParts(entry, 3);
                if (!parts.length) {
                    return null;
                }

                const originalName = parts[0] ? parts[0].trim() : '';
                let newNameInput = parts.length > 1 ? parts[1].trim() : '';
                const description = parts.length > 2 ? parts[2].trim() : '';

                if (newNameInput && newNameInput.toLowerCase() === 'n/a') {
                    return null;
                }

                if (!originalName && !newNameInput) {
                    return null;
                }

                const normalized = {
                    originalName: originalName || null,
                    newName: newNameInput || null,
                    changeDescription: description || null
                };

                if (!normalized.newName && normalized.originalName) {
                    normalized.newName = normalized.originalName;
                }

                normalized.from = normalized.originalName;
                normalized.to = normalized.newName;
                normalized.description = normalized.changeDescription;

                return normalized;
            }).filter(Boolean),
            transfer_item: raw => splitPipeList(raw).map(entry => {
                const [giver, item, receiver] = splitArrowParts(entry, 3);
                if (!item) {
                    return null;
                }
                return {
                    giver: giver ? giver.trim() : null,
                    item: item.trim(),
                    receiver: receiver ? receiver.trim() : null
                };
            }).filter(Boolean),
            harvest_gather: raw => splitPipeList(raw).map(entry => {
                const [name, item] = splitArrowParts(entry, 2);
                if (!name || !item) {
                    return null;
                }
                return { harvester: name.trim(), item: item.trim() };
            }).filter(Boolean),
            pick_up_item: raw => splitPipeList(raw).map(entry => {
                const [name, item] = splitArrowParts(entry, 2);
                if (!name || !item) {
                    return null;
                }
                return { name: name.trim(), item: item.trim() };
            }).filter(Boolean),
            drop_item: raw => splitPipeList(raw).map(entry => {
                const [name, item] = splitArrowParts(entry, 2);
                if (!name || !item) {
                    return null;
                }
                return { name: name.trim(), item: item.trim() };
            }).filter(Boolean),
            item_appear: raw => splitPipeList(raw).map(entry => {
                const [name] = splitArrowParts(entry, 2);
                if (!name || Events.alteredItems.has(name)) {
                    return null;
                }
                return name ? name.trim() : null;
            }).filter(Boolean),
            scenery_appear: raw => splitPipeList(raw).map(entry => {
                const [name] = splitArrowParts(entry, 2);

                // Remove any items that are in newItems
                if (!name || Events.newItems.has(name) || Events.alteredItems.has(name)) {
                    return null;
                }
                return name ? name.trim() : null;
            }).filter(Boolean),
            harvestable_resource_appear: raw => splitPipeList(raw).map(entry => {
                const [name] = splitArrowParts(entry, 2);
                return name ? name.trim() : null;
            }).filter(Boolean),
            alter_npc: raw => splitPipeList(raw).map(entry => {
                const [name, type, description] = splitArrowParts(entry, 3);
                if (!name) {
                    return null;
                }

                // remove all non-letter characters from type for comparison
                const normalizedType = (type || '').toLowerCase().replace(/[^a-z]/g, '');

                if (normalizedType.toLowerCase() !== 'physicaltransformation') {
                    return null;
                }

                // Remove any where the name is "you", "your character", "player", "the player", or the player's name
                const lowerName = name.trim().toLowerCase();
                const playerName = (Globals.currentPlayer?.name || '').toLowerCase();
                if (['you', 'your character', 'player', 'the player', playerName].includes(lowerName)) {
                    return null;
                }

                return { name: name.trim(), description: description ? description.trim() : null };
            }).filter(Boolean),
            status_effect_change: raw => splitPipeList(raw).map(entry => {
                const [entity, detail, action] = splitArrowParts(entry, 3);
                if (!entity || !detail || !action) {
                    return null;
                }
                return {
                    entity: entity.trim(),
                    detail: detail.trim(),
                    action: action.trim().toLowerCase()
                };
            }).filter(Boolean),
            npc_arrival_departure: raw => splitPipeList(raw).map(entry => {
                const rawParts = entry
                    .split('->')
                    .map(part => part.trim())
                    .filter(Boolean);

                if (!rawParts.length) {
                    return null;
                }

                let primary = rawParts.shift();
                const match = primary.match(/^(.*)\s+(arrived|left)$/i);

                let name = null;
                let action = null;

                if (match) {
                    name = match[1].trim();
                    action = match[2].trim().toLowerCase();
                } else {
                    name = primary.trim();
                    if (rawParts.length) {
                        action = rawParts.shift().trim().toLowerCase();
                    }
                }

                if (!name || !action) {
                    return null;
                }

                let destinationRegion = null;
                let destinationLocation = null;

                if (rawParts.length === 1) {
                    destinationLocation = rawParts[0].trim();
                } else if (rawParts.length >= 2) {
                    destinationRegion = rawParts[0].trim() || null;
                    destinationLocation = rawParts[1].trim() || null;
                }

                const destination = destinationLocation || destinationRegion || null;

                return {
                    name,
                    action,
                    destination,
                    destinationRegion,
                    destinationLocation
                };
            }).filter(Boolean),
            npc_first_appearance: raw => splitPipeList(raw)
                .map(stripAfterFirstArrow)
                .map(entry => entry.trim())
                .filter(Boolean),
            party_change: raw => splitPipeList(raw).map(entry => {
                const [name, action] = splitArrowParts(entry, 2);
                if (!name || !action) {
                    return null;
                }
                return { name: name.trim(), action: action.trim().toLowerCase() };
            }).filter(Boolean),
            environmental_status_damage: raw => splitPipeList(raw).map(entry => {
                const parts = splitArrowParts(entry, 4);
                if (!parts.length) {
                    return null;
                }
                if (parts.length === 4) {
                    const [name, effect, severity, reason] = parts;
                    return {
                        name: name.trim(),
                        effect: (effect || 'damage').trim().toLowerCase(),
                        severity: (severity || 'medium').trim().toLowerCase(),
                        reason: reason ? reason.trim() : ''
                    };
                }
                const [name, severity, reason] = parts;
                if (!name) {
                    return null;
                }
                return {
                    name: name.trim(),
                    effect: 'damage',
                    severity: (severity || 'medium').trim().toLowerCase(),
                    reason: reason ? reason.trim() : ''
                };
            }).filter(Boolean),
            heal_recover: raw => splitPipeList(raw).map(entry => {
                const parts = splitArrowParts(entry, 3);
                if (!parts.length) {
                    return null;
                }
                if (parts.length >= 3) {
                    return {
                        character: parts[0].trim(),
                        magnitude: parts[1].trim().toLowerCase(),
                        reason: parts[2] ? parts[2].trim() : null
                    };
                }
                const [healer, recipient, effect] = parts;
                return {
                    healer: healer ? healer.trim() : null,
                    recipient: recipient ? recipient.trim() : null,
                    effect: effect ? effect.trim() : null
                };
            }).filter(Boolean),
            needbar_change: raw => splitPipeList(raw).map(entry => {
                const [name, bar, direction, magnitude, reason] = splitArrowParts(entry, 5);
                if (!name || !bar || !direction) {
                    return null;
                }
                return {
                    character: name.trim(),
                    bar: bar.trim(),
                    direction: direction.trim().toLowerCase(),
                    magnitude: (magnitude || 'small').trim().toLowerCase(),
                    reason: reason ? reason.trim() : null
                };
            }).filter(Boolean),
            attack_damage: raw => splitPipeList(raw).map(entry => {
                const [attacker, target] = splitArrowParts(entry, 2);
                if (!attacker || !target) {
                    return null;
                }
                return { attacker: attacker.trim(), target: target.trim() };
            }).filter(Boolean),
            death_incapacitation: raw => splitPipeList(raw).map(entry => {
                const [name, status] = splitArrowParts(entry, 2);
                if (!name) {
                    return null;
                }
                return {
                    name: name.trim(),
                    status: status ? status.trim().toLowerCase() : 'dead'
                };
            }).filter(Boolean),
            defeated_enemy: raw => splitPipeList(raw).map(entry => entry.trim()).filter(Boolean),
            experience_check: raw => splitPipeList(raw).map(entry => {
                const [amount, reason] = splitArrowParts(entry, 2);
                const value = extractInteger(amount);
                if (!Number.isFinite(value)) {
                    return null;
                }
                return { amount: value, reason: reason ? reason.trim() : '' };
            }).filter(Boolean),
            move_location: raw => {
                if (Globals.processedMove) {
                    return [];
                }
                return splitPipeList(raw).map(entry => {
                    if (typeof entry !== 'string') {
                        return null;
                    }
                    const parts = entry.split('->').map(segment => segment.trim());
                    if (parts.length === 5) {
                        parts.shift();
                        return parts.join(' -> ').trim();
                    }
                    return entry.trim();
                }).filter(Boolean);
            },
            received_quest: raw => {
                if (!Globals.config.quests.enabled) {
                    return [];
                }
                if (typeof raw !== 'string') {
                    return [];
                }
                const normalized = raw.trim();
                if (!normalized) {
                    return [];
                }
                if (/^n\/?a$/i.test(normalized) || normalized.toLowerCase() === 'none') {
                    return [];
                }

                return splitPipeList(normalized).map(entry => {
                    if (typeof entry !== 'string') {
                        return null;
                    }
                    const parts = splitArrowParts(entry, 2).map(part => part && part.trim()).filter(Boolean);
                    if (!parts.length) {
                        return null;
                    }

                    let giver = parts[0] || '';
                    let summary = parts.length > 1 ? parts.slice(1).join(' -> ') : '';

                    if (!summary && giver) {
                        summary = giver;
                        giver = '';
                    }

                    if (!summary) {
                        return null;
                    }

                    return {
                        giver: giver || '',
                        summary
                    };
                }).filter(Boolean);
            },
            completed_quest_objective: raw => {
                if (typeof raw !== 'string') {
                    return [];
                }
                return splitPipeList(raw).map(entry => {
                    if (typeof entry !== 'string') {
                        return null;
                    }
                    const [questName, objectiveIndexRaw] = splitArrowParts(entry, 2);
                    if (!questName || !objectiveIndexRaw) {
                        return null;
                    }
                    const indexValue = extractInteger(objectiveIndexRaw);
                    if (!Number.isFinite(indexValue)) {
                        return null;
                    }
                    return {
                        quest: questName.trim(),
                        objectiveIndex: indexValue
                    };
                }).filter(Boolean);
            }
        };
    }

    static extractItemAndSceneryNames(rawEvents = {}) {
        const results = new SanitizedStringSet();

        if (!rawEvents || typeof rawEvents !== 'object') {
            return results;
        }

        const parsers = this._buildParsers();
        const keys = [
            'harvest_gather',
            'pick_up_item',
            'drop_item',
            'item_appear',
            'scenery_appear',
            'harvestable_resource_appear'
        ];

        const addName = (name) => {
            results.add(name);
        };

        const normalizeInput = (parserFn, value) => {
            if (value === null || value === undefined) {
                return [];
            }
            if (Array.isArray(value)) {
                return value.flatMap(item => normalizeInput(parserFn, item));
            }
            if (typeof value === 'string') {
                try {
                    const parsed = parserFn(value);
                    return Array.isArray(parsed) ? parsed : [];
                } catch (error) {
                    console.debug('Failed to parse event entries', { error: error?.message || error, value });
                    return [];
                }
            }
            if (typeof value === 'object') {
                return [value];
            }
            return [];
        };

        for (const key of keys) {
            const parserFn = typeof parsers[key] === 'function' ? parsers[key] : null;
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
                case 'harvest_gather':
                case 'pick_up_item':
                case 'drop_item':
                    parsedEntries.forEach(entry => {
                        if (entry && typeof entry === 'object') {
                            addName(entry.item);
                        }
                    });
                    break;
                case 'item_appear':
                case 'scenery_appear':
                case 'harvestable_resource_appear':
                    parsedEntries.forEach(addName);
                    break;
                default:
                    break;
            }
        }

        return results;
    }

    static _buildAggregators() {
        return {
            currency: list => {
                const numbers = flattenAndFilter(list).map(Number).filter(Number.isFinite);
                if (!numbers.length) {
                    return 0;
                }
                return numbers.reduce((total, value) => total + value, 0);
            },
            consume_item: list => {
                const entries = flattenAndFilter(list);
                const normalized = [];

                const copyKnownFields = (source, target) => {
                    for (const [key, value] of Object.entries(source)) {
                        if (value === null || value === undefined) {
                            continue;
                        }
                        if (typeof value === 'string') {
                            const trimmed = value.trim();
                            if (trimmed) {
                                target[key] = trimmed;
                            }
                        } else if (typeof value === 'number') {
                            target[key] = value;
                        }
                    }
                };

                for (const entry of entries) {
                    if (!entry) {
                        continue;
                    }
                    if (typeof entry === 'string') {
                        const itemName = entry.trim();
                        if (itemName) {
                            normalized.push({ item: itemName });
                        }
                        continue;
                    }
                    if (typeof entry === 'object') {
                        const normalizedEntry = {};
                        copyKnownFields(entry, normalizedEntry);

                        if (!normalizedEntry.item && typeof entry.name === 'string') {
                            const nameTrimmed = entry.name.trim();
                            if (nameTrimmed) {
                                normalizedEntry.item = nameTrimmed;
                            }
                        }

                        if (!normalizedEntry.item && typeof entry.item === 'string') {
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
            }
        };
    }

    static _buildHandlers() {
        return {
            new_exit_discovered: async function (entries = [], context = {}) {
                await applyExitDiscovery(this, entries, context, {
                    movePlayer: false,
                    eventLabel: 'new_exit_discovered',
                    moveLabel: 'move_location'
                });
            },
            move_new_location: async function (entries = [], context = {}) {
                //console.log('Processing move_new_location events:', entries);
                const stream = context?.stream || null;
                await applyExitDiscovery(this, entries, context, {
                    movePlayer: true,
                    eventLabel: 'move_new_location',
                    moveLabel: 'move_new_location'
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
                                type: 'move_new_location',
                                destination: entry.name,
                                description: entry.description || '',
                                kind: entry.kind || 'location',
                                vehicleType: entry.vehicleType || null,
                                timestamp: Date.now()
                            };

                            // Add the current location info if available
                            if (context.location) {
                                moveEventData.newLocation = {
                                    id: context.location.id,
                                    name: context.location.name,
                                    description: context.location.description
                                };
                            }

                            //console.log('Move event data to record:', moveEventData);
                            context.moveEvents.push(moveEventData);
                            if (stream && typeof stream.status === 'function') {
                                stream.status('spinner:start', { message: `Moving to ${entry.name}...` });
                                console.log(`Spinner start status emitted for moving to ${entry.name}.`);
                            }
                        }
                    }
                }
            },
            alter_location: async function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }

                const currentLocationName = Globals.location.name;
                const validEntries = entries.filter(entry => entry?.currentName === currentLocationName);
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
                    generatedImages
                } = this._deps;

                const warnSkippedAlteration = (entry, reason) => {
                    console.warn(`[alter_location] ${reason}`);
                    if (entry) {
                        console.warn('[alter_location] entry:', entry);
                    }
                    console.trace();
                };

                if (!context.location) {
                    validEntries.forEach(entry => warnSkippedAlteration(entry, 'No context.location available.'));
                    return;
                }

                if (typeof promptEnv?.render !== 'function'
                    || typeof parseXMLTemplate !== 'function'
                    || typeof prepareBasePromptContext !== 'function') {
                    validEntries.forEach(entry => warnSkippedAlteration(entry, 'Missing required prompt dependencies.'));
                    return;
                }

                const config = this.config || {};
                if (!config?.ai) {
                    validEntries.forEach(entry => warnSkippedAlteration(entry, 'AI configuration incomplete.'));
                    return;
                }

                let location = context.location;
                if (!location && context.player?.currentLocation && Location && typeof Location.get === 'function') {
                    try {
                        location = Location.get(context.player.currentLocation);
                    } catch (_) {
                        location = null;
                    }
                }
                if (!location && this.currentPlayer?.currentLocation && Location && typeof Location.get === 'function') {
                    try {
                        location = Location.get(this.currentPlayer.currentLocation);
                    } catch (_) {
                        location = null;
                    }
                }

                if (!location) {
                    validEntries.forEach(entry => warnSkippedAlteration(entry, 'Unable to resolve current location object.'));
                    return;
                }

                const locationDetails = typeof location.getDetails === 'function' ? location.getDetails() : null;
                const baseSnapshot = {
                    name: locationDetails?.name || location.name || 'Unknown Location',
                    description: locationDetails?.description || location.description || 'No description available.',
                    baseLevel: Number.isFinite(locationDetails?.baseLevel) ? locationDetails.baseLevel : location.baseLevel,
                    relativeLevel: locationDetails?.generationHints?.relativeLevel ?? null,
                    numNpcs: locationDetails?.generationHints?.numNpcs ?? null,
                    numItems: locationDetails?.generationHints?.numItems ?? null,
                    numScenery: locationDetails?.generationHints?.numScenery ?? null,
                    numHostiles: locationDetails?.generationHints?.numHostiles ?? null,
                    statusEffects: typeof location.getStatusEffects === 'function' ? location.getStatusEffects() : []
                };

                const alteredSummaries = [];

                for (const entry of validEntries) {
                    if (!entry) {
                        continue;
                    }

                    const changeDescription = typeof entry.description === 'string'
                        ? entry.description.trim()
                        : '';
                    if (!changeDescription) {
                        entry.description = '';
                        entry.changeDescription = '';
                        continue;
                    }

                    entry.description = changeDescription;
                    entry.changeDescription = changeDescription;
                    if (!entry.name) {
                        entry.name = entry.newName || entry.currentName || location.name || baseSnapshot.name;
                    }

                    try {
                        const baseContext = await prepareBasePromptContext({ locationOverride: location });
                        const oldName = entry.currentName || location.name || baseSnapshot.name;
                        const desiredName = entry.newName || location.name || baseSnapshot.name;

                        const locationSeed = {
                            name: desiredName,
                            description: location.description,
                            baseLevel: location.baseLevel,
                            oldName
                        };

                        const promptPayload = {
                            ...baseContext,
                            promptType: 'location-alter',
                            changeDescription,
                            alteredLocation: baseSnapshot,
                            locationSeed
                        };

                        let renderedTemplate;
                        try {
                            renderedTemplate = promptEnv.render('base-context.xml.njk', promptPayload);
                        } catch (renderError) {
                            console.warn('Failed to render location alteration prompt:', renderError.message);
                            warnSkippedAlteration(entry, 'Template rendering failed.');
                            continue;
                        }

                        let parsedTemplate;
                        try {
                            parsedTemplate = parseXMLTemplate(renderedTemplate);
                        } catch (templateError) {
                            console.warn('Failed to parse location alteration template:', templateError.message);
                            warnSkippedAlteration(entry, 'Template parsing failed.');
                            continue;
                        }

                        if (!parsedTemplate?.systemPrompt || !parsedTemplate?.generationPrompt) {
                            console.warn('Alter location template missing prompts.');
                            warnSkippedAlteration(entry, 'Template missing prompts.');
                            continue;
                        }

                        const messages = [
                            { role: 'system', content: parsedTemplate.systemPrompt },
                            { role: 'user', content: parsedTemplate.generationPrompt }
                        ];

                        const requestStart = Date.now();
                        const requestOptions = {
                            messages,
                            metadataLabel: 'alter_location',
                            timeoutMs: this._baseTimeout
                        };

                        if (typeof parsedTemplate.temperature === 'number') {
                            requestOptions.temperature = parsedTemplate.temperature;
                        } else if (Number.isInteger(config.ai.temperature)) {
                            requestOptions.temperature = config.ai.temperature;
                        }

                        let aiContent;
                        try {
                            aiContent = await LLMClient.chatCompletion(requestOptions);
                        } catch (requestError) {
                            console.warn('Alter location request failed:', requestError.message);
                            warnSkippedAlteration(entry, 'AI request failed.');
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
                            durationSeconds: (Date.now() - requestStart) / 1000
                        });

                        if (!aiContent.trim()) {
                            warnSkippedAlteration(entry, 'Empty AI response.');
                            continue;
                        }

                        const parsedLocation = this._parseLocationAlterXml(aiContent);
                        if (!parsedLocation) {
                            warnSkippedAlteration(entry, 'Failed to parse AI response.');
                            continue;
                        }

                        const summary = this._applyLocationAlteration({
                            location,
                            parsedLocation,
                            changeDescription,
                            generatedImages
                        });

                        if (summary) {
                            alteredSummaries.push(summary);

                            entry.changeDescription = summary.changeDescription || changeDescription;
                            entry.description = entry.changeDescription;
                            entry.name = summary.newName || summary.originalName || entry.name;
                            if (summary.originalName && !entry.currentName) {
                                entry.currentName = summary.originalName;
                            }
                            if (summary.newName) {
                                entry.newName = summary.newName;
                            }

                            baseSnapshot.name = location.name || baseSnapshot.name;
                            baseSnapshot.description = location.description || baseSnapshot.description;
                            baseSnapshot.baseLevel = location.baseLevel;
                            baseSnapshot.statusEffects = typeof location.getStatusEffects === 'function'
                                ? location.getStatusEffects()
                                : baseSnapshot.statusEffects;
                        } else {
                            warnSkippedAlteration(entry, 'Failed to apply location alteration summary.');
                        }
                    } catch (error) {
                        console.warn('Failed to process alter_location entry:', error.message);
                        warnSkippedAlteration(entry, 'Unexpected error during alteration processing.');
                    }
                }

                if (alteredSummaries.length) {
                    if (!Array.isArray(context.alteredLocations)) {
                        context.alteredLocations = [];
                    }
                    context.alteredLocations.push(...alteredSummaries);
                }
            },
            received_quest: async function (entries = [], context = {}, rawValue = null) {
                const questEntries = Array.isArray(entries)
                    ? entries.filter(entry => entry && typeof entry.summary === 'string' && entry.summary.trim())
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
                    confirmQuestWithPlayer
                } = this._deps;

                if (typeof promptEnv?.render !== 'function'
                    || typeof parseXMLTemplate !== 'function'
                    || typeof prepareBasePromptContext !== 'function') {
                    throw new Error('received_quest handler is missing required prompt dependencies.');
                }

                if (typeof confirmQuestWithPlayer !== 'function') {
                    throw new Error('received_quest handler is missing confirmQuestWithPlayer dependency.');
                }

                const player = context.player || this.currentPlayer;
                if (!player || typeof player.addQuest !== 'function') {
                    throw new Error('received_quest handler requires a valid player with addQuest.');
                }

                const baseTimeout = this._baseTimeout || BASE_TIMEOUT_MS;

                let location = context.location || null;
                if (!location && player.currentLocation && Location && typeof Location.get === 'function') {
                    try {
                        location = Location.get(player.currentLocation) || null;
                    } catch (_) {
                        location = null;
                    }
                }
                if (!context.location && location) {
                    context.location = location;
                }

                if (!context.region && location && typeof findRegionByLocationId === 'function') {
                    try {
                        context.region = findRegionByLocationId(location.id) || null;
                    } catch (_) {
                        context.region = null;
                    }
                }

                let baseContext = {};
                try {
                    baseContext = await prepareBasePromptContext({ locationOverride: location });
                } catch (error) {
                    console.warn('Failed to prepare base context for quest generation:', error.message);
                    throw error;
                }

                if (!Array.isArray(context.questsAwarded)) {
                    context.questsAwarded = [];
                }

                let lastQuestCreated = null;

                for (const questEntry of questEntries) {
                    const questSummaryRaw = questEntry.summary.trim();
                    const questSummary = questSummaryRaw || 'Provide a concise, engaging summary of the newly assigned quest.';
                    let questGiverName = questEntry.giver ? questEntry.giver.trim() : '';
                    if (/^n\/?a$/i.test(questGiverName) || questGiverName.toLowerCase() === 'none') {
                        questGiverName = '';
                    }

                    const questSeed = {
                        name: '',
                        description: questSummary,
                        giver: questGiverName
                    };

                    const renderedTemplate = promptEnv.render('base-context.xml.njk', {
                        ...baseContext,
                        promptType: 'quest-generate',
                        shortDescription: questSummary,
                        quest: questSeed
                    });

                    if (typeof renderedTemplate !== 'string' || !renderedTemplate.trim()) {
                        console.warn('Quest generation template rendered empty output; skipping quest.', {
                            summary: questSummary,
                            giver: questGiverName
                        });
                        continue;
                    }

                    const parsedTemplate = parseXMLTemplate(renderedTemplate);
                    if (!parsedTemplate?.systemPrompt || !parsedTemplate?.generationPrompt) {
                        throw new Error('Quest generation template did not produce prompts.');
                    }

                    const questMessages = [
                        { role: 'system', content: parsedTemplate.systemPrompt },
                        { role: 'user', content: parsedTemplate.generationPrompt }
                    ];

                    const questRequestOptions = {
                        messages: questMessages,
                        metadataLabel: 'quest_generate',
                        timeoutMs: baseTimeout
                    };

                    if (Number.isFinite(parsedTemplate.maxTokens) && parsedTemplate.maxTokens > 0) {
                        questRequestOptions.maxTokens = parsedTemplate.maxTokens;
                    }
                    if (typeof parsedTemplate.temperature === 'number') {
                        questRequestOptions.temperature = parsedTemplate.temperature;
                    }

                    const requestStart = Date.now();
                    const questResponse = await LLMClient.chatCompletion(questRequestOptions);
                    const durationSeconds = (Date.now() - requestStart) / 1000;

                    console.log('Quest generation response received:', questResponse);
                    Events._logQuestGeneration({
                        fs,
                        path,
                        baseDir,
                        systemPrompt: parsedTemplate.systemPrompt,
                        generationPrompt: parsedTemplate.generationPrompt,
                        responseText: questResponse,
                        metadata: { summary: questSummary, giver: questGiverName },
                        durationSeconds
                    });

                    if (typeof questResponse !== 'string' || !questResponse.trim()) {
                        console.warn('Quest generation returned empty response; skipping quest creation.', {
                            summary: questSummary,
                            giver: questGiverName
                        });
                        continue;
                    }

                    const questData = Events._parseQuestXml(questResponse);
                    if (!questData) {
                        throw new Error('Quest generation did not return a usable quest.');
                    }

                    const questName = questData.name || Events._generateQuestName(questSummary);
                    const questDescription = questData.description || questSummary;

                    const rewardItems = Array.isArray(questData.rewardItems) && questData.rewardItems.length
                        ? questData.rewardItems
                        : [];

                    const rewardCurrency = Number.isFinite(questData.rewardCurrency) ? Math.max(0, questData.rewardCurrency) : 0;
                    const rewardXp = Number.isFinite(questData.rewardXp) ? Math.max(0, questData.rewardXp) : 0;

                    const questOptions = {
                        name: questName,
                        description: questDescription,
                        secretNotes: questData.secretNotes || '',
                        rewardItems,
                        rewardCurrency,
                        rewardXp
                    };

                    const effectiveGiverName = questData.giver || questGiverName;
                    if (effectiveGiverName) {
                        questOptions.giverName = effectiveGiverName;
                    }
                    if (effectiveGiverName && typeof findActorByName === 'function') {
                        try {
                            const questGiver = findActorByName(effectiveGiverName);
                            if (questGiver) {
                                questOptions.giver = questGiver;
                            }
                        } catch (error) {
                            console.warn(`Failed to resolve quest giver "${effectiveGiverName}":`, error.message);
                        }
                    }

                    const quest = new Quest(questOptions);

                    const objectiveDescriptions = Array.isArray(questData.objectives) && questData.objectives.length
                        ? questData.objectives
                        : (questSummary ? [questSummary] : []);

                    for (const objective of objectiveDescriptions) {
                        try {
                            if (!objective) {
                                continue;
                            }
                            if (typeof objective === 'string') {
                                if (objective.trim()) {
                                    quest.addObjective(objective.trim(), false);
                                }
                                continue;
                            }
                            if (typeof objective === 'object') {
                                const description = typeof objective.description === 'string'
                                    ? objective.description.trim()
                                    : '';
                                if (!description) {
                                    continue;
                                }
                                const optional = Boolean(objective.optional);
                                quest.addObjective(description, optional);
                                if (typeof objective.completed === 'boolean') {
                                    quest.objectives[quest.objectives.length - 1].completed = objective.completed;
                                }
                            }
                        } catch (error) {
                            console.warn('Failed to add quest objective:', error.message);
                        }
                    }

                    const clientId = context?.stream?.clientId;
                    if (!clientId) {
                        throw new Error('Quest confirmation requires an active client connection.');
                    }

                    const questPreview = {
                        id: quest.id,
                        name: quest.name,
                        description: quest.description,
                        secretNotes: quest.secretNotes || '',
                        summary: questSummary,
                        giver: questOptions.giverName || questOptions.giver?.name || '',
                        rewardItems,
                        rewardCurrency,
                        rewardXp,
                        objectives: Array.isArray(quest.objectives)
                            ? quest.objectives
                                .map(entry => ({
                                    description: typeof entry?.description === 'string' ? entry.description : '',
                                    optional: Boolean(entry?.optional)
                                }))
                                .filter(item => item.description)
                            : []
                    };

                    const accepted = await confirmQuestWithPlayer({
                        clientId,
                        requestId: context?.stream?.requestId || null,
                        quest: questPreview
                    });

                    if (!accepted) {
                        console.debug('[QuestDebug] Quest declined by player:', quest.name);
                        continue;
                    }

                    player.addQuest(quest);
                    context.questsAwarded.push({
                        id: quest.id,
                        name: quest.name,
                        summary: questSummary,
                        giver: questOptions.giverName || questOptions.giver?.name || '',
                        accepted: true
                    });
                    console.debug('[QuestDebug] context after push:', context.questsAwarded);

                    lastQuestCreated = quest;
                }

                if (lastQuestCreated) {
                    context.lastQuest = lastQuestCreated;
                }
            },
            completed_quest_objective: async function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }

                const player = context.player || this.currentPlayer;
                if (!player || typeof player.getQuestByName !== 'function') {
                    throw new Error('completed_quest_objective handler requires a valid player with quests.');
                }

                if (!Array.isArray(context.completedQuestObjectives)) {
                    context.completedQuestObjectives = [];
                }
                if (!Array.isArray(context.questCompletionRewards)) {
                    context.questCompletionRewards = [];
                }

                const {
                    generateItemsByNames,
                    getCurrencyLabel,
                    promptEnv,
                    parseXMLTemplate,
                    prepareBasePromptContext
                } = this._deps;
                if (typeof promptEnv?.render !== 'function'
                    || typeof parseXMLTemplate !== 'function'
                    || typeof prepareBasePromptContext !== 'function') {
                    throw new Error('completed_quest_objective handler is missing prompt dependencies.');
                }
                const currencyContext = this.config?.setting || Globals.config || {};
                const rewardLabel = (amount) => {
                    if (typeof getCurrencyLabel === 'function') {
                        try {
                            return getCurrencyLabel(amount, currencyContext);
                        } catch (_) {
                            // fall through
                        }
                    }
                    return Math.abs(Number(amount)) === 1 ? 'coin' : 'coins';
                };

                const rewardedQuestIds = new Set();
                let rewardPromptContext = context._questRewardPromptContext || null;

                for (const entry of entries) {
                    const questName = typeof entry?.quest === 'string' ? entry.quest.trim() : '';
                    const objectiveIndexValue = Number(entry?.objectiveIndex);
                    if (!questName || !Number.isFinite(objectiveIndexValue)) {
                        continue;
                    }

                    const quest = player.getQuestByName(questName);
                    if (!quest) {
                        console.warn(`completed_quest_objective: Quest "${questName}" not found on player.`);
                        continue;
                    }

                    const zeroBasedIndex = Math.max(0, Math.round(objectiveIndexValue));
                    if (!Array.isArray(quest.objectives) || !quest.objectives[zeroBasedIndex]) {
                        console.warn(`completed_quest_objective: Quest "${questName}" objective index ${objectiveIndexValue} is invalid.`);
                        continue;
                    }

                    const objective = quest.objectives[zeroBasedIndex];
                    const questWasComplete = quest.completed;
                    if (!objective.completed) {
                        objective.completed = true;
                    }
                    const questIsComplete = quest.completed;
                    const questJustCompleted = !questWasComplete && questIsComplete;

                    context.completedQuestObjectives.push({
                        questId: quest.id,
                        questName: quest.name,
                        objectiveIndex: zeroBasedIndex,
                        objectiveNumber: zeroBasedIndex + 1,
                        objectiveDescription: objective.description || null,
                        questCompleted: questIsComplete,
                        questJustCompleted
                    });

                    if (!quest.completed || quest.rewardClaimed || rewardedQuestIds.has(quest.id)) {
                        continue;
                    }

                    rewardedQuestIds.add(quest.id);
                    quest.rewardClaimed = true;

                    const rewardItems = Array.isArray(quest.rewardItems) ? quest.rewardItems.filter(Boolean) : [];
                    const rewardCurrency = Number.isFinite(quest.rewardCurrency) ? Math.max(0, quest.rewardCurrency) : 0;
                    const rewardXp = Number.isFinite(quest.rewardXp) ? Math.max(0, quest.rewardXp) : 0;

                    const grantedItems = [];
                    grantedItems.push(...rewardItems);
                    /*
                    if (rewardItems.length && typeof generateItemsByNames === 'function') {
                        try {
                            const createdItems = await generateItemsByNames({ itemNames: rewardItems, owner: player });
                            if (Array.isArray(createdItems) && createdItems.length) {
                                createdItems.forEach(item => {
                                    if (item && typeof item.name === 'string' && item.name.trim()) {
                                        grantedItems.push(item.name.trim());
                                    }
                                });
                            }
                        } catch (error) {
                            console.warn('Failed to generate quest reward items:', error.message);
                        }
                    }

                    if (!grantedItems.length) {
                        grantedItems.push(...rewardItems);
                    }
                    if (rewardCurrency > 0 && typeof player.adjustCurrency === 'function') {
                        const before = typeof player.getCurrency === 'function'
                            ? player.getCurrency()
                            : Number(player.currency) || 0;
                        const after = player.adjustCurrency(rewardCurrency);
                        if (!Array.isArray(context.currencyChanges)) {
                            context.currencyChanges = [];
                        }
                        context.currencyChanges.push({
                            amount: rewardCurrency,
                            before,
                            after
                        });
                    }
                    */
                    if (rewardXp > 0 && typeof player.addExperience === 'function') {
                        player.addExperience(rewardXp);
                        if (!Array.isArray(context.experienceAwards)) {
                            context.experienceAwards = [];
                        }
                        context.experienceAwards.push({
                            amount: rewardXp,
                            reason: `Completed quest: ${quest.name}`
                        });
                    }

                    const rewardLines = [];
                    grantedItems.filter(Boolean).forEach(itemName => {
                        rewardLines.push(itemName);
                    });
                    if (rewardXp > 0) {
                        rewardLines.push(`${rewardXp} XP`);
                    }
                    if (rewardCurrency > 0) {
                        rewardLines.push(`${rewardCurrency} ${rewardLabel(rewardCurrency)}`);
                    }

                    if (rewardLines.length) {
                        let rewardProse = '';
                        const fallbackList = ['Received item summary (shorten these item names to a reasonable size):', ...rewardLines.map(line => `* ${line}`)].join('\n');
                        try {
                            if (!rewardPromptContext) {
                                const rewardLocation = context.location || null;
                                rewardPromptContext = await prepareBasePromptContext({ locationOverride: rewardLocation });
                                context._questRewardPromptContext = rewardPromptContext;
                            }
                            const renderedRewardPrompt = promptEnv.render('base-context.xml.njk', {
                                ...rewardPromptContext,
                                promptType: 'quest-reward-prose',
                                questRewards: rewardLines
                            });
                            const parsedRewardTemplate = parseXMLTemplate(renderedRewardPrompt);
                            if (!parsedRewardTemplate?.systemPrompt || !parsedRewardTemplate?.generationPrompt) {
                                throw new Error('Quest reward prose template did not produce prompts.');
                            }
                            const rewardMessages = [
                                { role: 'system', content: parsedRewardTemplate.systemPrompt },
                                { role: 'user', content: parsedRewardTemplate.generationPrompt }
                            ];
                            const rewardResponse = await LLMClient.chatCompletion({
                                messages: rewardMessages,
                                metadataLabel: 'quest_reward_prose',
                                validateXML: false,
                            });
                            LLMClient.logPrompt({
                                prefix: 'quest_reward_prose',
                                metadataLabel: 'quest_reward_prose',
                                systemPrompt: parsedRewardTemplate.systemPrompt,
                                generationPrompt: parsedRewardTemplate.generationPrompt,
                                response: rewardResponse
                            });
                            if (typeof rewardResponse === 'string' && rewardResponse.trim()) {
                                rewardProse = rewardResponse.trim();
                            }
                        } catch (error) {
                            console.warn('Failed to generate quest reward prose:', error.message);
                            console.debug(error);
                        }

                        if (!rewardProse) {
                            rewardProse = fallbackList;
                        }

                        // const followupPayload = rewardProse.includes('I receive the following quest rewards:')
                        //     ? rewardProse
                        //     : `${rewardProse}\n\n${fallbackList}`;
                        Events._enqueueFollowupEventCheck(rewardProse);

                        context.questCompletionRewards.push({
                            questId: quest.id,
                            questName: quest.name,
                            items: [], //grantedItems,
                            xp: rewardXp,
                            currency: rewardCurrency,
                            message: rewardProse,
                            rewards: rewardLines.slice()
                        });

                        // Add the rewardProse to the chat log.
                    }
                }
            },
            currency: function (delta, context = {}) {
                if (!delta) {
                    return;
                }
                const player = context.player || this.currentPlayer;
                if (!player || typeof player.adjustCurrency !== 'function') {
                    return;
                }
                if (!Array.isArray(context.currencyChanges)) {
                    context.currencyChanges = [];
                }
                const before = typeof player.getCurrency === 'function' ? player.getCurrency() : Number(player.currency) || 0;
                player.adjustCurrency(delta);
                const after = typeof player.getCurrency === 'function' ? player.getCurrency() : Number(player.currency) || 0;
                context.currencyChanges.push({ amount: delta, before, after });
            },
            time_passed: function (value, context = {}) {
                const amount = Number(value);
                if (!Number.isFinite(amount) || amount < 0) {
                    console.warn('Invalid time_passed value:', value);
                    console.trace()
                    return;
                }
                Globals.elapsedTime += amount;

                context.timeProgress = { amount, total: Globals.elapsedTime };
            },
            in_combat: function (flag, context = {}) {
                //console.log(`Processing in_combat event: ${JSON.stringify(flag)}`);
                const normalizedFlag = Array.isArray(flag) ? flag[flag.length - 1] : flag;
                //console.log(`Normalized in_combat flag: ${JSON.stringify(normalizedFlag)}`);
                //console.log(`Boolean value: ${Boolean(normalizedFlag)}`);
                Globals.setInCombat(Boolean(normalizedFlag));
                context.inCombat = Globals.inCombat;
            },
            item_to_npc: async function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const { findThingByName, ensureNpcByName, Location, findRegionByLocationId } = this._deps;
                if (typeof ensureNpcByName !== 'function' || typeof findThingByName !== 'function') {
                    throw new Error('item_to_npc handler requires ensureNpcByName and findThingByName dependencies.');
                }

                const resolveLocation = candidate => {
                    if (!candidate || !Location || typeof Location.get !== 'function') {
                        return null;
                    }
                    try {
                        return Location.get(candidate) || null;
                    } catch (_) {
                        return null;
                    }
                };

                const player = context.player || this.currentPlayer;
                for (const entry of entries) {
                    const itemName = normalizeString(entry.item);
                    const npcName = normalizeString(entry.npc);
                    if (!npcName) {
                        continue;
                    }
                    const item = itemName ? findThingByName(itemName) : null;
                    if (!item) {
                        throw new Error(`item_to_npc could not find item "${itemName || '<unknown>'}"`);
                    }

                    let location = context.location || null;
                    if (!location && item.metadata?.locationId) {
                        location = resolveLocation(item.metadata.locationId);
                    }
                    if (!location && player?.currentLocation) {
                        location = resolveLocation(player.currentLocation);
                    }
                    if (!location) {
                        throw new Error(`item_to_npc could not resolve location for "${npcName}" transformation.`);
                    }

                    const transformationContext = { ...context, location };
                    if (!transformationContext.region && typeof findRegionByLocationId === 'function') {
                        try {
                            transformationContext.region = findRegionByLocationId(location.id) || null;
                        } catch (_) {
                            transformationContext.region = null;
                        }
                    }

                    this._detachThingFromWorld(item);
                    if (itemName) {
                        this.animatedItems.add(itemName);
                        this.destroyedItems.add(itemName);
                    }
                    if (npcName) {
                        this.newCharacters.add(npcName);
                        this.arrivedCharacters.add(npcName);
                    }
                    const npc = await ensureNpcByName(npcName, transformationContext);
                    if (!npc) {
                        throw new Error(`item_to_npc failed to create NPC "${npcName}"`);
                    }
                }
            },
            consume_item: function (items = [], context = {}) {
                if (!Array.isArray(items) || !items.length) {
                    return;
                }
                const { findThingByName } = this._deps;
                if (typeof findThingByName !== 'function') {
                    throw new Error('consume_item handler requires findThingByName dependency.');
                }

                for (const entry of items) {
                    const itemName = typeof entry === 'string'
                        ? entry.trim()
                        : (entry && entry.item ? String(entry.item).trim() : '');
                    if (!itemName) {
                        continue;
                    }
                    const item = findThingByName(itemName);
                    if (!item) {
                        console.debug(`[consume_item] Unable to locate item "${itemName}" for consumption.`);
                        continue;
                    } else {
                        console.debug(`[consume_item] Consuming item "${itemName}".`);
                    }
                    this._removeItemFromInventories(item);
                    this._detachThingFromWorld(item);
                    this.destroyedItems.add(itemName);
                }
            },
            alter_item: async function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }

                const { findThingByName, alterThingByPrompt, findActorById, Location } = this._deps;
                if (typeof findThingByName !== 'function') {
                    throw new Error('alter_item handler requires findThingByName dependency.');
                }

                if (typeof alterThingByPrompt !== 'function') {
                    throw new Error('alter_item handler requires alterThingByPrompt dependency.');
                }

                const tasks = [];

                for (const entry of entries) {
                    if (!entry) {
                        continue;
                    }

                    const originalName = entry.originalName || entry.from || null;
                    const targetName = entry.newName || entry.to || null;
                    const changeDescription = entry.changeDescription || entry.description || null;

                    const normalizedTargetName = typeof targetName === 'string' ? targetName.trim().toLowerCase() : '';
                    if (normalizedTargetName === 'consumed' || normalizedTargetName === 'n/a') {
                        continue;
                    }

                    const lookupCandidates = [originalName, targetName]
                        .filter(candidate => typeof candidate === 'string' && candidate.trim());

                    let thing = null;
                    for (const candidate of lookupCandidates) {
                        thing = findThingByName(candidate);
                        if (thing) {
                            break;
                        }
                    }

                    if (!thing) {
                        thing = this._createPlaceholderThingForAlter(entry, context);
                    }

                    if (!thing) {
                        continue;
                    }

                    tasks.push((async () => {
                        let ownerCandidate = null;

                        const metadataOwnerId = thing.metadata?.ownerId;
                        if (metadataOwnerId && typeof findActorById === 'function') {
                            try {
                                const found = findActorById(metadataOwnerId);
                                if (found) {
                                    ownerCandidate = found;
                                }
                            } catch (_) {
                                ownerCandidate = null;
                            }
                        }

                        if (!ownerCandidate && typeof thing.whoseInventory === 'function') {
                            try {
                                const owners = thing.whoseInventory() || [];
                                if (Array.isArray(owners) && owners.length > 0) {
                                    ownerCandidate = owners[0] || null;
                                }
                            } catch (_) {
                                ownerCandidate = null;
                            }
                        }

                        let locationCandidate = context.location || null;
                        if (!locationCandidate) {
                            const metadataLocationId = thing.metadata?.locationId;
                            if (metadataLocationId && Location && typeof Location.get === 'function') {
                                try {
                                    locationCandidate = Location.get(metadataLocationId) || null;
                                } catch (_) {
                                    locationCandidate = null;
                                }
                            }
                        }
                        if (!locationCandidate && ownerCandidate?.currentLocation && Location && typeof Location.get === 'function') {
                            try {
                                locationCandidate = Location.get(ownerCandidate.currentLocation) || null;
                            } catch (_) {
                                locationCandidate = null;
                            }
                        }

                        const outcome = await alterThingByPrompt({
                            thing,
                            changeDescription,
                            newName: targetName,
                            location: Globals.location,
                            owner: ownerCandidate || context.player || this.currentPlayer || null
                        });

                        if (outcome?.originalName) {
                            this.alteredItems.add(outcome.originalName);
                        }
                        if (outcome?.newName) {
                            this.alteredItems.add(outcome.newName);
                        }

                        entry.originalName = outcome?.originalName || originalName || null;
                        entry.newName = outcome?.newName || targetName || null;
                        entry.changeDescription = outcome?.changeDescription || changeDescription || null;
                        entry.description = entry.changeDescription;
                        entry.from = entry.originalName;
                        entry.to = entry.newName;

                        if (outcome.thing.thingType === 'scenery') {
                            thing.drop();
                        }
                    })());
                }

                if (tasks.length) {
                    await Promise.all(tasks);
                }
            },
            transfer_item: function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const { findThingByName, findActorByName } = this._deps;
                if (typeof findThingByName !== 'function' || typeof findActorByName !== 'function') {
                    throw new Error('transfer_item handler requires findThingByName and findActorByName dependencies.');
                }

                for (const entry of entries) {
                    const thing = findThingByName(entry.item);
                    if (!thing) {
                        continue;
                    }
                    const giver = entry.giver ? findActorByName(entry.giver) : null;
                    const receiver = entry.receiver ? findActorByName(entry.receiver) : null;

                    if (giver && typeof giver.removeInventoryItem === 'function') {
                        giver.removeInventoryItem(thing);
                    }
                    if (receiver && typeof receiver.addInventoryItem === 'function') {
                        receiver.addInventoryItem(thing);
                        thing.metadata = { ...(thing.metadata || {}), ownerId: receiver.id };
                    } else {
                        console.warn('transfer_item: No valid receiver found.', entry);
                        //this._detachThingFromWorld(thing);
                    }
                    if (entry.item) {
                        this.obtainedItems.add(entry.item);
                    }
                }
            },
            harvest_gather: async function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const { findActorByName, generateItemsByNames } = this._deps;
                if (typeof generateItemsByNames !== 'function') {
                    throw new Error('harvest_gather handler requires generateItemsByNames dependency.');
                }

                const generationTasks = [];
                for (const entry of entries) {
                    const actor = entry.harvester ? findActorByName?.(entry.harvester) : null;
                    if (actor && typeof actor.addInventoryItem === 'function' && entry.item) {
                        generationTasks.push(
                            generateItemsByNames({ itemNames: [entry.item], owner: actor }).catch(error => {
                                console.warn('Failed to generate harvested item:', error.message);
                                return [];
                            })
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
                console.log('Processing pick_up_item event with entries:', entries);
                if (!Array.isArray(entries) || !entries.length) {
                    //console.warn('pick_up_item event has no valid entries:', entries);
                    //console.trace();
                    return;
                }

                const { findThingByName, findActorByName, things } = this._deps;

                const resolveAvailableThing = (itemName) => {
                    const normalized = typeof itemName === 'string' ? itemName.trim().toLowerCase() : '';
                    if (!normalized) {
                        console.warn('pick_up_item event entry has no valid item name:', entry);
                        console.trace();
                        return null;
                    }

                    if (things instanceof Map) {
                        for (const candidate of things.values()) {
                            if (!candidate?.name || candidate.name.trim().toLowerCase() !== normalized) {
                                continue;
                            }
                            const owners = typeof candidate.whoseInventory === 'function'
                                ? candidate.whoseInventory()
                                : [];
                            if (owners.length > 0) {
                                continue;
                            }
                            return candidate;
                        }
                    }

                    if (typeof findThingByName === 'function') {
                        const candidate = findThingByName(itemName);
                        const owners = typeof candidate?.whoseInventory === 'function'
                            ? candidate.whoseInventory()
                            : [];
                        if (candidate && owners.length === 0) {
                            return candidate;
                        }
                    }

                    console.warn('pick_up_item event could not resolve available item:', itemName);
                    console.trace();

                    return null;
                };

                const createDuplicateThing = (itemName) => {
                    const template = typeof findThingByName === 'function' ? findThingByName(itemName) : null;

                    const metadata = template?.metadata || {};
                    const baseMetadata = { ...metadata };
                    delete baseMetadata.ownerId;
                    delete baseMetadata.locationId;

                    const duplicate = new Thing({
                        name: itemName,
                        description: template?.description || `An item named ${itemName}.`,
                        thingType: template?.thingType || 'item',
                        imageId: template?.imageId || null,
                        rarity: template?.rarity || null,
                        itemTypeDetail: template?.itemTypeDetail || null,
                        metadata: baseMetadata,
                        statusEffects: typeof template?.getStatusEffects === 'function'
                            ? template.getStatusEffects()
                            : [],
                        slot: template?.slot ?? null,
                        attributeBonuses: Array.isArray(template?.attributeBonuses)
                            ? template.attributeBonuses
                            : null,
                        causeStatusEffect: template?.causeStatusEffect ?? null,
                        level: template?.level ?? null,
                        relativeLevel: template?.relativeLevel ?? null
                    });

                    if (things instanceof Map) {
                        things.set(duplicate.id, duplicate);
                    }

                    return duplicate;
                };

                for (const entry of entries) {
                    if (!entry) {
                        console.warn('pick_up_item event entry is invalid:', entry);
                        console.trace();
                        continue;
                    }

                    const itemName = typeof entry.item === 'string' ? entry.item.trim() : '';
                    if (!itemName) {
                        console.warn('pick_up_item event entry has no valid item name:', entry);
                        console.trace();
                        continue;
                    }

                    if (this.obtainedItems.has(itemName)) {
                        console.warn('pick_up_item event entry has already been obtained:', entry);
                        console.trace();
                        continue;
                    }

                    const actor = typeof findActorByName === 'function' ? findActorByName(entry.name) : null;
                    if (!actor || typeof actor.addInventoryItem !== 'function') {
                        console.warn('pick_up_item event could not find valid actor for entry:', entry);
                        console.trace();
                        continue;
                    }

                    let thing = resolveAvailableThing(itemName);

                    if (!thing) {
                        await this._ensureItemsExist([itemName], context.location, {
                            allowObtained: false,
                            recordNewItems: false
                        });
                        thing = resolveAvailableThing(itemName);
                    }

                    /*
                    if (!thing) {
                        thing = createDuplicateThing(itemName);
                    }
                    */

                    if (!thing) {
                        throw new Error(`Unable to resolve or create item "${itemName}" for pick_up_item.`);
                    }

                    this._detachThingFromKnownLocation(thing);
                    actor.addInventoryItem(thing);
                    thing.metadata = { ...(thing.metadata || {}), ownerId: actor.id };
                    this.obtainedItems.add(itemName);
                }
            },
            drop_item: function (entries = [], context = {}) {
                const location = context.location;
                if (!entries.length) {
                    return;
                }
                if (!location) {
                    throw new Error('drop_item events require a valid location.');
                }
                const { findThingByName, findActorByName } = this._deps;
                for (const entry of entries) {
                    const thing = findThingByName?.(entry.item);
                    if (!thing) {
                        continue;
                    }

                    const holders = thing.whoseInventory();
                    thing.drop();
                    entry.character = holders[0].name;
                    this.droppedItems.add(entry.item);
                }
            },
            item_appear: async function (items = [], context = {}) {
                if (!Array.isArray(items) || !items.length) {
                    return;
                }

                await this._ensureItemsExist(items, context.location);

                for (const item of items) {
                    if (typeof item === 'string' && item.trim()) {
                        this.newItems.add(item);
                    }
                }
            },
            scenery_appear: async function (items = [], context = {}) {
                if (!Array.isArray(items) || !items.length) {
                    return;
                }

                // Filter out all items that are in newItems
                const filteredItems = items.filter(item => !this.newItems.has(item) && !this.alteredItems.has(item));

                try {
                    await this._generateItemsIntoWorld(filteredItems, context.location, { treatAsScenery: true });
                } catch (error) {
                    console.warn('Failed to generate scenery items:', error.message);
                }

                for (const item of filteredItems) {
                    if (typeof item === 'string' && item.trim()) {
                        this.newItems.add(item);
                    }
                }
            },
            harvestable_resource_appear: async function (items = [], context = {}) {
                if (!Array.isArray(items) || !items.length) {
                    return;
                }

                try {
                    await this._generateItemsIntoWorld(items, context.location, { treatAsResource: true });
                } catch (error) {
                    console.warn('Failed to generate harvestable resources:', error.message);
                }

                for (const item of items) {
                    if (typeof item === 'string' && item.trim()) {
                        this.newItems.add(item);
                    }
                }
            },
            alter_npc: async function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                await this._handleAlterNpcEvents(entries, context);
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
                    Location,
                    regions,
                    gameLocations
                } = this._deps;
                const suppressedIndexes = new Set();
                const processedNames = new SanitizedStringSet();
                const partyExcludedNames = new SanitizedStringSet();

                const registerActorName = (actor) => {
                    if (!actor || typeof actor.name !== 'string') {
                        return;
                    }
                    partyExcludedNames.add(actor.name);
                };

                const resolveActorById = (id) => {
                    if (!id) {
                        return null;
                    }
                    if (typeof findActorById === 'function') {
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

                const collectPartyNames = (actor) => {
                    if (!actor) {
                        return;
                    }
                    registerActorName(actor);
                    if (typeof actor.getPartyMembers !== 'function') {
                        return;
                    }
                    const memberIds = actor.getPartyMembers();
                    if (!Array.isArray(memberIds)) {
                        return;
                    }
                    for (const memberId of memberIds) {
                        const member = resolveActorById(memberId);
                        if (member) {
                            registerActorName(member);
                        }
                    }
                };

                collectPartyNames(context.player);
                const currentPlayer = this.currentPlayer;
                if (currentPlayer && currentPlayer !== context.player) {
                    collectPartyNames(currentPlayer);
                }

                const normalize = (value) => (typeof value === 'string' ? value.trim() : '');

                const lookupRegionByName = (name) => {
                    const trimmed = normalize(name);
                    if (!trimmed) {
                        return null;
                    }
                    if (typeof findRegionByNameLoose === 'function') {
                        const region = findRegionByNameLoose(trimmed);
                        if (region) {
                            return region;
                        }
                    }
                    if (regions instanceof Map) {
                        const lower = trimmed.toLowerCase();
                        for (const region of regions.values()) {
                            if (region && typeof region.name === 'string' && region.name.trim().toLowerCase() === lower) {
                                return region;
                            }
                        }
                    }
                    return null;
                };

                const lookupLocationByName = (name) => {
                    const trimmed = normalize(name);
                    if (!trimmed) {
                        return null;
                    }
                    let location = null;
                    if (Location && typeof Location.findByName === 'function') {
                        try {
                            location = Location.findByName(trimmed);
                        } catch (_) {
                            location = null;
                        }
                    }
                    if (!location && Location && typeof Location.getByName === 'function') {
                        try {
                            location = Location.getByName(trimmed);
                        } catch (_) {
                            location = null;
                        }
                    }
                    if (!location && typeof findLocationByNameLoose === 'function') {
                        location = findLocationByNameLoose(trimmed) || null;
                    }
                    return location;
                };

                const doesLocationMatchRegion = (location, regionName) => {
                    const trimmedRegion = normalize(regionName);
                    if (!location || !trimmedRegion) {
                        return !trimmedRegion;
                    }
                    const regionId = location.regionId
                        || location.stubMetadata?.regionId
                        || location.stubMetadata?.targetRegionId
                        || null;
                    if (!regionId) {
                        return false;
                    }
                    if (regions instanceof Map) {
                        const regionRecord = regions.get(regionId);
                        if (regionRecord && typeof regionRecord.name === 'string') {
                            if (regionRecord.name.trim().toLowerCase() === trimmedRegion.toLowerCase()) {
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
                    if (typeof looseRegion.name === 'string' && looseRegion.name.trim().toLowerCase() === trimmedRegion.toLowerCase()) {
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
                    const locationIds = Array.isArray(region.locationIds) ? region.locationIds : [];
                    for (const locationId of locationIds) {
                        let candidate = null;
                        if (Location && typeof Location.get === 'function') {
                            candidate = Location.get(locationId);
                        }
                        if (!candidate && gameLocations instanceof Map) {
                            candidate = gameLocations.get(locationId) || null;
                        }
                        if (!candidate || typeof candidate.name !== 'string') {
                            continue;
                        }
                        if (candidate.name.trim().toLowerCase() === trimmedLocation.toLowerCase()) {
                            return candidate;
                        }
                    }
                    return null;
                };

                for (let index = 0; index < entries.length; index += 1) {
                    const entry = entries[index];
                    const action = (entry?.action || '').trim().toLowerCase();
                    const isFirstAppearance = Boolean(entry?.firstAppearance);
                    const originalName = normalizeString(entry?.name);

                    if (!originalName) {
                        suppressedIndexes.add(index);
                        continue;
                    }

                    if (partyExcludedNames.has(originalName)) {
                        suppressedIndexes.add(index);
                        continue;
                    }

                    if (processedNames.has(originalName)) {
                        suppressedIndexes.add(index);
                        continue;
                    }

                    let finalizedName = originalName;
                    if (action === 'arrived' || isFirstAppearance) {
                        try {
                            const ensuredNpc = await ensureNpcByName(originalName, context);
                            if (ensuredNpc && typeof ensuredNpc.name === 'string') {
                                const trimmed = ensuredNpc.name.trim();
                                if (trimmed) {
                                    finalizedName = trimmed;
                                }
                            }
                        } catch (error) {
                            console.warn('Failed to ensure NPC arrival:', error.message);
                        }
                    }

                    if (!finalizedName) {
                        suppressedIndexes.add(index);
                        continue;
                    }

                    if (partyExcludedNames.has(finalizedName)) {
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

                    if (action === 'arrived' || isFirstAppearance) {
                        this.newCharacters.add(finalizedName);
                        this.arrivedCharacters.add(finalizedName);
                        if (originalName !== finalizedName) {
                            this.newCharacters.add(originalName);
                            this.arrivedCharacters.add(originalName);
                        }
                    }

                    const npc = findActorByName?.(finalizedName);
                    if (!npc) {
                        continue;
                    }
                    if (action === 'arrived' || isFirstAppearance) {
                        const targetLocation = context.location || null;
                        if (targetLocation) {
                            try {
                                const currentLocationId = typeof npc.currentLocation === 'string' ? npc.currentLocation : null;
                                if (currentLocationId && currentLocationId !== targetLocation.id) {
                                    let currentLocation = null;
                                    try {
                                        currentLocation = Location.get(currentLocationId);
                                    } catch (_) {
                                        currentLocation = null;
                                    }
                                    if (!currentLocation && gameLocations instanceof Map) {
                                        currentLocation = gameLocations.get(currentLocationId) || null;
                                    }
                                    if (currentLocation && typeof currentLocation.removeNpcId === 'function') {
                                        currentLocation.removeNpcId(npc.id);
                                    }
                                }

                                if (typeof npc.setLocation === 'function') {
                                    npc.setLocation(targetLocation.id || targetLocation);
                                } else if (typeof npc.setLocationByName === 'function') {
                                    npc.setLocationByName(targetLocation.name || targetLocation.id);
                                }

                                if (typeof targetLocation.addNpcId === 'function') {
                                    targetLocation.addNpcId(npc.id);
                                }

                                if (gameLocations instanceof Map && targetLocation?.id) {
                                    gameLocations.set(targetLocation.id, targetLocation);
                                }
                            } catch (error) {
                                console.warn(`Failed to place arriving NPC "${finalizedName}" in current location:`, error.message);
                                console.debug([error]);
                            }
                        }
                    }
                    if (action === 'left') {
                        console.log(`Processing departure of NPC: ${finalizedName} to ${entry.destination || '<unspecified>'}`);
                        const destinationLocationName = normalize(entry.destinationLocation) || normalize(entry.destination);
                        const destinationRegionName = normalize(entry.destinationRegion);

                        let targetLocation = lookupLocationByName(destinationLocationName);
                        console.log(`  Initial resolved location: ${targetLocation ? targetLocation.name : '<none>'}`);

                        if (targetLocation && destinationRegionName && !doesLocationMatchRegion(targetLocation, destinationRegionName)) {
                            targetLocation = null;
                        }

                        if (!targetLocation && destinationRegionName && destinationLocationName) {
                            targetLocation = resolveLocationWithinRegion(destinationRegionName, destinationLocationName);
                        }

                        if (!targetLocation) {
                            console.warn(`NPC departure destination not found for ${finalizedName}: region='${destinationRegionName || ''}', location='${destinationLocationName || ''}'`);
                            continue;
                        }

                        try {
                            const originLocation = npc.location || context.location || null;
                            if (originLocation && typeof originLocation.removeNpcId === 'function') {
                                originLocation.removeNpcId(npc.id);
                            }
                            if (typeof npc.setLocation === 'function') {
                                npc.setLocation(targetLocation);
                                console.log(`  NPC ${finalizedName} moved to ${targetLocation.name}`);
                            } else if (typeof npc.setLocationByName === 'function') {
                                npc.setLocationByName(targetLocation.name || destinationLocationName);
                                console.log(`  NPC ${finalizedName} moved to ${targetLocation.name || destinationLocationName}`);
                            } else {
                                console.warn(`NPC ${finalizedName} cannot move: missing setLocation method.`);
                                continue;
                            }
                            if (targetLocation && typeof targetLocation.addNpcId === 'function') {
                                targetLocation.addNpcId(npc.id);
                            }
                            this.departedCharacters.add(finalizedName);
                        } catch (error) {
                            console.warn(`Failed to move NPC ${finalizedName} to destination '${targetLocation?.name || destinationLocationName}':`, error.message);
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
                    if (entry.action === 'joined') {
                        player.addPartyMember(npc.id);
                    } else if (entry.action === 'left') {
                        player.removePartyMember(npc.id);
                    }
                }
            },
            status_effect_change: function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const { findActorByName } = this._deps;
                console.log('Processing status_effect_change entries:', entries);
                for (const entry of entries) {
                    entry.description = entry.detail;
                    if (entry.entity) {
                        this.alteredCharacters.add(entry.entity);
                    }
                    const entity = findActorByName?.(entry.entity);
                    if (!entity) {
                        continue;
                    }
                    if (entry.action === 'gained' && typeof entity.addStatusEffect === 'function') {
                        entity.addStatusEffect(makeStatusEffect(entry.detail, this.DEFAULT_STATUS_DURATION));
                    } else if (entry.action === 'lost' && typeof entity.removeStatusEffect === 'function') {
                        entity.removeStatusEffect(entry.detail);
                    }
                }
            },
            heal_recover: function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const { findActorByName } = this._deps;
                for (const entry of entries) {
                    const targetName = entry.character || entry.recipient;
                    const magnitude = entry.magnitude || entry.effect || 'small';
                    const actor = targetName ? findActorByName?.(targetName) : null;
                    if (!actor || typeof actor.modifyHealth !== 'function') {
                        continue;
                    }
                    const amount = this._estimateHealingAmount(magnitude, actor);
                    actor.modifyHealth(amount, entry.reason || entry.effect || 'Recovered');
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
                    if (!actor || typeof actor.applyNeedBarChange !== 'function') {
                        continue;
                    }
                    const change = actor.applyNeedBarChange(entry.bar, {
                        direction: entry.direction,
                        magnitude: entry.magnitude,
                        reason: entry.reason
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
                if (context.allowEnvironmentalEffects === false || !Array.isArray(entries) || !entries.length) {
                    return;
                }
                const { findActorByName } = this._deps;
                if (!Array.isArray(context.environmentalDamageEvents)) {
                    context.environmentalDamageEvents = [];
                }
                for (const entry of entries) {
                    const actor = findActorByName?.(entry.name);
                    if (!actor || typeof actor.modifyHealth !== 'function') {
                        continue;
                    }
                    const effect = entry.effect || 'damage';
                    const severity = entry.severity || 'medium';
                    const amount = this._severityToDamage(severity, context);
                    const delta = effect === 'healing' ? amount : -amount;
                    const result = actor.modifyHealth(delta, entry.reason || 'Environmental effect');
                    context.environmentalDamageEvents.push({
                        name: entry.name,
                        type: effect === 'healing' ? 'healing' : 'damage',
                        severity,
                        reason: entry.reason || '',
                        amount: result?.change ?? Math.abs(delta)
                    });
                }
            },
            attack_damage: function (entries = []) {
                /*
                const { findActorByName } = this._deps;
                for (const entry of entries) {
                    const victim = findActorByName?.(entry.target);
                    if (!victim || typeof victim.modifyHealth !== 'function') {
                        continue;
                    }
                    victim.modifyHealth(-5, entry.attacker ? `Attacked by ${entry.attacker}` : 'Attacked');
                }
                */
            },
            death_incapacitation: function (entries = []) {
                const { findActorByName } = this._deps;
                for (const entry of entries) {
                    const actor = findActorByName?.(entry.name);
                    if (!actor || typeof actor.modifyHealth !== 'function') {
                        continue;
                    }
                    if (entry.status === 'dead') {
                        actor.modifyHealth(-Infinity, 'Killed');
                        actor.isDead = true;
                        if (typeof actor.addStatusEffect === 'function') {
                            actor.addStatusEffect(makeStatusEffect('Deceased', null));
                        }
                    } else {
                        actor.modifyHealth(-Math.abs(actor.health || 0), 'Incapacitated');
                        if (typeof actor.addStatusEffect === 'function') {
                            actor.addStatusEffect(makeStatusEffect('Incapacitated', null));
                        }
                    }
                }
            },
            defeated_enemy: function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const player = context.player || this.currentPlayer;
                if (!player || typeof player.addExperience !== 'function') {
                    return;
                }
                const { findActorByName } = this._deps;
                const awards = [];
                for (const name of entries) {
                    const enemy = findActorByName?.(name);
                    const level = Number(enemy?.level) || Number(context.location?.baseLevel) || 1;
                    const xp = Math.ceil(Math.max(25, Math.round(level * 50) / player.level));
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
                    let award = Math.ceil(entry.amount * Math.max(Globals.location.baseLevel, 1) / player.level);
                    player.addExperience(award);
                    context.experienceAwards.push({ amount: award, reason: entry.reason || 'Accomplishment' });
                }
            },
            move_location: async function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const destinationInput = entries[entries.length - 1];
                const destinationName = typeof destinationInput === 'string' ? destinationInput.trim() : '';
                if (!destinationName) {
                    return;
                }
                if (Events.movedLocations.has(destinationName)) {
                    return;
                }
                Events.movedLocations.add(destinationName);
                try {
                    await movePlayerToDestination(this, destinationName, context, {
                        fallbackName: destinationName,
                        label: 'move_location'
                    });
                } catch (error) {
                    throw new Error(`Failed to move player location to "${destinationName}": ${error.message}`);
                }
            }
        };
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
            fs,
            path,
            baseDir,
            generatedImages
        } = this._deps;

        if (typeof findActorByName !== 'function') {
            throw new Error('alter_npc handler requires findActorByName dependency.');
        }
        if (typeof promptEnv?.render !== 'function') {
            throw new Error('alter_npc handler requires promptEnv.render dependency.');
        }
        if (typeof parseXMLTemplate !== 'function') {
            throw new Error('alter_npc handler requires parseXMLTemplate dependency.');
        }
        if (typeof prepareBasePromptContext !== 'function') {
            throw new Error('alter_npc handler requires prepareBasePromptContext dependency.');
        }

        const config = this.config || {};
        const aiConfig = config?.ai;

        if (!aiConfig) {
            throw new Error('AI configuration missing; cannot process alter_npc events.');
        }

        const defaultTemperature = typeof aiConfig.temperature === 'number' ? aiConfig.temperature : 0.6;

        const summaries = [];

        for (const entry of entries) {
            if (!entry || typeof entry.name !== 'string' || !entry.name.trim()) {
                throw new Error('alter_npc entry is missing a character name.');
            }

            const npcName = entry.name.trim();
            const npc = findActorByName(npcName);
            if (!npc) {
                throw new Error(`alter_npc entry references unknown character "${npcName}".`);
            }
            const isNpcEntity = typeof npc.isNPC === 'function' ? npc.isNPC() : Boolean(npc.isNPC);
            if (!isNpcEntity) {
                console.log("Skipping alteration of player character:", npcName);
                continue;
            }

            let location = context.location || null;
            if (!location && npc.currentLocation && Location && typeof Location.get === 'function') {
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
            if (!region && location && typeof findRegionByLocationId === 'function') {
                try {
                    region = findRegionByLocationId(location.id) || null;
                } catch (error) {
                    region = null;
                }
            }

            if (!context.region && region) {
                context.region = region;
            }

            const baseContext = await prepareBasePromptContext({ locationOverride: location });
            const npcStatus = typeof npc.getStatus === 'function'
                ? npc.getStatus()
                : (typeof npc.toJSON === 'function' ? npc.toJSON() : {});

            const attributeSnapshot = {};
            const attributeDefinitions = npc.attributeDefinitions || {};
            for (const attrName of Object.keys(attributeDefinitions)) {
                if (!attrName) {
                    continue;
                }
                if (typeof npc.getAttributeTextValue === 'function') {
                    attributeSnapshot[attrName] = npc.getAttributeTextValue(attrName);
                } else {
                    const info = npcStatus?.attributeInfo?.[attrName];
                    attributeSnapshot[attrName] = info?.modifiedValue ?? info?.value ?? '';
                }
            }

            const existingAbilities = Array.isArray(npcStatus?.abilities)
                ? npcStatus.abilities
                : (typeof npc.getAbilities === 'function' ? npc.getAbilities() : []);
            const existingStatusEffects = Array.isArray(npcStatus?.statusEffects)
                ? npcStatus.statusEffects
                : (typeof npc.getStatusEffects === 'function' ? npc.getStatusEffects() : []);
            const existingInventory = Array.isArray(npcStatus?.inventory)
                ? npcStatus.inventory.map(item => item?.name || item)
                : (typeof npc.getInventoryItems === 'function'
                    ? npc.getInventoryItems().map(item => item?.name || item?.id)
                    : []);

            const alteredCharacter = {
                name: npc.name,
                description: npc.description,
                shortDescription: npc.shortDescription,
                role: npcStatus?.role || npcStatus?.class || '',
                class: npcStatus?.class || npc.class,
                race: npcStatus?.race || npc.race,
                relativeLevel: npcStatus?.relativeLevel ?? null,
                currency: typeof npc.getCurrency === 'function' ? npc.getCurrency() : npcStatus?.currency ?? null,
                attributes: attributeSnapshot,
                personality: {
                    type: npc.personalityType,
                    traits: npc.personalityTraits,
                    notes: npc.personalityNotes
                },
                statusEffects: existingStatusEffects,
                abilities: existingAbilities,
                inventory: existingInventory
            };

            const characterSeed = {
                name: npc.name,
                description: npc.description,
                shortDescription: npc.shortDescription,
                role: alteredCharacter.role,
                class: npc.class,
                race: npc.race,
                relativeLevel: alteredCharacter.relativeLevel,
                currency: alteredCharacter.currency,
                personality: {
                    type: npc.personalityType,
                    traits: npc.personalityTraits,
                    notes: npc.personalityNotes
                }
            };


            const changeDescription = entry.description || entry.changeDescription || '';
            const promptPayload = {
                ...baseContext,
                promptType: 'character-alter',
                changeDescription,
                alteredCharacter,
                characterSeed
            };

            let promptData;
            try {
                const renderedTemplate = promptEnv.render('base-context.xml.njk', promptPayload);
                promptData = parseXMLTemplate(renderedTemplate);
            } catch (error) {
                throw new Error(`Failed to render character alteration template for "${npcName}": ${error.message}`);
            }

            if (!promptData?.systemPrompt || !promptData?.generationPrompt) {
                throw new Error(`Character alteration template for "${npcName}" did not produce prompts.`);
            }

            const messages = [
                { role: 'system', content: promptData.systemPrompt },
                { role: 'user', content: promptData.generationPrompt }
            ];

            const requestOptions = {
                messages,
                metadataLabel: 'alter_npc',
                timeoutMs: this._baseTimeout
            };

            if (typeof promptData.temperature === 'number') {
                requestOptions.temperature = promptData.temperature;
            } else if (Number.isInteger(defaultTemperature)) {
                requestOptions.temperature = defaultTemperature;
            }

            const requestStarted = Date.now();
            let aiContent;
            try {
                aiContent = await LLMClient.chatCompletion(requestOptions);
            } catch (error) {
                throw new Error(`Alter NPC request failed for "${npcName}": ${error.message}`);
            }

            if (!aiContent.trim()) {
                throw new Error(`Alter NPC response for "${npcName}" was empty.`);
            }

            const parsedCharacter = this._parseCharacterAlterXml(aiContent);
            if (!parsedCharacter) {
                throw new Error(`Failed to parse character alteration response for "${npcName}".`);
            }

            if (fs && path) {
                try {
                    const logsDir = path.join(baseDir || process.cwd(), 'logs');
                    if (!fs.existsSync(logsDir)) {
                        fs.mkdirSync(logsDir, { recursive: true });
                    }
                    const safeName = (npc.name || 'npc').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'npc';
                    const durationSeconds = (Date.now() - requestStarted) / 1000;
                    const logPath = path.join(logsDir, `alter_npc_${Date.now()}_${safeName}.log`);
                    const logLines = [
                        `=== API CALL DURATION: ${durationSeconds.toFixed(3)}s ===`,
                        '=== ALTER NPC SYSTEM PROMPT ===',
                        promptData.systemPrompt,
                        '',
                        '=== ALTER NPC GENERATION PROMPT ===',
                        promptData.generationPrompt,
                        '',
                        '=== ALTER NPC RESPONSE ===',
                        aiContent.trim() || '(empty response)',
                        ''
                    ];
                    fs.writeFileSync(logPath, logLines.join('\n'), 'utf8');
                } catch (error) {
                    console.warn('Failed to log NPC alteration prompt:', error.message);
                }
            }

            const summary = this._applyCharacterAlteration({
                npc,
                entry: { ...entry, changeDescription },
                parsedCharacter,
                location,
                region,
                generatedImages,
                findThingByName
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
        findThingByName
    }) {
        if (!npc || !parsedCharacter) {
            throw new Error('applyCharacterAlteration requires an NPC and parsed character data.');
        }

        const summary = {
            npcId: npc.id,
            originalName: npc.name,
            name: npc.name,
            changeDescription: entry?.changeDescription || ''
        };

        let activeLocation = location;
        if (!activeLocation) {
            const { Location } = this._deps;
            if (Location && typeof Location.get === 'function' && npc.currentLocation) {
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
            } else if (generatedImages && typeof generatedImages === 'object') {
                delete generatedImages[npc.imageId];
            }
            try {
                npc.imageId = null;
            } catch (error) {
                // Ignore immutable imageId setters
            }
        }

        if (parsedCharacter.name && parsedCharacter.name.trim() && parsedCharacter.name.trim() !== npc.name) {
            if (typeof npc.setName !== 'function') {
                throw new Error(`NPC "${npc.name}" cannot be renamed; missing setName method.`);
            }
            npc.setName(parsedCharacter.name.trim());
            summary.name = npc.name;
        }

        if (parsedCharacter.description && parsedCharacter.description.trim()) {
            npc.description = parsedCharacter.description.trim();
        }

        if (parsedCharacter.shortDescription && parsedCharacter.shortDescription.trim()) {
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
            if (parsedCharacter.personality.type && parsedCharacter.personality.type.trim()) {
                npc.personalityType = parsedCharacter.personality.type.trim();
            }
            if (typeof parsedCharacter.personality.traits === 'string') {
                npc.personalityTraits = parsedCharacter.personality.traits.trim();
            }
            if (typeof parsedCharacter.personality.notes === 'string') {
                npc.personalityNotes = parsedCharacter.personality.notes.trim();
            }
        }

        if (Number.isFinite(parsedCharacter.currency)) {
            if (typeof npc.setCurrency === 'function') {
                npc.setCurrency(parsedCharacter.currency);
            } else if ('currency' in npc) {
                npc.currency = parsedCharacter.currency;
            } else {
                throw new Error(`NPC "${npc.name}" cannot update currency.`);
            }
        }

        if (parsedCharacter.attributes && typeof parsedCharacter.attributes === 'object') {
            if (typeof npc.setAttribute !== 'function') {
                throw new Error(`NPC "${npc.name}" cannot update attributes; setAttribute missing.`);
            }
            for (const [attributeName, rawValue] of Object.entries(parsedCharacter.attributes)) {
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
            if (typeof npc.setStatusEffects !== 'function') {
                throw new Error(`NPC "${npc.name}" cannot update status effects; setStatusEffects missing.`);
            }
            const normalizedEffects = parsedCharacter.statusEffects
                .filter(effect => effect && (effect.description || typeof effect === 'string'))
                .map(effect => {
                    if (typeof effect === 'string') {
                        return { description: effect, duration: null };
                    }
                    const duration = Number(effect.duration);
                    return {
                        description: effect.description || String(effect).trim(),
                        duration: Number.isFinite(duration)
                            ? duration
                            : (effect.duration === null || effect.duration === undefined ? null : effect.duration)
                    };
                });
            npc.setStatusEffects(normalizedEffects);
        }

        if (Array.isArray(parsedCharacter.abilities)) {
            if (typeof npc.setAbilities !== 'function') {
                throw new Error(`NPC "${npc.name}" cannot update abilities; setAbilities missing.`);
            }
            const abilities = parsedCharacter.abilities
                .filter(ability => ability && ability.name)
                .map(ability => ({
                    name: ability.name,
                    description: ability.description || '',
                    type: ability.type || '',
                    level: Number.isFinite(Number(ability.level)) ? Number(ability.level) : undefined
                }));
            npc.setAbilities(abilities);
        }

        const desiredInventory = Array.isArray(parsedCharacter.inventory)
            ? parsedCharacter.inventory.map(item => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
            : null;

        const droppedItems = [];
        if (desiredInventory) {
            if (typeof npc.getInventoryItems !== 'function' || typeof npc.addInventoryItem !== 'function' || typeof npc.removeInventoryItem !== 'function') {
                throw new Error(`NPC "${npc.name}" cannot update inventory; inventory methods missing.`);
            }
            if (typeof findThingByName !== 'function') {
                throw new Error('alter_npc handler requires findThingByName dependency for inventory updates.');
            }

            const beforeItems = npc.getInventoryItems();
            const beforeById = new Map(beforeItems.map(item => [item.id, item]));
            const desiredById = new Map();

            await this._ensureItemsExist(desiredInventory);

            for (const itemName of desiredInventory) {
                const thing = Thing.getByName(itemName);
                try {
                    if (!thing) {
                        throw new Error(`Unable to locate item "${itemName}" while updating inventory for "${npc.name}".`);
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
                    console.warn(`Failed to add item "${itemName}" to inventory of "${npc.name}":`, error.message);
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
            if (typeof npc.setLevel !== 'function') {
                throw new Error(`NPC "${npc.name}" cannot update level; setLevel missing.`);
            }
            const baseReference = this._resolveNpcBaseLevelReference({ npc, location: activeLocation, region });
            const targetLevel = this._clampLevel(baseReference + parsedCharacter.relativeLevel, baseReference);
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
        if (typeof xmlContent !== 'string' || !xmlContent.trim()) {
            return null;
        }

        try {
            const doc = Utils.parseXmlDocument(xmlContent, 'text/xml');

            const parserError = doc.getElementsByTagName('parsererror')[0];
            if (parserError) {
                throw new Error(parserError.textContent || 'Unknown XML parsing error');
            }

            const locationNode = doc.getElementsByTagName('location')[0];
            if (!locationNode) {
                return null;
            }

            const getText = tag => locationNode.getElementsByTagName(tag)[0]?.textContent?.trim() || '';

            const name = getText('name');
            const description = getText('description');
            const baseLevelRaw = getText('baseLevel');
            const baseLevel = Number(baseLevelRaw);

            return {
                name: name || null,
                description: description || '',
                baseLevel: Number.isFinite(baseLevel) ? baseLevel : null
            };
        } catch (error) {
            console.warn('Failed to parse altered location XML:', error.message);
            return null;
        }
    }

    static _applyLocationAlteration({ location, parsedLocation, changeDescription, generatedImages }) {
        if (!location || !parsedLocation) {
            return null;
        }

        const originalName = location.name || location.id;
        const originalDescription = location.description || '';
        const originalBaseLevel = Number.isFinite(location.baseLevel) ? location.baseLevel : null;

        let changed = false;

        const normalizedName = parsedLocation.name && parsedLocation.name.trim();
        if (normalizedName && normalizedName !== location.name) {
            location.name = normalizedName;
            changed = true;
        }

        const trimmedDescription = parsedLocation.description && parsedLocation.description.trim();
        if (trimmedDescription && trimmedDescription !== location.description) {
            location.description = trimmedDescription;
            changed = true;
        }

        if (Number.isFinite(parsedLocation.baseLevel)) {
            const clampedLevel = this._clampLevel(parsedLocation.baseLevel, location.baseLevel);
            if (clampedLevel !== location.baseLevel) {
                location.baseLevel = clampedLevel;
                changed = true;
            }
        }

        if (typeof location.addStatusEffect === 'function' && changeDescription) {
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
            changeDescription: changeDescription || '',
            descriptionBefore: originalDescription,
            descriptionAfter: location.description,
            changed
        };
    }

    static _logAlterLocation({ fs, path, baseDir, locationName, systemPrompt, generationPrompt, responseText, durationSeconds }) {
        if (!fs || !path) {
            return;
        }
        try {
            const logDir = path.join(baseDir || process.cwd(), 'logs');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            const safeNameSource = locationName || 'location';
            const safeName = safeNameSource.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'location';
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const logPath = path.join(logDir, `alter_location_${timestamp}_${safeName}.log`);
            const logLines = [
                typeof durationSeconds === 'number' ? `=== API CALL DURATION: ${durationSeconds.toFixed(3)}s ===` : null,
                '=== ALTER LOCATION SYSTEM PROMPT ===',
                systemPrompt || '(none)',
                '',
                '=== ALTER LOCATION GENERATION PROMPT ===',
                generationPrompt || '(none)',
                '',
                '=== ALTER LOCATION RESPONSE ===',
                responseText || '(no response)',
                ''
            ].filter(Boolean);
            fs.writeFileSync(logPath, logLines.join('\n'), 'utf8');
        } catch (error) {
            console.warn('Failed to log location alteration prompt:', error.message);
        }
    }

    static _logQuestGeneration({ fs, path, baseDir, systemPrompt, generationPrompt, responseText, metadata, durationSeconds }) {
        if (!fs || !path) {
            return;
        }
        try {
            const logDir = path.join(baseDir || process.cwd(), 'logs');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const logPath = path.join(logDir, `quest_generate_${timestamp}.log`);
            const logLines = [
                typeof durationSeconds === 'number' ? `=== API CALL DURATION: ${durationSeconds.toFixed(3)}s ===` : null,
                metadata?.summary ? `Quest Summary: ${metadata.summary}` : null,
                metadata?.giver ? `Quest Giver: ${metadata.giver}` : null,
                '=== QUEST SYSTEM PROMPT ===',
                systemPrompt || '(none)',
                '',
                '=== QUEST GENERATION PROMPT ===',
                generationPrompt || '(none)',
                '',
                '=== QUEST RESPONSE ===',
                responseText || '(no response)',
                ''
            ].filter(Boolean);
            fs.writeFileSync(logPath, logLines.join('\n'), 'utf8');
        } catch (error) {
            console.warn('Failed to log quest generation prompt:', error.message);
        }
    }

    static _parseQuestXml(xmlContent) {
        if (typeof xmlContent !== 'string' || !xmlContent.trim()) {
            return null;
        }

        try {
            const doc = Utils.parseXmlDocument(xmlContent, 'text/xml');
            const parserError = doc.getElementsByTagName('parsererror')[0];
            if (parserError) {
                throw new Error(parserError.textContent || 'Unknown XML parsing error');
            }

            const questNode = doc.getElementsByTagName('quest')[0];
            if (!questNode) {
                return null;
            }

            const getText = tag => questNode.getElementsByTagName(tag)[0]?.textContent?.trim() || '';

            const rewardsNode = questNode.getElementsByTagName('rewards')[0] || null;
            const rewardItems = rewardsNode
                ? Array.from(rewardsNode.getElementsByTagName('item'))
                    .map(node => {
                        const descriptionNode = node.getElementsByTagName('description')[0];
                        const value = descriptionNode ? descriptionNode.textContent : node.textContent;
                        return value ? value.trim() : '';
                    })
                    .filter(Boolean)
                : [];

            let rewardCurrency = 0;
            if (rewardsNode) {
                const currencyNode = rewardsNode.getElementsByTagName('currency')[0];
                if (currencyNode) {
                    const currencyText = currencyNode.textContent?.trim() || '';
                    const currencyMatch = currencyText.match(/-?\d+/);
                    if (currencyMatch) {
                        rewardCurrency = Number.parseInt(currencyMatch[0], 10);
                    }
                }
            }

            let rewardXp = 0;
            if (rewardsNode) {
                const xpNode = rewardsNode.getElementsByTagName('xp')[0] || rewardsNode.getElementsByTagName('experience')[0];
                if (xpNode) {
                    const xpText = xpNode.textContent?.trim() || '';
                    const xpMatch = xpText.match(/-?\d+/);
                    if (xpMatch) {
                        rewardXp = Number.parseInt(xpMatch[0], 10);
                    }
                }
            }

            const objectives = Array.from(questNode.getElementsByTagName('objective'))
                .map(node => {
                    const descriptionNode = node.getElementsByTagName('description')[0];
                    const description = descriptionNode ? descriptionNode.textContent?.trim() : node.textContent?.trim() || '';

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
                name: getText('name'),
                description: getText('description'),
                giver: getText('giver'),
                secretNotes: getText('secretNotes'),
                objectives,
                rewardItems: Array.from(new Set(rewardItems)),
                rewardCurrency,
                rewardXp
            };
        } catch (error) {
            console.warn('Failed to parse quest XML:', error.message);
            return null;
        }
    }

    static _generateQuestName(seed = '') {
        if (typeof seed === 'string' && seed.trim()) {
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
        if (typeof xmlContent !== 'string' || !xmlContent.trim()) {
            return null;
        }

        try {
            const doc = Utils.parseXmlDocument(xmlContent, 'text/xml');

            const parserError = doc.getElementsByTagName('parsererror')[0];
            if (parserError) {
                throw new Error(parserError.textContent || 'Unknown XML parsing error');
            }

            const npcNode = doc.getElementsByTagName('npc')[0];
            if (!npcNode) {
                return null;
            }

            const getText = tag => npcNode.getElementsByTagName(tag)[0]?.textContent?.trim() || '';

            const relativeLevelRaw = getText('relativeLevel');
            const relativeLevel = Number(relativeLevelRaw);
            const currencyRaw = getText('currency');
            const currency = Number(currencyRaw);

            const attributes = {};
            const attributeNodes = Array.from(npcNode.getElementsByTagName('attribute'));
            for (const node of attributeNodes) {
                const name = node.getAttribute('name') || node.getElementsByTagName('name')[0]?.textContent?.trim();
                if (!name) {
                    continue;
                }
                const valueNode = node.getElementsByTagName('value')[0];
                const textContent = valueNode ? valueNode.textContent : node.textContent;
                const value = textContent ? textContent.trim() : '';
                attributes[name] = value;
            }

            const personalityNode = npcNode.getElementsByTagName('personality')[0];
            const personality = personalityNode
                ? {
                    type: personalityNode.getElementsByTagName('type')[0]?.textContent?.trim() || '',
                    traits: personalityNode.getElementsByTagName('traits')[0]?.textContent?.trim() || '',
                    notes: personalityNode.getElementsByTagName('notes')[0]?.textContent?.trim() || ''
                }
                : null;

            const statusEffects = [];
            const statusParent = npcNode.getElementsByTagName('statusEffects')[0];
            if (statusParent) {
                const effectNodes = Array.from(statusParent.getElementsByTagName('effect'));
                for (const effectNode of effectNodes) {
                    const description = effectNode.getElementsByTagName('description')[0]?.textContent?.trim()
                        || effectNode.textContent?.trim()
                        || '';
                    if (!description) {
                        continue;
                    }
                    const durationText = effectNode.getElementsByTagName('duration')[0]?.textContent?.trim() || '';
                    const duration = Number(durationText);
                    statusEffects.push({
                        description,
                        duration: Number.isFinite(duration)
                            ? duration
                            : (durationText.toLowerCase() === 'permanent' ? null : durationText || null)
                    });
                }
            }

            const abilities = [];
            const abilitiesParent = npcNode.getElementsByTagName('abilities')[0];
            if (abilitiesParent) {
                const abilityNodes = Array.from(abilitiesParent.getElementsByTagName('ability'));
                for (const abilityNode of abilityNodes) {
                    const name = abilityNode.getElementsByTagName('name')[0]?.textContent?.trim();
                    if (!name) {
                        continue;
                    }
                    const description = abilityNode.getElementsByTagName('description')[0]?.textContent?.trim() || '';
                    const type = abilityNode.getElementsByTagName('type')[0]?.textContent?.trim() || '';
                    const levelRaw = abilityNode.getElementsByTagName('level')[0]?.textContent?.trim() || '';
                    const level = Number(levelRaw);
                    abilities.push({
                        name,
                        description,
                        type,
                        level: Number.isFinite(level) ? level : null
                    });
                }
            }

            const inventory = [];
            const inventoryParent = npcNode.getElementsByTagName('inventory')[0];
            if (inventoryParent) {
                const itemNodes = Array.from(inventoryParent.getElementsByTagName('item'));
                for (const itemNode of itemNodes) {
                    const itemName = itemNode.textContent?.trim();
                    if (itemName) {
                        inventory.push(itemName);
                    }
                }
            }

            return {
                name: getText('name') || null,
                description: getText('description') || '',
                shortDescription: getText('shortDescription') || '',
                role: getText('role') || '',
                class: getText('class') || '',
                race: getText('race') || '',
                relativeLevel: Number.isFinite(relativeLevel) ? relativeLevel : null,
                currency: Number.isFinite(currency) ? currency : null,
                personality,
                attributes,
                statusEffects,
                abilities,
                inventory
            };
        } catch (error) {
            console.warn('Failed to parse altered character XML:', error.message);
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
            ['terrible', 2],
            ['awful', 2],
            ['poor', 4],
            ['weak', 4],
            ['frail', 4],
            ['below average', 7],
            ['average', 10],
            ['mediocre', 10],
            ['above average', 13],
            ['strong', 13],
            ['tough', 13],
            ['excellent', 16],
            ['mighty', 16],
            ['heroic', 16],
            ['legendary', 19],
            ['mythic', 19]
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
        return Math.max(1, Math.min(20, Math.round(value)));
    }

    static _clampLevel(value, fallback = 1) {
        const base = Number.isFinite(value) ? value : (Number.isFinite(fallback) ? fallback : 1);
        return Math.max(1, Math.min(20, Math.round(base)));
    }

    static _clearLocationImage(location, generatedImages) {
        if (!location) {
            return;
        }
        const previousId = typeof location.imageId === 'string' ? location.imageId : null;
        if (previousId) {
            if (generatedImages instanceof Map) {
                generatedImages.delete(previousId);
            } else if (generatedImages && typeof generatedImages === 'object') {
                delete generatedImages[previousId];
            }
        }
        try {
            location.imageId = null;
        } catch (error) {
            // Ignore immutable setters
        }
    }

    static _resolveNpcBaseLevelReference({ npc, location = null, region = null }) {
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
        if (typeof generateItemsByNames !== 'function') {
            return Promise.reject(new Error('generateItemsByNames dependency is not configured.'));
        }

        const locationCandidate = this.resolveLocationCandidate(location) || location;
        return generateItemsByNames({ itemNames: names, location: locationCandidate, options });
    }

    static async _ensureItemsExist(rawNames = [], location = null, { allowObtained = false, recordNewItems = true } = {}) {
        if (!Array.isArray(rawNames) || !rawNames.length) {
            return [];
        }

        const names = [];
        for (const raw of rawNames) {
            if (typeof raw !== 'string') {
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
        }

        if (!names.length) {
            return [];
        }

        try {
            await this._generateItemsIntoWorld(names, location);
        } catch (error) {
            console.warn('Failed to generate items:', error.message);
            return [];
        }

        if (recordNewItems) {
            for (const name of names) {
                this.newItems.add(name);
            }
        }

        return names;
    }

    static _removeItemFromInventories(thing) {
        const { findActorById } = this._deps;
        const metadata = thing.metadata || {};
        if (metadata.ownerId && typeof findActorById === 'function') {
            const owner = findActorById(metadata.ownerId);
            if (owner && typeof owner.removeInventoryItem === 'function') {
                console.debug(`[consume_item] Removing ${thing.name || thing.id} from owner ${owner.name || owner.id}.`);
                owner.removeInventoryItem(thing);
            } else if (owner) {
                console.debug(`[consume_item] Owner ${owner.name || owner.id} lacks removeInventoryItem.`);
            } else {
                console.debug(`[consume_item] Owner with id ${metadata.ownerId} not found.`);
            }
        } else if (metadata.ownerId) {
            console.debug(`[consume_item] Cannot resolve owner ${metadata.ownerId} for ${thing.name || thing.id}.`);
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
        if (typeof thing.delete === 'function') {
            thing.delete();
        }
        const things = this.things;
        if (things instanceof Map) {
            things.delete(thing.id);
        } else if (Array.isArray(things)) {
            const index = things.findIndex(candidate => candidate?.id === thing.id);
            if (index >= 0) {
                things.splice(index, 1);
            }
        } else if (things && typeof things === 'object' && thing.id) {
            delete things[thing.id];
        }
    }

    static _estimateHealingAmount(magnitude, actor) {
        const max = Number(actor.maxHealth) || 10;
        switch ((magnitude || '').toLowerCase()) {
            case 'all':
                return Math.max(1, max);
            case 'large':
                return Math.max(1, Math.round(max * 0.75));
            case 'medium':
                return Math.max(1, Math.round(max * 0.5));
            default:
                return Math.max(1, Math.round(max * 0.25));
        }
    }

    static _severityToDamage(severity, context = {}) {
        const base = Number(context.location?.baseLevel) || Number(context.player?.level) || 1;
        const medium = Math.max(1, Math.round(8 + base * 2));
        if (severity === 'high') {
            return Math.round(medium * 1.75);
        }
        if (severity === 'low') {
            return Math.max(1, Math.round(medium * 0.25));
        }
        return medium;
    }

    static resolveLocationCandidate(candidate) {
        if (!candidate) {
            return null;
        }
        const { Location } = this._deps;
        if (typeof candidate === 'string' && Location && typeof Location.get === 'function') {
            try {
                return Location.get(candidate) || null;
            } catch (_) {
                return null;
            }
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
        if (!location || typeof location.removeThingId !== 'function') {
            return;
        }
        location.removeThingId(thing.id);
    }

    static cleanEventResponseText(text) {
        if (typeof text !== 'string') {
            return '';
        }
        return text.replace(/[\*\[\]]/g, '').trim();
    }

    static escapeHtml(text) {
        if (typeof text !== 'string') {
            return '';
        }
        return text.replace(/[&<>'"]/g, char => {
            switch (char) {
                case '&': return '&amp;';
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '"': return '&quot;';
                case '\'': return '&#39;';
                default: return char;
            }
        });
    }

    static logEventCheck({ systemPrompt, generationPrompt, responseText, label = null }) {
        const { fs, path, baseDir } = this._deps;
        if (!fs || !path || !baseDir) {
            return;
        }
        try {
            const logDir = path.join(baseDir, 'logs');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const suffix = label ? `_${label}` : '';
            const logPath = path.join(logDir, `event_checks_${timestamp}${suffix}.log`);
            const contents = [
                label ? `=== EVENT CHECK GROUP: ${label} ===` : '=== EVENT CHECK GROUP ===',
                '',
                '=== EVENT CHECK SYSTEM PROMPT ===',
                systemPrompt || '(none)',
                '',
                '=== EVENT CHECK GENERATION PROMPT ===',
                generationPrompt || '(none)',
                '',
                '=== EVENT CHECK RESPONSE ===',
                responseText || '(no response)',
                ''
            ].join('\n');
            fs.writeFileSync(logPath, contents, 'utf8');
        } catch (error) {
            console.warn('Failed to log event check:', error.message);
        }
    }

    static get config() {
        const { getConfig, config } = this._deps;
        if (typeof getConfig === 'function') {
            return getConfig();
        }
        return config || {};
    }

    static get currentPlayer() {
        const { getCurrentPlayer, currentPlayer } = this._deps;
        if (typeof getCurrentPlayer === 'function') {
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

    static _createPlaceholderThingForAlter(entry = {}, context = {}) {
        const { things } = this._deps;

        const candidateName = (typeof entry.newName === 'string' && entry.newName.trim())
            ? entry.newName.trim()
            : (typeof entry.originalName === 'string' && entry.originalName.trim() ? entry.originalName.trim() : null);

        if (!candidateName) {
            return null;
        }

        const description = entry.changeDescription && entry.changeDescription.trim()
            ? entry.changeDescription.trim()
            : `An item named ${candidateName}.`;

        const ownerCandidate = context.player && typeof context.player.addInventoryItem === 'function'
            ? context.player
            : null;

        let locationCandidate = context.location || null;
        if (!locationCandidate && ownerCandidate?.currentLocation) {
            locationCandidate = ownerCandidate.currentLocation;
        }

        const metadata = {};
        if (ownerCandidate && typeof ownerCandidate.id === 'string') {
            metadata.ownerId = ownerCandidate.id;
        } else {
            const resolvedLocation = this.resolveLocationCandidate(locationCandidate) || this.resolveLocationCandidate(this.currentPlayer?.currentLocation);
            if (resolvedLocation) {
                metadata.locationId = resolvedLocation.id;
                metadata.locationName = resolvedLocation.name || resolvedLocation.id;
            }
        }

        const thing = new Thing({
            name: candidateName,
            description,
            thingType: 'item',
            rarity: Thing.getDefaultRarityLabel(),
            metadata
        });

        if (things instanceof Map) {
            things.set(thing.id, thing);
        }

        if (metadata.ownerId && ownerCandidate) {
            try {
                ownerCandidate.addInventoryItem?.(thing);
            } catch (error) {
                console.warn(`Failed to add placeholder item ${candidateName} to owner:`, error.message);
            }
        } else if (metadata.locationId) {
            this.addThingToLocation(thing, metadata.locationId);
        }

        return thing;
    }
}

module.exports = Events;
