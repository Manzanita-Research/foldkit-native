// Runs an example the way FoldKit Native runs it (the app's own start, its
// CSS, the real mirror) and drives it with GPUI's input, for the examples'
// native.test.ts files. Two modes, one API:
//
// - `openHeadless(id)`: GPUI is the fake tree from test/support. Runs
//   anywhere, CI included. Input goes in as the gpuix events GPUI would send,
//   to the element GPUI would hit (the nearest one listening).
// - `openMetal(id)`: GPUI for real, offscreen (gpuix's TestRenderer, Metal on
//   macOS). Layout, hit testing and pixels are GPUI's own. Skip it elsewhere
//   with `describe.skipIf(!METAL)`.
//
// Screenshots from `openMetal` go to $FOLDKIT_NATIVE_EVIDENCE (CI uploads that
// folder) or a temp folder, as `<example>-<name>.png`.

import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { attachDom } from '../../src/index.ts'
import type { Shape } from '../../test/support/fake-gpui.ts'
import { mountFake } from '../../test/support/mount.ts'
import { readPng } from '../../test/support/png.ts'
import { loadExample } from './example.ts'

/** Real GPUI offscreen needs pixel read-back: macOS (Metal) today. */
export const METAL = process.platform === 'darwin'

const evidenceDir = () => {
  const dir = process.env['FOLDKIT_NATIVE_EVIDENCE'] ?? mkdtempSync(join(tmpdir(), 'foldkit-native-evidence-'))
  mkdirSync(dir, { recursive: true })
  return dir
}

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

export type Headless = Awaited<ReturnType<typeof openHeadless>>

export const openHeadless = async (id: string) => {
  const example = await loadExample(id)
  const mounted = mountFake({ css: example.css, viewport: { width: example.meta.width, height: example.meta.height } })
  example.start(mounted.container)
  await mounted.settle()
  const { gpui, document } = mounted

  /** The element and its native twin, walking up to the nearest one that
   *  listens for `event`, as GPUI's hit test would reach it. */
  const target = (text: string, event: string) => {
    let element: Element | null = findElement(document, text)
    while (element !== null) {
      const id = mounted.mirror.idFor(element as unknown as Node)
      if (id !== undefined && gpui.node(id).listeners.has(event)) return id
      element = element.parentElement
    }
    throw new Error(`nothing under "${text}" listens for ${event}`)
  }

  return {
    example,
    mounted,
    document,
    /** Every text GPUI would paint, in tree order. */
    texts: (): Array<string> => {
      const out: Array<string> = []
      const walk = (node: Shape) => {
        if (node.type === 'text' && node.text !== undefined) out.push(node.text)
        for (const child of node.children ?? []) walk(child)
      }
      const root = gpui.tree()
      if (root !== undefined) walk(root)
      return out
    },
    /** The native element showing `text`. */
    native: (text: string) => mounted.nativeOf(findElement(document, text) as unknown as Node),
    click: async (text: string) => {
      mounted.send(target(text, 'click'), { eventType: 'click', x: 1, y: 1, button: 0, clickCount: 1 })
      await mounted.settle()
    },
    /** Types into a text field (found by label, placeholder or value), as
     *  gpuix's input reports it: the whole new value. */
    type: async (field: string, value: string) => {
      mounted.send(target(field, 'change'), { eventType: 'change', value } as never)
      await mounted.settle()
    },
    /** A key press on the element showing `text`, or the window. */
    key: async (key: string, text?: string) => {
      if (text === undefined) mounted.mirror.windowKey({ eventType: 'keyDown', key } as never)
      else mounted.send(target(text, 'keyDown'), { eventType: 'keyDown', key })
      await mounted.settle()
    },
    settle: mounted.settle,
    inSync: mounted.inSync,
    close: mounted.close,
  }
}

export type Metal = Awaited<ReturnType<typeof openMetal>>

export const openMetal = async (id: string, size?: { width: number; height: number }) => {
  const example = await loadExample(id)
  const { TestRenderer } = await import('@gpuix/native/testing')
  const width = size?.width ?? example.meta.width
  const height = size?.height ?? example.meta.height
  const renderer = new TestRenderer({ width, height })
  const dom = attachDom(renderer, { css: example.css, viewport: { width, height } })
  example.start(dom.container)
  const document = dom.window.document as unknown as Document
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await dom.window.happyDOM.waitUntilComplete()
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    renderer.flush()
  }
  await settle()
  const out = evidenceDir()

  /** Where GPUI laid out the element showing `text`. */
  const bounds = (text: string) => {
    const nativeId = dom.mirror.idFor(findElement(document, text) as unknown as Node)
    const found = nativeId === undefined ? null : renderer.getElementBounds(nativeId)
    if (found === null) throw new Error(`"${text}" isn't laid out`)
    return found
  }

  return {
    example,
    renderer,
    document,
    window: dom.window,
    bounds,
    /** Text GPUI actually painted this frame. */
    painted: () => renderer.getPaintedText(),
    /** A click at the element's painted centre, through GPUI's own hit test. */
    click: async (text: string) => {
      const box = bounds(text)
      renderer.nativeSimulateClick(box.x + box.width / 2, box.y + box.height / 2)
      await settle()
    },
    /** Keystrokes through GPUI's input pipeline: "a b enter", "cmd-z". */
    keys: async (keystrokes: string) => {
      renderer.simulateKeystrokes(keystrokes)
      await settle()
    },
    /** Saves this frame as `<example>-<name>.png` and returns its pixels. */
    screenshot: (name: string) => {
      const path = join(out, `${id}-${name}.png`)
      renderer.captureScreenshot(path)
      return { path, ...readPng(path) }
    },
    settle,
    close: async () => {
      dom.detach()
      await dom.window.happyDOM.abort()
      dom.window.close()
    },
  }
}
