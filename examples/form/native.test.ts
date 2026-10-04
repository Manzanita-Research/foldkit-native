// Form in FoldKit Native: the real app, its CSS and the mirror, driven by
// GPUI's input. FoldKit's own tests (story.test.ts, scene.test.ts) cover the
// app's logic and view; these cover it running natively. Both async Commands
// are real: the email check and the submit each wait 500 ms, then the submit
// flips a coin with Effect's Random, which reads Math.random, so the tests
// stub Math.random to pick the outcome.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { attachDom } from '../../src/index.ts'
import { type Mounted, mountFake } from '../../test/support/mount.ts'
import { loadExample } from '../support/example.ts'
import { METAL, type Headless, type Metal, openHeadless, openMetal } from '../support/harness.ts'

/** Tailwind's colours, as styles.native.css lowers them. */
const GRAY_300 = '#d1d5dc' // border-gray-300: not validated yet
const BLUE_300 = '#90c5ff' // border-blue-300: checking
const GREEN_500 = '#00c758' // border-green-500: valid
const RED_500 = '#fb2c36' // border-red-500: invalid
const RED_600 = '#e40014' // text-red-600: the error under a field
const BLUE_500 = '#3080ff' // bg-blue-500: the button, once it can submit

const NAME_ERROR = 'Name must be at least 2 characters'
const EMAIL_ERROR = 'Please enter a valid email address'
const WELCOME = "Welcome to the waitlist, Alice! We'll be in touch soon."

const realRandom = Math.random
const coin = (heads: boolean) => {
  Math.random = () => (heads ? 0.9 : 0.1)
}
beforeEach(() => coin(true))
afterEach(() => {
  Math.random = realRandom
})

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Waits for FoldKit's Commands (500 ms each) to come back. */
const until = async (app: { settle: () => Promise<void> }, done: () => boolean, ms = 3000) => {
  const end = Date.now() + ms
  while (!done() && Date.now() < end) {
    await sleep(10)
    await app.settle()
  }
}

