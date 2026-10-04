// The walk-through for `bun run record form`: a too-short name and a malformed
// email show their errors, get fixed, the email is checked, and the form is
// sent. The submit is FoldKit's fake API, so it succeeds or fails at random.
import type { Demo } from '../../scripts/record.ts'

export const ready = 'Join Our Waitlist'

export const demo: Demo = async (app, pause) => {
  // Fields move as error messages come and go, so find them fresh each time.
  const name = async () => (await app.getByType('input').all())[0]!
  const email = async () => (await app.getByType('input').all())[1]!
  const message = async () => (await app.getByType('textarea').all())[0]!
  /** Clicks into a field and types into it, one key at a time. */
  const typeInto = async (field: () => Promise<{ bounds?: { x: number; y: number; width: number; height: number } }>, keys: ReadonlyArray<string>) => {
    const box = (await field()).bounds!
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
  // FoldKit's example fakes its server with a coin flip, so a submit fails
  // half the time. Try again until it goes through: the clip shows both.
  for (let attempt = 0; attempt < 6; attempt++) {
    await app.getByText('Join Waitlist').click()
    let outcome = ''
    for (let i = 0; i < 50 && outcome === ''; i++) {
      const { text } = await app.call('getPaintedText', {})
      outcome = text.find(line => line.startsWith('Welcome') || line.startsWith('Sorry')) ?? ''
      if (outcome === '') await pause(100)
    }
    if (!outcome.startsWith('Sorry')) break
    await pause(1500)
  }
  await pause(2500)
}
