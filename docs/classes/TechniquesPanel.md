# TechniquesPanel

`public/js/techniques.js` exposes `window.TechniquesPanel.mount(root, actor)`.
The shared actor panel is mounted in the Character Overview and standalone
Player Stats page. It composes the registered `.npc-view-section`,
`.npc-view-ability-card`, shared buttons/form chrome, SearchableSelect and
PageFeedbackController. One instance is retained per root; repeated mounts
abort superseded loads and ignore stale actor responses.

`window.TechniqueCatalogue.load(actorId, { signal })` is the shared read-only
catalogue request used by the panel, sidebar and chat-page grant-name hydration.
The actor argument may be omitted to use the API's current-player default. It
validates response identities and definitions, returns the complete panel payload,
and emits `techniques:catalogue` only when no later-started request has already
published a successful snapshot. A delayed older request therefore cannot remove
newly generated technique names from the chat page.

Cards group identities under disciplines. A card retains its explicit source
choice, defaults to the server-selected source, and requires a choice for
ambiguous equipment grants. Costs, failure costs, blockers, target rules,
checks and requirements describe the selected version. The learned revision
editor always edits the learned source even when the selected use source is
an item grant. Equipment grants keep their pinned mechanics.
Ability-granted status effects appear as a distinct `status` source badge/name in
the character panel and sidebar chooser. Their access remains tied to the
underlying active status; editing a learned personal revision does not change
their pinned definition. `window.TechniqueMechanicsEditor.editor`,
`recipeEditor` and `requirementsEditor` expose the same structured authoring
controls to the ability-attachment draft dialog. The recipe editor accepts
pending legacy single-component and current mixed/status recipes using the
actor's `balanceAuthoring` choices; the custom editor receives the actor's
utility context for teleport and summon choices.

Repeated requirement, normal/failure cost, template, effect/status and recipe rows use
[ReaderRows](ReaderRows.md) over the shared Repeater. It owns row readers/removal
and explicit nested cleanup while preserving all existing fields, validators,
formula modes and serialized mechanics. Dynamic body replacement and native close
release owned row groups without invoking their serializers.

The shared native dialog lifecycle provides the browser's focus containment,
Escape dismissal, trigger focus restoration, shared header/footer, independent
body scrolling and Ctrl/Cmd+Enter through modal-submit-shortcuts. Pending
submission prevents dismissal and repeated submissions. Errors retain drafts
and open PageFeedbackController with the server's original error stack.
The dialogue uses Roboto and the shared modal/semantic colors; controls have
visible focus outlines. Narrow screens wrap actions and keep the footer
reachable.

## Technique extensions

The shared mechanics editor offers custom healing, technique or exact-weapon
damage, buff/debuff, teleport, summon and resurrection effects. Weapon damage
edits multiplier and bonus with the existing fixed/formula controls. Attack
checks expose target toughness attribute and damage effectiveness for native
weapon calculation. Teleport destinations, existing summon actors and saved
summon templates come from the actor's authoritative `utilityContext`; summon
effects can also embed a typed inline creature template. The separate **Save
summon template** action authors the same typed fields and lists saved templates.
Resurrection authors restored health and marks its target rule as dead-only.

The default new-technique authoring mode is **Standard recipe** when the actor
has applicable configured resource profiles and facts. It selects one or more
healing, damage, buff or debuff components with actual skill, attribute/status
and profile choices from `balanceAuthoring`. Status components select fixed or
percent modifiers; configured baseline strength and world-minute duration are
shown by the generated preview. **Custom mechanics** remains an explicit
alternative. Formula-preserving drafts are sent to `/api/techniques/preview`;
the calculated response is advisory and is never substituted into a saved
revision. **Edit catalogue revision** appends a guarded shared revision and
does not change existing source pins.

The use dialog filters local targets by living/dead eligibility, requires an
exact equipped weapon for weapon damage, and offers per-effect destination,
existing actor or saved template choices when the effect leaves them open.
**Calculate cost preview** calls `/api/techniques/:id/use-preview` with the
current source and selections. It displays the server's actual target count,
component calculations, total costs and one native weapon ammunition/charge
payment. Changing a selection invalidates the review. Use requires a current
preview, then submits the same `weaponItemId` and effect-ID keyed
`utilitySelections` through the ordinary chat turn adapter. Commit recalculates
and checks everything again.

