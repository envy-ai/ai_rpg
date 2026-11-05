# AttributeSkillAllocator

`public/js/attribute-skill-allocator.js` shares New Game and character-view point allocation. It retains the server definitions, attribute floors, point pools, rank rules, read-only variants, formula evaluation, warnings and change events that make allocation different from free-form NPC skill rows.

Attribute controls compose `AIRPG_WIDGETS.createField` for the visible label and native numeric input. The allocator places those nodes into its existing header/input-group structure with abbreviation, modifier and help elements. IDs, classes, min/max attributes, values, read-only state and pool listeners remain allocator-owned. The portable field helper neither allocates points nor changes numeric bounds.

NPC free-form skill/ability rows instead compose ReaderRows for Add/Remove/read ownership. Fixed character attributes remain a fixed field group; rebuilding them aborts the previous attribute-change listeners. Neither group is converted into an allocation pool or a free-form replacement for this allocator.

Two actual isolated New Game save/load regression cases passed after the field composition change, including calendar/allocator preservation and rejected input responses. See the [form consolidation plan](../superpowers/plans/2026-11-05-form-field-consolidation.md).
