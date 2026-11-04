# HiddenDiscovery

`HiddenDiscovery.js` owns shared Thing/exit hidden-state normalization,
generated XML metadata parsing, interaction guards, reveal operations, and
first-entry discovery helpers. Thing and LocationExit documentation describe
the persisted state and gameplay gates.

`parseHiddenDiscoveryXmlPair(node, targetLabel)` reads direct
`hiddenFromPlayer` and `discoveryDifficulty` children and returns the normalized
pair used by Thing generation, region blueprints, connected-region stubs, and
location exit suggestions. An omitted or blank scalar hidden flag means `false`; omitted or
blank difficulty is null for visible entries. A nonblank flag must be `true`
or `false`. Nested empty elements are not treated as blank scalar leaves. A hidden entry requires one of `Trivial`, `Easy`, `Medium`, `Hard`,
`Very Hard`, or `Legendary`; label case and space/hyphen/underscore presentation
normalize through `normalizeDiscoveryDifficulty`.

Duplicate hidden/difficulty tags, invalid booleans or supplied labels, missing
difficulty on a hidden entry, and nonblank difficulty on a visible entry throw
an explicit validation error. Omitting a flag does not imply hidden state when
a difficulty is supplied. The returned fields are always present, including
the false/null defaults. Generation scopes that forbid hidden content still
reject explicit hidden entries after parsing.

`validateHiddenDiscoveryPair` validates the equivalent object representation.
This XML default does not change reveal permissions, difficulty labels,
first-entry contest behavior, or hidden-target interaction restrictions.
