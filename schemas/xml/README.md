# Editable XML generation schemas

Named layouts for the live XML token guard. Children are unordered: a field is
required once by default; optional="true" permits omission; multiple="true"
permits 1+; both permit 0+. A same-name ref="item.schema.xml" reuses a named file.
Core layouts stay here; enabled mod layouts stay in each mod's named fragment. See
[XmlGenerationSchema](../../docs/classes/XmlGenerationSchema.md) for flag semantics,
file references, mod extension fragments and bounded tag-only forcing.

- `item.schema.xml`: canonical item fields; name/description required, other core
  fields optional to preserve parser semantics.
- `single-item.schema.xml`: exactly one item under items.
- `items.schema.xml`: item batches, including empty batches.
- `things.schema.xml`: location item/scenery batches.
- `things-plan.schema.xml`: compact location planning stage, not full item XML.
- `target-effect.schema.xml` and `equipper-effect.schema.xml`: optional effect
  field layouts, including valid empty containers.

Existing mod layouts are named files under each mod's `schemas/xml/` directory.
Schemas describe structure and value intent; they do not supply generated values.

New-game families and shared fragments:

- `skills`, `factions`, `faction-relationships`, `faction-reputation`,
  `initial-faction-standings`: skill library and faction setup.
- `calendar-definition`, `season-image-descriptions`, `setting-mechanics`:
  conditional setting preparation.
- `region`, `region-location`, `region-weather`, `region-exit`, `region-vehicle`,
  `region-connected-exit`, `region-secrets`, `location`, `location-new-exits`,
  `existing-region-exit`, `travel-times`, `region-entrance`: world generation.
- `npc-generation`, `npc`, `hostile`, `npc-replacement`, `npc-progression`,
  `npc-abilities`, `npc-aliases`, `equip-best`, `memories-to-recall`: character
  profiles, equipment assignments and conditional context memory selection. Player field
  extensions use each mod's `player-fields.schema.xml` fragment.
- `ability-attachments`, `technique-candidate`, `technique-discipline`,
  `starting-techniques`, `starting-technique-plan`, `starting-technique`:
  reusable nested executable mechanics and separate staged envelopes.
- `npc-names`, `item-names`, `location-names`, `region-names`: name corrections.
- `game-intro`, `revision-decision`, `edited-text`, `image-prompts`, and
  `short-description-{item,location,region,ability,npc,faction}`: structured
  narration/audits/assets/summaries. True prose and single image prompt text
  use explicit plain output, without fabricated envelopes.

Names above omit `.schema.xml`. `text="true"` permits an existing scalar-or-child
contract while final value parsers remain authoritative. `markup="true"` permits
balanced rich-text descendants only inside that explicitly declared payload and
cannot combine with declared child fields. Comments and CDATA schema descriptions
are literal guidance. These are file-backed layouts, not runtime-generated trees.

`technique-intent.schema.xml` describes standalone first-use operations and shares `technique-candidate`, `technique-discipline` and `technique-provenance` files. Candidate recipes permit semantic `kind` and optional known canonical identities/selectors; fresh revision 1 may be omitted. Damage snapshots and healing snapshots use separate optional coefficient fields. Existing domain validators enforce selected recipe, target/check and conditional branch rules.
