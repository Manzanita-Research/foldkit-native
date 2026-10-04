# foldkit-gpuix

FoldKit on gpuix: FoldKit's view patches gpuix's GPUI tree directly. There's
no happy-dom and no mirror. FoldKit itself is unchanged: it renders into a
small document whose nodes are gpuix host nodes (`src/dom.ts`), and the host
(`src/host.ts`) turns GPUI's input back into DOM events. Focus, Tab order,
scrolling and text editing are GPUI's own.

## Use

```ts
import { Runtime } from 'foldkit'
import { mountGpuix } from 'foldkit-gpuix'

const native = mountGpuix({ title: 'My app', width: 800, height: 600, css })
native.own(Runtime.embed(Runtime.makeElement({ Model, init, update, view, container: native.container })))
```

- `own(handle)` ties a runtime to the window. Closing the window (or
  `stop()`) disposes it first: its Subscriptions, Mounts, Commands and
  listeners stop, and FoldKit empties the container.
- Then `detach` frees the rest: pending animation frames, the native tree
  (gpuix's retained element count goes to zero), GPUI handlers and window key
  events, and the globals it installed.
- `onClose` runs once all that's done. Without it the process exits, as
  closing a single-window app does.
- `attachGpuix(renderer, options)` does the same on a renderer you already
  have: gpuix's offscreen `TestRenderer`, or the fake GPUI in the tests.

`Runtime.run` works too, but it has no handle, so nothing can dispose it.

## Browser APIs: what behaves and what doesn't

FoldKit and @foldkit/ui feature-detect some of these. Each one either does
what a browser's does, or is absent or says so. None is a silent stand-in.

| API | Here | Why |
|---|---|---|
| `MutationObserver` | **Behaves.** childList, attributes (filter, old values), characterData, subtree; records batched into a microtask | FoldKit's `Dom.showModal` keeps everything outside a dialog inert with one |
| `requestAnimationFrame` | **Behaves.** Runs after GPUI draws its next frame (16 ms timer when no host); `cancelAnimationFrame` works; `detach` drops pending ones | FoldKit renders and `Render.afterPaint` count frames |
| `history`, `location` | **Behaves, in memory.** `pushState`/`replaceState` move `location`; `back`/`forward`/`go` fire `popstate` a task later | A router in one window wants exactly this. There's no address bar |
| `sessionStorage` | **Behaves, in memory**, for the window's life | A process is a session |
| `localStorage` | **In memory, and it says so.** The first write warns once on stderr that nothing durable backs it | FoldKit's own Kanban saves its board there, so throwing would break unmodified apps. A durable store is FKN-22 |
| `getSelection()` | **Behaves.** GPUI's own selection: `toString()`, `rangeCount`, `removeAllRanges()` | GPUI owns text selection |
| `matchMedia` | **Behaves, fixed per call.** min/max width and height against the window, `hover`, `pointer: fine`, `orientation`; `prefers-reduced-motion` and `prefers-color-scheme: dark` don't match; anything else doesn't match. Listeners never fire | Live changes come with resize (FKN-18) |
| `ResizeObserver`, `IntersectionObserver` | **Absent** (`typeof … === 'undefined'`) | Both need layout read back every frame, and a live gpuix window can't afford that yet (FKN-29). @foldkit/ui's virtual list and `Dom`'s element-movement wait use `ResizeObserver` and fail loudly |
| `getComputedStyle` | **Partial.** Inline style only | There's no cascade engine: the flat sheet (`src/sheet.ts`) styles elements, and its rules aren't read back |
| `document.startViewTransition` | **Absent** | FoldKit feature-detects it and renders plainly |
| `getBoundingClientRect` | **Behaves**, from where GPUI last painted (the border box) | gpuix reports content-corner boxes, and a scroll area's own box moved by its scroll; the host undoes both. On a live window it's a synchronous read (FKN-29) |

## gpuix behaviours the host works around

Each one was seen on Metal and is pinned by a test. They're drafted as
upstream asks in the M0 memo.

- **Editors swallow presses.** A click into an `input` sends no mouse or focus
  event, even to listeners on the field. The host hears every press through
  a zero-size element listening for `mouseDownOutside`, which GPUI runs in
  its capture phase.
- **Editors type Tab.** An editor types one or two tabs for the Tab key. A
  change that only adds tabs is held for one task and dropped if a Tab
  keydown for that field came around it.
- **`value` applies only on a prop change.** Setting a field back to its
  last prop does nothing. The host sends the value plus a zero-width space,
  then the value after the next frame (`host.drawn()`).
- **`focusPrevious` and `focusPreviousWithin`.** The first doesn't leave an
  editor, and the second never returned from a modal's first stop. Shift-Tab
  steps backwards through the same order in the host.
- **Editors are tab stops by default.** An unfocusable field is sent
  `tabIndex: -1`.
- **Bounds.** Boxes come from the content corner, and a scroll area's box
  moves with its own scroll offset.

`test/contract.test.ts` runs one app on real GPUI and on the fake
(`test/support/fake-gpui.ts`) and checks they agree on the tree, the focus
sequence and scroll offsets. Headless results mean something only while it
passes.
