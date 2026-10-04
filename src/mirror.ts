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
  mousedown: ['mouseDown'], mouseup: ['mouseUp'], pointerdown: ['mouseDown'], pointerup: ['mouseUp'],
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

/** gpuix key names → DOM `KeyboardEvent.key`. */
const KEY_NAMES: Readonly<Record<string, string>> = {
  enter: 'Enter', escape: 'Escape', tab: 'Tab', space: ' ', backspace: 'Backspace',
  delete: 'Delete', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
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
  /** Where GPUI last painted an element, in window coordinates. */
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
  let nextId = 1_000_000 // Clear of gpuix's own counter for window/key events.
  let stateRules: ReadonlyArray<StateRule> = []
  let created = 0

  // DOM EVENTS → which GPUI events an element wants.
  // snabbdom attaches listeners with addEventListener; watch that.
  // happy-dom builds classes per window, so find the prototype in the real
  // chain of a DOM node that owns addEventListener rather than trusting
  // window.EventTarget.
  let proto = Object.getPrototypeOf(document.body) as EventTarget
  while (!Object.prototype.hasOwnProperty.call(proto, 'addEventListener')) proto = Object.getPrototypeOf(proto)
  const add = proto.addEventListener
  const remove = proto.removeEventListener
  const track = (target: EventTarget, type: string, delta: number) => {
    const natives = DOM_TO_NATIVE[type]
    if (natives === undefined || !(target as Node).nodeType) return
    const dom = domListened.get(target as Node) ?? new Map<string, number>()
    domListened.set(target as Node, dom)
    dom.set(type, Math.max(0, (dom.get(type) ?? 0) + delta))
    const counts = listened.get(target as Node) ?? new Map<string, number>()
    listened.set(target as Node, counts)
    for (const native of natives) {
      const before = counts.get(native) ?? 0
      counts.set(native, Math.max(0, before + delta))
      const id = ids.get(target as Node)
      if (id !== undefined && (before === 0) !== (counts.get(native) === 0)) syncListener(id, native, before === 0)
    }
  }
  proto.addEventListener = function (type: string, listener: unknown, opts?: unknown) {
    track(this, type, 1)
    return add.call(this, type, listener as EventListener, opts as AddEventListenerOptions)
  }
  proto.removeEventListener = function (type: string, listener: unknown, opts?: unknown) {
    track(this, type, -1)
    return remove.call(this, type, listener as EventListener, opts as EventListenerOptions)
  }

  // SCROLL POSITION, both ways. GPUI owns scrolling; the DOM's scrollTop and
  // scrollLeft follow it, so an app reading them (FoldKit's OnScroll) sees
  // where GPUI is. An app setting them (or calling scrollTo) scrolls GPUI, and
  // hears `scroll` back, as in a browser. Copying GPUI's offset into the DOM
  // never writes back, so a scroll can't echo between the two.
  let readingScroll = false
  let scrollProto = Object.getPrototypeOf(document.body) as object
  while (!Object.prototype.hasOwnProperty.call(scrollProto, 'scrollTop')) scrollProto = Object.getPrototypeOf(scrollProto)
  for (const axis of ['scrollTop', 'scrollLeft'] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(scrollProto, axis)!
    Object.defineProperty(scrollProto, axis, {
      ...descriptor,
      set(this: Element, value: number) {
        const before = descriptor.get!.call(this) as number
        descriptor.set!.call(this, value)
        const id = ids.get(this as unknown as Node)
        if (readingScroll || id === undefined || options.scrollTo === undefined) return
        if (descriptor.get!.call(this) === before) return
        options.scrollTo(id, -this.scrollLeft || 0, -this.scrollTop || 0)
        setTimeout(() => {
          if (ids.has(this as unknown as Node)) this.dispatchEvent(new W['Event']!('scroll', { bubbles: false }))
        }, 0)
      },
    })
  }
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
  /** The drop zone under the pointer. The captured events all name the drag
   *  source, so zones are found by where GPUI painted them. */
  const zoneAt = (x: number, y: number): Node | undefined => {
    let found: Node | undefined
    for (const [id, node] of nodes) {
      if (!(listens(node, 'dragover') || listens(node, 'drop'))) continue
      const box = options.boundsOf?.(id)
      if (box && x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height) {
        if (found === undefined || found.contains(node)) found = node
      }
    }
    return found
  }
  // When the last drag ended: never, so a click right after startup counts.
  let dragEndedAt = -Infinity
  const toDom = (node: Node, event: EventPayload) => {
    const init = { bubbles: true, cancelable: true, clientX: event.x ?? 0, clientY: event.y ?? 0 }
    if (event.eventType === 'click' || event.eventType === 'mouseUp' || event.eventType === 'keyDown') {
      inputAt = performance.now()
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
        const type = { mouseDown: 'mousedown', mouseUp: 'mouseup', mouseMove: 'mousemove' }[event.eventType]!
        if (!listens(node, type)) return
        // A press and its release carry the click count, as `detail` does in a browser.
        const detail = type === 'mousemove' ? 0 : event.clickCount ?? 1
        node.dispatchEvent(new W['MouseEvent']!(type, { ...init, button: event.button ?? 0, detail }))
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
    if (debug) process.stderr.write(`foldkit-native: listen ${id} ${native} ${on}\n`)
    if (on) registerEventHandler(eventHandlers, id, native, event => {
      if (debug) process.stderr.write(`foldkit-native: event ${id} ${event.eventType}\n`)
      const node = nodes.get(id)
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
    return style as StyleDesc
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
    mutations.setStyle(id, styleOf(node))
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
      const id = ids.get(child) ?? create(child)
      if (id !== undefined) desired.push(id)
    }
    const keep = new Set(desired)
    for (const id of current) {
      if (keep.has(id)) continue
      const node = nodes.get(id)
      if (node !== undefined && node.parentNode === null) forget(node)
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
        if (id !== undefined) mutations.setText(id, textOf(record.target))
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
    /** A mouse release anywhere ends a drag that didn't land on a drop zone. */
    releaseAnywhere: (event: EventPayload) =>
      setTimeout(() => endDrag(undefined, { clientX: event.x ?? 0, clientY: event.y ?? 0 }), 0),
    /** Window-level keys go to the focused element, like a browser. */
    windowKey: (event: EventPayload) => toDom((document.activeElement as Node | null) ?? body, event),
    stop: () => {
      observer.disconnect()
      themeObserver.disconnect()
      remove.call(window as unknown as EventTarget, 'click', keepWindow)
    },
  }
}
