// Big List, written here for FoldKit Native (not a port): what an entry.ts
// would do, with the container passed in.
import { Runtime } from 'foldkit'

import type { ExampleMeta } from '../support/example.ts'
import { Model, init, subscriptions, update, view } from './main'

export const meta: ExampleMeta = {
  title: 'Big List',
  blurb: '10,000 tracks: filter as you type, pick with the keyboard, switch theme.',
  foldkit: 'A live filter and keyboard selection over 10,000 rows (only the visible ones rendered), a key Subscription, theme tokens switched at runtime',
  gpui: 'Smooth native scrolling of a long list, theming, shadows and rounded layers',
  width: 1040,
  height: 760,
  renderer: 'gpuix',
}

export const start = (container: HTMLElement) =>
  Runtime.run(Runtime.makeApplication({ Model, init, update, view, subscriptions, container }))
