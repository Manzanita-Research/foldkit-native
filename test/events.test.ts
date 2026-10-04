// GPUI → DOM events. A gpuix event on an element id must reach the DOM as the
// events a browser would fire, so FoldKit's listeners run unchanged; and a DOM
// listener must make GPUI send the events it needs (and stop when removed).
import { afterEach, describe, expect, test } from 'bun:test'

import { type Mounted, mountFake } from './support/mount.ts'

let mounted: Mounted
afterEach(() => mounted?.close())

const setup = async () => {
  mounted = mountFake()
  await mounted.settle()
  return mounted
}
const el = (tag: string, text?: string) => {
  const node = mounted.document.createElement(tag)
  if (text !== undefined) node.textContent = text
  return node
}
/** Every DOM event of the given types that reaches `target`, as "type@id". */
const record = (target: EventTarget, types: Array<string>) => {
  const seen: Array<Event> = []
  for (const type of types) target.addEventListener(type, event => seen.push(event))
  return seen
}
const names = (events: Array<Event>) => events.map(event => event.type)

describe('listeners → native listeners', () => {
  test('adding and removing a DOM listener turns the native one on and off', async () => {
    const { container } = await setup()
    const button = el('button', 'Go')
    container.appendChild(button)
    await mounted.settle()
    const onClick = () => {}
    button.addEventListener('click', onClick)
    // setEventListener is queued; the next DOM change flushes it (in FoldKit
    // the patch that adds a listener is that change).
    button.setAttribute('data-x', '1')
    await mounted.settle()
    expect(mounted.nativeOf(button).listeners.has('click')).toBe(true)
    button.removeEventListener('click', onClick)
    button.setAttribute('data-x', '2')
    await mounted.settle()
    expect(mounted.nativeOf(button).listeners.has('click')).toBe(false)
  })

  test('two DOM listeners share one native listener until both are gone', async () => {
    const { container } = await setup()
    const button = el('button', 'Go')
    container.appendChild(button)
    await mounted.settle()
    const a = () => {}; const b = () => {}
    button.addEventListener('click', a)
    button.addEventListener('click', b)
    button.removeEventListener('click', a)
    button.setAttribute('data-x', '1')
    await mounted.settle()
    expect(mounted.nativeOf(button).listeners.has('click')).toBe(true)
    button.removeEventListener('click', b)
    button.setAttribute('data-x', '2')
    await mounted.settle()
    expect(mounted.nativeOf(button).listeners.has('click')).toBe(false)
  })

  test('a listener added before the element is mirrored is registered on creation', async () => {
    const { container } = await setup()
    const button = el('button', 'Go')
    button.addEventListener('click', () => {})
    container.appendChild(button)
    await mounted.settle()
    expect(mounted.nativeOf(button).listeners.has('click')).toBe(true)
  })

  test('DOM events map to the GPUI events that produce them', async () => {
    const { container } = await setup()
    const node = el('div', 'x')
    for (const type of ['dragstart', 'keydown', 'input', 'focus', 'mouseover']) node.addEventListener(type, () => {})
    container.appendChild(node)
    await mounted.settle()
    expect([...mounted.nativeOf(node).listeners].sort()).toEqual(
      ['change', 'focus', 'keyDown', 'mouseDown', 'mouseEnter', 'mouseMove', 'mouseUp'])
  })
})

