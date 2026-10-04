// From FoldKit's examples/shopping-cart/src/page/products.scene.test.ts, unchanged (MIT, © 2025 Devin Jameson; see examples/FOLDKIT-LICENSE).
// https://github.com/foldkit/foldkit/tree/main/examples/shopping-cart

import { expect, given, role, scene, text, withViewInputs } from 'foldkit/scene'
import { describe, test } from 'vitest'

import { products } from '../data/products'
import { init, update, view } from './products'

const productsView = withViewInputs(view, { cart: [] })

describe('products', () => {
  test('lists every product with an Add to Cart button', () => {
    scene(
      { update, view: productsView() },
      given(init(products)),
      expect(role('heading', { name: 'Products' })).toExist(),
      expect(text('Apple')).toExist(),
      expect(text('Banana')).toExist(),
      expect(role('button', { name: 'Add to Cart' })).toExist(),
    )
  })
})
