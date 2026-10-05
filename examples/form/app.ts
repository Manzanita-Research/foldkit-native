// Form, from FoldKit's examples. FoldKit's entry.ts, with the container
// passed in (and without devtools, which need a browser).
import { Runtime } from 'foldkit'

import type { ExampleMeta } from '../support/example.ts'
import { Model, init, update, view } from './main'

export const meta: ExampleMeta = {
  title: 'Form',
  blurb: 'Join a waitlist: a name, an email checked as you type, and a message.',
  foldkit: 'Field validation, error states, an async submit Command',
  gpui: 'Text inputs, focus rings, typing latency',
  source: 'https://github.com/foldkit/foldkit/tree/main/examples/form',
  width: 520,
  height: 760,
  renderer: 'gpuix',
}

export const start = (container: HTMLElement) =>
  Runtime.run(Runtime.makeApplication({ Model, init, update, view, container }))
