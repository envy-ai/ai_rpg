# TechniqueEvents

Automatic candidate disciplines use the shared naming/placeholder validator in
[TechniquePrompt](TechniquePrompt.md). Event guidance asks for reusable traditions,
reuse of existing disciplines and requirements grounded in actual qualifications,
without a default skill threshold. Unresolved example tokens receive the existing
event-parser correction handling; saved disciplines are not migrated.

`TechniqueEvents.js` connects authoritative technique receipts and independent learning to event extraction in both standard and TinyBrain modes.

A committed effect can be acknowledged with `<techniqueNotification><operationId>…</operationId><mutationId>…</mutationId></techniqueNotification>`. Existing healing, attack/environmental damage and status-gain event nodes may instead include that same pair inside `<techniqueReceipt>`. Only an exact committed effect with a compatible effect kind and matching target is suppressed. Unlinked environmental damage, healing and statuses remain actionable even on the same target. Status removal and death/incapacitation are never silently treated as an already-applied gain.

Receipts contain actual effect `mutationId` values. Cost notification IDs are `operationId:cost:resourceKey`; acquisition notification IDs are `operationId:change:index`. Invalid/missing receipts and mismatched references fail validation rather than fabricating successful notifications. No narrative substring matching is used.

Independent completed teaching, training, discovery and milestones use `<techniqueChange><command>XML-escaped JSON</command></techniqueChange>`. Legacy grouped event extraction supplies a JSON array of the same commands. Supported command kinds are `learn`, `improve` and `evidence`; each identifies canonical `actorId` and `techniqueId`. Learning accepts pinned `definitionRevision`, qualified provenance, and optional complete candidate definition/discipline. Managed healing improvement supplies `improvement: { stepId }` (optional `reason`), unused evidence IDs and provenance. Its allowed steps come from the owner's saved recipe policy in that technique's `balanceImprovements`, so later configuration changes do not reinterpret it. Arbitrary full managed mechanics are rejected by the service; complete next revisions remain supported for nonhealing custom techniques. Novel healing learning supplies the same strict semantic `revision.recipe` proposal as first-use and initial authoring, retaining it until actor-aware service compilation. Evidence supplies the domain evidence object. The service validates prerequisites, teaching sources, meaningful evidence, candidate mechanics and atomic acquisition.

The engine derives a deterministic operation ID from the validated command, so replaying the same extraction returns its saved acquisition/improvement/evidence receipt. Models do not choose execution operation IDs. Event results expose `techniqueChanges`, and chat combines those changes with `techniqueUses` already committed before prose. The existing persistent error/backtrace pipeline handles failures.

Receipt-linked need changes require the exact `needBarId`, payment direction and payer; a health debit cannot suppress a hunger or other need event. Receipt-linked status changes require `action=gained`, the exact committed status name or description, and the same target. Wrong resources, statuses or removal actions receive explicit correction errors.
