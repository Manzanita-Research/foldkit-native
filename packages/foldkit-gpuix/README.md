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
  Linux and Windows), the handlers run but can't keep it. On Linux gpuix
  throws "GPUI application is not initialized" from every call once its
  window is gone, so the adapter ends the loop on `tick()` and doesn't call
  into GPUI to tear down (the tree went with the window).
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
  no display to open a window on, a missing library (`libxkbcommon.so.0`), or
  GPUI's own message. With `exitOnClose` that sentence goes to stderr and the
  process exits 1. With `false` it's thrown. Checked against the real gpuix
  on Linux: a missing library and a `WAYLAND_DISPLAY` nobody listens on are
  gpuix's own errors (`NoCompositor` panics GPUI's thread, so gpuix prints
  its Rust panic first), but with neither `WAYLAND_DISPLAY` nor `DISPLAY` set,
  or a `DISPLAY` on no X server, gpuix 0.10 starts *headless*: no window, no
  error, an app running unseen. So on Linux the adapter looks first (a Wayland
  socket that exists, or a local X socket) and gives the same sentence.

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
| `ResizeObserver` | **Behaves, from the last layout GPUI gave.** After each frame GPUI draws, each observed element's box is compared with the size last reported; changes are delivered together (content, border and device-pixel boxes). The first size is reported on `observe`, unless it's 0×0. A browser delivers between layout and paint; here it's just after the paint, so what a callback changes shows a frame later. GPUI sizes boxes border-box, so a `width` holds padding and border | `Dom.detectElementMovement` (@foldkit/ui's popover, listbox and menu) waits with one |
| `IntersectionObserver` | **Absent** (`typeof … === 'undefined'`) | Not built yet; the same per-frame layout would serve it |
| `getComputedStyle` | **Behaves at rest.** The sheet's rules and inline style, var()s resolved, inherited properties (text, custom properties, `visibility`) included; CSS's initial values for `display`, `position`, `overflow`, `visibility`, `opacity` and `pointer-events`. Values are as declared (`overflow: auto` reads `scroll`, GPUI's only kind), not laid out, and rules for states (`:hover`) aren't in it. `checkVisibility()` reads it too | `Dom.scrollIntoViewIfNotVisible` finds the scroll area with it, and `Dom.advanceFocus` skips what a rule hides |
| `navigator` | **Behaves**: the platform as browsers name it (`MacIntel`, `Linux x86_64`), no touch points | `Dom.lockScroll` asks whether it's iOS |
| Scroll lock (`overflow: hidden` on `<html>`) | **Behaves.** CSS gives the root's overflow to the viewport, which here is the body GPUI draws as its root; so `<html>`'s, when set, is the body's, and the page stops scrolling under the wheel (Metal). `document.documentElement.clientWidth` is the window's width (GPUI's scrollbars overlay), so no padding makes up for one | `Dom.lockScroll` and `unlockScroll` |
| `inert` | **Behaves.** An inert subtree leaves the tab order, is out of GPUI's hit testing (`pointer-events: none`: no hover, presses go to what's under it), hears no clicks GPUI was already delivering, and `elementsFromPoint` passes through it. `click()` from script still works, as in a browser. **Missing:** gpuix has no `aria-hidden`, so AccessKit still lists it | `Dom.inertOthers` / `restoreInert` (@foldkit/ui's modal popover, listbox and menu) |
| `getAnimations()` | **Behaves for GPUI's motion** (`data-fn-motion`, gpuix's `motion`): a new target starts one, and GPUI's `motionComplete` (or the element going away) finishes it. CSS transitions and keyframes don't run natively, so they're never listed | `Dom.waitForAnimationSettled` |
| `document.startViewTransition` | **Absent** | FoldKit feature-detects it and renders plainly |
| `getBoundingClientRect`, `offsetWidth`, `clientHeight`… | **Behaves, from the last layout GPUI gave** (the border box). See Geometry below | A browser lays out on demand. GPUI lays out when it paints, and asking it can wait |
| `document.elementsFromPoint`, `elementFromPoint` | **Behaves, from the last layout GPUI gave.** Topmost first, as GPUI paints: children over parents, later siblings over earlier, a box re-homed under its containing block over that block's other children, anchored elements over everything. Skips `pointer-events: none` (inherited), `visibility: hidden` and `display: none`. A scroll area or `overflow: hidden` clips what's inside it. Then `<html>`. Checked against GPUI's own hit test on Metal | @foldkit/ui's drag and drop finds the drop target with it |
| `scrollIntoView`, keyboard scrolling | **Behaves, from the last layout GPUI gave**: the nearest scroll area moves until the element shows, placed as `block` says (`start` with no options, as in a browser; `center`, `end`, `nearest`). With no layout for the element or its area, GPUI's own `scrollIntoView` | |
| `scrollTop`, `scrollLeft` | **Behaves.** GPUI's offset; the last one known while GPUI isn't answering | |
| Pointer and mouse events | **Behave for a press and its gesture.** `pointerdown`, `mousedown`, then each move and the release, pointer event first, on the pressed element, bubbling to `document` and `window`. While a button's held, `mouseover`/`enter` and `out`/`leave` follow the element under the pointer (from the layout). A pressed element the app removes mid-gesture keeps hearing it (dispatched on the body). **Missing:** `setPointerCapture`, and moves with no button held reach `document` only through an element that listens for them | @foldkit/ui's drag and drop listens on `document`; Pixel Art paints the cells a drag enters |

## Geometry

Where GPUI last painted things answers every layout read (`src/layout.ts`).
A browser lays out when it's asked. GPUI lays out when it paints, and
asking it costs:

- gpuix's `getElementBounds` walks the whole native tree per call. The
  adapter never uses it. It reads the automation tree instead: every box in
  one call, 5–12 ms per 1,000 elements in a live window on Metal.
- On Linux, every geometry query (bounds, scroll offsets, the window's size)
  is a round trip to GPUI's UI thread. It waits up to 2 s, then fails, when
  the window isn't painting (hidden, minimised, behind a lock screen).

So the layout is read only when someone asks for it, at most once per frame
GPUI draws. It's read only in the frames after something could have moved it
(a change, a scroll, a resize), or once it's half a second old. Every query
is timed: a slow one (over 4 ms) spaces out the next of its kind, so queries
take at most a quarter of the time. One that fails stops all geometry queries
for three times what it cost (6 s after a 2 s timeout), doubling up to 30 s,
and until input shows someone's using the window.

What the APIs return when GPUI has no fresh layout (not painting, or not yet
painted since a change):

| | Returns |
|---|---|
| `getBoundingClientRect` and friends | The box from the last layout GPUI gave. An element that wasn't in it (added since, or never painted) gets zeros, as an unrendered element does in a browser |
| `elementsFromPoint` | Hits in the last layout. Elements added since aren't hit; elements removed since are left out |
| `scrollIntoView` | Scrolls by the last layout; with none, asks GPUI to (a command: it never waits) |
| `scrollTop` | The last offset GPUI gave, or the one the app last set |
| `resize`, `@media` | The window keeps its last size until GPUI answers again |

The cost of finding out is one blocked frame: the first query after GPUI
stops answering waits out gpuix's 2 s. After that, frames stay under budget
(`test/window.test.ts` checks both in a real window, with Linux's timeouts
reproduced). Only gpuix can remove that one frame, with a way to read the
last painted layout that never waits (drafted as an upstream ask for Jem in
FKN-29's PR; nothing is filed).

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

## Linux

The adapter runs on gpuix's Linux binary (Wayland, or X11 through XWayland),
needing libxkbcommon, libwayland-client and EGL/Vulkan from the system. Eight
examples and the Pixel Art restart test were checked in real windows on
Wayland (m6, a headless sway; TESTING.md has the session). What differs from
macOS:

- **No offscreen renderer, no frame read-back.** gpuix 0.10 has no
  `TestRenderer` and its `screenshot` is macOS and Windows only ("wgpu cannot
  read a rendered image back yet"). So Linux tests are whole processes in a
  window, and pixels come from the compositor (`grim`).
- **`getPaintedText` is always empty**, awake or not (probably a
  thread-local read from the wrong thread: GPUI paints on its own thread
  there). So on Linux, automation waits that mean "on screen" use
  `getAllText`, the retained tree, up to a frame early (`scripts/nightly.ts`,
  `window-app.ts`). The fact is pinned by `test/linux-session.test.ts`,
  "getPaintedText is empty on Linux although the window is painted": it
  fails the day gpuix fixes it, and then Linux can wait on painted text.
- **The compositor sizes the window.** A tiling compositor gives a window
  its own size, not the one asked for; `innerWidth`, `vh` and `@media` follow
  the real size (a resize event, as in a browser).
- **A sleeping display stalls automation, not the app.** GPUI draws on the
  compositor's frame callbacks, and a compositor sends none to an output
  that's off (DPMS). Once the app asks for a frame, gpuix's UI-thread queries
  (`getTree`, `getBounds`, a click's lookup) wait for it and time out after 2
  seconds. The app's JavaScript keeps running (no stalls measured). Run window
  tests on a headless output, which never sleeps.
- **Startup noise.** gpuix prints `MESA-EGL: warning: failed to get driver
  name for fd -1` and a wgpu `ERROR_SURFACE_LOST_KHR` line on start and exit.
  Both are harmless.

## Accessibility

Each element's role (its `role`, or the one its tag implies) and name reach
AccessKit. The name is a browser's: `aria-label`, then `aria-labelledby`,
then a `<label for>`, then, for the roles WAI-ARIA names from their content
(a button, link, tab, option, radio, checkbox, switch, heading…), the text
inside, leaving out what's `aria-hidden`. A text change renames the control
it's in. `aria-expanded` and `aria-selected` go as they are. gpuix has no
checked state yet, so `aria-checked` goes as the value: `on`, `off`, or
`mixed`.

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
(`align-self`), and its block parent becomes a column. gpuix has no
`aspect-ratio`, so a box with one and no height of its own gets the height
its laid-out width calls for, a frame after GPUI lays it out (Pixel Art's
`w-full aspect-square` board). `sheetFromCss` lists what it can't follow
instead of guessing:

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
  moves with its own scroll offset. The corner moves back as the content is
  aligned: by half the padding on an axis the content is centred on
  (`justify-content` along the main axis, `align-items` across it), by all
  of it at the end. So a centred button with 16 px side padding read 16 px
  left of where it's drawn (Metal); a single-line input centres its editor
  vertically whatever its style. On Linux, bounds queries wait for a painted
  frame, up to 2 s (see Geometry).
- **Anchored boxes paint.** GPUI paints an anchored element's own box, black
  wherever its content doesn't cover it, even given a transparent
  background: a rounded popup had black corners (Metal). It takes its
  content's corner radii.
- **Box shadows paint under the whole box.** CSS clips an outer shadow to
  outside the border box, but GPUI paints it under the box too, so a focus
  ring on a field with no background filled the field (Metal). A box with a
  shadow and no background of its own gets the solid colour of the box it
  sits on (what shows through in CSS). Over a gradient or a see-through
  backdrop it gets nothing, and the ring fills it.
- **A press goes only to what was pressed.** GPUI sends a press's moves and
  release only to the pressed element, and no enter or leave to anything
  else while the button's held. So an element listening for a press listens
  natively for its moves and release too. Hover during a press is
  hit-tested from the layout, and GPUI's late copies of what the host
  already said are dropped. snabbdom takes an element's listeners off as it
  removes it, so the pressed element keeps its gesture listeners until the
  release. If the app removes it mid-gesture, GPUI's element is held,
  unseen (`opacity: 0`, `pointer-events: none`), until the release.
- **Containing blocks.** Taffy positions an `absolute` box against its
  parent, but CSS uses the nearest positioned ancestor, or the window. The
  host draws such a box under its containing block in GPUI's tree (last, so
  on top). The DOM, styles and events stay where they are. `fixed` uses the
  root, which scrolls, so a fixed box scrolls with the page.

`test/contract.test.ts` runs one app on real GPUI and on the fake
(`test/support/fake-gpui.ts`) and checks they agree on the tree, the focus
sequence and scroll offsets. Headless results mean something only while it
passes.
