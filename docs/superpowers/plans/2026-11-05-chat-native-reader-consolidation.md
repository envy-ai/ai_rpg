# Chat actions and native reader disposition

L05 of the [full widget disposition](2026-11-05-full-widget-disposition.md).
Implementation and source disposition are recorded here; browser acceptance is
tracked separately by the isolated verification owner and coordinator.

## Source investigation and bounded implementation

`ChatInterface.renderChatHistory` already reconciles records by entry identity and
signature, retaining unchanged nodes and restoring native disclosure open state
on replacement. `createChatMessageElement`, `appendChatBubble`,
`appendMessageSections` and `setMessageContent` centralize transcript chrome,
formatting, Markdown policy and hook points. This change retains that algorithm
and those factories; it does not introduce a second transcript list/controller.

The genuinely repeated action/disclosure/status chrome now composes existing
`AIRPG_WIDGETS` exports from `@ui-widgets/dom`:

- `createMessageActions`: `ActionGroup` owns native redo/edit/delete buttons,
  preserving icon, class, accessible name, system-entry restrictions, persistent
  debug delete-only rows and latest-player-action eligibility. Entry IDs and
  timestamp selectors stay in the host callbacks. Appended insight controls keep
  their native hover/focus/Escape policy with an explicit per-root abort owner.
- `createQuestOfferElement`: `createDisclosure` owns native details/summary chrome;
  `StatusSurface` presents decision status; `ActionGroup` owns Accept/Decline.
  Quest metadata, objective/reward interpretation and exact confirmation IDs stay
  domain content. Literal quest text still uses text nodes.
- The existing message removal loop retires action/status/insight owners before
  removing replaced or absent roots. Detached action buttons cannot issue edits,
  deletes, redos or decisions. The keyed reconciliation and disclosure state stay
  unchanged.

The existing `questOfferDecisionInFlight` Set remains authoritative across history
replacement. A replacement pending offer disables both decisions from that Set;
submitted work continues independently of the old row. After settlement the Set
is released and only current matching pending rows receive status/eligibility.
`pendingRedoInProgress` similarly supplies a replacement redo button's pending
state. A shared current-row synchronizer updates that state after a manual redo
failure and after automatic replay settles, on success or error. Thus the new
latest action rendered during replay becomes eligible again when replay ends,
even when keyed reconciliation retains its node. The synchronizer only uses
current live action-group owners and skips final-disposed UI; it does not revive
old controls. No new request serializer, confirmation identity or request owner
is added.

The editor retains its existing custom `ModalStack` shell, plain textarea,
Ctrl/Cmd+Enter action and close policy. A generation identifies each editor
opening, so a prior save response cannot close a newer draft and its delayed
focus cannot focus a later editor lifetime. The original submitted save still
commits and refreshes authoritative history.

Persisted pagehide retains message/insight/editor owners. Final pagehide aborts
owned listeners, destroys message action/status owners and unregisters/removes the
editor. Late submitted requests still settle and update domain history state;
retired presentation does not rerender or open a popup. No new observer, polling,
transport, numeric clamp, stylesheet or package API is introduced.

Touched quest/edit/delete and redo-helper failures preserve original JSON parser
and storage exceptions, or construct an Error with the server's stack/code.
The existing persistent stack-bearing Chat popup presents those failures. The
redo cancellation/autosave chain keeps its original ownership and reload sequence.
Native delete confirmation remains explicit; this is not a browser-dialog sweep.

## Inspected native/domain readers and boundaries

These are specific source dispositions, not exemptions inferred from the number
of consumers. Applicable shared shells, fields, collections and lifecycle owners
remain in use around their domain content.

