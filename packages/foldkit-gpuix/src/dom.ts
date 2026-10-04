// NATIVE DOM
//
// The DOM FoldKit patches, with no browser engine behind it. FoldKit renders
// through snabbdom, which calls `document.createElement`, `insertBefore`,
// `setAttribute`, `style`, `classList` and `addEventListener` exactly as on the
// web. Here each of those calls lands on a small node object, and the node
// tells its document's `Host` (host.ts), which turns it into a gpuix mutation.
// So FoldKit drives gpuix's retained tree directly, as @gpuix/react and
// @gpuix/solid do; there is no happy-dom and no mirror.
//
// Only what FoldKit, snabbdom and @foldkit/ui reach for is here: nodes and
// events, attributes, inline style, classes, dataset, focus, a few form
// properties, and a selector engine for the selectors FoldKit's Dom helpers
// use. No cascade and no layout engine: GPUI lays out, and styles come from
// inline styles and a flat sheet (sheet.ts).

/** What a document reports to whoever draws it (host.ts). */
export interface Host {
  /** `node` (and its subtree) was inserted under `parent`, before `before`. */
  inserted(parent: NativeNode, node: NativeNode): void
  /** `node` was removed from `parent`. */
  removed(parent: NativeNode, node: NativeNode): void
  /** An attribute, inline style or class changed. */
  changed(element: NativeElement, what: string): void
  text(node: NativeText): void
  /** A DOM listener was added (+1) or removed (-1). */
  listening(node: NativeNode, type: string, delta: number): void
  focus(element: NativeElement, options?: { focusVisible?: boolean }): void
  blur(element: NativeElement): void
  bounds(element: NativeElement): { x: number; y: number; width: number; height: number }
  scrollIntoView(element: NativeElement): void
  scrollOffset(element: NativeElement): [number, number]
  scrollTo(element: NativeElement, x: number, y: number): void
}

// EVENTS

type Listener = { callback: EventListenerOrEventListenerObject; capture: boolean; once: boolean }

export class NativeEvent {
  static readonly NONE = 0
  static readonly CAPTURING_PHASE = 1
  static readonly AT_TARGET = 2
  static readonly BUBBLING_PHASE = 3
  /** Each subclass's own fields and their defaults. (Declared, not
   *  initialised, fields: an initialiser would run after this constructor
   *  and overwrite what `init` set.) */
  static defaults: Readonly<Record<string, unknown>> = {}
  readonly type: string
  readonly bubbles: boolean
  readonly cancelable: boolean
  readonly composed = false
  readonly isTrusted = true
  readonly timeStamp = performance.now()
  target: NativeEventTarget | null = null
  currentTarget: NativeEventTarget | null = null
  eventPhase = 0
  defaultPrevented = false
  stopped = false
  stoppedNow = false
  constructor(type: string, init: Record<string, unknown> = {}) {
    this.type = type
    this.bubbles = init['bubbles'] === true
    this.cancelable = init['cancelable'] === true
    const defaults = (new.target as unknown as { defaults: Record<string, unknown> }).defaults
    for (const [key, value] of Object.entries({ ...defaults, ...init })) {
      if (key !== 'bubbles' && key !== 'cancelable') (this as Record<string, unknown>)[key] = value
    }
  }
  preventDefault() {
    if (this.cancelable) this.defaultPrevented = true
  }
  stopPropagation() {
    this.stopped = true
  }
  stopImmediatePropagation() {
    this.stopped = true
    this.stoppedNow = true
  }
  composedPath(): Array<NativeEventTarget> {
    const path: Array<NativeEventTarget> = []
    for (let at: NativeEventTarget | null = this.target; at !== null; at = parentTarget(at)) path.push(at)
    return path
  }
}
const MODIFIERS = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false }
const modifierState = (event: typeof MODIFIERS, key: string) =>
  key === 'Shift' ? event.shiftKey : key === 'Control' ? event.ctrlKey : key === 'Alt' ? event.altKey : key === 'Meta' ? event.metaKey : false
