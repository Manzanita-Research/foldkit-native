// An app on `mountGpuix` with the fake GPUI behind it: the real frame loop,
// close handlers and error reports, with a renderer whose window "closes" when
// a test says so. Also a FoldKit app with a Mount whose release is logged, so
// a test can see its runtime disposed.

import type { EventPayload, WindowOptions } from '@gpuix/native'
import { Effect, Schema } from 'effect'
import { Mount, Runtime } from 'foldkit'
import type { HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'

import { type NativeOptions, type WindowRenderer, mountGpuix } from '../src/index.ts'
import { createFocusableFake } from './support.ts'

export const createFakeWindow = (options: { init?: (options?: WindowOptions | null) => void } = {}) => {
  const fake = createFocusableFake()
  let open = true
  let tickError: unknown
  let callback: ((error: Error | null, event: EventPayload) => void) | undefined
  const renderer: WindowRenderer = {
    ...fake.renderer,
    init: windowOptions => options.init?.(windowOptions),
    requiresTick: () => open,
    // As gpuix's on Linux: once the window's gone, its queries throw.
    getWindowSize: () => {
      if (!open) throw new Error('GPUI application is not initialized')
      return { width: 1024, height: 768 }
    },
    setWindowKeyEvents: (...args: Parameters<NonNullable<WindowRenderer['setWindowKeyEvents']>>) => {
      if (!open) throw new Error('GPUI application is not initialized')
      return fake.renderer.setWindowKeyEvents?.(...args)
    },
    tick: () => {
      if (tickError !== undefined) {
        const error = tickError
        tickError = undefined
        throw error
      }
      return open
    },
  }
  return {
    fake,
    createRenderer: (events: (error: Error | null, event: EventPayload) => void) => {
      callback = events
      return renderer
    },
    /** The person closed the window: GPUI's loop ends on the next tick. */
    closeWindow: () => {
      open = false
    },
    failNextTick: (error: unknown) => {
      tickError = error
    },
    /** What gpuix's event callback gets from the native side. */
    send: (error: Error | null, event?: Partial<EventPayload>) => callback!(error, event as EventPayload),
  }
}

export const log: Array<string> = []

const Message = defineMessageUnion({ Mounted: {} })
type Message = typeof Message.Type
const Watch = Mount.define('Watch', {
  messages: [Message.Mounted],
  execute: () =>
    Effect.acquireRelease(Effect.sync(() => log.push('mounted')), () => Effect.sync(() => log.push('released'))).pipe(
      Effect.as(Message.Mounted()),
    ),
})
const Model = Schema.Struct({ mounted: Schema.Number })

/** `mountGpuix` on a fake window, running a small FoldKit app. */
export const openApp = (options: NativeOptions = {}) => {
  log.length = 0
  const window = createFakeWindow()
  const app = mountGpuix({ exitOnClose: false, createRenderer: window.createRenderer, ...options })
  app.own(Runtime.embed(Runtime.makeElement({
    Model,
    init: () => ({ model: { mounted: 0 } }),
    update: (model: typeof Model.Type) => ({ model: { mounted: model.mounted + 1 } }),
    view: (model: typeof Model.Type, h: HtmlBuilder<Message>) =>
      h.div([h.Id('root'), h.OnMount(Watch())], [h.button([h.Id('ok')], [`mounted ${model.mounted}`])]),
    container: app.container,
  } as never)))
  return { app, window }
}

/** A few frames of the real loop (8 ms each). */
export const frames = (count = 4) => new Promise(resolve => setTimeout(resolve, count * 10))
