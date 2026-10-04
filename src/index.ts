// FOLDKIT NATIVE
//
// Run an ordinary FoldKit app in a native GPUI window, in-process:
//
//   import { mountNative } from 'foldkit-native'
//   const { container } = mountNative({ title: 'My app', css })
//   // …then FoldKit exactly as on the web:
//   Runtime.run(Runtime.makeElement({ Model, init, update, view, container }))
//
// FoldKit renders into a DOM (happy-dom); the mirror copies that DOM into
// gpuix's retained GPUI tree and turns clicks and keys back into DOM events.

import type { WindowOptions } from '@gpuix/native'
import {
  type NativeRenderer,
  createMutationQueue,
  createRendererState,
  unregisterEventHandlers,
} from '@gpuix/native/host'
import { createNativeRenderer, startFrameLoop } from '@gpuix/native/runtime'

import { installDom } from './dom.ts'
import { type MirrorTimings, createMirror } from './mirror.ts'
import { primitivesCss } from './primitives.ts'
import { nativeDefaultsCss } from './style.ts'
import { type Tokens, setTokens } from './theme.ts'

export type { MirrorTimings }
export * as Primitives from './primitives.ts'
export { type Tokens, setTokens, token, tokensToCss } from './theme.ts'

/** `syncMs`: copying the DOM change into GPUI's tree. `syncToFrameMs`: from
 *  that change to the end of the GPUI tick that drew it. `inputToFrameMs`: if an
 *  input (click, key, drop) caused it, from the input reaching the adapter. */
export type FrameTiming = Readonly<{ syncMs: number; syncToFrameMs: number; inputToFrameMs?: number }>

export type AttachOptions = {
  /** The app's stylesheet, as it would be on the web. */
  css?: string
  /** The window's size in logical pixels, so `vh`, `vw` and media queries
   *  measure it (happy-dom's own default is 1024 × 768). Not updated on resize yet. */
  viewport?: { width: number; height: number }
  /** Semantic tokens to start with (see theme.ts); change them later with `setTokens`. */
  tokens?: Tokens
  /** Called after every DOM → GPUI sync with how long it took. */
  onSynced?: (timings: MirrorTimings) => void
}

export type NativeOptions = WindowOptions & AttachOptions & {
  /** Called when a GPUI frame shows a DOM change. */
  onFrame?: (frame: FrameTiming) => void
}

type Box = { x: number; y: number; width: number; height: number }
type TreeNode = { id: number; bounds?: Box; children?: Array<TreeNode> }

/** Every element's last painted bounds, from gpuix's automation tree (one
 *  call, where getElementBounds walks the whole tree for each element). */
const paintedBounds = (json: string): ReadonlyMap<number, Box> => {
  const boxes = new Map<number, Box>()
  const walk = (node: TreeNode) => {
    if (node.bounds !== undefined) boxes.set(node.id, node.bounds)
    for (const child of node.children ?? []) walk(child)
  }
  const root = JSON.parse(json) as TreeNode | null
  if (root !== null) walk(root)
  return boxes
}

/** A live window answers bounds from its UI thread, and one that isn't
 *  painting (hidden, or behind a lock screen) doesn't answer for 2 s. Rather
 *  than stall every frame, bounds are unknown for a while after a miss. */
const boundsUnlessMissed = (read: () => string) => {
  let missedAt = -Infinity
  return (): ReadonlyMap<number, Box> => {
    if (performance.now() - missedAt < 5000) return new Map()
    try {
      return paintedBounds(read())
    } catch {
      missedAt = performance.now()
      return new Map()
    }
  }
}

/** Gives FoldKit a DOM drawn by an already-initialised gpuix renderer: the
 *  live window (`mountNative`) or gpuix's offscreen `TestRenderer` in tests.
 *  Returns the container to hand to FoldKit's `Runtime.makeElement`. */
