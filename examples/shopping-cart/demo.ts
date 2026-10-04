// The walk-through for `bun run record shopping-cart`: hover the products,
// put two in the cart, go to the cart with the nav link, add one more, check
// out with delivery instructions, and place the order. No network.
import { type Demo, nth } from '../../scripts/record.ts'

export const ready = 'Add to Cart'

export const demo: Demo = async (app, pause) => {
  await pause(1000)
  // Labels repeat down the list, so pick matches by position.
  const click = async (text: string, index = 0) => app.mouse.click(await nth(app, text, index))
  const hover = async (text: string, index = 0) => app.mouse.move(await nth(app, text, index))
  for (const name of ['Apple', 'Banana', 'Orange']) {
    await hover(name); await pause(350)
  }
  // The first "Add to Cart" is Apple's; once it's in the cart, Banana's.
  await hover('Add to Cart'); await pause(300)
  await click('Add to Cart'); await pause(700)
  await click('Add to Cart'); await pause(900)

  await hover('Cart (2)'); await pause(300)
  await click('Cart (2)'); await pause(1200)
  // The first "+" is Apple's.
  await click('+'); await pause(900)

  await click('Proceed to Checkout'); await pause(1000)
  const field = app.getByType('textarea')
  await field.click(); await pause(300)
  for (const letter of 'ring twice') {
    await field.press(letter === ' ' ? 'space' : letter)
    await pause(110)
  }
  await pause(600)
  await click('Place Order'); await pause(1500)
  await click('Products'); await pause(1200)
}
