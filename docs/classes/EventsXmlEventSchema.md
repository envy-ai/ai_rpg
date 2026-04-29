# Events XML Event Schema

## Purpose

This is the informal XML schema for the default single-prompt event pipeline (`event_checks.use_xml: true`). The model reads one chat entry or prose segment and emits an `<events>` block. It is not an XSD document.

The XML element names use camelCase. Section headings use snake_case labels for readability; the XML examples show the exact tag names the model should emit.

## Top-Level Shape

The response is a flat chronological list of event elements. Travel is the only context boundary: a player/party travel event separates origin-context events from destination-context events.

```xml
<events>
  <!-- Zero or more event elements in the order they happened in the text. -->
</events>
```

Rules:

- Omit event tags when that event did not occur.
- Repeat event tags for multiple instances.
- If no player/party travel occurred, all event elements remain direct children of `<events>` and belong to the active location.
- The first `<moveLocation>` or `<moveNewLocation>` element is the travel boundary. Events before it happened at the origin; events after `<arriveAtLocation/>` happened after arrival at the destination. As such, it is important that events be listed in chronological order.
- Omit any events that occur chronologically between the beginning and end of travel. If such tags are emitted anyway, the processor ignores them.
- Do not emit more than one player/party travel event in a single `<events>` block.
- `newExitDiscovered` is a normal event and does not create a context boundary.
- Emit one element for each observed event. Downstream processing may aggregate compatible entries later.

## Travel Boundary

Travel boundary elements are direct children of `<events>`. Include at most one travel boundary element.

### `move_location`

Use this when the player or party physically travels to, or ends up in, a different existing location. Use it only for actual movement, not for talking about movement, considering movement, looking toward a route, or repositioning within the same fully visible scene.

```xml
<moveLocation>
  <destinationName>Exact full name of existing destination location</destinationName>
</moveLocation>
```

### `move_new_location`

Use this when the player or party physically moves into a destination that is not already a known connected location. Use it for newly entered rooms, newly reached nearby places, new regions, or large structures that should become regions. Do not use it for an exit that was merely discovered but not traveled through.

```xml
<moveNewLocation>
  <originDifference>What is different from the origin location</originDifference>
  <destinationName>Full new destination name</destinationName>
  <destinationKind>location|region|sublocation</destinationKind>
  <vehicleType>none OR vehicle type</vehicleType>
  <description>1-2 sentence destination description</description>
</moveNewLocation>
```

### `arrive_at_location`

Empty marker for the chronological point where arrival completes after a `moveLocation` or `moveNewLocation` boundary. This is required if you use `moveLocation` or `moveNewLocation`; do not use it without them. The processor throws a parse error for move-without-arrival, arrival-without-move, or multiple move boundaries.

```xml
<arriveAtLocation/>
```

## Normal Event Elements

Normal event elements are direct children of `<events>`.

### `new_exit_discovered`

Use this when the text reveals, unlocks, unblocks, creates, clears, finds out about, or otherwise discovers a route or vehicle connection to another location or region. Unlike movement tags, this does not mean the player traveled there. `newExitDiscovered` is not a travel context boundary. Omit `exitLocation` when the route is discovered at the current location; include it when the discovered exit starts somewhere else.

```xml
<newExitDiscovered>
  <destination>
    <locationName>Exact location name of the exit's destination. Omit if the exit is to a region.</locationName>
    <regionName>Exact region name of the exit's destination</regionName>
  </destination>
  <destinationKind>location|region</destinationKind>
  <vehicleType>none OR vehicle type, if this exit is a vehicle connection</vehicleType>
  <description>1-2 sentence destination or exit description</description>
  <exitLocation>
    <locationName>Exact location name where the exit starts</locationName>
    <regionName>Exact region name where the exit starts</regionName>
  </exitLocation>
  <travelTime>Exact duration, such as 30 minutes or 1 hour, from the exitLocation or current location</travelTime>
</newExitDiscovered>
```

### `alter_location`

Use this when the current location's visual or environmental description changes in a meaningful lasting way while the player remains there. This is not for travel from one location to another. If the location name still fits after the alteration, repeat the same name as `newLocationName`.

```xml
<alterLocation>
  <currentLocationName>Exact current location name</currentLocationName>
  <newLocationName>New name, or same name if unchanged</newLocationName>
  <changeDescription>One sentence alteration description</changeDescription>
</alterLocation>
```

### `currency`

Use this when the player gains currency, pays currency, or otherwise has currency directly added or removed. Currency is tracked separately from items, so do not represent money as `itemAppear`, `pickUpItem`, `consumeItem`, or `transferItem`.