describe('pointer', () => {
  test('click, double click and right click', async () => {
    const { container } = await setup()
    const button = el('button', 'Go')
    const seen = record(button, ['click', 'dblclick', 'contextmenu'])
    container.appendChild(button)
    await mounted.settle()
    mounted.send(button, { eventType: 'click', x: 5, y: 6, button: 0, clickCount: 1 })
    await Bun.sleep(5)
    mounted.send(button, { eventType: 'click', x: 5, y: 6, button: 0, clickCount: 2 })
    await Bun.sleep(5)
    mounted.send(button, { eventType: 'click', x: 5, y: 6, button: 2, clickCount: 1, isRightClick: true })
    // A browser's order: the second press is a click too, then the dblclick.
    expect(names(seen)).toEqual(['click', 'click', 'dblclick', 'contextmenu'])
    const click = seen[0] as MouseEvent
    expect([click.clientX, click.clientY, click.bubbles, click.detail]).toEqual([5, 6, true, 1])
  })

  test('every press of a quick run is a click; detail counts the run, only the second is a dblclick', async () => {
    const { container } = await setup()
    const button = el('button', 'Go')
    const seen = record(button, ['click', 'dblclick'])
    container.appendChild(button)
    await mounted.settle()
    for (const clickCount of [1, 2, 3]) {
      mounted.send(button, { eventType: 'click', x: 1, y: 1, button: 0, clickCount })
      await Bun.sleep(5)
    }
    expect(seen.map(event => `${event.type}:${(event as MouseEvent).detail}`))
      .toEqual(['click:1', 'click:2', 'dblclick:2', 'click:3'])
  })

  test('an element listening only for dblclick still lets the clicks bubble', async () => {
    const { container } = await setup()
    const outer = el('div'); const inner = el('div', 'row')
    outer.appendChild(inner)
    const atOuter = record(outer, ['click']); const atInner = record(inner, ['dblclick'])
    container.appendChild(outer)
    await mounted.settle()
    for (const clickCount of [1, 2]) {
      const payload = { eventType: 'click', x: 1, y: 1, button: 0, clickCount }
      mounted.send(inner, payload) // innermost first, as GPUI does
      mounted.send(outer, payload)
      await Bun.sleep(5)
    }
    expect(atOuter.map(event => (event as MouseEvent).detail)).toEqual([1, 2])
    expect(atInner).toHaveLength(1)
  })

  test('mousedown and mouseup carry the click count as detail', async () => {
    const { container } = await setup()
    const node = el('div', 'x')
    const seen = record(node, ['mousedown', 'mouseup'])
    container.appendChild(node)
    await mounted.settle()
    for (const clickCount of [1, 2]) {
      mounted.send(node, { eventType: 'mouseDown', x: 1, y: 1, button: 0, clickCount })
      mounted.send(node, { eventType: 'mouseUp', x: 1, y: 1, button: 0, clickCount })
    }
    expect(seen.map(event => `${event.type}:${(event as MouseEvent).detail}`))
      .toEqual(['mousedown:1', 'mouseup:1', 'mousedown:2', 'mouseup:2'])
  })

  test('GPUI reports a click to every listening ancestor; the DOM sees it once, bubbling', async () => {
    const { container } = await setup()
    const outer = el('div'); const inner = el('button', 'Go')
    outer.appendChild(inner)
    const atOuter = record(outer, ['click']); const atInner = record(inner, ['click'])
    container.appendChild(outer)
    await mounted.settle()
    const payload = { eventType: 'click', x: 1, y: 1, button: 0, clickCount: 1 }
    mounted.send(inner, payload) // innermost first, as GPUI does
    mounted.send(outer, payload)
    expect(atInner).toHaveLength(1)
    expect(atOuter).toHaveLength(1)
    expect(atOuter[0]!.target).toBe(inner)
  })

  test('two quick clicks on the same element are two clicks', async () => {
    const { container } = await setup()
    const button = el('button', 'Go')
    const seen = record(button, ['click'])
    container.appendChild(button)
    await mounted.settle()
    const payload = { eventType: 'click', x: 1, y: 1, button: 0, clickCount: 1 }
    mounted.send(button, payload)
    mounted.send(button, payload)
    expect(seen).toHaveLength(2)
  })

  test('a click in the first moments after startup counts (no drag has ended yet)', async () => {
    const { container } = await setup()
    const button = el('button', 'Go')
    const seen = record(button, ['click'])
    container.appendChild(button)
    await mounted.settle()
    // performance.now() counts from process start: early on, it's small.
    const now = performance.now
    performance.now = () => 10
    try {
      mounted.send(button, { eventType: 'click', x: 1, y: 1, button: 0, clickCount: 1 })
    } finally {
      performance.now = now
    }
    expect(seen).toHaveLength(1)
  })

  test('mouse down, up and move reach the DOM only where listened', async () => {
    const { container } = await setup()
    const node = el('div', 'x')
    const seen = record(node, ['mousedown', 'mouseup'])
    container.appendChild(node)
    await mounted.settle()
    mounted.send(node, { eventType: 'mouseDown', x: 1, y: 1, button: 0 })
    mounted.send(node, { eventType: 'mouseMove', x: 2, y: 2 })
    mounted.send(node, { eventType: 'mouseUp', x: 2, y: 2, button: 0 })
    expect(names(seen)).toEqual(['mousedown', 'mouseup'])
  })

  test('enter and leave fire the non-bubbling and the bubbling pair', async () => {
    const { container } = await setup()
    const node = el('div', 'x')
    const seen = record(node, ['mouseenter', 'mouseover', 'mouseleave', 'mouseout'])
    container.appendChild(node)
    await mounted.settle()
    mounted.send(node, { eventType: 'mouseEnter' })
    mounted.send(node, { eventType: 'mouseLeave' })
    expect(names(seen)).toEqual(['mouseenter', 'mouseover', 'mouseleave', 'mouseout'])
    expect(seen.map(event => event.bubbles)).toEqual([false, true, false, true])
  })
})

