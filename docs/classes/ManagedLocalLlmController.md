# ManagedLocalLlmController

`ManagedLocalLlmController.js` supplies the shared header's process-session local
LLM control. It appears only when configuration selects native `ai.strata_runtime`
or a game-owned llama startup script. An ordinary local endpoint is insufficient.
Ownership, endpoint checks and containment remain in [StrataRuntime](StrataRuntime.md)
and [LocalLlamaServerProcess](LocalLlamaServerProcess.md).

The constructor accepts `desiredOn` (boolean, default true). With
`--no-llm-autostart`, server boot initializes it false with confirmed physical-off
state, without probing, stopping or adopting anything. Both configured manager
objects and readiness/start handlers still initialize; the header's explicit on
operation starts them normally. Managed router preloading and the default dummy
character's optional inventory prompt are skipped while intentionally off.
External/remote-only boot paths remain unchanged. The flag is retained by the
existing self-restart argv path and never enters saves/configuration.

Explicit on/off operations serialize through `LLMClient.withExclusiveModelLifecycle`.
Off records intent immediately, waits for active text/image work, and stops the
owned manager. That intent persists until explicit on, independently of game
loads/saves and configuration files. Local prompts fail once with a clear
nonretryable lifecycle error while off; explicit remote-provider overrides remain
usable. Prewritten image renders can run while off without model handoff/restart.
Managed image renders use the gate even when image-handoff mode is `none`.
Render-only handling uses confirmed physical shutdown independently of a pending
on/off request, preserving correct ordering when an image was queued first.
Termination-mode image recovery skips restarting the local process after an off
request. Image work and automatic startup-script switching expose busy activity,
so their temporary model absence shows yellow rather than an unexpected exit.

Status verifies Strata's owned readiness or llama's live owned process plus HTTP
`/health`; PID presence alone never yields green. Inspection responses recheck
pending operations before publishing a state. Original operation errors/stack
traces remain latched until successful explicit recovery. A failed stop keeps
manual-off intent and cleanup receipts; another click retries off. An absent
failed model offers on; an unhealthy live model offers off.

## API

`GET /api/local-llm` returns `{ success, configured, kind, desiredOn, nextEnabled,
state, error }`. `kind` is `strata`, `llama` or null. States are `off`, `waiting`,
`starting`, `stopping`, `running`, and `error`; errors contain message and stack.
`nextEnabled` defines the single button's next recovery/toggle action.

`POST /api/local-llm` accepts only `{ enabled: boolean }`, waits for its serialized
transition and returns the same status. Invalid bodies return 400. Operation
failure returns 500 with message, stack and an authoritative status snapshot.
Neither route adopts or stops external runtimes.

The constructor injects `resolveConfiguration`, `inspect`, `isPresent`, `start`,
`stop`, and `withExclusiveModelLifecycle`. `getStatus`, `snapshot`, `setEnabled`,
`assertPromptAllowed`, `isConfigured` and `withActivity` are independently testable.
`registerLocalLlmControlRoutes` shares the same controller with both API routes.
The server initializes managers before accepting requests. A stopped native Strata
manager creates a fresh unique contained service on the next explicit start only
after the prior service's cleanup succeeded.

## Header

The shared header includes one native `.app-header-action` with a 9px LED: dark
off, red error, yellow waiting/starting/stopping, green running. Desktop shows
`LLM`; phone uses a 44px LED-only button outside the menu with a full accessible
label. Native Space/Enter activation, `aria-pressed`, `aria-busy`, a live state
label and transition disabling expose state without relying on color alone.

`public/js/local-llm-control.js` polls the API and sends explicit transitions;
pending requests retain yellow even if a concurrent poll returns older running
state. Errors use the existing PageFeedback modal with server stack and suppress
identical repeated polling dialogs. The server renders the control only when
configured, so a still-running older backend renders no control and makes no new
API polls before the separately authorized code-reload restart.

The [implementation plan](../superpowers/plans/2026-10-31-local-llm-toggle.md)
records scope and verification. Tests use mocked managers/API responses; no real
runtime control is required.
