// VirtualList: its update (story), then on FoldKit on gpuix, headless and on
// Metal in both themes, where the rows sit in GPUI's own virtual-list; then
// the same 10,000 rows against Big List's (rows and spacers in a scroll area).
import { describe, expect as bunExpect, test } from 'bun:test'
import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'

import { openMetal } from '../../foldkit-gpuix/test/support.ts'
import { loadExample } from '../../../examples/support/example.ts'
import * as VirtualList from '../src/virtual-list.ts'
import { BigTracks, TRACK_COUNT, Tracks } from './apps-overlays.ts'
import { METAL, THEMES, headless, metal } from './run.ts'

const PAGE = VirtualList.viewportRows({ height: 200, rowHeight: 32 })
const key = (key: string) => VirtualList.Message.PressedKey({ key, count: TRACK_COUNT, pageRows: PAGE })

describe('story', () => {
  test('keys move the highlight and scroll it into view; the window follows a highlight that leaves it', () => {
    story(
      VirtualList.update,
      given(VirtualList.init({ id: 'tracks' })),
      message(key('ArrowDown')),
      Command.expectExact(VirtualList.ScrollIntoView({ elementId: 'tracks-row-1' })),
      Command.resolve(VirtualList.ScrollIntoView, VirtualList.Message.CompletedScrollIntoView()),
      model(next => bunExpect(next).toMatchObject({ highlighted: 1, windowStart: 0 })),
      message(key('End')),
      Command.expectExact(VirtualList.ScrollIntoView({ elementId: 'tracks-row-9999' })),
      Command.resolve(VirtualList.ScrollIntoView, VirtualList.Message.CompletedScrollIntoView()),
      // The last row near the window's bottom: the window is the last rows.
      model(next => bunExpect(next).toMatchObject({ highlighted: 9999, windowStart: TRACK_COUNT - PAGE - 2 * VirtualList.OVERSCAN })),
      message(key('PageUp')),
      Command.resolve(VirtualList.ScrollIntoView, VirtualList.Message.CompletedScrollIntoView()),
      model(next => bunExpect(next.highlighted).toBe(9999 - PAGE)),
      message(key('Home')),
      Command.resolve(VirtualList.ScrollIntoView, VirtualList.Message.CompletedScrollIntoView()),
      model(next => bunExpect(next).toMatchObject({ highlighted: 0, windowStart: 0 })),
      // At the top already: nothing to do.
      message(key('ArrowUp')),
      Command.expectNone(),
    )
  })

  test('the window follows the scroll, half an overscan behind; a choice is the parent\'s cue', () => {
    const showed = (start: number) => VirtualList.Message.ShowedRows({ start, count: TRACK_COUNT, pageRows: PAGE })
    story(
      VirtualList.update,
      given(VirtualList.init({ id: 'tracks' })),
      message(showed(5)),
      model(next => bunExpect(next.windowStart).toBe(0)),
      message(showed(500)),
      model(next => bunExpect(next.windowStart).toBe(500 - VirtualList.OVERSCAN)),
      message(showed(505)),
      model(next => bunExpect(next.windowStart).toBe(480)),
      message(showed(9998)),
      model(next => bunExpect(next.windowStart).toBe(TRACK_COUNT - PAGE - 2 * VirtualList.OVERSCAN)),
    )
    bunExpect(VirtualList.chosen(VirtualList.Message.Chose({ index: 42 }))).toEqual(Option.some(42))
    bunExpect(VirtualList.chosen(key('End'))).toEqual(Option.none())
  })
})

const id = (element: { getAttribute: (name: string) => string | null } | null | undefined) => element?.getAttribute('id') ?? null

