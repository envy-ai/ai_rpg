# ImageFrame

`packages/ui-widgets/src/image-frame.js` owns a native image/placeholder host.
It does not choose URLs, generate images, cache entities, normalize badges or run
jobs. `new ImageFrame(root)` adopts a host once; `ImageFrame.attach(root)` retrieves
its explicit owner or adopts it. `destroyWithin(root)` releases registered frames
inside a host before that host replaces its content.

`show({src,alt,placeholderHtml,errorHtml,loading='lazy',draggable,onImage,onError})`
replaces the previous image and aborts its owned error listener. A missing source
renders supplied placeholder markup. Error markup defaults to that placeholder.
`onImage(image)` may return a binding disposer; replacement, image error and destroy
run it once. `onError(event)` runs after the current image switches to error markup.
Old/detached image events cannot replace current content. Cleanup pointers detach
before hooks execute; generation/current-image guards preserve a newer render
created from those hooks. A reentrant onImage result is disposed immediately when
its image is no longer current.

`destroy()` is idempotent, aborts subscriptions, runs binding cleanup and releases
the owner/DOM references without inventing a new visual state. A new owner may
adopt the host after disposal. The root registry is weak; there is no global scan,
polling or image transport dependency.

Play `renderEntityImage` and explicit entity-placeholder reset compose ImageFrame.
The adapter retains imageManager ensure/jobs, entity metadata, display overrides,
badges/count overlays, progress and generation failure policy. Lightbox bindings
return their disposer to the frame. Existing ActionImages and entity portraits use
that same adapter rather than acquiring a separate rendering path.
