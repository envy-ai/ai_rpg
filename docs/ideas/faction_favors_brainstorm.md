# Faction Favors Brainstorm

This is a brainstorm document, not an implementation spec. It proposes **faction favors**: things the player can activate at will once their reputation with a faction is better than neutral, each with its own cooldown.

## Current project status

Faction favors are not implemented. The relevant existing pieces:

- `Faction` stores reputation tiers `{ threshold, label, perks, penalties }`. The generator (`prompts/faction-reputation-generator.xml.njk`) uses thresholds `-60, -20, 0, 20, 60`, so "better than neutral" means the **20** and **60** tiers.
- Tier `perks` and `penalties` are free text. They are shown in the UI and editable, but nothing applies them mechanically.
- Player standing lives on `Player` (`getFactionStanding(factionId)` and friends). It changes through `faction_reputation_change` events (witness required) and quest reputation rewards. `Faction.resolveReputationTier(value)` maps a standing to a tier.
- Locations and regions have `controllingFactionId`; NPCs have `factionId`.
- Quest rewards already have typed, handler-backed benefits in `QuestRewardBenefitRegistry` (for example `knowledge/route`), which is a model for guaranteed favor effects.
- There is no cooldown mechanic anywhere in the codebase yet.

## Decisions so far

| Question | Decision |
|---|---|
| How favors take effect | Hybrid. Every favor runs as a narrated turn. Some favors also carry a typed mechanical effect the engine guarantees. |
| Cooldown units | In-game time (world minutes), not turns. |
| Cost besides the cooldown | None for now. |
| Where favors come from | Generated per faction alongside reputation tiers. Typed effects are validated against a fixed catalogue of effect types. Existing saves get a one-time generation pass. |
| Where favors can be used | Each favor sets its own location requirement. Default "anywhere" for information favors, "where the faction has a presence" for shelter and transport. |
| Narration fails after activation | The typed effect and cooldown stay applied. Narration failures are rare; the player sees the error and the favor is spent. |
| Rival factions witnessing a favor | Small fixed standing loss with present rivals, computed in code with no extra LLM call (see below). |
| Main quest awareness | Yes, at no extra token cost: main-quest prompts render through the base context, which already carries the compact favor list. |
| Player faction membership | No special case. `Player.factionId` is not really used; positive reputation generally implies membership, but that is left to the LLM. Favors depend only on reputation tier. |

## Favor definition

Stored on `Faction`, next to `reputationTiers`:

