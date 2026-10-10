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

  test('text that starts empty and gets content (an aria-live announcement) appears, and goes when emptied', async () => {
    const { container } = await setup()
    const live = el('div', '', { 'aria-live': 'assertive' })
    live.appendChild(mounted.document.createTextNode(''))
    container.appendChild(live)
    await mounted.settle()
    expect(mounted.nativeOf(live).children).toEqual([])
    live.firstChild!.textContent = 'Picked up Fix bug.'
    await mounted.settle()
    expect(labels(live)).toEqual(['Picked up Fix bug.'])
    expect(mounted.inSync()).toBe(true)
    live.firstChild!.textContent = ''
    await mounted.settle()
    expect(mounted.nativeOf(live).children).toEqual([])
    expect(mounted.inSync()).toBe(true)
    noLeaks()
  })

  test('text-transform is applied to the text itself', async () => {
    const { container } = await setup('.loud { text-transform: uppercase; } .quiet { text-transform: lowercase; }')
    container.append(el('p', 'Hello', { class: 'loud' }), el('p', 'Hello', { class: 'quiet' }))
    await mounted.settle()
    const [loud, quiet] = Array.from(container.children)
    expect(mounted.gpui.node(mounted.nativeOf(loud!).children[0]!).text).toBe('HELLO')
    expect(mounted.gpui.node(mounted.nativeOf(quiet!).children[0]!).text).toBe('hello')
    // …and the sync check expects the transformed text too.
    expect(mounted.inSync()).toBe(true)
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

  test('in that row, a block child still takes a whole line', async () => {
    // A form of block fields with an inline-block button last, as FoldKit's
    // Form example has: the fields must not shrink to fit their labels.
    const { container } = await setup('.narrow { width: 50px; }')
    const form = el('form')
    form.append(el('div', 'Name'), el('div', 'Fixed', { class: 'narrow' }), el('span', 'inline'), el('button', 'Join'))
    container.appendChild(form)
    await mounted.settle()
    const [field, narrow, span, button] = Array.from(form.children).map(child => mounted.nativeOf(child).style)
    expect(mounted.nativeOf(form).style).toMatchObject({ display: 'flex', flexWrap: 'wrap' })
    expect(field).toMatchObject({ width: '100%' })
    expect(narrow).toMatchObject({ width: 50 })
    expect(span!['width']).toBeUndefined()
    expect(button!['width']).toBeUndefined()
  })

  test("the row's text-align places its inline content", async () => {
    // Shopping Cart's confirmation: a centred block whose button is inline-block.
    const { container } = await setup('.centred { text-align: center; } .right { text-align: right; }')
    const centred = el('div', undefined, { class: 'centred' })
    centred.append(el('h1', 'Done'), el('button', 'Continue'))
    const right = el('div', undefined, { class: 'right' })
    right.append('a ', el('b', 'b'))
    container.append(centred, right)
    await mounted.settle()
    expect(mounted.nativeOf(centred).style).toMatchObject({ display: 'flex', justifyContent: 'center' })
    expect(mounted.nativeOf(right).style).toMatchObject({ display: 'flex', justifyContent: 'flex-end' })
  })
})

describe('many windows in one process', () => {
  // happy-dom's DOM classes are shared by every window. The mirror patches
  // their methods once and each call goes to the mirror of the node's own
  // document, so a stopped mirror hears nothing and holds nothing.
  const owner = (from: object, key: string) => {
    let proto = Object.getPrototypeOf(from)
    while (!Object.prototype.hasOwnProperty.call(proto, key)) proto = Object.getPrototypeOf(proto)
    return proto as Record<string, unknown>
  }
  const open = async () => {
    const m = mountFake()
    await m.settle()
    const box = m.document.createElement('div')
    box.style.overflowY = 'scroll'
    m.container.appendChild(box)
    await m.settle()
    return { m, box }
  }

  test('the shared methods are patched once, however many mirrors there are', async () => {
    const first = await open()
    const methods = ['addEventListener', 'removeEventListener', 'getBoundingClientRect'].map(key => owner(first.box, key)[key])
    const scroll = Object.getOwnPropertyDescriptor(owner(first.box, 'scrollTop'), 'scrollTop')!.set
    const second = await open()
    expect(['addEventListener', 'removeEventListener', 'getBoundingClientRect'].map(key => owner(second.box, key)[key])).toEqual(methods)
    expect(Object.getOwnPropertyDescriptor(owner(second.box, 'scrollTop'), 'scrollTop')!.set).toBe(scroll)
    await first.m.close()
    await second.m.close()
  })

  test('live mirrors each hear their own document; a stopped one hears nothing', async () => {
    const a = await open()
    const b = await open()
    a.box.addEventListener('click', () => {})
    a.box.setAttribute('data-x', '1') // flushes the native listener
    await a.m.settle()
    expect(a.m.nativeOf(a.box as unknown as Node).listeners.has('click')).toBe(true)
    expect(b.m.nativeOf(b.box as unknown as Node).listeners.has('click')).toBe(false)

    // Stopped: no more listener tracking, scrolling or layout answers from it.
    a.m.gpui.setBounds(a.m.idOf(a.box as unknown as Node), { x: 1, y: 2, width: 30, height: 40 })
    expect(a.box.getBoundingClientRect().width).toBe(30)
    await a.m.close()
    a.box.addEventListener('mousedown', () => {})
    a.box.setAttribute('data-x', '2')
    await a.m.settle()
    expect(a.m.nativeOf(a.box as unknown as Node).listeners.has('mouseDown')).toBe(false)
    a.box.scrollTop = 100
    expect(a.m.gpui.scrollCalls).toEqual([])
    expect(a.box.getBoundingClientRect().width).toBe(0)

    // The other one carries on.
    b.box.scrollTop = 100
    expect(b.m.gpui.scrollCalls).toEqual([{ id: b.m.idOf(b.box as unknown as Node), x: 0, y: -100 }])
    await b.m.close()
  })
})

