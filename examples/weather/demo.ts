// The walk-through for `bun run record weather`. Uses the real weather
// service (Open-Meteo, no key), so it needs the network.
import type { Demo } from '../../scripts/record.ts'

export const ready = 'Get Weather'

export const demo: Demo = async (app, pause) => {
  await pause(1000)
  const field = app.getByType('input')
  await field.click(); await pause(400)
  for (const digit of '90210') {
    await field.press(digit)
    await pause(140)
  }
  await pause(500)
  await app.getByText('Get Weather').hover(); await pause(400)
  await app.getByText('Get Weather').click()
  await app.getByText('Wind Speed').waitFor({ timeoutMs: 10_000 })
  await pause(2500)
}
