# FoldKit Native

FoldKit apps drawn natively by [GPUI](https://github.com/zed-industries/zed/tree/main/crates/gpui)
(Zed's GPU UI framework), in-process, through [gpuix](https://github.com/remorses/gpuix)'s
Node/Bun bindings. No web view, no browser.

React is to React Native as [FoldKit](https://foldkit.dev) is to FoldKit Native: an
ordinary FoldKit app (its `Runtime`, `h` views, Commands, Subscriptions, CSS
and `@foldkit/ui` components) runs unchanged and appears in a native window or
a Wayland layer surface. FoldKit itself is not modified or forked.

> **Status:** an early spike, private. Runs on Linux (Wayland) and macOS
> (Apple silicon, Metal). gpuix also ships a Windows binary, untested here.

## How it works

FoldKit draws by patching a DOM. Off the web there is none, so FoldKit Native
supplies one and mirrors it to GPUI:

```text
FoldKit ──patches──▶ DOM (happy-dom) ──MutationObserver──▶ mirror ──mutations──▶ gpuix ─▶ GPUI
FoldKit ◀─listeners── DOM ◀────dispatchEvent──── mirror ◀──events (click, key, move)── gpuix
```

- **The DOM is [happy-dom](https://github.com/capricorn86/happy-dom)**, the same
  one FoldKit's own tests run in, so FoldKit and snabbdom behave as in a browser.
- **The mirror** (`src/mirror.ts`) replays each DOM change into gpuix's
  retained tree, and turns GPUI's clicks, keys and pointer moves back into DOM
  events on the right element. Drag and drop (FoldKit's `OnDragStart`/`OnDrop`)
  is rebuilt from mouse events.
- **Styles are CSS.** happy-dom resolves stylesheets, classes, inline styles and
  custom properties; `src/style.ts` copies what GPUI can draw (flexbox, grid,
  sizes, spacing, colours, borders, radius, gradients, shadows, fonts,
  `:hover`/`:active`/`:focus-visible`, cursor, `user-select`). GPUI does layout.
  Like a native app, UI text isn't selectable unless its CSS says
  `user-select: text`, so double-clicking a button never highlights its label.
- **Primitives** (`src/primitives.ts`): look-free building blocks for views
  (`box`, `stack`, `row`, `grid`, `text`, `image`, `input`, `scroll`,
  `surface`) with stable `data-part` slots, state attributes and focus/motion
  hooks. No styled components and no theme: those belong to a UI library built
  on top. See [THEMING-SEAMS.md](THEMING-SEAMS.md).
- **Tokens** (`src/theme.ts`): semantic tokens as CSS custom properties,
  switchable at runtime without a restart.

## Use it

```ts
import { mountNative } from 'foldkit-native'
import { Runtime } from 'foldkit'

const native = mountNative({ title: 'My app', css, tokens })   // window + DOM
Runtime.run(Runtime.makeElement({ Model, init, update, view, container: native.container }))
native.setTokens(otherTokens)                                   // switch theme live
```

`mountNative` takes gpuix's window options, including `layerShell` to open the
app as a Wayland layer surface (bar, dock, overlay) instead of a window.

## Run the examples

Needs [Bun](https://bun.sh) and Node's `npm` (for the exact lockfile). On
Linux, also Wayland, EGL/Vulkan and libxkbcommon on the library path (NixOS:
put them on `LD_LIBRARY_PATH`). On macOS nothing else: gpuix's Apple silicon
binary draws with Metal. Run it from a terminal in the logged-in desktop
session (Terminal.app, at the machine or over Screen Sharing) so the window
appears on that screen.

```sh
npm ci                        # exact pins; installs only your platform's gpuix binary
bun run demo                  # examples/themes.ts: primitives + two token sets, switched at runtime
bun run counter               # examples/counter.ts: a FoldKit counter; only the setup import is native-specific
bun test                      # mirror, events, FoldKit, tokens; on macOS also Metal and real windows (TESTING.md)
bun run typecheck
bun run record demo.mp4       # macOS: drives the demo and records its own frames (needs ffmpeg)
```

In the demo, click a row to select it and **switch theme** to swap the whole
token set live; `THEME=paper bun run demo` starts on the light set.

`bun build --compile app.ts` makes one executable. Ship gpuix's `.node` file
next to it and set `NAPI_RS_NATIVE_LIBRARY_PATH` to it: gpuix's loader picks its
platform package dynamically, so the compiler can't embed it on its own.

**Pin gpuix exactly** (`@gpuix/native` and its platform package, same version),
as gpuix's README insists.

## Measured (jemera presentations screen, Umbriel VM, virgl/OpenGL)

| | |
|---|---|
| Process start → first frame | ~480 ms |
| Memory | ~186 MB, one process |
| Click → updated frame | 7–34 ms (style resolution dominates) |
| 60 Hz animation | 59.75 fps; change → frame median 2.2 ms, 95th 6.4 ms |

## What it would take to be a real package

1. **Ship it:** build to JS for Node as well as Bun, publish types for the
   `layerShell` options, and a `--compile` recipe that embeds the `.node` file.
2. **Layout read-back.** happy-dom has no layout, so `getBoundingClientRect`,
   `ResizeObserver` and scroll positions are zero; `@foldkit/ui` popovers,
   menus, tooltips, comboboxes and virtual lists need them. Feed GPUI's painted
   bounds (`getElementBounds`) back into the DOM; use gpuix's `anchored` element
   for popovers and its `virtual-list` for long lists.
3. **Inline text.** GPUI has blocks and flex, not inline formatting; mixed runs
   (`<p>a <b>b</b> c</p>`) become a wrapping row today.
4. **Inputs and focus.** Map `<input>`/`<textarea>` to gpuix's native inputs both
   ways (value, selection, IME) and keep DOM focus and GPUI focus in step, so
   keyboard navigation and focus traps work.
5. **CSS coverage and speed.** Transitions, transforms, `calc()`, `%` sizes; and a
   faster path than happy-dom's `getComputedStyle`, which is most of the sync time.
6. **happy-dom cache bug.** A descendant's cached selector match isn't
   invalidated when an ancestor's attribute changes; the mirror clears the
   caches it restyles. Needs a minimal reproduction and an upstream issue.
7. **Accessibility.** ARIA attributes already reach gpuix's AccessKit props;
   check them with a real screen reader and map roles fully.
8. **More tests.** CI runs the mirror, event, FoldKit and token tests headless,
   and real-GPUI tests on macOS. [TESTING.md](TESTING.md) lists what's covered
   and the layers still to build (conformance against a browser, performance
   budgets, more platforms).
9. **Theming seams** listed in [THEMING-SEAMS.md](THEMING-SEAMS.md) (per-element
   blur, multi-stop gradients, colour transitions…).

## Credits and licences

FoldKit Native is MIT licensed ([LICENSE](LICENSE)). It depends on, and does not
copy code from:

| Project | Licence | Used for |
|---|---|---|
| [FoldKit and @foldkit/ui](https://github.com/foldkit/foldkit) | MIT | The framework this renders (peer dependency) |
| [gpuix](https://github.com/remorses/gpuix) (`@gpuix/native`, incl. its GPUI build) | Apache-2.0 | GPUI bindings and the native renderer |
| [happy-dom](https://github.com/capricorn86/happy-dom) | MIT | The DOM FoldKit renders into |
| [Effect](https://effect.website) | MIT | FoldKit's runtime (peer dependency) |

All are compatible with MIT. If you distribute a compiled binary that embeds
gpuix's native library, include its Apache-2.0 licence and notices with it.