export class NativeUIEvent extends NativeEvent {
  static override defaults: Readonly<Record<string, unknown>> = { detail: 0 }
  declare detail: number
}
export class NativeMouseEvent extends NativeUIEvent {
  static override defaults = {
    ...NativeUIEvent.defaults, ...MODIFIERS,
    clientX: 0, clientY: 0, screenX: 0, screenY: 0, button: 0, buttons: 0, relatedTarget: null,
  }
  declare clientX: number
  declare clientY: number
  declare screenX: number
  declare screenY: number
  declare button: number
  declare buttons: number
  declare relatedTarget: NativeEventTarget | null
  declare ctrlKey: boolean
  declare shiftKey: boolean
  declare altKey: boolean
  declare metaKey: boolean
  getModifierState(key: string) { return modifierState(this, key) }
}
export class NativePointerEvent extends NativeMouseEvent {
  static override defaults = { ...NativeMouseEvent.defaults, pointerId: 1, pointerType: 'mouse', isPrimary: true }
  declare pointerId: number
  declare pointerType: string
  declare isPrimary: boolean
}
export class NativeKeyboardEvent extends NativeUIEvent {
  static override defaults = { ...NativeUIEvent.defaults, ...MODIFIERS, key: '', code: '', repeat: false, isComposing: false }
  declare key: string
  declare code: string
  declare repeat: boolean
  declare isComposing: boolean
  declare ctrlKey: boolean
  declare shiftKey: boolean
  declare altKey: boolean
  declare metaKey: boolean
  getModifierState(key: string) { return modifierState(this, key) }
}
export class NativeFocusEvent extends NativeUIEvent {
  static override defaults = { ...NativeUIEvent.defaults, relatedTarget: null }
  declare relatedTarget: NativeEventTarget | null
}
export class NativeInputEvent extends NativeUIEvent {
  static override defaults = { ...NativeUIEvent.defaults, data: null, inputType: 'insertText' }
  declare data: string | null
  declare inputType: string
}
export class NativeCustomEvent extends NativeEvent {
  static override defaults = { detail: null }
  declare detail: unknown
}

const parentTarget = (target: NativeEventTarget): NativeEventTarget | null => {
  if (target instanceof NativeDocument) return target.defaultView
  if (target instanceof NativeNode) return target.parentNode ?? (target.isConnected ? target.ownerDocument : null)
  return null
}

export class NativeEventTarget {
  readonly listeners = new Map<string, Array<Listener>>()
  addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
    if (callback === null) return
    const capture = typeof options === 'boolean' ? options : options?.capture === true
    const once = typeof options === 'object' && options.once === true
    const list = this.listeners.get(type) ?? []
    if (list.some(listener => listener.callback === callback && listener.capture === capture)) return
    list.push({ callback, capture, once })
    this.listeners.set(type, list)
    this.listenersChanged(type, 1)
  }
  removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
    const capture = typeof options === 'boolean' ? options : options?.capture === true
    const list = this.listeners.get(type)
    const index = list?.findIndex(listener => listener.callback === callback && listener.capture === capture) ?? -1
    if (list === undefined || index === -1) return
    list.splice(index, 1)
    this.listenersChanged(type, -1)
  }
  protected listenersChanged(_type: string, _delta: number) {}
  /** The DOM's three phases: capture down to the target, the target, bubble up. */
  dispatchEvent(event: NativeEvent | Event): boolean {
    const native = event as NativeEvent
    native.target = this
    const path = native.composedPath()
    const run = (at: NativeEventTarget, phase: number) => {
      native.currentTarget = at
      native.eventPhase = phase
      for (const listener of [...(at.listeners.get(native.type) ?? [])]) {
        if (phase === 1 && !listener.capture) continue
        if (phase === 3 && listener.capture) continue
        if (listener.once) at.removeEventListener(native.type, listener.callback, listener.capture)
        const { callback } = listener
        if (typeof callback === 'function') callback.call(at, native as unknown as Event)
        else callback.handleEvent(native as unknown as Event)
        if (native.stoppedNow) break
      }
    }
    for (let i = path.length - 1; i > 0 && !native.stopped; i--) run(path[i]!, 1)
    if (!native.stopped) run(this, 2)
    if (native.bubbles) for (let i = 1; i < path.length && !native.stopped; i++) run(path[i]!, 3)
    native.currentTarget = null
    native.eventPhase = 0
    return !native.defaultPrevented
  }
}

// NODES

let nextNodeKey = 0