describe('detached hover listener retention', () => {
  test('completed hover presses release removed targets and their ancestors without another move', async () => {
    // Isolate GC from prior test-runner stacks: a no-hover control can otherwise
    // remain alive after unrelated window tests despite explicit GC turns.
    const child = Bun.spawn([process.execPath, '-e', `
      import { mountFake } from './test/support/mount.ts'
      import assert from 'node:assert/strict'
      const m = mountFake()
      await m.settle()
      const baseline = m.gpui.retainedCount()
      async function removed(mode) {
        const source = m.document.createElement('div')
        source.addEventListener('mousedown', () => {})
        source.addEventListener('mousemove', () => {})
        const parent = m.document.createElement('div')
        const target = m.document.createElement('div')
        let enters = 0
        target.addEventListener('mouseenter', () => { enters++ })
        parent.append(target)
        m.container.append(source, parent)
        await m.settle()
        m.gpui.setBounds(m.idOf(source), { x: 0, y: 0, width: 100, height: 100 })
        m.gpui.setBounds(m.idOf(target), { x: 100, y: 0, width: 100, height: 100 })
        if (mode !== 'no-hover') {
          assert(m.send(source, { eventType: 'mouseDown', x: 50, y: 50, button: 0 }))
          assert(m.send(source, { eventType: 'mouseMove', x: 150, y: 50, pressedButton: 0 }))
          assert(m.send(source, { eventType: 'mouseUp', x: 150, y: 50, button: 0 }))
        }
        assert.equal(enters, mode === 'no-hover' ? 0 : 1)
        if (mode === 'hover-then-move') assert(m.send(source, { eventType: 'mouseMove', x: 50, y: 50 }))
        parent.remove()
        source.remove()
        await m.settle()
        return [new WeakRef(parent), new WeakRef(target)]
      }
      try {
        // Collect each pair before the next scene's input can clear hover history.
        for (const mode of ['no-hover', 'hover', 'hover-then-move']) {
          const refs = await removed(mode)
          await m.settle()
          for (let i = 0; i < 20; i++) {
            await Bun.sleep(5)
            Bun.gc(true)
          }
          assert.deepEqual(refs.map(ref => ref.deref() === undefined), [true, true], mode)
          assert.equal(m.gpui.retainedCount(), baseline)
          assert.equal(m.gpui.retainedCount(), m.gpui.reachableCount())
          assert(m.inSync())
        }
      } finally { await m.close() }
    `], { cwd: import.meta.dir + '/..', stdout: 'ignore', stderr: 'pipe' })
    const [exit, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
    expect(stderr).toBe('')
    expect(exit).toBe(0)
  })

  test('removed hover subtrees and never-inserted listeners are collectible with the mirror alive', async () => {
    const { container, document, gpui } = await setup()
    const baseline = gpui.retainedCount()
    const detached = async (type: string, cleanup = false, insert = true) => {
      const parent = document.createElement('div')
      const child = document.createElement('div')
      const listener = () => {}
      child.addEventListener(type, listener)
      parent.append(child)
      if (insert) {
        container.append(parent)
        await mounted.settle()
        if (cleanup) child.removeEventListener(type, listener)
        parent.remove()
      }
      await mounted.settle()
      return [new WeakRef(parent), new WeakRef(child)]
    }
    const click = await detached('click')
    const hover = await detached('mouseenter')
    const cleanedHover = await detached('mouseenter', true)
    const neverInserted = await detached('mouseleave', false, false)
    // A listener added after removal must not root the detached node either.
    const afterRemoval = async () => {
      const node = document.createElement('div')
      container.append(node)
      await mounted.settle()
      node.remove()
      await mounted.settle()
      node.addEventListener('mouseover', () => {})
      return new WeakRef(node)
    }
    const lateHover = await afterRemoval()
    await mounted.settle()
    // GC controls use the same queues and a live mount; no native window is involved.
    for (let i = 0; i < 20; i++) {
      await Bun.sleep(5)
      Bun.gc(true)
    }
    for (const ref of [...click, ...hover, ...cleanedHover, ...neverInserted, lateHover]) {
      expect(ref.deref() === undefined).toBe(true)
    }
    expect(gpui.retainedCount()).toBe(baseline)
    noLeaks()
    expect(mounted.inSync()).toBe(true)
  })
})
