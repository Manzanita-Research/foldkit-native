// Runs one of the component apps on FoldKit on gpuix: headless (the fake
// GPUI tree, anywhere) or on Metal (real GPUI offscreen, macOS).
import type { Update } from 'foldkit'

import { METAL, mountHeadless, openMetal } from '../../foldkit-gpuix/test/support.ts'
import { css } from './apps.ts'

export { METAL }

type App<M, Msg> = {
  Model: unknown
  init: M
  update: (model: M, message: Msg) => Update.Return<M, Msg>
  view: (model: M, h: never) => unknown
}

const start = async <M, Msg>(container: HTMLElement, app: App<M, Msg>) => {
  const { Runtime } = await import('foldkit')
  let latest = app.init
  Runtime.run(Runtime.makeElement({
    Model: app.Model,
    init: () => ({ model: app.init }),
    update: app.update,
    view: (model: M, h: never) => {
      latest = model
      return app.view(model, h)
    },
    container,
  } as never))
  return () => latest
}

export const headless = async <M, Msg>(app: App<M, Msg>) => {
  const mounted = mountHeadless({ css, viewport: { width: 480, height: 360 } })
  const model = await start(mounted.container, app)
  await mounted.settle()
  return { ...mounted, model }
}

export const metal = async <M, Msg>(name: string, app: App<M, Msg>) => {
  const mounted = await openMetal(`ui-${name}`, { width: 480, height: 360 }, { css })
  const model = await start(mounted.container, app)
  await mounted.settle()
  return { ...mounted, model }
}
