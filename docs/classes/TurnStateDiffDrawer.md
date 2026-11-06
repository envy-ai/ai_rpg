# TurnStateDiffDrawer

`public/js/turn-state-diff-drawer.js` normalizes and presents structured turn-change entries. Its public helpers include entry detection/normalization, categorization/summarization, elapsed-time detection, drawer creation/appending and entity-list construction.

Event normalization, deduplication, severity/category order, elapsed-time formatting, grouped need/disposition changes and entity IDs stay in this application module. Entity clicks retain `airpg:turn-diff-entity-selected` and their original source/category/severity metadata; exit pills retain their existing routing behavior.

Grouped change rows compose portable `createDisclosure` for native details/summary chrome, then append their original name/pills/detail lists. Native details owns open/keyboard behavior. The outer drawer remains its existing button-controlled section: its header also carries counts/category chips/elapsed time, and no-body state disables its toggle. That distinct app composition does not acquire a generic before/after diff model or change its markup into a native details element.

Chat check readers and Stories share the native/read-only presentation helpers while retaining their different data semantics. See [StructuredDetails](StructuredDetails.md) and the [implementation plan](../superpowers/plans/2026-11-05-structured-reader-consolidation.md).