describe('native, headless', () => {
  test('GPUI\'s virtual-list holds a window of rows, not 10,000; keys move the highlight and GPUI scrolls to its row; Enter chooses', async () => {
    const app = await headless(Tracks)
    try {
      const list = app.document.querySelector('[data-ui="virtual-list"][data-part="viewport"]')!
      const native = () => app.gpui.node(list.nativeId)
      bunExpect(native().type).toBe('virtual-list')
      bunExpect(native().props).toMatchObject({ itemCount: TRACK_COUNT, estimatedItemHeight: 32, windowStart: 0 })
      bunExpect(list.children.length).toBe(VirtualList.windowSize({ height: 200, rowHeight: 32 }))
      bunExpect(app.gpui.reachableCount()).toBeLessThan(400)
      app.gpui.setBounds(list.nativeId, { x: 17, y: 69, width: 446, height: 198 })

      // One tab stop, the highlight its active descendant.
      await app.press('tab')
      await app.press('tab')
      const box = app.document.getElementById('tracks')!
      bunExpect(id(app.document.activeElement)).toBe('tracks')
      bunExpect(app.gpui.node(box.nativeId).props).toMatchObject({ role: 'listbox', 'aria-label': 'Tracks', tabIndex: 0 })
      for (let i = 0; i < 3; i++) await app.press('down')
      bunExpect(box.getAttribute('aria-activedescendant')).toBe('tracks-row-3')
      bunExpect(app.gpui.node(app.document.getElementById('tracks-row-3')!.nativeId).props).toMatchObject({ role: 'option' })

      // End: the window moves to the last rows, and GPUI scrolls row 9,999
      // to the viewport's bottom (its top 166 px above the row: 198 - 32).
      await app.press('end')
      bunExpect(box.getAttribute('aria-activedescendant')).toBe('tracks-row-9999')
      bunExpect(native().props['windowStart']).toBe(TRACK_COUNT - VirtualList.windowSize({ height: 200, rowHeight: 32 }))
      bunExpect(app.document.getElementById('tracks-row-9999')).not.toBeNull()
      bunExpect(app.fake.gpui.itemScrolls.at(-1)).toEqual({ id: list.nativeId, index: 9999, offset: -166 })
      // Up a row: it's in view (by the list's anchor), so no scroll.
      const scrolls = app.fake.gpui.itemScrolls.length
      await app.press('up')
      bunExpect(app.fake.gpui.itemScrolls.length).toBe(scrolls)
      await app.press('enter')
      bunExpect(app.texts()).toContain('Picked: Track 9999')
      bunExpect(app.document.getElementById('tracks-row-9998')!.getAttribute('aria-selected')).toBe('true')
    } finally {
      app.close()
    }
  })

  test('GPUI scrolling the list (its visibleRange) is a scroll with the list\'s scrollTop: the window follows', async () => {
    const app = await headless(Tracks)
    try {
      const list = app.document.querySelector('[data-ui="virtual-list"][data-part="viewport"]')!
      // GPUI scrolled to row 3,000 (the wheel), and says so.
      ;(app.fake.renderer as unknown as { scrollToItem: (id: number, index: number, offset: number) => void }).scrollToItem(list.nativeId, 3000, 0)
      app.host.dispatch({ eventType: 'visibleRange', elementId: list.nativeId, startIndex: 3000, endIndex: 3007 } as never)
      await app.settle()
      bunExpect(list.scrollTop).toBe(3000 * 32)
      bunExpect(app.model().list.windowStart).toBe(3000 - VirtualList.OVERSCAN)
      bunExpect(app.gpui.node(list.nativeId).props['windowStart']).toBe(3000 - VirtualList.OVERSCAN)
      bunExpect(app.document.getElementById('tracks-row-3000')).not.toBeNull()
      // scrollTop from script scrolls GPUI's list to that row.
      list.scrollTop = 32 * 120 + 10
      bunExpect(app.fake.gpui.itemScrolls.at(-1)).toEqual({ id: list.nativeId, index: 120, offset: 10 })
    } finally {
      app.close()
    }
  })

  for (const theme of ['paper', 'dusk'] as const) {
    test(`${theme}: the surface, and the highlighted and chosen rows`, async () => {
      const app = await headless(Tracks, theme)
      try {
        const tokens = THEMES[theme]
        app.document.getElementById('tracks')!.focus()
        await app.settle()
        await app.press('down')
        await app.press('enter')
        const style = (rowId: string) => app.gpui.node(app.document.getElementById(rowId)!.nativeId).style
        bunExpect(app.gpui.node(app.document.getElementById('tracks')!.nativeId).style).toMatchObject({ backgroundColor: tokens['color.surface'] })
        bunExpect(style('tracks-row-1')).toMatchObject({ backgroundColor: tokens['color.highlight'], height: 32 })
        bunExpect(getComputedStyle(app.document.getElementById('tracks-row-1') as never).getPropertyValue('color')).toBe(tokens['color.accent'])
        bunExpect(style('tracks-row-2')['hover']).toMatchObject({ backgroundColor: tokens['color.highlight'] })
      } finally {
        app.close()
      }
    })
  }
})

