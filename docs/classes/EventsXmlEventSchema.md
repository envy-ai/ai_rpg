# Events XML Event Schema

## Purpose

This is an informal XML schema for a planned second event pipeline. It describes a single-prompt response format where the model reads one chat entry or prose segment and emits an `<events>` block. It is not an XSD document and does not describe the currently active grouped numbered event-check prompts.

The XML element names use camelCase. Existing `Events.js` event keys are noted in headings for mapping back to the current parser and handler pipeline.

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
- If no player/party travel occurred, all event elements remain direct children of `<events>` and are applied in the current location context.
- The first `<moveLocation>` or `<moveNewLocation>` element is the travel boundary. Events before it apply in the origin context; events after it apply in the destination context after movement succeeds and location context refreshes. As such, it's important that events be listed in chronological order.
- Omit any events that occur chronologically between the beginning or end of travel.
- More than one player/party travel event in a single `<events>` block should be treated as a validation error for this planned pipeline.
- `newExitDiscovered` is a normal event and does not create a context boundary.
- Inside each context partition, translate XML into the existing parsed event payloads and keep the current handler ordering for dependency safety.

## Travel Boundary

Travel boundary elements are direct children of `<events>`. Include at most one travel boundary element.

### `move_location`

```xml
<moveLocation>
  <destinationName>Exact full name of existing destination location</destinationName>
</moveLocation>
```

### `move_new_location`

```xml
<moveNewLocation>
  <originDifference>What is different from the origin location</originDifference>
  <destinationName>Full new destination name</destinationName>
  <destinationKind>location|region|sublocation</destinationKind>
  <vehicleType>none OR vehicle type</vehicleType>
  <description>1-2 sentence destination description</description>
</moveNewLocation>
```

## Normal Event Elements

Normal event elements are direct children of `<events>`.

### `new_exit_discovered`

```xml
<newExitDiscovered>
  <destinationName>Full destination location or region name</destinationName>
  <destinationKind>location|region</destinationKind>
  <vehicleType>none OR vehicle type</vehicleType>
  <description>1-2 sentence destination or exit description</description>
  <travelTime>Exact duration, such as 30 minutes or 1 hour</travelTime>
</newExitDiscovered>
```

### `alter_location`

```xml
<alterLocation>
  <currentLocationName>Exact current location name</currentLocationName>
  <newLocationName>New name, or same name if unchanged</newLocationName>
  <changeDescription>One sentence alteration description</changeDescription>
</alterLocation>
```

### `currency`

```xml
<currency>
  <amount>Signed integer; positive gain, negative loss</amount>
</currency>
```

### `item_appear`

```xml
<itemAppear>
  <fullItemName>Exact new carryable item name</fullItemName>
  <quantity>Positive integer</quantity>
  <description>Brief item description</description>
</itemAppear>
```

### `scenery_appear`

```xml
<sceneryAppear>
  <sceneryName>Exact new scenery or non-carryable thing name</sceneryName>
  <description>Brief scenery description</description>
</sceneryAppear>
```

### `harvestable_resource_appear`

```xml
<harvestableResourceAppear>
  <resourceName>Exact harvestable resource or scenery name</resourceName>
  <description>Brief resource description</description>
</harvestableResourceAppear>
```

### `pick_up_item`

```xml
<pickUpItem>
  <actorName>Exact actor name, or player</actorName>
  <fullItemName>Exact item name</fullItemName>
  <quantity>Positive integer</quantity>
</pickUpItem>
```

### `drop_item`

```xml
<dropItem>
  <actorName>Exact character name</actorName>
  <fullItemName>Exact item name</fullItemName>
  <quantity>Positive integer</quantity>
</dropItem>
```

### `transfer_item`

```xml
<transferItem>
  <giverName>Exact giver character name</giverName>
  <fullItemName>Exact item name</fullItemName>
  <quantity>Positive integer</quantity>
  <receiverName>Exact receiver character name</receiverName>
</transferItem>
```

### `consume_item`

```xml
<consumeItem>
  <fullItemName>Exact item or scenery name</fullItemName>
  <quantity>Positive integer</quantity>
  <reason>How it was consumed, destroyed, used up, or assembled</reason>
</consumeItem>
```

### `alter_item`

```xml
<alterItem>
  <originalItemName>Exact item or scenery name before alteration</originalItemName>
  <quantity>Positive integer OR all</quantity>
  <newItemName>Exact new item name, or same name if unchanged</newItemName>
  <changeDescription>One sentence permanent alteration description</changeDescription>
</alterItem>
```

### `harvest_gather`

```xml
<harvestGather>
  <harvesterName>Exact actor name, or player</harvesterName>
  <fullItemName>Exact gathered item or resource name</fullItemName>
  <quantity>Positive integer</quantity>
  <sourceName>Exact source or resource thing name, if known</sourceName>
</harvestGather>
```

### `item_inflict`

