> **Superseded (Oct 4).** M0 is done: see [docs/M0-MEMO.md](docs/M0-MEMO.md) for what was
> fixed, the measurements and the open list. This file is FKN-11's handoff, kept as a record.

# Handoff: FKN-11 → FKN-15 M0 (qualify the adapter)

From the FKN-11 explorer thread (thr_nftnu8ukkz, on jemarchy-m6) to whoever
takes M0 on the Mini. Read `COMPONENTS.md` first for the why; this file is
the state and the next steps. The plan is FKN-15 rev 3 (approved), M0.1–M0.5.

## State

- Branch `jem/explore-fkn-11-native-gpui-components-opus-thr_nftnu8ukkz`,
  draft PR #14 (do not merge; it exists for the macOS CI run).
- `packages/foldkit-gpuix`: the adapter (native document `dom.ts`, `host.ts`,
  flat `sheet.ts`, `index.ts` with `attachGpuix`/`mountGpuix`).
- `packages/ui`: TextField, Switch, ScrollArea, Listbox, Dialog and the theme.
- `examples/native-ui`: the spike app (`renderer: 'gpuix'` in its meta;
  `examples/open.ts` picks the adapter for it).
- Shared files touched, all small and additive: `examples/open.ts`,
  `examples/support/example.ts` (`renderer`, `libraryCss`), `package.json`
  (`./style` export), `tsconfig.json` (paths for the packages).
- Headless on Linux: 294 pass, 27 skip (macOS-only), 0 fail. Typecheck and
  `bun run css --check` are clean.

## The 6 Metal failures (first run, `3578dcb`) and what was done

PR #14's macOS job by commit:
- `3578dcb`: 430 pass, 6 fail.
- `35e66c6`: 438 pass, 3 fail.
- `54ef7ff`: 440 pass, 3 fail (below).

| Failure | Cause | Fix | Kind |
|---|---|---|---|
| Form: GPUI focus name/email/message, document body/email/message | A click into a GPUI input sends no focus event; the editor takes focus itself | The DOM follows GPUI's focus before each key, on the root's press and release, and when a field reports typing (`54ef7ff`) | adapter |
| TextField: name was `"Ada\t"` | GPUI's editor inserts the tab before Tab's default action runs | The change that is exactly old + one tab is dropped and the old value restored, before FoldKit hears it (`35e66c6`). A workaround: a pasted lone tab is dropped too | adapter |
| Listbox: option bottom 309 below the list's 140; native-ui "green" | A per-keystroke dedupe dropped repeated keys GPUI delivers in one task | Dedupe removed; keys only come from window events (`54ef7ff`) | adapter |
| Switch, Big List, native-ui: Space did nothing | GPUI's offscreen `simulateKeystrokes` sends key-down only; buttons activate on Space key-up | Tests send down + up (`press()` in `packages/foldkit-gpuix/test/support.ts`). Confirm in a real window on the Mini | harness |

### Still red at `54ef7ff` (start here)

1. **Form: the document's focus lags a click by one key.**
   - After `click(name)`, GPUI focus is `name` but `activeElement` is `body`.
   - After Tab, both say `email`.
   - So neither the root's press nor its release reached the adapter: GPUI's
     editor seems to stop them.
   - Try listening for `mouseDown` on fields themselves (`listenNatively` in
     `syncProps`) and reconciling there, then check clicking outside.
   - The log prints `gpuix form after click:`.
2. **native-ui: arrows then Enter didn't select "green"** (metal.test.ts,
   native-ui test).
   - The same keys work in the standalone Listbox Metal test.
   - The next run logs `gpuix native-ui before arrows:` and `after arrows:`
     (document focus, GPUI focus, highlighted option).
   - Suspects: GPUI focus not on the list after `.focus()` following the
     Space press, or `reconcileFocus()` pulling focus elsewhere before each
     key.
3. **Standalone Listbox.** Fixed by removing my diagnostic: calling gpuix's
   `scrollIntoView` directly scrolled the page too, which broke the bounds
   assertion. The list itself scrolled correctly (`scrollTop` 208).

4. **Seen in the Metal screenshots** (`thr_nftnu8ukkz/evidence/run-54ef7ff/`,
   listed in COMPONENTS.md):
   - The dialog panel isn't centred: the `inset: 0` layer doesn't fill the
     window in gpuix. Try explicit `width`/`height: 100%`.
   - The unmodified Form doesn't centre or fill the window: no `vh` and no
     `margin: auto` yet.
   - Big List's selected-row cells stay grey: the 6 parent-state selectors,
     as reported.

Retracted: gpuix's `scrollIntoView` is not broken on plain scrolling divs.
Called directly on Metal it scrolled (`[0,-173]`). The adapter's `reveal()`
uses bounds + `scrollTo`, with the native call as fallback. Both need layout
read-back, which on a live window is a synchronous `getElementBounds`
(plan M1.9).