export const attachDom = (renderer: NativeRenderer, options: AttachOptions = {}) => {
  const { css, tokens, onSynced, viewport } = options
  const window = installDom()
  if (viewport !== undefined) window.happyDOM.setViewport(viewport)
  const document = window.document

  // Native defaults and the primitives' structural CSS first, so the app's CSS
  // can override them.
  const base = document.createElement('style')
  base.textContent = nativeDefaultsCss + primitivesCss
  document.head.appendChild(base)
  if (tokens !== undefined) setTokens(document as unknown as Document, tokens)
  if (css !== undefined) {
    const style = document.createElement('style')
    style.textContent = css
    document.head.appendChild(style)
  }

  const state = createRendererState(renderer)
  const eventHandlers = new Map()
  const mutations = createMutationQueue(renderer, ids => {
    for (const id of ids) unregisterEventHandlers(eventHandlers, id)
  })
  const tree = (renderer as { getAutomationTree?: () => string }).getAutomationTree
  const mirror = createMirror({
    window,
    mutations,
    eventHandlers,
    ...(renderer.getElementBounds === undefined ? {} : { boundsOf: (id: number) => renderer.getElementBounds!(id) }),
    ...(tree === undefined ? {} : { allBounds: boundsUnlessMissed(() => tree.call(renderer)) }),
    ...(renderer.getScrollOffset === undefined ? {} : { scrollOffsetOf: (id: number) => renderer.getScrollOffset!(id) }),
    ...(renderer.scrollTo === undefined ? {} : { scrollTo: (id: number, x: number, y: number) => renderer.scrollTo!(id, x, y) }),
    ...(onSynced === undefined ? {} : { onSynced }),
  })
  mirror.refreshStyles()

  const binding = state.attach({
    eventHandlers,
    onWindowKeyDown: event => mirror.windowKey(event),
  })
  renderer.setWindowKeyEvents?.(true, false, binding.windowKeyEventId)

  // FoldKit replaces its container with the view's root element, inside <body>.
  const container = document.createElement('div')
  container.id = 'app'
  document.body.appendChild(container)

  return {
    container: container as unknown as HTMLElement,
    /** Switch theme at runtime: the native tree is restyled on the next frame. */
    setTokens: (next: Tokens, selector?: string) => setTokens(document as unknown as Document, next, selector),
    window,
    mirror,
    detach: () => {
      mirror.stop()
      binding.detach()
    },
  }
}

/** Opens a native window and gives FoldKit a DOM drawn in it. */
export const mountNative = (options: NativeOptions = {}) => {
  const { css, tokens, onSynced, onFrame, ...windowOptions } = options
  const renderer = createNativeRenderer({
    onError: error => console.error('[foldkit-native] native event error', error),
  })
  renderer.init(windowOptions)

  // A DOM change is on screen at the end of the first GPUI tick after the
  // mirror flushed it.
  let flushed: { at: number; syncMs: number; inputAt?: number } | undefined
  const { width, height } = windowOptions
  const dom = attachDom(renderer, {
    ...(width === undefined || height === undefined ? {} : { viewport: { width, height } }),
    ...(css === undefined ? {} : { css }),
    ...(tokens === undefined ? {} : { tokens }),
    onSynced: timings => {
      flushed = {
        at: performance.now(),
        syncMs: timings.syncMs + (flushed?.syncMs ?? 0),
        ...(timings.inputAt ?? flushed?.inputAt ? { inputAt: (timings.inputAt ?? flushed?.inputAt)! } : {}),
      }
      onSynced?.(timings)
    },
  })
  const tick = renderer.tick.bind(renderer)
  let windowSize: { width: number; height: number } | undefined
  let sizeAskedAt = -Infinity
  renderer.tick = () => {
    const running = tick()
    // A resize moves things the DOM doesn't know about. (Asking is a round
    // trip to GPUI's UI thread, so not every frame.)
    const now = performance.now()
    if (now - sizeAskedAt > 500) {
      sizeAskedAt = now
      const size = renderer.getWindowSize?.()
      if (size !== undefined && (size.width !== windowSize?.width || size.height !== windowSize?.height)) {
        if (windowSize !== undefined) dom.mirror.layoutChanged()
        windowSize = size
      }
    }
    // Heights from laid-out widths (aspect-ratio); the next tick draws them.
    dom.mirror.afterLayout()
    if (flushed !== undefined) {
      const now = performance.now()
      onFrame?.({
        syncMs: flushed.syncMs,
        syncToFrameMs: now - flushed.at,
        ...(flushed.inputAt === undefined ? {} : { inputToFrameMs: now - flushed.inputAt }),
      })
      flushed = undefined
    }
    return running
  }

  const loop = startFrameLoop(renderer, {
    onTerminated: () => process.exit(0),
    onError: error => console.error('[foldkit-native] frame error', error),
  })

  return {
    container: dom.container,
    setTokens: dom.setTokens,
    window: dom.window,
    renderer,
    stop: () => {
      loop.stop()
      dom.detach()
    },
  }
}
