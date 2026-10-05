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

**On Linux**, any test that loads gpuix (most of them: the mirror's tests
create gpuix's renderer state) needs libxkbcommon, plus Wayland, EGL and
Vulkan, on the library path. Without them gpuix fails with a misleading
`Cannot find native binding. npm has a bug…`: the binary is installed, but a
library it links against isn't found. On NixOS, run inside a shell that
provides them (nixos-config's `nix develop .#render`). Checked on m6 under
headless Sway: 353 pass, 26 skip (the Metal-only tests), 0 fail.

## Linux: a test session on a headless compositor

gpuix 0.10 can't read frames back on Linux (no `TestRenderer`, no
`screenshot`), so the real-GPU checks there are real windows driven through
gpuix's automation, and the pixels come from the compositor. A window must
never open on the desktop you're sitting at, so those tests skip unless they
run inside `scripts/wayland-session.sh`: a throwaway **headless sway** (wlroots'
headless backend: no screen, no DRM seat, no input devices; its own socket,
`DISPLAY` unset), started for one command and killed after it.

```sh
scripts/wayland-session.sh -- bun test            # everything, windows included
scripts/wayland-session.sh -- bun scripts/nightly.ts --class linux-m6
FOLDKIT_NATIVE_EVIDENCE=out scripts/wayland-session.sh -- bun test packages/foldkit-gpuix/test/linux-session.test.ts   # + screenshots
```

It needs `sway` and `grim` on the PATH (`FKN_SWAY`, `FKN_GRIM` name others;
`FKN_SWAYMSG` names `swaymsg`, which is otherwise found beside sway), and
gpuix's libraries (above). On a distribution that ships them as system
libraries (Arch, for one) no extra shell is needed, and a sway from
elsewhere (a Nix store path) works through `FKN_SWAY`: the session puts the
directories of the `swaymsg` and `grim` it uses first on the command's PATH.
Inside, the session sets `WAYLAND_DISPLAY`, `FKN_SWAYSOCK`
(`swaymsg -s "$FKN_SWAYSOCK" ...`), `FKN_SWAYMSG`, `FKN_WAYLAND_OUTPUT`,
`FKN_WAYLAND_SHOTS` and `FKN_LINUX_WINDOWS=1`. One tiled window fills the
output (no gaps, no borders), so `grim` of the output is the window. A
layer-shell surface (`examples/layer-bar`) isn't one of sway's windows: its
exclusive zone shows as where sway tiles the windows beside it.

Why sway and not Hyprland: Hyprland 0.56 has no headless-only mode (it wants
a DRM seat or a parent compositor), and a second Hyprland imports its
environment into the systemd and D-Bus user session, which would repoint the
desktop's launchers at it. Distributions' sway configs often do that too, so the session
uses its own empty config.

**Why a window on a real desktop "didn't paint for automation" (FKN-26).**
Two things, found on m6: with the display asleep (DPMS off) the compositor
stops sending frame callbacks, GPUI stops drawing, and once the app asks for a
frame gpuix's UI-thread queries (`getTree`, `getBounds`, a click's lookup)
time out after 2 seconds, while `getAllText` (read from JavaScript) answers.
And separately, `getPaintedText` is empty on Linux whether or not the display
is awake. A headless output can't sleep, which is the workaround; the test
turns the output off and on again to show it.

## What's tested today

