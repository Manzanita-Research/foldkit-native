# Native components for FoldKit Native (FKN-11, explore)

Jem asked: should FoldKit Native implement @foldkit/ui's (or Base UI's)
components natively, with GPUI drawing them, instead of mirroring a DOM? This
is the answer, with a working spike on this branch (draft PR #14, not for
merge).

## Recommendation

**Drop the DOM engine, not the DOM API.** FoldKit renders through snabbdom,
which writes to the global `document`. Give it a small document whose nodes
*are* gpuix host nodes (option **e** below: a FoldKit adapter for gpuix, a peer
of @gpuix/react and @gpuix/solid). Then GPUI owns focus, Tab order, focus
traps, scrolling and text editing, and the browser behaviours Jem hit (Tab,
scrolling, theme switching) come from GPUI. The mirror no longer has to fake
them one by one. FoldKit is not forked or patched.

On top of that, keep **components as ordinary FoldKit** in a separate,
themeable package (`@foldkit-native/ui`). Their behaviour follows WAI-ARIA and
Base UI, and their API follows @foldkit/ui's. They lean on the platform (a
switch is a real `<button>`, so Enter and Space come from the platform)
rather than re-implementing it per component. They run unchanged in a browser.

Don't build per-component native widgets (options b and c on their own).
gpuix exposes GPUI's primitives (div, text, input, scroll, anchored,
virtual-list), not widgets. A "native switch" is still divs plus focus,
whichever language assembles it. The win comes from GPUI owning the
*behaviours* underneath every component, which the adapter gives all of them
at once.

Keep the mirror as a comparator and a fallback while the adapter is
qualified (FKN-15's M0), not as the product.

## The options, compared

| | (a) Harden the mirror | (b) Native component layer on the mirror | (c) b, specced from Base UI | (d) Hybrid: native components + mirror for the rest | **(e) FoldKit adapter for gpuix (spiked)** |
|---|---|---|---|---|---|
| **App code that changes** | None | Swap `h.input`/@foldkit/ui for the native components | Same as b | Components only | **None for the 8 examples** (all render headless, with the same number of text nodes in the native tree). CSS whose selectors look at an ancestor (Big List's `.row[data-selected] .cell`) moves to inherited custom properties. |
| **What breaks / stays hard** | Every browser behaviour, re-created one at a time on top of happy-dom (Tab, scroll, focus sync, `:focus`, layout read-back). Two layout engines, two focus systems. | Seams between native components and mirrored DOM: two focus systems still. | Same as b | Same as b, plus two styling paths | No CSS engine: descendant and sibling selectors, `::before`, and live media queries aren't supported (they're reported, not guessed). No drag and drop, IME polish or virtual-list yet. Password fields need a gpuix masked input. |
| **Accessibility** | ARIA attributes copied to AccessKit | Components set roles directly | Same, with Base UI's keyboard maps | Mixed | Roles, names (`aria-label`, `aria-labelledby`, `<label for>`), expanded and selected reach AccessKit. Checked goes as value text: gpuix has no checked state. Screen readers not checked yet. |
| **Theming** | CSS + tokens through happy-dom's cascade | Typed theme per component | Same | Two systems | Tokens (custom properties, live and scopable) + parts and state attributes (Base UI's convention), the same CSS on web and native. `:hover`/`:active` become GPUI's own state styles. |
| **Performance** (headless, JS time) | `getComputedStyle` per element dominates | Faster for components only | Same | Mixed | No happy-dom. Start → settled is 2–8× faster headless on every example. Big List's theme switch: 21 ms vs 57 ms (click → settled, macOS CI). Real-GPU first-paint, edit→frame and RSS are not measured yet. |
| **Maintenance** | Grows with every browser behaviour any app touches | Two layers to keep in step | Same | Highest: two paths | One small DOM facade (dom.ts ~880 lines) + host (~760) + sheet (~330). Grows with the DOM APIs FoldKit and @foldkit/ui touch, which is bounded and testable. |

## What the spike is

```text
FoldKit view ──snabbdom──▶ native document (dom.ts) ──host.ts──▶ gpuix mutation queue ─▶ GPUI
FoldKit ◀──DOM events───── native document ◀──────────────────── GPUI events, focus, scroll
```