Learned cards have **Reset / rebase personal revision**. Its native dialog
initially focuses Cancel, shows current personal and selected base mechanics,
and explains that personal changes are replaced while acquisition evidence and
history remain. The reset target is the actor's pinned base; rebase targets a
newer catalogue revision. Preview and apply carry exact definition, personal
and catalogue revision guards. Changing the choice invalidates preview;
**Refresh actor and catalogue** renews a stale baseline without clearing the
reason. Apply requires the current review, records an editor reason and uses a
stable operation ID for retries. Only the selected actor's learned copy changes.
The ordinary chat receipt details show selected weapon damage inputs and
committed teleport, summon or resurrection mutations when those records exist;
older receipts still display their originally recorded fields.

Structured mechanics forms cover fixed/formula values with automatic actor-fact
variables, simultaneous normal/failure costs, target kind, technique/effect
checks, damage/healing, status buffs/debuffs and modifier rows, refresh/stack
policy, and learning/use prerequisites. Skill checks select the existing named
difficulty tiers through SearchableSelect rather than entering a separate DC.
Status attribute and skill rows retain fixed modifiers and additionally expose
optional percentage modifiers; status effects also expose optional maximum-health
percentages. Existing nested technique-grant identities are preserved by editing.
Percentage fields accept the same fixed/formula amount controls as other technique
amounts, and the details pane includes those percentages alongside fixed values.
Prerequisites also support exact class/race names, including requirements authored
automatically for a new character's initial discipline access.
Every formula has an **Available variables** button; Alt+V while editing the formula opens the same table. The shared PageFeedbackController content dialog lists canonical variable identifiers, their source labels and current character values. It opens over the existing editor without losing the draft. Tab reaches row Insert buttons; Enter/Space inserts the variable at the retained formula cursor/selection, closes the table and focuses the formula. Escape, Close and the header close button dismiss only the table and restore its trigger. Values are advisory snapshots from the actor response; preview and execution recalculate them. Saved aliases are converted simultaneously to canonical names so aliases named `level` retain the correct source. No manual binding controls remain.

Calculate preview requests a read-only authoritative preview; execution recalculates values. Personal
edits advance only that actor's complete saved revision. New catalogue
techniques, discipline definitions, explicit character discipline access and
manual learning are separate explicit actions, with provenance reasons.
A new catalogue entry does not itself teach the actor.

Managed healing revisions open with **Balance mode: Managed balance** in the
existing SearchableSelect. This preserves their saved policy, formulas and
improvement history while showing their mechanics read-only. Choosing
**Custom mechanics** opens the existing structured editor and explicitly submits
`convertToCustom: true` on personal save. The usual required reason records this
deliberate personal conversion; it does not alter the catalogue or another owner.
The selector uses ordinary keyboard selection and the dialog retains its existing
Escape and Ctrl/Cmd+Enter behavior. Calculated previews remain advisory and never
replace the formula source saved by the form.

The empty state explains that normal actions, training and discoveries can create
and teach techniques automatically. The catalogue/discipline/learning editors are
optional authoring controls; ordinary play does not require filling those forms.

Use is available only when the server grants character control, the selected
source is available and Play's `window.submitTechniqueTurn` adapter exists.
The adapter invokes the existing Chat turn lifecycle with
`metadata.techniqueUse = {actorId,techniqueId,sourceId,definitionRevision,
personalRevision?,targetIds}` in the request and final user message. It
retains ordinary quest/ability gates, request identities, NPC/time handling,
error recovery and refresh. Player Stats directs use to Play through the
disabled button's explanatory title; it provides the same editors.

API dependencies: `GET /api/techniques?actor=ID&catalog=true` returns
`{actorId,actorName,isPlayer,canUse,targets,disciplines,disciplineAccess,
techniques,catalog,formulaVariables}`; catalogue definitions retain their revisions.
Mutation routes are `POST /api/techniques/disciplines`, `PUT /api/techniques/disciplines`,
`POST /api/techniques/catalog`, `PUT /api/techniques/access`,
`POST /api/techniques/:id/learn`, `PUT /api/techniques/:id/personal`.
`formulaVariables` uses the [TechniqueFormulaVariables](TechniqueFormulaVariables.md) row contract. Catalogue creation accepts `actorId` (default: current player) to validate formulas against authoritative character facts; this request selector is not saved in the definition.
`POST /api/techniques/preview` accepts `{actorId,mechanics}` and returns
resolved `mechanics` and optionally resolved `costs`/`failureCosts`.

