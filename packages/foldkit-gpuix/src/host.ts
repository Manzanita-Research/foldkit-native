// HOST
//
// Draws a native document (dom.ts) with gpuix and turns GPUI's input back
// into DOM events. Where the old mirror copied a finished DOM into GPUI after
// the fact, this is the DOM's own back end: each node is a gpuix host node
// from the moment it's inserted, like @gpuix/react's and @gpuix/solid's.
//
// What GPUI owns, and the DOM follows:
// - Focus. GPUI's focus is the truth; `document.activeElement` follows it.
//   Tab and Shift-Tab, run as the keydown's default action (so an app that
//   prevents it, FoldKit's dialog trap, still can), step through the
//   document's tab order, as a browser's, and GPUI focuses each stop.
//   `element.focus()` calls GPUI's `focusElement`.
// - Keys go to the focused element and bubble, as in a browser. Buttons and
//   links activate on Enter (and buttons on Space); a focused scroll area
//   scrolls with the arrow keys, Page Up/Down, Home and End.
// - Scrolling. GPUI scrolls; `scrollTop` reads and writes GPUI's offset and
//   `scrollIntoView` is GPUI's.
// - Text input. `<input>` and `<textarea>` are GPUI's own editors; typing
//   fires `input` per change and `change` when the field loses focus.
// - Layout read-back. `getBoundingClientRect` and `elementsFromPoint` are
//   where GPUI last painted things, read once per frame at most and never
//   waited for (layout.ts).

import type { EventPayload } from '@gpuix/native'
import {
  type NativeRenderer,
  type StyleDesc,
  createMutationQueue,
  createRendererState,
  registerEventHandler,
  unregisterEventHandler,
  unregisterEventHandlers,
} from '@gpuix/native/host'

import {
  type Host,
  NativeComment,
  NativeCustomEvent,
  NativeDocument,
  NativeDocumentFragment,
  NativeElement,
  NativeEvent,
  NativeFocusEvent,
  NativeInputEvent,
  NativeKeyboardEvent,
  NativeMouseEvent,
  type NativeNode,
  NativePointerEvent,
  NativeText,
  NativeWheelEvent,
  type ScrollBlock,
  isDisabled,
  isNaturallyFocusable,
} from './dom.ts'
import { type Box, createGuard, createLayout } from './layout.ts'
import { isSecretField, secretValues } from './automation.ts'
import type { AutomationSecrets } from './automation-secrets.ts'
import { type Declared, INHERITED, type Sheet, type State, type Viewport, declarations, declared, fold, resolveVars, textStyle, toStyle } from './sheet.ts'

/** DOM event → the gpuix events that produce it. EVENTS.md is the contract. */
const HOVER_SIGNALS = ['mouseEnter', 'mouseLeave']
const DOM_TO_NATIVE: Readonly<Record<string, ReadonlyArray<string>>> = {
  click: ['click'], dblclick: ['click'],
  // A virtual list's rows on screen (`detail: { start, end }`, end exclusive).
  visiblerange: ['visibleRange'],
  // GPUI sends a press with another button as `auxClick`, before its release.
  contextmenu: ['auxClick'], auxclick: ['auxClick'],
  mouseup: ['mouseUp'], pointerup: ['mouseUp'],
  // GPUI sends a press's moves and release only to the pressed element (as
  // pointer capture does): whatever hears a press hears the whole gesture
  // (PRESSES below).
  mousedown: ['mouseDown', 'mouseMove', 'mouseUp'], pointerdown: ['mouseDown', 'mouseMove', 'mouseUp'],
  // Hover is the host's, from where the pointer is (HOVER below); GPUI's own
  // enter and leave only say that it moved.
  mouseenter: HOVER_SIGNALS, mouseleave: HOVER_SIGNALS, mouseover: HOVER_SIGNALS, mouseout: HOVER_SIGNALS,
  pointerenter: HOVER_SIGNALS, pointerleave: HOVER_SIGNALS, pointerover: HOVER_SIGNALS, pointerout: HOVER_SIGNALS,
  mousemove: ['mouseMove'], pointermove: ['mouseMove'],
  // GPUI's `scroll` is the wheel, after GPUI scrolled.
  scroll: ['scroll'], wheel: ['scroll'],
}
/** `MouseEvent.button` → its bit in `buttons`: main 1, auxiliary (middle) 4, secondary (right) 2. */
const BUTTONS: ReadonlyArray<number> = [1, 4, 2]
/** DOM events whose target depends on where the pointer is. */
const HOVER_TYPES = new Set(['mouseenter', 'mouseleave', 'mouseover', 'mouseout', 'pointerenter', 'pointerleave', 'pointerover', 'pointerout', 'mousemove', 'pointermove'])

/** gpuix key names → `KeyboardEvent.key`. */
const KEY_NAMES: Readonly<Record<string, string>> = {
  enter: 'Enter', escape: 'Escape', tab: 'Tab', space: ' ', backspace: 'Backspace',
  delete: 'Delete', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
}

/** gpuix events that a disabled control never hears (clicks: see 'click'). */
const POINTER_PRESSES = new Set(['mouseDown', 'mouseUp', 'auxClick'])
/** gpuix events that start an interaction, which an inert element never hears. */
const INERT_IGNORES = new Set(['click', 'auxClick', 'mouseDown', 'mouseEnter'])

const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number'])
/** gpuix has no masked editor, so a password field would show the secret as
 *  it's typed. Rather than draw one, the document refuses it: inserting one,
 *  or making a field one, throws (an upstream ask for gpuix). */
const isPassword = (element: NativeElement) =>
  element.localName === 'input' && (element.getAttribute('type') ?? '').toLowerCase() === 'password'
export const PASSWORD_UNSUPPORTED = `FoldKit on gpuix: <input type="password"> isn't supported. gpuix has no masked input, ` +
  `so the secret would show as it's typed; it needs one first (M0 memo, gpuix ask 1).`
/** Throws if `node` is, or holds, a password field: before any of it reaches GPUI. */
const refusePasswords = (node: NativeNode) => {
  if (!(node instanceof NativeElement)) return
  if (isPassword(node)) throw new Error(PASSWORD_UNSUPPORTED)
  for (const child of node.children) refusePasswords(child)
}

/** Which gpuix element draws a DOM element. `data-fn-anchored` makes an
 *  `anchored` one: GPUI places its content beside its parent (a popover's
 *  trigger), flips it to fit the window, and paints it over everything. Its
 *  value is gpuix's options as JSON (`{"side":"bottom","align":"start",
 *  "gap":4}`); decided when the element is created. `data-fn-virtual-list`
 *  makes a `virtual-list`: GPUI's list, which lays out and paints only the
 *  rows near its viewport. Its value is gpuix's options as JSON
 *  (`{"itemCount":10000,"estimatedItemHeight":32,"windowStart":120}`); its
 *  children are the rows from `windowStart` on, the window the app renders. */
const nativeType = (element: NativeElement): string => {
  if (element.hasAttribute('data-fn-anchored')) return 'anchored'
  if (element.hasAttribute('data-fn-virtual-list')) return 'virtual-list'
  switch (element.localName) {
    case 'input': return TEXT_INPUT_TYPES.has((element.getAttribute('type') ?? '').toLowerCase()) ? 'input' : 'div'
    case 'textarea': return 'textarea'
    case 'img': return 'img'
    default: return 'div'
  }
}

export type HostTimings = { syncMs: number; restyled: number; mutations: number; inputAt?: number }

export type HostOptions = {
  secrets?: AutomationSecrets
  renderer: NativeRenderer
  sheets: Array<Sheet>
  /** The window's size now, for `@media`, `vh` and `vw`. */
  viewport: () => Viewport
  /** GPUI's window changed size: the host restyles everything after this. */
  onResize?: (size: Viewport) => void
  onSynced?: (timings: HostTimings) => void
  /** The clock geometry queries are timed by (tests). */
  now?: () => number
}