export class NativeNode extends NativeEventTarget {
  static readonly ELEMENT_NODE = 1
  static readonly TEXT_NODE = 3
  static readonly COMMENT_NODE = 8
  static readonly DOCUMENT_NODE = 9
  static readonly DOCUMENT_FRAGMENT_NODE = 11
  readonly ELEMENT_NODE = 1
  readonly TEXT_NODE = 3
  readonly COMMENT_NODE = 8
  readonly DOCUMENT_NODE = 9
  readonly DOCUMENT_FRAGMENT_NODE = 11
  readonly key = nextNodeKey++
  parentNode: NativeNode | null = null
  readonly childNodes: Array<NativeNode> = []
  /** The gpuix element id once drawn (host.ts), 0 until then. */
  nativeId = 0
  constructor(readonly ownerDocument: NativeDocument, readonly nodeType: number, readonly nodeName: string) {
    super()
  }
  get parentElement(): NativeElement | null {
    return this.parentNode instanceof NativeElement ? this.parentNode : null
  }
  get firstChild() { return this.childNodes[0] ?? null }
  get lastChild() { return this.childNodes.at(-1) ?? null }
  get nextSibling(): NativeNode | null {
    const siblings = this.parentNode?.childNodes
    return siblings === undefined ? null : siblings[siblings.indexOf(this) + 1] ?? null
  }
  get previousSibling(): NativeNode | null {
    const siblings = this.parentNode?.childNodes
    return siblings === undefined ? null : siblings[siblings.indexOf(this) - 1] ?? null
  }
  get isConnected(): boolean {
    let at: NativeNode = this
    while (at.parentNode !== null) at = at.parentNode
    return at === this.ownerDocument
  }
  get textContent(): string {
    return this.childNodes.map(child => child.nodeType === 8 ? '' : child.textContent).join('')
  }
  set textContent(value: string) {
    for (const child of [...this.childNodes]) this.removeChild(child)
    if (value !== '') this.appendChild(this.ownerDocument.createTextNode(value))
  }
  hasChildNodes() { return this.childNodes.length > 0 }
  contains(other: NativeNode | null): boolean {
    for (let at = other; at !== null; at = at.parentNode) if (at === this) return true
    return false
  }
  getRootNode(): NativeNode {
    let at: NativeNode = this
    while (at.parentNode !== null) at = at.parentNode
    return at
  }
  appendChild<T extends NativeNode>(child: T): T {
    return this.insertBefore(child, null)
  }
  insertBefore<T extends NativeNode>(child: T, before: NativeNode | null): T {
    if (child instanceof NativeDocumentFragment) {
      for (const inner of [...child.childNodes]) this.insertBefore(inner, before)
      return child
    }
    if (child.parentNode !== null) child.parentNode.detach(child, child.parentNode === this)
    const index = before === null ? -1 : this.childNodes.indexOf(before)
    if (index === -1) this.childNodes.push(child)
    else this.childNodes.splice(index, 0, child)
    child.parentNode = this
    if (this.isConnected) this.ownerDocument.host?.inserted(this, child)
    return child
  }
  removeChild<T extends NativeNode>(child: T): T {
    if (child.parentNode !== this) throw new Error('NotFoundError: not a child of this node')
    this.detach(child, false)
    return child
  }
  replaceChild<T extends NativeNode>(next: NativeNode, old: T): T {
    this.insertBefore(next, old)
    return this.removeChild(old)
  }
  remove() {
    this.parentNode?.removeChild(this)
  }
  /** Takes `child` out; `moving` means it's about to go back in under the same
   *  parent, which GPUI does as a move (no unmount, focus and scroll kept). */
  private detach(child: NativeNode, moving: boolean) {
    const connected = this.isConnected
    this.childNodes.splice(this.childNodes.indexOf(child), 1)
    child.parentNode = null
    if (connected && !moving) this.ownerDocument.host?.removed(this, child)
  }
  protected override listenersChanged(type: string, delta: number) {
    this.ownerDocument.host?.listening(this, type, delta)
  }
}