describe('forms', () => {
  /** A form with a field and buttons, its submits counted. */
  const form = async () => {
    const { container } = await setup()
    const form = el('form')
    form.innerHTML = '<input aria-label="zip"><button type="button">Clear</button><button>Go</button>'
    let submits = 0
    form.addEventListener('submit', event => {
      event.preventDefault()
      submits++
    })
    container.appendChild(form)
    await mounted.settle()
    const [input, clear, go] = [form.querySelector('input')!, form.querySelectorAll('button')[0]!, form.querySelectorAll('button')[1]!]
    return { input, clear, go, submits: () => submits }
  }

  test('a click on a submit button submits its form, with no click listener of its own', async () => {
    const { go, clear, submits } = await form()
    expect(mounted.nativeOf(go).listeners.has('click')).toBe(true)
    expect(mounted.nativeOf(clear).listeners.has('click')).toBe(false)
    mounted.send(go, { eventType: 'click', x: 1, y: 1, button: 0, clickCount: 1 })
    expect(submits()).toBe(1)
  })

  test('Enter in a field submits its form, as a browser does', async () => {
    const { input, submits } = await form()
    expect(mounted.nativeOf(input).listeners.has('submit')).toBe(true)
    mounted.send(input, { eventType: 'submit' } as never)
    expect(submits()).toBe(1)
  })

  test('outside a form, buttons and fields stay quiet', async () => {
    const { container } = await setup()
    const button = el('button', 'Go')
    const input = el('input')
    container.append(button, input)
    await mounted.settle()
    expect(mounted.nativeOf(button).listeners.size).toBe(0)
    expect(mounted.nativeOf(input).listeners.size).toBe(0)
  })
})

describe('links', () => {
  test('a click on a link reaches a listener on document, with the link as its target', async () => {
    const { container } = await setup()
    container.innerHTML = '<a href="/cart"><span>Cart</span></a><a>Not a link</a>'
    await mounted.settle()
    const [link, plain] = Array.from(container.querySelectorAll('a'))
    expect(mounted.nativeOf(link!).listeners.has('click')).toBe(true)
    expect(mounted.nativeOf(plain!).listeners.has('click')).toBe(false)
    // FoldKit's routing: one listener on document, which stops the navigation.
    const targets: Array<string> = []
    const onClick = (event: Event) => {
      event.preventDefault()
      targets.push((event.target as Element).closest('a')!.getAttribute('href')!)
    }
    mounted.document.addEventListener('click', onClick)
    mounted.send(link!, { eventType: 'click', x: 1, y: 1, button: 0, clickCount: 1 })
    mounted.document.removeEventListener('click', onClick)
    expect(targets).toEqual(['/cart'])
  })

  test('a link click nobody handles leaves the window and the app where they are', async () => {
    const { container } = await setup()
    container.innerHTML = '<a href="/cart">Cart</a><a href="https://example.com/">Elsewhere</a>'
    await mounted.settle()
    // happy-dom follows an unprevented link click with window.open(href, '_self').
    const window = mounted.document.defaultView!
    const opened: Array<string> = []
    const open = window.open
    window.open = ((url?: string | URL) => {
      opened.push(String(url))
      return null
    }) as typeof window.open
    for (const link of Array.from(container.querySelectorAll('a'))) {
      mounted.send(link, { eventType: 'click', x: 1, y: 1, button: 0, clickCount: 1 })
    }
    window.open = open
    await mounted.settle()
    expect(opened).toEqual([])
    expect(container.isConnected).toBe(true)
    expect(mounted.inSync()).toBe(true)
  })
})

