// Big List in FoldKit Native: the real app and its CSS on FoldKit on gpuix
// (its `meta.renderer`; FOLDKIT_NATIVE_RENDERER=mirror runs them on the
// mirror, as CI does too), driven by GPUI's input. The story and scene tests
// cover the app's logic and view; these cover it running natively: 10,000 rows
// filtered and scrolled with only the visible ones in GPUI's tree, keys, the
// theme switch, and GPUI's scroll position coming back to FoldKit's OnScroll.
import { afterEach, describe, expect, test } from 'bun:test'

import { METAL, type Headless, type Metal, openHeadless, openMetal } from '../support/harness.ts'
import { TRACKS, TRACK_COUNT, formatCount, matching } from './library'
import { LIST_HEIGHT, ROW_HEIGHT } from './main'

const rows = (document: Document) => Array.from(document.querySelectorAll('.row'))
const titleOf = (row: Element) => row.querySelector('.cell-title')!.textContent
const selectedTitle = (document: Document) => titleOf(document.querySelector('.row[data-selected]')!)
const list = (document: Document) => document.getElementById('tracks')!

describe('headless', () => {
  let app: Headless
  afterEach(() => app?.close())

  test('draws the first rows of 10,000, with the dark theme reaching GPUI', async () => {
    app = await openHeadless('big-list')
    expect(app.texts()).toContain('Big List')
    expect(app.texts()).toContain('10,000 of 10,000')
    expect(app.texts()).toContain(TRACKS[0]!.title)
    expect(app.inSync()).toBe(true)
    // Only the rows near the top are in GPUI's tree, not 10,000.
    expect(rows(app.document).length).toBeLessThan(50)
    expect(app.gpui.reachableCount()).toBeLessThan(800)
    // Theme tokens (CSS custom properties under data-theme) → GPUI colours.
    expect(app.nativeOf(app.document.querySelector('.title')!.firstChild!).style['color']).toBe('#eceef4')
    expect(app.nativeOf(app.document.querySelector('.app')!).style).toMatchObject({ backgroundColor: '#0c0d11' })
    const selected = app.nativeOf(app.document.querySelector('.row[data-selected]')!).style
    expect(selected).toMatchObject({ backgroundColor: '#4f6ef7', borderTopLeftRadius: 10, height: ROW_HEIGHT })
    const row = app.nativeOf(rows(app.document)[1]!).style
    expect(row['hover']).toEqual({ backgroundColor: '#1f2330' })
    expect(app.nativeOf(app.document.querySelector('.list-panel')!).style['boxShadow'])
      .toMatchObject({ offsetY: 24, blurRadius: 48 })
    expect(app.nativeOf(list(app.document)).style).toMatchObject({ overflowY: 'scroll' })
    // The list can take focus in GPUI, so a click in it takes the keys.
    expect(app.nativeOf(list(app.document)).props['tabIndex']).toBe(0)
    // The field's own text colour reaches GPUI's input.
    expect(app.nativeOf(app.document.querySelector('input')!).style).toMatchObject({ color: '#eceef4', fontSize: 15 })
  })

  test('typing in the filter narrows the list and the count', async () => {
    app = await openHeadless('big-list')
    const matches = matching('velvet')
    await app.type('Filter', 'velvet')
    expect(app.document.querySelector('input')!.value).toBe('velvet')
    expect(app.texts()).toContain(`${formatCount(matches.length)} of 10,000`)
    expect(titleOf(rows(app.document)[0]!)).toBe(matches[0]!.title)
    expect(app.inSync()).toBe(true)
    await app.type('Filter', 'zzzz')
    expect(app.texts()).toContain('No tracks match “zzzz”')
    expect(app.inSync()).toBe(true)
  })

  test('keys move the selection and open the detail card', async () => {
    app = await openHeadless('big-list')
    await app.key('down')
    await app.key('down')
    expect(selectedTitle(app.document)).toBe(TRACKS[2]!.title)
    await app.key('enter')
    const card = app.document.querySelector('.detail[role="dialog"]')!
    expect(card.getAttribute('aria-label')).toBe(TRACKS[2]!.title)
    expect(app.texts()).toContain(TRACKS[2]!.album)
    expect(app.nativeOf(card).style).toMatchObject({
      borderTopLeftRadius: 20, boxShadow: { offsetY: 30, blurRadius: 60 },
    })
    expect(app.inSync()).toBe(true)
    await app.key('escape')
    expect(app.texts()).toContain('Pick a track')
  })

  test('Enter in the filter field submits it and opens the selection', async () => {
    app = await openHeadless('big-list')
    await app.type('Filter', 'velvet')
    await app.key('down')
    // A GPUI text field sends `submit` for Enter, not a key.
    app.send(app.document.querySelector('input')!, { eventType: 'submit' } as never)
    await app.settle()
    expect(app.document.querySelector('.detail[role="dialog"]')!.getAttribute('aria-label')).toBe(matching('velvet')[1]!.title)
  })

  test('End scrolls GPUI to the last row; GPUI scrolling brings rows in', async () => {
    app = await openHeadless('big-list')
    const { gpui } = app
    const listId = app.idOf(list(app.document))
    await app.key('end')
    // The app set list.scrollTop, and it went to GPUI.
    expect(gpui.scrollCalls.at(-1)).toEqual({ id: listId, x: 0, y: -(TRACK_COUNT * ROW_HEIGHT - LIST_HEIGHT) })
    expect(selectedTitle(app.document)).toBe(TRACKS[TRACK_COUNT - 1]!.title)
    expect(app.texts()).toContain(TRACKS[TRACK_COUNT - 1]!.title)

    // A wheel in GPUI: GPUI moves, sends `scroll`, the renderer copies the
    // offset into scrollTop, and FoldKit's OnScroll renders the rows there.
    gpui.setScrollOffset(listId, 0, -(4000 * ROW_HEIGHT))
    app.send(listId, { eventType: 'scroll', deltaY: -100 } as never)
    await app.settle()
    expect(list(app.document).scrollTop).toBe(4000 * ROW_HEIGHT)
    expect(app.texts()).toContain(TRACKS[4000]!.title)
    expect(rows(app.document).length).toBeLessThan(60)
    expect(app.inSync()).toBe(true)
  })

  test('the theme switch restyles the GPUI tree with the light tokens', async () => {
    app = await openHeadless('big-list')
    await app.click('Dark theme')
    expect(app.document.querySelector('.app')!.getAttribute('data-theme')).toBe('light')
    expect(app.texts()).toContain('Light')
    expect(app.nativeOf(app.document.querySelector('.app')!).style).toMatchObject({ backgroundColor: '#eef0f5' })
    expect(app.nativeOf(app.document.querySelector('.list-panel')!).style).toMatchObject({ backgroundColor: '#fff' })
    expect(app.nativeOf(rows(app.document)[1]!).style['hover']).toEqual({ backgroundColor: '#f0f2f7' })
    expect(app.inSync()).toBe(true)
  })

  // FKN-12: the switch's track and knob paint fills, and GPUI let a filled
  // child block the hit, so only a click on the label toggled the theme.
  test('a click on the switch\'s track or knob toggles the theme too', async () => {
    app = await openHeadless('big-list')
    const theme = () => app.document.querySelector('.app')!.getAttribute('data-theme')
    const track = app.document.querySelector('.theme-switch-track')!
    const knob = app.document.querySelector('.theme-switch-knob')!
    for (const part of [track, knob]) expect(app.nativeOf(part).style).toMatchObject({ pointerEvents: 'none' })
    await app.click(track)
    expect(theme()).toBe('light')
    await app.click(knob)
    expect(theme()).toBe('dark')
    // The switch itself keeps its hits, and its pointer cursor.
    expect(app.nativeOf(app.document.querySelector('.theme-switch')!).style['pointerEvents']).toBeUndefined()
    expect(app.inSync()).toBe(true)
  })
})

