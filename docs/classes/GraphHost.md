# GraphHost

`packages/ui-widgets/src/graph-host.js` adopts a browser HTML viewport and owns an
injected graph engine's active generation. It imports no Cytoscape, topology,
layout plugin, transport or app globals.

`new GraphHost(root,{createEngine,destroyEngine,statusClasses})` optionally stores
`createEngine(root,{signal})`; callers may instead supply an engine to `mount`.
Default destruction calls `engine.destroy()`. `statusClasses` maps `status` and
`error` to the host's existing classes. Engine initialization, graph nodes/edges,
styles, layout/plugin selection and data fetching remain app adapters.

`mount(optionalEngine)` first releases the prior generation and DOM/status state,
then returns the supplied or factory-created engine. A missing factory/engine or
invalid result fails clearly. A factory failure aborts its generation, releases
registered resources and removes partial DOM while preserving the original error
and any cleanup causes. `engine` returns the active engine or null; `signal`
requires an active generation and exposes its native AbortSignal.

`own(dispose)` registers an active resource and returns an idempotent release.
Resources release in reverse registration order before engine destruction. DOM
listeners and timers stop first. `listen(target,type,callback,options)` owns a native
DOM listener through that generation's AbortController, with stale-callback guards.
Native boolean capture options are accepted; supplying another signal is rejected.
`guard(callback)` skips invocation after its captured generation is replaced or
destroyed. `defer(callback,delay=0)` owns a scheduled guarded callback and returns a
cancel function. Timers are cancelled at generation teardown, without swallowing
unrelated errors from a current callback. Resources created in callback adapters
must check their captured signal before attaching to the current owner.

`status(textOrElement,{kind='info'})` tears down the active engine and presents
caller-supplied loading/empty/error content/classes. HTML elements must belong to
the same document; text stays text. `clear()` releases the current generation and
status DOM while preserving the host for another mount. Idempotent `destroy()`
also releases root/factory references. Disposers detach before invocation and all
resources/engine cleanup continue after failures; multiple errors retain causes
in AggregateError. Mounting while creation/disposal is in progress fails clearly.

Region Map uses this lifecycle around its existing engine factory/style/topology.
Its per-render DOM pointer/contextmenu listeners now abort on replacement, active
edge/stub popups close before old engine destruction, and existing link-mode reset
runs during teardown. Layout callbacks capture the actual engine/generation,
preventing an old completion from modifying the newer global alias. Region's
request/travel/link/faction/vehicle behavior remains in map.js.

World Map retains its region/label/vehicle/hull/layout computations and request ID.
It owns layout stop and hull cleanup before engine destruction. Captured-signal
checks dispose a hull built after its generation expired rather than assigning it
to the newer map. Relationships retains hidden/missing actors, portraits, directed
curves, manual endpoints/labels and layout choices. Its finalizer now uses owned
guarded defer instead of a timer that catches destroyed-engine errors. All three
adapters null engine aliases before replacement, including failed factories.

Document pagehide cleanup preserves persisted back/forward-cache documents, and
only unregisters/disposes on a real unload. No polling, remount fallback, new bounds
or backend changes are introduced. The independent example
`examples/graph-host.js` supplies a small DOM engine to demonstrate resources,
replacement, status and deferred work without requiring a graph dependency. Real
Region/World/Relationships fixture evidence is tracked in the master merge ledger.

The three loader adapters retain their inline error states and also pass original
failures to persistent PageFeedback diagnostics with reload/container return focus.
Touched JSON readers propagate parse failures instead of replacing them with empty
payloads. Unsuccessful API payloads throw into the same error path; World and
Relationships retain stale-request guards, and Relationships retains reload-button
cleanup in finally. Loading-state teardown is inside that path, so factory or
resource disposal failures also surface. If error-state cleanup itself fails, the
adapter still presents diagnostics and retains both failures and the original
cause. GraphHost itself remains independent of error UI and transport.