export const createHost = (document: NativeDocument, options: HostOptions) => {
  const { renderer, sheets, secrets } = options
  const state = createRendererState(renderer)
  const eventHandlers = new Map<number, Map<string, (event: EventPayload) => void>>()
  const mutations = createMutationQueue(renderer, ids => {
    for (const id of ids) {
      unregisterEventHandlers(eventHandlers, id)
      nodes.delete(id)
    }
  })
  const nodes = new Map<number, NativeNode>()
  let nextId = 1_000_000 // Clear of gpuix's own ids for window events.
  const body = document.body

  // SYNC: changes are batched and drawn once per task.
  const dirty = new Set<NativeElement>()
  let autofocus: Array<NativeElement> = []
  let scheduled = false
  let inputAt: number | undefined
  let restyled = 0
  let detached = false
  const schedule = () => {
    fresh = undefined
    if (scheduled || detached) return
    scheduled = true
    queueMicrotask(sync)
  }
  const sync = () => {
    scheduled = false
    const started = performance.now()
    restyled = 0
    pass = new Map()
    viewport = options.viewport()
    if (rootChanged) {
      rootChanged = false
      const now = rootReach()
      if (now !== rootReached) dirty.add(body)
      rootReached = now
    }
    for (const element of dirty) {
      let covered = false
      for (let at = element.parentElement; at !== null && !covered; at = at.parentElement) covered = dirty.has(at)
      if (!covered) restyleTree(element.nativeId === 0 && element.contains(body) ? body : element)
    }
    dirty.clear()
    // `autofocus` on an element as it's inserted: what a browser does for a
    // dialog's content when it opens.
    const wanted = autofocus.filter(element => element.isConnected && element.nativeId !== 0).at(-1)
    autofocus = []
    if (wanted !== undefined && isFocusable(wanted)) setFocus(wanted, false)
    const pending = mutations.pending
    try {
      mutations.flushMutations()
    } catch (error) {
      secrets?.invalidate()
      throw error
    }
    if (pending > 0 || secrets?.dirty) secrets?.submitted(secretValues(document.querySelectorAll('input, textarea')))
    if (pending > 0) layout.moved()
    options.onSynced?.({ syncMs: performance.now() - started, restyled, mutations: pending, ...(inputAt === undefined ? {} : { inputAt }) })
    inputAt = undefined
  }

  // <html>: what of its style reaches the body, so a change to anything
  // else on it (FoldKit's document attributes) restyles nothing.
  let rootChanged = false
  const rootReach = () => {
    const own = declared(document.documentElement, sheets, viewport).base
    return JSON.stringify([...own].filter(([name]) =>
      name.startsWith('--') || name.startsWith('overflow') || (INHERITED as ReadonlyArray<string>).includes(name)))
  }
  let rootReached = ''

  // STYLE
  // Per sync pass: each element's declarations and inherited text values.
  let pass = new Map<NativeElement, { declared: Declared; inherited: Map<string, string> }>()
  /** The same, for reads between syncs (getComputedStyle): dropped on any change. */
  let fresh: typeof pass | undefined
  let viewport = options.viewport()
  const info = (element: NativeElement): { declared: Declared; inherited: Map<string, string> } => {
    const found = pass.get(element)
    if (found !== undefined) return found
    const own = declared(element, sheets, viewport)
    const parent = element.parentElement
    const inherited = new Map(parent === null ? [] : info(parent).inherited)
    for (const [name, value] of own.base) if (name.startsWith('--')) inherited.set(name, value)
    const lookup = (name: string) => inherited.get(name) ?? ''
    for (const name of INHERITED) {
      const value = own.base.get(name)
      if (value !== undefined && value !== 'inherit') inherited.set(name, resolveVars(value, lookup))
    }
    const result = { declared: own, inherited }
    pass.set(element, result)
    return result
  }
  /** Declarations with every var() substituted from the element's scope:
   *  what it inherits, under its own custom properties in these states
   *  (Tailwind's `focus:ring-2` sets `--tw-ring-shadow` on `:focus`). */
  const resolved = (values: ReadonlyMap<string, string>, inherited: Map<string, string>) => {
    const out = new Map<string, string>()
    const scope = new Map(inherited)
    for (const [name, value] of values) if (name.startsWith('--')) scope.set(name, value)
    const lookup = (name: string) => scope.get(name) ?? ''
    for (const [name, value] of values) if (!name.startsWith('--')) out.set(name, viewportUnits(resolveVars(value, lookup)))
    return out
  }
  /** `100vh` → the window's height in pixels (GPUI has no viewport units). */
  const viewportUnits = (value: string) =>
    !/\d(d|s|l)?v(h|w|min|max)\b/.test(value) ? value : value.replace(/(-?[\d.]+)(?:d|s|l)?(vh|vw|vmin|vmax)\b/g, (_, amount: string, unit: string) => {
      const per = unit === 'vh' ? viewport.height : unit === 'vw' ? viewport.width
        : unit === 'vmin' ? Math.min(viewport.width, viewport.height) : Math.max(viewport.width, viewport.height)
      return `${(Number(amount) * per) / 100}px`
    })
  const diff = (next: StyleDesc, base: StyleDesc): StyleDesc | undefined => {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(next)) {
      if (JSON.stringify(value) !== JSON.stringify((base as Record<string, unknown>)[key])) out[key] = value
    }
    return Object.keys(out).length === 0 ? undefined : out as StyleDesc
  }
  const styleOf = (element: NativeElement): StyleDesc => {
    // GPUI places an anchored element; its content carries the style.
    if (nativeType(element) === 'anchored') return {}
    const { declared: own, inherited } = info(element)
    const field = element.localName === 'input' || element.localName === 'textarea'
    const states: Array<State> = ['base']
    if (focused === element) states.push(...(focusVisible ? ['focus', 'focus-visible'] as const : ['focus'] as const))
    const values = viewportOverflow(element, resolved(fold(own, states), inherited))
    // An inert subtree is out of GPUI's hit testing: no hover, no presses.
    if (isInert(element)) values.set('pointer-events', 'none')
    else if (passesHits(element, values, own)) values.set('pointer-events', 'none')
    // A field draws its own text: it needs the text style a text node gets.
    if (field) for (const name of INHERITED) if (!values.has(name) && inherited.has(name)) values.set(name, inherited.get(name)!)
    // Text beside elements: GPUI has no inline layout, so a wrapping row.
    if (!values.has('display') && element.childNodes.some(child => child instanceof NativeText && child.data.trim() !== '') &&
      element.children.length > 0) {
      values.set('display', 'flex')
      values.set('flex-direction', 'row')
      values.set('flex-wrap', 'wrap')
      values.set('align-items', 'baseline')
    }
    // Auto side margins centre a box (Tailwind's mx-auto). GPUI's margins
    // are lengths only, so the box centres itself in its parent instead, as
    // wide as it may be, as a block with auto margins is; a block parent
    // becomes a column, which stacks and stretches its children as a block
    // does, so that it can.
    if (!values.has('display') && element.children.some(child => {
      const margins = fold(info(child).declared, ['base'])
      return margins.get('margin-left') === 'auto' && margins.get('margin-right') === 'auto'
    })) {
      values.set('display', 'flex')
      values.set('flex-direction', 'column')
    }
    // ASPECT RATIO: gpuix has none, so a box with one and no height of its
    // own gets the height its laid-out width calls for (fitAspects), a frame
    // after GPUI lays it out: `w-full aspect-square` stays square.
    const ratio = aspectOf(values.get('aspect-ratio'))
    if (ratio === undefined || values.has('height')) aspects.delete(element)
    else {
      aspects.set(element, ratio)
      const height = aspectHeights.get(element)
      if (height !== undefined) values.set('height', `${height}px`)
    }
    if (values.get('margin-left') === 'auto' && values.get('margin-right') === 'auto') {
      values.delete('margin-left')
      values.delete('margin-right')
      if (!values.has('align-self')) values.set('align-self', 'center')
      if (!values.has('width')) values.set('width', '100%')
    }
    const style = toStyle(values, field) as Record<string, unknown>
    // GPUI paints a box shadow under the whole box, where CSS clips it to
    // outside the border box: a focus ring on a field with no background of
    // its own filled the field (on Metal). It gets the solid background of the
    // box it sits on, which is what shows through it in CSS.
    if (style['boxShadow'] !== undefined && style['background'] === undefined && style['backgroundColor'] === undefined) {
      const under = backdrop(element)
      if (under !== undefined) style['backgroundColor'] = under
    }
    // Hover and press are GPUI's own states, so they need no round trip
    // (gpuix's list has neither: a row's own box takes them).
    if (nativeType(element) !== 'virtual-list') for (const name of ['hover', 'active'] as const) {
      if (!own.has(name)) continue
      const merged = new Map([...values, ...resolved(fold(own, [...states, name]), inherited)])
      const change = diff(toStyle(merged, true), toStyle(values, true))
      if (change !== undefined) style[name] = change
    }
    return style as StyleDesc
  }
  /** CSS gives the root element's overflow to the viewport, which here is
   *  the body GPUI draws as its root (the user-agent sheet's `overflow-y:
   *  scroll`). So `<html>`'s, when it sets one, is the body's:
   *  `Dom.lockScroll`'s `overflow: hidden` stops the page scrolling. */
  const viewportOverflow = (element: NativeElement, values: Map<string, string>) => {
    if (element !== body) return values
    const root = info(document.documentElement).declared.base
    for (const name of ['overflow-x', 'overflow-y']) {
      const value = root.get(name)
      if (value !== undefined && value !== 'visible') values.set(name, value)
    }
    return values
  }
  /** What `getComputedStyle` reads: the declarations at rest, var()s
   *  resolved, with what the element inherits (text, custom properties,
   *  visibility). */
  const computedStyle = (element: NativeElement): Map<string, string> => {
    const saved = pass
    pass = fresh ??= new Map()
    try {
      const { declared: own, inherited } = info(element)
      const values = viewportOverflow(element, resolved(own.base, inherited))
      for (const [name, value] of inherited) if (!values.has(name)) values.set(name, value)
      for (let at = element.parentElement; at !== null && !values.has('visibility'); at = at.parentElement) {
        const visibility = info(at).declared.base.get('visibility')
        if (visibility !== undefined && visibility !== 'inherit') values.set('visibility', visibility)
      }
      return values
    } finally {
      pass = saved
    }
  }
  /** The solid colour behind `element`: its nearest ancestor's background,
   *  if that's opaque (not a gradient, nor see-through). */
  const backdrop = (element: NativeElement): string | undefined => {
    for (let at = element.parentElement; at !== null; at = at.parentElement) {
      const style = (sentStyles.get(at) ?? {}) as Record<string, unknown>
      if (style['background'] !== undefined) return undefined
      const colour = style['backgroundColor']
      if (typeof colour === 'string') return opaque(colour) ? colour : undefined
    }
    return undefined
  }
  const textStyleOf = (text: NativeText): StyleDesc => {
    const parent = text.parentElement
    if (parent === null) return {}
    const inherited = info(parent).inherited
    const values = new Map<string, string>()
    for (const name of INHERITED) {
      const value = inherited.get(name)
      if (value !== undefined) values.set(name, value)
    }
    return textStyle({ getPropertyValue: name => values.get(name) ?? '' }) as StyleDesc
  }
  const textOf = (text: NativeText) => {
    const transform = text.parentElement === null ? undefined : info(text.parentElement).inherited.get('text-transform')
    return transform === 'uppercase' ? text.data.toUpperCase() : transform === 'lowercase' ? text.data.toLowerCase() : text.data
  }

  // CONTAINING BLOCKS: CSS positions an `absolute` box against its nearest
  // positioned ancestor (else the window), a `fixed` one against the window.
  // GPUI (taffy) positions it against its parent. So such a box is drawn
  // under its containing block in GPUI's tree, last (on top, as positioned
  // boxes paint), while the DOM, styles and events stay where they are.
  const aspects = new Map<NativeElement, number>()
  const aspectHeights = new WeakMap<NativeElement, number>()
  /** After a frame, while the layout settles: each box with an aspect ratio
   *  whose width changed gets the height that width calls for. */
  const fitAspects = () => {
    if (aspects.size === 0 || !layout.settling) return
    for (const [element, ratio] of aspects) {
      if (!element.isConnected || element.nativeId === 0) {
        aspects.delete(element)
        continue
      }
      const box = boundsOf(element)
      if (box === null || box.width === 0) continue
      const height = Math.round((box.width / ratio) * 100) / 100
      if (aspectHeights.get(element) === height) continue
      aspectHeights.set(element, height)
      dirty.add(element)
      schedule()
    }
  }

  /** Elements drawn somewhere other than under their DOM parent. */
  const homes = new Map<NativeElement, NativeElement>()
  const positioned = (element: NativeElement) => {
    const position = info(element).declared.base.get('position')
    return position !== undefined && position !== 'static'
  }
  const containingBlock = (element: NativeElement, position: string | undefined): NativeElement | null => {
    // A fixed box inside a fixed one (a dialog's backdrop, in the dialog)
    // paints in that box's stacking context, under what follows it there:
    // drawn under the body, last, it would cover the whole dialog. So it
    // stays in the fixed ancestor, which for a full-window overlay is the
    // window's box anyway.
    if (position === 'fixed') {
      for (let at = element.parentElement; at !== null && at !== body; at = at.parentElement) {
        if (info(at).declared.base.get('position') === 'fixed') return at
      }
      return body
    }
    if (position !== 'absolute') return null
    for (let at = element.parentElement; at !== null; at = at.parentElement) if (at === body || positioned(at)) return at
    return body
  }
  const rehome = (element: NativeElement, position: string | undefined) => {
    const parent = element.parentElement
    if (parent === null || element === body || nativeType(element) === 'anchored') return
    const block = containingBlock(element, position)
    const home = block === null || block === parent ? null : block
    if (home === (homes.get(element) ?? null)) return
    if (home === null) {
      homes.delete(element)
      place(parent, element)
    } else {
      homes.set(element, home)
      mutations.appendChild(home.nativeId, element.nativeId)
    }
  }
  /** Re-homed boxes inside `node` (going away): GPUI holds them elsewhere. */
  const homedWithin = (node: NativeNode) => [...homes.keys()].filter(element => node.contains(element) && element !== node)

  /** The style last sent per element, for its border box (boundsOf). */
  const sentStyles = new WeakMap<NativeElement, StyleDesc>()
  /** What decides whether a hit test lands on an element, as last styled
   *  (hittable: kept, as a drag hit-tests every move). */
  const hitStyles = new WeakMap<NativeElement, { display?: string | undefined; visibility?: string | undefined; pointer?: string | undefined }>()
  const restyleTree = (element: NativeElement) => {
    if (element.nativeId === 0) return
    restyled++
    const style = styleOf(element)
    sentStyles.set(element, style)
    const base = info(element).declared.base
    hitStyles.set(element, { display: base.get('display'), visibility: base.get('visibility'), pointer: base.get('pointer-events') })
    mutations.setStyle(element.nativeId, style)
    // GPUI hit-tests an element with a hover or press style, and one that
    // paints a fill (a background or a shadow; Metal), hiding what's under
    // it from its own hit test: it has to say where the pointer went, as a
    // listening one does (TRACKING).
    const painted = style as { hover?: unknown; active?: unknown; backgroundColor?: unknown; background?: unknown; boxShadow?: unknown }
    if ([painted.hover, painted.active, painted.backgroundColor, painted.background, painted.boxShadow].some(value => value !== undefined)) track(element)
    rehome(element, (style as { position?: string }).position)
    syncProps(element)
    for (const child of element.childNodes) {
      if (child instanceof NativeElement) restyleTree(child)
      else if (child instanceof NativeText && child.nativeId !== 0) {
        mutations.setStyle(child.nativeId, textStyleOf(child))
        mutations.setText(child.nativeId, textOf(child))
      }
    }
    const parent = element.parentElement
    if (nativeType(element) === 'anchored') roundAnchored(element)
    else if (parent !== null && nativeType(parent) === 'anchored') roundAnchored(parent)
  }
  /** gpuix paints an anchored element's own box, black wherever its content
   *  doesn't cover it, even with a transparent background (Metal: a rounded
   *  popup had black corners). So it takes its content's corner radii. */
  const RADII = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius'] as const
  const roundAnchored = (anchored: NativeElement) => {
    const content = anchored.firstElementChild
    const from = (content === null ? {} : sentStyles.get(content) ?? {}) as Record<string, unknown>
    const style = Object.fromEntries(RADII.filter(name => typeof from[name] === 'number').map(name => [name, from[name]])) as StyleDesc
    if (JSON.stringify(style) === JSON.stringify(sentStyles.get(anchored) ?? {})) return
    sentStyles.set(anchored, style)
    mutations.setStyle(anchored.nativeId, style)
  }

  // PROPS: accessibility, focus order, field values, images.
  const isFocusable = (element: NativeElement) => {
    if (isDisabled(element) || element.closest('[inert]') !== null) return false
    const own = element.getAttribute('tabindex')
    return own !== null ? !Number.isNaN(Number(own)) : isNaturallyFocusable(element)
  }
  const labelText = (element: NativeElement, role: string | undefined): string | undefined => {
    const own = element.getAttribute('aria-label')
    if (own !== null) return own
    const by = element.getAttribute('aria-labelledby')
    if (by !== null) {
      const text = by.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ').trim()
      if (text !== '') return text
    }
    const id = element.getAttribute('id')
    if (id !== null) {
      const label = document.querySelector(`label[for="${id}"]`)
      if (label !== null) return label.textContent.trim()
    }
    // A button, a tab, an option…: named by its text, as a browser names it.
    if (role !== undefined && NAMED_BY_CONTENT.has(role)) {
      const text = shownText(element).replace(/\s+/g, ' ').trim()
      if (text !== '') return text
    }
    return undefined
  }
  /** The props last sent per element, so an attribute that goes away is
   *  cleared in GPUI (sent as null) and an unchanged one isn't resent. */
  const sentProps = new WeakMap<NativeElement, Map<string, unknown>>()
  const propsOf = (element: NativeElement): Map<string, unknown> => {
    const props = new Map<string, unknown>()
    const role = element.getAttribute('role') ?? implicitRole(element)
    if (role !== undefined) props.set('role', role)
    const label = labelText(element, role)
    if (label !== undefined) props.set('aria-label', label)
    const description = element.getAttribute('aria-description')
    if (description !== null) props.set('aria-description', description)
    for (const name of ['aria-expanded', 'aria-selected'] as const) {
      const value = element.getAttribute(name)
      if (value !== null) props.set(name, value === 'true')
    }
    // gpuix has no checked state for AccessKit yet; say it as the value.
    const checked = element.getAttribute('aria-checked')
    if (checked !== null) props.set('aria-valuetext', checked === 'true' ? 'on' : checked === 'mixed' ? 'mixed' : 'off')
    const level = element.getAttribute('aria-level')
    if (level !== null) props.set('aria-level', Number(level))
    const testId = element.getAttribute('data-testid') ?? element.getAttribute('id')
    if (testId !== null) props.set('testId', testId)
    if (isFocusable(element)) props.set('tabIndex', element.tabIndex)
    // GPUI's editors are tab stops unless told not to be (a disabled field
    // took focus by Tab on Metal).
    else if (isField(element)) props.set('tabIndex', -1)
    if (element.hasAttribute('autofocus')) props.set('autoFocus', true)
    if (nativeType(element) === 'anchored') {
      const options = { side: 'bottom', align: 'start', gap: 4, fit: 'switch', deferred: true }
      try {
        Object.assign(options, JSON.parse(element.getAttribute('data-fn-anchored') || '{}'))
      } catch {
        // Not JSON: the defaults, as CSS ignores an invalid value.
      }
      for (const [key, value] of Object.entries(options)) props.set(key, value)
    }
    if (nativeType(element) === 'virtual-list') {
      for (const [key, value] of Object.entries(listOptions(element))) props.set(key, value)
      // GPUI scrolling it is a `scroll` (and a `visiblerange`), heard or not.
      listenNatively(element, 'visibleRange')
    }
    const motion = element.getAttribute('data-fn-motion')
    if (motion !== null) {
      try {
        props.set('motion', JSON.parse(motion))
      } catch {
        // Not JSON: ignored, as CSS ignores an invalid value.
      }
    }
    if (element.localName === 'img') {
      props.set('src', element.getAttribute('src') ?? '')
      const alt = element.getAttribute('alt')
      if (alt !== null) props.set('alt', alt)
    }
    if (isField(element)) {
      props.set('value', element.value)
      const placeholder = element.getAttribute('placeholder')
      if (placeholder !== null) props.set('placeholder', placeholder)
      // GPUI's editor applies an edit as it takes it, so a field that mustn't
      // change is read-only in GPUI itself, not just in JS.
      if (isLocked(element)) props.set('readOnly', true)
    }
    return props
  }
  const isField = (element: NativeElement) => nativeType(element) === 'input' || nativeType(element) === 'textarea'
  /** A field that takes typing: its focus always shows, as in a browser. */
  const takesText = (element: NativeElement) => isField(element) && !element.hasAttribute('readonly')
  /** A field the person can't edit: read-only, or disabled. */
  const isLocked = (element: NativeElement) => element.hasAttribute('readonly') || isDisabled(element)
  const syncProps = (element: NativeElement) => {
    if (isSecretField(element)) secrets?.capture(element.value)
    const id = element.nativeId
    const next = propsOf(element)
    const sent = sentProps.get(element) ?? new Map<string, unknown>()
    for (const [key, value] of next) {
      if (key !== 'value' && JSON.stringify(sent.get(key)) !== JSON.stringify(value)) {
        mutations.setCustomProp(id, key, value as never)
        if (key === 'motion') moving(element)
      }
    }
    for (const key of sent.keys()) {
      if (next.has(key) || key === 'value') continue
      mutations.setCustomProp(id, key, null)
      if (key === 'motion') settled(element)
    }
    if (next.has('value') && sent.get('value') !== next.get('value')) pushValue(element, next.get('value') as string)
    sentProps.set(element, next)
    if (isFocusable(element)) {
      listenNatively(element, 'focus')
      listenNatively(element, 'blur')
    } else if (focused === element) {
      // Disabled (or made unfocusable) while focused: focus leaves it, as in a browser.
      setFocus(null, false)
    }
    if (isField(element)) {
      listenNatively(element, 'change')
      // Enter in an input submits its form. In a textarea it's a new line:
      // gpuix's textarea submits on Enter instead whenever this is heard.
      if (nativeType(element) === 'input') listenNatively(element, 'submit')
    }
    // GPUI scrolls by itself (the wheel): the layout reads again after.
    if (scrollable(element)) listenNatively(element, 'scroll')
    // A button or link activates on click with no listener of its own (a
    // submit button submits its form).
    if (element.localName === 'button' || (element.localName === 'a' && element.hasAttribute('href'))) listenNatively(element, 'click')
  }
  // MOTION: GPUI's own animation (`data-fn-motion`, gpuix's `motion` prop).
  // A new target starts one, and GPUI's `motionComplete` ends it; until
  // then `getAnimations()` has it, so `Dom.waitForAnimationSettled` waits.
  const motions = new WeakMap<NativeElement, { finished: Promise<void>; resolve: () => void }>()
  const moving = (element: NativeElement) => {
    settled(element)
    const { promise, resolve } = Promise.withResolvers<void>()
    motions.set(element, { finished: promise, resolve })
    listenNatively(element, 'motionComplete')
  }
  const settled = (element: NativeElement) => {
    motions.get(element)?.resolve()
    motions.delete(element)
  }
  /** The field's value as GPUI's editor has it, so it isn't sent back.
   *  (`sentProps`' value is what the editor shows; `valueProps` is the
   *  `value` prop gpuix last got. They differ once someone types.) */
  const nativeValue = (element: NativeElement, value: string) => {
    element.setValueFromNative(value)
    sentProps.get(element)?.set('value', value)
  }
  // CONTROLLED VALUES: gpuix 0.10 puts `value` into its editor only when the
  // prop differs from the prop it last got, not from what the editor shows.
  // So after typing, setting the field back to its last prop does nothing
  // (Tab's tab stayed in GPUI's editor, on Metal). Then the adapter sends the
  // value with a zero-width space after it, which draws the same, and the
  // value itself once GPUI has drawn that.
  const valueProps = new WeakMap<NativeElement, string>()
  const NUDGE = '\u200b'
  const pushValue = (element: NativeElement, value: string) => {
    if (element.nativeId === 0) return
    if (valueProps.get(element) !== value) {
      valueProps.set(element, value)
      mutations.setCustomProp(element.nativeId, 'value', value)
      return
    }
    const nudge = value + NUDGE
    valueProps.set(element, nudge)
    mutations.setCustomProp(element.nativeId, 'value', nudge)
    afterDraw(() => {
      if (valueProps.get(element) !== nudge || element.nativeId === 0) return
      valueProps.set(element, value)
      mutations.setCustomProp(element.nativeId, 'value', value)
      schedule()
    })
  }
  /** What the editor reported, less a nudge's zero-width space. */
  const unnudged = (element: NativeElement, value: string) =>
    valueProps.get(element)?.endsWith(NUDGE) === true ? value.replace(NUDGE, '') : value
  /** Work for after GPUI has drawn the latest changes: on `drawn()` (the
   *  frame loop and the tests call it), or after two frames at the latest. */
  let drawWaiters: Array<() => void> = []
  let drawTimer: ReturnType<typeof setTimeout> | undefined
  const afterDraw = (work: () => void) => {
    drawWaiters.push(work)
    drawTimer ??= setTimeout(drawn, 34)
  }
  /** After each frame: did GPUI's window change size? (A query GPUI may not
   *  answer: guarded, as layout reads are.) */
  let size = renderer.getWindowSize?.()
  const watchSize = () => {
    const now = renderer.getWindowSize === undefined ? undefined : guard.ask('size', () => renderer.getWindowSize!())
    if (now === undefined || size === undefined || (now.width === size.width && now.height === size.height)) return
    size = now
    options.onResize?.(now)
    dirty.add(body)
    schedule()
  }
  // FRAMES: animation-frame callbacks run before GPUI draws, as a browser's
  // do before it paints, and their changes go into that same frame.
  let frameCallbacks: Array<() => void> = []
  let frameTimer: ReturnType<typeof setTimeout> | undefined
  const nextFrame = (callback: () => void) => {
    frameCallbacks.push(callback)
    // No frame loop driving (headless, a test): a 60 Hz stand-in.
    frameTimer ??= setTimeout(frame, 16)
  }
  const frame = () => {
    if (frameTimer !== undefined) clearTimeout(frameTimer)
    frameTimer = undefined
    const due = frameCallbacks
    frameCallbacks = []
    for (const callback of due) callback()
    if (scheduled) sync()
  }
  const drawn = () => {
    layout.drew()
    watchSize()
    fitAspects()
    if (document.resizeObservers.size > 0) for (const observer of [...document.resizeObservers]) observer.deliver(host)
    if (drawTimer !== undefined) clearTimeout(drawTimer)
    drawTimer = undefined
    const waiting = drawWaiters
    drawWaiters = []
    for (const work of waiting) work()
  }

  // TREE
  const holdsChildren = (element: NativeElement) => ['div', 'anchored', 'virtual-list'].includes(nativeType(element))
  const mount = (node: NativeNode) => {
    if (node.nativeId !== 0 || node instanceof NativeComment || node instanceof NativeDocumentFragment) return
    const id = nextId++
    node.nativeId = id
    nodes.set(id, node)
    if (node instanceof NativeText) {
      mutations.createElement(id, 'text')
      mutations.setText(id, node.data)
      return
    }
    const element = node as NativeElement
    const type = nativeType(element)
    mutations.createElement(id, type)
    if (element.hasAttribute('autofocus')) autofocus.push(element)
    for (const [native, count] of nativeCounts.get(element) ?? []) if (count > 0) syncListener(element, native, true)
    dirty.add(element)
    if (!holdsChildren(element)) return
    for (const child of element.childNodes) {
      mount(child)
      if (child.nativeId !== 0) mutations.appendChild(id, child.nativeId)
    }
  }
  const unmount = (node: NativeNode) => {
    if (node instanceof NativeElement) {
      cancelEdit(node)
      settled(node)
    }
    if (node.nativeId !== 0) {
      unregisterEventHandlers(eventHandlers, node.nativeId)
      nodes.delete(node.nativeId)
      node.nativeId = 0
    }
    for (const child of node.childNodes) unmount(child)
  }
  /** Puts `node`'s native element where the DOM has it among its siblings. */
  const place = (parent: NativeNode, node: NativeNode) => {
    if (parent.nativeId === 0 || node.nativeId === 0) return
    if (!(parent instanceof NativeElement) || !holdsChildren(parent)) return
    const siblings = parent.childNodes
    let before: NativeNode | undefined
    for (let i = siblings.indexOf(node) + 1; i < siblings.length && before === undefined; i++) {
      const sibling = siblings[i]!
      if (sibling.nativeId !== 0 && !(sibling instanceof NativeElement && homes.has(sibling))) before = sibling
    }
    if (before === undefined) mutations.appendChild(parent.nativeId, node.nativeId)
    else mutations.insertBefore(parent.nativeId, node.nativeId, before.nativeId)
  }

  // LISTENERS: a DOM listener turns the matching GPUI events on.
  const domCounts = new WeakMap<NativeNode, Map<string, number>>()
  const nativeCounts = new WeakMap<NativeNode, Map<string, number>>()
  const implicit = new WeakMap<NativeNode, Set<string>>()
  const listens = (node: NativeNode, type: string) => (domCounts.get(node)?.get(type) ?? 0) > 0
  const countNative = (node: NativeNode, native: string, delta: number) => {
    const counts = nativeCounts.get(node) ?? new Map<string, number>()
    nativeCounts.set(node, counts)
    const before = counts.get(native) ?? 0
    const after = Math.max(0, before + delta)
    counts.set(native, after)
    if (node.nativeId !== 0 && (before === 0) !== (after === 0)) {
      syncListener(node, native, after > 0)
      // Whether it and its children let hits through (CLICK-THROUGH).
      if (node instanceof NativeElement && node !== body) {
        dirty.add(node)
        schedule()
      }
    }
    if (after > 0 && node instanceof NativeElement) track(node)
  }
  // CLICK-THROUGH: GPUI lets a box that paints a fill block hits to
  // everything behind it, its own ancestors included, where a browser bubbles
  // a click on a child up to its parent: a switch's coloured track swallowed
  // the switch's click (FKN-12, as on the mirror). So a plain box inside one
  // that listens for the pointer, with no listeners of its own, lets GPUI's
  // hits through to it (GPUI's `pointerEvents: 'none'`; the document's own
  // hit testing still finds the box, so it's still a click's target). Not a
  // positioned box (it can sit outside its parent, over something else), a
  // scroller (it needs the wheel), a field, or one whose CSS sets
  // pointer-events, or one with a hover or press style. Decided as each box
  // is styled, parents first.
  const POINTER_NATIVES: ReadonlyArray<string> = ['click', 'auxClick', 'mouseDown', 'mouseUp', 'mouseMove', 'mouseEnter', 'mouseLeave']
  const through = new WeakSet<NativeElement>()
  /** Whether the document listens on `node` for any of `natives` (or for
   *  anything): its own listeners, not the moves the host follows itself
   *  (TRACKING: every painted box, for hover). */
  const listensNatively = (node: NativeNode, natives?: ReadonlyArray<string>) => {
    const counts = nativeCounts.get(node)
    if (counts === undefined) return false
    const own = implicit.get(node)
    const asked = (native: string) => (counts.get(native) ?? 0) - (own?.has(native) === true ? 1 : 0) > 0
    return (natives ?? [...counts.keys()]).some(asked)
  }
  const passesHits = (element: NativeElement, values: Map<string, string>, own: Declared) => {
    const parent = element.parentElement
    const scrolls = ['overflow', 'overflow-x', 'overflow-y'].some(name => ['scroll', 'auto'].includes(values.get(name) ?? ''))
    // GPUI paints a hover or press style from its own hit test.
    const states = own.has('hover') || own.has('active')
    const passes = parent !== null && parent !== body && nativeType(element) === 'div' && !values.has('pointer-events') && !states &&
      !['absolute', 'fixed'].includes(values.get('position') ?? '') && !scrolls && !listensNatively(element) &&
      (through.has(parent) || listensNatively(parent, POINTER_NATIVES))
    if (passes) through.add(element)
    else through.delete(element)
    return passes
  }

  /** GPUI sends the pointer's moves (and its leaving) only to the topmost
   *  element it hit-tests, which is one that listens for something. So each
   *  of those, and the body under them all, tells the host where the pointer
   *  went (HOVER). */
  const TRACKING: ReadonlyArray<string> = ['mouseMove', 'mouseLeave']
  const track = (element: NativeElement) => {
    for (const native of TRACKING) listenNatively(element, native)
  }
  const listenNatively = (node: NativeNode, native: string) => {
    const set = implicit.get(node) ?? new Set<string>()
    implicit.set(node, set)
    if (set.has(native)) return
    set.add(native)
    countNative(node, native, 1)
  }
  const syncListener = (node: NativeNode, native: string, on: boolean) => {
    const id = node.nativeId
    // Removing an element drops its listeners (snabbdom does it before it
    // takes the element out); the pressed one keeps hearing the gesture until
    // the release (PRESSES).
    if (!on && pressed?.id === id && GESTURE.includes(native)) return
    if (on) registerEventHandler(eventHandlers, id, native, event => {
      const target = nodes.get(event.elementId)
      if (target !== undefined) fromNative(target, event)
    })
    else unregisterEventHandler(eventHandlers, id, native)
    mutations.setEventListener(id, native, on)
    schedule()
  }

  // FOCUS
  // `:focus-visible` as browsers judge it (Chrome's and the WICG polyfill's
  // heuristic): focus by a key shows, focus by the pointer doesn't, and
  // `focus()` from script shows if the latest input was a key, or before any
  // input at all. A text field always shows: it takes keys, however it was
  // focused. Keys held with cmd, ctrl or alt (shortcuts) don't count.
  let focused: NativeElement | null = null
  let focusVisible = false
  /** Whether the latest input was a key, or there's been none yet. */
  let keyboardModality = true
  let valueAtFocus = ''
  const SCOPE = '[aria-modal="true"], [data-fn-focus-scope="trap"]'
  const returnFocus = new WeakMap<NativeElement, NativeElement | null>()
  /** Moves the DOM's focus to `next`, firing what a browser fires.
   *  `fromGpui` when GPUI already moved its own focus. */
  const setFocus = (next: NativeElement | null, fromGpui: boolean, byKey = keyboardModality) => {
    const visible = byKey || (next !== null && takesText(next))
    const previous = focused
    if (previous === next) {
      // Same element, now reached by keyboard: its focus ring shows.
      if (next !== null && visible && !focusVisible) {
        focusVisible = true
        dirty.add(next)
        schedule()
      }
      return
    }
    // Entering a modal scope from outside it: focus goes back here after.
    const scope = next?.closest(SCOPE) ?? null
    if (scope !== null && (previous === null || !scope.contains(previous))) returnFocus.set(scope, previous)
    focused = next
    focusVisible = next !== null && visible
    document.activeElement = next ?? body
    if (previous !== null) {
      if ((previous.localName === 'input' || previous.localName === 'textarea') && previous.value !== valueAtFocus) {
        previous.dispatchEvent(new NativeEvent('change', { bubbles: true }))
      }
      previous.dispatchEvent(new NativeFocusEvent('blur', { relatedTarget: next }))
      previous.dispatchEvent(new NativeFocusEvent('focusout', { bubbles: true, relatedTarget: next }))
      dirty.add(previous)
    }
    if (next !== null) {
      valueAtFocus = next.value
      if (!fromGpui && next.nativeId !== 0) {
        renderer.focusElement?.(next.nativeId)
        // gpuix makes an element's focus handle when it draws it, so focusing
        // one drawn in this same render does nothing yet: ask again after
        // GPUI's next frame, if the document still wants it.
        afterDraw(() => {
          if (focused === next && next.nativeId !== 0 && renderer.getFocusedElementId?.() !== next.nativeId) renderer.focusElement?.(next.nativeId)
        })
      }
      if (byKey) reveal(next)
      next.dispatchEvent(new NativeFocusEvent('focus', { relatedTarget: previous }))
      next.dispatchEvent(new NativeFocusEvent('focusin', { bubbles: true, relatedTarget: previous }))
      dirty.add(next)
    } else if (!fromGpui) renderer.blur?.()
    schedule()
  }
  /** After GPUI moved focus itself (Tab), the DOM catches up. */
  const followGpui = (visible = true) => {
    const id = renderer.getFocusedElementId?.()
    const node = id === null || id === undefined ? undefined : nodes.get(id)
    if (node instanceof NativeElement && !isFocusable(node)) return refuseFocus()
    setFocus(node instanceof NativeElement ? node : null, true, visible)
  }
  /** GPUI focused something a browser wouldn't: its editors take focus on a
   *  press even when disabled and told `tabIndex: -1` (on Metal). The DOM
   *  doesn't follow; focus leaves, and GPUI lets go where it can (a live
   *  window; gpuix's offscreen renderer has no blur, and the field's
   *  `readOnly` keeps it unedited). */
  const refuseFocus = () => {
    if (focused !== null) setFocus(null, false, false)
    else renderer.blur?.()
  }
  /** If GPUI moved focus without telling (its editors take focus on press
   *  and send no focus event), the DOM follows, as a pointer focus. */
  const reconcileFocus = () => {
    const id = renderer.getFocusedElementId?.()
    if (id !== null && id !== undefined && id !== focused?.nativeId && nodes.get(id) instanceof NativeElement) followGpui(false)
  }
  /** The scope Tab stays inside: an open modal dialog, as a browser's
   *  `showModal` keeps it (`aria-modal` or `data-fn-focus-scope`). */
  const focusScope = (): NativeElement | null => {
    const scopes = document.querySelectorAll(SCOPE)
      .filter(scope => scope.nativeId !== 0 && scope.checkVisibility())
    return scopes.at(-1) ?? null
  }

  /** The tab order, as a browser has it: focusable elements with a positive
   *  tab index first (lowest first, then tree order), then those with 0 in
   *  tree order; nothing under `display: none`. The adapter owns the order
   *  because GPUI's is paint order (positive tab indexes last, and an
   *  overlay re-homed under its containing block would move). */
  const tabStops = (scope: NativeElement | null): Array<NativeElement> => {
    const out: Array<NativeElement> = []
    const walk = (element: NativeElement) => {
      if (element.nativeId === 0 || info(element).declared.base.get('display') === 'none') return
      if (isFocusable(element) && element.tabIndex >= 0) out.push(element)
      for (const child of element.children) walk(child)
    }
    walk(scope ?? body)
    const positive = out.filter(element => element.tabIndex > 0)
      .map((element, at) => ({ element, at }))
      .sort((a, b) => a.element.tabIndex - b.element.tabIndex || a.at - b.at)
      .map(stop => stop.element)
    return [...positive, ...out.filter(element => element.tabIndex === 0)]
  }
  const stepStop = (from: number | null, delta: 1 | -1, scope: NativeElement | null): NativeElement | undefined => {
    const stops = tabStops(scope)
    if (stops.length === 0) return undefined
    const index = from === null ? -1 : stops.findIndex(stop => stop.nativeId === from)
    if (index === -1) return delta > 0 ? stops[0] : stops.at(-1)
    return stops[(index + delta + stops.length) % stops.length]
  }

  // TAB IN A FIELD: GPUI's editors type a tab for the Tab key (sometimes two),
  // and report it as a change, before or after the window's keydown. In a
  // browser, Tab in a field never types. A change that only adds tabs is held
  // for one task; if a Tab keydown came for that field around it, the change
  // is dropped and GPUI's editor gets the old value back. Otherwise (a pasted
  // tab) it goes through, a task late. FoldKit never sees the tab Tab typed.
  // A newer native or controlled value supersedes the held change: its
  // timer must never write an older value or emit input after the newer one.
  // Per field: Tabs GPUI queues together go to one field, then the next,
  // before the first field's change comes in.
  const tabbedAt = new WeakMap<NativeElement, number>()
  const tabbed = (element: NativeElement) => {
    tabbedAt.set(element, performance.now())
  }
  const onlyAddsTabs = (before: string, after: string) =>
    after.length > before.length && after.replace(/\t/g, '') === before.replace(/\t/g, '')
  const typedByTab = (element: NativeElement) => performance.now() - (tabbedAt.get(element) ?? -Infinity) < 100
  const pendingEdits = new Map<NativeElement, ReturnType<typeof setTimeout>>()
  const cancelEdit = (element: NativeElement) => {
    const timer = pendingEdits.get(element)
    if (timer === undefined) return
    clearTimeout(timer)
    pendingEdits.delete(element)
  }

  // KEYS
  // Keys come from GPUI's window key events only (no element listens for
  // keys natively), so each keystroke arrives once. GPUI sends several in
  // one task when they queue up; each is its own event.
  let armed: NativeElement | undefined
  const key = (event: EventPayload, type: 'keydown' | 'keyup') => {
    const name = event.key === undefined ? '' : KEY_NAMES[event.key] ?? event.key
    // Keys go where GPUI's focus is, even if it moved there by itself.
    reconcileFocus()
    inputAt = performance.now()
    guard.input()
    const held = event.modifiers
    if (held?.cmd !== true && held?.ctrl !== true && held?.alt !== true) keyboardModality = true
    const target = focused ?? body
    const keyboard = new NativeKeyboardEvent(type, {
      bubbles: true, cancelable: true, key: name, code: name, repeat: event.isHeld === true,
      ctrlKey: held?.ctrl ?? false, metaKey: held?.cmd ?? false, shiftKey: held?.shift ?? false, altKey: held?.alt ?? false,
    })
    if (type === 'keydown' && name === 'Tab') tabbed(target)
    const proceed = target.dispatchEvent(keyboard)
    // A button activates on Space's release only if its press wasn't
    // prevented (the press arms it, as in a browser).
    const released = type === 'keyup' && name === ' ' && armed === target
    if (name === ' ') armed = type === 'keydown' && proceed ? target : undefined
    if (!proceed) return
    // The browser's default actions.
    if (type === 'keydown' && name === 'Tab') {
      // The document's order (tabStops), and GPUI focuses it. (gpuix 0.10's
      // focusPrevious didn't leave an editor and its focusPreviousWithin
      // never returned from a modal's first stop, on Metal.)
      const next = stepStop(renderer.getFocusedElementId?.() ?? null, held?.shift ? -1 : 1, focusScope())
      if (next !== undefined) renderer.focusElement?.(next.nativeId)
      followGpui()
      return
    }
    const activates = target.localName === 'button' || (target.localName === 'a' && target.hasAttribute('href'))
    if (activates && ((type === 'keydown' && name === 'Enter') || (released && target.localName === 'button'))) {
      target.click()
      return
    }
    if (type === 'keydown') scrollWithKeys(target, name)
  }
  /** A focused scroll area scrolls with the keys, as a browser's does. */
  const scrollWithKeys = (target: NativeElement, name: string) => {
    if (target.nativeId === 0 || !scrollable(target)) return
    const [x, y] = offsetOf(target)
    const height = boundsOf(target)?.height ?? 400
    const step: Record<string, number> = {
      ArrowDown: -40, ArrowUp: 40, PageDown: -height * 0.9, PageUp: height * 0.9, ' ': -height * 0.9,
      Home: Infinity, End: -Infinity,
    }
    const by = step[name]
    if (by === undefined) return
    const next = by === Infinity ? 0 : by === -Infinity ? -1e7 : Math.min(0, y + by)
    scrollTo(target, x, next)
    target.dispatchEvent(new NativeEvent('scroll'))
  }
  const scrollable = (element: NativeElement) => {
    const own = info(element).declared.base
    const values = element === body ? viewportOverflow(element, new Map(own)) : own
    return values.get('overflow-y') === 'scroll' || values.get('overflow-x') === 'scroll'
  }

  // GPUI EVENTS → DOM EVENTS
  let lastClick: { node: NativeNode; sameTask: boolean } | undefined
  const fromNative = (node: NativeNode, event: EventPayload) => {
    guard.input()
    const held = event.modifiers
    const init = {
      bubbles: true, cancelable: true, clientX: event.x ?? 0, clientY: event.y ?? 0,
      ctrlKey: held?.ctrl ?? false, metaKey: held?.cmd ?? false, shiftKey: held?.shift ?? false, altKey: held?.alt ?? false,
    }
    const element = node as NativeElement
    // A disabled control hears no presses or clicks, as in a browser; an
    // inert subtree hears no pointer at all (its style already keeps GPUI's
    // hit test off it; this is for what was on its way).
    if (POINTER_PRESSES.has(event.eventType) && element instanceof NativeElement && disabledControl(element) !== null) return
    if (INERT_IGNORES.has(event.eventType) && element instanceof NativeElement && isInert(element)) return
    switch (event.eventType) {
      case 'click': {
        // GPUI tells every listening ancestor; the DOM bubbles it itself.
        if (lastClick !== undefined && lastClick.sameTask && node !== lastClick.node && node.contains(lastClick.node)) return
        const click = { node, sameTask: true }
        lastClick = click
        queueMicrotask(() => {
          click.sameTask = false
        })
        // Not dispatched at all: the ancestors GPUI tells next don't hear it either.
        if (node instanceof NativeElement && disabledControl(element) !== null) return
        keyboardModality = false
        inputAt = performance.now()
        const mouse = { ...init, button: event.button ?? 0, detail: event.clickCount ?? 1 }
        settlePress(false)
        if (!pressPrevented) pointerFocus(element)
        // GPUI clicks what was pressed, wherever the release was. A browser
        // clicks what the press and the release have in common: a press
        // dragged off a button and let go elsewhere doesn't click it.
        const at = clickTarget(element, init.clientX, init.clientY)
        if (at !== element && disabledControl(at) !== null) return
        const proceed = at.dispatchEvent(new NativeMouseEvent('click', mouse))
        if (mouse.detail === 2) at.dispatchEvent(new NativeMouseEvent('dblclick', mouse))
        // A submit button submits its form.
        const button = at.closest('button')
        if (proceed && button !== null && ['', 'submit'].includes((button.getAttribute('type') ?? '').toLowerCase())) {
          button.form?.requestSubmit()
        }
        return
      }
      case 'auxClick': {
        // Another button: GPUI sends it before the release. The right one
        // opens the context menu there (macOS fires `contextmenu` on the
        // press, before the release; there's no native menu to prevent);
        // `auxclick` follows the release, in the same task.
        if (lastClick !== undefined && lastClick.sameTask && node !== lastClick.node && node.contains(lastClick.node)) return
        const click = { node, sameTask: true }
        lastClick = click
        queueMicrotask(() => {
          click.sameTask = false
        })
        if (node instanceof NativeElement && disabledControl(element) !== null) return
        keyboardModality = false
        inputAt = performance.now()
        const right = event.isRightClick === true || event.button === 2
        const button = right ? 2 : event.button ?? 1
        const mouse = { ...init, button, detail: event.clickCount ?? 1 }
        const at = pressedAt(element)
        settlePress(false)
        if (right) {
          if (!pressPrevented) pointerFocus(element)
          at.dispatchEvent(new NativeMouseEvent('contextmenu', { ...mouse, buttons: BUTTONS[button] ?? 0 }))
        }
        queueMicrotask(() => {
          const target = clickTarget(at, init.clientX, init.clientY)
          if (target.isConnected) target.dispatchEvent(new NativeMouseEvent('auxclick', mouse))
        })
        return
      }
      case 'mouseDown': case 'mouseUp': case 'mouseMove':
        return pointer(element, event, init)
      case 'mouseEnter': case 'mouseLeave':
        return hoverSignal(element, event.eventType === 'mouseEnter', init)
      case 'keyDown': return key(event, 'keydown')
      case 'keyUp': return key(event, 'keyup')
      case 'focus':
        // During a press, its mousedown decides (settlePress follows GPUI).
        if (pendingPress !== undefined) return
        if (node instanceof NativeElement) {
          if (isFocusable(node)) setFocus(node, true)
          else refuseFocus()
        }
        return
      case 'blur':
        // Focus may be moving to another element GPUI reports next.
        queueMicrotask(() => {
          if (pendingPress !== undefined) return
          if (focused === node && (renderer.getFocusedElementId?.() ?? null) !== node.nativeId) setFocus(null, true)
        })
        return
      case 'change': {
        inputAt = performance.now()
        cancelEdit(element)
        const value = unnudged(element, event.value ?? '')
        if (isSecretField(element)) {
          secrets?.capture(value)
          if (secrets !== undefined) schedule()
        }
        // An edit GPUI's editor took before it heard the field was disabled
        // or made read-only (it applies edits at once): the DOM refuses it
        // and the editor gets the value back.
        if (isLocked(element)) return value === element.value ? undefined : restoreValue(element, element.value)
        if (onlyAddsTabs(element.value, value)) {
          const before = element.value
          if (typedByTab(element)) return restoreValue(element, before)
          const id = element.nativeId
          pendingEdits.set(element, setTimeout(() => {
            pendingEdits.delete(element)
            if (detached || element.nativeId !== id || !element.isConnected) return
            if (isLocked(element) || typedByTab(element)) restoreValue(element, before)
            else typed(element, value)
          }, 0))
          return
        }
        typed(element, value)
        return
      }
      case 'submit': {
        // Enter in a field: the browser's implicit submission.
        element.form?.requestSubmit()
        return
      }
      case 'scroll': return wheel(element, event, init)
      case 'visibleRange': {
        // The list moved: a scroll, as a browser's scroll area fires one
        // (its scrollTop is the list's), and the rows on screen.
        const range = { start: event.startIndex ?? 0, end: event.endIndex ?? 0 }
        layout.moved()
        element.dispatchEvent(new NativeEvent('scroll'))
        element.dispatchEvent(new NativeCustomEvent('visiblerange', { detail: range }))
        return
      }
      case 'motionComplete':
        settled(element)
        layout.moved()
        element.dispatchEvent(new NativeEvent('motioncomplete'))
        return
      default:
        element.dispatchEvent(new NativeEvent(event.eventType, init))
    }
  }
  // POINTER (EVENTS.md is the contract)
  //
  // GPUI hit-tests for itself and tells only the topmost element that listens:
  // its own enter and leave are exclusive (a parent "leaves" as the pointer
  // goes onto a child that listens), and while a button's held it sends the
  // moves and release only to what it pressed. A browser says where the
  // pointer is from its hit test. So does the host: every move GPUI reports
  // (to whatever it hit, TRACKING) is hit-tested against GPUI's last layout
  // (elementsFromPoint), and the host fires the browser's boundary events as
  // the element under the pointer changes:
  // - pointerout, pointerleave (inner to outer), pointerover, pointerenter
  //   (outer to inner), then mouseout, mouseleave, mouseover, mouseenter, then
  //   the move itself, at the element under the pointer;
  // - a press and its moves and release go to the element under the pointer
  //   too (or the one with pointer capture), bubbling to document and window;
  // - GPUI's enter and leave only say the pointer moved: they count when no
  //   move came with them (the pointer left the window, or nothing reported).
  // Where the layout has nothing at the point (not laid out yet), the element
  // GPUI sent the event to stands in.
  //
  // If the app takes the pressed element out of the document mid-gesture (a
  // drag lifts the card out of its list), GPUI's element is held, unseen and
  // out of the layout, until the release, or GPUI would have nowhere to send
  // the rest of the gesture.
  let pressed: { id: number; node: NativeElement; held: boolean } | undefined
  /** The element under the pointer, as the host last said. */
  let hovered: NativeElement | undefined
  /** Where the pointer last was (window coordinates). */
  let pointerAt: { x: number; y: number } | undefined
  /** The deepest element under the pointer when the button went down. */
  let pressDown: NativeElement | undefined
  /** How many listeners care where the pointer is (HOVER_TYPES). */
  let hoverListeners = 0
  /** Pointer capture: the element that has it, and the change asked for
   *  (`setPointerCapture`, `releasePointerCapture`) that takes effect before
   *  the next pointer event, as the Pointer Events spec has it. */
  let captured: NativeElement | undefined
  let pendingCapture: NativeElement | null | undefined
  /** GPUI sends one press to every listening element under the pointer,
   *  innermost first; the innermost one's dispatch already bubbled. */
  let lastPointer: { node: NativeElement; type: string; sameTask: boolean } | undefined
  let compatSuppressed = false
  /** What GPUI sends the pressed element after the press. */
  const GESTURE: ReadonlyArray<string> = ['mouseMove', 'mouseUp']
  const POINTER_AND_MOUSE: Readonly<Record<string, readonly [string, string]>> = {
    mouseDown: ['pointerdown', 'mousedown'], mouseMove: ['pointermove', 'mousemove'], mouseUp: ['pointerup', 'mouseup'],
  }
  type Init = { bubbles: boolean; cancelable: boolean; clientX: number; clientY: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }
  /** The current task: GPUI delivers what one input caused in one task. */
  let currentTask: object | undefined
  const thisTask = () => {
    if (currentTask === undefined) {
      const task = {}
      currentTask = task
      queueMicrotask(() => {
        if (currentTask === task) currentTask = undefined
      })
    }
    return currentTask
  }
  let movedIn: object | undefined
  const wantsHover = () => hoverListeners > 0
  /** The topmost element GPUI last painted at the point. */
  const under = (x: number, y: number): NativeElement | undefined => elementsAt(x, y)[0]
  const pointerInit = (init: Init) => ({ ...init, screenX: init.clientX, screenY: init.clientY, pointerId: 1, pointerType: 'mouse', isPrimary: true })
  const pointer = (node: NativeElement, event: EventPayload, init: Init) => {
    const type = event.eventType
    if (lastPointer?.sameTask === true && lastPointer.type === type && node !== lastPointer.node && node.contains(lastPointer.node)) return
    // A press whose release GPUI never sent (let go outside the window): a
    // move with no button held, or a new press, ends it first, with the
    // release a browser would have sent.
    if (pressed !== undefined && ((type === 'mouseMove' && event.pressedButton == null) || type === 'mouseDown')) {
      const lost = pressed
      pointer(lost.node, { ...event, elementId: lost.id, eventType: 'mouseUp', button: 0, clickCount: 1 }, init)
      if (pressed === lost) release(init)
    }
    const last = { node, type, sameTask: true }
    lastPointer = last
    queueMicrotask(() => {
      last.sameTask = false
    })
    pointerAt = { x: init.clientX, y: init.clientY }
    if (type === 'mouseMove') movedIn = thisTask()
    const hit = wantsHover() || type !== 'mouseMove' || pressed !== undefined ? under(init.clientX, init.clientY) : undefined
    if (type === 'mouseDown') {
      pressed = { id: event.elementId, node, held: false }
      pressDown = hit ?? node
    }
    const capturing = pressed !== undefined && pressed.id === event.elementId
    processCapture(init)
    // Out of the document (held): what's above it hears it, as in a browser.
    const over = captured ?? hit ?? (node.isConnected ? node : body)
    if (wantsHover()) hoverTo(over, init)
    const button = type === 'mouseMove' ? 0 : event.button ?? 0
    const buttons = type === 'mouseUp' ? 0 : type === 'mouseDown' ? BUTTONS[button] ?? 0
      : event.pressedButton == null ? 0 : BUTTONS[event.pressedButton] ?? 0
    const mouse = { ...init, screenX: init.clientX, screenY: init.clientY, button, buttons, detail: type === 'mouseMove' ? 0 : event.clickCount ?? 1 }
    const [pointerType, mouseType] = POINTER_AND_MOUSE[type]!
    const proceed = over.dispatchEvent(new NativePointerEvent(pointerType, pointerInit(mouse)))
    // A prevented pointerdown means no compatibility mouse events (mousedown,
    // its moves, mouseup) until the release; the click still comes.
    if (type === 'mouseDown') compatSuppressed = !proceed
    // The capture ends with the release, before its compatibility mouse event.
    if (type === 'mouseUp' && (captured !== undefined || pendingCapture != null)) {
      pendingCapture = null
      processCapture(init)
    }
    const mouseProceeds = compatSuppressed || over.dispatchEvent(new NativeMouseEvent(mouseType, mouse))
    if (type === 'mouseDown') settlePress(!mouseProceeds)
    if (type === 'mouseUp') compatSuppressed = false
    if (type === 'mouseUp' && capturing) release(init)
  }
  /** The press is over: a held element goes, listeners dropped during the
   *  gesture stop now, and hover follows the pointer again. */
  const release = (init: Init) => {
    const done = pressed
    pressed = undefined
    if (captured !== undefined || pendingCapture != null) {
      pendingCapture = null
      processCapture(init)
    }
    if (done === undefined) return
    if (wantsHover() && pointerAt !== undefined) {
      const now = under(pointerAt.x, pointerAt.y)
      if (now !== undefined) hoverTo(now, init)
    }
    if (!done.held) {
      for (const native of GESTURE) if ((nativeCounts.get(done.node)?.get(native) ?? 0) === 0 && done.node.nativeId === done.id) syncListener(done.node, native, false)
      return
    }
    queueMicrotask(() => {
      unregisterEventHandlers(eventHandlers, done.id)
      if (nodes.get(done.id) === done.node) nodes.delete(done.id)
      mutations.destroyElement(done.id)
      schedule()
    })
  }
  /** A capture asked for takes effect: lostpointercapture where it was (at
   *  the document if that element has gone), gotpointercapture where it's
   *  going. */
  const processCapture = (init: Init) => {
    if (captured !== undefined && !captured.isConnected && pendingCapture === undefined) pendingCapture = null
    if (pendingCapture === undefined) return
    const next = pendingCapture ?? undefined
    pendingCapture = undefined
    if (next === captured) return
    const previous = captured
    captured = next
    const event = (type: string) => new NativePointerEvent(type, { ...pointerInit(init), bubbles: true, cancelable: false })
    if (previous !== undefined) (previous.isConnected ? previous : document).dispatchEvent(event('lostpointercapture'))
    captured?.dispatchEvent(event('gotpointercapture'))
  }
  /** GPUI's enter or leave, with no position: if no move came in the same
   *  task (which said exactly where the pointer went), the pointer entered
   *  `element`, or left it for somewhere nothing reports (out of the window). */
  let signal: { element: NativeElement; enter: boolean; task: object } | undefined
  const hoverSignal = (element: NativeElement, enter: boolean, init: Init) => {
    if (pressed !== undefined || !wantsHover()) return
    const task = thisTask()
    const queued = signal?.task === task
    // An enter in the same task says more than a leave (GPUI sends both as
    // the pointer crosses from one element to another).
    if (!queued || enter || !signal!.enter) signal = { element, enter, task }
    if (queued) return
    queueMicrotask(() => {
      const said = signal
      signal = undefined
      if (said === undefined || movedIn === task || pressed !== undefined) return
      const at = pointerAt === undefined ? init : { ...init, clientX: pointerAt.x, clientY: pointerAt.y }
      const hit = pointerAt === undefined ? undefined : under(pointerAt.x, pointerAt.y)
      if (said.enter) hoverTo(hit !== undefined && said.element.contains(hit) ? hit : said.element, at)
      else if (hovered !== undefined && said.element.contains(hovered)) hoverTo(hit !== undefined && !said.element.contains(hit) ? hit : undefined, at)
    })
  }
  /** The pressed element (or what holds it) leaves the document mid-gesture:
   *  GPUI's element stays, unseen, out of the layout and never hit (under
   *  the root, if what held it goes too), and hears the rest of the gesture. */
  const HELD = { position: 'absolute', opacity: 0, pointerEvents: 'none' } as StyleDesc
  const hold = (press: NonNullable<typeof pressed>, outOf: NativeNode) => {
    press.held = true
    nodes.set(press.id, press.node)
    for (const native of GESTURE) {
      registerEventHandler(eventHandlers, press.id, native, event => fromNative(press.node, event))
    }
    if (outOf !== press.node) mutations.appendChild(body.nativeId, press.id)
    mutations.setStyle(press.id, HELD)
  }
  /** The browser's boundary events as the pointer moves from the hovered
   *  element to `next`: pointer events first, then the mouse ones. */
  const hoverTo = (next: NativeElement | undefined, init: Init) => {
    const previous = hovered
    if (next === previous) return
    hovered = next
    const chain = (element: NativeElement | undefined) => {
      const out: Array<NativeElement> = []
      for (let at = element ?? null; at !== null && at !== document.documentElement; at = at.parentElement) out.push(at)
      return out
    }
    const was = chain(previous)
    const now = chain(next)
    const left = was.filter(element => !now.includes(element))
    const entered = now.filter(element => !was.includes(element)).reverse()
    const mouse = { ...init, screenX: init.clientX, screenY: init.clientY, cancelable: false }
    const out = { ...mouse, relatedTarget: next ?? null }
    const over = { ...mouse, relatedTarget: previous ?? null }
    previous?.dispatchEvent(new NativePointerEvent('pointerout', pointerInit(out)))
    for (const element of left) element.dispatchEvent(new NativePointerEvent('pointerleave', { ...pointerInit(out), bubbles: false }))
    next?.dispatchEvent(new NativePointerEvent('pointerover', pointerInit(over)))
    for (const element of entered) element.dispatchEvent(new NativePointerEvent('pointerenter', { ...pointerInit(over), bubbles: false }))
    previous?.dispatchEvent(new NativeMouseEvent('mouseout', { ...out, cancelable: true }))
    for (const element of left) element.dispatchEvent(new NativeMouseEvent('mouseleave', { ...out, bubbles: false }))
    next?.dispatchEvent(new NativeMouseEvent('mouseover', { ...over, cancelable: true }))
    for (const element of entered) element.dispatchEvent(new NativeMouseEvent('mouseenter', { ...over, bubbles: false }))
  }
  /** Where a click lands: the nearest element both the press and the
   *  release were over (UI Events), from GPUI's last layout. */
  const clickTarget = (pressedOne: NativeElement, x: number, y: number): NativeElement => {
    const down = pressedAt(pressedOne)
    const up = under(x, y) ?? down
    for (let at: NativeElement | null = down; at !== null; at = at.parentElement) if (at.contains(up)) return at
    return down
  }
  /** The deepest element under the press, if GPUI's target agrees. */
  const pressedAt = (pressedOne: NativeElement): NativeElement =>
    pressDown !== undefined && (pressedOne.contains(pressDown) || !pressedOne.isConnected) ? pressDown : pressedOne
  /** A press focuses the nearest focusable element, without a ring; one
   *  already focused by a key loses its ring, as in a browser. */
  const pointerFocus = (element: NativeElement) => {
    const focusable = element instanceof NativeElement ? focusableAncestor(element) : null
    if (focusable !== null && focusable !== focused) setFocus(focusable, false, false)
    else if (focusable !== null && focusVisible && !takesText(focusable)) {
      focusVisible = false
      dirty.add(focusable)
    }
  }
  /** GPUI's `scroll` is the wheel, sent to every listening element under the
   *  pointer, innermost first, after GPUI has scrolled. A browser fires one
   *  `wheel` at the element under the pointer, bubbling, and `scroll` at each
   *  scroll area that moved. GPUI has already scrolled, so the wheel can't
   *  be cancelled. */
  let lastWheel: { node: NativeElement; sameTask: boolean } | undefined
  const wheel = (element: NativeElement, event: EventPayload, init: Init) => {
    layout.moved()
    if (!(lastWheel?.sameTask === true && element !== lastWheel.node && element.contains(lastWheel.node))) {
      const turn = { node: element, sameTask: true }
      lastWheel = turn
      queueMicrotask(() => {
        turn.sameTask = false
      })
      pointerAt = { x: init.clientX, y: init.clientY }
      const at = under(init.clientX, init.clientY) ?? element
      // GPUI's deltas are how far the content moves (down is negative); a
      // browser's are how far the view does.
      at.dispatchEvent(new NativeWheelEvent('wheel', {
        ...init, cancelable: false, screenX: init.clientX, screenY: init.clientY,
        deltaX: -(event.deltaX ?? 0) || 0, deltaY: -(event.deltaY ?? 0) || 0, deltaMode: event.precise === false ? 1 : 0,
      }))
    }
    if (!scrollable(element) || element.nativeId === 0) return
    const before = announced.get(element)
    const known = offsets.get(element)
    const now = offsetOf(element)
    // GPUI scrolled it: what's inside is where it will be drawn, at once.
    if (known !== undefined) layout.scrolled(element.nativeId, now[0] - known[0], now[1] - known[1])
    if (before !== undefined && before[0] === now[0] && before[1] === now[1]) return
    announced.set(element, now)
    element.dispatchEvent(new NativeEvent('scroll'))
  }
  /** Each scroll area's offset as its last `scroll` event (or the host's own
   *  scrolling) had it: a wheel at the end of the area fires none. */
  const announced = new WeakMap<NativeElement, readonly [number, number]>()

  /** Text GPUI's editor took: the DOM's value, then `input`. */
  const typed = (element: NativeElement, value: string) => {
    // Typed while a nudge was pending: the editor has the nudge's space in
    // it, so it gets the typed value back without one.
    if (valueProps.get(element)?.endsWith(NUDGE) === true) pushValue(element, value)
    nativeValue(element, value)
    // Typing lands where GPUI's focus is: the DOM follows it there.
    reconcileFocus()
    element.dispatchEvent(new NativeInputEvent('input', { bubbles: true, data: value }))
  }
  const restoreValue = (element: NativeElement, value: string) => {
    if (element.nativeId === 0) return
    pushValue(element, value)
    sentProps.get(element)?.set('value', value)
    schedule()
  }
  /** The disabled form control `element` is (or is inside), if any. */
  const disabledControl = (element: NativeElement): NativeElement | null => {
    const control = element.closest('button, input, select, textarea')
    return control !== null && isDisabled(control) ? control : null
  }
  const focusableAncestor = (element: NativeElement): NativeElement | null => {
    for (let at: NativeElement | null = element; at !== null; at = at.parentElement) if (isFocusable(at)) return at
    return null
  }

  // GEOMETRY: where GPUI last painted things (layout.ts). Every query GPUI
  // may not answer goes through the guard, and nothing waits for a paint.
  const guard = createGuard(options.now)
  /** Scroll offsets as GPUI last gave them (or as the host last set them). */
  const offsets = new WeakMap<NativeElement, [number, number]>()
  const offsetOf = (element: NativeElement): [number, number] => {
    if (element.nativeId === 0) return [0, 0]
    if (nativeType(element) === 'virtual-list') return listOffset(element)
    const read = renderer.getScrollOffset === undefined ? undefined : guard.ask('scroll', () => renderer.getScrollOffset!(element.nativeId))
    if (read !== undefined) offsets.set(element, [read?.[0] ?? 0, read?.[1] ?? 0])
    return offsets.get(element) ?? [0, 0]
  }
  /** Scrolls an area, and moves what the layout has inside it by what GPUI
   *  scrolled (it clamps to the content, at once): a box read straight
   *  after is where it's going to be drawn, as in a browser. */
  const scrollTo = (element: NativeElement, at: number, down: number) => {
    // Offsets are negated scroll positions: 0 at rest, never -0.
    const [x, y] = [at + 0, down + 0]
    if (nativeType(element) === 'virtual-list') return scrollListTo(element, y)
    const [fromX, fromY] = offsets.get(element) ?? offsetOf(element)
    renderer.scrollTo?.(element.nativeId, x, y)
    const read = renderer.getScrollOffset === undefined ? undefined : guard.ask('scroll', () => renderer.getScrollOffset!(element.nativeId))
    const to: [number, number] = read === undefined || read === null ? [x, y] : [read[0] ?? 0, read[1] ?? 0]
    offsets.set(element, to)
    announced.set(element, to)
    layout.scrolled(element.nativeId, to[0] - fromX, to[1] - fromY)
    layout.moved()
  }
  /** gpuix 0.10 reports a box from the content corner (moved by the left and
   *  top border and padding, the size without the borders), and a scroll
   *  area's own box moved by its own scroll offset (scrolled 100 down, it
   *  says the area is 100 higher than it's drawn). Both are undone here.
   *  The corner moves back as the content is aligned: by half the padding
   *  on an axis whose content is centred (`justify-content` on the main
   *  axis, `align-items` across it; `space-around` too), by all of it at
   *  the end (Metal: a centred button with 16 px side padding read 16 px
   *  left of where it's drawn). A single-line input centres its editor
   *  vertically, whatever its style. */
  const borderBox = (id: number, box: Box): Box => {
    const element = nodes.get(id)
    if (!(element instanceof NativeElement)) return box
    const style = (sentStyles.get(element) ?? {}) as Record<string, unknown>
    const px = (key: string) => (typeof style[key] === 'number' ? style[key] as number : 0)
    const column = style['flexDirection'] === 'column' || style['flexDirection'] === 'column-reverse'
    const alongX = alignment(column ? style['alignItems'] : style['justifyContent'])
    const alongY = nativeType(element) === 'input' ? 0.5 : alignment(column ? style['justifyContent'] : style['alignItems'])
    const left = px('borderLeftWidth') + px('paddingLeft') - alongX * (px('paddingLeft') + px('paddingRight'))
    const top = px('borderTopWidth') + px('paddingTop') - alongY * (px('paddingTop') + px('paddingBottom'))
    const scrolls = style['overflowX'] === 'scroll' || style['overflowY'] === 'scroll'
    const [scrollX, scrollY] = scrolls ? offsetOf(element) : [0, 0]
    return {
      x: box.x - left - scrollX,
      y: box.y - top - scrollY,
      width: box.width + px('borderLeftWidth') + px('borderRightWidth'),
      height: box.height + px('borderTopWidth') + px('borderBottomWidth'),
    }
  }
  /** Inside the borders and padding last sent, at `bounds`' corner. */
  const contentBoxOf = (element: NativeElement): Box => {
    const box = boundsOf(element) ?? { x: 0, y: 0, width: 0, height: 0 }
    const style = (sentStyles.get(element) ?? {}) as Record<string, unknown>
    const px = (key: string) => (typeof style[key] === 'number' ? style[key] as number : 0)
    const left = px('borderLeftWidth') + px('paddingLeft')
    const top = px('borderTopWidth') + px('paddingTop')
    const right = px('borderRightWidth') + px('paddingRight')
    const bottom = px('borderBottomWidth') + px('paddingBottom')
    return { x: box.x + left, y: box.y + top, width: Math.max(0, box.width - left - right), height: Math.max(0, box.height - top - bottom) }
  }
  const layout = createLayout({
    guard,
    ...(options.now === undefined ? {} : { now: options.now }),
    // Every renderer gpuix has (the live window's, the offscreen one) has it;
    // NativeRenderer's type leaves it out.
    tree: treeOf(renderer),
    borderBox,
    // From the style GPUI was sent: the layout's walk asks for every element,
    // and matching the sheet again for each would cost more than the read.
    clips: id => {
      const element = nodes.get(id)
      const style = (element instanceof NativeElement ? sentStyles.get(element) ?? {} : {}) as Record<string, unknown>
      return [style['overflowX'], style['overflowY']].some(value => value !== undefined && value !== 'visible')
    },
  })
  /** The border box where GPUI last painted `element`, as
   *  `getBoundingClientRect` has it; null if it wasn't in that layout. */
  const boundsOf = (element: NativeElement) => (element.nativeId === 0 ? null : layout.box(element.nativeId))
  /** Whether a browser's hit test can land on `element`: nothing under
   *  `display: none`, and `visibility` and `pointer-events` as inherited. */
  const hittable = (element: NativeElement) => {
    let visibility: string | undefined
    let pointer: string | undefined
    for (let at: NativeElement | null = element; at !== null; at = at.parentElement) {
      const values = hitStyles.get(at) ?? {}
      if (values.display === 'none' || at.hasAttribute('inert')) return false
      if (visibility === undefined || visibility === 'inherit') visibility = values.visibility
      if (pointer === undefined || pointer === 'inherit') pointer = values.pointer
    }
    return visibility !== 'hidden' && visibility !== 'collapse' && pointer !== 'none'
  }
  /** `document.elementsFromPoint`: every element GPUI last painted under the
   *  point, topmost first (layout.ts has the paint order), then `<html>`. */
  const elementsAt = (x: number, y: number): Array<NativeElement> => {
    const out: Array<NativeElement> = []
    for (const id of layout.at(x, y)) {
      const node = nodes.get(id)
      // A pressed element held for GPUI after the app removed it is out of the document.
      if (node instanceof NativeElement && node.isConnected && hittable(node)) out.push(node)
    }
    if (out.length > 0) out.push(document.documentElement)
    return out
  }

  /** Scrolls the nearest scroll area until `element` shows, from where GPUI
   *  last painted both, and moves only that area (gpuix 0.10's own
   *  scrollIntoView also scrolled the page, on Metal). `block` places it as
   *  a browser does: the area's top, centre or bottom, or (`nearest`) just
   *  far enough to show it. */
  const reveal = (element: NativeElement, block: ScrollBlock = 'nearest') => {
    if (element.nativeId === 0) return
    const list = element.parentElement
    if (list !== null && list.nativeId !== 0 && nativeType(list) === 'virtual-list') return revealInList(list, element, block)
    let area = element.parentElement
    while (area !== null && (area.nativeId === 0 || !scrollable(area))) area = area.parentElement
    if (area === null) return
    const box = boundsOf(element)
    const view = boundsOf(area)
    if (box === null || view === null) {
      renderer.scrollIntoView?.(element.nativeId)
      layout.moved()
      return
    }
    const [x, y] = offsetOf(area)
    const toStart = y + (view.y - box.y)
    const toEnd = y - (box.y + box.height - view.y - view.height)
    let next = y
    if (block === 'start') next = toStart
    else if (block === 'end') next = toEnd
    else if (block === 'center') next = y + (view.y + view.height / 2 - (box.y + box.height / 2))
    else if (box.y < view.y) next = toStart
    else if (box.y + box.height > view.y + view.height) next = toEnd
    if (next !== y) {
      scrollTo(area, x, Math.min(0, next))
      area.dispatchEvent(new NativeEvent('scroll'))
    }
  }

  // VIRTUAL LISTS: GPUI scrolls one by row (its rows' heights are measured
  // as they're laid out), so a row is revealed by its index, the window's
  // start plus its place among the rows the app rendered. Where the list
  // is scrolled comes from its anchor (gpuix's getListScrollTop: the top
  // row, how far into it, the viewport's height); the list itself has no
  // box in GPUI's layout, and its visibleRange lags a frame.
  /** A list's scroll offset, as a scroll area's: its anchor row times the
   *  estimated row height, plus how far into that row (exact when the rows
   *  are the height estimated). */
  const listOffset = (list: NativeElement): [number, number] => {
    const anchor = guard.ask('list', () => listOf(renderer).getListScrollTop?.(list.nativeId) ?? null)
    if (anchor === undefined || anchor === null) return offsets.get(list) ?? [0, 0]
    const offset: [number, number] = [0, -((anchor[0] ?? 0) * (listOptions(list).estimatedItemHeight ?? 0) + (anchor[1] ?? 0))]
    offsets.set(list, offset)
    return offset
  }
  /** `scrollTop = y` on a list: the row at that height, and into it. */
  const scrollListTo = (list: NativeElement, y: number) => {
    const estimate = listOptions(list).estimatedItemHeight ?? 0
    const top = Math.max(0, -y)
    const index = estimate > 0 ? Math.floor(top / estimate) : 0
    listOf(renderer).scrollToItem?.(list.nativeId, index, top - index * estimate)
    offsets.set(list, [0, -top])
    layout.moved()
  }
  const revealInList = (list: NativeElement, row: NativeElement, block: ScrollBlock) => {
    const options = listOptions(list)
    const at = list.children.indexOf(row)
    if (at === -1) return
    const index = (options.windowStart ?? 0) + at
    const anchor = guard.ask('list', () => listOf(renderer).getListScrollTop?.(list.nativeId) ?? null) ?? null
    const estimate = options.estimatedItemHeight ?? 0
    const height = boundsOf(row)?.height || estimate
    const viewport = anchor?.[2] ?? 0
    // Where the row goes: its top at the list's top (offset 0), or the
    // viewport's top above it so it sits at the bottom or in the middle.
    const end = -Math.max(0, viewport - height)
    let offset: number | undefined
    if (block === 'start' || anchor === null) offset = 0
    else if (block === 'end') offset = end
    else if (block === 'center') offset = end / 2
    else {
      // The row's top in the viewport, counted from the anchor's row.
      const top = (index - anchor[0]!) * (estimate || height) - anchor[1]!
      if (top < 0) offset = 0
      else if (top + height > viewport) offset = end
    }
    if (offset === undefined) return
    listOf(renderer).scrollToItem?.(list.nativeId, index, offset)
    layout.moved()
  }

  // THE HOST INTERFACE (what the document calls)
  const host: Host = {
    admit: (node, name, value) => {
      if (name === undefined) refusePasswords(node)
      else if (name === 'type' && node instanceof NativeElement && node.localName === 'input' && value?.toLowerCase() === 'password') {
        throw new Error(PASSWORD_UNSUPPORTED)
      }
    },
    inserted: (parent, node) => {
      if (parent.nativeId === 0 && parent !== body && !(parent instanceof NativeDocument)) {
        // Inserted under a part GPUI doesn't draw (html, head): the body's subtree is all it draws.
        if (node === body || node.contains(body)) mountBody()
        return
      }
      mount(node)
      place(parent, node)
      if (node instanceof NativeElement) dirty.add(node)
      else if (node instanceof NativeText && parent instanceof NativeElement) dirty.add(parent)
      schedule()
    },
    removed: (parent, node) => {
      if (node.nativeId === 0) return
      if (focused !== null && node.contains(focused)) {
        // A closing dialog gives focus back to where it came from.
        const scope = focused.closest(SCOPE)
        const back = scope === null ? undefined : returnFocus.get(scope)
        setFocus(null, false)
        if (back !== undefined && back !== null) queueMicrotask(() => {
          if (back.isConnected && back.nativeId !== 0) setFocus(back, false)
        })
      }
      // What was under the pointer goes: what held it is, until the pointer
      // moves (a browser fires nothing for the removal itself).
      const outer = parent instanceof NativeElement ? parent : undefined
      if (hovered !== undefined && node.contains(hovered)) hovered = outer
      if (pressDown !== undefined && node.contains(pressDown)) pressDown = outer
      const id = node.nativeId
      const away = homedWithin(node).map(element => element.nativeId)
      if (node instanceof NativeElement) homes.delete(node)
      for (const element of homes.keys()) if (node.contains(element)) homes.delete(element)
      // The pressed element, going mid-gesture: GPUI still sends it the rest.
      const keep = pressed !== undefined && !pressed.held && node.contains(pressed.node) ? pressed : undefined
      unmount(node)
      if (keep !== undefined) hold(keep, node)
      for (const homed of away) mutations.destroyElement(homed)
      if (keep?.node !== node) mutations.destroyElement(id)
      if (parent instanceof NativeElement) dirty.add(parent)
      schedule()
    },
    changed: (element, what) => {
      if (element.nativeId !== 0 && isField(element) && (what === 'value' || what === 'autocomplete')) {
        secrets?.changed()
        if (isSecretField(element)) secrets?.capture(element.value)
      }
      if (what === 'value') {
        cancelEdit(element)
        if (element.nativeId !== 0) syncProps(element)
        schedule()
        return
      }
      if (element.nativeId !== 0) dirty.add(element)
      // Not drawn: not in the document yet (snabbdom sets a new element up
      // before it inserts it, and inserting it styles it), or in <head>,
      // which GPUI doesn't draw. Only <html> reaches what's drawn: through
      // what the body inherits from it, and its overflow (the viewport's).
      else if (element === document.documentElement) rootChanged = true
      else return
      schedule()
    },
    text: node => {
      if (node.nativeId === 0) return
      mutations.setText(node.nativeId, textOf(node))
      // The text may be a control's name (a button's label).
      for (let at = node.parentElement; at !== null; at = at.parentElement) {
        const role = at.getAttribute('role') ?? implicitRole(at)
        if (role !== undefined && NAMED_BY_CONTENT.has(role)) {
          if (at.nativeId !== 0) syncProps(at)
          break
        }
      }
      schedule()
    },
    listening: (node, type, delta) => {
      const counts = domCounts.get(node) ?? new Map<string, number>()
      domCounts.set(node, counts)
      counts.set(type, Math.max(0, (counts.get(type) ?? 0) + delta))
      if (HOVER_TYPES.has(type)) hoverListeners = Math.max(0, hoverListeners + delta)
      // What a listener on document (or window) hears bubbles up from the
      // body, so GPUI sends it there.
      const at = node instanceof NativeDocument ? body : node
      for (const native of DOM_TO_NATIVE[type] ?? []) countNative(at, native, delta)
    },
    focus: (element, options) => {
      if (element.nativeId === 0 || !isFocusable(element)) return
      // As in a browser, focus doesn't land on what isn't rendered or is
      // `visibility: hidden` (an anchored panel before it's placed: @foldkit/ui
      // focuses it once it's shown, after portaling it, which would blur it).
      if (!element.checkVisibility({ visibilityProperty: true })) return
      setFocus(element, false, options?.focusVisible ?? keyboardModality)
    },
    blur: element => {
      if (focused === element) setFocus(null, false)
    },
    focusVisible: () => focusVisible,
    // The root's box is the page's: the body GPUI draws as its root.
    bounds: element => boundsOf(element === document.documentElement ? body : element) ?? { x: 0, y: 0, width: 0, height: 0 },
    contentBox: element => contentBoxOf(element === document.documentElement ? body : element),
    computedStyle: element => computedStyle(element),
    animations: element => {
      const motion = motions.get(element)
      return motion === undefined ? [] : [{ finished: motion.finished }]
    },
    elementsFromPoint: (x, y) => elementsAt(x, y),
    scrollIntoView: (element, block) => reveal(element, block),
    scrollOffset: element => offsetOf(element),
    scrollTo: (element, x, y) => {
      if (element.nativeId === 0) return
      scrollTo(element, x, y)
      setTimeout(() => element.dispatchEvent(new NativeEvent('scroll')), 0)
    },
    selectedText: () => renderer.getSelectedText?.() ?? null,
    clearSelection: () => renderer.clearSelection?.(),
    capture: (element, on) => {
      // Only while a button's held (the spec's active buttons state).
      if (on && pressed !== undefined) pendingCapture = element
      else if (!on && (pendingCapture !== undefined ? pendingCapture : captured) === element) pendingCapture = null
    },
    hasCapture: element => (pendingCapture !== undefined ? pendingCapture : captured) === element,
    nextFrame: callback => {
      if (detached) return
      nextFrame(callback)
    },
  }

  // PRESSES: GPUI's editors stop a press from bubbling and send no focus
  // event, so no element, the root included, hears a click into a field.
  // GPUI runs "mouse down outside" in its capture phase, before an editor can
  // stop anything, so a zero-size element that's never hit hears every press.
  // It is GPUI's alone: no DOM node stands for it.
  let sentinel = 0
  const mountSentinel = () => {
    sentinel = nextId++
    mutations.createElement(sentinel, 'div')
    mutations.setStyle(sentinel, { position: 'absolute', width: 0, height: 0 } as StyleDesc)
    mutations.appendChild(body.nativeId, sentinel)
    registerEventHandler(eventHandlers, sentinel, 'mouseDownOutside', event => {
      keyboardModality = false
      guard.input()
      // Where the press landed, for its click's target (and before any
      // element hears it: GPUI runs this first).
      if (event.x !== undefined && event.y !== undefined) {
        pointerAt = { x: event.x, y: event.y }
        pressDown = under(event.x, event.y)
      }
      // Its focus waits for its mousedown, if one comes in this task.
      const pending = { previous: focused, x: event.x, y: event.y }
      pendingPress = pending
      pressPrevented = false
      queueMicrotask(() => {
        if (pendingPress === pending) settlePress(false)
      })
    })
    mutations.setEventListener(sentinel, 'mouseDownOutside', true)
  }
  /** FOCUS ON PRESS: in a browser, focus moves as the default action of
   *  `mousedown`, after it's dispatched and before the release, and not at
   *  all if it was prevented. GPUI moves its own focus as it takes the press,
   *  before any element hears it. So the press waits (`pendingPress`) until
   *  its mousedown has been dispatched (or until its click, or the end of the
   *  task, when nothing listens for presses); then, unless prevented, the
   *  DOM follows GPUI and focuses the nearest focusable element under the
   *  press. Prevented, GPUI's focus goes back where it was. */
  let pendingPress: { previous: NativeElement | null; x: number | undefined; y: number | undefined } | undefined
  let pressPrevented = false
  const settlePress = (prevented: boolean) => {
    const pending = pendingPress
    pendingPress = undefined
    if (pending === undefined) return
    pressPrevented = prevented
    if (prevented) {
      const was = pending.previous
      const id = renderer.getFocusedElementId?.() ?? null
      if (id !== (was?.nativeId ?? null)) {
        if (was !== null && was.nativeId !== 0) renderer.focusElement?.(was.nativeId)
        else renderer.blur?.()
      }
      return
    }
    press(pending.x, pending.y)
    // Not laid out yet (no pressDown): the click focuses instead.
    const focusable = pressDown === undefined ? null : focusableAncestor(pressDown)
    if (focusable !== null && focusable !== focused) setFocus(focusable, false, false)
  }
  /** A press anywhere. If GPUI moved focus, the DOM follows. If it didn't and
   *  the press was outside the focused element, focus leaves it, as a
   *  browser's does (a press on another focusable element then focuses that
   *  one: settlePress). */
  const press = (x?: number, y?: number) => {
    const id = renderer.getFocusedElementId?.() ?? null
    const node = id === null ? undefined : nodes.get(id)
    if (node instanceof NativeElement && node !== focused) return followGpui(false)
    if (id === null) return focused === null ? undefined : setFocus(null, true, false)
    // Offscreen, gpuix's test renderer can't blur: the DOM keeps GPUI's focus.
    if (focused === null || x === undefined || y === undefined || renderer.blur === undefined) return
    const box = boundsOf(focused)
    if (box !== null && !(x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height)) setFocus(null, false, false)
  }

  const mountBody = () => {
    if (body.nativeId !== 0) return
    refusePasswords(body)
    mount(body)
    track(body)
    mountSentinel()
    mutations.setRoot(body.nativeId)
    schedule()
  }
  mountBody()
  document.host = host

  const binding = state.attach({
    eventHandlers,
    onWindowKeyDown: event => key(event, 'keydown'),
    onWindowKeyUp: event => key(event, 'keyup'),
  })
  renderer.setWindowKeyEvents?.(true, true, binding.windowKeyEventId)
  rootReached = rootReach()
  sync()

  return {
    /** Draw pending changes now (tests). */
    flush: sync,
    /** GPUI drew a frame: work waiting for one runs (the frame loop and the
     *  tests call this after the renderer draws). */
    /** GPUI is about to draw: animation frames run, and what they change
     *  is synced into this frame (the frame loop and the tests call this). */
    frame,
    drawn: () => {
      drawn()
      if (scheduled) sync()
    },
    /** Restyle everything (a sheet or tokens changed). */
    restyleAll: () => {
      dirty.add(body)
      schedule()
    },
    nodeFor: (id: number) => nodes.get(id),
    /** GPUI's layout changed where the host can't see it (the fake's
     *  `setBounds`, in tests): it's read again when next asked for. */
    relayout: () => layout.moved(),
    /** GPUI's geometry queries: how many, how long, how many missed (tests). */
    geometry: () => ({ ...guard.stats, reads: layout.reads, holding: guard.holding }),
    /** Sends a gpuix event as GPUI would (tests and automation). */
    dispatch: (event: EventPayload) => state.dispatch(event),
    focused: () => focused,
    /** Lets go of everything this host holds: the native tree (root,
     *  sentinel and all), event handlers, window key events, frame work and
     *  pending timers. The document stays, unconnected to GPUI. */
    detach: (options: { windowGone?: boolean } = {}) => {
      if (detached) return
      detached = true
      for (const timer of pendingEdits.values()) clearTimeout(timer)
      pendingEdits.clear()
      secrets?.dispose()
      if (drawTimer !== undefined) clearTimeout(drawTimer)
      drawTimer = undefined
      drawWaiters = []
      if (frameTimer !== undefined) clearTimeout(frameTimer)
      frameTimer = undefined
      frameCallbacks = []
      dirty.clear()
      autofocus = []
      // A window that's already gone took its native tree with it, and on
      // Linux gpuix then throws from every call ("GPUI application is not
      // initialized"): nothing left to free. Any other failure is real.
      const native = (free: () => void) => {
        try {
          free()
        } catch (error) {
          if (options.windowGone !== true) throw error
        }
      }
      native(() => renderer.setWindowKeyEvents?.(false, false, binding.windowKeyEventId))
      const root = body.nativeId
      if (root !== 0) {
        native(() => {
          unmount(body)
          unregisterEventHandlers(eventHandlers, sentinel)
          mutations.destroyElement(sentinel)
          mutations.destroyElement(root)
          mutations.flushMutations()
        })
      }
      eventHandlers.clear()
      nodes.clear()
      binding.detach()
      document.host = undefined
    },
  }
}

