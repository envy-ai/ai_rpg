# LocationExitSuggestions

`parseLocationExitSuggestions(xml, { required = false })` strictly parses a
location response's direct `newExits` decision before new stubs are created.
Each exit requires a `location` or `region` destination type, name,
description, and travel duration. Duplicate destinations are collapsed after
validation. An absent optional decision returns an empty list; malformed XML
or invalid supplied entries throw.

Generated hidden metadata uses
[`HiddenDiscovery.parseHiddenDiscoveryXmlPair`](HiddenDiscovery.md). Omitted
`hiddenFromPlayer` defaults to false and visible difficulty may be absent.
Explicit hidden exits require a canonical difficulty; duplicate or invalid
supplied fields remain errors. Returned suggestions always include both
normalized hidden fields, along with destination data and travel minutes.

`shouldEncourageNewExitSuggestions(existingExitDestinations)` determines
whether the prompt should encourage new onward exits. It validates its array
input and returns false when an existing destination is unexplored. The
parser's output capability remains available regardless of that guidance.
