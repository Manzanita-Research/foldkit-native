// The walk-through for `bun run record themes`: hover, select, switch theme.
import type { Demo } from '../scripts/record.ts'

export const ready = 'Inbox'

export const demo: Demo = async (app, pause) => {
  const item = (label: string) => app.getByText(label)
  const theme = (name: string) => app.getByText(`switch theme (${name})`)
  await pause(2000)
  await item('Projects').hover(); await pause(700)
  await item('Projects').click(); await pause(1000)
  await item('Threads').hover(); await pause(700)
  await item('Threads').click(); await pause(1200)
  await theme('dusk').hover(); await pause(600)
  await theme('dusk').click(); await pause(2000)
  await item('Settings').hover(); await pause(700)
  await item('Settings').click(); await pause(1200)
  await item('Inbox').hover(); await pause(700)
  await item('Inbox').click(); await pause(1200)
  await theme('paper').click(); await pause(2000)
  await item('Projects').click(); await pause(2000)
}
