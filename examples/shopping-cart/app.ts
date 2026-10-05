// Shopping Cart, from FoldKit's examples. FoldKit's entry.ts, with the
// container passed in (and without devtools, which need a browser).
import { Runtime } from 'foldkit'

import type { ExampleMeta } from '../support/example.ts'
import { Message, Model, init, update, view } from './main'

export const meta: ExampleMeta = {
  title: 'Shopping Cart',
  blurb: 'Browse products, fill a cart, check out.',
  foldkit: 'Routing between pages, Submodels for each page, a cart that survives navigation',
  gpui: 'Page changes, scrolling product lists, hover states',
  source: 'https://github.com/foldkit/foldkit/tree/main/examples/shopping-cart',
  width: 760,
  height: 820,
}

export const start = (container: HTMLElement) =>
  Runtime.run(
    Runtime.makeApplication({
      Model,
      init,
      update,
      view,
      container,
      routing: {
        onUrlRequest: request => Message.ClickedLink({ request }),
        onUrlChange: url => Message.ChangedUrl({ url }),
      },
    }),
  )
