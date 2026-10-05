# Moving a FoldKit app from the web to FoldKit on gpuix

A FoldKit app's Model, Messages, update, view, Commands and Subscriptions
move as they are. What changes is the entry point, some of the CSS, and a
few things a browser gave the app for free. This page goes through them in
the order you'll meet them. [CAPABILITIES.md](CAPABILITIES.md) has the
full list of what works, what's approximated and what's refused.

Claims here cite the test that holds them, as
`[file](path) "a piece of the test's title"`.
[`test/capabilities.test.ts`](test/capabilities.test.ts) checks that each
cited test exists, so this page fails CI before it goes stale.

## 1. The entry point

On the web, FoldKit renders into an element of the page:

```ts
Runtime.run(Runtime.makeElement({ Model, init, update, view, container: document.getElementById('app')! }))
```

On gpuix, the window gives you the container. Tie the runtime to the
window with `own`, so closing the window disposes it:

```ts
import { Runtime } from 'foldkit'
import { mountGpuix } from 'foldkit-gpuix'

const app = mountGpuix({ title: 'Notes', appId: 'dev.example.notes', width: 800, height: 600, css })
app.own(Runtime.embed(Runtime.makeElement({ Model, init, update, view, container: app.container })))
```

Nothing else in the app changes for this: the seven ported examples run
unmodified ([versus-mirror](test/versus-mirror.test.ts) "first render,
every example"), and Mounts, `Render.afterCommit` and the crash view behave
as on the web ([lifecycle](test/lifecycle.test.ts) "a Mount starts when its
element is drawn"; [lifecycle](test/lifecycle.test.ts) "a crash in update
draws the crash view").

- **`appId`** names the app's data folder, where `localStorage` lives as a
  file. Without one, `localStorage` is in memory and says so once
  ([storage](test/storage.test.ts) "each change is on disk when the call
  returns").
- **`css`** is the app's stylesheet as a string (section 2).
- **Closing**: `app.close()` runs your `onClose` handlers first, so they can
  save ([app](test/app.test.ts) "closing waits for a handler that saves").
  On macOS a person closing the window ends the process with no JavaScript
  running ([app](test/app.test.ts) "a native close (the red button) ends
  the process inside GPUI"). Anything that must survive goes to
  `localStorage` as it changes, not at close.

## 2. CSS

There's no CSS engine. A flat sheet matches each rule against the element
and, through descendant and child combinators, its ancestors as they are
([sheet](test/sheet.test.ts) "descendant and child combinators follow an
ancestor"). The cascade, custom properties, live `@media`, `@supports`,
`vh`/`vw` and auto margins work.

**Tailwind 4**: emit plain CSS first. `bun run css` (`scripts/css.ts`)
compiles the classes an app uses and lowers nesting, cascade layers and
modern colours. Each example's `styles.native.css` is its output.

**What's refused is reported, not guessed.** `app.unsupported` lists every
rule the sheet can't follow, and `FOLDKIT_GPUIX_DEBUG=1` prints them at
start ([adapter](test/adapter.test.ts) "sheetFromCss reports what a restyle
can"). How each kind usually moves:

| Refused | Instead |
|---|---|
| Sibling combinators (`+`, `~`), and Tailwind's `space-y-*`/`space-x-*` | `gap` on a flex or grid parent |
| `:first-child`, `:last-child`, `:nth-child` | A data attribute from the view (`data-first`) |
| `::before`, `::after`, `::placeholder` | A real element; the `placeholder` attribute for fields |
| A state on an ancestor (`group-hover:`) | A state attribute on the ancestor and a descendant rule (`.row[data-selected] .cell`), or an inherited custom property |
| `z-index` | Document order: later siblings paint over earlier ones |

`:hover` and `:active` are GPUI's own state styles, and `:focus-visible`
follows input modality as Chrome judges it ([adapter](test/adapter.test.ts)
":focus-visible styles show for keyboard focus, not for a click").

A box shadow paints under the box too, so a ring on a box with no
background gets its backdrop's colour ([adapter](test/adapter.test.ts) "a
box with a shadow and no background gets the solid colour it sits on").
Give such boxes a background if they sit on a gradient.

## 3. Layout reads

`getBoundingClientRect`, `offsetWidth` and `elementsFromPoint` answer from
GPUI's last layout, not a fresh one ([geometry](test/geometry.test.ts) "the
border box, a scrolled area and what it scrolled"). An element added since
the last frame reads as zeros, like an element a browser hasn't rendered.
Read after the frame that draws it: in a `requestAnimationFrame`, or a
Command after `Render.afterCommit` and a frame
([lifecycle](test/lifecycle.test.ts) "requestAnimationFrame runs before
GPUI draws").

Absolutely and fixed positioned boxes go under their CSS containing block,
but a `fixed` box scrolls with the page ([sheet](test/sheet.test.ts) "an
absolute box under a static parent is drawn under the nearest positioned
ancestor"). For a popup that must sit beside its trigger and over
everything, use GPUI's anchored element (`data-fn-anchored`, or
@foldkit-native/ui's Select and Popover) ([ui select](../ui/test/select.test.ts)
"the popup is an anchored element").

## 4. Text fields

`<input>` and `<textarea>` are GPUI's own editors: selection, IME, undo,
clipboard and the caret are GPUI's ([keyboard](test/keyboard.test.ts)
"copy, paste, cut, undo and redo in GPUI"). Controlled values work
([adapter](test/adapter.test.ts) "a keystroke the model refuses comes back
out of the editor").

- **Password fields are refused**: mounting `<input type="password">`
  throws, because gpuix has no masked input ([adapter](test/adapter.test.ts)
  "a password field throws as it"). Keep secrets out of the window for now
  (the system keychain, or a sign-in in the browser).
- A field whose `autocomplete` marks a secret (`one-time-code`,
  `current-password`…) is never served by automation
  ([automation](test/automation.test.ts) "the painted text has the name and
  bullets for the one-time code"). The window still shows it.
- IME arrives as the final value only: there are no `compositionstart` or
  `compositionend` events.

## 5. Browser APIs

| On the web | Here |
|---|---|
| `history`, `location` | In memory, with `popstate`: routing inside one window works; there's no address bar ([lifecycle](test/lifecycle.test.ts) "history: push, replace, back and forward") |
| `matchMedia` | Sizes, hover, pointer and orientation; no preference queries, and listeners never fire, so re-query on `resize` ([lifecycle](test/lifecycle.test.ts) "matchMedia: widths against the window") |
| `ResizeObserver` | From GPUI's per-frame layout ([platform-commands](test/platform-commands.test.ts) "ResizeObserver: the first size") |
| `IntersectionObserver` | Absent: feature-detect it ([lifecycle](test/lifecycle.test.ts) "IntersectionObserver is absent") |
| `getComputedStyle` | The sheet's declared values ([platform-commands](test/platform-commands.test.ts) "getComputedStyle and checkVisibility read the sheet") |

## 6. Components

`@foldkit-native/ui` keeps @foldkit/ui's config and message names, so
moving a component is an import. Its views are drawn and themed (tokens,
parts and state attributes) rather than handed to your `toView`: a
`label`, `description` or `content` stands where `toView` was. Each
component's keyboard path, both themes and its AccessKit roles are tested
in `packages/ui/test/` (for one: [ui tabs](../ui/test/tabs.test.ts)
"Automatic: one tab stop; the arrows select").

## 7. Testing and driving a window

- **Headless**: `attachGpuix` on the repo's fake GPUI runs an app with no
  window, in any test runner (see `test/support.ts`).
- **On Metal**: gpuix's offscreen `TestRenderer` gives real layout, focus
  and pixels on a Mac.
- **A real window, from outside**: gpuix's automation drives an app over its
  stdin and stdout, but only if the app asks for it. Start the app with
  `FOLDKIT_NATIVE_AUTOMATION=1`, or pass `automation: true`
  ([automation](test/automation.test.ts) "serves no automation by
  default"). A shipped app never serves it by default. The README's
  "trusted-process boundary" says why.
