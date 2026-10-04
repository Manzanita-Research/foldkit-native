// HOST
//
// Draws a native document (dom.ts) with gpuix and turns GPUI's input back
// into DOM events. Where the old mirror copied a finished DOM into GPUI after
// the fact, this is the DOM's own back end: each node is a gpuix host node
// from the moment it's inserted, like @gpuix/react's and @gpuix/solid's.
//
// What GPUI owns, and the DOM follows:
// - Focus. GPUI's focus is the truth; `document.activeElement` follows it.
//   Tab and Shift-Tab are GPUI's own `focusNext`/`focusPrevious`, run as the
//   keydown's default action, so an app that prevents it (FoldKit's dialog
//   trap) still can. `element.focus()` calls GPUI's `focusElement`.
// - Keys go to the focused element and bubble, as in a browser. Buttons and
//   links activate on Enter (and buttons on Space); a focused scroll area
//   scrolls with the arrow keys, Page Up/Down, Home and End.
// - Scrolling. GPUI scrolls; `scrollTop` reads and writes GPUI's offset and
//   `scrollIntoView` is GPUI's.
// - Text input. `<input>` and `<textarea>` are GPUI's own editors; typing
//   fires `input` per change and `change` when the field loses focus.
// - Layout read-back. `getBoundingClientRect` is where GPUI painted it.

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
  NativeDocument,
  NativeDocumentFragment,
  NativeElement,
  NativeEvent,
  NativeFocusEvent,
  NativeInputEvent,
  NativeKeyboardEvent,
  NativeMouseEvent,
  type NativeNode,
  NativeText,
  isNaturallyFocusable,
} from './dom.ts'
import { type Declared, INHERITED, type Sheet, type State, declarations, declared, fold, resolveVars, textStyle, toStyle } from './sheet.ts'

/** DOM event → the gpuix events that produce it (as the mirror had it). */
const DOM_TO_NATIVE: Readonly<Record<string, ReadonlyArray<string>>> = {
  click: ['click'], contextmenu: ['click'], dblclick: ['click'], auxclick: ['auxClick'],
  mousedown: ['mouseDown'], mouseup: ['mouseUp'], pointerdown: ['mouseDown'], pointerup: ['mouseUp'],
  mouseenter: ['mouseEnter'], mouseleave: ['mouseLeave'], mouseover: ['mouseEnter'], mouseout: ['mouseLeave'],
  pointerenter: ['mouseEnter'], pointerleave: ['mouseLeave'],
  mousemove: ['mouseMove'], pointermove: ['mouseMove'], scroll: ['scroll'],
}

/** gpuix key names → `KeyboardEvent.key`. */
const KEY_NAMES: Readonly<Record<string, string>> = {
  enter: 'Enter', escape: 'Escape', tab: 'Tab', space: ' ', backspace: 'Backspace',
  delete: 'Delete', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
}

const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number'])

/** Which gpuix element draws a DOM element. */
const nativeType = (element: NativeElement): string => {
  switch (element.localName) {
    case 'input': return TEXT_INPUT_TYPES.has((element.getAttribute('type') ?? '').toLowerCase()) ? 'input' : 'div'
    case 'textarea': return 'textarea'
    case 'img': return 'img'
    default: return 'div'
  }
}

export type HostTimings = { syncMs: number; restyled: number; mutations: number; inputAt?: number }

export type HostOptions = {
  renderer: NativeRenderer
  sheets: Array<Sheet>
  onSynced?: (timings: HostTimings) => void
}

