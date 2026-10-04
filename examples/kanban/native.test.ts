// Kanban in FoldKit Native: the real app, its CSS and the mirror, driven by
// GPUI's input. FoldKit's own tests (story.test.ts, scene.test.ts) cover the
// app's logic and view; these cover it running natively: a pointer drag from
// one column to another, and a keyboard reorder.
//
// FoldKit's DragAndDrop is pointer events, not HTML drag and drop: a
// pointerdown on the card, then pointermove/pointerup listeners on document,
// with document.elementsFromPoint and getBoundingClientRect finding the drop
// target. GPUI sends a press's moves and release to the pressed card, and the
// mirror answers both from where GPUI painted things. No network: the board
// starts from FoldKit's default columns, in a fresh localStorage each time.
import { afterEach, describe, expect, test } from 'bun:test'

import type { Shape } from '../../test/support/fake-gpui.ts'
import { METAL, type Headless, type Metal, openHeadless, openMetal } from '../support/harness.ts'

/** While a drag lasts, DragAndDrop's auto-scroll runs a requestAnimationFrame
 *  loop, so happy-dom never reports itself idle: wait real time instead. */
const frames = () => new Promise(resolve => setTimeout(resolve, 40))

/** Card titles in a column, top to bottom, as the DOM has them. */
const titles = (document: Document, column: string) =>
  Array.from(document.querySelectorAll(`[data-droppable-id="${column}"] [data-draggable-id]`))
    .map(card => card.querySelector('span')?.textContent)

const cardOf = (document: Document, title: string) =>
  Array.from(document.querySelectorAll('[data-draggable-id]')).find(card => card.querySelector('span')?.textContent === title)!

const RESEARCH = 'Research drag-and-drop patterns'
const DESIGN = 'Design the data model'

