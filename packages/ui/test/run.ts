// Runs one of the component apps on FoldKit on gpuix: headless (the fake
// GPUI tree, anywhere) or on Metal (real GPUI offscreen, macOS), in a theme:
// dusk (dark) unless the test asks for paper (light).
import type { Update } from 'foldkit'
import type { HtmlBuilder } from 'foldkit/html'

import { METAL, mountHeadless, openMetal } from '../../foldkit-gpuix/test/support.ts'
import { type Theme, dusk, paper, themeStyle } from '../src/index.ts'
import { css } from './apps.ts'

export { METAL }

/** The two themes every component is shown in. */
export const THEMES = { paper, dusk } as const
export type ThemeName = keyof typeof THEMES

type App<M, Msg> = {
  Model: unknown
  init: M
  update: (model: M, message: Msg) => Update.Return<M, Msg>
  view: (model: M, h: never) => unknown
  /** A component with a clock (Toast) lifts its Subscription here. */
  subscriptions?: unknown
}

/** The app's view inside the theme's tokens, filling the window. */
const themed = (theme: Theme) => <M>(view: (model: M, h: never) => unknown) => (model: M, h: never) => {
  const builder = h as HtmlBuilder<unknown>
  return builder.div([builder.Style({ ...themeStyle(theme), display: 'flex', 'flex-direction': 'column', height: '100%' })], [view(model, h) as never])
}

const start = async <M, Msg>(container: HTMLElement, app: App<M, Msg>, theme: Theme) => {
  const { Runtime } = await import('foldkit')
  let latest = app.init
  Runtime.run(Runtime.makeElement({
    Model: app.Model,
    init: () => ({ model: app.init }),
    update: app.update,
    view: themed(theme)((model: M, h: never) => {
      latest = model
      return app.view(model, h)
    }),
    container,
    ...(app.subscriptions === undefined ? {} : { subscriptions: app.subscriptions }),
  } as never))
  return () => latest
}

export const headless = async <M, Msg>(app: App<M, Msg>, theme: ThemeName = 'dusk') => {
  const mounted = mountHeadless({ css, viewport: { width: 480, height: 360 } })
  const model = await start(mounted.container, app, THEMES[theme])
  await mounted.settle()
  return { ...mounted, model }
}

/** On Metal; screenshots are `ui-<name>[-paper]-<step>.png`. */
export const metal = async <M, Msg>(name: string, app: App<M, Msg>, theme: ThemeName = 'dusk') => {
  const mounted = await openMetal(theme === 'dusk' ? `ui-${name}` : `ui-${name}-${theme}`, { width: 480, height: 360 }, { css })
  const model = await start(mounted.container, app, THEMES[theme])
  await mounted.settle()
  return { ...mounted, model }
}
