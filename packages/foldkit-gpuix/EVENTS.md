# Events: native → FoldKit

How GPUI's input becomes the DOM events a FoldKit app hears. A browser
decides every rule here: WHATWG DOM for dispatch, UI Events and Pointer
Events for what fires and in what order. Where the specs leave the order
open, Chrome's on macOS decides: the sequences in the tests are what Chrome
fired for the same page and the same input (FKN-23). Each rule links to the
test that holds it. `E` is
[`test/events.test.ts`](test/events.test.ts), headless on the fake GPUI unless
it says Metal (real GPUI, offscreen).

Where this can't match a browser, it says so under [Can't](#cant).

## What GPUI sends, and what the host does with it

GPUI hit-tests for itself and tells only the topmost element that listens.
The host (`src/host.ts`) turns that into what a browser fires:

| GPUI sends | Unlike a browser | The host |
|---|---|---|
| `mouseEnter`, `mouseLeave`, no position | Exclusive: a parent "leaves" as the pointer goes onto a child that listens, and never hears about it again | Ignores them as hover. Every element GPUI hit-tests (it listens for something, or has a hover style), and the body under them all, reports its moves and its leaving. Each move is hit-tested against GPUI's last layout (`elementsFromPoint`), and the host fires the boundary events |
| `mouseDown`, then moves and `mouseUp` to the pressed element only | Implicit capture: nothing else hears the gesture | The moves and the release go to the element under the pointer, or to the one with pointer capture |
| `click` to the pressed element, wherever the release was | Clicks a button the press was dragged off | The click goes to what the press and the release have in common |
| `auxClick` for the right and middle buttons, before `mouseUp`; no `click` | `contextmenu` never came | `contextmenu` on the press (right button), `auxclick` after the release |
| `scroll` (the wheel) to every listening element under the pointer, innermost first, after GPUI scrolled | Every listener got a "scroll", scrolled or not | One `wheel` at the element under the pointer; `scroll` at each scroll area that moved |
| A press to a zero-size element listening for `mouseDownOutside` | | Where each press landed, before any element hears it (editors swallow presses) |

Where the layout has nothing at the point (not laid out yet), the element
GPUI sent the event to stands in.

## Dispatch

1. **Three phases.** Capture from the window down, the target, then bubbling
   up for events that bubble. `composedPath()` is that path. The window is
   at its top.
2. **At the target, capture listeners run first**, then the others, whatever
   order they were added in (as browsers do since 2021).
   [E](test/events.test.ts#L157)
3. **A listener is its callback and capture flag.** The same pair added twice
   is one listener: it runs once, and `once` on the second add changes
   nothing. A `handleEvent` object is a listener. GPUI's native listener for
   it goes when the last DOM listener that needs it goes, so it's identity
   that's counted, not calls. [E](test/events.test.ts#L112)
4. **Removed mid-dispatch, it doesn't run**, even further along the path. One
   added mid-dispatch runs from the next dispatch. [E](test/events.test.ts#L137)
5. **`once`, `signal`, `passive`.** A `once` listener goes before it runs. An
   aborted signal removes its listener, and adding with one already aborted
   adds nothing. In a passive listener `preventDefault()` does nothing.
   [E](test/events.test.ts#L168)
6. **Stopping.** `stopPropagation()` ends the path after the current target's
   listeners; `stopImmediatePropagation()` ends it now. Both are unset after
   the dispatch, so the event can be dispatched again; dispatching it while
   it's being dispatched throws `InvalidStateError`.
   [E](test/events.test.ts#L168)
7. **A listener that throws is reported** (`onError`, phase `listener`) and
   the next one runs. [E](test/events.test.ts#L205)
8. **Listeners on `document` and `window` hear everything** that bubbles
   there, clicks and moves included: GPUI sends those to the body for them.
   [E](test/events.test.ts#L263)

## Hover

9. **The element under the pointer is the topmost one GPUI last painted
   there** (`document.elementsFromPoint`), not GPUI's own hover.
10. **Boundary events, in a browser's order.** As the pointer moves from A to
    B: `pointerout` at A, `pointerleave` at each element A's chain leaves
    (innermost first), `pointerover` at B, `pointerenter` at each element B's
    chain enters (outermost first), then `mouseout`, `mouseleave`,
    `mouseover`, `mouseenter` the same way, then the move itself
    (`pointermove`, `mousemove`) at B. `over` and `out` bubble;
    `enter` and `leave` don't. `relatedTarget` is the other one.
    [E](test/events.test.ts#L246)
11. **Onto a child is not leaving the parent.** The parent hears `mouseout`
    and the child's `mouseover` bubbling, and no `mouseleave`. Straight onto
    the child from outside, the parent hears `mouseenter` before the child.
    The sequence is Chrome's, headless [E](test/events.test.ts#L220) and on
    Metal [E](test/events.test.ts#L545).
12. **Out through a child that listens for something else**, the parent hears
    it leave, and come back. (On GPUI's own hover it heard neither.)
    [E](test/events.test.ts#L234), Metal [E](test/events.test.ts#L563)
13. **GPUI's enter or leave with no move in the same task** (the pointer left
    the window, or crossed something that doesn't report) counts: an enter
    hovers that element (or what the layout has under the pointer inside
    it), a leave leaves it. [E](test/events.test.ts#L274)
14. **While a button's held, hover follows the pointer** (Pixel Art paints
    each cell a drag enters), and after the release it goes on from where the
    pointer is. [E](test/events.test.ts#L286)
15. **An element taken out from under the pointer** fires nothing; what held
    it is hovered until the pointer moves, as in a browser.

## Presses and clicks

16. **A click: `pointerdown`, `mousedown`, `pointerup`, `mouseup`, `click`**,
    each pointer event before its mouse event, all at the element under the
    pointer, bubbling. `button` is the button (0 main, 1 middle, 2 right),
    `buttons` the ones held (1 main, 4 middle, 2 right), 0 after the
    release. [E](test/events.test.ts#L305)
17. **The click goes to what the press and the release have in common.**
    Dragged off a button and let go elsewhere, the button isn't clicked (the
    body is); `mouseup` goes to what's under the pointer.
    [E](test/events.test.ts#L320), Metal [E](test/events.test.ts#L607)
18. **The click's target is the deepest element pressed**, not the listening
    ancestor GPUI picked. [E](test/events.test.ts#L340)
19. **`dblclick`** follows the second click of a double click (GPUI's click
    count).
20. **The right button:** `pointerdown`, `mousedown`, `contextmenu` (on the
    press, as macOS fires it), `pointerup`, `mouseup`, `auxclick`; no `click`.
    [E](test/events.test.ts#L349), Metal [E](test/events.test.ts#L577).
    Nested `OnContextMenu`s: the inner one's runs, and bubbles.
    [E](test/events.test.ts#L372)
21. **The middle button:** `auxclick` after the release, `button` 1.
    [E](test/events.test.ts#L362)
22. **A disabled control** hears no presses or clicks, and neither do its
    ancestors. ([disabled.test.ts](test/disabled.test.ts#L130))
23. **A pressed element the app removes mid-gesture** (a drag lifts the card)
    keeps GPUI's gesture going until the release: Kanban's pointer drag,
    headless [kanban](../../examples/kanban/gpuix.test.ts#L98) and Metal
    [kanban](../../examples/kanban/gpuix.test.ts#L165).
24. **A stroke** (Pixel Art): a press on a cell, `mouseenter` on each cell the
    drag crosses, the release on `document`. Headless
    [pixel-art](../../examples/pixel-art/gpuix.test.ts#L84), Metal
    [pixel-art](../../examples/pixel-art/gpuix.test.ts#L129), and in a live
    window with frames under budget ([window.test.ts](test/window.test.ts#L86)).

## Pointer capture

25. **`setPointerCapture(1)` while a button's held** takes effect before the
    next pointer event: `gotpointercapture` there, then the moves and the
    release (pointer and mouse events) go to it, and boundary events treat
    it as hovered. `hasPointerCapture` is true from the call.
    [E](test/events.test.ts#L380)
26. **It ends after `pointerup`:** `lostpointercapture` right after it, before
    `mouseup` (Pointer Events: "immediately after firing the pointerup").
    `releasePointerCapture` ends it before the next event. A capturing
    element taken out of the document loses it at the document.
    [E](test/events.test.ts#L380), [E](test/events.test.ts#L397)
27. **With no button held it does nothing; another pointer id throws
    `NotFoundError`, and an element out of the document `InvalidStateError`.**
    There's one pointer, the mouse, id 1. [E](test/events.test.ts#L421)
28. **A release GPUI never sent** (let go outside the window): the next move
    with no button, or the next press, ends the gesture with the release a
    browser would have sent, and the capture with it.
    [E](test/events.test.ts#L430)

## The wheel

29. **One `wheel` per turn, at the element under the pointer, bubbling.**
    `deltaX`/`deltaY` are positive towards the end (down, right), in pixels
    (`deltaMode` 0) from a trackpad or lines (1) from a wheel.
    [E](test/events.test.ts#L442), Metal [E](test/events.test.ts#L592)
30. **`scroll` only at a scroll area that moved**, not at the elements the
    wheel went through, and none when it was already at the end. It doesn't
    bubble. [E](test/events.test.ts#L442)

## Keys and default actions

31. **Keys go to the focused element** (else the body) and bubble, with their
    modifiers; `keyup` too. ([adapter.test.ts](test/adapter.test.ts#L584))
32. **A prevented `keydown` has no default action.**
    ([adapter.test.ts](test/adapter.test.ts#L615)) The default actions: Tab
    and Shift-Tab move focus in the document's tab order (inside an open
    modal); Enter clicks a focused button or link; a focused scroll area
    scrolls with the arrows, Page Up/Down, Space, Home and End
    ([adapter.test.ts](test/adapter.test.ts#L630)); Enter in a field submits
    its form.
33. **Space clicks a button on its release, only if its press wasn't
    prevented.** [E](test/events.test.ts#L474),
    ([adapter.test.ts](test/adapter.test.ts#L601))
34. **A click's default action:** a submit button submits its form, unless
    the click was prevented.
35. **A press focuses** the nearest focusable element under it, without a
    focus ring. See [Can't](#cant) for when.

## What a change restyles

Not an event, but the other half of an update: what GPUI is told after the
DOM changes.

36. **A change in `<head>`, an `<html>` attribute that doesn't reach the body,
    or a change to an element not yet in the document restyles nothing.**
    snabbdom sets each new element up before inserting it, and inserting it
    styles it. `<html>`'s custom properties, inherited text styles and
    overflow (the viewport's) restyle the body when they change.
    [E](test/events.test.ts#L493)

## Can't

- **The wheel can't be cancelled.** GPUI scrolls before the event reaches
  JavaScript, so `wheel` is dispatched with `cancelable: false`. A zoomable
  canvas that prevents the wheel to keep the page still needs a gpuix change
  (an upstream ask: let the app see the wheel first).
- **Focus moves on the click, not on `mousedown`.** In a browser, focus moves
  as the default action of `mousedown`, so it comes before the release, and a
  prevented `mousedown` keeps focus where it was. Here focus moves with the
  click, after `mouseup` (a press into a field moves it at once: GPUI's
  editor takes it). Next to fix.
- **Leaving the window** is what GPUI reports. Offscreen (Metal tests) there's
  no window edge to cross, so that path is checked headless only.
- **One pointer, the mouse.** No touch or pen, no `pointercancel`.
- **No native context menu**, so preventing `contextmenu` changes nothing
  (FoldKit's `OnContextMenu` prevents it anyway).
- **Not dispatched at all:** HTML drag and drop (`dragstart` and the rest:
  use pointer events, as @foldkit/ui's DragAndDrop does), IME composition
  events and `selectionchange` (gpuix sends only the final value).
