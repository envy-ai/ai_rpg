# Events XML Event Schema

## Purpose

This is the informal XML schema for the default single-prompt event pipeline (`event_checks.use_xml: true`). The model reads one chat entry or prose segment and emits an `<events>` block. It is not an XSD document. `Events.js` requires a parseable `<events>...</events>` block and extracts it even when the model wraps the block in markdown fences.

The same schema drives the staged tiny-brain variant (`ai.tinybrain: true`), but TinyBrain does not ask for a monolithic chronological block. `prompts/_includes/events-xml.tinybrain.njk` asks category-specific questions for one explicit prose section (`CURRENT`, `ORIGIN`, `BETWEEN`, `DESTINATION`, or tracker-only), validates each `<events>` fragment at its own checkpoint, and locally assembles the accepted fragments into the single `<events>` block described here. An empty TinyBrain category uses `<events><done/></events>`; the parser strips that sole sentinel rather than assembling it as an event, and still accepts the older bare `<done/>` form. A wrapped sentinel mixed with events or used where required tags are missing is rejected. `BETWEEN` permits only `thingMoveWithCharacter`; authoritative player-action movement is never regenerated as event XML. Both templates share this schema text via `prompts/_includes/events-xml-schema.njk`. In staged rendering, the schema omits the one-shot global-required annotations from `inCombat` and `anyQuestObjectivesCompleted`; only the final ordinary-event checkpoint marks those tags required.

The XML element names use camelCase. Section headings use snake_case labels for readability; the XML examples show the exact tag names the model should emit. Unknown built-in tags throw parse errors unless an enabled mod has registered the tag.

## Top-Level Shape

The response is a flat chronological list of event elements. Travel is the only context boundary: a player/party travel event separates origin-context events from destination-context events.

```xml
<events>
  <!-- Zero or more event elements in the order they happened in the text. -->
</events>
```

Rules:

- Omit event tags when that event did not occur, except required state/signal fields such as `inCombat` and `anyQuestObjectivesCompleted`, which report `false` when inactive.
- Repeat event tags for multiple instances.
- If no player/party travel occurred, all event elements remain direct children of `<events>` and belong to the active location.
- The first `<moveLocation>` or `<moveNewLocation>` element is the travel boundary. Events before it happened at the origin; events after `<arriveAtLocation/>` happened after arrival at the destination. List events in chronological order.
- Omit any events that occur chronologically between the beginning and end of travel. If such tags are emitted anyway, the processor ignores them, except `thingMoveWithCharacter`, which is deferred to the after-arrival phase so objects carried, driven, or otherwise moved with a character can land at the character's destination.
- Do not emit more than one player/party travel event in a single `<events>` block.
- `newExitDiscovered` is a normal event and does not create a context boundary.
- Emit one element for each observed event. Downstream processing may aggregate compatible entries later.
- Callers can supply ignored event keys. The prompt tells the model not to emit those categories, and the parser hard-removes matching keys if they appear anyway. `npc_arrival` / `npc_departure` normalize to `npc_arrival_departure`; `thing_arrival` / `thing_departure` normalize to `thing_arrival_departure`.

## Registered Mod Event Elements

Enabled mods can inject additional event tags into the prompt schema through `ModExtensionRegistry.registerXmlEvent(...)`. The prompt renders each registered schema's `name`, `description`, and XML example after the core top-level rules. Registered mod tags should be emitted only when the prose explicitly supports the mod event.

The parser looks up registered tag names case-insensitively, converts the tag's direct child XML into a JSON-shaped raw payload, runs the registered parser under the registered `eventKey`, and applies the registered handler through the same event outcome pipeline as built-in tags. Repeated child tag names become arrays. Duplicate XML tags or event keys fail during mod registration.

Bundled mod examples include `<implantEquipped>` / `<implantUnequipped>`, `<moduleInstalled>` / `<moduleRemoved>`, and `<spellLearned>` / `<spellCast>` when those mods are enabled.

## Travel Boundary

Travel boundary elements are direct children of `<events>`. Include at most one travel boundary element.

### `move_location`

Use this when the player or party physically travels to, or ends up in, a different existing location. Use it only for actual movement, not for talking about movement, considering movement, looking toward a route, or repositioning within the same fully visible scene. When the current location is a vehicle, do not infer that the player deboards just because the vehicle has reached its destination; the checked text must say the player deboarded.

```xml
<moveLocation>
  <destinationName>Exact full name of existing destination location</destinationName>
</moveLocation>
```

### `move_new_location`

