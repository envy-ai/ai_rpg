# OtherEntry

`packages/ui-widgets/src/other-entry.js` exports `OtherEntry`; the controls adapter exposes `AIRPG_WIDGETS.OtherEntry`. It adopts a native select and same-document `type="text"` input with associated labels. Duplicate ownership and incompatible controls reject explicitly.

`new OtherEntry(select, input, {otherValue, enabled, focusEmpty = true})` requires a nonempty sentinel value and explicit boolean master eligibility. `sync()` shows the custom input/labels only for that sentinel and disables the input whenever inactive or master-ineligible. An eligible empty custom entry focuses as before. It never clears values, computes game eligibility or infers the master from the input's current disabled property.

`setEnabled(boolean)` supplies the latest host eligibility and synchronizes. `destroy()` is idempotent, aborts its select-change subscription and releases ownership; retained former selects cannot invoke it. Native values/state remain for the host or a new owner.

New Game class/race controls compose this owner. Their adapter retains known/custom matching and trimmed serialization, and explicitly separates editable-field eligibility from Start readiness: reviewed fields stay locked while Start can retry after failure. Associated Custom class/race labels retain the existing input IDs/names. Final page hide releases owners and guards late draft/Start UI continuations; persisted hide retains them. See the [conditional controls plan](../superpowers/plans/2026-11-05-conditional-native-controls.md).
