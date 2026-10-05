// Native UI, for the gallery: @foldkit-native/ui on FoldKit on gpuix.
import { Runtime } from 'foldkit'

import type { ExampleMeta } from '../support/example.ts'
import { Model, init, update, view } from './main'

export const meta: ExampleMeta = {
  title: 'Native UI',
  blurb: 'Preferences built from @foldkit-native/ui, drawn by FoldKit on gpuix with no DOM engine.',
  foldkit: 'A themed component library: text fields, a switch, a listbox submodel, a dialog',
  gpui: 'GPUI owns focus, Tab order, focus traps, scrolling and text editing',
  width: 560,
  height: 720,
  // Built on @foldkit-native/ui: FoldKit on gpuix only.
  renderer: 'gpuix',
}

export const start = (container: HTMLElement) =>
  Runtime.run(Runtime.makeElement({ Model, init, update, view, container }))

export { uiCss as libraryCss } from '@foldkit-native/ui'
