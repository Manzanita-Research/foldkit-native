// The walk-through for `bun run record kanban`: a card dragged to another
// column, then one moved with the keyboard. No network.
import type { Demo } from '../../scripts/record.ts'

export const ready = 'Kanban Board'

export const demo: Demo = async (app, pause) => {
  await pause(1000)
  // Drag "Research drag-and-drop patterns" to the top of In Progress, slowly
  // enough to see the ghost follow the pointer and the placeholder open up.
  const from = await app.getByText('Research drag-and-drop patterns').center()
  const over = await app.getByText('Build the DragAndDrop component').center()
  const to = { x: over.x, y: over.y - 20 }
  await app.mouse.move(from); await pause(400)
  await app.mouse.down(from); await pause(200)
  for (let step = 1; step <= 30; step++) {
    const t = step / 30
    await app.mouse.move({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, { pressedButton: 0 })
    await pause(25)
  }
  await pause(700)
  await app.mouse.up(to); await pause(1500)

  // The keyboard: click a card (a press and a release, a frame apart), Space
  // to pick it up, Up to move it, Space to drop it.
  const card = await app.getByText('Design the data model').center()
  await app.mouse.down(card); await pause(100)
  await app.mouse.up(card); await pause(500)
  await app.call('keystrokes', { keys: 'space' }); await pause(900)
  await app.call('keystrokes', { keys: 'down' }); await pause(900)
  await app.call('keystrokes', { keys: 'space' }); await pause(2000)
}
