// FoldKit on gpuix, headless: the real adapter on the repo's fake GPUI tree
// (test/support/fake-gpui.ts), plus GPUI's keyboard focus as gpuix 0.10
// exposes it. Tab stops are elements with a `tabIndex` prop of 0 or more, in
// tree order (GPUI sorts by tab index, then paint order); the `*Within`
// variants wrap inside a subtree. The Metal tests check the same things
// against real GPUI on macOS.

import type { EventPayload } from '@gpuix/native'
import type { NativeRenderer } from '@gpuix/native/host'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type FakeGpui, createFakeGpui } from '../../../test/support/fake-gpui.ts'
import { readPng } from '../../../test/support/png.ts'
import { type AttachOptions, NativeElement, attachGpuix } from '../src/index.ts'

export const createFocusableFake = (size = { width: 1024, height: 768 }) => {
  const gpui = createFakeGpui()
  let focused: number | null = null
  let windowSize = size
  const scrolledIntoView: Array<number> = []
  const order = (within?: number): Array<number> => {
    const out: Array<{ id: number; tab: number; at: number }> = []
    const walk = (id: number) => {
      const node = gpui.node(id)
      const tab = node.props['tabIndex']
      if (typeof tab === 'number' && tab >= 0) out.push({ id, tab, at: out.length })
      for (const child of node.children) walk(child)
    }
    const root = within ?? rootId()
    if (root !== undefined) walk(root)
    return out.sort((a, b) => a.tab - b.tab || a.at - b.at).map(stop => stop.id)
  }
  const rootId = () => {
    for (const batch of gpui.batches) for (const op of batch) if (op[0] === 'setRoot') return op[1] as number
    return undefined
  }
  const step = (delta: number, within?: number) => {
    const stops = order(within)
    if (stops.length === 0) return
    const index = focused === null ? -1 : stops.indexOf(focused)
    const next = index === -1 ? (delta > 0 ? 0 : stops.length - 1) : (index + delta + stops.length) % stops.length
    focused = stops[next]!
  }
  const renderer: NativeRenderer = {
    ...gpui.renderer,
    focusElement: id => {
      focused = id
    },
    focusNext: () => step(1),
    focusPrevious: () => step(-1),
    focusNextWithin: id => step(1, id),
    focusPreviousWithin: id => step(-1, id),
    getFocusedElementId: () => focused,
    blur: () => {
      focused = null
    },
    scrollIntoView: id => {
      scrolledIntoView.push(id)
    },
    getWindowSize: () => windowSize,
  }
  return {
    gpui, renderer, scrolledIntoView, tabOrder: () => order(),
    /** The person resizes the window; GPUI reports it from the next frame. */
    resize: (width: number, height: number) => {
      windowSize = { width, height }
    },
  }
}

export type Fake = FakeGpui & { tabOrder: () => Array<number>; scrolledIntoView: Array<number> }

/** Mounts FoldKit on gpuix over the fake, for one test. */
export const mountHeadless = (options: AttachOptions = {}) => {
  const fake = createFocusableFake(options.viewport)
  const attached = attachGpuix(fake.renderer, options)
  const { document, host } = attached
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      await new Promise(resolve => setTimeout(resolve, 0))
      host.frame()
      host.flush()
      // The fake "draws" each batch as it's applied.
      host.drawn()
    }
  }
  /** Where the element showing `text` (its label, placeholder, or own text) is. */
  const find = (text: string) => {
    const all = document.querySelectorAll('*')
    const labelled = all.find(element => element.getAttribute('aria-label') === text || element.getAttribute('placeholder') === text)
    if (labelled !== undefined) return labelled
    const matches = all.filter(element => element.textContent.trim() === text)
    const innermost = matches.find(element => !matches.some(other => other !== element && element.contains(other)))
    if (innermost === undefined) throw new Error(`nothing shows "${text}"`)
    // A label stands for its control, as a person reads it.
    const control = innermost.localName === 'label' ? innermost.getAttribute('for') : null
    return (control === null ? null : document.getElementById(control)) ?? innermost
  }
  /** The nearest element (from the one showing `text` up) GPUI would hit for `native`. */
  const target = (text: string, native: string) => {
    for (let at: ReturnType<typeof find> | null = find(text); at !== null; at = at.parentElement) {
      if (at.nativeId !== 0 && fake.gpui.node(at.nativeId).listeners.has(native)) return at.nativeId
    }
    throw new Error(`nothing under "${text}" listens for ${native}`)
  }
  const send = (event: Omit<EventPayload, 'elementId'> & { elementId: number }) => host.dispatch(event as EventPayload)
  return {
    ...attached,
    gpui: fake.gpui,
    fake,
    settle,
    find,
    native: (text: string) => fake.gpui.node(find(text).nativeId),
    click: async (text: string) => {
      send({ eventType: 'click', elementId: target(text, 'click'), x: 1, y: 1, button: 0, clickCount: 1 })
      await settle()
    },
    /** Types into a field, as gpuix's input reports it: the whole new value. */
    type: async (field: string, value: string) => {
      send({ eventType: 'change', elementId: target(field, 'change'), value } as never)
      await settle()
    },
    /** A key, as GPUI reports it to the window: "tab", "down", "space"… */
    press: async (key: string, modifiers: { shift?: boolean; ctrl?: boolean; cmd?: boolean; alt?: boolean } = {}) => {
      const binding = {
        eventType: 'windowKeyDown', key,
        modifiers: { shift: modifiers.shift ?? false, ctrl: modifiers.ctrl ?? false, cmd: modifiers.cmd ?? false, alt: modifiers.alt ?? false },
      }
      send({ ...binding, elementId: 1 } as never)
      send({ ...binding, eventType: 'windowKeyUp', elementId: 1 } as never)
      await settle()
    },
    /** The element GPUI has focused. */
    gpuiFocus: (): NativeElement | null => {
      const id = fake.renderer.getFocusedElementId?.()
      const node = id === null || id === undefined ? undefined : attached.host.nodeFor(id)
      return node instanceof NativeElement ? node : null
    },
    /** The element behind a gpuix id. */
    elementFor: (id: number): NativeElement | undefined => {
      const node = attached.host.nodeFor(id)
      return node instanceof NativeElement ? node : undefined
    },
    /** Every text GPUI would paint, in tree order. */
    texts: (): Array<string> => {
      const out: Array<string> = []
      const walk = (id: number) => {
        const node = fake.gpui.node(id)
        if (node.type === 'text' && node.text !== undefined && node.text !== '') out.push(node.text)
        for (const child of node.children) walk(child)
      }
      walk(document.body.nativeId)
      return out
    },
    close: () => attached.detach(),
  }
}

