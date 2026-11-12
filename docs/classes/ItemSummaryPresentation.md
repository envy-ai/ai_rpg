# ItemSummaryPresentation

`public/js/item-summary-presentation.js` is the shared server/browser presentation helper for item references in event summaries and the **What changed** drawer. It preserves plain Markdown summary text for history and prompt context; it never stores colored HTML.

## Stored item mentions

`snapshot(item)` copies the actual item's `itemId` (or `id`), `name`, and `rarity`. Mutation handlers capture these facts before deleting, merging, transferring, or altering a Thing. Separate stacks retain separate snapshots even when their names match. An alteration can retain both the original and resulting snapshots.

`compose(parts)` accepts strings and `{ item: snapshot, quantity? }` parts and returns `{ text, metadata: { itemMentions } }`. Quantities must be positive safe integers when supplied. Quantities greater than one retain the existing `**3x** Item Name` formatting. Each mention records `{ start, end, name, itemId, rarity }`; offsets use JavaScript string indices and cover only the literal item name. Surrounding prose, bullet markers, and quantity prefixes remain outside the mention.

Persist the text and metadata together in `summaryItems`. The saved snapshot remains useful after an item has been consumed or renamed. Entity references may carry the same saved rarity for the drawer's item chips.

`composeRow(parts, entityRefs)` adds the corresponding exact item references and the event producer's `description` alias. `composeEvent(eventType, entry, options)` translates captured item event facts into the existing summary wording, categories, and item mentions. The API and raw client event path share this composition instead of independently formatting the same event.

## Rendering

`render(target, row, { renderText, rarityDefinitions })` runs the existing text/Markdown renderer with collision-safe placeholders for explicit item ranges, then inserts item names using DOM `textContent`. Names containing HTML or Markdown therefore remain literal. Item names are bold and use the same configured `rarity-*` classes used by other item surfaces; no separate palette is introduced.

Both standalone summary cards and drawer rows use this helper, including expanded grouped need/disposition details. Explicit named `entityRefs` also make character, location, region, quest, faction, status and other entity names bold. They match bounded literal names in rendered visible text, preserving Markdown links, inline markup and HTML attributes. Names containing Markdown/HTML syntax are protected before parsing so their authored spelling remains literal; link destinations and attributes retain their normal rendering. Longer overlapping names take precedence. Entity chips and exit-navigation pills are bold; item chips retain their recorded rarity color.

`normalizeMentions(text, mentions)` accepts only matching, bounded, nonoverlapping ranges. `normalizeEntityMentions(text, refs, itemMentions)` preserves those authoritative item ranges before matching references. A name with an exact item range never colors or bolds unrelated same-name prose through item-reference matching. Without an exact range, an item's saved reference rarity may color its name only when same-name references agree; conflicting or unavailable historical qualities remain neutral. Rendering never guesses a quality from an inventory-wide name search.

`newExitEntityRefs(metadata)` translates native exit origin/destination names and identities into location/region references. Summary producers retain known healer, quest giver, original NPC name, status actor and vehicle/departure location references alongside existing canonical references; description prose is not treated as a named status.

Notification styles remove top margin and padding from the first direct ordered or unordered list in each summary text block, including when introductory text precedes it. Later lists keep their normal spacing, and indentation is preserved.

The server's existing hidden-note filtering rebases surviving ranges through removals, whitespace cleanup, and trimming. A mention overlapping removed text is omitted from the client copy. Saved history remains unchanged.

## Verification

Focused tests cover composition, snapshots, hidden-note filtering, actual item consumption and alteration, API summary persistence, and browser rendering. Browser fixtures exercise quality-colored names and chips in both summary surfaces while preserving bold quantities, bullets, and literal names. Tests use isolated fixtures rather than changing the running game.
