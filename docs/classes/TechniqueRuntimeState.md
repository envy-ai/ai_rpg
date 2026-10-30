# TechniqueRuntimeState

`getTechniqueRuntimeFingerprint({ actors, things })` returns a SHA-256 digest of
the current saved technique catalogue, character learning/discipline access,
personal revisions, and equipment grants with their current equip state.
Collections may be maps or iterables of entity instances. The projection excludes
execution receipts, which record completed attempts rather than available mechanics.

Story Authoring includes this digest in its live runtime projection. A prepared
candidate becomes stale when technique mechanics or access change even if visible
chat history has not changed. The digest does not replace a world's identity or
change the binding's static mechanics compatibility rules when a technique is learned.

The server separately supplies `TechniqueService.getPromptContext(...)` with only
the current player and the party/location actors already represented in base
context. This projection supplies known technique mechanics without exposing the
entire world catalogue or saved execution receipts.

# Ability and status attachments

The mechanical runtime fingerprint includes owned ability status templates, intrinsic actor statuses, and equipped-item equipper statuses as well as learned techniques, discipline access, item grants, and the catalogue. It excludes ability/technique artwork and technique receipts. Adding, editing, removing, or expiring a status-backed technique grant or percentage modifier therefore invalidates a stale prepared story candidate.
