// The walk-through for `bun run record native-ui`: everything from the
// keyboard. Tab through the fields and type, flip the theme with Space, pick
// an accent with the arrows, then open the dialog, Tab inside it, Escape.
import type { Demo } from '../../scripts/record.ts'

export const ready = 'Preferences'

export const demo: Demo = async (app, pause) => {
  const keys = (keys: string) => app.call('keystrokes', { keys })
  const type = async (text: string) => {
    for (const letter of text) {
      await keys(letter === ' ' ? 'space' : letter)
      await pause(90)
    }
  }
  await pause(900)
  await keys('tab'); await pause(400)
  await keys('tab'); await pause(300)
  await type('Ada Lovelace'); await pause(400)
  await keys('tab'); await pause(300)
  await type('ada@'); await pause(700)
  await type('example.com'); await pause(500)
  await keys('tab'); await pause(500)
  await app.call('keyDown', { key: 'space' })
  await app.call('keyUp', { key: 'space' }); await pause(1100)
  await app.call('keyDown', { key: 'space' })
  await app.call('keyUp', { key: 'space' }); await pause(700)
  await keys('tab'); await pause(400)
  for (const _ of [1, 2, 3, 4, 5, 6, 7]) {
    await keys('down')
    await pause(260)
  }
  await keys('enter'); await pause(1000)
  await keys('tab'); await pause(400)
  await keys('enter'); await pause(900)
  await keys('tab'); await pause(450)
  await keys('tab'); await pause(450)
  await keys('escape'); await pause(900)
}