Use this when the player or party physically moves into a destination that is not already a known connected location. Use it for newly entered rooms, newly reached nearby places, new regions, or large structures that should become regions. Do not use it for an exit that was merely discovered but not traveled through. When the current location is a vehicle, do not infer that the player deboards just because the vehicle has reached its destination; the checked text must say the player deboarded.

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

Use this when the text reveals, unlocks, unblocks, creates, clears, finds out about, or otherwise identifies a route or vehicle connection to another location or region that is not already represented in the current location XML. Unlike movement tags, this does not mean the player traveled there. `newExitDiscovered` is not a travel context boundary. Do not use it for travel that occurred without a route discovery.

Omit `origin` when the route is discovered at the current location; include it when the discovered exit starts somewhere else. If `destinationType` is `region`, still include a concrete destination location name when the text provides or implies one; the handler uses the region as the wiring target while summaries can display the specific destination location. If `destinationType` is `location` and `destinationHasNewExits` is `true`, the parser promotes `locationName` into the region target/name and clears the destination location field before handling. `travelTime` should be a concrete nonzero duration from the exit origin.

```xml
<newExitDiscovered>
  <destination>
    <regionName>Exact region name of the exit's destination</regionName>
    <locationName>Exact location name of the exit's destination, including for region exits when known or implied</locationName>
  </destination>
  <destinationType>location|region</destinationType>
  <destinationHasNewExits>true|false</destinationHasNewExits>
  <vehicleType>none OR vehicle type, if this exit is a vehicle connection</vehicleType>
  <description>1-2 sentence destination or exit description</description>
  <origin>
    <locationName>Exact location name where the exit starts</locationName>
    <regionName>Exact region name where the exit starts</regionName>
  </origin>
  <travelTime>Exact duration, such as 30 minutes or 1 hour, from the origin or current location</travelTime>
</newExitDiscovered>
```

### `alter_location`

Use this when the current location's visual or environmental description changes in a meaningful lasting way while the player remains there. Ephemeral lighting or mood shifts usually do not qualify. This is not for travel from one location to another, and not for item or scenery movement; use `thingMoveWithCharacter`, `thingArrival`, or `thingDeparture` for movement of existing things. If the location name still fits after the alteration, repeat the same name as `newLocationName`.

```xml
<alterLocation>
  <currentLocationName>Exact current location name</currentLocationName>
  <newLocationName>New name, or same name if unchanged</newLocationName>
  <changeDescription>One sentence alteration description</changeDescription>
</alterLocation>
```

### `mystery_box_mention`

Use this when the text introduces or materially expands a significant unresolved mystery, hidden offscreen actor, secret motive, conspiracy, unexplained artifact, suspicious discrepancy, or private background thread that may matter later. This does not reveal anything to the player by itself. It triggers a separate private continuity prompt that creates or updates a persisted `MysteryBox`.

Do not emit this for every unanswered question, ordinary flavor detail, routine clue, or player speculation. Use it when future scenes would benefit from a stable hidden truth or motive instead of improvising vague mystery later.

```xml
<mysteryBoxMention>
  <name>Short stable name for the mystery, actor, clue, or thread</name>
  <context>One sentence describing what was introduced or expanded in this text</context>
</mysteryBoxMention>
```

### `currency`

Use this when the player gains currency, pays currency, or otherwise has currency directly increased or decreased. Currency is tracked separately from items, so do not represent money as `itemAppear`, `pickUpItem`, `consumeItem`, or `transferItem`.

```xml
<currency>
  <amount>Signed integer; positive gain, negative loss</amount>
</currency>
```

### `item_appear`

Use this when new tangible, carryable items appear in the scene for the first time, either newly created or newly described as present. Do not use this for scenery, harvestable resources, items merely moved from inventory, or crafted output already represented as an obtained item.

If an exact same-name carryable item stack is already present in the current scene, the handler increments that stack by `<quantity>` instead of creating a duplicate stack.

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

Use this when a character obtains one or more tangible carryable items by a method other than harvesting or gathering. Use `player` for the current player when appropriate. Do not use this for items consumed, altered, dropped, transferred, or harvested. Multiple actors may each pick up the same item name when enough loose copies or stack quantity exists; exact duplicate actor/item/quantity rows in the same event batch are warning-skipped.

```xml
<pickUpItem>
  <actorName>Exact actor name, or player</actorName>
  <fullItemName>Exact item name</fullItemName>
  <quantity>Positive integer</quantity>
</pickUpItem>
```

### `put_item_in_container`