| Layer | File | What it proves | Runs on |
|---|---|---|---|
| Tree sync | `test/mirror-tree.test.ts` | DOM inserts, removes, reorders, moves and text changes leave GPUI's tree equal to the DOM, with nothing left alive off the tree. Includes 1,000 random edits. Attributes, classes, inline styles, `text-transform`, ARIA, `tabindex`, motion, inputs and images reach GPUI. | anywhere, headless |
| Event replay | `test/events.test.ts` | Forms submit as in a browser: a click on a submit button, or Enter in a field. A DOM listener turns the matching GPUI listener on, and removing it turns it off. GPUI's click, double click, right click, mouse down/up/move, enter/leave, keys, focus and input changes arrive as the DOM events a browser fires. Every press of a quick run is a `click` (a double click on +1 counts twice), the second is also a `dblclick`, and `detail` counts the run on click, mousedown and mouseup. Drag and drop is rebuilt from mouse events (threshold, enter/over/leave, drop, dragend, no stray click). | anywhere, headless |
| FoldKit apps | `test/foldkit.test.ts` | Unmodified FoldKit apps: drive input, then check the **model** changed. Covers a counter, a text input, arrow keys, a keyed list reorder (same native elements reused), drag and drop between columns, and `@foldkit/ui`'s Disclosure (click, Enter, `aria-expanded`). | anywhere, headless |
| App CSS | `test/css.test.ts` | `bun run css` turns Tailwind 4 into CSS happy-dom reads: no cascade layers, nesting, `oklch()` or logical properties left, and Tailwind's utilities reach GPUI (padding, colour, radius, shadow, opacity colours). | anywhere, headless |
| Styles and tokens | `test/style.test.ts` | CSS → GPUI style: flex, grid, spacing, sizes, colours, borders, radius, gradients (angles and `to bottom right`), shadows (Tailwind's stacked lists), `calc()`, unitless line heights, fonts (including `system-ui`), `:hover`/`:active` as GPUI states. (`:focus-visible` is sent as a state too, but gpuix's style has no such state and drops it: `test/native/metal.test.ts` shows nothing changes on screen when an element takes focus.) UI text isn't selectable by default, and `user-select: text` opts back in. Tokens resolve in colours, lengths and shadows, switch live, work in a scoped subtree, and follow the root's `data-theme`. | anywhere, headless |
| Real GPUI, offscreen | `test/native/metal.test.ts` | A FoldKit counter drawn by GPUI's Metal renderer with no window. The pixels are right (background, button colour and position). A click goes through **GPUI's own hit test** and changes the model. GPUI's own text selection skips UI text and buttons and selects text that opted in. A contract test replays the headless tests' mutations into real GPUI and checks both trees match, so the fake can't drift. | macOS |
| Real windows, Linux | `packages/foldkit-gpuix/test/linux-session.test.ts`, and the window tests below | Every example drawn by real GPUI in a window on a headless Wayland compositor, read back with `grim`; a window the compositor closes ends the app (handlers run, `exitOnClose` exits); a sleeping display stalls automation's UI-thread queries (the m6 "non-painting" session, reproduced and pinned); `getPaintedText` is empty on Linux (pinned). `packages/foldkit-gpuix/test/window.test.ts` (FKN-29) runs here with the output really powered off: one 2 s probe, then no bounds queries, and Kanban's drag and Pixel Art's hover keep working with frame work p95 under 16.7 ms (2.8 and 1.3 ms; while GPUI answers, Linux costs more: Kanban 14 ms, Pixel Art's stroke 51 ms). | Linux, inside `scripts/wayland-session.sh` |
| Real windows | `test/native/window.test.ts` | Both examples launch as real apps in real windows and are driven through gpuix's automation channel. The counter draws, clicks change the count, and Reset works. The theme switch swaps every token, read back from the window's own frames. Loose time budgets: first text within 5 s, click → text within 1 s. | macOS with a logged-in desktop |

The headless layers run against a **fake GPUI tree** (`test/support/fake-gpui.ts`)
that applies the same mutation batches gpuix sends, with GPUI's semantics: a
style replaces the old one, `appendChild` moves, and destroying frees the
subtree. The macOS contract test keeps that fake honest.

Run `bun test` for today's count: every example adds its own (below).

The window test measured first text 561 ms after launch and click → updated
text 7 ms on the Mac mini (M1), and 460 ms and 7 ms on Blacksmith's macOS 15
runner.

## Examples: story, scene and native tests

Every example in `examples/<name>/` (see [EXAMPLES.md](EXAMPLES.md)) has three
kinds of test. `examples/conventions.test.ts` fails if one is missing.

