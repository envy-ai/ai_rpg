# Local LLM header control

Expose a shared header toggle only for configured game-owned native Strata or
llama startup-script managers. State is process-session intent, not save data.

A shared controller serializes explicit on/off transitions through the existing
exclusive model-lifecycle gate. Off waits for active text/image work, prevents
prompt and image handoff restarts, and persists until explicit on. Status probes
actual readiness; observed exits/failures retain stack diagnostics. Native Strata
restart uses a new contained service only after prior cleanup has succeeded.

Use the existing app-header action and PageFeedback error modal on all pages,
with dark/red/yellow/green LEDs, accessible labels and native keyboard behavior.
Keep the control in the phone header outside its menu. Follow the staged mockup
in tmp/managed-llm-mockup before editing UI. Test controller/API with injected
managers and desktop/phone UI with mocked endpoints; start no real runtime or
restart the game during implementation.

## Implemented and verified

- Added the shared controller/status API, target-specific nonretryable manual-off
  guard, serialized image/toggle handling and committed physical-off tracking.
- Native Strata creates a new contained adapter only after prior cleanup succeeds;
  failed cleanup preserves ownership. Green requires actual readiness, and known
  automatic script-switch/image transitions show busy rather than false errors.
- Added the configured-only shared header LED button, retained its phone top-row
  placement and native keyboard behavior, and reused PageFeedback stack dialogs.
  Old backends omit the button and issue no unknown API polls.
- Focused mocked controller/API/lifecycle tests cover both FIFO image/toggle
  orderings, off images, stale status, original errors and native restart receipts.
  Desktop and 320px browser cases cover layout, LED states, keyboard and errors.
- Changed JavaScript syntax checks pass; main.scss compiled to main.css.
- Runtime activation/configuration is unchanged. No live model calls, runtime
  controls or game restart were performed by this implementation work. The
  control appears only after managed configuration and an authorized code reload.
