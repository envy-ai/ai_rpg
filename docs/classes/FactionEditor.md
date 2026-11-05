# FactionEditor

`public/js/faction-editor.js` is the application-owned faction form helper used by World Profiles and Play's live/create faction forms. Faction relationship enums, sparse directed edges, asset validation and reputation tier serialization remain here; they are not portable widget policy.

`appendAssetRow(container, asset)` and `appendTierRow(container, tier)` construct visible labeled native fields through `AIRPG_WIDGETS.createField`, register their readers/removal buttons with a cached ReaderRows owner, append the row and return it. `clearAssetRows(container)` and `clearTierRows(container)` clear those owners without destroying their reusable root lifetime. A root cannot mix asset and tier ownership. Collectors read current DOM order and retain caller-specific error messages.

`collectAssetsFrom` ignores entirely blank rows, requires a name for other rows and omits blank optional type/description properties. `collectTiersFrom` retains threshold parsing and line/comma list conversion for perks/penalties. Numeric zero remains a real threshold. These methods do not apply new bounds or change faction save transactions.

`buildRelationRow(targetFaction, relation)` uses the same native field primitive but retains fixed target identity. Relationship `None` omits the directed edge; selecting a status enables required notes; Clear empties/disables the fields while leaving the target row present. This is deliberately different from deleting a free-form asset/tier row. `collectRelationsFrom` preserves sparse relationships, explicit neutral statuses and the caller's normalization policy.

The actual consumers use append/clear helpers rather than independently building/removing faction rows. Two focused Chromium cases verify sparse/explicit-neutral relations and asset/tier values with desktop/phone geometry. See the [form consolidation plan](../superpowers/plans/2026-11-05-form-field-consolidation.md) for scope and verification.
