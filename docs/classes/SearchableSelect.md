# SearchableSelect

Search and select controls inherit the containing UI's font through the shared
SCSS rules. Callers compose their existing surface, border and text styles with
the widget; technique cards use the shared modal theme and visible focus outline.

`public/js/widgets/searchable-select.js` exposes
`window.AIRPG_WIDGETS.SearchableSelect` for shared workflow choice controls.
The New Game class selector is an ordinary HTML `select`; this widget uses
the same native control for single selections and checkboxes for multiple
selections, with a separate search input above either presentation.

Construct it with an `HTMLElement` root and
`{ multiple = false, options = [], value = null, onChange = null,
emptyLabel = 'Use workflow default' }`.
Options are distinct, trimmed, nonblank strings. `data-label` on the root
provides the accessible control name; `data-placeholder` supplies the search
placeholder. `getValue()` returns a string or a copied array according to
`multiple`. `setValue(value)` and `setOptions(options)` rerender without
emitting a user change. User selection invokes `onChange(value)` and emits
the bubbling `searchable-select-change` event with `detail: { value }`.

Search is case insensitive and splits on whitespace. Every substring must
occur in an option, in any order: `qwen fp8` matches a filename containing
both strings. Search preserves the selected value, including when nothing
matches. A single selected value stays displayed when filtered out; a stored
value absent from the available options is labeled `(unavailable)` until
changed. The blank **Use workflow default** option clears a single choice.
`emptyLabel` customizes that blank label for reusable non-workflow contexts;
TechniquesPanel uses **Choose…** and **Choose target…**.
Native selection retains the browser's mouse and keyboard behavior. Disabled
state survives rerendering and checkbox filtering.

The generated search, select, and checkbox controls have no form names.
The host owns persistence through `getValue()`/`onChange`; the workflow editor
serializes its hidden workflow JSON. LoRA availability reconciliation belongs
to that editor, rather than this general widget, so filtering never deletes
selections.

Shared styles are in `public/css/main.scss`. The shared workflow macro is
`views/_includes/image-workflow-editor.njk`, used by System Configuration and
World Profiles. Browser interaction coverage lives in
`tests/e2e/image-workflow-loras.spec.js`.