describe('headless', () => {
  let app: Headless
  afterEach(() => app?.close())

  /** The field by id. FoldKit labels fields with `<label for>`, which the
   *  harness's text lookup doesn't follow, so the tests name them by id. */
  const field = (id: string) => app.document.getElementById(id)!
  const nativeField = (id: string) => app.mounted.nativeOf(field(id) as unknown as Node)
  /** Typing, as gpuix's input reports it: the field's whole new value. */
  const type = async (id: string, value: string) => {
    expect(app.mounted.send(field(id) as unknown as Node, { eventType: 'change', value } as never)).toBe(true)
    await app.settle()
  }
  /** A text's colour in GPUI: it's on the native text node. */
  const textColour = (text: string) => {
    const walker = app.document.createTreeWalker(app.document.body, 4 /* NodeFilter.SHOW_TEXT */)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (node.textContent === text) return app.mounted.nativeOf(node).style['color']
    }
    throw new Error(`no text "${text}"`)
  }

  test('draws the form, with Tailwind styles reaching GPUI', async () => {
    app = await openHeadless('form')
    expect(app.texts()).toEqual([
      'Join Our Waitlist', 'Name', 'Email', "Anything you'd like to share with us?", 'Join Waitlist',
    ])
    expect(app.inSync()).toBe(true)
    // Two native text inputs and a native textarea, drawn with the field's
    // border, padding, radius and font (w-full px-3 py-2 border rounded-md).
    for (const id of ['name', 'email']) expect(nativeField(id).type).toBe('input')
    expect(nativeField('message').type).toBe('textarea')
    expect(nativeField('name').style).toMatchObject({
      borderColor: GRAY_300, borderTopWidth: 1, borderTopLeftRadius: 6,
      paddingLeft: 12, paddingTop: 8, width: '100%', fontSize: 16,
    })
    // The card: white, rounded-xl, shadow-lg, max-w-md.
    const card = app.mounted.nativeOf(app.document.querySelector('.max-w-md') as unknown as Node)
    expect(card.style).toMatchObject({ backgroundColor: '#fff', borderTopLeftRadius: 12, maxWidth: 448 })
    expect(card.style['boxShadow']).toMatchObject({ offsetY: 10, blurRadius: 15, spreadRadius: -3 })
    // The button can't submit yet: grey, and FoldKit marks it aria-disabled.
    expect(app.native('Join Waitlist').style).toMatchObject({ backgroundColor: GRAY_300 })
  })

  test('typing invalid values shows each error in GPUI, under a red border', async () => {
    app = await openHeadless('form')
    await type('name', 'A')
    expect(field('name').getAttribute('aria-invalid')).toBe('true')
    expect(app.texts()).toContain(NAME_ERROR)
    expect(textColour(NAME_ERROR)).toBe(RED_600)
    expect(nativeField('name').style).toMatchObject({ borderColor: RED_500 })

    await type('email', 'not-an-email')
    expect(app.texts()).toContain(EMAIL_ERROR)
    expect(nativeField('email').style).toMatchObject({ borderColor: RED_500 })
    expect(app.inSync()).toBe(true)

    // Submitting now (Enter in a field) is refused by update: nothing changes.
    app.mounted.send(field('email') as unknown as Node, { eventType: 'submit' } as never)
    await app.settle()
    expect(app.texts()).toContain('Join Waitlist')
    expect(app.texts()).not.toContain('Joining...')
  })

  test('fixing the fields clears the errors; the email is checked, then the form submits', async () => {
    app = await openHeadless('form')
    await type('name', 'A')
    await type('email', 'nope')
    expect(app.texts()).toEqual(expect.arrayContaining([NAME_ERROR, EMAIL_ERROR]))

    await type('name', 'Alice')
    expect(app.texts()).not.toContain(NAME_ERROR)
    expect(app.texts()).toContain('✓')
    expect(nativeField('name').style).toMatchObject({ borderColor: GREEN_500 })

    // A well-formed email: "Checking..." while FoldKit's ValidateEmail runs.
    await type('email', 'alice@example.com')
    expect(app.texts()).not.toContain(EMAIL_ERROR)
    expect(app.texts()).toContain('Checking...')
    expect(nativeField('email').style).toMatchObject({ borderColor: BLUE_300 })
    await until(app, () => !app.texts().includes('Checking...'))
    expect(nativeField('email').style).toMatchObject({ borderColor: GREEN_500 })
    expect(app.native('Join Waitlist').style).toMatchObject({ backgroundColor: BLUE_500 })

    await type('message', 'Hello from GPUI.')
    expect(field('message') as HTMLTextAreaElement).toMatchObject({ value: 'Hello from GPUI.' })

    // Click: "Joining..." while SubmitForm runs, then the welcome banner.
    await app.click('Join Waitlist')
    expect(app.texts()).toContain('Joining...')
    await until(app, () => app.texts().includes(WELCOME))
    expect(app.texts()).toContain(WELCOME)
    expect(app.native(WELCOME).style).toMatchObject({ backgroundColor: '#dcfce7', borderColor: '#05df72' })
    expect(app.inSync()).toBe(true)
  })

  test('a taken email is flagged after the check; a failed submit shows the error banner', async () => {
    coin(false)
    app = await openHeadless('form')
    await type('name', 'Alice')
    await type('email', 'test@example.com')
    await until(app, () => !app.texts().includes('Checking...'))
    expect(app.texts()).toContain('This email is already on our waitlist')

    await type('email', 'alice@example.com')
    await until(app, () => !app.texts().includes('Checking...'))
    // Enter in the email field submits, as a browser's implicit submission.
    app.mounted.send(field('email') as unknown as Node, { eventType: 'submit' } as never)
    await app.settle()
    expect(app.texts()).toContain('Joining...')
    await until(app, () => app.texts().some(text => text.startsWith('Sorry')))
    expect(app.texts()).toContain('Sorry, there was an error adding you to the waitlist. Please try again.')
    expect(app.inSync()).toBe(true)
  })

  // Not yet (README, "Inputs and focus"): GPUI only tells an element it took
  // focus if the element listens for focus, and FoldKit's Input doesn't; and
  // the mirror replays focus as a synthetic FocusEvent, which never moves
  // document.activeElement. So the DOM never knows which field is focused, and
  // `:focus` rules (Tailwind's focus:ring-2, the blue ring) never match. This
  // test fails until that's fixed; then drop `.failing`.
  test.failing('GPUI focus reaches the DOM: a focused field is document.activeElement', async () => {
    app = await openHeadless('form')
    expect(app.mounted.send(field('name') as unknown as Node, { eventType: 'focus' } as never)).toBe(true)
    await app.settle()
    expect(app.document.activeElement).toBe(field('name'))
  })
})

