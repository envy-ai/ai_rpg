# TechniqueEvents

Automatic candidate disciplines use the shared naming/placeholder validator in
[TechniquePrompt](TechniquePrompt.md). Event guidance asks for reusable traditions,
reuse of existing disciplines and requirements grounded in actual qualifications,
without a default skill threshold. Unresolved example tokens receive the existing
event-parser correction handling; saved disciplines are not migrated.

`TechniqueEvents.js` connects authoritative technique receipts and independent learning to event extraction in both standard and TinyBrain modes.

A committed effect can be acknowledged with `<techniqueNotification><operationId>…</operationId><mutationId>…</mutationId></techniqueNotification>`. Existing healing, attack/environmental damage and status-gain event nodes may instead include that same pair inside `<techniqueReceipt>`. Only an exact committed effect with a compatible effect kind and matching target is suppressed. Unlinked environmental damage, healing and statuses remain actionable even on the same target. Status removal and death/incapacitation are never silently treated as an already-applied gain.

Receipts contain actual effect `mutationId` values. Cost notification IDs are `operationId:cost:resourceKey`; acquisition notification IDs are `operationId:change:index`. Invalid/missing receipts and mismatched references fail validation rather than fabricating successful notifications. No narrative substring matching is used.

Committed utility mutations also prevent duplicate event application. A linked `npcArrival` must name the actor placed by a summon, and a linked `healRecover` may name the actor revived by resurrection. Committed teleportation uses `techniqueNotification`; a linked `moveLocation` is rejected because its paired arrival boundary would otherwise be left orphaned. Independent movement, arrival, and healing remain actionable.

Independent completed teaching, training, discovery and milestones use child-only `<techniqueChange>` XML with kind (`learn`, `improve`, `evidence`), actorId, known techniqueId and nested provenance. The grouped extraction family wraps these nodes in `<techniqueChanges>`; no model JSON command envelope remains. Novel learn replaces outer techniqueId with one shared discipline group containing exactly one technique/candidate. Parent ID/new metadata stays outside mechanics; the engine supplies candidate IDs/provenance. `parseChangeXml` converts this authoring form into the unchanged internal command DTO; `parseChangesXml` handles grouped extraction. Standard and TinyBrain event validation share this adapter.

Improvement uses nested improvement/stepId (optional reason), evidenceIds/evidenceId and actual provenance, or a complete nested mechanics revision for custom nonmanaged techniques. Allowed managed steps come from the owner's saved balanceImprovements policy. Evidence uses evidence/kind and evidence/description; the engine supplies its ID/time. Semantic healing/damage recipes and custom formulas share the same authoring contract and actor-aware service validation. Learning has no forced cast, and acquisition/source/evidence checks remain authoritative.

A successful event `learn` establishes the actor's explicit access to the learned
technique's discipline when that access record is absent. The event adapter
selects the trusted service `establishDisciplineAccess` mode; it is not a model
XML field. Only the discipline-access gate is replaced by the completed learning
event. Revision acquisition requirements, actor eligibility,
trainer/teaching-item qualification and mechanics validation still apply.
Access and the new learned entry commit together and roll back together on
failure. The access record retains the actual learning provenance and a stable
derived operation ID. Existing access is not duplicated, private disciplines do
not become public, and replay never grants access again. Narrative first-use
discovery uses the same transaction policy through [TechniquePrompt](TechniquePrompt.md).

The engine derives a deterministic operation ID from the validated command, so replaying the same extraction returns its saved acquisition/improvement/evidence receipt. For authored novel learning, the engine fingerprints the typed authored XML DTO before allocating name-derived IDs or resolving canonical parent metadata, then carries the key in existing provenance.operationId. Re-parsing before application reserves one first-three-word name-derived ID per fingerprint and current technique runtime epoch, so accepted staged events retain their identity; ordinary world reset/load invalidates only these transient reservations. The XML parser rejects a model-supplied provenance.operationId. Identical re-extraction reuses the committed canonical technique before parent lookup, including after a parent rename; replay validates kind, actor and technique identity. Known/internal command hashing remains unchanged. Models do not choose execution operation IDs. Event results expose `techniqueChanges`, and chat combines those changes with `techniqueUses` already committed before prose. The existing persistent error/backtrace pipeline handles failures.

Receipt-linked need changes require the exact `needBarId`, payment direction and payer; a health debit cannot suppress a hunger or other need event. Receipt-linked status changes require `action=gained`, the exact committed status name or description, and the same target. Wrong resources, statuses or removal actions receive explicit correction errors.

Charge payments use resource key `charge:<itemId>`. A matching `chargeAdjust` can contain the exact techniqueReceipt operationId and `operationId:cost:charge:<itemId>` mutationId; actorId, itemId and the resulting amount must match the stored cost. `ItemChargeEvents` validates this before suppressing only that referenced payment. Independent reload/refill events are documented in [ItemChargeEvents](ItemChargeEvents.md).
