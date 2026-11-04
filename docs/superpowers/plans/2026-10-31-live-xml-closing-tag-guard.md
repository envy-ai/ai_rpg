# Live XML closing-tag guard

Implement the approved design in docs/ideas/live_xml_closing_tag_guard.md without
runtime controls, game restarts or real-model tests.

Use effective ai.xml_closing_tag_guard (default false; enabled in the managed
Strata profile) independently of prose deslop. XML scope is explicit true/false or
auto leading-output recognition. Known XML validation/roots promote auto to true;
known plain TinyBrain stages explicitly bypass both guard and logprob overhead.
Unknown/custom XML outputs remain covered by leading actual-XML recognition,
including fences/comments/PI and orphan closing tags. CLI capability mismatch
fails explicitly for XML-eligible requests; unconfigured providers stay unchanged.

An incremental scanner shares xmldom QName grammar, ignores comments/CDATA/PI and
quoted delimiters, tracks the open stack, and tests real closing tokens with a
dynamic rejecting regex. Rewinding reconstructs retained-prefix state. Extend the
existing LiveDeslop branch selector for raw XML, allow ordinary markup tokens,
exclude special/control alternatives, and preserve native tools. Compose this
structural check before ordinary prose inspection. Inspect opaque text without
inventing sampled token records; exhausted/unavailable alternatives fail clearly.

Retain existing stream/nonstream continuation, retry boundaries, logging and strict
final XML/domain validators. Do not repair completed responses, invent required
fields, or prevent premature EOS. Tests use scanner fixtures and mocked standard/
TinyBrain token transports, with prose guard on/off and missing metadata cases.

## Verification and deployment boundary

Scanner and mocked standard/TinyBrain transport tests cover nested/duplicate/wrong
closes, Unicode/namespaces, split prefixes, comments/CDATA/PI/quoted attributes and
DOCTYPE subset comments, retained-prefix rewinds, opaque text, exhausted branches,
special-token rejection, plain bypass, tool preservation and both prose/structural
guards together. An affected 36-case batch also exercised the scripted Strata
MockEngine HTTP fixture without loading a model/GPU. Forced fixture checks retain
final-parser behavior; they cannot establish live token correction.

Changed JavaScript syntax and YAML flag checks pass. The default remains false;
the managed Strata profile opts in. No server restart, live model call or runtime
control was performed by this implementation work. Final XML/domain validation and
premature-EOS behavior remain unchanged.

Final focused fixture/QName boundary checks passed 3/3, including explicit forced
valid/invalid XML and non-strict file-fixture misses retaining real-call guarding.
Full attribute grammar remains the final parser's responsibility; no additional
attribute validator was added to this closing-tag guard.