```xml
<itemInflict>
  <fullItemName>Exact item name</fullItemName>
  <targetName>Exact target character or entity name</targetName>
  <statusEffect>Observed status text</statusEffect>
</itemInflict>
```

The current handler ignores the prompt-provided status text and applies the item's configured target effect when available.

### `item_ingest`

```xml
<itemIngest>
  <fullItemName>Exact item name</fullItemName>
  <consumerName>Exact consumer character or entity name</consumerName>
</itemIngest>
```

### `item_to_npc`

```xml
<itemToNpc>
  <sourceThingName>Exact original item or scenery name</sourceThingName>
  <npcName>Full new NPC or entity name</npcName>
  <description>5-10 word description of what happened</description>
</itemToNpc>
```

### `attack_damage`

```xml
<attackDamage>
  <attackerName>Exact attacker name</attackerName>
  <targetName>Exact target name</targetName>
</attackDamage>
```

This event is tracked and summarized, but direct damage is resolved by the attack system.

### `alter_npc`

```xml
<alterNpc>
  <npcName>Exact character or entity name</npcName>
  <alterationCategory>injury|status effect|gear|attire|mental change|temporary physical change|physical transformation</alterationCategory>
  <changeDescription>1-2 sentence alteration description</changeDescription>
</alterNpc>
```

### `status_effect_change`

```xml
<statusEffectChange>
  <entityName>Exact character or entity name</entityName>
  <statusEffectName>Exact status effect name or detail</statusEffectName>
  <action>gained|lost</action>
  <level>Integer level, only when gained</level>
</statusEffectChange>
```

### `npc_arrival_departure`

```xml
<npcArrivalDeparture>
  <npcName>Exact NPC or entity name</npcName>
  <action>arrived|left</action>
  <destinationRegion>Destination region, if leaving</destinationRegion>
  <destinationLocation>Destination location, if leaving</destinationLocation>
</npcArrivalDeparture>
```

### `npc_first_appearance`

```xml
<npcFirstAppearance>
  <npcName>Exact physically present entity name</npcName>
</npcFirstAppearance>
```

### `party_change`

```xml
<partyChange>
  <npcName>Exact NPC name</npcName>
  <action>joined|left</action>
</partyChange>
```

### `environmental_status_damage`

```xml
<environmentalStatusDamage>
  <actorName>Exact character or entity name</actorName>
  <effect>damage|healing</effect>
  <severity>low|medium|high</severity>
  <reason>One sentence reason</reason>
</environmentalStatusDamage>
```

### `heal_recover`

```xml
<healRecover>
  <characterName>Exact healed character name</characterName>
  <magnitude>small|medium|large|all</magnitude>
  <reason>Reason or healing source</reason>
</healRecover>
```

### `hostile_to_friendly`

```xml
<hostileToFriendly>
  <npcName>Exact NPC or entity name</npcName>
  <previousDisposition>Previous disposition text</previousDisposition>
  <newDisposition>New disposition text</newDisposition>
  <reason>One sentence reason</reason>
</hostileToFriendly>
```

### `death_incapacitation`

```xml
<deathIncapacitation>
  <actorName>Exact character or entity name</actorName>
  <outcome>dead|incapacitated</outcome>
</deathIncapacitation>
```

### `in_combat`

```xml
<inCombat>
  <value>true|false</value>
</inCombat>
```

### `received_quest`

```xml
<receivedQuest>
  <giverName>Exact quest giver name, if any</giverName>
  <summary>One sentence quest or task summary</summary>
</receivedQuest>
```

### `completed_quest_objective`

```xml
<completedQuestObjective>
  <questIndex>1-based quest index from prompt</questIndex>
  <objectiveIndex>1-based objective index from prompt</objectiveIndex>
  <statusReason>Brief reason objective is complete</statusReason>
</completedQuestObjective>
```

### `defeated_enemy`

```xml
<defeatedEnemy>
  <enemyName>Exact defeated enemy name</enemyName>
</defeatedEnemy>
```

### `experience_check`

```xml
<experienceCheck>
  <amount>Integer from 1-100 before scaling</amount>
  <reason>One sentence XP reason</reason>
</experienceCheck>
```

### `faction_reputation_change`

```xml
<factionReputationChange>
  <factionName>Exact faction name</factionName>
  <direction>increase|decrease</direction>
  <magnitude>a little|a lot</magnitude>
  <reason>One sentence reason</reason>
</factionReputationChange>
```

### `disposition_check`

```xml
<dispositionCheck>
  <npcName>Exact NPC name</npcName>
  <before>How they felt before</before>
  <after>How they feel now</after>
  <reason>One sentence reason</reason>
</dispositionCheck>
```

### `needbar_change`

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

```xml
<timePassed>
  <reasoning>Brief breakdown of time-consuming actions</reasoning>
  <duration>Exact duration, or 0</duration>
</timePassed>
```

### `triggered_abilities`

```xml
<triggeredAbility>
  <characterName>Exact character name</characterName>
  <abilityName>Exact ability name</abilityName>
</triggeredAbility>
```
