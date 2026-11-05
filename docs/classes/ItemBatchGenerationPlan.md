# ItemBatchGenerationPlan

Compact inventory and container rosters separate item selection from complete
mechanics generation. `parseItemBatchPlan(response, { rarityDefinitions })`
requires strict `<itemsPlan>` XML with direct `<item>` entries. Each entry has
nonblank plain-text `name`, `description` and configured `rarity`; labels and
keys normalize to canonical rarity keys. Optional `count` defaults to one and
accepts integers zero or greater; container validation additionally requires
positive quantities. Optional `relativeLevel` defaults to zero and accepts
integers from -10 through 10. Blank optional scalars count as omitted, while zero
remains explicit. Optional `itemOrScenery` can only be `item`. Unknown fields,
duplicate fields, attributes and nested field content fail explicitly.

`validateItemBatchPlanAgainstSeeds` preserves barter-stock entry count, order,
exact names and supplied quantity, rarity and relative-level constraints.
`validateItemBatchExpansion` requires complete mechanics only for unresolved
roster entries, preserving their order, names, rarity, quantity and relative
level. `combineItemBatchEntries` restores the original approved roster order
after combining reusable catalogue entries and generated entries.
`formatItemBatchPlanXml` emits XML-safe compact rosters for expansion prompts.

The server's `runItemBatchPlanningPrompt` logs every accepted or rejected roster
through `LLMClient.logPrompt`, uses the existing caller metadata label and AI
profile, and applies the configured bounded parser-feedback retries. The roster
uses `items-plan.schema.xml`; full unresolved expansion uses the ordinary item
schema. Planning prompts request XML without tools.

Inventory generation resolves the roster through one item-reuse session before
requesting full XML for unresolved entries. Barter reasons remain placement
metadata. Container planning retains every pending seed name and minimum total
count, allowing surplus quantities, split/combined stacks and additional item
names in the approved roster. Final expansion preserves that approved roster.
Both paths validate and prepare the complete combined batch before creating
Things. Cached entries supply raw bonuses and use the native caller's existing
level calculation and scaling exactly once. Full catalogue hits skip the
complete-mechanics completion entirely.

Each session checks the current game immediately before the native live batch
commit and commits newly authored families only after placement and ordinary
canonicalization succeed. New standard copies receive catalogue provenance
before duplicate-name canonicalization. Container rollback retains pending
seeds and removes only newly created entries through the existing native path.