```xml
<currency>
  <amount>Signed integer; positive gain, negative loss</amount>
</currency>
```

### `item_appear`

Use this when new tangible, carryable items appear in the scene for the first time, either newly created or newly described as present. Do not use this for scenery, harvestable resources, items merely moved from inventory, or crafted output already represented as an obtained item.

```xml
<itemAppear>
  <fullItemName>Exact new carryable item name</fullItemName>
  <quantity>Positive integer</quantity>
  <description>Brief item description</description>
</itemAppear>
```

### `scenery_appear`

Use this when new non-carryable scenery, furniture, buildings, workstations, containers, piles, or other scene fixtures appear for the first time. Do not use this for carryable items or harvestable resources that should use more specific tags.

```xml
<sceneryAppear>
  <sceneryName>Exact new scenery or non-carryable thing name</sceneryName>
  <description>Brief scenery description</description>
</sceneryAppear>
```

### `harvestable_resource_appear`

Use this when a new gatherable or harvestable resource appears in the scene, such as plants, mineral deposits, fields, machines that produce resources, or similar harvest nodes.

```xml
<harvestableResourceAppear>
  <resourceName>Exact harvestable resource or scenery name</resourceName>
  <description>Brief resource description</description>
</harvestableResourceAppear>
```

### `pick_up_item`

Use this when a character obtains one or more tangible carryable items by a method other than harvesting or gathering. Use `player` for the current player when appropriate. Do not use this for items consumed, altered, dropped, transferred, or harvested.

```xml
<pickUpItem>
  <actorName>Exact actor name, or player</actorName>
  <fullItemName>Exact item name</fullItemName>
  <quantity>Positive integer</quantity>
</pickUpItem>
```

### `drop_item`

Use this when a character drops, places, or sets down inventory items into the current scene. Do not use this for items being consumed, assembled into scenery, or used as ingredients in an event that should be represented by `consumeItem` or `alterItem`.

```xml
<dropItem>
  <actorName>Exact character name</actorName>
  <fullItemName>Exact item name</fullItemName>
  <quantity>Positive integer</quantity>
</dropItem>
```

### `transfer_item`

Use this when an item is handed, traded, or given from one actor to another. Do not use this for the player picking up loose scene items, dropping items, or creating new items.

```xml
<transferItem>
  <giverName>Exact giver character name</giverName>
  <fullItemName>Exact item name</fullItemName>
  <quantity>Positive integer</quantity>
  <receiverName>Exact receiver character name</receiverName>
</transferItem>
```

### `consume_item`

Use this when an item or scenery object is completely used up, destroyed, eaten, drunk, spent, aggregated, or assembled into something else. Do not use this for harvesting or gathering alone, and use `alterItem` instead when only a meaningful portion or state of the source changes.

```xml
<consumeItem>
  <fullItemName>Exact item or scenery name</fullItemName>
  <quantity>Positive integer</quantity>
  <reason>How it was consumed, destroyed, used up, or assembled</reason>
</consumeItem>
```

### `alter_item`

Use this when an item or scenery object is permanently changed in form, name, contents, condition, enchantment, upgrade state, or other durable physical state. Do not use this for being equipped, worn, moved, given, dropped, temporary effects, or full consumption.

```xml
<alterItem>
  <originalItemName>Exact item or scenery name before alteration</originalItemName>
  <quantity>Positive integer OR all</quantity>
  <newItemName>Exact new item name, or same name if unchanged</newItemName>
  <changeDescription>One sentence permanent alteration description</changeDescription>
</alterItem>
```

### `harvest_gather`

Use this when a character gathers resources from a natural or manufactured source such as a bush, vein, pile, crate, machine, or similar collection. This tag does not by itself mean the source was consumed or changed; use `consumeItem` or `alterItem` separately if the source is depleted or altered.

```xml
<harvestGather>
  <harvesterName>Exact actor name, or player</harvesterName>
  <fullItemName>Exact gathered item or resource name</fullItemName>
  <quantity>Positive integer</quantity>
  <sourceName>Exact source or resource thing name, if known</sourceName>
</harvestGather>
```

### `item_inflict`

Use this when an item is used on a target in a way that might cause a status effect, such as applying a bandage, reading a cursed object, injecting something, or otherwise using an item without necessarily ingesting it. The `statusEffect` field should briefly describe the observed effect. If the same item-target pair is represented by `itemIngest`, do not also emit `itemInflict` for the ingestion.

```xml
<itemInflict>
  <fullItemName>Exact item name</fullItemName>
  <targetName>Exact target character or entity name</targetName>
  <statusEffect>Observed status text</statusEffect>
</itemInflict>
```

