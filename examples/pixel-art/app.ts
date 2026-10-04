// Pixel Art, from FoldKit's examples. FoldKit's entry.ts, with the container
// passed in (and without devtools, which need a browser). The saved canvas
// comes in as Flags, read from localStorage as FoldKit reads the browser's.
// On the adapter (FOLDKIT_NATIVE_RENDERER=gpuix) that's a file in the app's
// data folder, so the canvas survives a restart (restart.test.ts); on the
// mirror it's happy-dom's, in memory.
import { Runtime } from 'foldkit'

import type { ExampleMeta } from '../support/example.ts'
import { Flags, Model, flags, init, subscriptions, update, view } from './main'

export const meta: ExampleMeta = {
  title: 'Pixel Art',
  blurb: 'PixelForge: paint on a grid with brush, fill and eraser, mirror drawing and palette themes.',
  foldkit: 'Undo, redo and time-travel history, @foldkit/ui Dialog, RadioGroup, Switch and Listbox, saved state as Flags',
  gpui: 'Hundreds of live cells repainting under a dragging pointer',
  source: 'https://github.com/foldkit/foldkit/tree/main/examples/pixel-art',
  width: 1100,
  height: 820,
}

export const start = (container: HTMLElement) =>
  Runtime.run(
    Runtime.makeApplication({ Model, Flags, init, update, view, subscriptions, container }),
    { flags },
  )
