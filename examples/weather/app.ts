// Weather, from FoldKit's examples. FoldKit's entry.ts, with the container
// passed in (and without devtools, which need a browser).
import { Runtime } from 'foldkit'

import type { ExampleMeta } from '../support/example.ts'
import { Model, init, update, view } from './main'

export const meta: ExampleMeta = {
  title: 'Weather',
  blurb: 'Look up the weather for a US zip code.',
  foldkit: 'An HTTP Command, loading and failure states with AsyncData, a form from @foldkit/ui',
  gpui: 'A native text input, a gradient background, a rounded card with a soft shadow',
  source: 'https://github.com/foldkit/foldkit/tree/main/examples/weather',
  width: 520,
  height: 760,
}

export const start = (container: HTMLElement) =>
  Runtime.run(Runtime.makeApplication({ Model, init, update, view, container }))
