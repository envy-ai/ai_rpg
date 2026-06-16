# SanitizedStringMap

## Purpose
`SanitizedStringMap` is a `Map` subclass for string-keyed indexes where human-entered names should match despite case, punctuation, underscore, or whitespace differences. It stores normalized keys and leaves values as provided.

## Key Normalization
Every key passed to `set`, `get`, `has`, or `delete` must be a string. Non-string keys throw `TypeError('SanitizedStringMap only accepts string keys.')`.

String keys are normalized by:

- replacing punctuation and underscores with spaces using `/[^\w\s]|_/g`;
- collapsing consecutive whitespace to one space;
- trimming leading and trailing whitespace;
- lowercasing the result.

Examples:

- `"Iron_Arrow!"`, `"iron arrow"`, and `"IRON   ARROW"` share the stored key `"iron arrow"`.
- Punctuation-only strings normalize to the empty-string key, which is still a valid `Map` key.
- JavaScript `\w` is ASCII-oriented; letters outside that character class are replaced as punctuation by this sanitizer.

## Map Behavior
- `new SanitizedStringMap()` creates an empty map.
- `new SanitizedStringMap(entries)` accepts normal `Map` constructor entries; entry keys pass through `set`.
- `set(key, value)` stores `value` at the normalized key and returns the map.
- `get(key)`, `has(key)`, and `delete(key)` normalize the supplied key before delegating to `Map`.
- Keys that normalize to the same string share one entry; a later `set` replaces the prior value for that normalized key.
- Inherited methods such as `clear`, `size`, iteration, `entries`, `keys`, `values`, and `forEach` operate on the stored map contents. Iteration exposes normalized keys, not the original spelling.

## Project Use
- `Quest.#indexByName` maps normalized quest names to quest instances; `Quest.getByName(name)` trims the input and uses the map for case/punctuation-insensitive lookup.
- `Thing.#indexByName` maps normalized thing names to bucket arrays. `Thing.getByName`, `Thing.getAllByName`, and `Thing.getByNameAndLocation` read those buckets and apply additional location/owner context where needed.
- `Player.#indexByName` is maintained as a runtime name index and exposed through `Player.indexByName`. `Player.getByName(name)` performs its own case-insensitive scan across instances.

## Notes
- `SanitizedStringMap` is a runtime helper. It does not serialize original keys or preserve display spelling.
- Use it only when normalized key collisions are acceptable for the index being built.
