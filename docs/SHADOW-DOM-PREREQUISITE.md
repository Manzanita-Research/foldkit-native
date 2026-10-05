# Direct adapter: DevTools Shadow DOM prerequisite

The boot-faithful actual MyRemotely login bundle retains the server's
`devTools: true`. Its already-observed direct-native run throws
`FoldKit on gpuix: no shadow DOM` from `NativeElement.attachShadow`
(`packages/foldkit-gpuix/src/dom.ts:639`) and paints no text. Disabling the
DevTools overlay changes the boot contract and is not a fix.

Upstream architectural request and permission discussion:
[foldkit-native #41](https://github.com/Manzanita-Research/foldkit-native/issues/41).
All-state issue search for `shadow`, the complete current issue list, and
all-state PR search for `shadow` found no matching duplicate. Issues #35/#37
and PR39 address selectors, not shadow trees.

## Executable reduced failure

From the repository root, with the repository dependencies installed:

```sh
bun scripts/repro-devtools-shadow.ts
```

This diagnostic **intentionally exits unsuccessfully** on the current
adapter. It is not a permanent failing test or a supported example. It
reduces `@foldkit/devtools` 0.165.0's `createShadowContainer` to its first
failing DOM operation and subsequent style/container insertion. No server,
credentials, GPU, or boot override is needed.

Executed against `2e8b6b95d30a43ecf9bc28c820fa2e45cc5aaceb` with Bun 1.4.0
on macOS arm64. Result: exit 1, `error: FoldKit on gpuix: no shadow DOM`,
stack at `dom.ts:639` and diagnostic line 12. The style/container operations
are unreachable; they preserve the consumer's next steps, not a claim of
successful CSS or rendering. The faithful full-app failure is existing
reported evidence; it was not rerun to confirm it. No new live-window,
Android, iOS, authentication, or secure-input result is claimed here.

## Actual consumer contract

The inspected installed `@foldkit/devtools` 0.165.0 consumer
(`dist/overlay.js:1449–1549`) does all of the following:

- Creates `#foldkit-devtools` in the body and attaches an **open** shadow root.
- Adds `overlayStyles` as a shadow-local `<style>` and a runtime container.
- Mounts a second FoldKit runtime inside that root, queries `.message-list`
  through the root, and removes `shadow.host` at disposal.
- Captures pointerdown on the host, using `document.activeElement` to avoid
  stealing focus from an application field.

The stylesheet begins with `:host` (fixed viewport-sized host,
`pointer-events: none`, custom properties), `:host > *`
(`pointer-events: auto`), then universal reset, button, and utility rules.
The reset and utilities must not style the application's light tree.
FoldKit's `html/index.js:79` explicitly recognizes the DevTools host as a
retargeted focus destination, suppressing application blur Messages when
focus crosses into the overlay. Merely avoiding the exception would not
satisfy these behavior contracts.

## Missing direct-native architecture

These are source observations, not a claim that GPUI inherently cannot
support shadow trees. A coordinated adapter implementation is absent;
there is no existing supported isolated path to enable.

| Layer | Current implementation | Needed boundary behavior |
|---|---|---|
| DOM tree | `dom.ts:266–286`: connectivity, containment and root traversal follow `parentNode`; `getRootNode` has no composed option. No ShadowRoot class/global, host link, root queries, shadowRoot or shadow activeElement exists. | Separate light/shadow ownership and query scope, host-linked connectivity, composed roots, open/closed roots and lifecycle. |
| Native rendering | `host.ts:363–380,584–627`: mount, restyle, placement and unmount follow `childNodes`; fragments are skipped. | A composed rendering tree without flattening the DOM, correct replacement of host light children, slot distribution, mutation/reparent/disposal semantics and native layout/hit testing. |
| CSS | `host.ts:171–184`, `sheet.ts:346–358`: one supplied sheet set for every element and ordinary parentElement inheritance. `index.ts:127–150` creates sheets from attach options once; injected style elements are not ingested. `:host` is unsupported. | Root-owned stylesheet ingestion/invalidation, scoped cascade and `:host`/host-child matching, inherited values crossing the host boundary without selector leakage. |
| Events | `dom.ts:94–98,157–160,191–218`: parentNode paths, one unchanged target, no boundary retargeting. | Composed/noncomposed paths, target and relatedTarget retargeting, closed-root path visibility, capture/bubble semantics. |
| Focus/input | Host focus and hit testing operate on the ordinary tree/document activeElement. | Shadow activeElement and outside host retargeting, keyboard/tab traversal through the composed tree, correct default actions and native hit destinations. |

Returning a document fragment stops event/connection/native-tree traversal
at a detached root. Appending its contents under the host instead leaks
light-DOM queries and selectors. Installing the overlay CSS globally leaks
`*`, `button`, and utility rules into application nodes. These are not
acceptable substitutes.

The happy-dom/mirror adapter exposes browser ShadowRoot objects, but that
alone is not evidence of isolated native rendering: the actual failing
application uses the direct adapter. No migration to a different adapter
or boot setting was made.

## Maintainer prerequisite and acceptance coverage

Issue #41 requests a supported contract and permission for the coordinated
DOM/renderer/CSS/event/focus implementation. General Shadow DOM support
must define open/closed roots and slots; a bounded contract must be explicit
and still satisfy the actual consumer above. No method-only fix, fake
shadow object, flattening, or implementation PR is proposed.

After a contract is accepted, public behavior regressions should cover:

1. Conflicting application/overlay reset and utility styles: no leakage,
   shadow-local `<style>` ingestion, `:host` variables and inheritance.
2. Document/host queries excluding shadow descendants, shadow queries
   excluding light descendants, connectivity and composed root results.
3. Composed events crossing the host with retargeting; noncomposed events
   remaining inside; relatedTarget/focus crossing and capturing pointerdown
   preserving application input focus.
4. Runtime patching, detach/reattach and cleanup of the isolated tree and
   root-owned sheets/listeners; native paint/hit tests and tab navigation.
5. Unchanged actual MyRemotely boot retaining `devTools: true`, not a
   synthetic UI or absence-of-throw test alone.

Secure password entry (gpuix #80, pending permission) and native mobile
JavaScript/N-API renderer integration (gpuix #81) remain independent
prerequisites. This investigation changes neither secure input nor fetch,
application flags, authentication, or platform runtime code.