describe('headless', () => {
  let app: Headless
  afterEach(() => app?.close())

  /** Every text GPUI holds under a DOM element, in order. */
  const nativeTexts = (element: Element) => {
    const out: Array<string> = []
    const walk = (id: number) => {
      const node = app.mounted.gpui.node(id)
      if (node.type === 'text' && node.text !== undefined) out.push(node.text)
      for (const child of node.children) walk(child)
    }
    walk(app.mounted.idOf(element as unknown as Node))
    return out
  }
  const region = (name: string) => app.document.querySelector(`[role="region"][aria-label="${name}"]`)!
  const announcement = () => nativeTexts(app.document.querySelector('[aria-live]')!)

  /** Headless GPUI doesn't lay out, so give the lists and cards the boxes GPUI
   *  would paint (three columns, cards stacked), for elementsFromPoint. */
  const layOut = () => {
    app.document.querySelectorAll('[data-droppable-id]').forEach((list, column) => {
      const x = 24 + column * 325
      app.mounted.gpui.setBounds(app.mounted.idOf(list as unknown as Node), { x, y: 140, width: 300, height: 560 })
      list.querySelectorAll('li').forEach((card, row) =>
        app.mounted.gpui.setBounds(app.mounted.idOf(card as unknown as Node), { x, y: 140 + row * 92, width: 300, height: 84 }))
    })
  }

  /** A pointer drag as GPUI delivers it: the press to the card under the
   *  pointer, then every move and the release to that same card. */
  const drag = async (title: string, path: ReadonlyArray<readonly [number, number]>) => {
    layOut()
    const id = app.mounted.idOf(cardOf(app.document, title) as unknown as Node)
    const [startX, startY] = [40, 140 + 20 + titles(app.document, 'todo').indexOf(title) * 92]
    app.mounted.send(id, { eventType: 'mouseDown', x: startX, y: startY, button: 0, clickCount: 1 })
    await frames()
    for (const [x, y] of path) {
      app.mounted.send(id, { eventType: 'mouseMove', x, y, pressedButton: 0 })
      await frames()
      layOut()
    }
    const [endX, endY] = path.at(-1)!
    return async () => {
      app.mounted.send(id, { eventType: 'mouseUp', x: endX, y: endY, button: 0, clickCount: 1 })
      await frames()
      await app.settle()
    }
  }

  test('draws the board: columns, counts and cards, with Tailwind styles reaching GPUI', async () => {
    app = await openHeadless('kanban')
    expect(app.texts().slice(0, 4)).toEqual(['Kanban Board', 'TO DO', '6', RESEARCH])
    expect(app.texts()).toContain('IN PROGRESS')
    expect(app.texts()).toContain('DONE')
    expect(app.inSync()).toBe(true)
    // bg-white rounded-lg shadow-sm p-3 on the card; bg-gray-50 on the column.
    const card = app.mounted.nativeOf(cardOf(app.document, RESEARCH) as unknown as Node)
    expect(card.style).toMatchObject({ backgroundColor: '#fff', borderTopLeftRadius: 8, paddingLeft: 12 })
    expect(card.style['boxShadow']).toBeDefined()
    expect(app.mounted.nativeOf(region('To Do') as unknown as Node).style).toMatchObject({ backgroundColor: '#f9fafb' })
  })

  test('a pointer drag moves a card to another column, with a live drop target on the way', async () => {
    app = await openHeadless('kanban')
    // Into In Progress, above its first card.
    const release = await drag(RESEARCH, [[60, 170], [200, 160], [380, 150], [390, 150]])

    // Mid-drag: the ghost follows the pointer, In Progress is the drop target
    // (blue border, a blue placeholder at the top), and the card left To Do.
    const ghost = app.document.querySelector('[aria-hidden="true"][style]')!
    expect(app.mounted.nativeOf(ghost as unknown as Node).style).toMatchObject({ left: 390, top: 150, pointerEvents: 'none' })
    expect(nativeTexts(ghost)).toEqual([RESEARCH, 'Review dnd-kit, elm-draggable, and annaghi/dnd-list for inspiration.'])
    expect(app.mounted.nativeOf(region('In Progress') as unknown as Node).style).toMatchObject({ borderColor: '#90c5ff' })
    const placeholder = app.document.querySelector('[data-droppable-id="in-progress"] li')!
    expect(placeholder.hasAttribute('data-draggable-id')).toBe(false)
    expect(app.mounted.nativeOf(placeholder as unknown as Node).style).toMatchObject({ backgroundColor: '#eff6ff', height: 48 })
    // The card left To Do. GPUI still holds its element there, unseen, because
    // GPUI sends the rest of the gesture to it.
    expect(titles(app.document, 'todo')).not.toContain(RESEARCH)
    const held = app.mounted.gpui.node(app.mounted.idOf(region('To Do').querySelector('ul') as unknown as Node)).children
      .map(id => app.mounted.gpui.node(id)).find(node => node.style['opacity'] === 0)
    expect(held?.style).toEqual({ position: 'absolute', opacity: 0, pointerEvents: 'none' })

    await release()
    expect(titles(app.document, 'in-progress')[0]).toBe(RESEARCH)
    expect(titles(app.document, 'todo')).not.toContain(RESEARCH)
    // GPUI's tree has it in its new column, the counts and the announcement.
    expect(nativeTexts(region('In Progress')).slice(0, 3)).toEqual(['IN PROGRESS', '6', RESEARCH])
    expect(nativeTexts(region('To Do')).slice(0, 3)).toEqual(['TO DO', '5', DESIGN])
    expect(announcement()).toEqual([`Dropped ${RESEARCH} in position 1 of In Progress.`])
    expect(app.inSync()).toBe(true)
    expect(app.mounted.gpui.retainedCount()).toBe(app.mounted.gpui.reachableCount())
  })

  test('a click on a card is not a drag', async () => {
    app = await openHeadless('kanban')
    const before = app.texts()
    const id = app.mounted.idOf(cardOf(app.document, RESEARCH) as unknown as Node)
    app.mounted.send(id, { eventType: 'mouseDown', x: 40, y: 160, button: 0, clickCount: 1 })
    await app.settle()
    app.mounted.send(id, { eventType: 'mouseUp', x: 40, y: 160, button: 0, clickCount: 1 })
    await app.settle()
    expect(app.texts()).toEqual(before)
    expect(app.inSync()).toBe(true)
  })

  test('the keyboard: Space picks a card up, an arrow moves it, Space drops it, each announced', async () => {
    app = await openHeadless('kanban')
    await app.key('space', DESIGN)
    expect(announcement()[0]).toStartWith(`Picked up ${DESIGN}.`)
    // Keyboard dragging: the card itself, blue-bordered, instead of a placeholder.
    expect(app.mounted.nativeOf(cardOf(app.document, DESIGN) as unknown as Node).style).toMatchObject({ borderColor: '#54a2ff' })
    await app.key('up')
    expect(announcement()).toEqual(['Position 1 in To Do.'])
    await app.key('space')
    expect(announcement()).toEqual([`Dropped ${DESIGN} in position 1 of To Do.`])
    expect(titles(app.document, 'todo').slice(0, 2)).toEqual([DESIGN, RESEARCH])
    expect(nativeTexts(region('To Do')).slice(2, 4)).toEqual([DESIGN, 'Card, Column, and Board schemas with fractional indexing for sort order.'])
    expect(app.inSync()).toBe(true)
  })
})

