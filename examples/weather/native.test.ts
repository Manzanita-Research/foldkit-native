// Weather in FoldKit Native: the real app, its CSS and the mirror, driven by
// GPUI's input. FoldKit's own tests (story.test.ts, scene.test.ts) cover the
// app's logic and view; these cover it running natively. The weather service
// is stubbed: no network in tests.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { METAL, type Headless, type Metal, openHeadless, openMetal } from '../support/harness.ts'
import { mockGeocodingResponse, mockWeatherResponse } from './main.fixture'

const realFetch = globalThis.fetch
beforeEach(() => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    const body = url.includes('geocoding') ? mockGeocodingResponse : mockWeatherResponse
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
})

/** Waits for FoldKit's Command (the stubbed HTTP call) to come back. */
const until = async (app: { settle: () => Promise<void> }, done: () => boolean) => {
  for (let i = 0; i < 50 && !done(); i++) {
    await new Promise(resolve => setTimeout(resolve, 10))
    await app.settle()
  }
}

describe('headless', () => {
  let app: Headless
  afterEach(() => app?.close())

  test('draws the form, with Tailwind styles reaching GPUI', async () => {
    app = await openHeadless('weather')
    expect(app.texts()).toEqual(['Weather', 'Get Weather'])
    expect(app.inSync()).toBe(true)
    // bg-blue-500, px-6 py-2, rounded-lg: Tailwind 4 → styles.native.css → GPUI.
    expect(app.native('Get Weather').style).toMatchObject({
      backgroundColor: '#3080ff', paddingLeft: 24, paddingTop: 8, borderTopLeftRadius: 8,
    })
  })

  test('typing a zip code and submitting fetches and shows the weather', async () => {
    app = await openHeadless('weather')
    await app.type('Zip code', '90210')
    await app.click('Get Weather')
    await until(app, () => app.texts().includes('Beverly Hills, California'))
    expect(app.texts()).toContain('Beverly Hills, California')
    expect(app.texts()).toContain('72°F')
    expect(app.inSync()).toBe(true)
    // The result card: white, rounded, with Tailwind's shadow-lg.
    const card = app.native('Beverly Hills, California')
    expect(card).toBeDefined()
  })
})

describe.skipIf(!METAL)('Metal, offscreen', () => {
  let app: Metal
  afterEach(() => app?.close())

  test('GPUI lays out and paints the app; a click through its hit test submits', async () => {
    app = await openMetal('weather')
    expect(app.painted()).toEqual(['Weather', 'Enter a zip code', 'Get Weather'])
    app.screenshot('form')

    // Click into the field and type, through GPUI's own input pipeline.
    await app.click('Zip code')
    await app.keys('9 0 2 1 0')
    expect(app.document.querySelector('input')!.value).toBe('90210')
    await app.click('Get Weather')
    await until(app, () => app.painted().includes('72°F'))
    expect(app.painted()).toContain('Beverly Hills, California')
    app.screenshot('result')
  })
})