describe('keys, focus, input', () => {
  test('gpuix key names become DOM KeyboardEvent.key', async () => {
    const { container } = await setup()
    const node = el('div', 'x')
    const keys: Array<string> = []
    node.addEventListener('keydown', event => keys.push((event as KeyboardEvent).key))
    container.appendChild(node)
    await mounted.settle()
    for (const key of ['enter', 'escape', 'tab', 'space', 'backspace', 'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown', 'a', 'Z', '7']) {
      mounted.send(node, { eventType: 'keyDown', key })
    }
    expect(keys).toEqual(['Enter', 'Escape', 'Tab', ' ', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'Home', 'End', 'PageUp', 'PageDown', 'a', 'Z', '7'])
  })

  test('window keys go to the focused element, or the body', async () => {
    const { container, document, mirror } = await setup()
    const input = el('input') as HTMLInputElement
    container.appendChild(input)
    await mounted.settle()
    const atInput = record(input, ['keydown'])
    const atBody = record(document.body, ['keydown'])
    mirror.windowKey({ elementId: 0, eventType: 'keyDown', key: 'a' })
    expect(atInput).toHaveLength(0)
    expect(atBody).toHaveLength(1)
    input.focus()
    mirror.windowKey({ elementId: 0, eventType: 'keyDown', key: 'b' })
    expect(atInput).toHaveLength(1)
    expect(atBody).toHaveLength(2) // bubbled from the input
  })

  test('focus and blur fire focus/focusin and blur/focusout', async () => {
    const { container } = await setup()
    const node = el('div', 'x')
    const seen = record(node, ['focus', 'focusin', 'blur', 'focusout'])
    container.appendChild(node)
    await mounted.settle()
    mounted.send(node, { eventType: 'focus' })
    mounted.send(node, { eventType: 'blur' })
    expect(names(seen)).toEqual(['focus', 'focusin', 'blur', 'focusout'])
  })

  test('a native change sets the value, then fires input and change', async () => {
    const { container } = await setup()
    const input = el('input') as HTMLInputElement
    const values: Array<string> = []
    input.addEventListener('input', () => values.push(`input:${input.value}`))
    input.addEventListener('change', () => values.push(`change:${input.value}`))
    container.appendChild(input)
    await mounted.settle()
    mounted.send(input, { eventType: 'change', value: 'hello' } as never)
    expect(values).toEqual(['input:hello', 'change:hello'])
  })
})

