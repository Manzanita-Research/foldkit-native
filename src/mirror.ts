// MIRROR
//
// Keeps GPUI's retained tree in step with the DOM FoldKit renders into, and
// turns GPUI's input events back into DOM events. FoldKit never knows: it
// patches a DOM and listens to DOM events, exactly as in a browser.
//
//   FoldKit ─patch─▶ DOM ─MutationObserver─▶ mirror ─mutations─▶ GPUI
//   FoldKit ◀─listeners── DOM ◀─dispatchEvent── mirror ◀─events── GPUI

import type { EventPayload } from '@gpuix/native'
import {
  type MutationQueue,
  registerEventHandler,
  unregisterEventHandler,
  unregisterEventHandlers,
} from '@gpuix/native/host'
import type { StyleDesc } from '@gpuix/native/host'
import type { Window } from 'happy-dom'
// happy-dom keeps each element's computed style in this cache slot.
import { cache as styleCacheSymbol } from 'happy-dom/lib/PropertySymbol.js'

import { type StateRule, boxStyle, collectStateRules, stateStyles, textStyle } from './style.ts'

type EventHandlerMap = Parameters<typeof registerEventHandler>[0]

/** DOM event name → the gpuix events needed to produce it. HTML drag and
 *  drop has no GPUI equivalent here, so it is built from mouse events. */
const DOM_TO_NATIVE: Readonly<Record<string, ReadonlyArray<string>>> = {
  click: ['click'], contextmenu: ['click'], dblclick: ['click'], auxclick: ['auxClick'],
  mouseup: ['mouseUp'], pointerup: ['mouseUp'],
  // GPUI sends a press's moves and release only to the pressed element (like
  // pointer capture), so whatever hears the press hears the whole gesture,
  // and a drag tracked by listeners on document gets it from there.
  mousedown: ['mouseDown', 'mouseMove', 'mouseUp'], pointerdown: ['mouseDown', 'mouseMove', 'mouseUp'],
  mouseenter: ['mouseEnter'], mouseleave: ['mouseLeave'], mouseover: ['mouseEnter'], mouseout: ['mouseLeave'],
  mousemove: ['mouseMove'], pointermove: ['mouseMove'],
  keydown: ['keyDown'], keyup: ['keyUp'], focus: ['focus'], blur: ['blur'], focusin: ['focus'], focusout: ['blur'],
  input: ['change'], change: ['change'], submit: ['submit'], scroll: ['scroll'],
  // GPUI sends a press's moves and release to the pressed element (like
  // pointer capture), so a drag source hears the whole gesture.
  dragstart: ['mouseDown', 'mouseMove', 'mouseUp'], drag: ['mouseDown', 'mouseMove', 'mouseUp'],
  dragend: ['mouseDown', 'mouseMove', 'mouseUp'],
  dragenter: ['mouseEnter', 'mouseMove'], dragover: ['mouseEnter', 'mouseMove', 'mouseLeave', 'mouseUp'],
  dragleave: ['mouseLeave'], drop: ['mouseMove', 'mouseLeave', 'mouseUp'],
}

/** Pointer and mouse listeners above the body (on `document`, `window` or
 *  `<html>`) have no native element of their own. Every element GPUI sends the
 *  event to dispatches it for them, so it bubbles up: above all the pressed
 *  element during a press. The body, the native root, listens too, though
 *  gpuix doesn't send its root mouse events yet. */
const ROOT_TYPES = new Set(['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup'])

/** A GPUI mouse event → the DOM pointer and mouse events a browser fires for it, in order. */
const POINTER_AND_MOUSE: Readonly<Record<string, readonly [string, string]>> = {
  mouseDown: ['pointerdown', 'mousedown'], mouseMove: ['pointermove', 'mousemove'], mouseUp: ['pointerup', 'mouseup'],
}

/** A held press element: unseen, out of the layout, never under the pointer. */
const HELD = { position: 'absolute', opacity: 0, pointerEvents: 'none' } as const

/** What GPUI sends the pressed element after the press. */
const GESTURE: ReadonlyArray<string> = ['mouseMove', 'mouseUp']

/** gpuix key names → DOM `KeyboardEvent.key`. */
const KEY_NAMES: Readonly<Record<string, string>> = {
  enter: 'Enter', escape: 'Escape', tab: 'Tab', space: ' ', backspace: 'Backspace',
  delete: 'Delete', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
}

// happy-dom's DOM classes are shared by every window, so the methods the
// mirror watches are patched once per class, and each call goes to the mirror
// of the node's own document. A stopped mirror unregisters, and it and its
// window can go (patching per mirror kept every window alive, and ran every
// listener through every mirror ever made).
type Box = { x: number; y: number; width: number; height: number }
const trackers = new WeakMap<object, (target: EventTarget, type: string, delta: number) => void>()
const layouts = new WeakMap<object, (node: Node) => Box | null>()
const rectsPatched = new WeakSet<object>()
const originals = new WeakMap<object, { add: EventTarget['addEventListener']; remove: EventTarget['removeEventListener'] }>()
/** The document a node, document or window belongs to. */
const documentOf = (target: unknown): object | undefined => {
  const node = target as { nodeType?: number; ownerDocument?: object | null; document?: object }
  return node.nodeType === 9 ? node as object : node.ownerDocument ?? node.document
}
/** The prototype in `from`'s chain that defines `key`. */
const owner = (from: object, key: string): Record<string, unknown> => {
  let proto = Object.getPrototypeOf(from)
  while (!Object.prototype.hasOwnProperty.call(proto, key)) proto = Object.getPrototypeOf(proto)
  return proto
}
/** addEventListener and removeEventListener, reporting to the mirror of the
 *  target's document; returns the unpatched pair. */