- **`packages/foldkit-gpuix`**: the bindings, kept apart from looks.
  - `dom.ts`: the DOM FoldKit and @foldkit/ui touch. Nodes, events with
    capture and bubble, attributes, inline style, `classList`, `dataset`,
    form properties, and a selector engine for `querySelector`, `matches`
    and `closest`.
  - `host.ts`: draws it with gpuix and owns the browser's default actions.
    - Tab and Shift-Tab are GPUI's `focusNext`/`focusPrevious`, or
      `focusNextWithin` inside an `aria-modal` scope.
    - `document.activeElement` follows GPUI's focus, and `element.focus()`
      calls `focusElement`.
    - Keys go to the focused element and bubble. Buttons and links
      activate on Enter, buttons also on Space key-up.
    - A focused scroll area scrolls with the keys.
    - `autofocus` takes focus on insert, and focus returns when a modal
      closes.
    - `getBoundingClientRect` reads GPUI's layout.
  - `sheet.ts`: styles without a cascade engine. Rules whose selectors look
    at one element, with specificity, source order, inline style and
    `!important`. Custom properties and text properties inherit. `:hover`
    and `:active` become GPUI state styles, and `:focus`/`:focus-visible`
    follow GPUI focus and input modality. It reads the CSS the repo already
    generates (`bun run css`); no separate Tailwind compiler.
- **`packages/ui`** (`@foldkit-native/ui`): TextField, Switch, ScrollArea,
  Listbox (a submodel: Model, Messages, update) and Dialog, plus a theme with
  two token sets (dusk, paper). There are three theming layers: semantic
  tokens, component tokens that fall back to them, and parts and states as
  data attributes.
- **`examples/native-ui`**: a preferences panel with both. Its controls:
  - Two fields (Tab between them, email validated).
  - A switch that flips the whole token set live.
  - An accent-colour listbox in a scroll area (arrows move the highlight and
    scroll it into view; letters jump).
  - A reset dialog (focus moves in, Tab stays in, Escape closes, focus comes
    back). The theme is data in the Model, set on the root as custom
    properties, with no Command.

## Evidence

