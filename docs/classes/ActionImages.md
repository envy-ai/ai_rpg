# ActionImages

`public/js/action-images.js` provides Play's `window.ActionImages.create(options)`
DOM adapter for `{entityType,entityId,imageId,imagePrompt,name}`. `entityType` is
`ability`, `technique` or `discipline`. Ability identity is `${actor.id}:${ability.id}`.
Pending level-up options use the same actor-scoped identity and retain their own
saved image metadata while awaiting selection. Technique identity is its shared catalogue `techniqueId`; discipline identity is
its saved `discipline.id` shared by all characters. Discipline metadata is projected
separately in `payload.disciplineIcons[id]`, keeping the canonical discipline and
edit-baseline schemas unchanged. Sidebar rows display a compact 32px icon/menu
inside the discipline button's visual bounds while keeping the controls as DOM
siblings, avoiding nested interactive controls. Character overview
discipline headings use the same image adapter. Ability editor rows retain
`id`, `imageId` and `imagePrompt` through renames and other edits.

The adapter composes the existing `window.renderEntityImage` and
`AIRPG.imageManager`; it does not implement another job transport. A 64px image host
starts only when IntersectionObserver reports it visible. Hidden choosers and
unopened history never request these images. Hosts opt out of the generic eager
image mutation scanner through `data-image-lazy="true"`. Detached observations are
released when lists change. Shared image-job progress targets recognize the same
entity data attributes, including already-active jobs.

A page-local entity record retains successful image metadata, skipped/disabled
outcomes and reported failures across card rerenders. Automatic demands share one
promise; they do not retry terminal outcomes. Explicit image-menu regeneration
starts another demand. Successful save loading reloads Play, discarding the previous
page's records and job subscriptions. Image/prompt update events maintain current
metadata. Failures preserve server stacks and open the shared persistent error UI.

Each icon's accessible horizontal three-dot disclosure sits at the image's
upper-right corner with transparent background/border, a restrained contrast
shadow and a visible keyboard focus outline. Its themed menu exposes Regenerate image, Use saved prompt and
Edit image prompt. The shared [PopupDismissal](PopupDismissal.md) helper closes
the disclosure immediately when an option is selected, including pending or
failed asynchronous actions, on outside pointer/click and on Escape. Opening
another popup closes the prior one; Escape restores the trigger without closing
the enclosing chooser. Editing opens the existing shared image-prompt dialog, using the
saved prompt when present, otherwise the existing prompt-generation endpoint.
`imageManager.ensureImage` additionally accepts `prompt` and `useExistingPrompt`
for explicit regeneration; these use its existing pending-job deduplication and
realtime completion lifecycle. No bulk history icon generation occurs.

## Icon ownership

`ActionImages.destroyWithin(root)` synchronously releases icons below an existing
DOM subtree; repeated disposal is harmless. It aborts icon-menu actions, releases
PopupDismissal and ImageFrame/lightbox bindings, and unobserves lazy hosts. The
existing removal observer applies the same cleanup when other callers detach
icons. A connected DOM move keeps its owner.

CollectionView adapters call this hook before replacing ability cards, technique
cards and discipline rows. Former detached menu buttons cannot launch work. Work
already submitted continues under the page's existing image manager; successful
metadata, failures and shared promises remain in the entity record, so a later
card keeps demand deduplication. There is no second loader or automatic retry.
A final `pagehide` releases document subscriptions/observers and prevents obsolete
UI writes; a persisted hide leaves the live page intact.

The Edit prompt action passes an explicit page-current callback to
`openEditableImagePromptForEntity`. A generated prompt still updates its cache;
only the modal/overlay continuation is suppressed after final page disposal.
Ordinary card replacement does not invalidate this already-started, page-owned
editor workflow. Other helper callers retain their existing lifetime policy.
