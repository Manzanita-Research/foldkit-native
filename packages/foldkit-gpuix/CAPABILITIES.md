# Capability matrix v1: FoldKit on gpuix

What an app gets on the adapter, as of FKN-27. Each row has a status:

- **works**: does what a browser does, tested against that;
- **approximated**: works, but from somewhere other than a browser's source
  (GPUI's last layout, a value as text), or with a stated difference;
- **rejected**: refused or absent, and the app is told (it throws, it's
  reported, or feature detection says no). Never a silent stand-in.

Every row names the tests that hold it: a file and a piece of a test's
title. [`test/capabilities.test.ts`](test/capabilities.test.ts) checks
every one, so a row whose test is renamed or removed fails, as does a kind
of CSS the sheet reports as unsupported that has no row here. Paths are
from this folder. [EVENTS.md](EVENTS.md) has the input events in detail,
and [README.md](README.md) the reasons.

## The matrix

| Area | Capability | Status | Notes | Evidence |
|---|---|---|---|---|
| FoldKit | Apps run unmodified: Runtime, Commands, Subscriptions, Mounts, `Render.afterCommit` | works | The seven ported examples render the same text as on the mirror | [lifecycle](test/lifecycle.test.ts) "a Mount starts when its element is drawn"; [lifecycle](test/lifecycle.test.ts) "Render.afterCommit resumes once the patch"; [versus-mirror](test/versus-mirror.test.ts) "first render, every example" |
| FoldKit | The crash view | works | | [lifecycle](test/lifecycle.test.ts) "a crash in update draws the crash view" |
| FoldKit | `foldkit/dom` Commands: focus, advanceFocus, a modal dialog's isolation | works | | [commands](test/commands.test.ts) "headless: focus, advanceFocus, and a modal dialog"; [commands](test/commands.test.ts) "focus and advanceFocus move GPUI" |
| FoldKit | Platform Commands: lockScroll, inertOthers, clickElement, waitForAnimationSettled, detectElementMovement | works | | [platform-commands](test/platform-commands.test.ts) "lockScroll stops the page scrolling under the wheel"; [platform-commands](test/platform-commands.test.ts) "clickElement clicks"; [platform-commands](test/platform-commands.test.ts) "waitForAnimationSettled waits for GPUI" |
| Focus | GPUI's focus, `document.activeElement` following it; `focus()` and focus/blur events | works | | [adapter](test/adapter.test.ts) "Tab and Shift-Tab move GPUI focus, and document.activeElement follows"; [adapter](test/adapter.test.ts) "element.focus() moves GPUI focus; focus and blur events fire as in a browser" |
| Focus | A browser's tab order (positive tab indexes first), checked against real GPUI | works | | [adapter](test/adapter.test.ts) "fields, buttons and tabindex are GPUI tab stops"; [contract](test/contract.test.ts) "the focus sequence: Tab, Shift-Tab, tab index order, a modal scope" |
| Focus | A modal's focus scope: autofocus, Tab stays inside, Escape, focus goes back | works | | [adapter](test/adapter.test.ts) "autofocus on open, Tab stays inside, Escape closes, focus goes back" |
| Focus | `:focus-visible` by input modality | works | A style state the host restyles on focus (gpuix has no `focusVisible` state) | [adapter](test/adapter.test.ts) ":focus-visible styles show for keyboard focus, not for a click"; [adapter](test/adapter.test.ts) "focus() before any input shows, as on a page that just loaded" |
| Keyboard | Keys go to the focused element and bubble; Enter and Space click a button, Space on its release | works | | [adapter](test/adapter.test.ts) "keys go to the focused element and bubble; Enter and Space click a button"; [events](test/events.test.ts) "Space activates a button on its release" |
| Keyboard | A prevented keydown has no default action | works | | [adapter](test/adapter.test.ts) "a keydown the app prevents has no default action" |
| Forms | `disabled` as HTML has it (form controls, a disabled fieldset) | works | Not announced as disabled: gpuix has no disabled state for AccessKit | [disabled](test/disabled.test.ts) "button: disabled while focused, focus leaves"; [disabled](test/disabled.test.ts) "a disabled fieldset disables its controls" |
| Pointer | A click's events, in a browser's order, with `button` and `buttons` | works | | [events](test/events.test.ts) "a click: pointerdown, mousedown, pointerup, mouseup, click" |
| Pointer | Hover: enter, leave, over, out from where the pointer is | works | Hit-tested against GPUI's last layout | [events](test/events.test.ts) "moving onto a child: no mouseleave on the parent"; [events](test/events.test.ts) "hover: onto a child and back, out, and straight in" |
| Pointer | The right and middle buttons: `contextmenu`, `auxclick` | works | | [events](test/events.test.ts) "the right button: pointerdown, mousedown, contextmenu, pointerup, mouseup, auxclick" |
| Pointer | Pointer capture | works | | [events](test/events.test.ts) "setPointerCapture in pointerdown" |
| Pointer | The wheel: one `wheel` under the pointer, `scroll` where GPUI scrolled | works | | [events](test/events.test.ts) "one wheel at the element under the pointer" |
| Pointer | Drag and drop (@foldkit/ui's, Kanban's) | works | | [window](test/window.test.ts) "Kanban: a pointer drag and a keyboard move land" |
| Text | `<input>` and `<textarea>` are GPUI's editors: `input` per change, controlled values | works | A value set back to the last prop is nudged through a zero-width space for a frame | [adapter](test/adapter.test.ts) "an input is GPUI"; [adapter](test/adapter.test.ts) "a keystroke the model refuses comes back out of the editor" |
| Text | Tab never types into a field | approximated | The editor types it, and the host takes it back out before FoldKit sees it | [adapter](test/adapter.test.ts) "the tab is dropped and never reaches FoldKit" |
| Text | Enter submits a form from an input, and is a new line in a textarea | works | | [adapter](test/adapter.test.ts) "Enter submits from an input and is a new line in a textarea" |
| Text | Copy, cut, paste, undo and redo | works | GPUI's own; it undoes in smaller steps than a browser | [keyboard](test/keyboard.test.ts) "copy, paste, cut, undo and redo in GPUI" |
| Text | `<input type="password">` | rejected | Throws as it's mounted: gpuix has no masked input | [adapter](test/adapter.test.ts) "a password field throws as it"; [adapter](test/adapter.test.ts) "a FoldKit view that adds a password field crashes with that message" |
| Scrolling | GPUI scrolls; `scrollTop`, the keys on a focused scroll area | works | | [contract](test/contract.test.ts) "scroll offsets: scrollTop both ways, the keys, clamping"; [adapter](test/adapter.test.ts) "a focused scroll area scrolls with the keys, in GPUI" |
| Geometry | `getBoundingClientRect`, `offsetWidth` and friends | approximated | From GPUI's last layout, read at most once a frame; zeros for an element not laid out yet | [geometry](test/geometry.test.ts) "the border box, a scrolled area and what it scrolled"; [geometry](test/geometry.test.ts) "every read between two frames costs one tree read" |
| Geometry | `document.elementsFromPoint` | approximated | From GPUI's last layout, in GPUI's paint order; checked against GPUI's own hit test | [geometry](test/geometry.test.ts) "topmost first: children over parents"; [metal](test/metal.test.ts) "elementsFromPoint agrees with GPUI" |
| Geometry | A window that isn't painting | approximated | Answers from the last layout; one blocked frame to find out | [geometry](test/geometry.test.ts) "one miss, then no queries for a back-off" |
| Styles | Descendant and child combinators | works | Ancestors at rest | [sheet](test/sheet.test.ts) "descendant and child combinators follow an ancestor" |
| Styles | The cascade: specificity, source order, inline, `!important` | works | | [adapter](test/adapter.test.ts) "the cascade: specificity, then source order, then inline, then !important" |
| Styles | Custom properties (tokens), switched live | works | | [sheet](test/sheet.test.ts) "a token swap restyles everything that reads it"; [theme-switch](test/theme-switch.test.ts) "both restyle the deepest cell" |
| Styles | Live `@media`, evaluated `@supports`, `vh`/`vw`, auto margins | works | | [sheet](test/sheet.test.ts) "@media follows the window"; [sheet](test/sheet.test.ts) "@supports is evaluated, not always taken"; [sheet](test/sheet.test.ts) "viewport units and auto margins" |
| Styles | `:hover` and `:active` | works | GPUI's own state styles | [adapter](test/adapter.test.ts) "rules apply; :hover is GPUI" |
| Styles | An outer box shadow | approximated | GPUI paints it under the box too, so a box with none of its own gets its backdrop's colour | [adapter](test/adapter.test.ts) "a box with a shadow and no background gets the solid colour it sits on" |
| Styles | `getComputedStyle` | approximated | Reads the sheet's declared values | [platform-commands](test/platform-commands.test.ts) "getComputedStyle and checkVisibility read the sheet" |
| Styles | Sibling combinator (`+`, `~`) | rejected | Reported by `sheetFromCss`; the rule is left out | [adapter](test/adapter.test.ts) "sheetFromCss reports what a restyle can" |
| Styles | Structural pseudo-class (`:first-child`, `:nth-child`…) | rejected | Reported, as above | [adapter](test/adapter.test.ts) "sheetFromCss reports what a restyle can" |
| Styles | Pseudo-element (`::before`, `::placeholder`…) | rejected | Reported, as above | [adapter](test/adapter.test.ts) "sheetFromCss reports what a restyle can" |
| Styles | State on an ancestor (`.group:hover .x`, `:focus-within`) | rejected | Reported, as above | [adapter](test/adapter.test.ts) "sheetFromCss reports what a restyle can" |
| Styles | Media query features other than sizes, hover, pointer and orientation | rejected | Reported, as above | [adapter](test/adapter.test.ts) "sheetFromCss reports what a restyle can" |
| Layout | Absolute and fixed boxes under their CSS containing block | approximated | Drawn under it in GPUI's tree; a `fixed` box scrolls with the page | [sheet](test/sheet.test.ts) "an absolute box under a static parent is drawn under the nearest positioned ancestor" |
| Layout | Anchored overlays (a Select's or a Popover's popup) | works | GPUI's `anchored`: placed, flipped to fit, painted on top | [ui select](../ui/test/select.test.ts) "the popup is an anchored element" |
| Browser APIs | `MutationObserver` | works | | [lifecycle](test/lifecycle.test.ts) "MutationObserver: childList, attributes, characterData, subtree" |
| Browser APIs | `requestAnimationFrame` | works | Runs before GPUI draws | [lifecycle](test/lifecycle.test.ts) "requestAnimationFrame runs before GPUI draws" |
| Browser APIs | `history` and `location` | approximated | In memory, with `popstate`; there's no address bar | [lifecycle](test/lifecycle.test.ts) "history: push, replace, back and forward" |
| Browser APIs | `localStorage` with an `appId` | works | A file, written through on each change | [storage](test/storage.test.ts) "each change is on disk when the call returns" |
| Browser APIs | `sessionStorage` | works | In memory: a process is a session | [storage](test/storage.test.ts) "sessionStorage stays in memory" |
| Browser APIs | `matchMedia` | approximated | Sizes, hover, pointer, orientation; no preferences; listeners never fire | [lifecycle](test/lifecycle.test.ts) "matchMedia: widths against the window" |
| Browser APIs | `ResizeObserver` | works | From GPUI's per-frame layout | [platform-commands](test/platform-commands.test.ts) "ResizeObserver: the first size" |
| Browser APIs | `IntersectionObserver` | rejected | Absent, so feature detection says so | [lifecycle](test/lifecycle.test.ts) "IntersectionObserver is absent" |
| Browser APIs | `getSelection()` | works | GPUI's own selection | [lifecycle](test/lifecycle.test.ts) "getSelection is GPUI" |
| Accessibility | Roles and names reach AccessKit, names from content as a browser computes them | works | Not yet checked with a screen reader (M2.1) | [adapter](test/adapter.test.ts) "a button, an option, a heading are named by their text"; [ui select](../ui/test/select.test.ts) "GPUI's accessibility tree has the roles" |
| Accessibility | Checked state | approximated | gpuix has no checked state: it goes as the value, `on`, `off` or `mixed` | [ui checkbox](../ui/test/checkbox.test.ts) "AccessKit has the checkboxes" |
| Lifecycle | `close()` and `detach()` free everything; the native tree goes to zero | works | | [app](test/app.test.ts) "asks the handlers, then disposes the runtime"; [lifecycle](test/lifecycle.test.ts) "100 mount/dispose cycles on one window: no native-node, handler or memory growth" |
| Lifecycle | Close handlers when a person closes the window on macOS | rejected | GPUI ends the process inside its frame; nothing runs. `localStorage` writes through instead | [app](test/app.test.ts) "a native close (the red button) ends the process inside GPUI" |
| Lifecycle | A window that can't open says why in one sentence | works | | [app](test/app.test.ts) "no compositor, a missing library, anything else: one sentence each" |
| Security | Automation only when asked for (`automation: true`, `FOLDKIT_NATIVE_AUTOMATION=1`) | works | A shipped app started with a pipe serves none | [automation](test/automation.test.ts) "serves no automation by default" |
| Security | What automation serves: no field values in the tree, never a secret field's text | works | Secret by `autocomplete`; the window and AccessKit still show it | [automation](test/automation.test.ts) "the painted text has the name and bullets for the one-time code" |
| Platforms | macOS on Metal, offscreen and in real windows | works | | [metal](test/metal.test.ts) "Form, unmodified: a click focuses a field"; [window](test/window.test.ts) "Pixel Art: a stroke paints every cell the drag crosses" |
| Platforms | Linux (Wayland) in real windows | approximated | No frame read-back and an empty `getPaintedText` in gpuix 0.10: pixels come from the compositor | [linux-session](test/linux-session.test.ts) "paints in a window, and the compositor"; [linux-session](test/linux-session.test.ts) "getPaintedText is empty on Linux" |

## Missing, and not yet held by a test

Known gaps with no row above, because nothing tests them yet. Each would
need one before it can be called rejected here:

- IME composition and `selectionchange` events (gpuix sends the final
  value only);
- `z-index` (paint order is document order within a containing block);
- `prefers-color-scheme` and `prefers-reduced-motion` (they never match);
- a disabled state for AccessKit;
- `document.startViewTransition` (absent; FoldKit feature-detects it);
- a selector the engine can't read, reported as `selector` (some malformed
  selectors loop the parser instead today).
