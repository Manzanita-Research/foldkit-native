// The walk-through for `bun run record big-list`: scroll the long list with
// the wheel, filter it as you type, pick a track with the keys, open it, and
// switch theme.
import { type Demo, nth } from '../../scripts/record.ts'

export const ready = '10,000 of 10,000'

export const demo: Demo = async (app, pause) => {
  const key = (keys: string) => app.call('keystrokes', { keys })
  await pause(1000)
  // Wheel over the list (where its first row is), in wheel-sized steps.
  const { x, y } = await app.getByText('Harbor (Lonely Mix)').center()
  for (let i = 0; i < 16; i++) {
    await app.call('scrollWheel', { x, y: y + 120, deltaX: 0, deltaY: -240 })
    await pause(50)
  }
  await pause(600)
  await key('end'); await pause(900)
  await key('home'); await pause(700)

  const field = app.getByType('input')
  await field.click(); await pause(300)
  for (const letter of 'velvet') {
    await field.press(letter)
    await pause(160)
  }
  await pause(600)
  for (const move of ['down', 'down', 'down']) {
    await key(move)
    await pause(300)
  }
  await key('enter'); await pause(1400)
  // The theme switch's label (the text also shows in the switch's own parts).
  await app.mouse.click(await nth(app, 'Dark')); await pause(1500)
  await app.mouse.click(await nth(app, 'Light')); await pause(800)
}