describe('typing, measured', () => {
  let mounted: Mounted
  afterEach(() => mounted?.close())

  test('a keystroke in GPUI → FoldKit update → DOM → GPUI sync', async () => {
    const example = await loadExample('form')
    const syncs: Array<{ at: number; syncMs: number; mutations: number }> = []
    mounted = mountFake({ css: example.css, onSynced: timings => syncs.push({ at: performance.now(), ...timings }) })
    example.start(mounted.container)
    await mounted.settle()
    const name = mounted.document.getElementById('name')! as unknown as Node

    const samples: Array<{ toSyncMs: number; syncMs: number }> = []
    let value = ''
    for (const char of 'Alice Liddell') {
      value += char
      syncs.length = 0
      const sent = performance.now()
      mounted.send(name, { eventType: 'change', value } as never)
      while (syncs.length === 0) await sleep(0)
      samples.push({ toSyncMs: syncs[0]!.at - sent, syncMs: syncs[0]!.syncMs })
      await mounted.settle()
    }
    const median = (values: Array<number>) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]!
    const report = {
      keystrokes: samples.length,
      keystrokeToSyncMs: { median: +median(samples.map(s => s.toSyncMs)).toFixed(2), max: +Math.max(...samples.map(s => s.toSyncMs)).toFixed(2) },
      syncMs: { median: +median(samples.map(s => s.syncMs)).toFixed(2), max: +Math.max(...samples.map(s => s.syncMs)).toFixed(2) },
    }
    console.log('form typing (headless):', JSON.stringify(report))
    expect((mounted.document.getElementById('name') as HTMLInputElement).value).toBe('Alice Liddell')
    // Loose, to catch "broken" on noisy CI machines: a frame is 16 ms.
    expect(report.keystrokeToSyncMs.median).toBeLessThan(50)
  })
})

describe.skipIf(!METAL)('Metal, offscreen', () => {
  let app: Metal
  afterEach(() => app?.close())

  /** The native fields in tree order: name, email, then the message. */
  const fields = () => {
    const [name, email] = app.renderer.findByType('input').map(element => element.id)
    const [message] = app.renderer.findByType('textarea').map(element => element.id)
    return { name: name!, email: email!, message: message! }
  }
  const clickField = async (id: number) => {
    const box = app.renderer.getElementBounds(id)!
    app.renderer.nativeSimulateClick(box.x + box.width / 2, box.y + box.height / 2)
    await app.settle()
  }
  const value = (id: string) => (app.document.getElementById(id) as HTMLInputElement).value

  test('GPUI lays out the form; real keystrokes show errors, fix them and submit', async () => {
    app = await openMetal('form')
    expect(app.painted()).toEqual(expect.arrayContaining(['Join Our Waitlist', 'Name', 'Email', 'Join Waitlist']))
    app.screenshot('empty')
    const { name, email, message } = fields()
    // Each field takes the card's whole width, however long its label.
    const widths = [name, email, message].map(id => app.renderer.getElementBounds(id)!.width)
    expect(widths[1]).toBe(widths[0]!)
    expect(widths[2]).toBe(widths[0]!)

    // Click into each field and type, through GPUI's own input pipeline.
    await clickField(name)
    await app.keys('A')
    expect(value('name')).toBe('A')
    await clickField(email)
    await app.keys('n o p e')
    expect(value('email')).toBe('nope')
    expect(app.painted()).toEqual(expect.arrayContaining([NAME_ERROR, EMAIL_ERROR]))
    app.screenshot('errors')

    await clickField(name)
    await app.keys('l i c e')
    expect(value('name')).toBe('Alice')
    await clickField(email)
    await app.keys('backspace backspace backspace backspace')
    await app.keys('a l i c e @ e x a m p l e . c o m')
    expect(value('email')).toBe('alice@example.com')
    await until(app, () => !app.painted().includes('Checking...'))
    expect(app.painted()).not.toEqual(expect.arrayContaining([NAME_ERROR]))
    expect(app.painted()).not.toEqual(expect.arrayContaining([EMAIL_ERROR]))
    app.screenshot('valid')

    await app.click('Join Waitlist')
    await until(app, () => app.painted().includes(WELCOME))
    expect(app.painted()).toContain(WELCOME)
    app.screenshot('submitted')
  })

  test('Tab moves GPUI focus from field to field; the DOM follows', async () => {
    app = await openMetal('form')
    const { name, email, message } = fields()
    await clickField(name)
    const focused = [app.renderer.getFocusedElementId()]
    const active = [app.document.activeElement?.id ?? null]
    for (const _ of [1, 2]) {
      await app.keys('tab')
      focused.push(app.renderer.getFocusedElementId())
      active.push(app.document.activeElement?.id ?? null)
    }
    console.log('form tab order:', JSON.stringify({ gpui: focused, expected: [name, email, message], dom: active }))
    expect(focused).toEqual([name, email, message])
    expect(active).toEqual(['name', 'email', 'message'])
  })
})

