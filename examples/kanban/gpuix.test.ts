// Kanban on FoldKit on gpuix (the adapter: no DOM engine), driven by GPUI's
// input: the same app and CSS as native.test.ts runs on the mirror.
//
// FoldKit's DragAndDrop is pointer events: a pointerdown on the card, then
// pointermove and pointerup listeners on document, with
// document.elementsFromPoint and getBoundingClientRect finding the drop
// target. GPUI sends a press's moves and release only to the pressed card;
// the adapter dispatches them there (they bubble to document), holds GPUI's
// card when the drag lifts it out of its list, and answers the geometry from
// GPUI's last layout.
import { afterEach, describe, expect, test } from 'bun:test'

import { type Headless, METAL, mountHeadless, openMetal } from '../../packages/foldkit-gpuix/test/support.ts'
import { loadExample } from '../support/example.ts'

type Metal = Awaited<ReturnType<typeof openMetal>>
type Doc = Headless['document']

/** DragAndDrop's subscriptions start a task or two after the model changes. */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const SLOW = 30_000

/** Card titles in a column, top to bottom, as the DOM has them. */
const titles = (document: Doc, column: string) =>
  document.querySelectorAll(`[data-droppable-id="${column}"] [data-draggable-id]`).map(card => card.querySelector('span')?.textContent)
const cardOf = (document: Doc, title: string) =>
  document.querySelectorAll('[data-draggable-id]').find(card => card.querySelector('span')?.textContent === title)!

/** The card drawn under the pointer while dragging. */
const ghostOf = (document: Doc, title: string) =>
  document.querySelectorAll('[aria-hidden="true"]').find(element => element.textContent.includes(title))!

const RESEARCH = 'Research drag-and-drop patterns'
const DESIGN = 'Design the data model'

describe('headless', () => {
  let app: Headless | undefined
  afterEach(() => {
    app?.close()
    app = undefined
  })
  const open = async () => {
    const example = await loadExample('kanban')
    app = mountHeadless({ css: example.css, viewport: { width: example.meta.width, height: example.meta.height } })
    example.start(app.container)
    await app.settle()
    await app.settle()
    return app
  }
  const region = (name: string) => app!.document.querySelector(`[role="region"][aria-label="${name}"]`)!
  /** Every text GPUI holds under an element, in order. */
  const nativeTexts = (id: number) => {
    const out: Array<string> = []
    const walk = (at: number) => {
      const node = app!.gpui.node(at)
      if (node.type === 'text' && node.text !== undefined) out.push(node.text)
      for (const child of node.children) walk(child)
    }
    walk(id)
    return out
  }

  /** The fake GPUI doesn't lay out: give the lists and cards the boxes GPUI
   *  would paint (three columns, cards stacked), and say it laid out again. */
  const layOut = () => {
    app!.document.querySelectorAll('[data-droppable-id]').forEach((list, column) => {
      const x = 24 + column * 325
      app!.gpui.setBounds(list.nativeId, { x, y: 140, width: 300, height: 560 })
      list.querySelectorAll('li').forEach((card, row) =>
        app!.gpui.setBounds(card.nativeId, { x, y: 140 + row * 92, width: 300, height: 84 }))
    })
    app!.host.relayout()
  }
  const send = (elementId: number, event: Record<string, unknown>) => app!.host.dispatch({ elementId, ...event } as never)
  /** A pointer drag as GPUI delivers it: the press to the card under the
   *  pointer, then every move and the release to that same card. */
  const drag = async (title: string, path: ReadonlyArray<readonly [number, number]>) => {
    layOut()
    const id = cardOf(app!.document, title).nativeId
    const [startX, startY] = [40, 140 + 20 + titles(app!.document, 'todo').indexOf(title) * 92]
    send(id, { eventType: 'mouseDown', x: startX, y: startY, button: 0, clickCount: 1 })
    await sleep(20)
    await app!.settle()
    for (const [x, y] of path) {
      send(id, { eventType: 'mouseMove', x, y, pressedButton: 0 })
      await sleep(20)
      await app!.settle()
      layOut()
    }
    const [endX, endY] = path.at(-1)!
    return { id, release: async () => {
      send(id, { eventType: 'mouseUp', x: endX, y: endY, button: 0, clickCount: 1 })
      await sleep(20)
      await app!.settle()
    } }
  }

  test('a pointer drag moves a card to another column, with a live drop target on the way', async () => {
    await open()
    expect(titles(app!.document, 'todo')[0]).toBe(RESEARCH)
    // Into In Progress, above its first card.
    const { id, release } = await drag(RESEARCH, [[60, 170], [200, 160], [380, 150], [390, 150]])

    // Mid-drag: the ghost follows the pointer and lets hits through, In
    // Progress is the drop target (a placeholder at its top), and the card
    // left To Do.
    const ghost = ghostOf(app!.document, RESEARCH)
    expect(app!.gpui.node(ghost.nativeId).style).toMatchObject({ left: 390, top: 150, pointerEvents: 'none' })
    const placeholder = app!.document.querySelector('[data-droppable-id="in-progress"] li')!
    expect(placeholder.hasAttribute('data-draggable-id')).toBe(false)
    expect(titles(app!.document, 'todo')).not.toContain(RESEARCH)
    // GPUI still has the card's element, unseen, because it sends the rest
    // of the gesture there.
    expect(app!.gpui.node(id).style).toEqual({ position: 'absolute', opacity: 0, pointerEvents: 'none' })
    // Still listening: snabbdom took the card's listeners off as it removed
    // it, and real GPUI would stop sending the gesture.
    expect([...app!.gpui.node(id).listeners]).toEqual(expect.arrayContaining(['mouseMove', 'mouseUp']))

    await release()
    expect(titles(app!.document, 'in-progress')[0]).toBe(RESEARCH)
    expect(titles(app!.document, 'todo')).not.toContain(RESEARCH)
    expect(nativeTexts(region('In Progress').nativeId).slice(0, 3)).toEqual(['IN PROGRESS', '6', RESEARCH])
    expect(app!.document.querySelector('[aria-live]')!.textContent).toBe(`Dropped ${RESEARCH} in position 1 of In Progress.`)
    // The held element went with the release: nothing GPUI holds is unreachable.
    await app!.settle()
    expect(app!.gpui.retainedCount()).toBe(app!.gpui.reachableCount())
  })

  test('a click on a card is not a drag, and leaves the board ready for the keyboard', async () => {
    await open()
    const id = cardOf(app!.document, DESIGN).nativeId
    send(id, { eventType: 'mouseDown', x: 40, y: 260, button: 0, clickCount: 1 })
    await sleep(20)
    await app!.settle()
    send(id, { eventType: 'mouseUp', x: 40, y: 260, button: 0, clickCount: 1 })
    await sleep(20)
    await app!.settle()
    expect(titles(app!.document, 'todo').slice(0, 2)).toEqual([RESEARCH, DESIGN])
    // The release reached document: the press is over, so Space picks up.
    cardOf(app!.document, DESIGN).focus()
    await app!.press('space')
    expect(app!.document.querySelector('[aria-live]')!.textContent).toStartWith(`Picked up ${DESIGN}.`)
  })
})