describe('drag and drop, rebuilt from mouse events', () => {
  const board = async () => {
    const { container, gpui } = await setup()
    const card = el('div', 'card'); const zone = el('div', 'zone'); const elsewhere = el('div', 'elsewhere')
    const atCard = record(card, ['dragstart', 'dragend', 'click'])
    const atZone = record(zone, ['dragenter', 'dragover', 'dragleave', 'drop'])
    container.append(card, zone, elsewhere)
    await mounted.settle()
    gpui.setBounds(mounted.idOf(zone), { x: 100, y: 0, width: 100, height: 100 })
    return { card, zone, atCard, atZone }
  }

  test('press, move past 4px, over a zone, release: dragstart … drop, dragend', async () => {
    const { card, atCard, atZone } = await board()
    mounted.send(card, { eventType: 'mouseDown', x: 10, y: 10, button: 0 })
    mounted.send(card, { eventType: 'mouseMove', x: 12, y: 11, pressedButton: 0 })
    expect(names(atCard)).toEqual([]) // under the 4px threshold
    mounted.send(card, { eventType: 'mouseMove', x: 40, y: 10, pressedButton: 0 })
    expect(names(atCard)).toEqual(['dragstart'])
    mounted.send(card, { eventType: 'mouseMove', x: 150, y: 50, pressedButton: 0 })
    mounted.send(card, { eventType: 'mouseMove', x: 160, y: 50, pressedButton: 0 })
    mounted.send(card, { eventType: 'mouseUp', x: 160, y: 50, button: 0 })
    // GPUI then reports the release as a click on the pressed element: not a click.
    mounted.send(card, { eventType: 'click', x: 160, y: 50, button: 0, clickCount: 1 })
    expect(names(atZone)).toEqual(['dragenter', 'dragover', 'dragover', 'drop'])
    expect(names(atCard)).toEqual(['dragstart', 'dragend'])
  })

  test('leaving the zone fires dragleave; releasing elsewhere ends the drag', async () => {
    const { card, atCard, atZone } = await board()
    mounted.send(card, { eventType: 'mouseDown', x: 10, y: 10, button: 0 })
    mounted.send(card, { eventType: 'mouseMove', x: 150, y: 50, pressedButton: 0 })
    mounted.send(card, { eventType: 'mouseMove', x: 300, y: 50, pressedButton: 0 })
    mounted.send(card, { eventType: 'mouseUp', x: 300, y: 50, button: 0 })
    expect(names(atZone)).toEqual(['dragenter', 'dragover', 'dragleave'])
    expect(names(atCard)).toEqual(['dragstart', 'dragend'])
  })

  test('a press without movement is a click, not a drag', async () => {
    const { card, atCard } = await board()
    mounted.send(card, { eventType: 'mouseDown', x: 10, y: 10, button: 0 })
    mounted.send(card, { eventType: 'mouseUp', x: 10, y: 10, button: 0 })
    mounted.send(card, { eventType: 'click', x: 10, y: 10, button: 0, clickCount: 1 })
    expect(names(atCard)).toEqual(['click'])
  })
})

describe('scroll position, both ways', () => {
  const scroller = async () => {
    const { container, gpui } = await setup()
    const list = el('div')
    list.style.overflowY = 'scroll'
    container.appendChild(list)
    const tops: Array<number> = []
    list.addEventListener('scroll', () => tops.push(list.scrollTop))
    list.setAttribute('data-x', '1') // flushes the native scroll listener
    await mounted.settle()
    return { list, gpui, tops, id: mounted.idOf(list) }
  }

  test('a scroll in GPUI reaches the DOM with GPUI\'s offset in scrollTop', async () => {
    const { list, gpui, tops, id } = await scroller()
    expect(gpui.node(id).listeners.has('scroll')).toBe(true)
    // gpuix offsets are negative when scrolled down.
    gpui.setScrollOffset(id, 0, -440)
    mounted.send(list, { eventType: 'scroll', deltaY: -440 } as never)
    expect(tops).toEqual([440])
    expect(list.scrollTop).toBe(440)
    // Reading GPUI's position never writes it back.
    expect(gpui.scrollCalls).toEqual([])
  })

  test('setting scrollTop scrolls GPUI and fires scroll back, as a browser does', async () => {
    const { list, gpui, tops, id } = await scroller()
    list.scrollTop = 880
    expect(gpui.scrollCalls).toEqual([{ id, x: 0, y: -880 }])
    await mounted.settle()
    expect(tops).toEqual([880])
    // The same value again is no scroll at all.
    list.scrollTop = 880
    list.scrollTo({ top: 880 })
    await mounted.settle()
    expect(gpui.scrollCalls).toHaveLength(1)
    expect(tops).toEqual([880])
  })

  test('an app that scrolls on every scroll event settles instead of echoing', async () => {
    const { list, gpui, id } = await scroller()
    // Snap to 44px rows on every scroll, as a list might.
    list.addEventListener('scroll', () => {
      list.scrollTop = Math.round(list.scrollTop / 44) * 44
    })
    gpui.setScrollOffset(id, 0, -100)
    mounted.send(list, { eventType: 'scroll', deltaY: -100 } as never)
    await mounted.settle()
    await mounted.settle()
    // One write (100 → 88), its one scroll event, then quiet: 88 snaps to 88.
    expect(gpui.scrollCalls).toEqual([{ id, x: 0, y: -88 }])
    expect(list.scrollTop).toBe(88)
  })
})
