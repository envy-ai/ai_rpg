# RepairStatusEffectsCommand

`/repair_status_effects` reviews incomplete or description-only intrinsic effects
and ability attachments across all registered characters. It requires a loaded
game and takes no arguments. It runs only when explicitly invoked.

The operation uses full base context and actual owning-character/ability facts.
Standard mode reviews up to ten effects at a time; TinyBrain reviews effects
one by one in a single shared conversation. Empty mechanics are valid when no
supported numeric effect is justified. Existing IDs, clocks and populated
mechanics are preserved.

Proven mechanically empty intrinsic duplicates of an ability effect are removed
while the owning effect is repaired, avoiding a second application of the same
bonus. Ambiguous matches are retained. Item/mod-derived effects are not copied
into intrinsic character state.

All responses are validated before committing repairs, with stale-state checks
and rollback on application failure. The command stores a durable Adventure
summary with reviewed/repaired/unchanged/duplicate-removal counts and refreshes
character presentation. Changes persist in normal game saves. Failure details
and backtraces appear through the native persistent error viewer.

Implementation: `slashcommands/repair_status_effects.js`, the API interaction's
`repairStatusEffects()` helper, and
[StatusEffectRepair](../classes/StatusEffectRepair.md).