describe.skipIf(!METAL)('Metal, offscreen', () => {
  let app: Metal | undefined
  afterEach(() => {
    app?.close()
    app = undefined
  })
  const open = async () => {
    const example = await loadExample('kanban')
    app = await openMetal('gpuix-kanban', { width: example.meta.width, height: example.meta.height }, { css: example.css })
    example.start(app.container)
    await app.settle()
    await app.settle()
    return app
  }
  const nextFrame = async () => {
    await sleep(40)
    await app!.settle()
  }

  test('a drag through GPUI: press a card, move across, release over another column', async () => {
    await open()
    app!.screenshot('board')
    const card = app!.bounds(cardOf(app!.document, RESEARCH))
    // Released over the top of In Progress's first card: above its middle, so
    // the card goes in first.
    const first = app!.bounds(cardOf(app!.document, 'Build the DragAndDrop component'))
    const [startX, startY] = [card.x + 20, card.y + card.height / 2]
    const [endX, endY] = [first.x + 20, first.y + 2]

    app!.renderer.nativeSimulateMouseDown(startX, startY, 0)
    await nextFrame()
    for (let step = 1; step <= 6; step++) {
      app!.renderer.nativeSimulateMouseMove(startX + ((endX - startX) * step) / 6, startY + ((endY - startY) * step) / 6, 0)
      await nextFrame()
    }
    // The ghost card, painted under the pointer; the placeholder in In Progress.
    const ghost = ghostOf(app!.document, RESEARCH)
    const painted = app!.bounds(ghost)
    expect(Math.abs(painted.x - endX)).toBeLessThan(40)
    expect(Math.abs(painted.y - endY)).toBeLessThan(40)
    expect(app!.document.querySelector('[data-droppable-id="in-progress"] li:not([data-draggable-id])')).not.toBeNull()
    app!.screenshot('dragging')

    app!.renderer.nativeSimulateMouseUp(endX, endY, 0)
    await nextFrame()
    expect(titles(app!.document, 'in-progress')[0]).toBe(RESEARCH)
    // Where GPUI paints it now: in the In Progress column.
    const column = app!.bounds(app!.document.querySelector('[data-droppable-id="in-progress"]')!)
    const moved = app!.bounds(cardOf(app!.document, RESEARCH))
    expect(moved.x).toBeGreaterThanOrEqual(column.x)
    expect(moved.x).toBeLessThan(column.x + column.width)
    expect(app!.document.querySelector('[aria-live]')!.textContent).toBe(`Dropped ${RESEARCH} in position 1 of In Progress.`)
    app!.screenshot('dropped')
  }, SLOW)

  test('a click through GPUI focuses a card; Space, Up, Space moves it', async () => {
    await open()
    // A press, a frame, a release: a real click spans frames.
    const card = app!.bounds(cardOf(app!.document, DESIGN))
    app!.renderer.nativeSimulateMouseDown(card.x + 5, card.y + 5, 0)
    await nextFrame()
    app!.renderer.nativeSimulateMouseUp(card.x + 5, card.y + 5, 0)
    await nextFrame()
    await app!.keys('space')
    expect(app!.document.querySelector('[aria-live]')!.textContent).toStartWith(`Picked up ${DESIGN}.`)
    await app!.keys('up')
    await app!.keys('space')
    await nextFrame()
    expect(titles(app!.document, 'todo').slice(0, 2)).toEqual([DESIGN, RESEARCH])
    expect(app!.bounds(cardOf(app!.document, DESIGN)).y).toBeLessThan(app!.bounds(cardOf(app!.document, RESEARCH)).y)
  }, SLOW)
})
