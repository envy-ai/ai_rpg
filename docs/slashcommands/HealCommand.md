# HealCommand

## Purpose
Slash command `/heal` (alias `/resurrect`) to restore a character to full health and clear the dead flag.

## Args
- `character` (string, optional): Character name. If omitted, the invoking player is healed.

## Behavior
- With an explicit target, resolves the character by exact name or alias, preferring a unique alias match at the invoking player's current location when necessary.
- Without an explicit target, heals the invoking player character.
- Aborts with an ambiguity warning instead of healing if multiple matches still remain.
- Sets `character.isDead = false` and `character.setHealth(character.maxHealth)`.

## Notes
- Throws if the named character is invalid or if no explicit target was provided and the invoking player cannot be resolved.