const watchListeners = (body: Node) => {
  const proto = owner(body, 'addEventListener') as unknown as EventTarget
  let found = originals.get(proto)
  if (found === undefined) {
    const { addEventListener: add, removeEventListener: remove } = proto
    found = { add, remove }
    originals.set(proto, found)
    proto.addEventListener = function (this: EventTarget, type: string, listener: unknown, opts?: unknown) {
      trackers.get(documentOf(this)!)?.(this, type, 1)
      return add.call(this, type, listener as EventListener, opts as AddEventListenerOptions)
    }
    proto.removeEventListener = function (this: EventTarget, type: string, listener: unknown, opts?: unknown) {
      trackers.get(documentOf(this)!)?.(this, type, -1)
      return remove.call(this, type, listener as EventListener, opts as EventListenerOptions)
    }
  }
  return found
}
/** getBoundingClientRect, answered by the mirror of the element's document
 *  where GPUI has painted it, and by happy-dom's zeros where not. */
const watchRects = (body: Node) => {
  const proto = owner(body, 'getBoundingClientRect') as unknown as Element
  if (rectsPatched.has(proto)) return
  rectsPatched.add(proto)
  const unlaidOut = proto.getBoundingClientRect
  proto.getBoundingClientRect = function (this: Element) {
    const document = this.ownerDocument as (Document & { defaultView: { DOMRect: typeof DOMRect } | null }) | null
    const box = document === null ? null : layouts.get(document)?.(this as unknown as Node) ?? null
    if (box === null || document?.defaultView == null) return unlaidOut.call(this)
    return new document.defaultView.DOMRect(box.x, box.y, box.width, box.height)
  }
}

/** scrollTop and scrollLeft: a change an app makes is reported to the mirror
 *  of the element's document (which scrolls GPUI to match). */
const scrollers = new WeakMap<object, (element: Element) => void>()
const scrollPatched = new WeakSet<object>()
const watchScroll = (body: Node) => {
  const proto = owner(body, 'scrollTop')
  if (scrollPatched.has(proto)) return
  scrollPatched.add(proto)
  for (const axis of ['scrollTop', 'scrollLeft'] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, axis)!
    Object.defineProperty(proto, axis, {
      ...descriptor,
      set(this: Element, value: number) {
        const before = descriptor.get!.call(this) as number
        descriptor.set!.call(this, value)
        if (descriptor.get!.call(this) !== before) scrollers.get(this.ownerDocument as object)?.(this)
      },
    })
  }
}

const nativeType = (node: Node): string | undefined => {
  if (node.nodeType === 3) return (node.textContent ?? '').length > 0 ? 'text' : undefined
  if (node.nodeType !== 1) return undefined
  const tag = (node as Element).tagName.toLowerCase()
  if (tag === 'style' || tag === 'script' || tag === 'head' || tag === 'template') return undefined
  if (tag === 'input' || tag === 'textarea' || tag === 'img') return tag
  return 'div'
}

/** One DOM → GPUI sync; `inputAt` is set when an input caused it. */
export type MirrorTimings = { syncMs: number; nodes: number; mutations: number; inputAt?: number }