export type Headless = ReturnType<typeof mountHeadless>

// REAL GPUI, OFFSCREEN (macOS: gpuix's TestRenderer draws with Metal)


export const METAL = process.platform === 'darwin'

const evidenceDir = () => {
  const dir = process.env['FOLDKIT_NATIVE_EVIDENCE'] ?? mkdtempSync(join(tmpdir(), 'foldkit-gpuix-evidence-'))
  mkdirSync(dir, { recursive: true })
  return dir
}

/** FoldKit on gpuix on real GPUI: layout, hit testing, focus and pixels are
 *  GPUI's own. `name` prefixes screenshots (`<name>-<step>.png`). */
export const openMetal = async (name: string, size: { width: number; height: number }, options: AttachOptions = {}) => {
  const { TestRenderer } = await import('@gpuix/native/testing')
  const renderer = new TestRenderer(size)
  const attached = attachGpuix(renderer as unknown as NativeRenderer, { viewport: size, ...options })
  const { document, host } = attached
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      await new Promise(resolve => setTimeout(resolve, 0))
      host.frame()
      host.flush()
      renderer.flush()
      host.drawn()
      renderer.dispatchNativeEvents()
    }
  }
  const out = evidenceDir()
  const bounds = (element: { nativeId: number }) => {
    const found = renderer.getElementBounds(element.nativeId)
    if (found === null) throw new Error('not laid out')
    return found
  }
  return {
    ...attached,
    renderer,
    settle,
    bounds,
    /** A click at the element's painted centre, through GPUI's hit test. */
    click: async (element: { nativeId: number }) => {
      await settle()
      const box = bounds(element)
      renderer.nativeSimulateClick(box.x + box.width / 2, box.y + box.height / 2)
      await settle()
    },
    /** Keystrokes through GPUI's input pipeline, to whatever GPUI has focused.
     *  GPUI's simulateKeystrokes sends key-down only (text, arrows, Tab). */
    keys: async (keystrokes: string) => {
      await settle()
      renderer.simulateKeystrokes(keystrokes)
      await settle()
    },
    /** One key, down and then up, as a real keyboard sends it (a button
     *  activates on Space's key-up, as in a browser). */
    press: async (key: string) => {
      // gpuix's wrapper keeps the native test renderer private; its own
      // single-key helpers focus an element first, which this must not.
      const native = (renderer as unknown as { native: { simulateKeyDown: (key: string) => void; simulateKeyUp: (key: string) => void } }).native
      await settle()
      native.simulateKeyDown(key)
      renderer.dispatchNativeEvents()
      await settle()
      native.simulateKeyUp(key)
      renderer.dispatchNativeEvents()
      await settle()
    },
    gpuiFocus: (): NativeElement | null => {
      const id = renderer.getFocusedElementId()
      const node = id === null ? undefined : host.nodeFor(id)
      return node instanceof NativeElement ? node : null
    },
    painted: () => renderer.getPaintedText(),
    screenshot: (step: string) => {
      const path = join(out, `${name}-${step}.png`)
      renderer.captureScreenshot(path)
      return path
    },
    /** A screenshot's pixels, read at window coordinates (the image may be
     *  at the display's scale). */
    pixels: (step: string) => {
      const path = join(out, `${name}-${step}.png`)
      renderer.captureScreenshot(path)
      const image = readPng(path)
      const scale = image.width / size.width
      return { path, at: (x: number, y: number) => image.pixel(Math.round(x * scale), Math.round(y * scale)) }
    },
    close: () => attached.detach(),
    document,
  }
}