describe.skipIf(!METAL)('typing on Metal, measured', () => {
  test('a real keystroke → DOM → GPUI sync → painted frame', async () => {
    const example = await loadExample('form')
    const { TestRenderer } = await import('@gpuix/native/testing')
    const renderer = new TestRenderer({ width: example.meta.width, height: example.meta.height })
    const syncs: Array<{ at: number; syncMs: number }> = []
    const dom = attachDom(renderer, { css: example.css, onSynced: timings => syncs.push({ at: performance.now(), ...timings }) })
    try {
      example.start(dom.container)
      for (let i = 0; i < 3; i++) {
        await dom.window.happyDOM.waitUntilComplete()
        await sleep(0)
      }
      renderer.flush()
      const [name] = renderer.findByType('input')
      const box = renderer.getElementBounds(name!.id)!
      renderer.nativeSimulateClick(box.x + box.width / 2, box.y + box.height / 2)
      await dom.window.happyDOM.waitUntilComplete()
      renderer.flush()

      const samples: Array<{ toSyncMs: number; syncMs: number; frameMs: number }> = []
      for (const key of 'alice liddell'.split('').map(char => (char === ' ' ? 'space' : char))) {
        syncs.length = 0
        const pressed = performance.now()
        renderer.simulateKeystrokes(key)
        while (syncs.length === 0 && performance.now() - pressed < 1000) await sleep(0)
        const synced = syncs[0]
        if (synced === undefined) break
        renderer.flush()
        samples.push({ toSyncMs: synced.at - pressed, syncMs: synced.syncMs, frameMs: performance.now() - synced.at })
        await dom.window.happyDOM.waitUntilComplete()
      }
      const input = dom.window.document.getElementById('name') as unknown as HTMLInputElement
      const median = (values: Array<number>) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]!
      const stat = (pick: (s: (typeof samples)[number]) => number) =>
        ({ median: +median(samples.map(pick)).toFixed(2), max: +Math.max(...samples.map(pick)).toFixed(2) })
      const report = {
        keystrokes: samples.length,
        keystrokeToSyncMs: stat(s => s.toSyncMs),
        syncMs: stat(s => s.syncMs),
        syncToFrameMs: stat(s => s.frameMs),
        value: input.value,
      }
      console.log('form typing (Metal):', JSON.stringify(report))
      expect(input.value).toBe('alice liddell')
      expect(report.keystrokeToSyncMs.median).toBeLessThan(50)
    } finally {
      dom.detach()
      await dom.window.happyDOM.abort()
      dom.window.close()
    }
  })
})
