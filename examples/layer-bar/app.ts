// Layer bar, for the gallery: a bar along the top of the screen. The window
// is foldkit-gpuix's `bar()`: a layer-shell surface on Wayland, a small
// window of the same shape elsewhere.
import { Runtime } from 'foldkit'
import { bar } from 'foldkit-gpuix'

import type { ExampleMeta } from '../support/example.ts'
import { Model, init, subscriptions, update, view } from './main'

/** The bar's window: what a shell's bar would ask for. */
export const BAR = { appId: 'dev.foldkit-native.layer-bar', edge: 'top', thickness: 40, title: 'Layer bar', fallbackLength: 720 } as const
export const barWindow = bar(BAR)

export const meta: ExampleMeta = {
  title: 'Layer bar',
  blurb: 'A thin bar along the top of the screen, with a clock and two buttons.',
  foldkit: 'A clock Subscription, and buttons from @foldkit-native/ui',
  gpui: 'A Wayland layer-shell surface with an exclusive zone; a small window elsewhere',
  // The gallery's size for it: the window it is where there's no layer shell.
  width: BAR.fallbackLength,
  height: BAR.thickness,
  // Built on @foldkit-native/ui and bar(): FoldKit on gpuix only.
  renderer: 'gpuix',
  window: barWindow,
}

export const start = (container: HTMLElement) =>
  Runtime.run(Runtime.makeElement({ Model, init: init(Date.now()), update, view, subscriptions, container }))

export { uiCss as libraryCss } from '@foldkit-native/ui'