export type GpuixHost = ReturnType<typeof createHost>

/** How far along its axis an alignment puts the content: where gpuix's
 *  reported corner moves back to (borderBox). */
const alignment = (value: unknown) =>
  value === 'center' || value === 'space-around' ? 0.5 : value === 'flex-end' || value === 'end' ? 1 : 0

/** Whether it's in an inert subtree (a plain walk: restyles ask per element). */
const isInert = (element: NativeElement) => {
  for (let at: NativeElement | null = element; at !== null; at = at.parentElement) if (at.attributeMap.has('inert')) return true
  return false
}

/** Whether a colour hides what's behind it: no alpha, or a full one. */
const opaque = (colour: string) => {
  const value = colour.trim().toLowerCase()
  if (value === 'transparent' || value === 'currentcolor' || value.includes('var(')) return false
  if (value.startsWith('#')) return value.length === 4 || value.length === 7 || /^#...f$|^#......ff$/.test(value)
  // rgba(r, g, b, a), and rgb(r g b / a) or oklch(l c h / a).
  const inner = /^[a-z]+\((.*)\)$/.exec(value)?.[1]
  if (inner === undefined) return true
  const alpha = inner.includes('/') ? inner.split('/')[1]! : inner.split(',')[3]
  if (alpha === undefined) return true
  const amount = alpha.trim()
  return amount.endsWith('%') ? Number(amount.slice(0, -1)) >= 100 : Number(amount) >= 1
}

