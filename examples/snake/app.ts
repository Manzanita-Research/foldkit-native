// Snake, from FoldKit's examples. FoldKit's entry.ts, with the container
// passed in (and without devtools, which need a browser).
import { Runtime } from 'foldkit'

import type { ExampleMeta } from '../support/example.ts'
import { Model, init, subscriptions, update, view } from './main'

export const meta: ExampleMeta = {
  title: 'Snake',
  blurb: 'The classic game: arrow keys or WASD to steer, space to start and pause.',
  foldkit: 'A game loop and the keyboard as Subscriptions, pure game logic in update',
  gpui: 'Redrawing a whole 20 × 20 grid every tick',
  source: 'https://github.com/foldkit/foldkit/tree/main/examples/snake',
  width: 640,
  height: 820,
  renderer: 'gpuix',
}

export const start = (container: HTMLElement) =>
  Runtime.run(Runtime.makeApplication({ Model, init, update, view, subscriptions, container }))
