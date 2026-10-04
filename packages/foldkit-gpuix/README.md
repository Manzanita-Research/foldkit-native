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

const app = mountGpuix({ title: 'My app', appId: 'dev.example.notes', width: 800, height: 600, css })
app.own(Runtime.embed(Runtime.makeElement({ Model, init, update, view, container: app.container })))
```

- `own(handle)` ties a runtime to the window, so closing disposes it: its
  Subscriptions, Mounts, Commands and listeners stop, and FoldKit empties
  the container.
- `attachGpuix(renderer, options)` does the same on a renderer you already
  have: gpuix's offscreen `TestRenderer`, or the fake GPUI in the tests.
  Its `detach()` takes it all down.

`Runtime.run` works too, but it has no handle, so nothing can dispose it.

## Closing, errors and starting

`app.close()` asks the close handlers, then releases everything the app
owns: its runtimes, pending animation frames, the native tree (gpuix's
retained element count goes to zero), GPUI handlers and window key events,
the globals, the frame loop, and gpuix's automation listener on stdin. It
resolves `false` if a handler kept the window open.

- **Close handlers**: `onClose(handler)` (or the `onClose` option). They run
  before anything is taken down, so they can still read the model and save,
  and closing waits for a promise. `request.preventDefault()` keeps the
  window open when the app asked (`reason: 'close'`). `close({ force: true })`
  can't be kept open. A handler that throws is reported and doesn't keep it.
- **When GPUI's loop ends** (`reason: 'window'`: the person closed it, on
  Linux and Windows), the handlers run but can't keep it.
- **`exitOnClose`** (default `true`): the window is the process. Closing it
  ends the process (exit 0). With `false` the process is the host's:
  `close()` resolves and `app.closed` settles, and the process goes on.
- **`onError({ phase, error, context })`** gets what a browser would report
  rather than throw. A DOM listener's error (`listener`: the event's type
  and target) and an animation frame's (`animationFrame`) are reported and
  the next one still runs. Also: a tick of the frame loop (`frame`), an error
  from GPUI (`native`), a native event the host failed on (`event`: its type
  and element), a close handler (`close`), the store (`storage`). Without
  `onError` they go to `console.error`.
- **Starting**: gpuix loads when a window is mounted, not at import, so a
  failure to load is caught too. It's a `NativeStartError` with one sentence:
  no display to open a window on (wayland-client's `NoCompositor`), a
  missing library (`libxkbcommon.so.0`), or GPUI's own message. With
  `exitOnClose` that sentence goes to stderr and the process exits 1. With
  `false` it's thrown.

**gpuix 0.10's limits.** Both are pinned by tests (`test/app.test.ts`), so a
gpuix upgrade that changes them fails there.

1. gpuix's event callback holds the process open as long as GPUI lives, and
   gpuix can't close its window or let go of the callback from JavaScript.
   So with `exitOnClose: false`, after `close()` the window stays on screen,
   undrawn, until the process ends, and an app-only process doesn't end.
   That's why `exitOnClose` is `true` by default. Everything the adapter
   owns is released, and with the fake GPUI an app-only process ends on its
   own within a second of `close()`.
2. On macOS, closing the window natively (the red button) ends the
   process inside GPUI's frame: exit 0, with no JavaScript running. Close
   handlers don't run then, and nothing can save at close. That's why
   `localStorage` writes through.

## Durable data

With an `appId`, `localStorage` is a file, `localStorage.json`, in the app's
data folder: `~/Library/Application Support/<appId>` on macOS,
`$XDG_DATA_HOME/<appId>` (or `~/.local/share/<appId>`) on Linux,
`%APPDATA%\<appId>` on Windows. `dataDir` names another folder. Each
`setItem`, `removeItem` and `clear` writes the whole store before it returns,
to a temporary file renamed over the old one. So a crash or a SIGTERM loses
nothing, and there's nothing to flush. A write takes about 0.3 ms for a 10 KB
value on the Mac mini (`test/storage.test.ts` prints it). A file that isn't a
store is set aside as `localStorage.json.unreadable`, reported, and the app
starts empty. A write that fails throws, as a browser's quota error does.
Two processes of one app share the file, and the last write wins.
`sessionStorage` stays in memory.

## Browser APIs: what behaves and what doesn't

FoldKit and @foldkit/ui feature-detect some of these. Each one either does
what a browser's does, or is absent or says so. None is a silent stand-in.

| API | Here | Why |
|---|---|---|
| `MutationObserver` | **Behaves.** childList, attributes (filter, old values), characterData, subtree; records batched into a microtask | FoldKit's `Dom.showModal` keeps everything outside a dialog inert with one |
| `requestAnimationFrame` | **Behaves.** Runs before GPUI draws its next frame, and what it changes goes into that frame (a 16 ms timer when nothing drives frames); `cancelAnimationFrame` works; `detach` drops pending ones | FoldKit renders in it, and `Render.afterPaint` counts frames |
| `history`, `location` | **Behaves, in memory.** `pushState`/`replaceState` move `location`; `back`/`forward`/`go` fire `popstate` a task later | A router in one window wants exactly this. There's no address bar |
| `sessionStorage` | **Behaves, in memory**, for the window's life | A process is a session |
| `localStorage` | **Behaves, in a file** per `appId`, written through on every change (Durable data, above). Without an `appId` it's in memory, and the first write says so once | Pixel Art and Kanban save there. In memory, throwing would break unmodified apps |
| `getSelection()` | **Behaves.** GPUI's own selection: `toString()`, `rangeCount`, `removeAllRanges()` | GPUI owns text selection |
| `matchMedia` | **Behaves, per call.** Sizes (`min-width`, `width < …`), `hover`, `pointer: fine` and `orientation`, against the window as it is (`src/media.ts`, shared with the sheet). `prefers-reduced-motion` and `prefers-color-scheme: dark` don't match, and anything else doesn't either. Its listeners never fire, but `resize` does | Re-query on `resize` |
| `ResizeObserver`, `IntersectionObserver` | **Absent** (`typeof … === 'undefined'`) | Both need layout read back every frame, and a live gpuix window can't afford that yet (FKN-29). @foldkit/ui's virtual list and `Dom`'s element-movement wait use `ResizeObserver` and fail loudly |
| `getComputedStyle` | **Partial.** Inline style only | There's no cascade engine: the flat sheet (`src/sheet.ts`) styles elements, and its rules aren't read back |
| `document.startViewTransition` | **Absent** | FoldKit feature-detects it and renders plainly |
| `getBoundingClientRect` | **Behaves**, from where GPUI last painted (the border box) | gpuix reports content-corner boxes, and a scroll area's own box moved by its scroll; the host undoes both. On a live window it's a synchronous read (FKN-29) |

## Focus

GPUI's focus is the truth and `document.activeElement` follows it. Tab and
Shift-Tab step through a browser's tab order (positive tab indexes first),
and an open `aria-modal` dialog keeps them inside it. `:focus` matches the
focused element. `:focus-visible` follows input modality, as Chrome and
Firefox judge it:

- focus by a key (Tab, Shift-Tab, a key that moves focus) shows it;
- focus by the pointer doesn't, and a press on an element already showing
  it hides it;
- `focus()` from script shows it if the latest input was a key, or if
  there's been no input yet (a page that just loaded);
- keys held with cmd, ctrl or alt (shortcuts) don't count as keyboard input;
- a text field always shows it, however it was focused: it takes keys.

It's a style state in the sheet, matched by `element.matches(':focus-visible')`
too. No `[data-focus-visible]` attribute is needed. When gpuix gains a
`focusVisible` style state, the sheet can hand it the rule rather than
restyling on focus.

## Disabled and read-only

`disabled` means what HTML says: it applies to form controls (`button`,
`input`, `textarea`, `select`, and everything in a disabled `fieldset`
except its first legend), and nothing else. A disabled control leaves the tab
order, `focus()` does nothing, it hears no clicks (nor do its ancestors, as a
browser never dispatches them) and `click()` does nothing. A disabled or
`readonly` field is read-only in GPUI's editor, so keys, paste and IME don't
change it. Disabling the focused control moves focus off it; enabling it
again, in step with the model, gives it all back. `:disabled` and `:enabled`
match in styles and selectors.

Composite widgets' items (a listbox's options, tabs) say `aria-disabled`
instead and stay focusable, as WAI-ARIA wants: the widget decides what they
ignore (`@foldkit-native/ui`'s Listbox reaches a disabled option but never
selects it). gpuix has no disabled state for AccessKit yet, so neither kind
is announced as disabled.

## Text fields: password, clipboard, undo

`<input>` and `<textarea>` are GPUI's own editors. Copy, cut, paste, undo and
redo are the editor's (cmd or ctrl, by platform), and each change reaches the
app as an `input`. GPUI undoes in smaller steps than a browser does (a typed
space and a word are two). `scripts/clipboard.ts` checks them in a live window
against the system clipboard.

gpuix has no masked input, so a password field would show the secret as it's
typed. The document refuses one instead: inserting an `<input
type="password">`, or making a field one, throws an error naming the gap
(`PASSWORD_UNSUPPORTED`), before anything changes. In a FoldKit view, that's
the app's crash. In its very first render FoldKit can't draw its crash view
(it has taken the container out by then), but it reports the crash.

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
- **Editors take focus on a press, even disabled.** The DOM doesn't follow
  GPUI there, and GPUI is told to blur (a live window; the offscreen
  renderer has no `blur`, and the field's `readOnly` keeps it unedited).
- **Editors apply an edit as they take it.** A field that mustn't change is
  `readOnly` in GPUI itself, and an edit that raced the model (typed as the
  field was disabled) is refused: no `input`, and the editor gets the value
  back.
- **Bounds.** Boxes come from the content corner, and a scroll area's box
  moves with its own scroll offset.
- **Box shadows paint under the whole box.** CSS clips an outer shadow to
  outside the border box, but GPUI paints it under the box too, so a focus
  ring on a field with no background filled the field (Metal). A box with a
  shadow and no background of its own gets the solid colour of the box it
  sits on (what shows through in CSS). Over a gradient or a see-through
  backdrop it gets nothing, and the ring fills it.
- **Containing blocks.** Taffy positions an `absolute` box against its
  parent, but CSS uses the nearest positioned ancestor, or the window. The
  host draws such a box under its containing block in GPUI's tree (last, so
  on top). The DOM, styles and events stay where they are. `fixed` uses the
  root, which scrolls, so a fixed box scrolls with the page.

`test/contract.test.ts` runs one app on real GPUI and on the fake
(`test/support/fake-gpui.ts`) and checks they agree on the tree, the focus
sequence and scroll offsets. Headless results mean something only while it
passes.
