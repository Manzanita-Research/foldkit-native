// Runs an example the way FoldKit Native runs it (the app's own start and
// its CSS) and drives it with GPUI's input, for the examples' native.test.ts
// files. Two renderers, one API, picked as `bun run example` picks them
// (`rendererOf`): FoldKit on gpuix, or the mirror with
// FOLDKIT_NATIVE_RENDERER=mirror.
//
// - FoldKit on gpuix (`packages/foldkit-gpuix`, the adapter: no DOM engine).
// - The DOM mirror (happy-dom → GPUI, `src/`): the comparator. CI runs the
//   examples on it too (FOLDKIT_NATIVE_RENDERER=mirror).
//
// And two kinds of GPUI:
//
// - `openHeadless(id)`: GPUI is the fake tree from test/support. Runs
//   anywhere, CI included. Input goes in as the gpuix events GPUI would send,
//   to the element GPUI would hit (the nearest one listening).
// - `openMetal(id)`: GPUI for real, offscreen (gpuix's TestRenderer, Metal on
//   macOS). Layout, hit testing and pixels are GPUI's own. Skip it elsewhere
//   with `describe.skipIf(!METAL)`.
//
// A test about one renderer only says so: `test.skipIf(await rendererFor(id)
// !== 'gpuix')`, with the reason.
//
// Screenshots from `openMetal` go to $FOLDKIT_NATIVE_EVIDENCE (CI uploads that
// folder) or a temp folder, as `<example>-<name>.png` (on the mirror,
// `<example>-mirror-<name>.png`, so a run of each keeps both).

import type { NativeRenderer } from '@gpuix/native/host'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { NativeElement, NativeText } from '../../packages/foldkit-gpuix/src/dom.ts'
import { mountHeadless, openMetal as openGpuixMetal } from '../../packages/foldkit-gpuix/test/support.ts'
import { attachDom } from '../../src/index.ts'
import type { FakeGpui, FakeNode, Shape } from '../../test/support/fake-gpui.ts'
import { mountFake } from '../../test/support/mount.ts'
import { readPng } from '../../test/support/png.ts'
import { type Renderer, loadExample, rendererOf } from './example.ts'

/** Real GPUI offscreen needs pixel read-back: macOS (Metal) today. */
export const METAL = process.platform === 'darwin'

export type { Renderer }
/** What draws an example in the tests: as `bun run example` decides. */
export const rendererFor = async (id: string): Promise<Renderer> => rendererOf((await loadExample(id)).meta)

const evidenceDir = () => {
  const dir = process.env['FOLDKIT_NATIVE_EVIDENCE'] ?? mkdtempSync(join(tmpdir(), 'foldkit-native-evidence-'))
  mkdirSync(dir, { recursive: true })
  return dir
}
const shotName = (id: string, renderer: Renderer) => (renderer === 'mirror' ? `${id}-mirror` : id)

/** The innermost element whose own text is `text` (or whose label,
 *  placeholder or value is), so tests name things the way a person sees them. */
const findElement = (document: Document, text: string): Element => {
  const all = Array.from(document.body.querySelectorAll('*'))
  const labelled = all.find(element =>
    element.getAttribute('aria-label') === text || element.getAttribute('placeholder') === text)
  if (labelled !== undefined) return labelled
  const matches = all.filter(element => element.textContent?.trim() === text)
  const innermost = matches.find(element => !matches.some(other => other !== element && element.contains(other)))
  if (innermost === undefined) throw new Error(`nothing shows "${text}"`)
  return innermost
}

/** Whether GPUI stops a hit at an element with this native style, rather
 *  than letting it through to what's behind (its ancestors included): gpuix's
 *  `should_occlude`. `pointerEvents` decides; unset, a fill or an
 *  absolute/fixed box blocks. */
