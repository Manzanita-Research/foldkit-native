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
  is rebuilt from mouse events. A click on a child that paints a fill (a
  switch's track, a card's badge) reaches the clickable element it's in, as it
  bubbles in a browser, where GPUI would let the fill block it.
- **Styles are CSS.** Modern CSS such as Tailwind 4's is first lowered to what
  happy-dom understands (`bun run css`, `scripts/css.ts`). happy-dom resolves
  stylesheets, classes, inline styles and custom properties; `src/style.ts` copies what GPUI can draw (flexbox, grid,
  sizes, spacing, colours, borders, radius, gradients, shadows, fonts,
  `:hover`/`:active`, cursor, `user-select`; not yet `:focus` or `:focus-visible`,
  which gpuix has no state for). GPUI does layout.
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
put them on `LD_LIBRARY_PATH`, or use nixos-config's `nix develop .#render`).
Without them gpuix says `Cannot find native binding. npm has a bug…`, which
means a missing system library, not a missing package. On macOS nothing else: gpuix's Apple silicon
binary draws with Metal. Run it from a terminal in the logged-in desktop
session (Terminal.app, at the machine or over Screen Sharing) so the window
appears on that screen.

```sh
npm ci                        # exact pins; installs only your platform's gpuix binary
bun run gallery               # every example in one window; click one to open it
bun run gallery --list        # the same list in the terminal
bun run example weather       # open one example directly
bun run demo                  # examples/themes.ts: primitives + two token sets, switched at runtime
bun run counter               # examples/counter.ts: a FoldKit counter; only the setup import is native-specific
bun test                      # everything this machine can run (TESTING.md)
bun run typecheck
bun run css                   # regenerate the examples' CSS after changing classes or styles.css
bun run record weather        # macOS: a still and a clip of an example, from its own frames (needs ffmpeg)
```

The examples are FoldKit's own example apps (weather, kanban, snake…), ported
with their tests, plus showcases written here: [EXAMPLES.md](EXAMPLES.md).

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
5. **CSS coverage and speed.** Transitions, transforms, `%` sizes, `vh` that
   follows the window (happy-dom's viewport is a fixed 1024×768); and a
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

## GitHub source releases

Changesets manages the **repository source release** using the root
`foldkit-native` version and `CHANGELOG.md`. A GitHub Release named
`foldkit-native@<version>` points to the exact main commit whose CI passed;
GitHub supplies source archives for that tag. These are source snapshots,
not built npm packages or compiled native binaries. Root, adapter and UI
remain `private: true`, their source TypeScript exports stay intact, and the
subpackage versions/peer constraints are unchanged. The root repository
version is not a promise of independently distributable adapter/UI packages.

Use Node 22.22.3 (npm 10.9.8) and Bun 1.3.9 for the release tools:

```sh
npm ci
npm run changeset           # choose foldkit-native and write the change summary
npm run check:release       # isolated version fixture and mocked GitHub controls
```

After a change lands on main and its existing `CI` workflow passes, `Release`
creates or updates `changeset-release/main` with `npm run version:packages`.
Review the version and changelog before merging that PR. The version command
consumes pending changesets and updates the root version in package.json and
package-lock.json; it does not publish or tag. The successful main CI after
merging the version PR permits `npm run release:github` to create the tag and
GitHub Release. Each future change needs a new changeset to advance the version.

The workflow must be present on the default branch; Actions must allow its
`GITHUB_TOKEN` to create pull requests. This setup changes neither setting.
When that token opens, updates or reopens the version PR, GitHub creates
pull-request CI runs that require approval. A maintainer with write access
must select **Approve workflows to run** in the PR's merge box before those
checks execute ([GitHub token behavior](https://docs.github.com/en/actions/concepts/security/github_token)).
Merge only after normal review and required checks. Token-triggered push
and other PR activity events do not start CI. No extra token, npm secret,
npm environment, registry authentication or OIDC permission is needed here.

Release execution rejects failed/non-push/unrelated/fork CI, checkout drift
and events whose tested SHA is no longer current main. All releases serialize
through `release-main`, and current-main/CI identity is rechecked immediately
before tag and release writes. GitHub has no atomic main-ref-and-release
transaction: main advancing after a tag write causes the next check to fail,
leaving the exact tested tag without a release. A retry at that same current
SHA can finish it. If main has advanced, the older incomplete tag needs a
maintainer's explicit recovery decision; automation never retags or deletes it.
Completed consistent releases are no-ops on duplicate events or later commits
without a new version; conflicting tag/version/changelog/release metadata
fails rather than overwriting published history. API/auth/network failures
remain failures. No CI artifact or fork code is consumed by the release flow.

`npm run release:github -- --dry-run` still requires a genuine successful
current-main workflow event and checkout, but prints the planned GitHub work
without writing tags/releases. The safe `check:release` tests use temporary
version fixtures and mocked APIs; they do not publish. CI checks the same
controls while retaining all existing unit, mirror, static, native and
artifact gates. Workflow failures are reported normally, with no native skips
or timeout relaxation to make publication succeed.

npm publication is a separate future step tracked by [#59](https://github.com/julia-script/foldkit-native/issues/59)
and [#67](https://github.com/julia-script/foldkit-native/issues/67): choose public
package boundaries and shared-style ownership, align package versions/peers,
emit and qualify JS/types/exports in clean supported Node/Bun consumers,
verify packed licences, then explicitly approve private-flag changes and
registry credentials/OIDC. Only after those gates should a distinct npm
publish command and permission be added. Do not substitute `changeset publish`
for this GitHub-only release command today.

Based on the [effectmq release workflow](https://github.com/julia-script/effectmq/blob/c656ceb5f409c001c34bf106b6a4c9c0c0619f39/.github/workflows/release.yml),
[Changesets configuration](https://changesets.dev/guide/config)
and [Changesets action custom publishing](https://github.com/changesets/action/tree/a45c4d594aa4e2c509dc14a9f2b3b67ba3780d0d#custom-publishing).

## Credits and licences

FoldKit Native is MIT licensed ([LICENSE](LICENSE)). Its examples include
FoldKit's example apps, MIT licensed, © 2025 Devin Jameson
([examples/FOLDKIT-LICENSE](examples/FOLDKIT-LICENSE)); each ported file says
so. Otherwise it depends on, and does not copy code from:

| Project | Licence | Used for |
|---|---|---|
| [FoldKit and @foldkit/ui](https://github.com/foldkit/foldkit) | MIT | The framework this renders (peer dependency) |
| [gpuix](https://github.com/remorses/gpuix) (`@gpuix/native`, incl. its GPUI build) | Apache-2.0 | GPUI bindings and the native renderer |
| [happy-dom](https://github.com/capricorn86/happy-dom) | MIT | The DOM FoldKit renders into |
| [Effect](https://effect.website) | MIT | FoldKit's runtime (peer dependency) |
| [Tailwind CSS](https://tailwindcss.com) and [Lightning CSS](https://lightningcss.dev) | MIT, MPL-2.0 | Building the examples' CSS (dev only) |
| [clsx](https://github.com/lukeed/clsx), [fractional-indexing](https://github.com/rocicorp/fractional-indexing) | MIT, CC0-1.0 | Used by FoldKit's example apps (dev only) |

All are compatible with MIT. If you distribute a compiled binary that embeds
gpuix's native library, include its Apache-2.0 licence and notices with it.
