// Shopping Cart in FoldKit Native: the real app, its CSS and the mirror,
// driven by GPUI's input. FoldKit's own tests (story.test.ts, scene.test.ts
// and page/*.test.ts) cover the app's logic and views; these cover it running
// natively: pages changed by clicking FoldKit's links in GPUI, a cart that
// survives the page changes, hover colours. No network: the app makes no
// requests.
import { afterEach, describe, expect, test } from 'bun:test'

import { METAL, type Headless, type Metal, openHeadless, openMetal } from '../support/harness.ts'

const NAV = ['Products', 'Cart', 'Checkout']
const PRODUCTS = ['Apple', 'Banana', 'Orange', 'Bread', 'Milk', 'Eggs']

/** Where FoldKit's routing has the app: happy-dom's location. */
const path = (app: { document: Document }) => {
  const { pathname, search } = app.document.defaultView!.location
  return pathname + search
}

/** The product or cart row showing `name`. */
const row = (app: Headless, name: string) => {
  const found = Array.from(app.document.querySelectorAll('article'))
    .find(article => article.querySelector('h3')?.textContent === name)
  if (found === undefined) throw new Error(`no row for ${name}`)
  return found
}

/** A GPUI click on the button showing `text` in `name`'s row. */
const clickInRow = async (app: Headless, name: string, text: string) => {
  const button = Array.from(row(app, name).querySelectorAll('button')).find(b => b.textContent === text)
  if (button === undefined) throw new Error(`no "${text}" in ${name}'s row`)
  expect(app.mounted.send(button, { eventType: 'click', x: 1, y: 1, button: 0, clickCount: 1 })).toBe(true)
  await app.settle()
}

describe('headless', () => {
  let app: Headless
  afterEach(() => app?.close())

  test('draws the products page, with Tailwind styles and hover colours reaching GPUI', async () => {
    app = await openHeadless('shopping-cart')
    expect(path(app)).toBe('/')
    expect(app.texts().slice(0, 4)).toEqual([...NAV, 'Products'])
    for (const name of PRODUCTS) expect(app.texts()).toContain(name)
    expect(app.texts().filter(text => text === 'Add to Cart')).toHaveLength(6)
    expect(app.inSync()).toBe(true)

    // The page you're on is the darker link (bg-blue-700) in the blue bar (bg-blue-500).
    const [products, cart] = Array.from(app.document.querySelectorAll('nav a'))
    expect(app.mounted.nativeOf(app.document.querySelector('nav')!).style).toMatchObject({ backgroundColor: '#3080ff' })
    expect(app.mounted.nativeOf(products!).style).toMatchObject({ backgroundColor: '#1447e6', hover: { backgroundColor: '#155dfc' } })
    expect(app.mounted.nativeOf(cart!).style['backgroundColor']).toBeUndefined()
    // bg-blue-500 hover:bg-blue-600 rounded-lg: Tailwind 4 → styles.native.css → GPUI.
    expect(app.native('Add to Cart').style).toMatchObject({
      backgroundColor: '#3080ff', borderTopLeftRadius: 8, paddingLeft: 16, hover: { backgroundColor: '#155dfc' },
    })
    // Each product row: a 1px border (Tailwind's `border`, the text colour) and hover:bg-gray-50.
    expect(app.mounted.nativeOf(row(app, 'Apple')).style).toMatchObject({
      display: 'flex', justifyContent: 'space-between', borderTopWidth: 1, borderColor: '#000000',
      hover: { backgroundColor: '#f9fafb' },
    })
  })

  test('typing in the search filters the list and FoldKit keeps the URL in step', async () => {
    app = await openHeadless('shopping-cart')
    await app.type('Search products', 'br')
    expect(path(app)).toBe('/?searchText=br')
    expect(app.texts().filter(text => PRODUCTS.includes(text))).toEqual(['Bread'])
    await app.type('Search products', '')
    expect(path(app)).toBe('/')
    expect(app.texts().filter(text => PRODUCTS.includes(text))).toEqual(PRODUCTS)
    expect(app.inSync()).toBe(true)
  })

  test('browse, fill the cart, change a quantity, check out: every page through GPUI clicks', async () => {
    app = await openHeadless('shopping-cart')

    // Products: two items into the cart.
    await clickInRow(app, 'Apple', 'Add to Cart')
    await clickInRow(app, 'Bread', 'Add to Cart')
    expect(app.texts()).toContain('Cart (2)')
    expect(app.texts()).toContain('Go to Cart (2)')
    expect(app.document.querySelectorAll('article button').length).toBe(4 + 2 * 2)
    expect(app.inSync()).toBe(true)

    // The nav link, a plain <a href> FoldKit intercepts on document.
    await app.click('Cart (2)')
    expect(path(app)).toBe('/cart')
    expect(app.texts()).toContain('Shopping Cart')
    expect(app.texts()).toContain('$1.50 each')
    expect(app.texts()).toContain('$3.25 each')
    expect(app.texts()).toContain('$4.75')
    expect(app.inSync()).toBe(true)

    // A quantity, on the cart page.
    await clickInRow(app, 'Bread', '+')
    expect(app.texts()).toContain('Cart (3)')
    expect(app.texts()).toContain('$8.00')
    await clickInRow(app, 'Apple', 'Remove')
    expect(app.texts()).not.toContain('Apple')
    await app.click('Continue Shopping')
    expect(path(app)).toBe('/')
    await clickInRow(app, 'Apple', 'Add to Cart')
    await app.click('Go to Cart (3)')
    expect(path(app)).toBe('/cart')

    // Checkout: the summary, delivery instructions, the order.
    await app.click('Proceed to Checkout')
    expect(path(app)).toBe('/checkout')
    expect(app.texts()).toContain('Order Summary')
    expect(app.texts()).toContain('× 2')
    expect(app.texts()).toContain('$8.00')
    await app.type('Special delivery instructions (optional)...', 'Leave it by the door')
    expect(app.document.querySelector('textarea')!.value).toBe('Leave it by the door')
    await app.click('Place Order')
    expect(app.texts()).toContain('Order placed successfully!')
    expect(app.texts().slice(0, 3)).toEqual(NAV)
    expect(app.inSync()).toBe(true)
  })

  test('back goes to the previous page, but only the app can ask for it', async () => {
    app = await openHeadless('shopping-cart')
    await app.click('Cart')
    await app.click('Checkout')
    expect(path(app)).toBe('/checkout')
    // FoldKit follows popstate. Nothing in GPUI sends one: there's no back
    // button, key or mouse button wired to history (see EXAMPLES.md).
    app.document.defaultView!.history.back()
    for (let i = 0; i < 20 && path(app) !== '/cart'; i++) await new Promise(resolve => setTimeout(resolve, 5))
    await app.settle()
    expect(path(app)).toBe('/cart')
    expect(app.texts()).toContain('Your cart is empty')
  })
})

