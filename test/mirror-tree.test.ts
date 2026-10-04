// DOM → GPUI tree. Every DOM change must leave the native tree equal to what
// the DOM says it should be (`inSync`), with no element left alive off-tree.
import { afterEach, describe, expect, test } from 'bun:test'

import { type Mounted, mountFake } from './support/mount.ts'

let mounted: Mounted
afterEach(() => mounted?.close())

const setup = async (css = '') => {
  mounted = mountFake({ css })
  await mounted.settle()
  return mounted
}
const el = (tag: string, text?: string, attrs: Record<string, string> = {}) => {
  const node = mounted.document.createElement(tag)
  if (text !== undefined) node.textContent = text
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value)
  return node
}
const labels = (parent: Element) => mounted.nativeOf(parent).children.map(id => {
  const child = mounted.gpui.node(id)
  return child.type === 'text' ? child.text : mounted.gpui.node(child.children[0]!).text
})
const noLeaks = () => expect(mounted.gpui.retainedCount()).toBe(mounted.gpui.reachableCount())

describe('structure', () => {
  test('body is the native root; the FoldKit container is its child', async () => {
    const { gpui, document, container } = await setup()
    expect(gpui.tree()).toEqual({ type: 'div', children: [{ type: 'div' }] })
    expect(mounted.idOf(document.body)).toBeDefined()
    expect(mounted.idOf(container)).toBeDefined()
    expect(mounted.inSync()).toBe(true)
  })

  test('nested elements and text are created in order', async () => {
    const { container } = await setup()
    const list = el('ul')
    for (const label of ['one', 'two', 'three']) list.appendChild(el('li', label))
    container.appendChild(list)
    container.appendChild(el('p', 'after'))
    await mounted.settle()
    expect(mounted.inSync()).toBe(true)
    expect(labels(list)).toEqual(['one', 'two', 'three'])
  })

  test('style, script, comments and empty text are not drawn', async () => {
    const { container, document } = await setup()
    container.appendChild(el('style', '.x { color: red; }'))
    container.appendChild(el('script', 'void 0'))
    container.appendChild(document.createComment('note'))
    container.appendChild(document.createTextNode(''))
    container.appendChild(el('span', 'kept'))
    await mounted.settle()
    expect(mounted.nativeOf(container).children).toHaveLength(1)
    expect(mounted.inSync()).toBe(true)
  })

  test('input, textarea and img become native elements', async () => {
    const { container } = await setup()
    container.append(el('input'), el('textarea'), el('img'))
    await mounted.settle()
    expect(mounted.nativeOf(container).children.map(id => mounted.gpui.node(id).type)).toEqual(['input', 'textarea', 'img'])
  })
})

