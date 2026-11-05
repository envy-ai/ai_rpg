# Choice surfaces

Play and New Game compose the portable CollectionView for native choice presentation and disposal. Domain state remains in each host; no universal selection controller or NativeSuggestions conversion is introduced.

| Consumer | Shared mechanics | Host contract |
| --- | --- | --- |
| `showSearchSelectionModal` | Current button/list content, owned filter/action subscriptions and cleanup | Filtering/decorating options, immediate async onSelect, pending dismissal guard, original errors, onClose and load epoch |
| `populateLoadGameOptions` | Native option content lifetime | Select stays visible; loading/empty option and confirm disabled rules; first save selected; save/autosave source, sorting and fetch token |
| New Game `renderSavedEntries` | Native radio-card content and per-card change-listener disposal | Selection plus explicit Load, filtering clears hidden selection, profile metadata does not switch worlds, abort/epoch guards and staged atomic form application |
| `renderPlayerAbilitySelectionCards` | Card content, owned select/decline/tooltip listeners and image subtree disposal | Required choices per level, selected/declined name sets, actor/ability IDs, revision/submit/error rules and mandatory modal policy |
| Stack keeper cards | Card/image content and owned click/tooltip subscriptions | Group index, selected keeper Map, staged Back/Clear/Next/commit, busy state, eligible inventory and exact merge payload |

Persistent owners clear on render/reset/close. Native dialog close releases the saved-form cards; final non-persisted hide destroys owners and aborts New Game dialog reads, while cached page hide retains them. Dynamic entity choosers destroy their owner/subscriptions on cleanup and ignore late results against a closed owner. Retained former card controls cannot trigger their released owner actions.

Native radio/option controls retain their markup and browser selection behavior. CollectionView is explicitly kept visible for native selects and lists whose empty message belongs to the host. Rendering native options selects the first save after appending them; loading/empty placeholders remain disabled. CollectionView neither commits a selection nor changes cardinality or availability.

The New Game page has saved-form cards containing world-profile metadata and a loaded-world guard; it does not contain an independent world-profile radio picker. Eight actual browser choice cases and nine source/UI cases passed, including retained-control disposal and native option states. Select-with-Other, calendar-dependent selects and configuration conditional/secret fields remain separately tracked. See the [choice consolidation plan](../superpowers/plans/2026-11-05-choice-surface-consolidation.md) for exact evidence and remaining scope.
