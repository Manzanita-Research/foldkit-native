// The walk-through for `bun run record shopping-cart`: hover the products,
// put two in the cart, go to the cart with the nav link, add one more, check
// out with delivery instructions, and place the order. No network.
import type { Demo } from '../../scripts/record.ts'

export const ready = 'Add to Cart'

export const demo: Demo = async (app, pause) => {
  await pause(1000)
  for (const name of ['Apple', 'Banana', 'Orange']) {
    await app.getByText(name).hover(); await pause(350)
  }
  // The first "Add to Cart" is Apple's; once it's in the cart, Banana's.
  await app.getByText('Add to Cart').hover(); await pause(300)
  await app.getByText('Add to Cart').click(); await pause(700)
  await app.getByText('Add to Cart').click(); await pause(900)

  await app.getByText('Cart (2)').hover(); await pause(300)
  await app.getByText('Cart (2)').click(); await pause(1200)
  // The first "+" is Apple's.
  await app.getByText('+').click(); await pause(900)

  await app.getByText('Proceed to Checkout').click(); await pause(1000)
  const field = app.getByType('textarea')
  await field.click(); await pause(300)
  for (const letter of 'ring twice') {
    await field.press(letter === ' ' ? 'space' : letter)
    await pause(110)
  }
  await pause(600)
  await app.getByText('Place Order').click(); await pause(1500)
  await app.getByText('Products').click(); await pause(1200)
}
