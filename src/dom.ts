// DOM
//
// FoldKit renders into a DOM. Off the web there is none, so FoldKit Native
// gives it one: a happy-dom window (the same DOM FoldKit's own tests use),
// installed as the globals FoldKit and snabbdom expect. The DOM is the model of
// the screen; the mirror (mirror.ts) copies it into GPUI.

import { Window } from 'happy-dom'

const GLOBALS = [
  'document', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'Text', 'Comment',
  'DocumentFragment', 'Event', 'CustomEvent', 'MouseEvent', 'PointerEvent', 'KeyboardEvent',
  'FocusEvent', 'InputEvent', 'WheelEvent', 'MutationObserver', 'requestAnimationFrame',
  'cancelAnimationFrame', 'getComputedStyle', 'matchMedia', 'location', 'history',
  'sessionStorage', 'localStorage', 'navigator', 'customElements', 'HTMLInputElement',
  'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLFormElement', 'HTMLButtonElement',
  'DOMParser', 'CSSStyleSheet', 'ShadowRoot', 'EventTarget',
] as const

export type NativeWindow = Window

/** Creates the DOM and makes it global. Call before FoldKit renders. */
export const installDom = (url = 'http://foldkit.native/'): Window => {
  const window = new Window({ url, settings: { disableCSSFileLoading: true, disableJavaScriptFileLoading: true } })
  const target = globalThis as Record<string, unknown>
  for (const name of GLOBALS) {
    const value = (window as unknown as Record<string, unknown>)[name]
    if (value !== undefined) target[name] = typeof value === 'function' && /^[a-z]/.test(name) ? (value as Function).bind(window) : value
  }
  target['window'] = window
  return window
}
