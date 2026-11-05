# StatusEffectEditor and ModifierEditor

The application-owned `public/js/status-effect-editor.js` shares actual effect and modifier form construction across Play's player/NPC/Location editors and item target/equipper fields. Play's player form includes the status list and uses `player-stats.js`. The stock Player Stats template has no status-list markup, so that seam remains inactive unless a host supplies it; this extraction adds no new Player Stats form section. Submission omits `statusEffects` when no editor is mounted, preserving existing server effects instead of sending an unintended empty replacement. It composes portable `Repeater` and `createField`; effect mechanics, option discovery, modal lifetime, requests and saving stay in application adapters. The shared module is a classic browser script loaded after the widget controls adapter.

## ModifierEditor

`new ModifierEditor({getOptions, normalizeNeedBarKey = value => value, allowNeedBars = false})` receives a live option provider returning `{attributes, skills, needBars}`, each an array of `{key, label}`. Attribute/skill identities use native `attr:`/`skill:` select values; an optional need-rate branch uses `need:`. No game globals are read by the module.

`createRow(initial, document = window.document)` builds the existing `thing-modifier-*` DOM. `add(root, initial)` appends a row and registers the root's delegated repeater. `renderList(root, entries)` clears the owned lifecycle and displays entries, or one initial empty row. Deleting that row may leave the list empty. Fixed and percentage magnitudes remain separate, with explicit zero retained. Need-rate selection hides/disables the percentage control and requires a finite fixed delta.

Saved selections absent from live options receive an explicit `(unavailable)` option holding the original identity. Collection sends that identity to authoritative validation; unrelated edits cannot silently remove an unavailable modifier. Blank unselected rows are omitted. Populated rows with missing targets, missing magnitudes, invalid native numeric input or unsupported target kinds throw a path-bearing error with valid alternatives. `collect(root, path = 'modifiers')` returns `attributes`, `skills`, and `needBars` only when that branch is enabled.

`clear(root)` removes rows and their select listeners. `destroy(root)` releases the root's delegated lifecycle and row listeners while retaining its DOM. Removed rows cannot emit owned callbacks. Roots are tracked weakly by the modifier facade.

## StatusEffectEditor

`new StatusEffectEditor(root, {modifiers, editableName = false})` owns repeated status rows, preserving existing classes. Name, description, duration and maximum-health fields use visible native labels. `editableName: true` reproduces the NPC optional-name/name-only effect contract. The description-only variant used by Location and Play player stats retains hidden stored names and initially displays description/text/name as appropriate.

`add(effect)` returns the appended row. `render(effects)` validates the array, releases prior rows and displays effects, or one blank row. `collect()` returns authored nonblank effects. It clones the original stored data before applying visible edits, preserving IDs, timestamps, technique grants/provenance and other untouched metadata. It retains duration text for canonical server parsing, converting finite numeric strings as before. Zero values survive collection. `clear()` releases rows and nested modifier lifecycles; `destroy()` is idempotent and releases the editor. Mutations after disposal throw.

The Location adapter supplies attribute/skill options only. `Location.#normalizeStatusEffects` delegates to `status_effect_list.normalizeStatusEffectInstances` with its default `includeNeedBars: false`, so offering new need-rate edits would discard them on incoming JSON normalization. The client still preserves hidden original metadata; no backend semantics are changed. Player Stats also retains its existing attribute/skill-only controls, while NPCs and item cause effects support need rates.

## Static effect fields

`StatusEffectFields.populate(fields, effect)` fills supplied native controls. `StatusEffectFields.read(fields, original = {}, path = 'statusEffect')` applies only supplied controls to a clone of the original. Keys are `name`, `description`, `duration` and `maxHealthPercent`. A missing control preserves its stored value; a present blank control omits the edited optional scalar. Explicit zero remains populated. Invalid maximum-health input throws with its field path.

Item target/equipper forms retain their static layout and use these helpers plus the shared modifier editor. Play has no equipper-duration control, so editing other fields now preserves the original duration rather than deleting it. The page retains its existing decision about whether an entirely empty static effect means removal.

Focused browser coverage exercises real Play effect adapters and standalone Player Stats submission, unavailable modifier IDs, zero magnitudes, hidden metadata and absent-versus-empty static controls. The test runner's report is the verification authority; see [Playwright guidance](../playwright.md).

Exact affected commands, retained evidence and delivered-style checks are recorded in the [domain form consolidation plan](../superpowers/plans/2026-11-05-domain-form-consolidation.md#focused-verification-evidence).