### `item_ingest`

Use this when a character eats, drinks, swallows, inhales, or otherwise ingests an item. Use this even when the item is not fully consumed; use `consumeItem` separately if the item stack is actually used up.

```xml
<itemIngest>
  <fullItemName>Exact item name</fullItemName>
  <consumerName>Exact consumer character or entity name</consumerName>
</itemIngest>
```

### `item_to_npc`

Use this when an inanimate item or scenery object becomes an independent moving entity, such as a robot activating, a statue animating, or machinery becoming an actor. Use the source thing's exact current name and a new full NPC/entity name.

```xml
<itemToNpc>
  <sourceThingName>Exact original item or scenery name</sourceThingName>
  <npcName>Full new NPC or entity name</npcName>
  <description>5-10 word description of what happened</description>
</itemToNpc>
```

### `attack_damage`

Use this when an entity makes a physical attack that could cause damage to another entity. Shoving, grappling, buffs, debuffs, healing, or contact not intended to harm should not use this tag.

```xml
<attackDamage>
  <attackerName>Exact attacker name</attackerName>
  <targetName>Exact target name</targetName>
</attackDamage>
```

### `alter_npc`

Use this for significant lasting changes to an animate entity, especially physical transformation or other major changes not covered by ordinary attack damage. Do not use this for the player/self. Temporary magical polymorphs, reversible petrification, or other temporary conditions usually belong in `statusEffectChange`.

```xml
<alterNpc>
  <npcName>Exact character or entity name</npcName>
  <alterationCategory>injury|status effect|gear|attire|mental change|temporary physical change|physical transformation</alterationCategory>
  <changeDescription>1-2 sentence alteration description</changeDescription>
</alterNpc>
```

### `status_effect_change`

Use this when an animate entity gains or loses a temporary status effect that is not already represented as a permanent NPC alteration. Use `gained` for new effects and `lost` only when an existing listed status effect goes away. If the effect came from an item use or ingestion, prefer `itemInflict` or `itemIngest` instead of duplicating the same change here.

```xml
<statusEffectChange>
  <entityName>Exact character or entity name</entityName>
  <statusEffectName>Exact status effect name or detail</statusEffectName>
  <action>gained|lost</action>
  <level>Integer level, only when gained</level>
</statusEffectChange>
```

### `npc_arrival_departure`

Use this when an animate entity arrives at the current location from elsewhere, newly appears in the scene, or leaves the scene for another destination. For departures, include the best-known destination region and location. Do not use this for party members simply remaining with the player.

```xml
<npcArrivalDeparture>
  <npcName>Exact NPC or entity name</npcName>
  <action>arrived|left</action>
  <destinationRegion>Destination region, if leaving</destinationRegion>
  <destinationLocation>Destination location, if leaving</destinationLocation>
</npcArrivalDeparture>
```

### `npc_first_appearance`

Use this as a catch-all for physically present entities mentioned or acting in the checked text that are not already known to the system. Do not include entities only mentioned in dialogue, on a phone, on a screen, through a vision, or otherwise not physically present at the location.

```xml
<npcFirstAppearance>
  <npcName>Exact physically present entity name</npcName>
</npcFirstAppearance>
```

### `party_change`

Use this when a physically present NPC begins willingly accompanying, leading, following, or otherwise joining the player party, or stops doing so. Do not use this for casual cooperation unless the NPC is actually accompanying the player.

```xml
<partyChange>
  <npcName>Exact NPC name</npcName>
  <action>joined|left</action>
</partyChange>
```

### `environmental_status_damage`

Use this when an animate entity takes damage or healing from the environment or from an ongoing status effect, rather than from an ordinary direct attack. Examples include fire, poison gas, drowning, extreme cold, lingering acid, or a regeneration aura.

```xml
<environmentalStatusDamage>
  <actorName>Exact character or entity name</actorName>
  <effect>damage|healing</effect>
  <severity>low|medium|high</severity>
  <reason>One sentence reason</reason>
</environmentalStatusDamage>
```

### `heal_recover`

Use this when a character recovers health from rest, treatment, food, magic, medicine, regeneration, or another non-environmental healing source. Use a larger magnitude for stronger or more complete recovery.

```xml
<healRecover>
  <characterName>Exact healed character name</characterName>
  <magnitude>small|medium|large|all</magnitude>
  <reason>Reason or healing source</reason>
</healRecover>
```

### `hostile_to_friendly`

Use this when an NPC or entity that was hostile or unfriendly to the player becomes neutral, friendly, allied, or otherwise no longer hostile. Use `dispositionCheck` for ordinary attitude shifts that do not clearly end hostility.

