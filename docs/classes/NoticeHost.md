# NoticeHost

`packages/ui-widgets/src/notice-host.js` adopts a notice root. `show(text,
{kind='info',duration=4000,exitDuration=300,className=''})` creates a text-only notice
and returns `{element,dismiss,destroy}`. Durations must be finite and nonnegative;
no clamping occurs. Dismiss begins the owned exit animation once; handle destroy
removes immediately. Host destroy cancels all TTL/exit timers and releases entries.
There is no polling, transport, job ownership or implicit error policy.

Independent SCSS owns notice appearance and animation. The app preserves Scene
Illustration's position, colors, size and four-second/300ms behavior. PageFeedback's
`notify` supplies the shared root and persistent Error routing; Scene Illustration
always calls it, removing the optional-toast fallback. Caught Errors are retained;
server/broadcast stacks are retained when supplied. Existing queue bookkeeping and
requests remain in the mod.

Cached pagehide preserves document owners; real unload disposes notice/status/busy
presentation. The app-free `examples/surfaces.js` demonstrates native busy ownership,
stale status expiry and notice TTL/disposal without app globals or APIs.