export class NativeText extends NativeNode {
  #data: string
  constructor(document: NativeDocument, data: string) {
    super(document, 3, '#text')
    this.#data = data
  }
  get data() { return this.#data }
  set data(value: string) {
    this.#data = String(value)
    if (this.isConnected) this.ownerDocument.host?.text(this)
  }
  get nodeValue() { return this.#data }
  set nodeValue(value: string) { this.data = value }
  override get textContent() { return this.#data }
  override set textContent(value: string) { this.data = value }
}

export class NativeComment extends NativeNode {
  constructor(document: NativeDocument, public data: string) {
    super(document, 8, '#comment')
  }
  override get textContent() { return this.data }
  override set textContent(value: string) { this.data = value }
}

export class NativeDocumentFragment extends NativeNode {
  constructor(document: NativeDocument) {
    super(document, 11, '#document-fragment')
  }
}

// STYLE, CLASSES, DATASET

const kebab = (name: string) => name.startsWith('--') ? name : name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)

/** An element's inline style: `style.color = …`, `setProperty('--x', …)`. */
const inlineStyle = (element: NativeElement) => {
  const declarations = element.inline
  const changed = () => element.ownerDocument.host?.changed(element, 'style')
  const api: Record<string, unknown> = {
    setProperty: (name: string, value: string | null) => {
      if (value === null || value === '') declarations.delete(kebab(name))
      else declarations.set(kebab(name), String(value))
      changed()
    },
    removeProperty: (name: string) => {
      const before = declarations.get(kebab(name)) ?? ''
      declarations.delete(kebab(name))
      changed()
      return before
    },
    getPropertyValue: (name: string) => declarations.get(kebab(name)) ?? '',
    item: (index: number) => [...declarations.keys()][index] ?? '',
  }
  return new Proxy(api, {
    get: (target, key) => {
      if (typeof key !== 'string') return undefined
      if (key in target) return target[key]
      if (key === 'length') return declarations.size
      if (key === 'cssText') return [...declarations].map(([name, value]) => `${name}: ${value};`).join(' ')
      return declarations.get(kebab(key)) ?? ''
    },
    set: (_, key, value) => {
      if (typeof key !== 'string') return false
      if (key === 'cssText') {
        declarations.clear()
        for (const part of String(value).split(';')) {
          const colon = part.indexOf(':')
          if (colon > 0) declarations.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim())
        }
      } else if (value === null || value === '') declarations.delete(kebab(key))
      else declarations.set(kebab(key), String(value))
      changed()
      return true
    },
  }) as unknown as CSSStyleDeclaration
}

const classList = (element: NativeElement) => {
  const names = () => (element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
  const write = (next: Array<string>) => element.setAttribute('class', next.join(' '))
  return {
    contains: (name: string) => names().includes(name),
    add: (...add: Array<string>) => write([...new Set([...names(), ...add])]),
    remove: (...remove: Array<string>) => write(names().filter(name => !remove.includes(name))),
    toggle: (name: string, force?: boolean) => {
      const on = force ?? !names().includes(name)
      write(on ? [...new Set([...names(), name])] : names().filter(other => other !== name))
      return on
    },
    get length() { return names().length },
    item: (index: number) => names()[index] ?? null,
    get value() { return names().join(' ') },
    [Symbol.iterator]: () => names()[Symbol.iterator](),
  }
}

const dataset = (element: NativeElement) =>
  new Proxy({} as Record<string, string>, {
    get: (_, key) => typeof key === 'string' ? element.getAttribute(`data-${kebab(key)}`) ?? undefined : undefined,
    set: (_, key, value) => {
      if (typeof key === 'string') element.setAttribute(`data-${kebab(key)}`, String(value))
      return true
    },
    deleteProperty: (_, key) => {
      if (typeof key === 'string') element.removeAttribute(`data-${kebab(key)}`)
      return true
    },
    has: (_, key) => typeof key === 'string' && element.hasAttribute(`data-${kebab(key)}`),
    ownKeys: () => element.getAttributeNames().filter(name => name.startsWith('data-'))
      .map(name => name.slice(5).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())),
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  })

// ELEMENTS

/** Attributes that are also properties (FoldKit's props module sets them as
 *  properties; snabbdom's attributes module as attributes). */
const REFLECTED: Readonly<Record<string, string>> = {
  id: 'id', className: 'class', title: 'title', role: 'role', lang: 'lang', dir: 'dir',
  name: 'name', placeholder: 'placeholder', type: 'type', href: 'href', src: 'src', alt: 'alt',
  htmlFor: 'for', min: 'min', max: 'max', step: 'step', autocomplete: 'autocomplete',
}
const BOOLEAN_REFLECTED: Readonly<Record<string, string>> = {
  disabled: 'disabled', hidden: 'hidden', readOnly: 'readonly', required: 'required',
  autofocus: 'autofocus', multiple: 'multiple', open: 'open', inert: 'inert',
}

export class NativeElement extends NativeNode {
  readonly tagName: string
  readonly localName: string
  readonly namespaceURI: string
  readonly attributeMap = new Map<string, string>()
  /** Inline style declarations, CSS names (`background-color`, `--x`). */
  readonly inline = new Map<string, string>()
  readonly style: CSSStyleDeclaration
  readonly classList: ReturnType<typeof classList>
  readonly dataset: Record<string, string>
  #value = ''
  checked = false
  constructor(document: NativeDocument, tag: string, namespace = 'http://www.w3.org/1999/xhtml') {
    super(document, 1, tag.toUpperCase())
    this.localName = tag.toLowerCase()
    this.tagName = tag.toUpperCase()
    this.namespaceURI = namespace
    this.style = inlineStyle(this)
    this.classList = classList(this)
    this.dataset = dataset(this)
    for (const [property, attribute] of Object.entries(REFLECTED)) {
      Object.defineProperty(this, property, {
        get: () => this.getAttribute(attribute) ?? '',
        set: (value: unknown) => this.setAttribute(attribute, String(value)),
        configurable: true, enumerable: true,
      })
    }
    for (const [property, attribute] of Object.entries(BOOLEAN_REFLECTED)) {
      Object.defineProperty(this, property, {
        get: () => this.hasAttribute(attribute),
        set: (value: unknown) => this.toggleAttribute(attribute, Boolean(value)),
        configurable: true, enumerable: true,
      })
    }
  }
  // Attributes
  getAttribute(name: string): string | null { return this.attributeMap.get(name.toLowerCase()) ?? null }
  hasAttribute(name: string) { return this.attributeMap.has(name.toLowerCase()) }
  getAttributeNames() { return [...this.attributeMap.keys()] }
  get attributes() {
    return [...this.attributeMap].map(([name, value]) => ({ name, value, localName: name, namespaceURI: null }))
  }
  setAttribute(name: string, value: string) {
    const key = name.toLowerCase()
    const next = String(value)
    if (this.attributeMap.get(key) === next) return
    this.attributeMap.set(key, next)
    if (key === 'style') this.style.cssText = next
    if (key === 'value' && this.#value === '') this.#value = next
    this.ownerDocument.host?.changed(this, key)
  }
  setAttributeNS(_namespace: string | null, name: string, value: string) { this.setAttribute(name, value) }
  removeAttribute(name: string) {
    const key = name.toLowerCase()
    if (!this.attributeMap.delete(key)) return
    if (key === 'style') this.inline.clear()
    this.ownerDocument.host?.changed(this, key)
  }
  removeAttributeNS(_namespace: string | null, name: string) { this.removeAttribute(name) }
  toggleAttribute(name: string, force?: boolean) {
    const on = force ?? !this.hasAttribute(name)
    if (on) this.setAttribute(name, '')
    else this.removeAttribute(name)
    return on
  }
  // Tree
  get children(): Array<NativeElement> { return this.childNodes.filter(child => child instanceof NativeElement) as Array<NativeElement> }
  get childElementCount() { return this.children.length }
  get firstElementChild(): NativeElement | null { return this.children[0] ?? null }
  get lastElementChild(): NativeElement | null { return this.children.at(-1) ?? null }
  get nextElementSibling(): NativeElement | null {
    let at = this.nextSibling
    while (at !== null && !(at instanceof NativeElement)) at = at.nextSibling
    return at
  }
  get previousElementSibling(): NativeElement | null {
    let at = this.previousSibling
    while (at !== null && !(at instanceof NativeElement)) at = at.previousSibling
    return at
  }
  get innerText() { return this.textContent }
  set innerText(value: string) { this.textContent = value }
  append(...nodes: Array<NativeNode | string>) {
    for (const node of nodes) this.appendChild(typeof node === 'string' ? this.ownerDocument.createTextNode(node) : node)
  }
  prepend(...nodes: Array<NativeNode | string>) {
    const first = this.firstChild
    for (const node of nodes) this.insertBefore(typeof node === 'string' ? this.ownerDocument.createTextNode(node) : node, first)
  }
  replaceWith(...nodes: Array<NativeNode | string>) {
    const parent = this.parentNode
    if (parent === null) return
    for (const node of nodes) parent.insertBefore(typeof node === 'string' ? this.ownerDocument.createTextNode(node) : node, this)
    parent.removeChild(this)
  }
  // Selectors
  matches(selector: string): boolean { return matches(this, parseSelector(selector), this) }
  closest(selector: string): NativeElement | null {
    const parsed = parseSelector(selector)
    for (let at: NativeElement | null = this; at !== null; at = at.parentElement) if (matches(at, parsed, at)) return at
    return null
  }
  querySelector(selector: string): NativeElement | null { return querySelectorAll(this, selector, true)[0] ?? null }
  querySelectorAll(selector: string): Array<NativeElement> { return querySelectorAll(this, selector, false) }
  getElementsByTagName(tag: string) { return this.querySelectorAll(tag) }
  // Form controls
  get value(): string { return this.#value }
  set value(next: string) {
    const value = next === null || next === undefined ? '' : String(next)
    if (value === this.#value) return
    this.#value = value
    this.ownerDocument.host?.changed(this, 'value')
  }
  /** A value GPUI's own input already shows: no echo back to it. */
  setValueFromNative(value: string) { this.#value = value }
  get form(): NativeElement | null { return this.closest('form') }
  get tabIndex(): number {
    const own = this.getAttribute('tabindex')
    if (own !== null && own !== '' && !Number.isNaN(Number(own))) return Number(own)
    return isNaturallyFocusable(this) ? 0 : -1
  }
  set tabIndex(value: number) { this.setAttribute('tabindex', String(value)) }
  requestSubmit() {
    if (this.localName !== 'form') return
    this.dispatchEvent(new NativeEvent('submit', { bubbles: true, cancelable: true }))
  }
  submit() { this.requestSubmit() }
  click() {
    this.dispatchEvent(new NativeMouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
  }
  // Focus, layout, scroll: GPUI's (host.ts)
  focus(options?: { focusVisible?: boolean }) { this.ownerDocument.host?.focus(this, options) }
  blur() { this.ownerDocument.host?.blur(this) }
  getBoundingClientRect() {
    const { x, y, width, height } = this.ownerDocument.host?.bounds(this) ?? { x: 0, y: 0, width: 0, height: 0 }
    return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON: () => ({ x, y, width, height }) }
  }
  getClientRects() { return [this.getBoundingClientRect()] }
  get offsetWidth() { return this.getBoundingClientRect().width }
  get offsetHeight() { return this.getBoundingClientRect().height }
  get clientWidth() { return this.getBoundingClientRect().width }
  get clientHeight() { return this.getBoundingClientRect().height }
  get offsetLeft() { return 0 }
  get offsetTop() { return 0 }
  checkVisibility() {
    for (let at: NativeElement | null = this; at !== null; at = at.parentElement) {
      if (at.hasAttribute('hidden') || at.inline.get('display') === 'none') return false
    }
    return this.isConnected
  }
  scrollIntoView() { this.ownerDocument.host?.scrollIntoView(this) }
  get scrollTop() { return -(this.ownerDocument.host?.scrollOffset(this)[1] ?? 0) || 0 }
  set scrollTop(value: number) { this.ownerDocument.host?.scrollTo(this, -this.scrollLeft, -value) }
  get scrollLeft() { return -(this.ownerDocument.host?.scrollOffset(this)[0] ?? 0) || 0 }
  set scrollLeft(value: number) { this.ownerDocument.host?.scrollTo(this, -value, -this.scrollTop) }
  get scrollHeight() { return this.getBoundingClientRect().height }
  scrollTo(x: number | { top?: number; left?: number }, y?: number) {
    const target = typeof x === 'object' ? { left: x.left ?? this.scrollLeft, top: x.top ?? this.scrollTop } : { left: x, top: y ?? 0 }
    this.ownerDocument.host?.scrollTo(this, -target.left, -target.top)
  }
  // <dialog>: open is an attribute, as in a browser.
  show() { this.setAttribute('open', '') }
  showModal() { this.setAttribute('open', '') }
  close() { this.removeAttribute('open') }
  animate() { return { finished: Promise.resolve(), cancel: () => {}, onfinish: null } }
  getAnimations() { return [] }
  attachShadow(): never { throw new Error('FoldKit on gpuix: no shadow DOM') }
}

/** The elements a browser puts in the tab order without a tabindex. */
export const isNaturallyFocusable = (element: NativeElement) => {
  if (element.hasAttribute('disabled')) return false
  switch (element.localName) {
    case 'input': return element.getAttribute('type') !== 'hidden'
    case 'button': case 'select': case 'textarea': case 'summary': return true
    case 'a': return element.hasAttribute('href')
    default: return false
  }
}

// DOCUMENT

export class NativeDocument extends NativeNode {
  host: Host | undefined
  defaultView: NativeWindow | null = null
  readonly documentElement: NativeElement
  readonly head: NativeElement
  readonly body: NativeElement
  activeElement: NativeElement | null = null
  title = ''
  readyState = 'complete'
  visibilityState = 'visible'
  hidden = false
  readonly styleSheets: Array<never> = []
  constructor() {
    super(undefined as unknown as NativeDocument, 9, '#document')
    ;(this as { ownerDocument: NativeDocument }).ownerDocument = this
    this.documentElement = new NativeElement(this, 'html')
    this.head = new NativeElement(this, 'head')
    this.body = new NativeElement(this, 'body')
    this.childNodes.push(this.documentElement)
    this.documentElement.parentNode = this
    this.documentElement.childNodes.push(this.head, this.body)
    this.head.parentNode = this.documentElement
    this.body.parentNode = this.documentElement
    this.activeElement = this.body
  }
  override get isConnected() { return true }
  createElement(tag: string) { return new NativeElement(this, tag) }
  createElementNS(namespace: string | null, tag: string) { return new NativeElement(this, tag, namespace ?? undefined) }
  createTextNode(data: string) { return new NativeText(this, data) }
  createComment(data: string) { return new NativeComment(this, data) }
  createDocumentFragment() { return new NativeDocumentFragment(this) }
  createEvent(_kind: string) { return new NativeEvent('') }
  getElementById(id: string): NativeElement | null { return querySelectorAll(this.documentElement, `#${cssEscape(id)}`, true)[0] ?? null }
  querySelector(selector: string): NativeElement | null { return this.documentElement.matches(selector) ? this.documentElement : this.documentElement.querySelector(selector) }
  querySelectorAll(selector: string) { return querySelectorAll(this.documentElement, selector, false, true) }
  getElementsByTagName(tag: string) { return this.querySelectorAll(tag) }
  hasFocus() { return true }
  // Not supported: FoldKit feature-detects these and falls back.
  startViewTransition: undefined
}

/** The parts of `window` FoldKit's runtime and @foldkit/ui use. */
export class NativeWindow extends NativeEventTarget {
  readonly window = this
  readonly self = this
  readonly top = this
  readonly parent = this
  innerWidth = 1024
  innerHeight = 768
  devicePixelRatio = 1
  scrollX = 0
  scrollY = 0
  readonly location = new URL('http://foldkit.native/') as unknown as Location
  readonly history = {
    length: 1, state: null as unknown,
    pushState: () => {}, replaceState: () => {}, back: () => {}, forward: () => {}, go: () => {},
  }
  readonly sessionStorage = memoryStorage()
  readonly localStorage = memoryStorage()
  constructor(readonly document: NativeDocument) {
    super()
    document.defaultView = this
  }
  matchMedia(query: string) {
    return {
      matches: /\(\s*hover\s*:\s*hover\s*\)|\(\s*pointer\s*:\s*fine\s*\)/.test(query), media: query,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
    }
  }
  getComputedStyle(element: NativeElement) {
    return { getPropertyValue: (name: string) => element.inline.get(name) ?? '' } as unknown as CSSStyleDeclaration
  }
  scrollTo() {}
  scroll() {}
  getSelection() { return null }
  requestAnimationFrame(callback: (at: number) => void) {
    return setTimeout(() => callback(performance.now()), 0) as unknown as number
  }
  cancelAnimationFrame(handle: number) { clearTimeout(handle) }
}

const memoryStorage = () => {
  const items = new Map<string, string>()
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, String(value)),
    removeItem: (key: string) => void items.delete(key),
    clear: () => items.clear(),
    key: (index: number) => [...items.keys()][index] ?? null,
    get length() { return items.size },
  }
}

// SELECTORS
//
// Enough of CSS selectors for FoldKit's Dom helpers and @foldkit/ui: type,
// `#id`, `.class`, `[attr]`, `[attr="v"]` (and ^= $= *= ~=), `:not(…)`,
// `:scope`, `:disabled`, `:checked`, `:focus`, descendant and `>` combinators,
// and comma lists.

type Compound = {
  tag?: string
  ids: Array<string>
  classes: Array<string>
  attributes: Array<{ name: string; op?: string; value?: string }>
  not: Array<Selector>
  pseudo: Array<string>
}
type Complex = Array<{ compound: Compound; combinator: ' ' | '>' | '' }>
export type Selector = Array<Complex>

const cache = new Map<string, Selector>()
export const cssEscape = (value: string) => value.replace(/([^\w-])/g, '\\$1')

export const parseSelector = (source: string): Selector => {
  const found = cache.get(source)
  if (found !== undefined) return found
  let at = 0
  const peek = () => source[at] ?? ''
  const ident = () => {
    let out = ''
    while (at < source.length && /[\w\-\\]/.test(peek())) {
      if (peek() === '\\') at++
      out += source[at++]
    }
    return out
  }
  const space = () => {
    while (/\s/.test(peek())) at++
  }
  const compound = (): Compound => {
    const out: Compound = { ids: [], classes: [], attributes: [], not: [], pseudo: [] }
    if (peek() === '*') at++
    else if (/[a-zA-Z]/.test(peek())) out.tag = ident().toLowerCase()
    for (;;) {
      const char = peek()
      if (char === '#') { at++; out.ids.push(ident()) }
      else if (char === '.') { at++; out.classes.push(ident()) }
      else if (char === '[') {
        at++
        space()
        const name = ident().toLowerCase()
        space()
        let op: string | undefined
        let value: string | undefined
        if (peek() !== ']') {
          op = /[~^$*|]/.test(peek()) ? source[at++]! + source[at++]! : source[at++]!
          space()
          const quote = peek()
          if (quote === '"' || quote === "'") {
            at++
            const end = source.indexOf(quote, at)
            value = source.slice(at, end)
            at = end + 1
          } else value = ident()
          space()
        }
        at++ // ]
        out.attributes.push({ name, ...(op === undefined ? {} : { op }), ...(value === undefined ? {} : { value }) })
      } else if (char === ':') {
        at++
        if (peek() === ':') at++
        const name = ident().toLowerCase()
        if (peek() === '(') {
          let depth = 0
          const start = at + 1
          for (; at < source.length; at++) {
            if (source[at] === '(') depth++
            else if (source[at] === ')' && --depth === 0) break
          }
          const inner = source.slice(start, at)
          at++
          if (name === 'not' || name === 'where' || name === 'is') {
            if (name === 'not') out.not.push(parseSelector(inner))
            else out.pseudo.push(`is:${inner}`)
          } else out.pseudo.push(`${name}(${inner})`)
        } else out.pseudo.push(name)
      } else break
    }
    return out
  }
  const list: Selector = []
  let complex: Complex = []
  let combinator: ' ' | '>' | '' = ''
  while (at < source.length) {
    space()
    const char = peek()
    if (char === ',') { at++; list.push(complex); complex = []; combinator = ''; continue }
    if (char === '>') { at++; combinator = '>'; continue }
    if (char === '' ) break
    complex.push({ compound: compound(), combinator })
    const before = at
    space()
    combinator = at > before && peek() !== ',' && peek() !== '>' ? ' ' : ''
  }
  if (complex.length > 0) list.push(complex)
  cache.set(source, list)
  return list
}

const matchAttribute = (element: NativeElement, attribute: Compound['attributes'][number]) => {
  const actual = element.getAttribute(attribute.name)
  if (actual === null) return false
  const { op, value = '' } = attribute
  switch (op) {
    case undefined: return true
    case '=': return actual === value
    case '~=': return actual.split(/\s+/).includes(value)
    case '^=': return value !== '' && actual.startsWith(value)
    case '$=': return value !== '' && actual.endsWith(value)
    case '*=': return value !== '' && actual.includes(value)
    case '|=': return actual === value || actual.startsWith(`${value}-`)
    default: return false
  }
}

const matchCompound = (element: NativeElement, compound: Compound, scope: NativeNode | undefined): boolean => {
  if (compound.tag !== undefined && compound.tag !== element.localName) return false
  for (const id of compound.ids) if (element.getAttribute('id') !== id) return false
  if (compound.classes.length > 0) {
    const own = (element.getAttribute('class') ?? '').split(/\s+/)
    for (const name of compound.classes) if (!own.includes(name)) return false
  }
  for (const attribute of compound.attributes) if (!matchAttribute(element, attribute)) return false
  for (const not of compound.not) if (matches(element, not, scope)) return false
  for (const pseudo of compound.pseudo) {
    if (pseudo === 'scope') { if (element !== scope) return false; continue }
    if (pseudo === 'disabled') { if (!element.hasAttribute('disabled')) return false; continue }
    if (pseudo === 'enabled') { if (element.hasAttribute('disabled')) return false; continue }
    if (pseudo === 'checked') { if (!element.checked && !element.hasAttribute('checked')) return false; continue }
    if (pseudo === 'focus' || pseudo === 'focus-visible') { if (element.ownerDocument.activeElement !== element) return false; continue }
    if (pseudo === 'focus-within') { if (!element.contains(element.ownerDocument.activeElement)) return false; continue }
    if (pseudo === 'first-child') { if (element.parentElement?.firstElementChild !== element) return false; continue }
    if (pseudo === 'last-child') { if (element.parentElement?.lastElementChild !== element) return false; continue }
    if (pseudo.startsWith('is:')) { if (!matches(element, parseSelector(pseudo.slice(3)), scope)) return false; continue }
    return false // Unsupported pseudo-classes never match.
  }
  return true
}

const matchComplex = (element: NativeElement, complex: Complex, index: number, scope: NativeNode | undefined): boolean => {
  const part = complex[index]!
  if (!matchCompound(element, part.compound, scope)) return false
  if (index === 0) return true
  const combinator = part.combinator
  if (combinator === '>') {
    const parent = element.parentElement
    return parent !== null && matchComplex(parent, complex, index - 1, scope)
  }
  for (let at = element.parentElement; at !== null; at = at.parentElement) {
    if (matchComplex(at, complex, index - 1, scope)) return true
  }
  return false
}

export const matches = (element: NativeElement, selector: Selector, scope?: NativeNode): boolean =>
  selector.some(complex => complex.length > 0 && matchComplex(element, complex, complex.length - 1, scope))

const querySelectorAll = (root: NativeElement, source: string, first: boolean, includeRoot = false): Array<NativeElement> => {
  const selector = parseSelector(source)
  const out: Array<NativeElement> = []
  const walk = (element: NativeElement): boolean => {
    for (const child of element.children) {
      if (matches(child, selector, root)) {
        out.push(child)
        if (first) return true
      }
      if (walk(child)) return true
    }
    return false
  }
  if (includeRoot && matches(root, selector, root)) {
    out.push(root)
    if (first) return out
  }
  walk(root)
  return out
}
