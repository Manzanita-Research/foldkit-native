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
    expect(names(seen)).toEqual(['click', 'dblclick', 'contextmenu'])
    const click = seen[0] as MouseEvent
    expect([click.clientX, click.clientY, click.bubbles, click.detail]).toEqual([5, 6, true, 1])
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
