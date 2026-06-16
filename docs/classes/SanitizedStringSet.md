# SanitizedStringSet

## Purpose
`SanitizedStringSet` is a `Set` subclass for string identity checks where case, punctuation, underscores, and repeated spacing should not matter. It stores only normalized strings:

1. Replace punctuation and underscores with spaces.
2. Collapse repeated whitespace.
3. Trim leading and trailing whitespace.
4. Lowercase the result.

The original spelling is not retained. For example, `Crafting_Station`, `crafting-station`, and `crafting station` all occupy the same set entry: `crafting station`.

## Construction
- `new SanitizedStringSet()`: creates an empty set.
- `new SanitizedStringSet(iterable)`: uses the native `Set` constructor path, which calls this class's `add` method for each iterable entry. String entries are normalized; non-string entries are ignored by `add`. Non-iterable constructor arguments fail with the native `Set` constructor error.

## Static Helpers
- `#sanitizeValue(value)`: private helper that validates a string, normalizes it, and throws `TypeError` for non-strings. Public methods guard non-strings before calling it.
- `fromArray(arr)`: builds a new set by calling `add` for each iterable entry in `arr`.

## Instance API
- `add(value)`: normalizes and stores a string. Non-strings are ignored. This method returns `undefined`, so it does not support native `Set#add` chaining.
- `has(value)`: normalized lookup; returns false for non-strings.
- `delete(value)`: normalized delete; returns false for non-strings.
- `keys()`: returns an array copy of the normalized set contents, not a native `Set` iterator.

Because it subclasses `Set`, the class also exposes inherited behavior such as `size`, `clear`, iteration, `values()`, `entries()`, `forEach()`, and `Array.from(set)`. Those paths expose the normalized stored strings.

## Project Usage
- `Thing` stores normalized flags in a `SanitizedStringSet`; serialized `flags` arrays contain normalized flag names.
- `Events` uses the class for duplicate/collision tracking across generated items, NPCs, movement destinations, and event result filtering.
- `server.js` uses it for reserved NPC/player names and name-collision checks.
- `api.js` uses it for movement-summary destination tracking.

## Notes
- Empty strings normalize to empty strings and can be stored.
- Values that differ only by punctuation, underscores, whitespace runs, or case collapse to one stored entry.
