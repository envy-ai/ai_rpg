# Ability-owned effects and technique grants

## Approved scope

Abilities can own permanent status-effect templates. Technique grants are fields
of status effects, reusing the active-status lifecycle rather than introducing
an independent ability grant system. Removing, expiring or respeccing a granting
effect/ability removes only those contributions; independently learned techniques
and unrelated statuses remain.
Attachments persist through saves, pending choices, declined records and editing.
Old abilities without attachments remain valid and are not automatically rewritten
when a save loads.

Newly generated abilities receive mechanically authored attachments. Existing
abilities expose an explicit Generate attachments action with editable results
and a separate apply step. Generated drafts and unselected options must not add
technique definitions or change actor mechanics. Standard and TinyBrain paths
must share strict validation, correction, logging and transactional acceptance.

Status effects retain their existing fixed bonuses and penalties and additionally
support signed percentage adjustments; fixed and percentage fields can coexist.
They also support direct percentage maximum-health modifiers, so
Sturdy Frame's stated +20% maximum health can be represented without changing an
unrelated attribute. Existing health reconciliation semantics apply when owned
attachments change; reading effects or loading a save must not repeatedly heal.

Conditional targeting and automatic trigger execution are outside this pass.
Generation must expose only mechanics the engine supports, rather than turning
a machine-only stun or another conditional benefit into an unconditional effect.

## Implementation sequence

1. Add strict persisted attachment schemas, ability-derived status calculations,
   fixed/percentage status modifiers and status-effect technique sources.
2. Add detached attachment authoring and stale-state-checked application. Integrate
   accepted player choices and NPC assignment without changing live saves on load.
3. Add shared-style attachment editing/generation controls and show actual attached
   effects and technique sources in ability and technique details.
4. Verify model calculations, ownership/removal, independent learned knowledge,
   persistence, rejected drafts, source freshness, generation correction, and
   desktop/mobile editing and chooser behavior.
5. Update the affected class/API/UI references and documentation index.

## Verification constraints

Use focused tests in a transient systemd scope with 16 GB memory and no swap.
Browser verification should use an isolated rendered page with intercepted API
transport. Put artifacts in `tmp`, compile changed SCSS, and check altered script
and template syntax. Do not mutate a live save or restart the game during
implementation. The user subsequently explicitly prohibited restarting while
testing the other agent's changes. Leave the running game untouched until the
user authorizes a later restart, and coordinate that activation with the other
ai_rpg agent.

## Completed verification

The focused model, authoring and actual attachment-route handler tests pass,
including detached generation, correction/cancellation, NPC initialization,
percentage calculation, ownership/removal, stale draft/source rejection,
pre-hydration reference validation, and identity/provenance preservation.
Additional technique-applied status-grant coverage verifies distinct stacked
sources, refresh and saved pins. Existing technique, starting-generation,
health/status and player-choice regressions retain their relevant passes.

Four isolated browser editor scenarios pass for reviewed Generate/Apply,
failed-apply draft/stack preservation, stable saved IDs/provenance, fixed and
percentage modifier roundtrips, and narrow layout. Existing chooser/technique
browser scenarios also pass. SCSS is compiled and the rendered Play template's
inline script parses. Desktop and phone captures are in
`tmp/ability-attachments-desktop.png` and `tmp/ability-attachments-mobile.png`.

Player selection keeps its original rollback boundary when generating a later
level fails; attachment catalogue installation happens only after that work
succeeds. Existing saved abilities require explicit generation/application and
are never silently converted on load. Ability-owned statuses currently reject
per-minute need-bar deltas; intrinsic statuses retain their existing ticking.
Conditional targeting and automatic triggers remain outside this change.

The running game has not been restarted or its saved state edited for this work.

## Pending-choice previews, icons and prompt preparation

The Choose Abilities modal and the owned-ability chooser already shared one
tooltip formatter; generated options previously lacked attachment data because
authoring ran only after selection. Pending options now retain detached drafts
in `Player.pendingAbilityAttachmentDraftsByLevel`, and selection DTOs project an
`attachmentDraft` alongside each option. The shared formatter displays draft
modifiers and proposed technique names before selection. An explicit empty draft
is complete; it is not regenerated on each poll. Only selected drafts install
statuses or catalogue definitions, and selection applies the displayed proposal
without another authoring call. Read-only polls and loading saves do not launch
attachment prompts. Older pending cards are enriched by the ordinary explicit
option-preparation path.

Selection cards compose the existing lazy action-image adapter with separate
image/menu, selection and decline controls. Wider desktop cards and narrow-screen
layout retain reachable controls without nested buttons.

Attachment authoring puts stable actor/setting/catalogue context in its own user
message before the final per-ability task, and omits ability artwork metadata.
This offers a reusable message prefix to providers with prefix caching without
changing model routing, mechanics, response validation or resource-lifecycle
requirements. Existing logs show whole-call timings, not an isolated first-token
delay; no measured speedup is claimed for the new message layout.

Following that diagnosis, completion transport attempts now have independent,
threshold-free records in `logs/completion-timing-YYYY-MM-DD.jsonl`. Streaming
`ttftMs` measures dispatch to actual generated output, separately from preparation,
queue/backoff and remaining transport time. Non-streaming responses and CLI final
snapshots use first-response fields instead. See
[PromptAuditLog](../../classes/PromptAuditLog.md#initial-output-latency) for the
full request-scoped timing contract.

Pending-preview follow-up verification passes 34 focused Node cases, the eight
distinct browser scenarios covered by the existing ability-tooltip fixture, and
an additional narrow bottom-row image-menu reachability check. Generated drafts
round-trip through saves, remain detached during authoring, and only selected
proposals install definitions. Shared tooltip parity, preview technique names,
image identity/menu isolation and prompt-prefix stability are covered.
