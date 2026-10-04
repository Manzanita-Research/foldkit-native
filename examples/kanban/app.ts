// Kanban, from FoldKit's examples. FoldKit's entry.ts, with the container
// passed in (and without devtools, which need a browser).
import { Runtime } from 'foldkit'

import type { ExampleMeta } from '../support/example.ts'
import { Flags, Model, flags, init, subscriptions, update, view } from './main'

export const meta: ExampleMeta = {
  title: 'Kanban',
  blurb: 'A board of cards you drag between columns, or move with the keyboard.',
  foldkit: 'Drag and drop between columns, keyboard reordering, fractional indexing, screen reader announcements',
  gpui: 'Pointer drags with live drop targets, layered rounded cards with shadows',
  source: 'https://github.com/foldkit/foldkit/tree/main/examples/kanban',
  width: 1000,
  height: 793,
}

export const start = (container: HTMLElement) =>
  Runtime.run(
    Runtime.makeApplication({ Model, Flags, init, update, view, subscriptions, container }),
    { flags },
  )
