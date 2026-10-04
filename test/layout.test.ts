// Layout read back from GPUI. happy-dom has no layout, so the mirror answers
// getBoundingClientRect and document.elementsFromPoint from where GPUI painted
// each element (here, the fake GPUI's setBounds).
import { afterEach, describe, expect, test } from 'bun:test'

import { type Mounted, mountFake } from './support/mount.ts'

let mounted: Mounted
afterEach(() => mounted?.close())

const board = async () => {
  mounted = mountFake()
  await mounted.settle()
  const { container, document, gpui } = mounted
  const column = document.createElement('ul')
  const card = document.createElement('li')
  const ghost = document.createElement('div')
  card.textContent = 'card'
  ghost.style.setProperty('pointer-events', 'none')
  column.appendChild(card)
  container.append(column, ghost)
  await mounted.settle()
  gpui.setBounds(mounted.idOf(document.body as unknown as Node), { x: 0, y: 0, width: 800, height: 600 })
  gpui.setBounds(mounted.idOf(container), { x: 0, y: 0, width: 800, height: 600 })
  gpui.setBounds(mounted.idOf(column), { x: 100, y: 50, width: 200, height: 400 })
  gpui.setBounds(mounted.idOf(card), { x: 110, y: 60, width: 180, height: 40 })
  gpui.setBounds(mounted.idOf(ghost), { x: 100, y: 50, width: 200, height: 100 })
  return { document, container, column, card, ghost }
}

describe('layout, read back from GPUI', () => {
  test('getBoundingClientRect is where GPUI painted the element', async () => {
    const { card } = await board()
    const rect = card.getBoundingClientRect()
    expect([rect.x, rect.y, rect.width, rect.height]).toEqual([110, 60, 180, 40])
    expect([rect.top, rect.left, rect.right, rect.bottom]).toEqual([60, 110, 290, 100])
  })

  test("an element GPUI hasn't laid out is all zeros, as before", async () => {
    const { document } = await board()
    const loose = document.createElement('div')
    const rect = loose.getBoundingClientRect()
    expect([rect.x, rect.y, rect.width, rect.height]).toEqual([0, 0, 0, 0])
  })

  test('elementsFromPoint lists what is under the point, topmost first, skipping pointer-events: none', async () => {
    const { document, container, column, card } = await board()
    expect(document.elementsFromPoint(120, 70)).toEqual([card, column, container, document.body])
    expect(document.elementsFromPoint(120, 300)).toEqual([column, container, document.body])
    expect(document.elementFromPoint(120, 70)).toBe(card)
    expect(document.elementsFromPoint(900, 900)).toEqual([])
    expect(document.elementFromPoint(900, 900)).toBeNull()
  })
})
