// Mounts FoldKit Native's real DOM ↔ GPUI wiring (`attachDom`) on the fake
// GPUI tree, and runs FoldKit apps in it. Native events go in the way gpuix
// delivers them: through its renderer state's dispatch, by element id.

import type { EventPayload } from '@gpuix/native'
import { createRendererState } from '@gpuix/native/host'
import type { Schema } from 'effect'

import { type AttachOptions, attachDom } from '../../src/index.ts'
import { type Shape, createFakeGpui } from './fake-gpui.ts'

/** What the native tree should be for a DOM subtree, by the mirror's rules:
 *  elements become `div` (or `input`/`textarea`/`img`), non-empty text becomes
 *  `text` (upper- or lower-cased for `text-transform`, which GPUI lacks), and
 *  `<style>`, `<script>`, comments and empty text are skipped. */
export const expectedShape = (node: Node): Shape | undefined => {
  if (node.nodeType === 3) {
    const text = node.textContent ?? ''
    if (text === '') return undefined
    const parent = node.parentElement
    const transform = parent === null ? '' : parent.ownerDocument.defaultView!.getComputedStyle(parent).getPropertyValue('text-transform')
    return { type: 'text', text: transform === 'uppercase' ? text.toUpperCase() : transform === 'lowercase' ? text.toLowerCase() : text }
  }
  if (node.nodeType !== 1) return undefined
  const tag = (node as Element).tagName.toLowerCase()
  if (['style', 'script', 'head', 'template'].includes(tag)) return undefined
  if (tag === 'input' || tag === 'textarea' || tag === 'img') return { type: tag }
  const children = Array.from(node.childNodes).map(expectedShape).filter(child => child !== undefined)
  return { type: 'div', ...(children.length === 0 ? {} : { children }) }
}

export type Mounted = ReturnType<typeof mountFake>

export const mountFake = (options: AttachOptions = {}) => {
  const gpui = createFakeGpui()
  const dom = attachDom(gpui.renderer, options)
  const { window, mirror } = dom
  const state = createRendererState(gpui.renderer)
  const document = window.document as unknown as Document

  const idOf = (node: Node) => {
    const id = mirror.idFor(node)
    if (id === undefined) throw new Error(`not mirrored: ${node.nodeName}`)
    return id
  }

  return {
    ...dom,
    gpui,
    document,
    idOf,
    /** The native element for a DOM node. */
    nativeOf: (node: Node) => gpui.node(idOf(node)),
    /** A gpuix event, as GPUI would send it. False if nothing listens. */
    send: (target: Node | number, event: Omit<EventPayload, 'elementId'>) =>
      state.dispatch({ ...event, elementId: typeof target === 'number' ? target : idOf(target) } as EventPayload),
    /** The whole native tree equals what the DOM says it should be. */
    inSync: () => gpui.tree() === undefined ? false : JSON.stringify(gpui.tree()) === JSON.stringify(expectedShape(document.body)),
    /** Lets FoldKit render and the mirror's MutationObserver deliver. */
    settle: async () => {
      for (let i = 0; i < 3; i++) {
        await window.happyDOM.waitUntilComplete()
        await new Promise(resolve => setTimeout(resolve, 0))
      }
    },
    close: async () => {
      dom.detach()
      await window.happyDOM.abort()
      window.close()
    },
  }
}

/** Runs a FoldKit app in a mount and remembers the latest model it rendered. */
export const runApp = async <M, Msg>(
  mounted: Mounted,
  app: {
    Model: Schema.Codec<M, any>
    init: () => { model: M }
    update: (model: M, message: Msg) => { model: M; commands?: ReadonlyArray<unknown> }
    view: (model: M, h: any) => unknown
  },
) => {
  const { Runtime } = await import('foldkit')
  const seen: { model: M | undefined } = { model: undefined }
  Runtime.run(Runtime.makeElement({
    Model: app.Model,
    init: app.init,
    update: app.update,
    view: (model: M, h: any) => {
      seen.model = model
      return app.view(model, h)
    },
    container: mounted.container,
  } as never))
  await mounted.settle()
  return { model: () => seen.model! }
}