Use this when a character puts one or more item stacks into an existing container, such as a bag, chest, box, crate, locker, or similar container. Use `player` for the current player when appropriate. If no character is named, the handler takes matching loose items from the current location. The container must already exist and be marked as a container; this event does not generate missing items or containers.

```xml
<putItemInContainer>
  <character>Exact character, or player; omit when moving a loose current-location item</character>
  <fullItemName>Exact item name</fullItemName>
  <quantity>Positive integer</quantity>
  <containerName>Exact container name</containerName>
</putItemInContainer>
```

### `remove_item_from_container`

Use this when a character takes one or more item stacks out of an existing container. Use `player` for the current player when appropriate. If no character is named, the handler moves the item into the current location. If the container does not already list enough direct matching contents, the handler generates the missing shortfall into the container before removing it. Nested containers are not searched.

```xml
<removeItemFromContainer>
  <character>Exact character, or player; omit to place the item in the current location</character>
  <fullItemName>Exact item name</fullItemName>
  <quantity>Positive integer</quantity>
  <containerName>Exact container name</containerName>
</removeItemFromContainer>
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

Use this when an item is handed, traded, or given from one actor to another. The handler resolves the giver's inventory first, can use a matching unowned item in the current location when a loose scene object is being handed over, and creates any missing shortfall before giving it to the receiver. Do not use this for the player picking up loose scene items without a giver, dropping items, or items merely appearing in the scene.

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

If a fully consumed target is a container, the handler first moves any instantiated contents to the consumed container's current holder or location, then deletes the container. Pending `containerContents` seeds are not generated by this destruction path.

```xml
<consumeItem>
  <fullItemName>Exact item or scenery name</fullItemName>
  <quantity>Positive integer</quantity>
  <reason>How it was consumed, destroyed, used up, or assembled</reason>
</consumeItem>
```

### `alter_item`

Use this when an item or scenery object is permanently altered in form, name, contents, condition, enchantment, upgrade state, or other durable physical state. Do not use this for being equipped, worn, moved, given, dropped, temporary effects, or full consumption.

```xml
<alterItem>
  <originalItemName>Exact item or scenery name before alteration</originalItemName>
  <quantity>Positive integer OR all</quantity>
  <newItemName>Exact new item name, or same name if unchanged</newItemName>
  <changeDescription>One sentence permanent alteration description</changeDescription>
</alterItem>
```

### `harvest_gather`

Use this when a character gathers resources from a natural or manufactured source such as a bush, vein, pile, crate, machine, or similar collection. This tag does not by itself mean the source was consumed or altered; use `consumeItem` or `alterItem` separately if the source is depleted or altered.

```xml
<harvestGather>
  <harvesterName>Exact actor name, or player</harvesterName>
  <fullItemName>Exact gathered item or resource name</fullItemName>
  <quantity>Positive integer</quantity>
  <sourceName>Exact source or resource thing name, if known</sourceName>
</harvestGather>
```

### `item_inflict`

Use this when an item is used on a target in a way that might cause a status effect, such as applying a bandage, reading a cursed object, injecting something, or otherwise using an item without necessarily ingesting it. The `statusEffect` field should briefly describe the observed effect so the entry parses, but the handler applies the item's configured target status effect (`causeStatusEffectOnTarget`) when available. If the same item-target pair is represented by `itemIngest`, do not also emit `itemInflict` for the ingestion.

```xml
<itemInflict>
  <fullItemName>Exact item name</fullItemName>
  <targetName>Exact target character or entity name</targetName>
  <statusEffect>Observed status text</statusEffect>
</itemInflict>
```

### `item_ingest`

Use this when a character eats, drinks, swallows, inhales, or otherwise ingests an item. Use this even when the item is not fully consumed; use `consumeItem` separately if the item stack is actually used up. The handler infers any applied status effect from the ingested item's configured target effect and suppresses duplicate same item-target `itemInflict` entries in the same batch.

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

Use this when an animate entity gains or loses a temporary status effect that is not already represented as a permanent NPC alteration. Use `gained` for new effects and `lost` only when an existing listed status effect goes away. If the effect came from an item use or ingestion, prefer `itemInflict` or `itemIngest` instead of duplicating the same change here. Lost effects are removed by exact effect name or exact description. Gained effects that duplicate same-turn item-triggered effects are skipped.

```xml
<statusEffectChange>
  <entityName>Exact character or entity name</entityName>
  <statusEffectName>Exact status effect name or detail</statusEffectName>
  <action>gained|lost</action>
  <level>Integer level, only when gained</level>