describe.skipIf(!METAL)('Metal, offscreen', () => {
  let app: Metal
  afterEach(() => app?.close())

  test('GPUI paints each page; clicks through its hit test fill the cart and change pages', async () => {
    app = await openMetal('shopping-cart')
    expect(app.painted()).toEqual(expect.arrayContaining([...NAV, 'Apple', 'Bread', 'Add to Cart']))
    app.screenshot('products')

    // Hover a product row: GPUI applies hover:bg-gray-50 itself.
    const apple = app.bounds('Apple')
    app.renderer.nativeSimulateMouseMove(apple.x + 4, apple.y + 4)
    await app.settle()
    app.screenshot('products-hover')

    // The first "Add to Cart" is Apple's; once it's in the cart, Banana's.
    await app.click('Add to Cart')
    await app.click('Add to Cart')
    expect(app.painted()).toContain('Cart (2)')
    app.screenshot('products-in-cart')

    await app.click('Cart (2)')
    expect(path(app)).toBe('/cart')
    expect(app.painted()).toEqual(expect.arrayContaining(['Shopping Cart', '$1.50 each', '$0.75 each', '$2.25']))
    // The first "+" is Apple's.
    await app.click('+')
    expect(app.painted()).toEqual(expect.arrayContaining(['Cart (3)', '$3.75']))
    app.screenshot('cart')

    await app.click('Proceed to Checkout')
    expect(path(app)).toBe('/checkout')
    expect(app.painted()).toEqual(expect.arrayContaining(['Order Summary', '× 2', '$3.75']))
    await app.click('Special delivery instructions (optional)...')
    await app.keys('r i n g space t w i c e')
    expect(app.document.querySelector('textarea')!.value).toBe('ring twice')
    app.screenshot('checkout')

    await app.click('Place Order')
    expect(app.painted()).toContain('Order placed successfully!')
    app.screenshot('order-placed')
  })

  test('the products page scrolls when it is taller than the window, as a browser page does', async () => {
    app = await openMetal('shopping-cart', { width: 760, height: 600 })
    const height = 600
    const before = app.bounds('Eggs')
    console.log(`[shopping-cart] Eggs at y=${before.y} in a ${height}px window`)
    expect(before.y + before.height).toBeGreaterThan(height)
    app.renderer.nativeSimulateScrollWheel(380, 300, 0, -400)
    await app.settle()
    const after = app.bounds('Eggs')
    console.log(`[shopping-cart] after a 400px wheel: Eggs at y=${after.y}`)
    app.screenshot('products-scrolled')
    expect(after.y).toBeLessThan(before.y)
  })
})