describe.skipIf(!METAL)('native, Metal', () => {
  for (const theme of ['paper', 'dusk'] as const) {
    test(`${theme}: 10,000 rows, the keyboard to the end and back, a click; GPUI paints only what shows; AccessKit`, async () => {
      const app = await metal('virtual-list', Tracks, theme)
      try {
        const rows = () => app.painted().filter(text => text.startsWith('Track '))
        bunExpect(rows()[0]).toBe('Track 1')
        bunExpect(rows().length).toBeLessThanOrEqual(8)
        app.screenshot('top')

        const box = app.document.getElementById('tracks')!
        box.focus()
        await app.settle()
        await app.press('end')
        await app.settle()
        bunExpect(box.getAttribute('aria-activedescendant')).toBe('tracks-row-9999')
        bunExpect(rows()).toContain('Track 10000')
        // At the viewport's bottom: its row's bottom is the list's, inside
        // its border and padding (1 + 4 px).
        const last = app.document.getElementById('tracks-row-9999')!.getBoundingClientRect()
        const outer = box.getBoundingClientRect()
        console.log(`ui virtual-list ${theme}:`, JSON.stringify({ last, outer, painted: rows() }))
        bunExpect(Math.abs(last.y + last.height - (outer.y + outer.height - 5))).toBeLessThanOrEqual(1)
        app.screenshot('end')

        const tree = JSON.stringify(app.renderer.getA11yTree()).toLowerCase()
        for (const role of ['"listbox"', '"listboxoption"']) bunExpect(tree).toContain(role)

        await app.press('pageup')
        await app.press('home')
        await app.settle()
        bunExpect(rows()[0]).toBe('Track 1')
        await app.click(app.document.getElementById('tracks-row-2')!)
        bunExpect(app.painted()).toContain('Picked: Track 3')
        app.screenshot('picked')
      } finally {
        app.close()
      }
    })
  }

  test('the wheel scrolls GPUI\'s list, and the window follows it: rows are there to paint', async () => {
    const app = await metal('virtual-list-wheel', Tracks)
    try {
      const box = app.document.getElementById('tracks')!.getBoundingClientRect()
      const rows = () => app.painted().filter(text => text.startsWith('Track '))
      for (let i = 0; i < 6; i++) {
        app.renderer.nativeSimulateScrollWheel(box.x + 40, box.y + 40, 0, -400)
        await app.settle()
        await app.settle()
      }
      const list = app.document.querySelector('[data-ui="virtual-list"][data-part="viewport"]')!
      console.log('ui virtual-list wheel:', JSON.stringify({ scrollTop: list.scrollTop, windowStart: app.model().list.windowStart, painted: rows() }))
      bunExpect(list.scrollTop).toBeGreaterThan(2000)
      bunExpect(rows().length).toBeGreaterThan(4)
      bunExpect(app.model().list.windowStart).toBeGreaterThan(0)
    } finally {
      app.close()
    }
  })

  test('against Big List: the same 10,000 rows at its size, GPUI\'s tree and the time per key', async () => {
    type Opened = Awaited<ReturnType<typeof openMetal>>
    const measure = async (app: Opened, focus: () => void) => {
      focus()
      await app.settle()
      const times: Array<number> = []
      for (let i = 0; i < 20; i++) {
        const started = performance.now()
        await app.press('down')
        times.push(performance.now() - started)
      }
      const started = performance.now()
      await app.press('end')
      const end = performance.now() - started
      times.sort((a, b) => a - b)
      return { retained: app.renderer.getRetainedElementCount(), keyMedianMs: times[10]!, keyP90Ms: times[18]!, endMs: end }
    }
    const example = await loadExample('big-list')
    const size = { width: example.meta.width, height: example.meta.height }
    const big = await openMetal('compare-big-list', size, { css: example.css })
    example.start(big.container)
    await big.settle()
    const bigList = await measure(big, () => big.document.getElementById('tracks')!.focus())
    const bigEnd = big.painted()
    big.close()

    const tracks = await metal('compare-virtual-list', BigTracks, 'dusk', size)
    const virtualList = await measure(tracks as never, () => tracks.document.getElementById('tracks')!.focus())
    const tracksEnd = tracks.painted()
    tracks.close()
    console.log('ui virtual-list vs big list:', JSON.stringify({ bigList, virtualList }))
    bunExpect(bigEnd.some(text => text.length > 0)).toBe(true)
    bunExpect(tracksEnd).toContain('Track 10000')
    // Both keep GPUI's tree to a window: well under 10,000 rows' worth.
    bunExpect(virtualList.retained).toBeLessThan(1000)
  })
})