```xml
<hostileToFriendly>
  <npcName>Exact NPC or entity name</npcName>
  <previousDisposition>Previous disposition text</previousDisposition>
  <newDisposition>New disposition text</newDisposition>
  <reason>One sentence reason</reason>
</hostileToFriendly>
```

### `death_incapacitation`

Use this when an entity dies or becomes incapacitated. Use `dead` only when the entity is actually killed; use `incapacitated` when they are unconscious, disabled, defeated nonlethally, or otherwise unable to act but not dead.

```xml
<deathIncapacitation>
  <actorName>Exact character or entity name</actorName>
  <outcome>dead|incapacitated</outcome>
</deathIncapacitation>
```

### `in_combat`

Use this to indicate whether the player should currently be considered in physical combat, even if the player did not personally attack during the text.

```xml
<inCombat>
  <value>true|false</value>
</inCombat>
```

### `received_quest`

Use this when the player becomes aware of a quest, task, promise, self-imposed goal, request, or job this turn, even if they have not explicitly accepted it yet. Include quests the player invents for themselves or agrees to do.

```xml
<receivedQuest>
  <giverName>Exact quest giver name, if any</giverName>
  <summary>One sentence quest or task summary</summary>
</receivedQuest>
```

### `completed_quest_objective`

Use this when a listed player quest objective is completed. Use the quest and objective indexes from the prompt, and include a short reason explaining why the objective is complete.

```xml
<completedQuestObjective>
  <questIndex>1-based quest index from prompt</questIndex>
  <objectiveIndex>1-based objective index from prompt</objectiveIndex>
  <statusReason>Brief reason objective is complete</statusReason>
</completedQuestObjective>
```

### `defeated_enemy`

Use this when the player defeats one or more enemies during the turn. Do not use this for enemies merely damaged, delayed, escaped from, intimidated, or bypassed.

```xml
<defeatedEnemy>
  <enemyName>Exact defeated enemy name</enemyName>
</defeatedEnemy>
```

### `experience_check`

Use this when the player does something, other than defeating an enemy, that should grant experience because of their own action, growth, learning, or accomplishment. Do not use this for things that merely happened to the player or for enemy defeats already covered by `defeatedEnemy`.

```xml
<experienceCheck>
  <amount>Integer from 1-100 before scaling</amount>
  <reason>One sentence XP reason</reason>
</experienceCheck>
```

### `faction_reputation_change`

Use this when the player's reputation with a faction should significantly increase or decrease because of their own actions or witnessed events. Use `a little` for modest reputation shifts and `a lot` for major shifts. Omit very minor changes that would not meaningfully affect how the faction treats the player.

```xml
<factionReputationChange>
  <factionName>Exact faction name</factionName>
  <direction>increase|decrease</direction>
  <magnitude>a little|a lot</magnitude>
  <reason>One sentence reason</reason>
</factionReputationChange>
```

### `disposition_check`

Use this when an NPC's disposition toward the current player changes significantly. If the NPC's attitude did not meaningfully change, omit the tag.

```xml
<dispositionCheck>
  <npcName>Exact NPC name</npcName>
  <before>How they felt before</before>
  <after>How they feel now</after>
  <reason>One sentence reason</reason>
</dispositionCheck>
```

### `needbar_change`

Use this when something in the turn changes a need bar for the player, party member, or NPC. Choose the magnitude from the need-bar definitions and the concrete situation. Omit unchanged need bars.

```xml
<needBarChange>
  <characterName>Exact character name</characterName>
  <needBarId>Exact need bar id</needBarId>
  <direction>increase|decrease</direction>
  <magnitude>small|medium|large|all|full|empty</magnitude>
  <reason>10 words or less</reason>
</needBarChange>
```

### `time_passed`

Use this to report how much elapsed in-world wall-clock time the concrete non-travel actions in the text realistically consumed. Estimate elapsed wall-clock time, not reading time and not the sum of each participant's labor when characters work in parallel. If the player travels by exit/route or the XML block includes `<moveLocation>`/`<moveNewLocation>`, use `0` here because travel time is resolved from the route or exit instead. Use `0` when nothing non-travel and time-consuming happened.

```xml
<timePassed>
  <reasoning>Brief breakdown of time-consuming actions</reasoning>
  <duration>Exact duration, or 0</duration>
</timePassed>
```

### `triggered_abilities`

Use this when a character's triggered ability fires during the turn. Include only abilities that actually triggered, not abilities that were merely available, discussed, or considered.

```xml
<triggeredAbility>
  <characterName>Exact character name</characterName>
  <abilityName>Exact ability name</abilityName>
</triggeredAbility>
```