export const createHost = (document: NativeDocument, options: HostOptions) => {
  const { renderer, sheets } = options
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
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    queueMicrotask(sync)
  }
  const sync = () => {
    scheduled = false
    const started = performance.now()
    restyled = 0
    pass = new Map()
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
    mutations.flushMutations()
    options.onSynced?.({ syncMs: performance.now() - started, restyled, mutations: pending, ...(inputAt === undefined ? {} : { inputAt }) })
    inputAt = undefined
  }

  // STYLE
  // Per sync pass: each element's declarations and inherited text values.
  let pass = new Map<NativeElement, { declared: Declared; inherited: Map<string, string> }>()
  const info = (element: NativeElement): { declared: Declared; inherited: Map<string, string> } => {
    const found = pass.get(element)
    if (found !== undefined) return found
    const own = declared(element, sheets)
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
  /** Declarations with every var() substituted from the element's scope. */
  const resolved = (values: ReadonlyMap<string, string>, inherited: Map<string, string>) => {
    const out = new Map<string, string>()
    const lookup = (name: string) => inherited.get(name) ?? ''
    for (const [name, value] of values) if (!name.startsWith('--')) out.set(name, resolveVars(value, lookup))
    return out
  }
  const diff = (next: StyleDesc, base: StyleDesc): StyleDesc | undefined => {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(next)) {
      if (JSON.stringify(value) !== JSON.stringify((base as Record<string, unknown>)[key])) out[key] = value
    }
    return Object.keys(out).length === 0 ? undefined : out as StyleDesc
  }
  const styleOf = (element: NativeElement): StyleDesc => {
    const { declared: own, inherited } = info(element)
    const field = element.localName === 'input' || element.localName === 'textarea'
    const states: Array<State> = ['base']
    if (focused === element) states.push(...(focusVisible ? ['focus', 'focus-visible'] as const : ['focus'] as const))
    const values = resolved(fold(own, states), inherited)
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
    const style = toStyle(values, field) as Record<string, unknown>
    // Hover and press are GPUI's own states, so they need no round trip.
    for (const name of ['hover', 'active'] as const) {
      if (!own.has(name)) continue
      const merged = new Map([...values, ...resolved(fold(own, [...states, name]), inherited)])
      const change = diff(toStyle(merged, true), toStyle(values, true))
      if (change !== undefined) style[name] = change
    }
    return style as StyleDesc
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

  /** The style last sent per element, for its border box (boundsOf). */
  const sentStyles = new WeakMap<NativeElement, StyleDesc>()
  const restyleTree = (element: NativeElement) => {
    if (element.nativeId === 0) return
    restyled++
    const style = styleOf(element)
    sentStyles.set(element, style)
    mutations.setStyle(element.nativeId, style)
    syncProps(element)
    for (const child of element.childNodes) {
      if (child instanceof NativeElement) restyleTree(child)
      else if (child instanceof NativeText && child.nativeId !== 0) {
        mutations.setStyle(child.nativeId, textStyleOf(child))
        mutations.setText(child.nativeId, textOf(child))
      }
    }
  }

  // PROPS: accessibility, focus order, field values, images.
  const isFocusable = (element: NativeElement) => {
    if (element.hasAttribute('disabled') || element.closest('[inert]') !== null) return false
    const own = element.getAttribute('tabindex')
    return own !== null ? !Number.isNaN(Number(own)) : isNaturallyFocusable(element)
  }
  const labelText = (element: NativeElement): string | undefined => {
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
    return undefined
  }
  /** The props last sent per element, so an attribute that goes away is
   *  cleared in GPUI (sent as null) and an unchanged one isn't resent. */
  const sentProps = new WeakMap<NativeElement, Map<string, unknown>>()
  const propsOf = (element: NativeElement): Map<string, unknown> => {
    const props = new Map<string, unknown>()
    const role = element.getAttribute('role') ?? implicitRole(element)
    if (role !== undefined) props.set('role', role)
    const label = labelText(element)
    if (label !== undefined) props.set('aria-label', label)
    const description = element.getAttribute('aria-description')
    if (description !== null) props.set('aria-description', description)
    for (const name of ['aria-expanded', 'aria-selected'] as const) {
      const value = element.getAttribute(name)
      if (value !== null) props.set(name, value === 'true')
    }
    // gpuix has no checked state for AccessKit yet; say it as the value.
    const checked = element.getAttribute('aria-checked')
    if (checked !== null) props.set('aria-valuetext', checked === 'true' ? 'on' : 'off')
    const level = element.getAttribute('aria-level')
    if (level !== null) props.set('aria-level', Number(level))
    const testId = element.getAttribute('data-testid') ?? element.getAttribute('id')
    if (testId !== null) props.set('testId', testId)
    if (isFocusable(element)) props.set('tabIndex', element.tabIndex)
    if (element.hasAttribute('autofocus')) props.set('autoFocus', true)
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
      if (element.hasAttribute('readonly') || element.hasAttribute('disabled')) props.set('readOnly', true)
    }
    return props
  }
  const isField = (element: NativeElement) => nativeType(element) === 'input' || nativeType(element) === 'textarea'
  const syncProps = (element: NativeElement) => {
    const id = element.nativeId
    const next = propsOf(element)
    const sent = sentProps.get(element) ?? new Map<string, unknown>()
    for (const [key, value] of next) {
      if (key !== 'value' && JSON.stringify(sent.get(key)) !== JSON.stringify(value)) mutations.setCustomProp(id, key, value as never)
    }
    for (const key of sent.keys()) if (!next.has(key) && key !== 'value') mutations.setCustomProp(id, key, null)
    if (next.has('value') && sent.get('value') !== next.get('value')) pushValue(element, next.get('value') as string)
    sentProps.set(element, next)
    if (next.has('tabIndex')) {
      listenNatively(element, 'focus')
      listenNatively(element, 'blur')
    } else if (focused === element) {
      // Disabled (or made unfocusable) while focused: focus leaves it, as in a browser.
      setFocus(null, false)
    }
    if (isField(element)) {
      listenNatively(element, 'change')
      listenNatively(element, 'submit')
    }
    // A button or link activates on click with no listener of its own (a
    // submit button submits its form).
    if (element.localName === 'button' || (element.localName === 'a' && element.hasAttribute('href'))) listenNatively(element, 'click')
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
  const drawn = () => {
    if (drawTimer !== undefined) clearTimeout(drawTimer)
    drawTimer = undefined
    const waiting = drawWaiters
    drawWaiters = []
    for (const work of waiting) work()
  }

  // TREE
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
    if (type !== 'div') return
    for (const child of element.childNodes) {
      mount(child)
      if (child.nativeId !== 0) mutations.appendChild(id, child.nativeId)
    }
  }
  const unmount = (node: NativeNode) => {
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
    if (!(parent instanceof NativeElement) || nativeType(parent) !== 'div') return
    const siblings = parent.childNodes
    let before: NativeNode | undefined
    for (let i = siblings.indexOf(node) + 1; i < siblings.length && before === undefined; i++) {
      if (siblings[i]!.nativeId !== 0) before = siblings[i]
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
    if (node.nativeId !== 0 && (before === 0) !== (after === 0)) syncListener(node, native, after > 0)
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
    if (on) registerEventHandler(eventHandlers, id, native, event => {
      const target = nodes.get(event.elementId)
      if (target !== undefined) fromNative(target, event)
    })
    else unregisterEventHandler(eventHandlers, id, native)
    mutations.setEventListener(id, native, on)
    schedule()
  }

  // FOCUS
  let focused: NativeElement | null = null
  let focusVisible = false
  /** Whether the latest input was a key (for :focus-visible), as browsers judge it. */
  let keyboardModality = false
  let valueAtFocus = ''
  const SCOPE = '[aria-modal="true"], [data-fn-focus-scope="trap"]'
  const returnFocus = new WeakMap<NativeElement, NativeElement | null>()
  /** Moves the DOM's focus to `next`, firing what a browser fires.
   *  `fromGpui` when GPUI already moved its own focus. */
  const setFocus = (next: NativeElement | null, fromGpui: boolean, visible = keyboardModality) => {
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
      if (!fromGpui && next.nativeId !== 0) renderer.focusElement?.(next.nativeId)
      if (visible) reveal(next)
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
    setFocus(node instanceof NativeElement ? node : null, true, visible)
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

  /** GPUI's tab order, from the DOM: focusable elements with a tab index of
   *  0 or more, by tab index and then tree order (GPUI sorts by tab index,
   *  then paint order; the contract test checks the two agree). */
  const tabStops = (scope: NativeElement | null): Array<NativeElement> => {
    const out: Array<NativeElement> = []
    const walk = (element: NativeElement) => {
      if (element.nativeId !== 0 && isFocusable(element) && element.tabIndex >= 0) out.push(element)
      for (const child of element.children) walk(child)
    }
    walk(scope ?? body)
    return out
      .map((element, at) => ({ element, at }))
      .sort((a, b) => a.element.tabIndex - b.element.tabIndex || a.at - b.at)
      .map(stop => stop.element)
  }
  const stepStop = (from: number, delta: 1 | -1, scope: NativeElement | null): NativeElement | undefined => {
    const stops = tabStops(scope)
    if (stops.length === 0) return undefined
    const index = stops.findIndex(stop => stop.nativeId === from)
    if (index === -1) return delta > 0 ? stops[0] : stops.at(-1)
    return stops[(index + delta + stops.length) % stops.length]
  }

  // TAB IN A FIELD: GPUI's editors type a tab for the Tab key (sometimes two),
  // and report it as a change, before or after the window's keydown. In a
  // browser, Tab in a field never types. A change that only adds tabs is held
  // for one task; if a Tab keydown came for that field around it, the change
  // is dropped and GPUI's editor gets the old value back. Otherwise (a pasted
  // tab) it goes through, a task late. FoldKit never sees the tab Tab typed.
  let lastTab: { element: NativeElement; at: number } | undefined
  const tabbed = (element: NativeElement) => {
    lastTab = { element, at: performance.now() }
  }
  const onlyAddsTabs = (before: string, after: string) =>
    after.length > before.length && after.replace(/\t/g, '') === before.replace(/\t/g, '')
  const typedByTab = (element: NativeElement) =>
    lastTab !== undefined && lastTab.element === element && performance.now() - lastTab.at < 100

  // KEYS
  // Keys come from GPUI's window key events only (no element listens for
  // keys natively), so each keystroke arrives once. GPUI sends several in
  // one task when they queue up; each is its own event.
  const key = (event: EventPayload, type: 'keydown' | 'keyup') => {
    const name = event.key === undefined ? '' : KEY_NAMES[event.key] ?? event.key
    // Keys go where GPUI's focus is, even if it moved there by itself.
    reconcileFocus()
    keyboardModality = true
    inputAt = performance.now()
    const held = event.modifiers
    const target = focused ?? body
    const keyboard = new NativeKeyboardEvent(type, {
      bubbles: true, cancelable: true, key: name, code: name, repeat: event.isHeld === true,
      ctrlKey: held?.ctrl ?? false, metaKey: held?.cmd ?? false, shiftKey: held?.shift ?? false, altKey: held?.alt ?? false,
    })
    if (type === 'keydown' && name === 'Tab') tabbed(target)
    const proceed = target.dispatchEvent(keyboard)
    if (!proceed) return
    // The browser's default actions.
    if (type === 'keydown' && name === 'Tab') {
      const scope = focusScope()
      const from = renderer.getFocusedElementId?.() ?? null
      if (scope !== null && held?.shift) renderer.focusPreviousWithin?.(scope.nativeId)
      else if (scope !== null) renderer.focusNextWithin?.(scope.nativeId)
      else if (held?.shift) renderer.focusPrevious?.()
      else renderer.focusNext?.()
      // gpuix 0.10's focusPrevious doesn't move out of an editor (Shift-Tab
      // in a field stayed put, on Metal): step through the same order here.
      if ((renderer.getFocusedElementId?.() ?? null) === from && from !== null) {
        const next = stepStop(from, held?.shift ? -1 : 1, scope)
        if (next !== undefined && next.nativeId !== from) renderer.focusElement?.(next.nativeId)
      }
      followGpui()
      return
    }
    const activates = target.localName === 'button' || (target.localName === 'a' && target.hasAttribute('href'))
    if (activates && ((type === 'keydown' && name === 'Enter') || (type === 'keyup' && name === ' ' && target.localName === 'button'))) {
      target.click()
      return
    }
    if (type === 'keydown') scrollWithKeys(target, name)
  }
  /** A focused scroll area scrolls with the keys, as a browser's does. */
  const scrollWithKeys = (target: NativeElement, name: string) => {
    if (target.nativeId === 0 || !scrollable(target)) return
    const [x, y] = renderer.getScrollOffset?.(target.nativeId) ?? [0, 0]
    const height = renderer.getElementBounds?.(target.nativeId)?.height ?? 400
    const step: Record<string, number> = {
      ArrowDown: -40, ArrowUp: 40, PageDown: -height * 0.9, PageUp: height * 0.9, ' ': -height * 0.9,
      Home: Infinity, End: -Infinity,
    }
    const by = step[name]
    if (by === undefined) return
    const next = by === Infinity ? 0 : by === -Infinity ? -1e7 : Math.min(0, (y ?? 0) + by)
    renderer.scrollTo?.(target.nativeId, x ?? 0, next)
    target.dispatchEvent(new NativeEvent('scroll'))
  }
  const scrollable = (element: NativeElement) => {
    const values = info(element).declared.base
    return values.get('overflow-y') === 'scroll' || values.get('overflow-x') === 'scroll'
  }

  // GPUI EVENTS → DOM EVENTS
  let lastClick: { node: NativeNode; sameTask: boolean } | undefined
  const fromNative = (node: NativeNode, event: EventPayload) => {
    const held = event.modifiers
    const init = {
      bubbles: true, cancelable: true, clientX: event.x ?? 0, clientY: event.y ?? 0,
      ctrlKey: held?.ctrl ?? false, metaKey: held?.cmd ?? false, shiftKey: held?.shift ?? false, altKey: held?.alt ?? false,
    }
    const element = node as NativeElement
    switch (event.eventType) {
      case 'click': {
        // GPUI tells every listening ancestor; the DOM bubbles it itself.
        if (lastClick !== undefined && lastClick.sameTask && node !== lastClick.node && node.contains(lastClick.node)) return
        const click = { node, sameTask: true }
        lastClick = click
        queueMicrotask(() => {
          click.sameTask = false
        })
        keyboardModality = false
        inputAt = performance.now()
        const mouse = { ...init, button: event.button ?? 0, detail: event.clickCount ?? 1 }
        // A press focuses the nearest focusable element, without a ring.
        const focusable = node instanceof NativeElement ? focusableAncestor(element) : null
        if (focusable !== null && focusable !== focused) setFocus(focusable, false, false)
        if (event.isRightClick) {
          element.dispatchEvent(new NativeMouseEvent('contextmenu', mouse))
          return
        }
        const proceed = element.dispatchEvent(new NativeMouseEvent('click', mouse))
        if (mouse.detail === 2) element.dispatchEvent(new NativeMouseEvent('dblclick', mouse))
        // A submit button submits its form.
        const button = element.closest('button')
        if (proceed && button !== null && ['', 'submit'].includes((button.getAttribute('type') ?? '').toLowerCase())) {
          button.form?.requestSubmit()
        }
        return
      }
      case 'mouseDown': case 'mouseUp': case 'mouseMove': {
        const type = { mouseDown: 'mousedown', mouseUp: 'mouseup', mouseMove: 'mousemove' }[event.eventType]!
        if (!listens(node, type) && !listens(node, type.replace('mouse', 'pointer'))) return
        const detail = type === 'mousemove' ? 0 : event.clickCount ?? 1
        element.dispatchEvent(new NativeMouseEvent(type, { ...init, button: event.button ?? 0, detail }))
        if (listens(node, type.replace('mouse', 'pointer'))) {
          element.dispatchEvent(new NativeMouseEvent(type.replace('mouse', 'pointer'), { ...init, pointerType: 'mouse', button: event.button ?? 0 }))
        }
        return
      }
      case 'mouseEnter': case 'mouseLeave': {
        const enter = event.eventType === 'mouseEnter'
        element.dispatchEvent(new NativeMouseEvent(enter ? 'mouseenter' : 'mouseleave', { ...init, bubbles: false }))
        element.dispatchEvent(new NativeMouseEvent(enter ? 'mouseover' : 'mouseout', init))
        element.dispatchEvent(new NativeMouseEvent(enter ? 'pointerenter' : 'pointerleave', { ...init, bubbles: false, pointerType: 'mouse' }))
        return
      }
      case 'keyDown': return key(event, 'keydown')
      case 'keyUp': return key(event, 'keyup')
      case 'focus':
        if (node instanceof NativeElement) setFocus(node, true)
        return
      case 'blur':
        // Focus may be moving to another element GPUI reports next.
        queueMicrotask(() => {
          if (focused === node && (renderer.getFocusedElementId?.() ?? null) !== node.nativeId) setFocus(null, true)
        })
        return
      case 'change': {
        inputAt = performance.now()
        const value = unnudged(element, event.value ?? '')
        if (onlyAddsTabs(element.value, value)) {
          const before = element.value
          if (typedByTab(element)) return restoreValue(element, before)
          setTimeout(() => {
            if (typedByTab(element)) restoreValue(element, before)
            else typed(element, value)
          }, 0)
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
      case 'scroll':
        element.dispatchEvent(new NativeEvent('scroll'))
        return
      default:
        element.dispatchEvent(new NativeEvent(event.eventType, init))
    }
  }
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
  const focusableAncestor = (element: NativeElement): NativeElement | null => {
    for (let at: NativeElement | null = element; at !== null; at = at.parentElement) if (isFocusable(at)) return at
    return null
  }

  /** The border box where GPUI last painted `element`, as
   *  `getBoundingClientRect` has it. gpuix 0.10 reports a box from the
   *  content corner (moved by the left and top border and padding, the size
   *  without the borders), and a scroll area's own box moved by its own scroll
   *  offset (scrolled 100 down, it says the area is 100 higher than it's
   *  drawn). Both are undone here. */
  const boundsOf = (element: NativeElement) => {
    if (element.nativeId === 0) return null
    const box = renderer.getElementBounds?.(element.nativeId) ?? null
    if (box === null) return null
    const style = (sentStyles.get(element) ?? {}) as Record<string, unknown>
    const px = (key: string) => (typeof style[key] === 'number' ? style[key] as number : 0)
    const [left, top] = [px('borderLeftWidth') + px('paddingLeft'), px('borderTopWidth') + px('paddingTop')]
    const [scrollX = 0, scrollY = 0] = scrollable(element) ? renderer.getScrollOffset?.(element.nativeId) ?? [0, 0] : [0, 0]
    return {
      x: box.x - left - scrollX,
      y: box.y - top - scrollY,
      width: box.width + px('borderLeftWidth') + px('borderRightWidth'),
      height: box.height + px('borderTopWidth') + px('borderBottomWidth'),
    }
  }

  /** Scrolls the nearest scroll area until `element` shows, from where GPUI
   *  last painted both, and moves only that area (gpuix 0.10's own
   *  scrollIntoView also scrolled the page, on Metal). */
  const reveal = (element: NativeElement) => {
    if (element.nativeId === 0) return
    let area = element.parentElement
    while (area !== null && (area.nativeId === 0 || !scrollable(area))) area = area.parentElement
    if (area === null) return
    const box = boundsOf(element)
    const view = boundsOf(area)
    if (box === null || box === undefined || view === null || view === undefined) {
      renderer.scrollIntoView?.(element.nativeId)
      return
    }
    const [x = 0, y = 0] = renderer.getScrollOffset?.(area.nativeId) ?? [0, 0]
    let next = y
    if (box.y < view.y) next = y + (view.y - box.y)
    else if (box.y + box.height > view.y + view.height) next = y - (box.y + box.height - view.y - view.height)
    if (next !== y) {
      renderer.scrollTo?.(area.nativeId, x, Math.min(0, next))
      area.dispatchEvent(new NativeEvent('scroll'))
    }
  }

  // THE HOST INTERFACE (what the document calls)
  const host: Host = {
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
      const id = node.nativeId
      unmount(node)
      mutations.destroyElement(id)
      if (parent instanceof NativeElement) dirty.add(parent)
      schedule()
    },
    changed: (element, what) => {
      if (what === 'value') {
        if (element.nativeId !== 0) syncProps(element)
        schedule()
        return
      }
      dirty.add(element.nativeId === 0 ? body : element)
      schedule()
    },
    text: node => {
      if (node.nativeId === 0) return
      mutations.setText(node.nativeId, textOf(node))
      schedule()
    },
    listening: (node, type, delta) => {
      const counts = domCounts.get(node) ?? new Map<string, number>()
      domCounts.set(node, counts)
      counts.set(type, Math.max(0, (counts.get(type) ?? 0) + delta))
      for (const native of DOM_TO_NATIVE[type] ?? []) countNative(node, native, delta)
    },
    focus: (element, options) => {
      if (element.nativeId === 0 || !isFocusable(element)) return
      setFocus(element, false, options?.focusVisible ?? keyboardModality)
    },
    blur: element => {
      if (focused === element) setFocus(null, false)
    },
    bounds: element => boundsOf(element) ?? { x: 0, y: 0, width: 0, height: 0 },
    scrollIntoView: element => reveal(element),
    scrollOffset: element => {
      const offset = element.nativeId === 0 ? null : renderer.getScrollOffset?.(element.nativeId)
      return [offset?.[0] ?? 0, offset?.[1] ?? 0]
    },
    scrollTo: (element, x, y) => {
      if (element.nativeId === 0) return
      renderer.scrollTo?.(element.nativeId, x, y)
      setTimeout(() => element.dispatchEvent(new NativeEvent('scroll')), 0)
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
      // Seen after GPUI dispatched the press, so its focus is committed.
      press(event.x, event.y)
    })
    mutations.setEventListener(sentinel, 'mouseDownOutside', true)
  }
  /** A press anywhere. If GPUI moved focus, the DOM follows. If it didn't and
   *  the press was outside the focused element, focus leaves it, as a
   *  browser's does (a press on another focusable element then focuses that
   *  one, from its click). */
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
    mount(body)
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
  sync()

  return {
    /** Draw pending changes now (tests). */
    flush: sync,
    /** GPUI drew a frame: work waiting for one runs (the frame loop and the
     *  tests call this after the renderer draws). */
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
    /** Sends a gpuix event as GPUI would (tests and automation). */
    dispatch: (event: EventPayload) => state.dispatch(event),
    focused: () => focused,
    detach: () => {
      binding.detach()
      document.host = undefined
    },
  }
}

export type GpuixHost = ReturnType<typeof createHost>

/** The role a browser gives an element without one, for AccessKit. */
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