Dispatch `techniques:refresh` after external equipment/turn updates to refresh
mounted panels. Successful editor mutations emit `techniques:changed` with
`detail.actorId`; shared discipline metadata changes also set `detail.global: true` so
all panels and the player sidebar refresh. The authoritative styles are in `public/css/main.scss`;
compile with `npm run scss:build:main`.

## Player discipline chooser

Play additionally mounts `window.TechniqueSidebar({root,grid,chooser})` below its
existing four player action controls. It fetches authoritative
`GET /api/techniques?actor=ID` without the authoring catalogue, including blocked
learned and equipped sources. A full-width button appears for each discipline
with at least one owned technique. Each row places a 32px lazy discipline icon
inside the button's visual bounds, before its label. The image/menu and picker
remain sibling controls in the DOM to avoid nesting interactive elements. Character overview discipline headings
share these icons. Groups retain their discipline IDs so matching display names
do not merge identities. Names and techniques sort alphabetically.
The existing Character/party/NPC authoring panel and explicit Use controls remain.

The discipline surface composes [ModelessChooser](ModelessChooser.md). Cards show
descriptions, [lazy icons](ActionImages.md), source provenance, selected-source costs,
effects and blockers. An ambiguous equipment group explicitly requires source
selection and makes no availability claim. Learned blocked sources are retained;
other available equipment does not override the server-selected learned source.
Selecting any card only inserts `[Technique Name]` at the retained chat cursor or
selection. Actual execution/targets/source choice still belong to the ordinary turn.

Actor fact changes, `techniques:refresh`, matching `techniques:changed`, and
`inventory:updated` invalidate its advisory snapshot. An 80ms coalescing window and
one in-flight request prevent duplicate repaint/event floods. Superseded actor or
revision responses cannot overwrite newer state; actor changes clear old buttons
and close the prior chooser. Errors show Retry and the shared original-stack error
UI. Successful save loading reloads the page and reconstructs the sidebar.


The sidebar owns separate [CollectionView](CollectionView.md) instances for
native discipline rows and technique cards. The host still builds every name,
source, cost, effect and blocker, and ModelessChooser still owns insertion and
exclusive opening. Repaint releases old ActionImages bindings; closing releases
the card collection. Delegated discipline/choice actions cannot fire from detached
former controls. Focus restoration occurs after new entries are mounted.

`destroy()` is idempotent: it aborts component listeners and its catalogue request,
cancels the coalescing timer, closes its chooser and disposes both collections.
Late catalogue responses cannot repaint a disposed owner or schedule another
load. Persisted `pagehide` keeps the instance live; real unload destroys it.


## Edit discipline

**Edit discipline** replaces the previous Discipline access button. It reuses the
native editor dialog, fieldsets, labeled inputs and SearchableSelect. The first
section selects a discipline by saved `Name · id` and edits its shared name and
description. Drafts are retained by ID when changing selections; selector labels
keep saved names until submission. These shared changes affect all characters,
while identity, technique links, prerequisites and public access remain intact.

The second section retains the character's **Accessible disciplines** checkbox
selector for explicit access. Existing provenance is preserved by the server.
**Reason / source of newly granted access** appears and becomes required only
when at least one previously absent explicit access ID is selected. Rename-only
and access-removal saves do not require an invented acquisition reason. Cancel,
Escape and Ctrl/Cmd+Enter retain the shared native-dialog behavior. Failed saves
keep all drafts and disabled/conditional field state for correction.

One `PUT /api/techniques/disciplines` request commits all edited metadata and the
full selected actor-access set atomically. Its required `expected` value is the
`disciplineEditContext` captured when opening the form: a runtime world identity,
saved discipline metadata, and the actor's existing access/provenance. A changed
world, edited discipline or actor access rejects the stale save. Successful shared
metadata changes refresh all mounted technique panels and the player sidebar;
character-only access changes retain the ordinary actor refresh behavior.
