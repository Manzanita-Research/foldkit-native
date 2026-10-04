// The walk-through for `bun run record form`: a too-short name and a malformed
// email show their errors, get fixed, the email is checked, and the form is
// sent. The submit is FoldKit's fake API, so it succeeds or fails at random.
import type { Demo } from '../../scripts/record.ts'

export const ready = 'Join Our Waitlist'

export const demo: Demo = async (app, pause) => {
  const [name, email] = await app.getByType('input').all()
  const [message] = await app.getByType('textarea').all()
  /** Clicks into a field and types into it, one key at a time. */
  const typeInto = async (field: typeof name, keys: ReadonlyArray<string>) => {
    const box = field!.bounds!
    await app.mouse.click({ x: box.x + box.width / 2, y: box.y + box.height / 2 })
    await pause(300)
    for (const key of keys) {
      await app.call('keystrokes', { keys: key })
      await pause(90)
    }
  }
  const chars = (text: string) => text.split('').map(char => (char === ' ' ? 'space' : char))

  await pause(1000)
  await typeInto(name, ['A'])
  await pause(900)
  await typeInto(email, chars('nope'))
  await pause(1200)
  await typeInto(name, chars('lice'))
  await pause(600)
  await typeInto(email, ['backspace', 'backspace', 'backspace', 'backspace', ...chars('alice@example.com')])
  await pause(1200)
  await typeInto(message, chars('Looking forward to it!'))
  await pause(600)
  await app.getByText('Join Waitlist').hover(); await pause(400)
  await app.getByText('Join Waitlist').click()
  for (let i = 0; i < 50; i++) {
    const { text } = await app.call('getPaintedText', {})
    if (text.some(line => line.startsWith('Welcome') || line.startsWith('Sorry'))) break
    await pause(100)
  }
  await pause(2500)
}