</statusEffectChange>
```

### `npc_arrival`

Use this when an animate entity arrives at the current location from elsewhere, or newly appears in the scene. Set `hideFromPlayer` only when a living NPC is actively trying to arrive unnoticed; this marks them hidden until the player detects them through the normal opposed check. Dead NPCs/corpses are always visible.

```xml
<npcArrival>
  <npcName>Exact NPC or entity name</npcName>
  <hideFromPlayer>true|false</hideFromPlayer>
</npcArrival>
```

### `npc_departure`

Use this when an animate entity leaves the scene for another destination. Include a concrete best-known destination region and destination location. The destination must not be `unknown`, blank, or the current location; if the exact destination is not established, choose the most plausible concrete region and location so the character can be tracked offscreen. If a party member stops accompanying the player and goes to a destination, use this event so they can leave the party before moving there. Do not use this for party members simply remaining with the player. Set `hideFromPlayer` only when a living NPC is trying to remain hidden after moving. Dead NPCs/corpses are always visible.

```xml
<npcDeparture>
  <npcName>Exact NPC or entity name</npcName>
  <destinationRegion>Destination region</destinationRegion>
  <destinationLocation>Destination location</destinationLocation>
  <hideFromPlayer>true|false</hideFromPlayer>
</npcDeparture>
```

### `reveal_hidden_npc`

Use this when narration says the player could notice, expose, discover, or otherwise reveal a currently hidden living NPC. The handler ignores the event if that NPC is not hidden or is dead. `useOpposedCheck` defaults to `true`; a failed opposed check leaves the NPC hidden. Use `false` when the NPC willingly reveals themself or the narration plainly makes them visible without a check.

```xml
<revealHiddenNpc>
  <npcName>Exact hidden NPC or entity name</npcName>
  <description>One sentence reason the NPC might be revealed</description>
  <useOpposedCheck>true|false</useOpposedCheck>
</revealHiddenNpc>
```

### `hide_visible_npc`

Use this when a visible living NPC actively tries to hide, slip away into cover, blend into a crowd, or otherwise become hidden from the player. This always uses an opposed hide/perception check. Dead NPCs/corpses are ignored because they are always visible.

```xml
<hideVisibleNpc>
  <npcName>Exact visible NPC or entity name</npcName>
  <description>One sentence reason the NPC might become hidden</description>
</hideVisibleNpc>
```

### `thing_arrival`

Use this only when an existing, non-animate item or scenery object arrives at the current location from elsewhere. Do not use this for new items or scenery that appear in the scene for the first time; use `itemAppear` or `sceneryAppear` instead. Do not use this for animate entities; use `npcArrival` instead.

```xml
<thingArrival>
  <thingName>Exact thing name</thingName>
</thingArrival>
```

### `thing_departure`

Use this when an existing, non-animate item or scenery object leaves the scene for another destination without being picked up, dropped, transferred, consumed, destroyed, or animated into an NPC. Include a concrete best-known destination region and destination location. The destination must not be `unknown`, blank, or the current location; if the exact destination is not established, choose the most plausible concrete region and location so the thing can be tracked offscreen.

```xml
<thingDeparture>
  <thingName>Exact thing name</thingName>
  <destinationRegion>Destination region</destinationRegion>
  <destinationLocation>Destination location</destinationLocation>
</thingDeparture>
```

### `thing_move_with_character`

Use this when an existing, non-animate item or scenery object moves with a character who traveled, departed, drove it, carried it, rode it, or otherwise brought it along. Do not use this for animate entities. If the thing moves with multiple characters traveling to the same destination, pick one of those characters. This can name `player`, a party member, or an NPC; the handler resolves the thing to the listed character's destination.

```xml
<thingMoveWithCharacter>
  <thingName>Exact thing name</thingName>
  <characterName>Exact character name, or player</characterName>
</thingMoveWithCharacter>
```

### `npc_first_appearance`

Use this as a catch-all for physically present entities mentioned or acting in the checked text that are not already known to the system. Do not include entities only mentioned in dialogue, on a phone, on a screen, through a vision, or otherwise not physically present at the location.

```xml
<npcFirstAppearance>
  <npcName>Exact physically present entity name</npcName>
</npcFirstAppearance>
```

### `party_change`

Use this when a physically present NPC begins willingly accompanying, leading, following, or otherwise joining the player party, or stops doing so without moving to another known destination. Do not use this for casual cooperation unless the NPC is actually accompanying the player.

```xml
<partyChange>
  <npcName>Exact NPC name</npcName>
  <action>joined|left</action>