describe('insert, remove, reorder', () => {
  const list = async (items: Array<string>) => {
    const { container } = await setup()
    const ul = el('ul')
    for (const label of items) ul.appendChild(el('li', label))
    container.appendChild(ul)
    await mounted.settle()
    return ul
  }

  test('insert at the start, middle and end', async () => {
    const ul = await list(['b', 'd'])
    ul.insertBefore(el('li', 'a'), ul.firstChild)
    ul.insertBefore(el('li', 'c'), ul.children[2]!)
    ul.appendChild(el('li', 'e'))
    await mounted.settle()
    expect(labels(ul)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(mounted.inSync()).toBe(true)
  })

  test('remove frees the native subtree and its handlers', async () => {
    const ul = await list(['a', 'b', 'c'])
    const b = ul.children[1]!
    b.addEventListener('click', () => {})
    await mounted.settle()
    const id = mounted.idOf(b)
    expect(mounted.send(id, { eventType: 'click' } as never)).toBe(true)
    b.remove()
    await mounted.settle()
    expect(labels(ul)).toEqual(['a', 'c'])
    expect(mounted.inSync()).toBe(true)
    noLeaks()
    expect(mounted.send(id, { eventType: 'click' } as never)).toBe(false)
  })

  test('reorder moves the same native elements', async () => {
    const ul = await list(['a', 'b', 'c', 'd'])
    const before = new Map(Array.from(ul.children).map(li => [li.textContent, mounted.idOf(li)]))
    ul.appendChild(ul.children[0]!) // a to the end
    ul.insertBefore(ul.children[2]!, ul.children[0]!) // d to the front
    await mounted.settle()
    expect(labels(ul)).toEqual(['d', 'b', 'c', 'a'])
    for (const li of Array.from(ul.children)) expect(mounted.idOf(li)).toBe(before.get(li.textContent)!)
    noLeaks()
  })

  test('replacing every child (innerHTML) leaves nothing behind', async () => {
    const ul = await list(['a', 'b', 'c'])
    ul.innerHTML = '<li>x</li><li>y</li>'
    await mounted.settle()
    expect(labels(ul)).toEqual(['x', 'y'])
    noLeaks()
  })

  test('moving a subtree to another parent keeps it alive', async () => {
    const { container } = await setup()
    const left = el('div'); const right = el('div')
    const item = el('p', 'moving')
    left.appendChild(item)
    container.append(left, right)
    await mounted.settle()
    const id = mounted.idOf(item)
    right.appendChild(item)
    await mounted.settle()
    expect(mounted.idOf(item)).toBe(id)
    expect(mounted.nativeOf(right).children).toEqual([id])
    expect(mounted.inSync()).toBe(true)
    noLeaks()
  })

  test('a thousand random edits stay in sync', async () => {
    const { container } = await setup()
    let seed = 7
    const random = (n: number) => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n
    const all: Array<HTMLElement> = [container]
    for (let step = 0; step < 1000; step++) {
      const parent = all[random(all.length)]!
      const op = random(4)
      if (op === 0 || parent.children.length === 0) {
        const child = el(random(2) === 0 ? 'div' : 'span', `n${step}`)
        parent.insertBefore(child, parent.children[random(parent.children.length + 1)] ?? null)
        all.push(child)
      } else if (op === 1 && parent !== container) {
        parent.remove()
        all.splice(0, all.length, container, ...Array.from(container.querySelectorAll('*')) as Array<HTMLElement>)
      } else if (op === 2) {
        parent.appendChild(parent.children[random(parent.children.length)]!)
      } else {
        parent.firstChild!.textContent = `t${step}`
        all.splice(0, all.length, container, ...Array.from(container.querySelectorAll('*')) as Array<HTMLElement>)
      }
      if (step % 50 === 0) await mounted.settle()
    }
    await mounted.settle()
    expect(mounted.inSync()).toBe(true)
    noLeaks()
  })
})

describe('text and attributes', () => {
  test('text changes reach the native text node', async () => {
    const { container } = await setup()
    const p = el('p', 'before')
    container.appendChild(p)
    await mounted.settle()
    const textId = mounted.nativeOf(p).children[0]!
    p.firstChild!.textContent = 'after'
    await mounted.settle()
    expect(mounted.gpui.node(textId).text).toBe('after')
    expect(mounted.inSync()).toBe(true)
  })

  test('text-transform is applied to the text itself', async () => {
    const { container } = await setup('.loud { text-transform: uppercase; } .quiet { text-transform: lowercase; }')
    container.append(el('p', 'Hello', { class: 'loud' }), el('p', 'Hello', { class: 'quiet' }))
    await mounted.settle()
    const [loud, quiet] = Array.from(container.children)
    expect(mounted.gpui.node(mounted.nativeOf(loud!).children[0]!).text).toBe('HELLO')
    expect(mounted.gpui.node(mounted.nativeOf(quiet!).children[0]!).text).toBe('hello')
  })

  test('a class change restyles the element and the text inside it', async () => {
    const { container } = await setup('.a { color: #111111; padding: 4px; } .b { color: #222222; padding: 8px; }')
    const p = el('p', 'x', { class: 'a' })
    container.appendChild(p)
    await mounted.settle()
    const text = () => mounted.gpui.node(mounted.nativeOf(p).children[0]!)
    expect(mounted.nativeOf(p).style['paddingTop']).toBe(4)
    expect(text().style['color']).toBe('#111111')
    p.className = 'b'
    await mounted.settle()
    expect(mounted.nativeOf(p).style['paddingTop']).toBe(8)
    expect(text().style['color']).toBe('#222222')
  })

  test('an ancestor attribute change re-matches descendant selectors', async () => {
    const { container } = await setup('[data-kind="a"] .dot { background-color: #aa0000; } [data-kind="b"] .dot { background-color: #0000bb; }')
    const card = el('div', undefined, { 'data-kind': 'a' })
    const dot = el('span', 'o', { class: 'dot' })
    card.appendChild(dot)
    container.appendChild(card)
    await mounted.settle()
    expect(mounted.nativeOf(dot).style['backgroundColor']).toBe('#aa0000')
    card.setAttribute('data-kind', 'b')
    await mounted.settle()
    expect(mounted.nativeOf(dot).style['backgroundColor']).toBe('#0000bb')
  })

  test('an ancestor attribute change re-matches descendant hover rules', async () => {
    const { container } = await setup('[data-kind="a"] .dot:hover { background-color: #aa0000; }')
    const card = el('div', undefined, { 'data-kind': 'a' })
    const dot = el('span', 'o', { class: 'dot' })
    card.appendChild(dot)
    container.appendChild(card)
    await mounted.settle()
    expect(mounted.nativeOf(dot).style['hover']).toEqual({ backgroundColor: '#aa0000' })
    card.setAttribute('data-kind', 'b')
    await mounted.settle()
    expect(mounted.nativeOf(dot).style['hover']).toBeUndefined()
  })

  test('inline style attribute changes restyle', async () => {
    const { container } = await setup()
    const box = el('div')
    container.appendChild(box)
    await mounted.settle()
    box.setAttribute('style', 'width: 120px; opacity: 0.5')
    await mounted.settle()
    expect(mounted.nativeOf(box).style['width']).toBe(120)
  })

  test('ARIA, tabindex, autofocus and motion travel as gpuix props', async () => {
    const { container } = await setup()
    const button = el('div', 'Go', {
      role: 'button', 'aria-label': 'Go now', 'aria-expanded': 'false', tabindex: '0', autofocus: '',
      'data-fn-motion': '{"initial":{"opacity":0},"animate":{"opacity":1}}',
    })
    const bad = el('div', 'x', { 'data-fn-motion': 'not json' })
    container.append(button, bad)
    await mounted.settle()
    expect(mounted.nativeOf(button).props).toEqual({
      role: 'button', 'aria-label': 'Go now', 'aria-expanded': 'false', tabIndex: 0, autoFocus: true,
      motion: { initial: { opacity: 0 }, animate: { opacity: 1 } },
    })
    expect(mounted.nativeOf(bad).props).toEqual({})
  })

  test('inputs carry value and placeholder; images src, alt and object-fit', async () => {
    const { container } = await setup('img { object-fit: cover; }')
    const input = el('input', undefined, { placeholder: 'Search' }) as HTMLInputElement
    input.value = 'abc'
    container.append(input, el('img', undefined, { src: 'data:image/png;base64,AA==', alt: 'dot' }))
    await mounted.settle()
    expect(mounted.nativeOf(input).props).toMatchObject({ value: 'abc', placeholder: 'Search' })
    expect(mounted.nativeOf(container.children[1]!).props).toMatchObject({ src: 'data:image/png;base64,AA==', alt: 'dot', objectFit: 'cover' })
  })

  test("a textarea's text is its value, not a native child", async () => {
    // FoldKit writes a textarea's value as its text, as HTML does.
    const { container } = await setup()
    const textarea = el('textarea') as HTMLTextAreaElement
    container.append(textarea)
    await mounted.settle()
    textarea.textContent = 'Hello'
    await mounted.settle()
    expect(mounted.nativeOf(textarea).children).toEqual([])
    expect(mounted.nativeOf(textarea).props['value']).toBe('Hello')
    textarea.firstChild!.textContent = 'Hello there'
    await mounted.settle()
    expect(mounted.nativeOf(textarea).props['value']).toBe('Hello there')
    expect(mounted.inSync()).toBe(true)
    noLeaks()
  })

  test('mixed inline content becomes a wrapping row', async () => {
    const { container } = await setup()
    const p = el('p')
    p.append('a ', el('b', 'bold'), ' c')
    container.appendChild(p)
    await mounted.settle()
    expect(mounted.nativeOf(p).style).toMatchObject({ display: 'flex', flexDirection: 'row', flexWrap: 'wrap' })
  })
})