describe.skipIf(!METAL)('Metal, offscreen', () => {
  let app: Metal
  afterEach(() => app?.close())

  const nextFrame = async () => {
    await frames()
    app.renderer.flush()
  }
  /** The painted box of the column (its region) named `name`. */
  const column = (name: string) => app.bounds(name)
  const inside = (box: { x: number; width: number }, x: number) => x >= box.x && x <= box.x + box.width

  test('GPUI paints the board', async () => {
    app = await openMetal('kanban')
    expect(app.painted().slice(0, 4)).toEqual(['Kanban Board', 'TO DO', '6', RESEARCH])
    expect(app.painted()).toContain('IN PROGRESS')
    expect(app.painted()).toContain('+ Add card')
    app.screenshot('board')
  })

  test('a drag through GPUI: press a card, move across, release over another column', async () => {
    app = await openMetal('kanban')
    const card = app.bounds(RESEARCH)
    const target = column('In Progress')
    const [startX, startY] = [card.x + 20, card.y + card.height / 2]
    const [endX, endY] = [target.x + 80, target.y + 90]

    app.renderer.nativeSimulateMouseDown(startX, startY, 0)
    await nextFrame()
    for (let step = 1; step <= 6; step++) {
      app.renderer.nativeSimulateMouseMove(startX + ((endX - startX) * step) / 6, startY + ((endY - startY) * step) / 6, 0)
      await nextFrame()
    }
    // The ghost card, painted under the pointer; the placeholder in In Progress.
    const ghostTitle = app.bounds(RESEARCH)
    expect(Math.abs(ghostTitle.x - endX)).toBeLessThan(40)
    expect(Math.abs(ghostTitle.y - endY)).toBeLessThan(40)
    expect(app.document.querySelector('[data-droppable-id="in-progress"] li:not([data-draggable-id])')).not.toBeNull()
    app.screenshot('dragging')

    app.renderer.nativeSimulateMouseUp(endX, endY, 0)
    await nextFrame()
    await app.settle()
    expect(titles(app.document, 'in-progress')[0]).toBe(RESEARCH)
    // Where GPUI paints it now: in the In Progress column.
    const moved = app.bounds(RESEARCH)
    expect(inside(column('In Progress'), moved.x)).toBe(true)
    expect(app.painted()).toContain(`Dropped ${RESEARCH} in position 1 of In Progress.`)
    app.screenshot('dropped')
  })

  test('the keyboard through GPUI: click a card to focus it, Space, Up, Space', async () => {
    app = await openMetal('kanban')
    // A press, a frame, a release: a real click spans frames, and DragAndDrop
    // only hears the release once its document listener is attached.
    const card = app.bounds(DESIGN)
    app.renderer.nativeSimulateMouseDown(card.x + 5, card.y + 5, 0)
    await nextFrame()
    app.renderer.nativeSimulateMouseUp(card.x + 5, card.y + 5, 0)
    await nextFrame()
    await app.keys('space')
    expect(app.painted().some(text => text.startsWith(`Picked up ${DESIGN}.`))).toBe(true)
    await app.keys('up')
    await nextFrame()
    expect(app.painted()).toContain('Position 1 in To Do.')
    app.screenshot('keyboard-picked')
    await app.keys('space')
    await nextFrame()
    expect(titles(app.document, 'todo').slice(0, 2)).toEqual([DESIGN, RESEARCH])
    expect(app.bounds(DESIGN).y).toBeLessThan(app.bounds(RESEARCH).y)
    expect(app.painted()).toContain(`Dropped ${DESIGN} in position 1 of To Do.`)
    app.screenshot('keyboard-dropped')
  })
})
