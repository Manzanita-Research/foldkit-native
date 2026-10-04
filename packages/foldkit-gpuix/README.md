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
| `matchMedia` | **Behaves, per call.** Sizes (`min-width`, `width < …`), `hover`, `pointer: fine` and `orientation`, against the window as it is (`src/media.ts`, shared with the sheet). `prefers-reduced-motion` and `prefers-color-scheme: dark` don't match, and anything else doesn't either. Its listeners never fire, but `resize` does | Re-query on `resize` |
| `ResizeObserver`, `IntersectionObserver` | **Absent** (`typeof … === 'undefined'`) | Both need layout read back every frame, and a live gpuix window can't afford that yet (FKN-29). @foldkit/ui's virtual list and `Dom`'s element-movement wait use `ResizeObserver` and fail loudly |
| `getComputedStyle` | **Partial.** Inline style only | There's no cascade engine: the flat sheet (`src/sheet.ts`) styles elements, and its rules aren't read back |
| `document.startViewTransition` | **Absent** | FoldKit feature-detects it and renders plainly |
| `getBoundingClientRect` | **Behaves**, from where GPUI last painted (the border box) | gpuix reports content-corner boxes, and a scroll area's own box moved by its scroll; the host undoes both. On a live window it's a synchronous read (FKN-29) |

## Styles

`src/sheet.ts` has no cascade engine. Rules match the element and, through
descendant and child combinators, its ancestors at rest. Any attribute change
restyles the element's whole subtree, so `.row[data-selected] .cell` follows
the row. The cascade runs specificity, then source order, then inline style,
then `!important`. Custom properties and text properties inherit. `@media`
rules match the window as it is now, and a resize restyles everything and
fires `resize`. `@supports` is evaluated. `vh`/`vw` become pixels.

GPUI has no auto margins, so a box with auto side margins centres itself
(`align-self`), and its block parent becomes a column. `sheetFromCss` lists
what it can't follow instead of guessing:

- sibling combinators and structural pseudo-classes (`+`, `~`,
  `:last-child`, Tailwind's `space-y-*`);
- a state on an ancestor (`group-hover:`);
- pseudo-elements;
- media features other than sizes, hover, pointer and orientation.

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
  editor, and the second never returned from a modal's first stop. And
  GPUI's order is paint order: positive tab indexes come last. So the host
  owns the tab order, a browser's, and only asks GPUI to focus each stop.
- **Editors are tab stops by default.** An unfocusable field is sent
  `tabIndex: -1`.
- **Bounds.** Boxes come from the content corner, and a scroll area's box
  moves with its own scroll offset.
- **Containing blocks.** Taffy positions an `absolute` box against its
  parent, but CSS uses the nearest positioned ancestor, or the window. The
  host draws such a box under its containing block in GPUI's tree (last, so
  on top). The DOM, styles and events stay where they are. `fixed` uses the
  root, which scrolls, so a fixed box scrolls with the page.

`test/contract.test.ts` runs one app on real GPUI and on the fake
(`test/support/fake-gpui.ts`) and checks they agree on the tree, the focus
sequence and scroll offsets. Headless results mean something only while it
passes.
