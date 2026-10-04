// The walk-through for `bun run record snake`: start the game, steer a loop
// with window keystrokes (FoldKit listens on the document), pause.
import type { Demo } from '../../scripts/record.ts'

export const ready = 'Press SPACE to start'

export const demo: Demo = async (app, pause) => {
  const key = (keys: string) => app.call('keystrokes', { keys })
  await pause(1200)
  await key('space'); await pause(900)
  for (const turn of ['down', 'left', 'up', 'right', 'down', 'left']) {
    await key(turn)
    await pause(750)
  }
  await key('space'); await pause(1500)
}