| Inspected source | Retained native/domain contract and reason |
| --- | --- |
| `views/index.njk`: `requestMapFastTravelConfirmation` and its preview validator | Validates authoritative origin/destination, allowed blocker codes, contiguous exit IDs, exact step durations and totals. Renders readonly step text with native `ol/li/span` and `textContent`; steps have no independent subscribers/state. One modal lifetime owns confirm/cancel listeners and removes them at settlement, with `ModalStack` ownership/focus. Hidden blockers, explicit unavailable travel and optional action prose are domain rules. A generic route-row controller would add no interaction ownership. |
| `views/index.njk`: `renderTooltipEffectCard` / `renderTooltipEffectSection` | Already shared by NPC/location/ability/item effect readers. Escapes text, resolves canonical technique names and preserves signs, durations, percentage/fixed components and per-minute need deltas. Native Stat/Change tables appear only when mechanical rows exist. Card values have no independent listeners; shared tooltip/Lightbox owners supply hover, focus, scrolling and dismissal. |
| `ChatInterface.getQuestRewardLines` and `createQuestOfferElement`; index quest details | Quest objective/reward formatting distinguishes promised currency/XP/items/reputation/dispositions/route knowledge from actual claim state. Literal native lists do not need another list controller. The offer's repeated decision/disclosure/status lifecycle is migrated above; authority remains the pending confirmation and canonical endpoint. |
| `public/js/item-catalogue.js`: `table`, `renderDetail`, `clearDetail` | Attribute/bonus tables are readonly native captioned tables with scoped column/row headers in labelled keyboard-focusable scroll regions. Numeric zero and signed bonuses are literal domain values. The surrounding collection, selected family/variant, Back/Escape and variant cleanup already have explicit owners. No table row introduces subscriptions. |
| `public/js/techniques.js`: `showFormulaVariables` | A labelled focusable scroll region contains a captioned native table and scoped headers. Each Insert button writes the canonical variable at the captured textarea selection, dispatches native input and closes the existing PageFeedback dialog; close restores focus. Alt+V is the existing editor shortcut. The transient dialog owns its complete subtree; schema/current-character facts and insertion semantics stay domain adapters. |
| `ChatInterface` technique result summary/details formatters | Readonly committed receipts distinguish planned calculations from successful mutations, failure costs, resource/charge before-and-after, explicit zero deltas and historical recorded fields. Text is escaped and ordinary detail chrome is shared; no receipt-row listeners or async row state require a new generic inspector. |
| `mods/story-authoring/public/js/story-editor.js`: `openUrl`, `navigate`, `renderTree`, `drawerHtml` | Native links/details expose real URLs and browser keyboard activation. Async dirty-leave review precedes URL/project/selection writes; the mod retains disclosure expansion and restores selected-node/summary focus after redraw. Previous/Up/Next and the mobile drawer compose that same domain navigation with existing dialog ownership, rather than a retained-panel tab state model. |
| Same Stories source: `typedFields`, `editTypedCollection`, `readTyped`, `redrawSetupDraft` | Shared scalar fields/disclosure chrome compose a canonical descriptor-driven draft. Add/duplicate/remove reads current controls, changes the local reviewed object, redraws the form and restores the relevant field focus. Delegated parent handlers own actions; nested rows have no independent subscriptions. Preserve zero/false/null/empty contracts and reviewed shapes; actual nested parity belongs to L08 verification, not a second schema framework. |
| `views/index.njk`: `renderEquipmentList` | Fixed slot-label/type/empty rows follow the actor's equipment schema rather than an arbitrary user-reordered collection. Occupied slots already use shared image rendering, property badges, tooltip formatting and the canonical context-menu adapter. Equip/unequip/slot compatibility and owner identity remain domain operations. |
| `ChatInterface` composer/prefix, empty-action and quest-decision reminder methods | One native textarea and the existing central send path preserve input mode markers, explicit empty-action confirmation, pending mandatory quest/ability decisions and turn routing. Existing custom shells already use `ModalStack`; replacing the domain parser/gates with a generic input controller would obscure authority. |
| `ChatInterface` slash-upload methods and native text/file controls | Browser file selection remains native: only an explicit user selection yields File objects; clearing, accepted types, multiple selection and FormData stay in the upload owner. Native readonly/editable text and browser validation remain field semantics, without a custom file picker or fabricated saved path. |
| Index `finishSuccessfulGameLoad` alias prompt; Chat delete confirmation; other browser prompts | Keep their explicit user decision and existing cancellation/load/reload semantics. The original [widget audit](../../ui/widget_audit.md) explicitly defers replacing every alert/confirm/prompt. That deferral does not permit losing original diagnostics in the request paths changed here. |

## Verification gate

`node --check public/js/chat.js` passed. Browser verification must exercise actual
current/stale message actions, exact request IDs, edited content, quest pending
replacement, mandatory next-turn decisions, keyboard/native disclosure behavior,
cached/final departure and submitted work crossing final disposal. Reader gates
include literal/zero values, long content, table/focus/Escape behavior, RouteTravel
blockers/steps/confirm/cancel and Stories dirty navigation/expansion/focus. The
coordinator records accepted cases once; existing test-file presence alone is not
evidence of completion. No tests, server restart or save loading were performed by
the coding agent.

## Accepted evidence

Five distinct actual-Chat Chromium cases pass for automatic redo success/error
after replacement, pending quest confirmation IDs/error state, retired edit/delete
controls and cache/final cleanup, real debug-entry actions, and a held edit commit
that preserves a newer draft followed by a final-disposed failure. Two actual-page
cases verify RouteTravel literal/zero/ordered/blocker/action/cancel behavior and
Stories dirty-route refusal/selection/expansion/phone drawer focus. One scoped
actual receipt-renderer case passes for committed/historical calculations. These
eight cases count once; the receipt case does not claim a complete actor run.
The strengthened quest case also verifies that a pending offer blocks the next
turn, preserves the draft on Keep reading, and Review opens the exact offer without
posting a turn or deciding for the player (`tmp/chat-quest-reminder-results`).

Two additional actual Chat cases passed: saved special prefixes and editedPlainText
use the normal message presentation (including Markdown, rather than the stale
structured renderer), and empty action cancellation sends nothing while explicit
continuation sends empty content. Results: `tmp/chat-prefix-results` and
`tmp/chat-prefix-empty-results`, respectively. Accepted unchanged E3 formula-table
insertion/focus/Escape (`tmp/reader-consumers-results`), E9 Catalogue, and the
mandatory ability choice (`tmp/choice-first-results`) retain their original scope.
The combined four affected Node suites pass 24 cases.
Focused review found an automatic-replay redo eligibility gap; the current helper
resynchronizes live groups on settlement, and the exact success/error case passes.
No other introduced defect was found. All changed scripts pass syntax. Exact
new artifacts are recorded in [Playwright](../../playwright.md); no game server,
LLM, save-load or teleport was used for these fixtures.
