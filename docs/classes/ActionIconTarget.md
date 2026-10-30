# ActionIconTarget

`resolveActionIconTarget(entityType, entityId, { players? })` adapts ability, technique, and discipline presentation metadata to the shared entity image API and render queue. It supports only `ability`, `technique`, and `discipline`, rejects missing/malformed identity, and returns an entity facade with `id`, `entityType`, current descriptive getters, read/write `imageId` / `imagePrompt`, and `toJSON()`.

Ability IDs use `actorId:abilityId`; the actor registry and that exact persisted record are revalidated on every read/write. The facade captures the actor object, so a load replacing the same actor ID cannot receive a late result. Technique and discipline IDs use their catalogue ID and capture `TechniqueService.getRuntimeEpoch()`; a reset/hydrate invalidates the facade even if the new world reuses the same ID. Missing targets and stale lifetimes throw explicit errors.

Writes call `Player.updateAbilityImage` or `TechniqueService.setIcon` / `setDisciplineIcon`. Neither rewrites mechanical records, personal revisions, catalogue revisions, or pinned equipment. The shared server image job path additionally checks its runtime generation before attachment and validates action-icon attachment before reporting completion. No automatic image generation is performed by this module.

Discipline facades read the current canonical name/description and independent `disciplineIcons` metadata. Renaming a discipline preserves its existing artwork and prompt until an explicit regeneration or upload; an edited final prompt remains a presentation write.
