# M0 decision memo: FoldKit on gpuix (FKN-20)

For Jem. A go/no-go on M1 (FKN-21–29). Written Oct 4, 2026, by the M0 owner
thread (thr_jrys2u6ybd, Claude Opus 5.5, on the Mac mini).

## The short version

- **Recommendation: go.** Make the adapter (`packages/foldkit-gpuix`) the
  product path, and keep the happy-dom mirror only as a regression
  comparator.
- **M0's gate is met.** The real-GPU run is green: macOS CI passes on every
  merged PR (#19–#23, 505 tests locally on the Mac mini). A contract test
  checks the fake GPUI used by the headless tests against real GPUI (Metal) on
  the tree, focus order and scroll offsets, so headless results mean
  something. Space on a button activates once, on its release, in a real
  window (driven by automation; a physical keyboard still needs a person).
- **It's faster and smaller, with real-GPU numbers.** Same apps, same input,
  live windows, one process at a time:
  - first paint: 7–16% faster;
  - memory: 9–16% less;
  - a keystroke appears about 2× sooner;
  - Big List's theme switch: 2.9× faster.
- **What it costs.** gpuix has rough edges. The adapter works around nine of
  them, each pinned by a test, and each is drafted below as an upstream ask
  for you. A few browser features are honestly missing (drag and drop, IME
  events, virtual lists, pointer capture). Each is sized below.
- **What you decide:** go or no-go on M1, and whether to send the gpuix asks
  upstream. Nothing goes outside Manzanita-Research without you.

## What M0 delivered

| Task | PR | What |
|---|---|---|
| FKN-17 (M0.2) | #19 | FKN-11's adapter on main, with the last Metal reds fixed: a click into a field, Shift-Tab, Tab typing tabs, controlled values, a scrolled list's box, disabled fields as tab stops. The fake-vs-real contract test. Space activates once, on its release, in a real window |
| FKN-16 (M0.1) | #20 | Lifecycle: `own()` + `detach()` dispose the FoldKit runtime, free the native tree (gpuix's retained count goes to **0** on Metal), and restore globals. Closing the window no longer kills the process blindly. Every stubbed browser API now behaves or says it doesn't |
| FKN-18 (M0.3) | #21 | The style sheet's contract, gate by gate. Descendant and child combinators fix Big List's selected-row cells. Live `@media` on resize, real `@supports`, `vh`/`vw`, and auto margins fix the Form's centring |
| FKN-19 (M0.4) | #22, #23 | Containing blocks (the dialog centres) and a browser's tab order. A Select on gpuix's anchored element. FoldKit's own `Dom` Commands run natively. Password fields are refused rather than shown in plain text |
| FKN-20 (M0.5) | this PR | The measurements, this memo, and a fix the measurements found: `requestAnimationFrame` now runs before GPUI draws, as in a browser |

All three gaps you saw in FKN-11's screenshots are fixed, with before/after
images on #21 and #22:
- the dialog wasn't centred;
- Big List's selected-row cells stayed grey;
- the Form wasn't centred or full height.

## Measurements

### Real GPU, equal workload (`scripts/measure.ts`)

Each example runs on both paths: `FOLDKIT_NATIVE_RENDERER=mirror|gpuix bun
examples/open.ts <example>`, a separate process each time, in a live window
on the Mac mini (M1, Metal). gpuix's automation channel drives it. Every wait
polls the text in GPUI's last *painted* frame, so the automation round trip
(a few ms) is in every number, on both paths alike. 5 processes per path;
each interaction 10 times per process.

| Example | Measure | Mirror, median (p90) | FoldKit on gpuix, median (p90) | Mirror ÷ gpuix | Samples per path |
|---|---|---|---|---|---|
| form | first paint (ms) | 606 (p90 699) | 566 (p90 581) | 1.07× | 5 |
| form | RSS (MB) | 272 (p90 273) | 251 (p90 252) | 1.09× | 5 |
| form | keystroke → visible (ms) | 12.0 (p90 22.5) | 5.5 (p90 11.6) | 2.18× | 50 |
| big-list | first paint (ms) | 704 (p90 748) | 607 (p90 1648) | 1.16× | 5 |
| big-list | RSS (MB) | 333 (p90 348) | 288 (p90 288) | 1.16× | 5 |
| big-list | theme switch (ms) | 67.2 (p90 75.3) | 23.2 (p90 43.5) | 2.90× | 50 |
| big-list | filter keystroke → new count painted (ms) | 55.7 (p90 104.0) | 34.4 (p90 49.2) | 1.62× | 50 |

How to read it:
- **First paint** runs from spawning the process until the example's text is
  in a painted frame. Bun's start-up and module loading are included and are
  the same for both paths, so the relative gap is small. The adapter's p90
  for Big List (1.6 s) is one slow run out of five, not repeated in the
  other runs (raw values are in the evidence log).
- **RSS** is the whole process (bun, GPUI, Metal) once settled. The adapter
  saves 21–45 MB, mostly happy-dom.
- **Keystroke → visible** (Form): GPUI's editor draws the character on both
  paths. The difference is what each path does with the change before the
  next frame.
- **Theme switch** and **filter**: model → view → native styles → painted.
  This is where the adapter's lack of a DOM engine shows most.

### Headless (JS time only, not paint or memory)

| | Mirror | Adapter |
|---|---|---|
| Theme switch on a 2,005-element screen, same app and CSS, median of 5 (`theme-switch.test.ts`) | 168 ms | 41 ms |
| Start → settled per example (FKN-11's `versus-mirror.test.ts`) | Big List 105, Pixel Art 400, Snake 182, Kanban 70, Shopping Cart 50, Form 29, Weather 26 ms | 28, 64, 43, 26, 22, 19, 21 ms |

The FKN-11 "2–8× faster" figure is the second row. It is headless
start-to-settled JS time, checked by text-node count, and it is **not** first
paint or memory: the first table has those.

### What the measuring found

The first runs showed the adapter's Form keystrokes *slower* (27 vs 11 ms).
There were two reasons:
- **The measurement.** Automation's `getByText` reads gpuix's retained tree,
  which the mirror updates a frame before it paints. The script now waits on
  painted text instead.
- **The adapter.** M0.1 had made `requestAnimationFrame` run *after* GPUI
  drew, a frame late. It now runs before GPUI draws, as a browser's does,
  and its changes go into that frame.

## Capability contract v0

What an app gets on FoldKit on gpuix today. "Behaves" means it's tested
against what a browser does; "missing" means the app is told, not given a
silent stand-in. The adapter's README has the full tables.

| Area | Status |
|---|---|
| FoldKit itself | Unmodified. `Runtime.embed` + `own()`; Mounts, Submodels, `Render.afterCommit`, crash view, Commands, Subscriptions all run. The 7 FoldKit examples render the same number of text nodes as on the mirror (`versus-mirror.test.ts`), and Big List and the Form were checked on Metal |
| Focus and keyboard | GPUI's focus, the document's tab order (a browser's: positive tab indexes first), focus traps for `aria-modal`. Enter and Space activate, Space on its release. `:focus` / `:focus-visible` follow input modality. A click into a field focuses it |
| Text fields | GPUI's editors; `input` per change, `change` on blur; controlled values work, including refusing a keystroke. Tab never types. **Password: refused** (no masked input in gpuix) |
| Scrolling | GPUI's. `scrollTop`, `scrollIntoView` (only the nearest scroll area), keys on a focused scroll area, and `getBoundingClientRect` give the border box where it's drawn |
| Styles | No cascade engine. Rules with descendant and child combinators (ancestors at rest), specificity, `!important`, custom properties and inherited text. Live `@media`, evaluated `@supports`, `vh`/`vw`, auto margins. **Missing:** sibling combinators and structural pseudo-classes (`space-y-*`), ancestor states (`group-hover:`), pseudo-elements, `z-index`. Unsupported rules are listed per app |
| Layout | GPUI (taffy). Absolutely and fixed positioned boxes go under their CSS containing block. A `fixed` box scrolls with the page (the root scrolls) |
| Overlays | `@foldkit-native/ui` Dialog (centred, focus trap, focus return), Select (GPUI's anchored element: flips to fit, paints on top), FoldKit's `Dom.showDialog` modal isolation |
| Browser APIs | MutationObserver, rAF, history/location (in memory, with `popstate`), sessionStorage, getSelection, and matchMedia behave. localStorage was in memory and warned once (since FKN-22: written through to a per-app file). ResizeObserver and IntersectionObserver are absent |
| Accessibility | Roles, names and expanded/selected reach AccessKit (the Select test reads ComboBox/ListBox/ListBoxOption from `getA11yTree()`). Checked state goes as value text. **Not yet checked with a screen reader** (M2.1) |
| Platforms | macOS on Metal: tested offscreen and in real windows in CI. **Linux: headless only.** gpuix can't read frames back on Linux, so real-GPU checks there need the M1.6 test session |
| Lifecycle | `detach()` frees everything. Correction (FKN-22): a native window close on macOS ends the process inside GPUI's tick, so `onClose` never ran there; FKN-22's app handle runs `onClose` for `close()` and writes `localStorage` through instead |

## The honest missing list

Sizes: S ≤ 1 day, M 2–3 days, L 1–2 weeks, XL longer. One Opus builder each.

| Missing | What it needs | Size |
|---|---|---|
| Drag and drop (@foldkit/ui's, Kanban's) | `document.elementsFromPoint` from painted bounds, which is cheap only once bounds are cached per frame (FKN-29). Pointer events already flow | M, after FKN-29 |
| IME and selection events | gpuix's editors handle IME inside GPUI but send only the final value: no `compositionstart`/`end`, no `selectionchange`. Needs gpuix to emit them (an ask below), then the adapter maps them | M (adapter), after gpuix |
| Virtual lists | gpuix has a native `virtual-list`. @foldkit/ui's virtual list is DOM-based and needs ResizeObserver. Either map it onto gpuix's (like the Select's anchored) or give ResizeObserver per-frame bounds | L |
| Pointer capture | `setPointerCapture` is absent. If GPUI keeps sending a pressed drag to the element that took the press (unverified), it's a facade method plus tests; if not, the host has to route moves itself | S–M |
| Sibling combinators, structural pseudo-classes | Restyle siblings on insert, remove and attribute change. Tailwind's `space-y-*` is the main user | M |
| Ancestor states (`group-hover:`) | GPUI states are per element; needs the host to track hover on the group and restyle its subtree | M |
| `z-index` | Paint order is DOM order within a containing block. Needs re-ordering natively by `z-index` | S–M |
| Durable `localStorage` | A file-backed store (FKN-22) | S |
| ResizeObserver / IntersectionObserver | Per-frame cached bounds (FKN-29), then compare | M, after FKN-29 |
| Live-window geometry | `getBoundingClientRect` and `reveal()` call gpuix's synchronous `getElementBounds`, which can block for up to 2 s when a window isn't painting. Cache once per frame | M (FKN-29) |
| Linux real-GPU qualification | A Wayland test session with frame capture (FKN-26) | L |

## Asks for gpuix (drafts, for you to send or not)

Each is worked around in the adapter today, and each workaround has a test
that will fail loudly if gpuix changes underneath it.

1. **A masked input** (`type: password`, or a `mask` prop on `input`).
   Without it we refuse password fields.
2. **Editor events.** A click into an `input`/`textarea` sends no mouse or
   focus event, even to listeners on the field itself. We listen for
   `mouseDownOutside` on a zero-size sentinel. An `onFocus` when an editor
   takes focus would do.
3. **Tab in an editor.** The editor types one or two tab characters for the
   Tab key before the host can say no. We drop the change if a Tab keydown
   came for that field. A cancellable keydown delivered before the editor
   acts, or an option for editors to ignore Tab, would do.
4. **Controlled `value`.** `value` reaches the editor only when the prop
   differs from the last prop, not from what the editor shows. We nudge with
   a zero-width space and then the value after the next frame.
5. **`focusPrevious` and `focusPreviousWithin`.** The first doesn't leave an
   editor on Metal, and the second never returned from a modal's first stop
   in our contract app. We own the tab order now, so this is a report, not a
   blocker.
6. **Bounds.** `getElementBounds` reports the content corner, and a scroll
   container's own box moves by its own scroll offset. We undo both. A
   border-box option would be clearer.
7. **Focus handles.** `focusElement` on an element created in the same batch
   does nothing until GPUI draws it. We ask again after the next frame.
8. **Test renderer parity.** The offscreen `TestRenderer` has no `blur()`,
   and automation `keystrokes` send key-down only, live as well as offscreen.
9. **Layout and styles.** Auto margins (`margin: auto`), `aspectRatio`, and
   a `focusVisible` style state like `hover`/`active` (we restyle on focus
   instead, which costs a round trip). And Linux frame read-back, for real-GPU
   tests on Wayland.

## Risks

- **gpuix churn.** The adapter leans on gpuix 0.10 behaviours, some of them
  bugs it works around. Each is pinned by a test, so an upgrade fails loudly
  rather than silently. Upgrades should be their own PRs.
- **The flat sheet stays bounded.** Big Tailwind apps will hit sibling
  combinators, `group-hover:` and `z-index`. Each one is reported, not
  guessed, and the list above sizes them. A real CSS engine is a separate
  decision, not needed for M1.
- **Linux is unproven on a real GPU.** It renders headless, but nobody has
  watched it paint on Wayland yet (FKN-26).
- **Accessibility is unverified with a screen reader** (M2.1).

## If it's a go

M1 starts with FKN-21 (input, focus and keyboard), FKN-22 (lifecycle, errors
and a durable store), FKN-29 (non-blocking geometry), and FKN-26 (Linux
session). FKN-29 unblocks drag and drop and ResizeObserver. Nothing in M1 has
started, and nothing will before your go.

## How to see it

```sh
cd /Users/jem/code/manzanita-research/foldkit-native-agents && git pull
npm ci
bun run example native-ui        # the spike app, FoldKit on gpuix, in a window
FOLDKIT_NATIVE_RENDERER=gpuix bun run example big-list   # any example on the adapter
FOLDKIT_NATIVE_RENDERER=gpuix bun run example form
bun scripts/measure.ts           # the table above (opens windows, ~5 min)
bun test packages                # the adapter's and components' tests (Metal on a Mac)
```

Evidence (Metal screenshots, CI logs, the raw measurement runs):
`thread-storage/thr_jrys2u6ybd/evidence/` on the Mac mini, and the
`evidence` branch (`pr-fkn-18/`, `pr-fkn-cb/`, `pr-fkn-19/`).
