# PageFeedbackController

`public/js/page-feedback.js`, loaded by the shared head, exposes `window.AIRPG_PAGE_FEEDBACK` and `window.PageFeedbackController`.

- `showError(Error|string, {returnFocus}?)` displays a persistent native modal dialog with original message/stack, scrollable escaped text, keyboard/Escape dismissal and focus restoration. Pass the invoking control when asynchronous work disables it and moves browser focus before the error arrives.
  An error carrying a safe `promptFailure` envelope instead opens the shared modeless failure window, deduplicated against realtime delivery by its UUID. Other errors retain the native modal.
  Focus returns to the invoking element, or its same-ID replacement when the page rerenders that control while the modal is open.
- `dialog(title, text, {returnFocus, content}?)` retains the escaped preformatted text behavior by default. Optional `content` must be a DOM Node (never an HTML string); this variant composes the shared `.modal__dialog`, header/body/footer and button classes with the existing native focus/Escape/close lifecycle. Build caller content with safe DOM methods such as `textContent`. The formula-variable table exercises this variant above an unsaved technique editor; dismissing it leaves the editor open and restores its invoking control.
- `promptAction(id,'cancel'|'retry',clientId?)` is the common strict prompt-action transport. Server stack/code are retained and errors propagate. Chat uses it while keeping its existing full dock/viewer/mobile behavior.
- `setJobs(scope, jobs)` replaces one named owner's complete job snapshot. A nonempty scope name and an array of jobs with unique string identities/statuses are required; malformed snapshots throw before changing ownership. Only queued/running/pause-requested records remain active. Omitted, terminal and paused records are removed from this scope. `setJobs(scope, [])` clears that owner without changing other consumers.
- `trackJob(job, scope?)` updates one job within its owner scope, selected by the explicit scope argument, `job.ownerScope`, or the compatible `default` scope. Immediate updates and later snapshots must use the same owner. A terminal/paused update removes only that owner's record. Metadata and progress/view/cancel/retry remain limited to actual owned `promptIds`; these methods never start or retry a job themselves.

`jobScopes` stores each owner's active records. The compatible `jobs` map is the aggregate rendered by the controller; consumers must use the public methods rather than mutate it. When multiple scopes retain the same job identity, one dock row combines their actual prompt identities; clearing one scope retains the other owner's record and prompt ownership. The dock is hidden immediately when no active records or owned prompt entries remain, including its initial empty mount.

A standalone page creates one feedback-only WebSocket with its own client identity and reconnect lifecycle. Play creates none because Chat owns its realtime connection. Input/choice/gameplay events are never claimed by standalone feedback. Styles are authoritative `public/css/page-feedback.scss`, compiled to corresponding CSS.

Standalone `prompt_failed` events route to `window.AIRPG_PROMPT_WINDOWS`, the same
shared shell/controller used by Play failure windows and live prompt viewers.
`public/js/widgets/prompt-windows.js` loads before this controller in the shared
head. Failures need no tracked job ownership and never create an extra connection.
The modeless lifecycle, counts, focus behavior and safe envelope are described in
[PromptFailureReporter](PromptFailureReporter.md).

Standalone tracking includes only queued/running/pause-requested jobs. Activity retains durable terminal records. Supplied `label` names the actual job path. Stories snapshots include current-project generation jobs and outline runs under `story-authoring.editor`; library/story navigation and read-only saved projections clear only that scope. Invalid-response broadcasts update only owned progress groups, without opening a global failure modal; final job errors are surfaced by the page. The viewer includes prior invalid responses. Mobile spacing reserves room above bottom controls.

`tests/pagefeedback.owned_jobs.test.js` checks snapshot replacement across story navigation, terminal/paused removal, preservation of unrelated consumers, and default/named `trackJob` ownership. The isolated Stories browser harness exercises the real prompt registry and cancel route through the rendered dock.