Also in `35e66c6`, from Astra's source review:
- Props are diffed, so removed `aria-label`, `tabIndex`, `placeholder` and
  `readOnly` are sent as `null`.
- Disabled fields are read-only, and disabling the focused element moves
  focus off it.
- The sheet has specificity (a state pseudo-class counts as a class),
  source order, inline style, then `!important`.

Headless tests for each are under "fixes from the first real-GPUI run" in
`packages/foldkit-gpuix/test/adapter.test.ts`.

Astra's acceptance constraints for these fixes (keep them):
- **Tab.** No blanket sanitiser, and no transient tab value reaching
  FoldKit. Test Shift-Tab, controlled-value updates and composition.
- **Reveal.** Must not block on a live window. Define what happens with
  stale or unavailable layout, and with nested or clipped scroll areas.
- **Focus.** It must be observed after GPUI commits it: clicking into an
  unfocused field and clicking outside should give matching native and
  document sequences with no extra Tab.
- **Space.** Confirm in a real window, one activation per press and release.

## Run the suites (on the Mini)

```sh
npm ci
bun test packages examples/native-ui         # adapter + components + spike app (Metal on a Mac)
bun test packages/foldkit-gpuix/test/metal.test.ts   # just the real-GPUI adapter checks
bun test packages/foldkit-gpuix/test/versus-mirror.test.ts   # mirror vs adapter, same apps (prints a table)
bun test packages/foldkit-gpuix/test/css-coverage.test.ts    # accepted selectors per example
bun test                                     # everything
bun run typecheck && bun run css --check
bun run example native-ui                    # a real window
bun run record native-ui                     # still + clip (ffmpeg), from GPUI's own frames
```

Screenshots from the Metal tests go to `$FOLDKIT_NATIVE_EVIDENCE` (CI
uploads `example-screenshots`): `gpuix-*.png` from the adapter tests and
`ui-*.png` from the components.

## Next steps (M0, in the plan's order)

1. **M0.2 first.**
   - Get PR #14's macOS job green.
   - Extend a fake-vs-real contract to focus order and scroll offsets. The
     fake's tab order (`createFocusableFake` in test/support.ts) assumes
     GPUI's order is `tabIndex`, then tree order; Metal agreed on the Form
     and dialog sequences.
   - Check Space's key-up in a real window (`bun run example native-ui`,
     Tab to the switch, Space).
2. **M0.1 lifecycle.**
   - `detach()` should release the root's native tree, timers and the
     FoldKit runtime.
   - `mountGpuix` calls `process.exit` on window close.
   - The stubs (`index.ts` observers, `dom.ts` history, storage,
     `getSelection`, timer rAF) should each behave or throw a clear error.
3. **M0.3 sheet.**
   - Media queries are evaluated once at load: re-evaluate on resize.
   - `@supports` is always taken.
   - Add tests for removal, keyed reparent and token swap (the code
     restyles the whole subtree on any attribute change, so they likely
     pass; prove it).
   - Measure a theme switch on a 2,000-element screen, on both paths.
4. **M0.4.**
   - An anchored Select on gpuix's `anchored` element (the Listbox is the
     list part).
   - Reject `type=password` (host.ts `nativeType` treats it as text today).
   - The missing list, each with a size: drag and drop, IME and selection,
     `virtual-list`, pointer capture.
5. **M0.5 memo.**
   - Equal-workload real-GPU numbers: first paint, edit → frame, theme
     switch, RSS.
   - Draft gpuix upstream asks for Jem: a password input, a `focusVisible`
     style state, `scrollIntoView` on plain scroll divs, Linux read-back.

## Open questions

- **Geometry on a live window.** `getBoundingClientRect` and `reveal()` call
  `getElementBounds` synchronously. On a window that isn't painting, that
  blocks for up to 2 s (memory `gpuix-bounds-queries-cost`). Cache it once per
  frame (plan M1.9)?
- **Window key events.** Does GPUI send window key events while an input has
  focus, for every key? The adapter dedupes per keystroke, so both paths are
  safe, but Backspace and the arrows inside a field are untested on Metal.
- **Linux.** The adapter has only been seen headless there. m6's live window
  didn't paint while the display slept (DPMS off), so automation timed out.
  That's a test-session question (plan M1.6), not a GPUI verdict.
- **What carries to the mirror for FKN-13.** The FKN-4 lead was told the
  focus recipe (Tab via `focusNext` unless prevented, `activeElement`
  following GPUI, `focus()` → `focusElement`, focus listeners for handles).
  The two Metal findings above (no focus event on editor click; editor
  inserts `\t`) apply to the mirror too.

## Environment notes

- m6 has no global bun. This thread used a copy fetched with npm into its
  temp dir (`$TMPDIR/fkn11-bun`). The Mini has bun.
- On m6, sandboxed commands can't reach the Wayland socket (`NoCompositor`),
  and `bb` needs to run outside the sandbox.
