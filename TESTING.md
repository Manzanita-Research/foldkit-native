# Testing FoldKit Native

FoldKit Native has two halves that can break separately. The **mirror** keeps
GPUI's tree in step with the DOM FoldKit renders into, and turns GPUI's input
back into DOM events. **GPUI** then lays the tree out and draws it on the GPU.
Most bugs live in the mirror, and the mirror can be tested without a screen.
GPUI needs a real GPU, and reading pixels back currently works on macOS only.

```sh
bun test                          # everything this machine can run
bun test test/*.test.ts           # just the headless layer (any OS, no GPU)
FOLDKIT_NATIVE_NO_WINDOW=1 bun test   # a Mac without a logged-in desktop: skip real windows
```

## What's tested today

| Layer | File | What it proves | Runs on |
|---|---|---|---|
| Tree sync | `test/mirror-tree.test.ts` | DOM inserts, removes, reorders, moves and text changes leave GPUI's tree equal to the DOM, with nothing left alive off the tree. Includes 1,000 random edits. Attributes, classes, inline styles, `text-transform`, ARIA, `tabindex`, motion, inputs and images reach GPUI. | anywhere, headless |
| Event replay | `test/events.test.ts` | A DOM listener turns the matching GPUI listener on, and removing it turns it off. GPUI's click, double click, right click, mouse down/up/move, enter/leave, keys, focus and input changes arrive as the DOM events a browser fires. Drag and drop is rebuilt from mouse events (threshold, enter/over/leave, drop, dragend, no stray click). | anywhere, headless |
| FoldKit apps | `test/foldkit.test.ts` | Unmodified FoldKit apps: drive input, then check the **model** changed. Covers a counter, a text input, arrow keys, a keyed list reorder (same native elements reused), drag and drop between columns, and `@foldkit/ui`'s Disclosure (click, Enter, `aria-expanded`). | anywhere, headless |
| Styles and tokens | `test/style.test.ts` | CSS → GPUI style: flex, grid, spacing, sizes, colours, borders, radius, gradients, shadows, fonts (including `system-ui`), `:hover`/`:active`/`:focus-visible` as GPUI states. Tokens resolve in colours, lengths and shadows, switch live, work in a scoped subtree, and follow the root's `data-theme`. | anywhere, headless |
| Real GPUI, offscreen | `test/native/metal.test.ts` | A FoldKit counter drawn by GPUI's Metal renderer with no window. The pixels are right (background, button colour and position). A click goes through **GPUI's own hit test** and changes the model. A contract test replays the headless tests' mutations into real GPUI and checks both trees match, so the fake can't drift. | macOS |
| Real windows | `test/native/window.test.ts` | Both examples launch as real apps in real windows and are driven through gpuix's automation channel. The counter draws, clicks change the count, and Reset works. The theme switch swaps every token, read back from the window's own frames. Loose time budgets: first text within 5 s, click → text within 1 s. | macOS with a logged-in desktop |

The headless layers run against a **fake GPUI tree** (`test/support/fake-gpui.ts`)
that applies the same mutation batches gpuix sends, with GPUI's semantics: a
style replaces the old one, `appendChild` moves, and destroying frees the
subtree. The macOS contract test keeps that fake honest.

That's 58 tests: 54 headless and 4 on macOS. The window test measured first
text 561 ms after launch and click → updated text 7 ms on the Mac mini (M1),
and 460 ms and 7 ms on Blacksmith's macOS 15 runner.

### Honest notes

- The mirror clears happy-dom's style and selector caches when it restyles, to
  work around a stale-match bug seen on Linux. With happy-dom 20.14.5, no test
  reproduces that bug: removing the workaround breaks nothing. The tests
  that would catch it are in place (`re-matches descendant selectors`); the
  reproduction is still missing.
- The fake-vs-real check compares tree structure, text and element count. It
  doesn't compare styles, because GPUI keeps styles in its own form.