export const blocks = (style: Record<string, unknown>): boolean => {
  if (style['pointerEvents'] === 'none') return false
  if (style['pointerEvents'] === 'auto') return true
  if (style['position'] === 'absolute' || style['position'] === 'fixed') return true
  const fill = style['background'] ?? style['backgroundColor']
  return fill !== undefined && !/^(transparent|rgba\(.*,\s*0\)|#0000|#00000000)$/.test(String(fill))
}

type Example = Awaited<ReturnType<typeof loadExample>>
type Bounds = { x: number; y: number; width: number; height: number }
/** A gpuix event, without the element it goes to. */
type NativeEvent = Record<string, unknown> & { eventType: string }

export type Headless = {
  example: Example
  /** What draws it. */
  renderer: Renderer
  document: Document
  /** What FoldKit renders into. */
  container: HTMLElement
  /** The app's `localStorage`. */
  localStorage: Storage
  /** The fake GPUI tree. */
  gpui: FakeGpui
  /** Every text GPUI would paint, in tree order. */
  texts: () => Array<string>
  /** The native element showing `text`. */
  native: (text: string) => FakeNode
  /** The native element drawing a DOM node. */
  nativeOf: (node: Node | Element) => FakeNode
  /** The gpuix id of the native element drawing a DOM node. */
  idOf: (node: Node | Element) => number
  /** A gpuix event, as GPUI would send it. False if nothing listens. */
  send: (target: Node | Element | number, event: NativeEvent) => boolean
  /** A click on the element showing `text` (or on `element`). */
  click: (at: string | Element) => Promise<void>
  /** Types into a text field (found by label, placeholder or value), as
   *  gpuix's input reports it: the whole new value. */
  type: (field: string, value: string) => Promise<void>
  /** A key press (gpuix's name: "enter", "down", " "), at the element showing
   *  `text`, or wherever focus is. */
  key: (key: string, text?: string) => Promise<void>
  /** A window key with modifiers held: "ctrl-z", "cmd-shift-z". */
  shortcut: (keystroke: string) => Promise<void>
  settle: () => Promise<void>
  /** Says GPUI laid out again, after a test gave the fake tree its boxes
   *  (`gpui.setBounds`): the fake doesn't lay out. */
  relayout: () => void
  /** GPUI's tree is what the document says it should be. */
  inSync: () => boolean
  close: () => Promise<void>
}

export type Metal = {
  example: Example
  document: Document
  container: HTMLElement
  localStorage: Storage
  renderer: InstanceType<typeof import('@gpuix/native/testing').TestRenderer>
  /** Where GPUI laid out the element showing `text` (or `element`). */
  bounds: (at: string | Element) => Bounds
  /** Where GPUI laid out a DOM element (for elements with no text to name). */
  boundsOf: (element: Element, name?: string) => Bounds
  /** Text GPUI actually painted this frame. */
  painted: () => Array<string>
  /** A click at the painted centre of the element showing `text` (or of
   *  `element`), through GPUI's own hit test. */
  click: (at: string | Element) => Promise<void>
  /** Keystrokes through GPUI's input pipeline: "a b enter", "cmd-z". */
  keys: (keystrokes: string) => Promise<void>
  /** Saves this frame as `<example>-<name>.png` and returns its pixels. */
  screenshot: (name: string) => { path: string } & ReturnType<typeof readPng>
  settle: () => Promise<void>
  /** One frame, without waiting for the app to go idle (a drag's
   *  requestAnimationFrame loop never does): GPUI draws, and what it got
   *  from the simulated input reaches the app. */
  frame: () => Promise<void>
  close: () => Promise<void>
}

/** How long each sync from the document to GPUI took, and what it sent. */
export type Synced = { syncMs: number; mutations: number }
export type HeadlessOptions = {
  onSynced?: (timings: Synced) => void
  /** Put in `localStorage` before the app starts (what an earlier run saved). */
  storage?: Readonly<Record<string, string>>
}
const seed = (storage: { setItem: (key: string, value: string) => void }, options: HeadlessOptions) => {
  for (const [key, value] of Object.entries(options.storage ?? {})) storage.setItem(key, value)
}

export const openHeadless = async (id: string, options: HeadlessOptions = {}): Promise<Headless> =>
  (await rendererFor(id)) === 'gpuix' ? gpuixHeadless(id, options) : mirrorHeadless(id, options)
export const openMetal = async (id: string, size?: { width: number; height: number }, options: HeadlessOptions = {}): Promise<Metal> =>
  (await rendererFor(id)) === 'gpuix' ? gpuixMetal(id, size, options) : mirrorMetal(id, size, options)

/** The element and its native twin, walking up to the nearest one that
 *  listens for `event`, as GPUI's hit test would reach it: an element on the
 *  way that GPUI lets block hits (see `blocks`) stops it there. */
const hitTarget = (
  gpui: FakeGpui, document: Document, idFor: (element: Element) => number | undefined, at: string | Element, event: string,
) => {
  const name = typeof at === 'string' ? at : at.className || at.tagName
  let element: Element | null = typeof at === 'string' ? findElement(document, at) : at
  while (element !== null) {
    const id = idFor(element)
    if (id !== undefined && gpui.node(id).listeners.has(event)) return id
    // A visually hidden label (sr-only: 1×1) is never where a click lands.
    const style = id === undefined ? undefined : gpui.node(id).style
    if (style !== undefined && blocks(style) && !(Number(style['width']) <= 1 && Number(style['height']) <= 1)) {
      throw new Error(`"${name}": ${element.className || element.tagName} blocks the ${event} in GPUI`)
    }
    element = element.parentElement
  }
  throw new Error(`nothing under "${name}" listens for ${event}`)
}

const parseShortcut = (keystroke: string) => {
  const parts = keystroke.split('-')
  const key = parts.pop()!
  const held = new Set(parts)
  return { key, modifiers: { shift: held.has('shift'), ctrl: held.has('ctrl'), cmd: held.has('cmd'), alt: held.has('alt') } }
}

const textsOf = (gpui: FakeGpui) => {
  const out: Array<string> = []
  const walk = (node: Shape) => {
    if (node.type === 'text' && node.text !== undefined && node.text !== '') out.push(node.text)
    for (const child of node.children ?? []) walk(child)
  }
  const root = gpui.tree()
  if (root !== undefined) walk(root)
  return out
}

// FOLDKIT ON GPUIX

/** What GPUI holds for the native document, checked from both sides: every
 *  node the document has drawn is alive in GPUI with its text, each
 *  element's children keep the document's order (a box drawn under its
 *  containing block instead is still somewhere GPUI can reach), and GPUI
 *  holds nothing the document doesn't, but the host's press sentinel. */
const adapterInSync = (gpui: FakeGpui, body: NativeElement) => {
  const drawn = new Set<number>()
  const visit = (node: NativeElement | NativeText): boolean => {
    if (node.nativeId === 0) return node instanceof NativeText && node.data === ''
    drawn.add(node.nativeId)
    const native = gpui.node(node.nativeId)
    if (node instanceof NativeText) {
      const transform = node.parentElement === null ? '' : getComputedStyle(node.parentElement as never).getPropertyValue('text-transform')
      const text = transform === 'uppercase' ? node.data.toUpperCase() : transform === 'lowercase' ? node.data.toLowerCase() : node.data
      return native.type === 'text' && native.text === text
    }
    if (native.type !== 'div' && native.type !== 'anchored') return true
    const children = node.childNodes.filter(child => child instanceof NativeElement || child instanceof NativeText) as Array<NativeElement | NativeText>
    if (!children.every(visit)) return false
    const here = children.map(child => child.nativeId).filter(id => native.children.includes(id))
    const order = here.map(id => native.children.indexOf(id))
    return order.every((at, i) => i === 0 || at > order[i - 1]!)
  }
  if (!visit(body)) return false
  const reachable = new Set<number>()
  const walk = (id: number) => {
    reachable.add(id)
    for (const child of gpui.node(id).children) walk(child)
  }
  walk(body.nativeId)
  // The host's own: a zero-size box under the body that hears every press.
  const sentinels = gpui.node(body.nativeId).children.filter(id => !drawn.has(id) && gpui.node(id).style['width'] === 0 && gpui.node(id).style['height'] === 0)
  return [...drawn].every(id => reachable.has(id)) && reachable.size === drawn.size + sentinels.length && sentinels.length <= 1 &&
    gpui.retainedCount() === gpui.reachableCount()
}

const gpuixHeadless = async (id: string, options: HeadlessOptions): Promise<Headless> => {
  const example = await loadExample(id)
  const app = mountHeadless({
    css: example.css, viewport: { width: example.meta.width, height: example.meta.height },
    ...(options.onSynced === undefined ? {} : { onSynced: options.onSynced }),
  })
  seed(app.window.localStorage, options)
  example.start(app.container)
  await app.settle()
  await app.settle()
  const { gpui, host } = app
  const document = app.document as unknown as Document
  const idFor = (node: Node | Element) => {
    const id = (node as unknown as NativeElement).nativeId
    return id === 0 ? undefined : id
  }
  const idOf = (node: Node | Element) => {
    const id = idFor(node)
    if (id === undefined) throw new Error(`not drawn: ${node.nodeName}`)
    return id
  }
  const send = (target: Node | Element | number, event: NativeEvent) =>
    host.dispatch({ ...event, elementId: typeof target === 'number' ? target : idOf(target) } as never) as unknown as boolean
  return {
    example,
    renderer: 'gpuix',
    document,
    container: app.container,
    localStorage: app.window.localStorage as unknown as Storage,
    gpui,
    texts: () => textsOf(gpui),
    native: text => gpui.node(idOf(findElement(document, text))),
    nativeOf: node => gpui.node(idOf(node)),
    idOf,
    send,
    click: async at => {
      send(hitTarget(gpui, document, idFor, at, 'click'), { eventType: 'click', x: 1, y: 1, button: 0, clickCount: 1 })
      await app.settle()
    },
    type: async (field, value) => {
      send(hitTarget(gpui, document, idFor, field, 'change'), { eventType: 'change', value })
      await app.settle()
    },
    // GPUI sends keys as the window's: to whatever has focus, so the key
    // goes to the nearest focusable element showing `text`, focused first.
    key: async (key, text) => {
      if (text !== undefined) {
        let at: NativeElement | null = findElement(document, text) as unknown as NativeElement
        while (at !== null && at.tabIndex < 0) at = at.parentElement
        if (at === null) throw new Error(`nothing focusable shows "${text}"`)
        at.focus()
      }
      await app.press(key)
    },
    shortcut: async keystroke => {
      const { key, modifiers } = parseShortcut(keystroke)
      await app.press(key, modifiers)
    },
    settle: app.settle,
    relayout: () => host.relayout(),
    inSync: () => adapterInSync(gpui, app.document.body),
    close: async () => app.close(),
  }
}

const gpuixMetal = async (id: string, size: { width: number; height: number } | undefined, options: HeadlessOptions): Promise<Metal> => {
  const example = await loadExample(id)
  const width = size?.width ?? example.meta.width
  const height = size?.height ?? example.meta.height
  const app = await openGpuixMetal(shotName(id, 'gpuix'), { width, height }, {
    css: example.css, ...(options.onSynced === undefined ? {} : { onSynced: options.onSynced }),
  })
  seed(app.window.localStorage, options)
  example.start(app.container)
  await app.settle()
  await app.settle()
  const document = app.document as unknown as Document
  const boundsOf = (element: Element, name = element.tagName) => {
    const found = app.renderer.getElementBounds((element as unknown as NativeElement).nativeId)
    if (found === null) throw new Error(`"${name}" isn't laid out`)
    return found
  }
  const bounds = (at: string | Element) => (typeof at === 'string' ? boundsOf(findElement(document, at), at) : boundsOf(at))
  return {
    example,
    document,
    container: app.container,
    localStorage: app.window.localStorage as unknown as Storage,
    renderer: app.renderer,
    bounds,
    boundsOf,
    painted: () => app.renderer.getPaintedText(),
    click: async at => {
      await app.settle()
      const box = bounds(at)
      app.renderer.nativeSimulateClick(box.x + box.width / 2, box.y + box.height / 2)
      await app.settle()
    },
    keys: app.keys,
    screenshot: name => {
      const path = app.screenshot(name)
      return { path, ...readPng(path) }
    },
    settle: app.settle,
    frame: app.settle,
    close: async () => app.close(),
  }
}

// THE DOM MIRROR

/** On the mirror, whatever the example asks for (the comparator). */
export const mirrorHeadless = async (id: string, options: HeadlessOptions = {}): Promise<Headless> => {
  const example = await loadExample(id)
  const mounted = mountFake({
    css: example.css, viewport: { width: example.meta.width, height: example.meta.height },
    ...(options.onSynced === undefined ? {} : { onSynced: options.onSynced }),
  })
  seed(mounted.window.localStorage, options)
  example.start(mounted.container)
  await mounted.settle()
  const { gpui, document } = mounted
  const idFor = (element: Element) => mounted.mirror.idFor(element as unknown as Node)
  const send = (target: Node | Element | number, event: NativeEvent) =>
    mounted.send(typeof target === 'number' ? target : (target as Node), event as never)
  return {
    example,
    renderer: 'mirror',
    document,
    container: mounted.container,
    localStorage: mounted.window.localStorage as unknown as Storage,
    gpui,
    texts: () => textsOf(gpui),
    native: text => mounted.nativeOf(findElement(document, text) as unknown as Node),
    nativeOf: node => mounted.nativeOf(node as Node),
    idOf: node => mounted.idOf(node as Node),
    send,
    click: async at => {
      send(hitTarget(gpui, document, idFor, at, 'click'), { eventType: 'click', x: 1, y: 1, button: 0, clickCount: 1 })
      await mounted.settle()
    },
    type: async (field, value) => {
      send(hitTarget(gpui, document, idFor, field, 'change'), { eventType: 'change', value })
      await mounted.settle()
    },
    key: async (key, text) => {
      if (text === undefined) mounted.mirror.windowKey({ eventType: 'keyDown', key } as never)
      else send(hitTarget(gpui, document, idFor, text, 'keyDown'), { eventType: 'keyDown', key })
      await mounted.settle()
    },
    shortcut: async keystroke => {
      const { key, modifiers } = parseShortcut(keystroke)
      mounted.mirror.windowKey({ elementId: 0, eventType: 'keyDown', key, modifiers } as never)
      await mounted.settle()
    },
    settle: mounted.settle,
    relayout: () => mounted.mirror.layoutChanged(),
    inSync: mounted.inSync,
    close: mounted.close,
  }
}

export const mirrorMetal = async (id: string, size?: { width: number; height: number }, options: HeadlessOptions = {}): Promise<Metal> => {
  const example = await loadExample(id)
  const { TestRenderer } = await import('@gpuix/native/testing')
  const width = size?.width ?? example.meta.width
  const height = size?.height ?? example.meta.height
  const renderer = new TestRenderer({ width, height })
  const dom = attachDom(renderer as unknown as NativeRenderer, {
    css: example.css, viewport: { width, height }, ...(options.onSynced === undefined ? {} : { onSynced: options.onSynced }),
  })
  seed(dom.window.localStorage, options)
  example.start(dom.container)
  const document = dom.window.document as unknown as Document
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await dom.window.happyDOM.waitUntilComplete()
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    renderer.flush()
    // Heights from laid-out widths (aspect-ratio), as the live window does each tick.
    if (dom.mirror.afterLayout()) renderer.flush()
  }
  await settle()
  const out = evidenceDir()

  const boundsOf = (element: Element, name = element.tagName) => {
    const nativeId = dom.mirror.idFor(element as unknown as Node)
    const found = nativeId === undefined ? null : renderer.getElementBounds(nativeId)
    if (found === null) throw new Error(`"${name}" isn't laid out`)
    return found
  }
  const bounds = (at: string | Element) => (typeof at === 'string' ? boundsOf(findElement(document, at), at) : boundsOf(at))

  return {
    example,
    document,
    container: dom.container,
    localStorage: dom.window.localStorage as unknown as Storage,
    renderer,
    bounds,
    boundsOf,
    painted: () => renderer.getPaintedText(),
    click: async at => {
      const box = bounds(at)
      renderer.nativeSimulateClick(box.x + box.width / 2, box.y + box.height / 2)
      await settle()
    },
    keys: async keystrokes => {
      renderer.simulateKeystrokes(keystrokes)
      await settle()
    },
    screenshot: name => {
      const path = join(out, `${shotName(id, 'mirror')}-${name}.png`)
      renderer.captureScreenshot(path)
      return { path, ...readPng(path) }
    },
    settle,
    frame: async () => renderer.flush(),
    close: async () => {
      dom.detach()
      await dom.window.happyDOM.abort()
      dom.window.close()
    },
  }
}