</partyChange>
```

### `trade_availability`

Use this when an event explicitly makes an NPC willing or unwilling to trade or barter with the player. Use it for refusals after bad haggling, merchants opening shop, temporary trade bans, or a character deciding they will sell or buy goods.

```xml
<tradeAvailability>
  <npcName>Exact NPC name</npcName>
  <willingToTrade>true|false</willingToTrade>
  <reason>One sentence reason</reason>
</tradeAvailability>
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

### `any_quest_objectives_completed`

Required exactly once in the XML event response. Use `true` when the checked prose makes it likely that at least one active quest objective completed, otherwise use `false`. A true value asks the chat turn to run the full quest-check prompt during the same turn; it does not identify or complete an objective by itself.

```xml
<anyQuestObjectivesCompleted>
  <value>true|false</value>
</anyQuestObjectivesCompleted>
```

### `received_quest`

Use this when the player becomes aware of a quest, task, promise, self-imposed goal, request, or job this turn, even if they have not explicitly accepted it yet. Include quests the player invents for themselves or agrees to do.

```xml
<receivedQuest>
  <giverName>Exact quest giver name, if any</giverName>
  <summary>One sentence quest or task summary</summary>
</receivedQuest>
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

### `tracker_updates`

Optional container for plot tracker mutations. Omit `<trackerUpdates>` when no tracker values changed. In one-shot XML responses, each `<trackerUpdate>` is parsed independently and malformed entries are skipped and logged. In TinyBrain, tracker updates are the final movement/non-movement checkpoint: every child must be a valid `<trackerUpdate>`, and a malformed child retries that exact checkpoint rather than assembling partial XML. Percentage values may include or omit the percent sign. Countdown values are concrete durations until the deadline; the handler stores an absolute target minute and display code renders the remaining time automatically. `short_string` values may use up to `trackers.short_string_max_words`, defaulting to four words.

```xml
<trackerUpdates>
  <trackerUpdate>
    <trackerName>Exact tracker name</trackerName>
    <type>countdown|numerical_count|x_out_of_total|percentage|short_string</type>
    <action>add|update|remove</action>
    <newValue>New tracker value, duration until deadline for countdown, or none for remove</newValue>
    <reason>One sentence reason</reason>
  </trackerUpdate>
</trackerUpdates>
```

### `triggered_abilities`

Use this when a character's triggered ability fires during the turn. Include only abilities that actually triggered, not abilities that were merely available, discussed, or considered.

```xml
<triggeredAbility>
  <characterName>Exact character name</characterName>
  <abilityName>Exact ability name</abilityName>
</triggeredAbility>
```

## Parser-Compatible Event Elements

These tags are accepted by the XML parser and mapped into the normal event pipeline, but the active `events-xml` prompt does not render them as ordinary event tags. They remain useful for compatibility behavior, tests, and pipeline-injected outcomes.

### `completed_quest_objective`

Quest completion normally comes from the dedicated quest-check flow, which merges normalized objective completions into event outcomes. If this XML tag is present, the parser accepts quest and objective indexes from the prompt plus the completion reason.

```xml
<completedQuestObjective>
  <questIndex>1-based quest index from prompt</questIndex>
  <objectiveIndex>1-based objective index from prompt</objectiveIndex>
  <statusReason>Brief reason objective is complete</statusReason>
</completedQuestObjective>
```

### `disposition_check`

NPC disposition changes normally use their own memory/disposition prompting path, but this tag still parses into the `disposition_check` handler. Use it only when an NPC's disposition toward the current player changes significantly.

```xml
<dispositionCheck>
  <npcName>Exact NPC name</npcName>
  <before>How they felt before</before>
  <after>How they feel after the event</after>
  <reason>One sentence reason</reason>
</dispositionCheck>
```

### `needbar_change`

Need bars normally come from the dedicated `need-bars` prompt and are injected into the XML origin phase as `needbar_change` entries. If this XML tag is present, the parser accepts it and the handler applies the matching need-bar change.

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

Time advancement normally comes from action elapsed-time parsing, route/exit travel time, or other caller-provided `initialTimeProgress`. If this XML tag is present and no earlier time progress exists, it reports fallback elapsed in-world wall-clock time for concrete non-travel actions. `0` is accepted and advances canonical world time by 1 minute. XML travel-boundary responses suppress `timePassed` because route/exit timing is authoritative, except when a move to an active in-motion vehicle destination is suppressed and elapsed time is still needed to finish the vehicle trip.

```xml
<timePassed>
  <reasoning>Brief breakdown of time-consuming actions</reasoning>
  <duration>Exact duration, or 0</duration>
</timePassed>
```