- The window tests need a logged-in desktop session. In a sandbox, over SSH,
  or on a headless CI machine without one, skip them with
  `FOLDKIT_NATIVE_NO_WINDOW=1`.

## What it still needs

In rough order of value.

1. **More interaction scripts (headless).** Every `@foldkit/ui` component,
   with its keyboard paths: dialog, menu, listbox, combobox, tabs, switch,
   checkbox, radio group, slider, toast, popover, tooltip. Most of these will
   fail today on purpose, because they need layout read-back
   (`getBoundingClientRect`) or focus sync. Each failing test documents a
   README roadmap item, and goes green when that item lands.
2. **Inputs and focus, both ways.** Typing into a GPUI input updates the DOM
   value and fires `input`. Setting the value from FoldKit updates GPUI.
   Selection and IME. DOM focus and GPUI focus stay in step (Tab order, focus
   traps). gpuix's TestRenderer can drive real keystrokes and focus, so these
   can run offscreen on macOS.
3. **Conformance against a browser.** Render FoldKit's own examples and every
   `@foldkit/ui` component twice at the same size: once in headless Chromium
   (Playwright) and once through GPUI offscreen. Compare the screenshots with
   a tolerance (a per-pixel colour threshold plus a cap on the share of
   differing pixels), and keep a short list of intended differences:
   - Inline text: GPUI has no inline formatting, so mixed runs become a wrapping row.
   - No CSS transitions or transforms yet.
   - Gradients have two stops only.
   - No `calc()`.
   - Fonts: both sides should use one bundled font (IBM Plex Sans ships with
     GPUI), or text metrics will dominate the diff.

   This runs on macOS (pixels come back from Metal), so locally or in the
   macOS CI job. Linux can't join until gpuix's Linux build can read frames
   back.
4. **Performance budgets that fail on regressions.** Track first frame, click
   → frame (`onFrame`'s `inputToFrameMs`), DOM → GPUI sync time (`syncMs`),
   memory (RSS after startup and after 1,000 updates), and frame times during
   an animation (gpuix's frame overlay stats: p90/p99). CI virtual machines are
   too noisy for tight limits, so:
   - CI keeps loose budgets that catch "broken", as today.
   - A known machine (the Mini or jemarchy-m6) runs a nightly benchmark: median
     of N runs against a committed baseline, failing on a large regression
     (say 25%).
5. **Platform matrix.**
   - Linux/Wayland on jemarchy-m6 (real Radeon): the headless layers plus a
     launch smoke test through the automation channel that checks the tree,
     not pixels.
   - macOS/Metal: everything, in CI on Blacksmith and on the Mini.
   - Windows/DirectX: gpuix ships a binary, but it's untested here. The same
     offscreen tests should work there.
6. **Accessibility (later).** GPUI's accessibility tree
   (`TestRenderer.getA11yTree()`) can be checked offscreen: roles, labels,
   expanded and selected states for each component. Screen readers (VoiceOver,
   Orca) stay a manual check before a release.

## What runs where

| | Headless (any OS, CI) | macOS offscreen (CI or a Mac) | Real window (desktop session) | Known machine only |
|---|---|---|---|---|
| Tree sync, events, styles, tokens | ✅ | | | |
| FoldKit and `@foldkit/ui` interaction scripts | ✅ | | | |
| GPUI layout, hit testing, pixels | | ✅ | ✅ | |
| Fake-vs-real contract | | ✅ | | |
| Launch, click, theme switch end to end | | | ✅ | |
| Browser conformance (planned) | | ✅ | | |
| Tight performance budgets (planned) | | | | ✅ |
| Linux/Wayland drawing | | | ✅ (m6) | |
| Screen readers (planned) | | | | manual |

CI (`.github/workflows/ci.yml`) runs typecheck and the headless layer on a
Blacksmith Linux runner, and the whole suite on a Blacksmith macOS runner.
That runner has Metal and a logged-in desktop, so the offscreen and the
real-window tests both run there, in about 15 seconds.