/** `aspect-ratio: 16 / 9` (or `1.5`) → width over height; `auto` → none. */
const aspectOf = (value: string | undefined): number | undefined => {
  const match = value === undefined ? null : /^\s*([\d.]+)\s*(?:\/\s*([\d.]+))?\s*$/.exec(value)
  if (match === null) return undefined
  const ratio = Number(match[1]) / Number(match[2] ?? 1)
  return Number.isFinite(ratio) && ratio > 0 ? ratio : undefined
}

/** A virtual list's options (`data-fn-virtual-list`); not JSON: none. */
const listOptions = (element: NativeElement): { itemCount?: number; estimatedItemHeight?: number; windowStart?: number } & Record<string, unknown> => {
  try {
    const options = JSON.parse(element.getAttribute('data-fn-virtual-list') || '{}') as unknown
    return typeof options === 'object' && options !== null ? options as Record<string, unknown> : {}
  } catch {
    return {}
  }
}
/** gpuix's virtual-list calls, which NativeRenderer's type leaves out. */
const listOf = (renderer: NativeRenderer) =>
  renderer as { scrollToItem?: (id: number, index: number, offsetInItem?: number) => void; getListScrollTop?: (id: number) => Array<number> | null }

const treeOf = (renderer: NativeRenderer) => {
  const reader = renderer as { getAutomationTree?: () => string }
  return reader.getAutomationTree === undefined ? undefined : () => reader.getAutomationTree!()
}

