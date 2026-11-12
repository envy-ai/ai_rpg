# SkillCheckValue

Shared check-total calculation for ordinary, opposed and attack resolution.
Stored ranks remain unchanged for advancement, prerequisites and explicit rank
formula inputs.

- `fromBase(actor, key, baseValue)` adds the native `getSkillModifiers(key)`
  contributions once and returns `{ key, baseValue, value, modifiers }`.
- `resolve(actor, skillName)` resolves a direct or case-insensitive stored skill,
  then delegates to `fromBase`. A missing skill has base rank zero and can still
  receive applicable native modifiers. An omitted skill receives no skill bonus.
- Native modifiers include intrinsic, ability, equipped, location and conditional
  need-level effects. Player calculates percentage contributions after fixed
  contributions; this helper sums those resolved contributions without applying
  the percentage again.
- Invalid populated modifiers or nonfinite totals throw with their skill path.
  Generic actors without a modifier provider contribute only their base rank.

`server.resolvePlayerSkillValue` retains its existing skill-registration policy
and supplies the resolved rank to `fromBase`. API attack checks call `resolve`.
Attribute selection, omitted-attribute level bonuses and difficulty math retain
their existing behavior.