| What | Result |
|---|---|
| Tests, headless (Linux, m6) | 294 pass, 27 skip (macOS-only), 0 fail; typecheck and `css --check` clean |
| Real GPUI (Metal, macOS CI on PR #14) | `3578dcb`: 430 pass, 6 fail. `35e66c6`: 438 pass, 3 fail. `54ef7ff`: 440 pass, 3 fail (below). Headless says nothing about real GPUI; only these runs do. |
| The 8 unmodified examples on the adapter | All render headless with the same number of text nodes in the native tree as the mirror (Big List 186, Pixel Art 48, Kanban 44…). This compares retained trees, not pixels. |
| Start → settled, headless JS time (not first paint, not memory) | mirror vs adapter on macOS CI: Big List 105 vs 28 ms, Pixel Art 400 vs 64, Snake 182 vs 43, Kanban 70 vs 26, Shopping Cart 50 vs 22, Form 29 vs 19, Weather 26 vs 21 |
| Big List theme switch, click → settled | adapter 21 ms, mirror 57 ms (macOS CI); both switch correctly headless |
| Form, unmodified, Tab (the FKN-13 bug) | name → email → message → button, headless and through GPUI's own focus on Metal |
| Example selectors the flat sheet accepts | Big List 91% (6 parent-state selectors), the Tailwind examples 75–79% (the rest are preflight's `::before`/`::placeholder` and `<select>` rules, which don't apply to GPUI), native-ui 100%. This counts accepted **selectors**, not declaration fidelity. |
| @foldkit/ui on the adapter, unmodified | Its Switch toggles by click and by Space (its own key-up handler), with `aria-checked` |

What the real-GPU runs taught (PR #14's macOS job). Adapter bugs and test
harness corrections are listed apart, so neither gets credit for the other:

Adapter bugs, fixed:

1. **Clicking into a GPUI input sends no focus event.** GPUI's editor takes
   focus itself, so the document missed it. Now the DOM follows GPUI's focus
   at four points: before each key, on the root's press and release, and
   when a field reports typing (`54ef7ff`).
2. **GPUI's editor types a tab before Tab moves focus.** The adapter now drops
   a change that is exactly the old value plus one tab, and puts the old
   value back in GPUI, before FoldKit hears anything (`35e66c6`). This is a
   **workaround**: gpuix gives no way to stop the edit before it's reported,
   and a pasted lone tab would be dropped too. Pasted text with tabs, and
   other edits, pass through.
3. **Repeated keys were dropped.** GPUI delivers queued keystrokes in one
   task, and a per-keystroke dedupe in the adapter ate the repeats (down down
   down → one down). That broke the listbox on Metal. Keys only come from
   window events now, so the dedupe is gone (`54ef7ff`).

Test-harness correction:

4. **Space's key-up.** GPUI's offscreen `simulateKeystrokes` sends key-down
   only, and a button activates on Space's key-up (as in a browser). So the
   Metal tests now send down and up explicitly. A real window sends key-up;
   that still needs checking by hand on the Mini, along with one activation
   per press.

Still red at `54ef7ff` (3 of 443 on Metal), handed to FKN-15 M0.2:
- **Form: the document's focus lags a click by one key.** After a click into
  a field, GPUI has focus and the document still says `body` until the next
  key. Tab, typing and later focus all agree. So GPUI's editor stops the press
  from reaching the root's listener. Next: listen for the press on the field
  itself.
- **native-ui: arrows then Enter didn't pick "green".** The same arrows work
  in the standalone Listbox on Metal (it scrolls to the 9th option).
  The next run logs focus and highlight before the assertion, to say why.
- **The standalone Listbox assertion.** It failed only because my diagnostic
  call to gpuix's `scrollIntoView` also scrolled the page. The diagnostic is
  gone; the list itself scrolled correctly (`scrollTop` 208).

A wrong diagnosis, retracted: I first blamed gpuix's `scrollIntoView` for
the listbox. Called directly on Metal, it does scroll a plain scrolling div
(offset `[0,-173]`); the real cause was item 3. The adapter's reveal now
uses painted bounds + `scrollTo`, with the native call as the fallback.
Either way it needs layout read-back, which on a live window is the
synchronous `getElementBounds` (plan M1.9). Nested or clipped scroll areas
and stale layout are outside what it promises today.

Also fixed after Astra's source review:
- Removed attributes now clear their GPUI props.
- Disabling the focused element moves focus off it.
- The sheet has specificity and `!important`.

Screenshots come from the Metal tests; the macOS CI job uploads them as
the `example-screenshots` artifact on PR #14 (`gpuix-*` and `ui-*` files).

## What I learned

- **gpuix already has the browser's hard parts**: tab stops, `focusNext`,
  `focusNextWithin` (a focus trap in one call), scroll handles,
  `scrollIntoView`, `anchored`, `virtual-list`, AccessKit. The mirror's bugs
  came from translating a DOM into it after the fact, not from gpuix.
- **FoldKit's runtime needs only a modest DOM.** snabbdom uses about fifteen
  calls. The runtime adds `querySelector`, `activeElement`, listeners and
  `requestAnimationFrame`. @foldkit/ui adds focusable-element queries, `inert`
  and `MutationObserver`. All unmodified examples ran on a first-day facade.
- **Most app CSS is already "one element per selector".** Tailwind's
  utilities and Base UI-style `[data-state]` styling both are. The real casualty
  is styling a child from its parent's state. Custom properties, which
  inherit, are the clean replacement and work on the web too.
- **@foldkit/ui is headless and good.** Its components are attribute bundles
  plus `foldkit/dom` Commands (focus, showDialog, scrollIntoView). With
  GPUI-owned focus and scroll under the DOM API, those Commands just work. So
  the UI library should *skin* @foldkit/ui-shaped behaviour, not reinvent it.
  The spike's components keep @foldkit/ui's config names so swapping is an
  import.

## Not done, honestly

These are scoped in FKN-15's M0 (owned by this thread):

- **Lifecycle.** `detach()` releases the binding but not the runtime or
  timers, and `mountGpuix` exits the process on window close.
- **Stubbed APIs.** The `MutationObserver`, `ResizeObserver` and
  `IntersectionObserver` stubs, no-op `history` and in-memory storage
  should behave or reject loudly.
- **The sheet.** Media queries are fixed at load (no resize), and
  `@supports` is always taken.
- **Anchored Select.** Not built. Listbox is the composite here.
- **Missing features.** Drag and drop (the mirror has it), IME and
  selection details, `virtual-list`, pointer capture.
- **Password fields.** gpuix has no masked input, so a password field shows
  its text. It should be rejected until gpuix has one.
- **Geometry on a live window.** `getBoundingClientRect` calls GPUI's
  synchronous `getElementBounds`, which can block for up to 2 s when a window
  isn't painting. It needs caching per frame.
- **Accessibility.** Not checked with a screen reader. AccessKit has no
  checked state through gpuix.
- **Linux.** Real-GPU checks are macOS-only: gpuix can't read frames back on
  Linux, and the m6 window didn't paint while its screen was asleep.

## Run it on the Mini

```sh
cd /Users/jem/code/manzanita-research/foldkit-native-agents   # or any checkout
git fetch origin jem/explore-fkn-11-native-gpui-components-opus-thr_nftnu8ukkz
git worktree add ../fkn-11 FETCH_HEAD && cd ../fkn-11
npm ci
bun run example native-ui        # the spike app in a window, drawn by FoldKit on gpuix
bun run record native-ui         # still + clip from GPUI's own frames → evidence/native-ui.{png,mp4} (needs ffmpeg)
bun test packages examples/native-ui   # adapter + components + the app: headless and Metal
```

To try with the keyboard: Tab, then type a name; Tab, then type an email;
Tab, then Space flips the theme; Tab, then the arrows and Enter pick an
accent; Tab, then Enter opens the dialog; Tab cycles inside it; Escape closes
it.

Any unmodified example also runs on the adapter by setting
`renderer: 'gpuix'` in its `meta` (in `examples/<name>/app.ts`).