/** The role a browser gives an element without one, for AccessKit. */
/** Roles named by their content when nothing else names them (WAI-ARIA's
 *  "name from content"). */
const NAMED_BY_CONTENT = new Set([
  'button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'option', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'treeitem', 'heading', 'cell', 'gridcell', 'columnheader', 'rowheader', 'tooltip',
])

/** The text a browser's name computation reads: not what's `aria-hidden` or
 *  `hidden`. */
const shownText = (node: NativeNode): string => {
  if (node instanceof NativeText) return node.data
  if (!(node instanceof NativeElement)) return ''
  if (node.getAttribute('aria-hidden') === 'true' || node.hasAttribute('hidden')) return ''
  let out = ''
  for (const child of node.childNodes) out += shownText(child)
  return out
}

const implicitRole = (element: NativeElement): string | undefined => {
  switch (element.localName) {
    case 'button': return 'button'
    case 'a': return element.hasAttribute('href') ? 'link' : undefined
    case 'input': return element.getAttribute('type') === 'checkbox' ? 'checkbox' : 'textbox'
    case 'textarea': return 'textbox'
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return 'heading'
    case 'ul': case 'ol': return 'list'
    case 'li': return 'listitem'
    case 'dialog': return 'dialog'
    case 'img': return 'image'
    default: return undefined
  }
}

export { declarations }
