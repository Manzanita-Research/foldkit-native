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

  test("gpuix's bounds start at the content corner and leave the borders out: the painted box comes back", async () => {
    const { card } = await board()
    card.setAttribute('style', 'padding: 5px 7px 9px 11px; border-style: solid; border-width: 1px 2px 3px 4px; border-color: black')
    await mounted.settle()
    // Measured on Metal: this box, laid out at (110, 60, 180, 40), is reported as (125, 66, 174, 36).
    expect(mounted.gpui.renderer.getElementBounds!(mounted.idOf(card))).toEqual({ x: 125, y: 66, width: 174, height: 36 })
    const rect = card.getBoundingClientRect()
    expect([rect.x, rect.y, rect.width, rect.height]).toEqual([110, 60, 180, 40])
    expect(mounted.document.elementFromPoint(111, 61)).toBe(card) // inside its border and padding
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

describe('aspect-ratio, from the laid-out width', () => {
  // gpuix has no aspect-ratio, so the mirror sets the height once GPUI has
  // laid out the width (the host calls afterLayout after each frame).
  const shapes = async () => {
    mounted = mountFake({ css: '.square { aspect-ratio: 1 / 1; } .wide { aspect-ratio: 16 / 9; } .tall { height: 40px; aspect-ratio: 1; } .red { color: red; }' })
    await mounted.settle()
    const make = (className: string) => {
      const div = mounted.document.createElement('div')
      div.className = className
      mounted.container.appendChild(div)
      return div
    }
    const [square, wide, tall] = [make('square'), make('wide'), make('tall')]
    await mounted.settle()
    const lay = (node: Node, width: number) => mounted.gpui.setBounds(mounted.idOf(node), { x: 0, y: 0, width, height: 0 })
    const height = (node: Node) => mounted.nativeOf(node).style?.['height']
    return { square, wide, tall, lay, height }
  }

  test('an auto height follows the width GPUI laid out, by the ratio', async () => {
    const { square, wide, tall, lay, height } = await shapes()
    expect(height(square)).toBeUndefined()
    lay(square, 300)
    lay(wide, 160)
    lay(tall, 100)
    expect(mounted.mirror.afterLayout()).toBe(true)
    expect(height(square)).toBe(300)
    expect(height(wide)).toBe(90)
    // A set height wins over the ratio, as in CSS.
    expect(height(tall)).toBe(40)
  })

  test('one pass per width change: the same widths change nothing, a new one corrects again', async () => {
    const { square, lay, height } = await shapes()
    lay(square, 300)
    expect(mounted.mirror.afterLayout()).toBe(true)
    expect(mounted.mirror.afterLayout()).toBe(false)
    lay(square, 200)
    expect(mounted.mirror.afterLayout()).toBe(true)
    expect(height(square)).toBe(200)
  })

  test('a restyle keeps the height it was given', async () => {
    const { square, lay, height } = await shapes()
    lay(square, 120)
    mounted.mirror.afterLayout()
    square.classList.add('red')
    await mounted.settle()
    expect(height(square)).toBe(120)
    expect(mounted.mirror.afterLayout()).toBe(false)
  })
})
