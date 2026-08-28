# NSFW Boost Mod

`mods/nsfw-boost` adds explicit/romantic prompt guidance and a first-class `Player.sexualTraits` field for NPCs and player-like actors.

## Sexual Traits Field
- The mod registers `sexualTraits` as a first-class Player entity field.
- Values persist at the top level of `Player.toJSON()` and hydrate through `Player.fromJSON()` as long as the mod is enabled before save load.
- Runtime code can use `player.sexualTraits`, `player.getExtensionField('sexualTraits')`, or `player.setExtensionField('sexualTraits', value)`.
- The field is exposed to `createNpc`, `updateCharacterFields`, and `updateObjectFields({ objectType: "character", ... })`.

The prompt description is:

```text
2-5 traits, comma separated, from the sexualTraits list above. Traits from the same category are allowed as long as they don't conflict. Then, a sentence or two worth of note, like: 'switch, romantic, intense - [a note about what makes them unique]'
```

Whenever a prompt-facing field snapshot is assembled, the mod's dynamic entity-field provider rolls one d6. Rolls 1–4 append nothing. A 5 appends the instruction to choose interesting, non-obvious traits. A 6 instead appends the instruction to choose traits contrary to the character's outward personality. The same result supplies both the tool description and XML placeholder in that snapshot, so the two rare instructions are mutually exclusive and the next prompt can reroll.

## Prompt Context
- `mods/nsfw-boost/defs/sexual_traits.yaml` supplies the category list used by the mod. `sexual_traits_and_preferences` is a flat category map: each category directly contains its trait list. It is a mod-owned definition file and does not require a matching root `defs/sexual_traits.yaml` placeholder.
- The mod contributes a `<sexualTraits>` block to base prompt context. The block is a markdown list by category:

```text
category:
- Trait: Description
```

- NPC creation and character alteration XML scaffolds include a `<sexualTraits>` field when the mod is enabled.
- Generated location NPCs, region NPCs, single NPCs, and altered NPC definitions parse `<sexualTraits>` back onto the Player field.

## Player-Action Prompt Steps

The mod registers three stage-1 player-action prompt checks:

- `lustAdvance`: asks whether an NPC should make a romantic or sexual advance.
- `takeTheLead`: asks involved NPCs to participate actively according to personality.
- `descriptiveness`: asks for explicit anatomical detail during intimate or sexual acts.

Each registration also supplies `tinyBrainText`. These variants ask for an immediate list or `N/A`, allowing each check to run as an independent tiny-brain checkpoint; ordinary prompts continue using the original `text` wording.