describe.skipIf(!METAL)('Metal, offscreen', () => {
  let app: Metal
  afterEach(() => app?.close())

  /** A wheel over the list, through GPUI's own hit test. */
  const wheel = async (deltaY: number) => {
    const box = app.bounds('Tracks')
    app.renderer.nativeSimulateScrollWheel(box.x + box.width / 2, box.y + box.height / 2, 0, deltaY)
    await app.settle()
  }

  test('GPUI paints the list; typing, keys and the theme switch go through its input', async () => {
    app = await openMetal('big-list')
    expect(app.painted()).toContain('Big List')
    expect(app.painted()).toContain('10,000 of 10,000')
    expect(app.painted()).toContain(TRACKS[0]!.title)
    // Fixed header/toolbar/padding leave the same inset when the host
    // constrains the requested window. Keep the original layout tolerance.
    const expectedHeight = LIST_HEIGHT + app.renderer.getWindowSize().height - app.requestedSize.height
    expect(Math.abs(app.bounds('Tracks').height - expectedHeight)).toBeLessThanOrEqual(4)
    app.screenshot('dark')

    await app.click('Filter')
    await app.keys('v e l v e t')
    expect(app.document.querySelector('input')!.value).toBe('velvet')
    expect(app.painted()).toContain(`${formatCount(matching('velvet').length)} of 10,000`)
    app.screenshot('filtered')

    // Arrows reach the app while the field has focus; Enter submits the field.
    // One key per frame, as a person types (see the PR on keys sharing a frame).
    for (const key of ['down', 'down', 'enter']) await app.keys(key)
    const track = matching('velvet')[2]!
    expect(selectedTitle(app.document)).toBe(track.title)
    expect(app.document.querySelector('.detail[role="dialog"]')?.getAttribute('aria-label')).toBe(track.title)
    expect(app.painted()).toContain('Close')
    expect(app.painted()).toContain(String(track.year))
    app.screenshot('detail')

    await app.click('Dark theme')
    expect(app.document.querySelector('.app')!.getAttribute('data-theme')).toBe('light')
    app.screenshot('light')
  })

  test("the switch's track and knob take the click, through GPUI's hit test", async () => {
    app = await openMetal('big-list')
    const theme = () => app.document.querySelector('.app')!.getAttribute('data-theme')
    await app.click(app.document.querySelector('.theme-switch-track')!)
    expect(theme()).toBe('light')
    app.screenshot('switch-track')
    await app.click(app.document.querySelector('.theme-switch-knob')!)
    expect(theme()).toBe('dark')
    app.screenshot('switch-knob')
  })

  test('a wheel scrolls the list natively and FoldKit renders the rows it reaches', async () => {
    app = await openMetal('big-list')
    await wheel(-3000)
    const scrollTop = list(app.document).scrollTop
    expect(scrollTop).toBeGreaterThan(0)
    const first = Math.floor(scrollTop / ROW_HEIGHT)
    expect(app.painted()).toContain(TRACKS[first + 2]!.title)
    app.screenshot('scrolled')

    // A click in the list selects a row, opens it, and gives the list the
    // keys (the field keeps Home and End for its caret).
    const target = TRACKS[first + 3]!
    await app.click(target.title)
    expect(selectedTitle(app.document)).toBe(target.title)
    expect(app.painted()).toContain('Close')
    await app.keys('escape')
    expect(app.painted()).toContain('Pick a track')
    await app.keys('end')
    expect(selectedTitle(app.document)).toBe(TRACKS[TRACK_COUNT - 1]!.title)
    expect(app.painted()).toContain(TRACKS[TRACK_COUNT - 1]!.title)
    app.screenshot('end')
    await app.keys('home')
    expect(app.painted()).toContain(TRACKS[0]!.title)
  })
})