| Field | Notes |
|---|---|
| `id` | `favor_...` via `IdGenerator`. |
| `name` | Required. The favor's name, used on its button and in prompts (for example "Safe Lodging"). |
| `shortDescription` | Required. One sentence, used in the compact base-context line and on the quick favor menu. Same field name and role as `shortDescription` on `Faction`, `Location` and other models. |
| `description` | Full description of what the faction does for you. Shown in the Factions tab and in the `<favorActivation>` block when the favor is used. |
| `minThreshold` | Tier threshold required (20 or 60 for generated favors). Must match an existing tier threshold above 0. |
| `cooldown` | Duration string such as `"3 days"`, parsed with `Utils.parseDurationToMinutes`. Stored as `cooldownMinutes`. |
| `requiresTarget` | Whether activation asks for short free text ("find out where Captain Vey is hiding"). |
| `targetPrompt` | Placeholder text for that field. |
| `presence` | `anywhere` or `faction-presence` (see below). |
| `effect` | Optional typed effect `{ type, ...params }` from the catalogue, or `null` for narrative-only. |
| `imageId` / `imagePrompt` | Icon presentation metadata (see [Icons](#icons)). Blank until generated or uploaded. |

Higher tiers get stronger favors and shorter cooldowns. Rough guide for generation: 1–2 favors at the 20 tier with multi-day cooldowns, 1–2 more at the 60 tier.

## Cooldown state

Stored on `Player`, alongside faction standings: `favorUsage: { [favorId]: { lastUsedWorldMinute } }`.

- A favor is available when `currentWorldMinute >= lastUsedWorldMinute + cooldownMinutes`.
- If standing drops below `minThreshold`, the favor is locked. Its cooldown keeps running, so regaining the tier doesn't reset or refresh anything.
- Usage state saves with the player. (Delta undo is only proposed; if it lands, player data is already in its snapshot.)
- Deleting a faction removes its favors' usage entries, matching how faction deletion already clears standings.

## Presence

`faction-presence` is satisfied when any of these hold:

- the current location's or region's `controllingFactionId` is the faction
- an NPC with that `factionId` is in the current location or the party

The UI shows why a favor is unavailable ("needs the Ashen Guild's presence").

## Typed effect catalogue

Typed effects are applied by the engine before the narrated turn, so the narration describes something that has already happened (the same ordering quest rewards use). Starting set:

| Effect type | What it does | Reuses |
|---|---|---|
| `reveal-route` | Reveals one hidden exit chosen by the server from candidates near the faction's territory | Shared hidden-discovery helper used by the `knowledge/route` quest benefit |
| `grant-item` | Generates an item into inventory from a name/description seed | Quest reward item generation |
| `grant-currency` | Adds currency | `player.adjustCurrency` |
| `fast-travel` | Moves the player to a chosen location the faction controls | Existing fast-travel path |
| `restore-needs` | Sets listed need bars (for example Food, Rest) to a given percentage, as a meal or a night's lodging would | `Player.setNeedBarPercentages` |

Later candidates, which need new mechanics: temporary escort NPC with an expiry, item loan that is returned automatically, merchant discount, bounty clearing.

Narrative-only favors (information, introductions, intervening with a rival) have `effect: null` and rely on the narrated turn and normal event checks.

## Activation flow

1. The player clicks a favor (Factions tab, or a quick favor list in the chat view) and fills in the target text if the favor asks for one.
2. Server checks, in order: favor exists; standing meets `minThreshold`; cooldown expired; presence satisfied; typed-effect parameters valid. Any failure returns an error naming the reason; nothing is applied.
3. The typed effect, if any, is applied.
4. `lastUsedWorldMinute` is recorded.
5. A normal player-action turn runs with an injected action such as "You call in a favor from the Ashen Guild: *Safe lodging*. Target: …", plus a `<favorActivation>` block describing the favor and the already-applied effect. Event checks run as usual, so narrative favors can still change the world.

If step 5 fails, the player sees the error with its original details. The typed effect, cooldown and any rival penalty stay applied; they were committed before the turn, the same way quest objective completion is kept when reward presentation fails. Narration failures are rare enough that a rollback path isn't worth its complexity.

## Rival witnesses

Calling in a favor in front of the faction's enemies costs standing with them. This is computed in code during step 3, with no LLM call:

- For each other faction R whose relation edge toward the favor's faction is `rival` or `hostile` (`R.getRelation(favorFactionId)`), check for a witness: an NPC with `factionId === R` in the current location or the party. This matches the witness rule `faction_reputation_change` events already use.
- Each witnessing faction loses a fixed amount of standing: `faction_favors.rival_witness_penalty` (default `1`) for `rival`, double that for `hostile`.
- The penalties are listed in one line inside the `<favorActivation>` block so the narration can reflect them, and reported to the client the same way other reputation changes are.

The only token cost is that one line, and only when a penalty happened.

## Prompt integration

- Base context lists the player's favors, one compact line each, only for factions where the player is at a positive tier and only for favors they've unlocked: `Faction | name | shortDescription | status` with status `available`, `ready in <duration>`, or `needs presence`. Locked favors are left out to save tokens. The narrator then knows what the factions will do for the player.
- Main-quest prompts render through `base-context.xml.njk`, so they receive the same list with no extra tokens. `main-quest-stage.njk` gets one sentence telling it that available favors are valid routes it may suggest as hooks.
- If the player asks for a favor in prose instead of using the button, the narrator sees its status and can have the faction agree only when it's available. Prose requests don't start the cooldown or apply typed effects; the base context instruction tells the narrator to point the player to the explicit action for those.

## Generation

- Extend `faction-reputation-generator.xml.njk` to output `<favors>` per faction, with the effect-type catalogue listed in the prompt. The parser validates each favor (threshold matches a positive tier, cooldown parses, effect type known, effect params valid) and sends errors back through the existing correction loop.
- The faction form fill prompt and Factions editor gain favor editing.
- Existing saves: on load, factions with tiers but no favors are queued for a one-time background favor-generation prompt. Until it finishes, those factions just have no favors.

## UI

- Factions tab: each faction card lists its favors with tier requirement, cooldown, and a status badge. Locked favors are shown greyed with the tier needed, so the player knows what they're working towards.
- Chat view: a compact favors menu (for example in the action area) showing only currently available favors, with cooldown timers for the rest.
- Cooldowns display in in-game time ("ready in 2 days 4 hours").

## Icons

Favors get square icons, using the same image pipeline as ability, technique and discipline icons (`docs/api/images.md`, "Ability and technique icons"):

- `POST /api/images/request`, `/api/images/prompt` and `/api/images/upload` accept `entityType: 'favor'` with the favor's id as `entityId`. Favor ids are globally unique, so no composite id is needed. Unknown ids fail before any job is queued.
- Rendering is lazy: requested when a favor icon becomes visible in the UI. Loading a save or generating favors does not bulk-generate icons. Disabled image generation returns the ordinary skipped result.
- New prompt writer `prompts/favor-image.xml.njk`, configured by `imagegen.prompt_generator_templates.favor`. It asks for one bold motif for the service the faction provides (a key for lodging, an open map for a revealed route, a coin purse), in the faction's style, with no lettering, border or portrait. The faction's name and short description are included so icons from one faction look related.
- Global writer guidance `imagegen.image_prompt_instructions.favor`, overridden by a nonblank world-profile `imagePromptInstructionsFavor`; final prompts get `imagePromptPrefixFavor`. Dimensions come from `imagegen.favor_settings.image`, default 1024 × 1024. These appear in the same World Profiles / Image Prompts controls as the other icon types.
- `imageId` and `imagePrompt` are stored on the favor record inside the faction. Unlike techniques, favors have no mechanical fingerprint to protect, so no separate icon map is needed. Editing a favor's name or description keeps the existing icon until it is explicitly regenerated.
- Until a favor has an icon, the UI shows the faction's emblem in its place.
- Icons appear on favor cards in the Factions tab, in the chat-view favor menu, and on the `<favorActivation>` turn's chat entry.

## Config

```yaml
faction_favors:
  enabled: true
  # Standing lost with a rival faction whose member witnesses a favor; doubled for hostile factions.
  rival_witness_penalty: 1
```

Further knobs (favors per tier, cooldown multipliers) only if playtesting asks for them.

## Open questions

None at the moment. See [faction_favors_implementation_plan.md](faction_favors_implementation_plan.md) for the implementation plan.