export const createMirror = (options: {
  window: Window
  mutations: MutationQueue
  eventHandlers: EventHandlerMap
  onSynced?: (timings: MirrorTimings) => void
  /** Where GPUI last laid out an element, in window coordinates, as gpuix
   *  reports it (see `paintedBox`). */
  boundsOf?: (id: number) => { x: number; y: number; width: number; height: number } | null
  /** GPUI's scroll offset for a scroller, gpuix's way: `[x, y]`, negative
   *  when scrolled down or right. */
  scrollOffsetOf?: (id: number) => ReadonlyArray<number> | null
  /** Scrolls a GPUI scroller, with gpuix's negative offsets. */
  scrollTo?: (id: number, x: number, y: number) => void
}) => {
  const { window, mutations, eventHandlers } = options
  const document = window.document as unknown as Document
  const debug = process.env['FOLDKIT_NATIVE_DEBUG'] !== undefined
  const ids = new WeakMap<Node, number>()
  const nodes = new Map<number, Node>()
  const nativeChildren = new Map<number, Array<number>>()
  const listened = new WeakMap<Node, Map<string, number>>()
  const domListened = new WeakMap<Node, Map<string, number>>()
  const listens = (node: Node, domType: string) => (domListened.get(node)?.get(domType) ?? 0) > 0
  /** Listeners above the body, by DOM event type (see ROOT_TYPES). */
  const above = new Map<string, number>()
  const isAbove = (target: EventTarget) =>
    target === (window as unknown) || target === document || target === document.documentElement
  let nextId = 1_000_000 // Clear of gpuix's own counter for window/key events.
  let stateRules: ReadonlyArray<StateRule> = []
  let created = 0

  // DOM EVENTS → which GPUI events an element wants.
  // snabbdom attaches listeners with addEventListener; watch that.
  // The unpatched pair, for the mirror's own listeners (see watchListeners).
  const { add, remove } = watchListeners(document.body as unknown as Node)
  /** Counts the native events a node needs, listening or not as they reach 0. */
  const countNatives = (node: Node, natives: ReadonlyArray<string>, delta: number) => {
    const counts = listened.get(node) ?? new Map<string, number>()
    listened.set(node, counts)
    for (const native of natives) {
      const before = counts.get(native) ?? 0
      counts.set(native, Math.max(0, before + delta))
      const id = ids.get(node)
      if (id !== undefined && (before === 0) !== (counts.get(native) === 0)) syncListener(id, native, before === 0)
    }
  }
  const track = (target: EventTarget, type: string, delta: number) => {
    const natives = DOM_TO_NATIVE[type]
    if (natives === undefined) return
    if (isAbove(target)) {
      if (!ROOT_TYPES.has(type)) return
      above.set(type, Math.max(0, (above.get(type) ?? 0) + delta))
      countNatives(document.body as unknown as Node, natives, delta)
      return
    }
    if (!(target as Node).nodeType) return
    const dom = domListened.get(target as Node) ?? new Map<string, number>()
    domListened.set(target as Node, dom)
    dom.set(type, Math.max(0, (dom.get(type) ?? 0) + delta))
    countNatives(target as Node, natives, delta)
  }
  trackers.set(document, track)

  // SCROLL POSITION, both ways. GPUI owns scrolling; the DOM's scrollTop and
  // scrollLeft follow it, so an app reading them (FoldKit's OnScroll) sees
  // where GPUI is. An app setting them (or calling scrollTo) scrolls GPUI, and
  // hears `scroll` back, as in a browser. Copying GPUI's offset into the DOM
  // never writes back, so a scroll can't echo between the two.
  let readingScroll = false
  watchScroll(document.body as unknown as Node)
  scrollers.set(document, element => {
    const id = ids.get(element as unknown as Node)
    if (readingScroll || id === undefined || options.scrollTo === undefined) return
    options.scrollTo(id, -element.scrollLeft || 0, -element.scrollTop || 0)
    setTimeout(() => {
      if (ids.has(element as unknown as Node)) element.dispatchEvent(new W['Event']!('scroll', { bubbles: false }))
    }, 0)
  })
  /** Copies GPUI's scroll offset for `node` into the DOM. */
  const readScroll = (node: Node) => {
    const id = ids.get(node)
    const offset = id === undefined ? null : options.scrollOffsetOf?.(id)
    if (offset === null || offset === undefined) return
    readingScroll = true
    try {
      ;(node as Element).scrollLeft = -(offset[0] ?? 0)
      ;(node as Element).scrollTop = -(offset[1] ?? 0)
    } finally {
      readingScroll = false
    }
  }

  // GPUI EVENTS → DOM EVENTS
  let lastClick: { node: Node; at: number; sameTask: boolean } | undefined
  // GPUI sends a keystroke to the focused element and to the window, back to
  // back. The first copy dispatches; the other one of the pair is skipped. A
  // key only the window hears (nothing focused listens) still dispatches.
  let lastKey: { key: string | undefined; type: string; from: 'element' | 'window'; at: number; sameTask: boolean } | undefined
  const firstOfPair = (event: EventPayload, from: 'element' | 'window') => {
    const now = performance.now()
    const last = lastKey
    if (last !== undefined && (last.sameTask || now - last.at < 4) && last.from !== from &&
      last.key === event.key && last.type === event.eventType) {
      lastKey = undefined
      return false
    }
    const next = { key: event.key, type: event.eventType, from, at: now, sameTask: true }
    lastKey = next
    queueMicrotask(() => {
      next.sameTask = false
    })
    return true
  }
  /** When the latest input arrived, for click → frame timing. */
  let inputAt: number | undefined
  // Drag and drop, rebuilt from mouse events: a press on something listening
  // for dragstart becomes a drag once the pointer moves a few pixels.
  let press: { node: Node; x: number; y: number } | undefined
  let drag: { source: Node; over: Node | undefined } | undefined
  const W = window as unknown as Record<string, new (type: string, init: object) => Event>
  const dragEvent = (type: string, init: object) =>
    new (W['DragEvent'] ?? W['MouseEvent'])!(type, { ...init, bubbles: true, cancelable: true })
  const endDrag = (dropOn: Node | undefined, init: object) => {
    if (drag === undefined) return
    const { source, over } = drag
    drag = undefined
    if (dropOn !== undefined) dropOn.dispatchEvent(dragEvent('drop', init))
    else if (over !== undefined) over.dispatchEvent(dragEvent('dragleave', init))
    source.dispatchEvent(dragEvent('dragend', init))
  }
  /** The padding and borders sent to GPUI for each element, by id. */
  const sentBoxes = new Map<number, StyleDesc>()
  /** Where GPUI painted an element: its border box. gpuix's bounds start at
   *  the content corner (moved right and down by the left/top border and
   *  padding) and leave the borders out of the size; this undoes both. */
  const paintedBox = (id: number): Box | null => {
    const box = options.boundsOf?.(id)
    if (box === null || box === undefined) return null
    const s = (sentBoxes.get(id) ?? {}) as Record<string, number | undefined>
    const [left, top, right, bottom] = ['Left', 'Top', 'Right', 'Bottom'].map(side => s[`border${side}Width`] ?? 0) as [number, number, number, number]
    return {
      x: box.x - left - (s['paddingLeft'] ?? 0),
      y: box.y - top - (s['paddingTop'] ?? 0),
      width: box.width + left + right,
      height: box.height + top + bottom,
    }
  }
  /** The drop zone under the pointer. The captured events all name the drag
   *  source, so zones are found by where GPUI painted them. */
  const zoneAt = (x: number, y: number): Node | undefined => {
    let found: Node | undefined
    for (const [id, node] of nodes) {
      if (!(listens(node, 'dragover') || listens(node, 'drop'))) continue
      const box = paintedBox(id)
      if (box && x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height) {
        if (found === undefined || found.contains(node)) found = node
      }
    }
    return found
  }
  // When the last drag ended: never, so a click right after startup counts.
  let dragEndedAt = -Infinity
  // GPUI can send one mouse event to several listening elements under the
  // pointer, innermost first. The innermost one's dispatch has already
  // bubbled through the others, so their copies aren't dispatched again.
  let bubbled: { node: Node; types: Set<string>; at: number; sameTask: boolean } | undefined
  // The element GPUI sends the current press's moves and release to. If the
  // app removes it mid-gesture (a drag that lifts the item out of its list),
  // its native twin is held, unseen and out of the layout, until the release,
  // or GPUI would have nowhere to send the rest of the gesture.
  let pressed: { id: number; node: Node; held: boolean } | undefined
  const releasePressed = () => {
    const done = pressed
    pressed = undefined
    if (done === undefined) return
    if (!done.held) {
      // Listeners removed mid-gesture stop now.
      for (const native of GESTURE) {
        if ((listened.get(done.node)?.get(native) ?? 0) === 0) syncListener(done.id, native, false)
      }
      return
    }
    queueMicrotask(() => {
      forget(done.node)
      mutations.destroyElement(done.id)
      mutations.flushMutations()
    })
  }
  const toDom = (node: Node, event: EventPayload) => {
    // GPUI's modifiers ride on every key and mouse event (cmd is the platform
    // key: ⌘ on macOS, so `metaKey`, as a browser has it).
    const held = event.modifiers
    const init = {
      bubbles: true, cancelable: true, clientX: event.x ?? 0, clientY: event.y ?? 0,
      ctrlKey: held?.ctrl ?? false, metaKey: held?.cmd ?? false, shiftKey: held?.shift ?? false, altKey: held?.alt ?? false,
    }
    if (event.eventType === 'click' || event.eventType === 'mouseUp' || event.eventType === 'keyDown') {
      inputAt = performance.now()
    }
    // A press whose release GPUI never sent (let go outside the window): a
    // move with no button held, or a new press elsewhere, ends it first, with
    // the release a browser would have sent.
    if (pressed !== undefined && ((event.eventType === 'mouseMove' && event.pressedButton == null) ||
      (event.eventType === 'mouseDown' && !pressed.node.contains(node)))) {
      toDom(pressed.node, { ...event, eventType: 'mouseUp', button: 0, clickCount: 1 })
    }
    if (event.eventType === 'mouseDown' && pressed === undefined) {
      // The innermost element GPUI hit is the one it captures the gesture for.
      const id = ids.get(node)
      if (id !== undefined) pressed = { id, node, held: false }
    }
    switch (event.eventType) {
      case 'mouseDown':
        if (listens(node, 'dragstart')) press = { node, x: event.x ?? 0, y: event.y ?? 0 }
        break
      case 'mouseMove':
        if (press !== undefined && drag === undefined && event.pressedButton === 0 &&
          Math.hypot((event.x ?? 0) - press.x, (event.y ?? 0) - press.y) > 4) {
          drag = { source: press.node, over: undefined }
          press.node.dispatchEvent(dragEvent('dragstart', init))
        }
        if (drag !== undefined) {
          const target = zoneAt(event.x ?? 0, event.y ?? 0)
          if (target !== drag.over) {
            drag.over?.dispatchEvent(dragEvent('dragleave', init))
            target?.dispatchEvent(dragEvent('dragenter', init))
            drag.over = target
          }
          target?.dispatchEvent(dragEvent('dragover', init))
          return
        }
        break
      case 'mouseUp':
        press = undefined
        if (drag !== undefined) {
          inputAt = performance.now()
          dragEndedAt = inputAt
          endDrag(zoneAt(event.x ?? 0, event.y ?? 0), init)
          releasePressed()
          return
        }
        break
    }
    switch (event.eventType) {
      case 'click': {
        // GPUI reports a click to every listening ancestor; the DOM bubbles it
        // itself, so only the innermost one is dispatched. A second click on
        // the same element is a new click, however quick.
        const now = performance.now()
        // The release that ends a drag isn't a click.
        if (now - dragEndedAt < 150) return
        // The copies arrive back to back: in the same task, or within a few
        // milliseconds (a slow machine can stretch one task past 4 ms).
        if (lastClick !== undefined && (lastClick.sameTask || now - lastClick.at < 4) &&
          node !== lastClick.node && node.contains(lastClick.node)) return
        const click = { node, at: now, sameTask: true }
        lastClick = click
        queueMicrotask(() => {
          click.sameTask = false
        })
        const mouse = { ...init, button: event.button ?? 0, detail: event.clickCount ?? 1 }
        if (event.isRightClick) {
          node.dispatchEvent(new W['MouseEvent']!('contextmenu', mouse))
          return
        }
        // Like a browser: every press is a click, its `detail` counting the
        // run (1, 2, 3…), and the second one is also a dblclick. A double
        // click on a +1 button counts twice.
        node.dispatchEvent(new W['MouseEvent']!('click', mouse))
        if (mouse.detail === 2) node.dispatchEvent(new W['MouseEvent']!('dblclick', mouse))
        return
      }
      case 'mouseDown': case 'mouseUp': case 'mouseMove': {
        // A press and its release carry the click count, as `detail` does in a
        // browser. The window is the screen: screen coordinates are window ones.
        const mouse = {
          ...init, screenX: init.clientX, screenY: init.clientY, button: event.button ?? 0,
          detail: event.eventType === 'mouseMove' ? 0 : event.clickCount ?? 1,
        }
        // A held press element is out of the DOM: what's above it still hears the gesture.
        const at = node.isConnected ? node : body
        for (const type of POINTER_AND_MOUSE[event.eventType]!) {
          if (!((at === node && listens(node, type)) || (above.get(type) ?? 0) > 0)) continue
          const now = performance.now()
          const recent = bubbled !== undefined && (bubbled.sameTask || now - bubbled.at < 4) ? bubbled : undefined
          if (recent !== undefined && recent.types.has(type) && at !== recent.node && at.contains(recent.node)) continue
          if (recent?.node !== at) {
            const next = { node: at, types: new Set<string>(), at: now, sameTask: true }
            bubbled = next
            queueMicrotask(() => {
              next.sameTask = false
            })
          }
          bubbled!.types.add(type)
          at.dispatchEvent(type.startsWith('pointer')
            ? new W['PointerEvent']!(type, { ...mouse, pointerId: 1, pointerType: 'mouse', isPrimary: true })
            : new W['MouseEvent']!(type, mouse))
        }
        if (event.eventType === 'mouseUp') releasePressed()
        return
      }
      case 'mouseEnter': case 'mouseLeave': {
        const enter = event.eventType === 'mouseEnter'
        node.dispatchEvent(new W['MouseEvent']!(enter ? 'mouseenter' : 'mouseleave', { ...init, bubbles: false }))
        node.dispatchEvent(new W['MouseEvent']!(enter ? 'mouseover' : 'mouseout', init))
        return
      }
      case 'keyDown': case 'keyUp': {
        const key = event.key === undefined ? '' : KEY_NAMES[event.key] ?? (event.key.length === 1 ? event.key : event.key)
        node.dispatchEvent(new W['KeyboardEvent']!(event.eventType === 'keyDown' ? 'keydown' : 'keyup', { ...init, key }))
        return
      }
      case 'change': {
        ;(node as HTMLInputElement).value = event.value ?? ''
        node.dispatchEvent(new W['Event']!('input', init))
        node.dispatchEvent(new W['Event']!('change', init))
        return
      }
      case 'submit': {
        // Enter in a field: the browser's implicit submission.
        const form = (node as HTMLInputElement).form
        if (form !== null && form !== undefined) form.requestSubmit()
        return
      }
      case 'scroll':
        // A wheel or trackpad scrolled the element in GPUI: the DOM learns
        // where it is now, then hears `scroll` (which doesn't bubble).
        readScroll(node)
        node.dispatchEvent(new W['Event']!('scroll', { bubbles: false }))
        return
      case 'focus': case 'blur':
        node.dispatchEvent(new W['FocusEvent']!(event.eventType, { bubbles: false }))
        node.dispatchEvent(new W['FocusEvent']!(event.eventType === 'focus' ? 'focusin' : 'focusout', { bubbles: true }))
        return
      default:
        node.dispatchEvent(new W['Event']!(event.eventType, init))
    }
  }

  const syncListener = (id: number, native: string, on: boolean) => {
    // Removing an element drops its listeners (snabbdom does it on destroy);
    // the pressed one keeps hearing the gesture until the release.
    if (!on && pressed?.id === id && GESTURE.includes(native)) return
    if (debug) process.stderr.write(`foldkit-native: listen ${id} ${native} ${on}\n`)
    if (on) registerEventHandler(eventHandlers, id, native, event => {
      if (debug) process.stderr.write(`foldkit-native: event ${id} ${event.eventType}\n`)
      const node = nodes.get(id)
      if ((event.eventType === 'keyDown' || event.eventType === 'keyUp') && !firstOfPair(event, 'element')) return
      if (node !== undefined) toDom(node, event)
    })
    else unregisterEventHandler(eventHandlers, id, native)
    mutations.setEventListener(id, native, on)
  }

  // STYLE
  /** An element's custom property, inherited ones included: happy-dom's
   *  computed style lists only the element's own, so walk up to find it. */
  const customProperty = (element: Element) => (name: string): string => {
    for (let at: Element | null = element; at !== null; at = at.parentElement) {
      const value = window.getComputedStyle(at as never).getPropertyValue(name).trim()
      if (value !== '') return value
    }
    return ''
  }
  const displayOf = (element: Element) => window.getComputedStyle(element as never).getPropertyValue('display')
  /** happy-dom reports '' for elements that are inline by default (span, label). */
  const blockLevel = (display: string) => display !== '' && display !== 'none' && display !== 'contents' && !display.startsWith('inline')
  /** Whether an element's children include inline content (text, or inline
   *  or inline-block elements) beside its elements. */
  const inlineRow = (element: Element) => {
    let row = inlineRows.get(element)
    if (row === undefined) {
      row = element.children.length > 0 && Array.from(element.childNodes).some(
        child => child.nodeType === 3 || (child.nodeType === 1 && displayOf(child as Element).startsWith('inline')))
      inlineRows.set(element, row)
    }
    return row
  }
  // Every child asks about its parent, so remember the answer for one sync.
  let inlineRows = new WeakMap<Element, boolean>()

  const styleOf = (node: Node): StyleDesc => {
    if (node.nodeType === 3) {
      const parent = node.parentElement
      return parent === null ? {} : textStyle(window.getComputedStyle(parent as never))
    }
    const element = node as Element
    const computed = window.getComputedStyle(element as never)
    const style: Record<string, unknown> = { ...boxStyle(computed) }
    // A text field draws its own text: it needs the text style a text node gets.
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') Object.assign(style, textStyle(computed))
    // Inline runs (spans, links, text beside elements) become a wrapping row:
    // GPUI has blocks and flex, not inline formatting.
    if (style['display'] === undefined && inlineRow(element)) {
      Object.assign(style, { display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline' })
      // text-align places the inline content on each line.
      const align = { center: 'center', right: 'flex-end', end: 'flex-end' }[String(style['textAlign'])]
      if (align !== undefined) style['justifyContent'] = align
    }
    // In that row a block child still takes a whole line, as in a browser,
    // rather than shrinking to fit its content.
    const parent = element.parentElement
    if (style['width'] === undefined && blockLevel(displayOf(element)) && parent !== null &&
      !['flex', 'inline-flex', 'grid', 'none'].includes(displayOf(parent)) && inlineRow(parent)) {
      style['width'] = '100%'
    }
    Object.assign(style, stateStyles(element, stateRules, customProperty(element)))
    const aspect = aspectOf(computed)
    if (aspect === undefined) aspects.delete(node)
    else {
      const known = aspects.get(node)
      if (known?.ratio !== aspect) aspects.set(node, { ratio: aspect })
      else if (known.height !== undefined) style['height'] = known.height
    }
    return style as StyleDesc
  }

  // ASPECT RATIO
  // gpuix has no aspect-ratio (GPUI's layout engine does; gpuix doesn't pass
  // it through), so an element with one and an auto height gets its height
  // from the width GPUI laid it out at: `w-full aspect-square` stays square.
  // The host calls afterLayout() once GPUI has laid out a frame.
  const aspects = new Map<Node, { ratio: number; width?: number; height?: number }>()
  const aspectOf = (computed: Pick<CSSStyleDeclaration, 'getPropertyValue'>): number | undefined => {
    const height = computed.getPropertyValue('height').trim()
    if (height !== '' && height !== 'auto') return undefined
    const match = /(-?[\d.]+)\s*(?:\/\s*(-?[\d.]+))?\s*$/.exec(computed.getPropertyValue('aspect-ratio'))
    if (match === null) return undefined
    const ratio = Number(match[1]) / Number(match[2] ?? 1)
    return Number.isFinite(ratio) && ratio > 0 ? ratio : undefined
  }
  /** One correction pass: each aspect-ratio element whose laid-out width
   *  changed gets its height. True if anything changed (GPUI should lay out
   *  again); a pass with the same widths changes nothing, so it can't loop. */
  const afterLayout = (): boolean => {
    if (options.boundsOf === undefined) return false
    let changed = false
    for (const [node, aspect] of aspects) {
      const id = ids.get(node)
      if (id === undefined || !node.isConnected) {
        aspects.delete(node)
        continue
      }
      const box = options.boundsOf(id)
      if (box === null || box.width === aspect.width) continue
      aspect.width = box.width
      aspect.height = Math.round((box.width / aspect.ratio) * 100) / 100
      mutations.setStyle(id, styleOf(node))
      changed = true
    }
    if (changed) mutations.flushMutations()
    return changed
  }

  /** GPUI has no text-transform, so the text itself is transformed. */
  const textOf = (node: Node) => {
    const text = node.textContent ?? ''
    const parent = node.parentElement
    if (parent === null) return text
    const transform = window.getComputedStyle(parent as never).getPropertyValue('text-transform')
    return transform === 'uppercase' ? text.toUpperCase() : transform === 'lowercase' ? text.toLowerCase() : text
  }

  const syncProps = (id: number, node: Node) => {
    if (node.nodeType === 3) {
      mutations.setText(id, textOf(node))
      mutations.setStyle(id, styleOf(node))
      return
    }
    const element = node as Element
    const style = styleOf(node)
    sentBoxes.set(id, style)
    mutations.setStyle(id, style)
    // Accessibility travels as gpuix's universal props.
    for (const name of ['role', 'aria-label', 'aria-description', 'aria-expanded', 'aria-selected', 'aria-level']) {
      const value = element.getAttribute(name)
      if (value !== null) mutations.setCustomProp(id, name, value)
    }
    // Focus order and animation are gpuix props, carried by attributes.
    const tabIndex = element.getAttribute('tabindex')
    if (tabIndex !== null) mutations.setCustomProp(id, 'tabIndex', Number(tabIndex))
    if (element.hasAttribute('autofocus')) mutations.setCustomProp(id, 'autoFocus', true)
    const motion = element.getAttribute('data-fn-motion')
    if (motion !== null) {
      try {
        mutations.setCustomProp(id, 'motion', JSON.parse(motion))
      } catch {
        // Not JSON: ignore, as CSS ignores an invalid value.
      }
    }
    if (element.tagName === 'IMG') {
      const image = element as HTMLImageElement
      mutations.setCustomProp(id, 'src', image.getAttribute('src') ?? '')
      if (image.alt) mutations.setCustomProp(id, 'alt', image.alt)
      const fit = window.getComputedStyle(element as never).getPropertyValue('object-fit')
      const objectFit = { fill: 'fill', contain: 'contain', cover: 'cover', 'scale-down': 'scaleDown', none: 'none' }[fit]
      if (objectFit !== undefined) mutations.setCustomProp(id, 'objectFit', objectFit)
    }
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      const input = element as HTMLInputElement
      mutations.setCustomProp(id, 'value', input.value)
      if (input.placeholder) mutations.setCustomProp(id, 'placeholder', input.placeholder)
    }
  }

  // LAYOUT, READ BACK
  // happy-dom has no layout; GPUI does. Where GPUI last painted an element
  // answers getBoundingClientRect and document.elementsFromPoint, which
  // FoldKit's DragAndDrop uses to find the drop target under the pointer.
  // (Scroll offsets and ResizeObserver are still zero: README, roadmap 2.)
  if (options.boundsOf !== undefined) {
    const boxOf = (node: Node) => {
      const id = ids.get(node)
      return id === undefined ? null : paintedBox(id)
    }
    watchRects(document.body as unknown as Node)
    layouts.set(document, boxOf)
    /** Every element GPUI painted under the point, topmost first: children
     *  over parents, later siblings over earlier ones, as GPUI paints them.
     *  `pointer-events: none` ones are skipped, as a browser skips them. */
    const elementsFromPoint = (x: number, y: number): Array<Element> => {
      const all = [document.body, ...Array.from(document.body.querySelectorAll('*'))]
      const hits: Array<Element> = []
      for (const element of all.reverse()) {
        const box = boxOf(element as unknown as Node)
        if (box === null || x < box.x || x > box.x + box.width || y < box.y || y > box.y + box.height) continue
        if (window.getComputedStyle(element as never).getPropertyValue('pointer-events') === 'none') continue
        hits.push(element)
      }
      return hits
    }
    Object.assign(document, {
      elementsFromPoint,
      elementFromPoint: (x: number, y: number) => elementsFromPoint(x, y)[0] ?? null,
    })
  }

  // TREE
  // Forms, as a browser runs them: a submit button submits its form with no
  // click listener of its own, and Enter in a field submits it too (gpuix's
  // input sends `submit` on Enter). So both listen natively, once each.
  const formParts = new WeakSet<Node>()
  const listenForForm = (node: Node) => {
    if (node.nodeType !== 1 || formParts.has(node)) return
    const element = node as HTMLInputElement | HTMLButtonElement
    if (element.form === null || element.form === undefined) return
    const tag = element.tagName.toLowerCase()
    const type = (element.getAttribute('type') ?? '').toLowerCase()
    if ((tag === 'button' && (type === '' || type === 'submit')) || (tag === 'input' && (type === 'submit' || type === 'image'))) {
      formParts.add(node)
      track(node, 'click', 1)
    } else if (tag === 'input' && ['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(type)) {
      formParts.add(node)
      track(node, 'submit', 1)
    }
  }

  // Links, as a browser runs them: an <a href> is clickable with no click
  // listener of its own. FoldKit's routing hears link clicks on `document`,
  // which has no native element, so the link listens natively and the click
  // bubbles up to it from there.
  const links = new WeakSet<Node>()
  const listenForLink = (node: Node) => {
    if (node.nodeType !== 1 || links.has(node)) return
    const element = node as Element
    if (element.tagName !== 'A' || !element.hasAttribute('href')) return
    links.add(node)
    track(node, 'click', 1)
  }
  // A link click nobody handled would make happy-dom navigate, replacing the
  // window and the app with it. There's one window and no browser to hand the
  // link to, so an unhandled link click does nothing. (On the window, so it
  // runs after FoldKit's listener on document has had its chance.)
  const keepWindow = (event: Event) => {
    if (!event.defaultPrevented && (event.target as Element | null)?.closest?.('a[href]')) event.preventDefault()
  }
  add.call(window as unknown as EventTarget, 'click', keepWindow)

  const create = (node: Node): number | undefined => {
    const type = nativeType(node)
    if (type === undefined) return undefined
    listenForForm(node)
    listenForLink(node)
    const id = nextId++
    created += 1
    ids.set(node, id)
    nodes.set(id, node)
    mutations.createElement(id, type)
    syncProps(id, node)
    for (const [native, count] of listened.get(node) ?? []) if (count > 0) syncListener(id, native, true)
    if (type === 'div') {
      const children: Array<number> = []
      for (const child of Array.from(node.childNodes)) {
        const childId = create(child)
        if (childId === undefined) continue
        mutations.appendChild(id, childId)
        children.push(childId)
      }
      nativeChildren.set(id, children)
    }
    return id
  }

  const forget = (node: Node) => {
    const id = ids.get(node)
    if (id !== undefined) {
      ids.delete(node)
      nodes.delete(id)
      nativeChildren.delete(id)
      sentBoxes.delete(id)
      unregisterEventHandlers(eventHandlers, id)
    }
    for (const child of Array.from(node.childNodes)) forget(child)
  }

  /** Makes a parent's native children match its DOM children, in order. */
  const syncChildren = (parent: Node) => {
    const parentId = ids.get(parent)
    if (parentId === undefined) return
    // A textarea's text is its value (FoldKit writes it that way), not a child.
    if (nativeType(parent) !== 'div') return syncProps(parentId, parent)
    const current = nativeChildren.get(parentId) ?? []
    const desired: Array<number> = []
    for (const child of Array.from(parent.childNodes)) {
      // Text emptied since it was drawn isn't drawn any more.
      const id = nativeType(child) === undefined ? undefined : ids.get(child) ?? create(child)
      if (id !== undefined) desired.push(id)
      if (pressed?.held === true && pressed.node === child) {
        // Back in the DOM: no longer held, and drawn as it is again.
        pressed.held = false
        syncProps(pressed.id, child)
      }
    }
    const keep = new Set(desired)
    for (const id of current) {
      if (keep.has(id)) continue
      const node = nodes.get(id)
      if (pressed?.id === id && node !== undefined && node.parentNode === null) {
        pressed.held = true
        if (debug) process.stderr.write(`foldkit-native: hold ${id}\n`)
        sentBoxes.set(id, HELD)
        mutations.setStyle(id, HELD)
        continue
      }
      if (node !== undefined && (node.parentNode === null || nativeType(node) === undefined)) forget(node)
      if (node === undefined || !ids.has(node)) mutations.destroyElement(id)
    }
    const remaining = current.filter(id => keep.has(id))
    if (remaining.length !== desired.length || remaining.some((id, i) => id !== desired[i])) {
      // appendChild moves an attached child, so re-appending in order sorts them.
      const firstChange = desired.findIndex((id, i) => remaining[i] !== id)
      for (const id of desired.slice(Math.max(0, firstChange))) mutations.appendChild(parentId, id)
    }
    nativeChildren.set(parentId, desired)
  }

  const restyle = (node: Node) => {
    // happy-dom caches selector matches per element and doesn't invalidate a
    // descendant's when an ancestor's attribute changes (`[data-kind="x"] .dot`
    // kept matching the old kind). Drop both caches so the cascade is redone.
    const slot = (node as unknown as Record<symbol, { computedStyle?: unknown; matches?: Map<string, unknown> } | undefined>)[styleCacheSymbol]
    if (slot !== undefined) {
      slot.computedStyle = null
      slot.matches?.clear()
    }
    const id = ids.get(node)
    if (id !== undefined) syncProps(id, node)
    for (const child of Array.from(node.childNodes)) restyle(child)
  }

  // The body is the native root; FoldKit's view replaces its container inside it.
  const body = document.body as unknown as Node
  // The body always listens for a release: one anywhere ends a drag that
  // missed every drop zone. (gpuix doesn't send its root mouse events yet; the
  // pressed element hears its own release, so drags end there.)
  countNatives(body, ['mouseUp'], 1)
  const rootId = create(body)!
  mutations.setRoot(rootId)
  mutations.flushMutations()

  const observer = new (window as unknown as { MutationObserver: typeof MutationObserver }).MutationObserver(records => {
    const started = performance.now()
    inlineRows = new WeakMap()
    created = 0
    const parents = new Set<Node>()
    const styled = new Set<Node>()
    for (const record of records) {
      if (record.type === 'childList') {
        // New children are styled as they are created; only order changes here.
        parents.add(record.target)
      } else if (record.type === 'characterData') {
        const id = ids.get(record.target)
        const empty = (record.target.textContent ?? '') === ''
        // Empty text isn't drawn: text that becomes empty, or appears in a
        // node that was empty (an aria-live announcement), changes the children.
        if (id !== undefined && !empty) mutations.setText(id, textOf(record.target))
        else if (record.target.parentNode !== null) parents.add(record.target.parentNode)
      } else if (record.type === 'attributes') {
        if (record.target.nodeName === 'STYLE') continue
        if (debug) process.stderr.write(`foldkit-native: attr ${(record.target as Element).className} ${record.attributeName}\n`)
        styled.add(record.target)
      }
    }
    for (const parent of parents) syncChildren(parent)
    // Class and style changes cascade to descendants (and their text).
    for (const node of styled) if (ids.has(node)) restyle(node)
    const pending = mutations.pending
    mutations.flushMutations()
    options.onSynced?.({
      syncMs: performance.now() - started,
      nodes: created,
      mutations: pending,
      ...(inputAt === undefined ? {} : { inputAt }),
    })
    inputAt = undefined
  })
  observer.observe(body as never, { subtree: true, childList: true, attributes: true, characterData: true })

  // A changed stylesheet or root token (a theme switch) can change any element.
  const restyleAll = () => {
    inlineRows = new WeakMap()
    stateRules = collectStateRules(document)
    restyle(body)
    mutations.flushMutations()
  }
  const themeObserver = new (window as unknown as { MutationObserver: typeof MutationObserver }).MutationObserver(restyleAll)
  themeObserver.observe(document.head as never, { subtree: true, childList: true, characterData: true })
  themeObserver.observe(document.documentElement as never, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] })

  return {
    /** Re-read stylesheets (call after adding or changing CSS). */
    /** Re-read stylesheets and restyle everything (also automatic when a
     *  <style> or the root's style/class/data-theme changes). */
    refreshStyles: () => restyleAll(),
    nodeFor: (id: number) => nodes.get(id),
    idFor: (node: Node) => ids.get(node),
    /** Window-level keys go to the focused element, like a browser. */
    /** Call once GPUI has laid out a frame: elements with an aspect-ratio get
     *  their heights. True if it changed anything (lay out again). */
    afterLayout,
    windowKey: (event: EventPayload) => {
      if (firstOfPair(event, 'window')) toDom((document.activeElement as Node | null) ?? body, event)
    },
    stop: () => {
      trackers.delete(document)
      layouts.delete(document)
      scrollers.delete(document)
      observer.disconnect()
      themeObserver.disconnect()
      remove.call(window as unknown as EventTarget, 'click', keepWindow)
    },
  }
}
