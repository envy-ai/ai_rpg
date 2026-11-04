# ThingGenerationSchema

`ThingGenerationSchema.js` supplies named mod fragments for the item-generation
schema pilot. Core field layouts are in `schemas/xml/item.schema.xml`, reviewed
against the canonical item prompt, ThingFieldRegistry and `parseThingsXml`.
Only universally required item name/description are required by that file; existing
optional scalars, collections and empty status-effect containers remain valid.
Business counts, nonempty text, mechanics and conditional requirements remain in
the existing generation parsers/validators.

| Generation path | Named file |
| --- | --- |
| Character inventory and container contents | `items.schema.xml` (empty batches allowed) |
| Shared single-Thing generation | `single-item.schema.xml` (exactly one item) |
| Location standard/TinyBrain final expansion | `things.schema.xml` |
| Location TinyBrain compact roster | `things-plan.schema.xml` |

`getThingGenerationSchemaExtensions({ registry, baseDirectory })` reads the active
Thing fields from the shared registry and enables corresponding named fragments
at `mods/<modName>/schemas/xml/item-fields.schema.xml`. Modules and Implants ship
these files. The helper verifies optional scalar/collection declarations and the
registered collection item/child names and required flags; it never constructs a
new field tree in JavaScript. Disabled/unregistered fields do not become allowed
merely because they exist in a fragment. Missing or contradictory active-mod
fragments fail explicitly before generation when the schema guard is enabled.
Future mods exposing generated Thing XML add this small named fragment alongside
their existing canonical field registration.

The server passes the extension helper lazily with explicit file references.
Location TinyBrain chooses its roster file for the planning checkpoint and its
full-Thing wrapper only for the final stage; that final schema cannot leak into
its preceding shape. No item objects are created until the unchanged parser and
atomic preparation/commit pipeline validates the full batch.

`getRegisteredEntityGenerationSchemaExtensions({ fields, fragmentFile, extensionName, baseDirectory })` shares the same checked file-fragment composition with NPC/player generation. Server NPC generation supplies active XML player fields and named `player-fields.schema.xml` fragments under each owning mod; current NSFW Boost fields use its own fragment. Registered layout declarations stay in files, and missing/mismatched fragments fail explicitly.
