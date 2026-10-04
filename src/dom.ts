// DOM
//
// FoldKit renders into a DOM. Off the web there is none, so FoldKit Native
// gives it one: a happy-dom window (the same DOM FoldKit's own tests use),
// installed as the globals FoldKit and snabbdom expect. The DOM is the model of
// the screen; the mirror (mirror.ts) copies it into GPUI.

import { Window } from 'happy-dom'

const GLOBALS = [
  'Node', 'Element', 'HTMLElement', 'SVGElement', 'Text', 'Comment',
  'DocumentFragment', 'Event', 'CustomEvent', 'MouseEvent', 'PointerEvent', 'KeyboardEvent',
  'FocusEvent', 'InputEvent', 'WheelEvent', 'MutationObserver', 'requestAnimationFrame',
  'cancelAnimationFrame', 'getComputedStyle', 'matchMedia', 'location', 'history',
  'sessionStorage', 'localStorage', 'navigator', 'customElements', 'HTMLInputElement',
  'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLFormElement', 'HTMLButtonElement',
  'DOMParser', 'CSSStyleSheet', 'ShadowRoot', 'EventTarget', 'Document',
] as const

export type NativeWindow = Window

let current: Window | undefined

/** The global `document`: always the newest window's. In a browser `document`
 *  exists before any module runs, and FoldKit apps name it at module scope
 *  (snake's keyboard Subscription is `target: document`). So it exists as soon
 *  as FoldKit Native is imported, and it stays the same object when a process
 *  opens window after window (the tests do), following the newest one.
 *
 *  Methods run on the real document (`this` is bound on get), so happy-dom and
 *  the mirror's listener tracking see the real node, and a listener lands on
 *  the document that is newest when it's added. One difference from a browser:
 *  identity. `node.ownerDocument === document` is false here, because
 *  `document` is the forwarder. FoldKit 0.165 never compares against
 *  `document` itself, only its `head`, `body` and `documentElement`, which are
 *  the real nodes. */
const liveDocument: Document = new Proxy({} as Document, {
  get: (_, key) => {
    if (current === undefined) throw new Error(`FoldKit Native: no DOM yet (document.${String(key)}); call installDom or attachDom first`)
    const document = current.document
    const value = Reflect.get(document, key, document)
    return typeof value === 'function' && key !== 'constructor' ? value.bind(document) : value
  },
  set: (_, key, value) => current !== undefined && Reflect.set(current.document, key, value),
  has: (_, key) => current !== undefined && key in current.document,
  getPrototypeOf: () => current === undefined ? Object.prototype : Object.getPrototypeOf(current.document),
})

const globals = globalThis as Record<string, unknown>
globals['document'] ??= liveDocument

/** Creates the DOM and makes it global. Call before FoldKit renders. */
export const installDom = (url = 'http://foldkit.native/'): Window => {
  const window = new Window({ url, settings: { disableCSSFileLoading: true, disableJavaScriptFileLoading: true } })
  current = window
  for (const name of GLOBALS) {
    const value = (window as unknown as Record<string, unknown>)[name]
    if (value !== undefined) globals[name] = typeof value === 'function' && /^[a-z]/.test(name) ? (value as Function).bind(window) : value
  }
  globals['document'] = liveDocument
  globals['window'] = window
  return window
}