| Kind | File | What it checks | Tooling | Runs on |
|---|---|---|---|---|
| **Story** | `story.test.ts` | The app's logic: Messages go through `update`, and the test checks the Model and the Commands it asked for, resolving each Command with the Message it would return. No view, no DOM, no network. | FoldKit's own `foldkit/story` (`story`, `given`, `message`, `model`, `Command.resolve`) | anywhere |
| **Scene** | `scene.test.ts` | The app's view: renders it, clicks and types into it by role, label and text, and checks what's on screen and which Commands fired. | FoldKit's own `foldkit/scene` (`scene`, `click`, `type`, `expect(role(…)).toExist()`) | anywhere |
| **Native** | `native.test.ts` | The app running in FoldKit Native: its own `start`, its CSS, the mirror. **Headless**, input goes in as GPUI's events and the test checks GPUI's tree (texts, styles, in sync with the DOM). **On macOS**, GPUI draws it with Metal offscreen: layout, hit testing, real typing and clicks through GPUI's input pipeline, and a screenshot of each step. | `examples/support/harness.ts` (`openHeadless`, `openMetal`) | headless anywhere; Metal on macOS |

Story and scene tests are FoldKit's idea and FoldKit's tools, used as FoldKit
uses them: for a ported example they are **FoldKit's own test files, unchanged**.
They import `vitest`; under `bun test` that import is Bun's runner, so they run
as they are (`examples/support/vitest.d.ts` tells TypeScript the same).

Native tests stub the network (`globalThis.fetch`), so CI never calls a real
service; the recorded demo (below) uses the real one.

### Screenshots and clips (evidence)

- **Screenshots, automatic.** `openMetal(…).screenshot(name)` saves
  `<example>-<name>.png` to `$FOLDKIT_NATIVE_EVIDENCE` (or a temp folder).
  The macOS CI job sets it and uploads the folder as the
  **example-screenshots** artifact, so every PR has Metal screenshots of every
  example without anyone taking them.
- **A clip, on a Mac.** `bun run record <name>` opens the example in a real
  window, waits for the demo's `ready` text, saves `evidence/<name>.png`,
  plays `examples/<name>/demo.ts` and saves `evidence/<name>.mp4`. Frames come
  from GPUI's own renderer (no screen-recording permission); needs ffmpeg.
- **Where evidence goes.** Not into `main`: on the `evidence` branch, under
  `examples/<name>/`, linked from the PR.
- **Linux.** gpuix can't read frames back there yet, so the Metal tests skip;
  the headless story, scene and native tests all run. `bun run example <name>`
  opens a real Wayland window to look at by hand.

### Honest notes

- The mirror clears happy-dom's style and selector caches when it restyles, to
  work around a stale-match bug seen on Linux. With happy-dom 20.14.5, no test
  reproduces that bug: removing the workaround breaks nothing. The tests
  that would catch it are in place (`re-matches descendant selectors`); the
  reproduction is still missing.
- The fake-vs-real check compares tree structure, text and element count. It
  doesn't compare styles, because GPUI keeps styles in its own form.
- `nativeSimulateClick` presses and releases in one GPUI tick, before an app
  has reacted to the press: FoldKit's DragAndDrop attaches its document
  `pointerup` listener after `pointerdown`, so it misses that release. A real
  click spans frames; tests press, wait a frame, then release.
- gpuix's test renderer and automation channel can only press with a click
  count of 1, so no test makes GPUI itself produce a double click. The
  headless tests send the payload GPUI sends for one (`clickCount: 2`).
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
| Tree sync, events, styles, tokens, app CSS | ✅ | | | |
| Examples: story and scene tests (FoldKit's own) | ✅ | | | |
| Examples: native tests, headless | ✅ | | | |
| Examples: native tests on Metal, screenshots | | ✅ | | |
| Examples: clips (`bun run record`) | | | ✅ | |
| FoldKit and `@foldkit/ui` interaction scripts | ✅ | | | |
| GPUI layout, hit testing, pixels | | ✅ | ✅ | |
| Fake-vs-real contract | | ✅ | | |
| Launch, click, theme switch end to end | | | ✅ | |
| Browser conformance (planned) | | ✅ | | |
| Tight performance budgets (planned) | | | | ✅ |
| Linux/Wayland drawing | | | ✅ (m6) | |
| Screen readers (planned) | | | | manual |

CI (`.github/workflows/ci.yml`) runs typecheck, the CSS freshness check
(`bun run css --check`) and the headless layer on a Blacksmith Linux runner,
and the whole suite on a Blacksmith macOS runner, which also uploads the
examples' Metal screenshots.
That runner has Metal and a logged-in desktop, so the offscreen and the
real-window tests both run there, in about 15 seconds.
