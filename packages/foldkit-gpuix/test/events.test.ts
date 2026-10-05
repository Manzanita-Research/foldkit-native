// The native → FoldKit event contract (EVENTS.md), rule by rule. A browser
// decides each expectation: the sequences below are what Chrome fired for the
// same page and the same input (FKN-23), and the dispatch rules are WHATWG
// DOM's. Headless runs the adapter on the fake GPUI, sending what real GPUI
// sends (its exclusive hover, its press capture, its wheel to every listening
// element, its `auxClick` before the release: checked on Metal at the end).
import { afterEach, describe, expect, test } from 'bun:test'

import type { HostTimings } from '../src/host.ts'
import { NativeElement } from '../src/index.ts'
import { type Headless, METAL, mountHeadless, openMetal } from './support.ts'

let app: Headless | undefined
afterEach(() => {
  app?.close()
  app = undefined
})

type Box = { x: number; y: number; width: number; height: number }

/** body > #outer (0,0 300×200) > #inner (50,50 100×100); body > button#btn
 *  (500,50 80×40); body > #far (700,300 100×100). Each listens for `types`
 *  and logs `type@listener t=target`, as the browser oracle did. */
const scene = async (types: ReadonlyArray<string> = [], options: Parameters<typeof mountHeadless>[0] = {}) => {
  app = mountHeadless(options)
  const { document } = app
  const make = (tag: string, id: string, parent: NativeElement, box: Box) => {
    const element = document.createElement(tag)
    element.setAttribute('id', id)
    parent.appendChild(element)
    return { element, box }
  }
  const outer = make('div', 'outer', document.body, { x: 0, y: 0, width: 300, height: 200 })
  const inner = make('div', 'inner', outer.element, { x: 50, y: 50, width: 100, height: 100 })
  const btn = make('button', 'btn', document.body, { x: 500, y: 50, width: 80, height: 40 })
  const far = make('div', 'far', document.body, { x: 700, y: 300, width: 100, height: 100 })
  const log: Array<string> = []
  const name = (target: unknown) => target instanceof NativeElement ? target.getAttribute('id') ?? target.localName : target === document ? 'document' : 'window'
  const listen = (target: { addEventListener: NativeElement['addEventListener'] }, label: string, kinds = types) => {
    for (const type of kinds) target.addEventListener(type, ((event: { target: unknown; button?: number; buttons?: number }) => {
      log.push(`${type}@${label} t=${name(event.target)}`)
    }) as never)
  }
  for (const { element } of [outer, inner, btn, far]) listen(element, element.getAttribute('id')!)
  await app.settle()
  const layOut = () => {
    app!.gpui.setBounds(document.body.nativeId, { x: 0, y: 0, width: 1024, height: 768 })
    for (const { element, box } of [outer, inner, btn, far]) app!.gpui.setBounds(element.nativeId, box)
    app!.host.relayout()
  }
  layOut()
  const send = (event: Record<string, unknown>) => app!.host.dispatch(event as never)
  /** What GPUI hits at a point: the topmost element listening for `native`. */
  const gpuiHit = (x: number, y: number, native: string) => {
    for (const element of document.elementsFromPoint(x, y)) {
      if (element.nativeId !== 0 && app!.gpui.node(element.nativeId).listeners.has(native)) return element
    }
    return undefined
  }
  /** A move, as GPUI sends it: the move to the topmost element that listens,
   *  and its own exclusive enter and leave for what was hovered before. */
  let gpuiHovered: NativeElement | undefined
  const move = async (x: number, y: number, pressedButton?: number) => {
    const hit = gpuiHit(x, y, 'mouseMove')
    if (hit !== gpuiHovered && pressedButton === undefined) {
      if (hit !== undefined) send({ eventType: 'mouseEnter', elementId: hit.nativeId, hovered: true })
    }
    if (hit !== undefined) send({ eventType: 'mouseMove', elementId: hit.nativeId, x, y, ...(pressedButton === undefined ? {} : { pressedButton }) })
    if (hit !== gpuiHovered && pressedButton === undefined) {
      if (gpuiHovered !== undefined) send({ eventType: 'mouseLeave', elementId: gpuiHovered.nativeId, hovered: false })
      gpuiHovered = hit
    }
    await app!.settle()
  }
  const sentinel = () => app!.gpui.node(document.body.nativeId).children.find(id => app!.gpui.node(id).listeners.has('mouseDownOutside'))!
  return {
    app, document, log, listen, layOut, send, move, gpuiHit, sentinel,
    outer: outer.element, inner: inner.element, btn: btn.element, far: far.element,
    take: () => log.splice(0),
  }
}
type Scene = Awaited<ReturnType<typeof scene>>

/** A press as GPUI sends it: the sentinel first (its capture phase), then
 *  the press to the topmost element listening for presses. What GPUI will
 *  click is decided here too: the topmost element listening for clicks. */
type Press = { pressed: NativeElement | undefined; clicked: NativeElement | undefined }
const press = async (s: Scene, x: number, y: number, button = 0): Promise<Press> => {
  s.send({ eventType: 'mouseDownOutside', elementId: s.sentinel(), x, y, button })
  const pressed = s.gpuiHit(x, y, 'mouseDown')
  const clicked = s.gpuiHit(x, y, button === 0 ? 'click' : 'auxClick')
  if (pressed !== undefined) s.send({ eventType: 'mouseDown', elementId: pressed.nativeId, x, y, button, clickCount: 1 })
  await s.app.settle()
  return { pressed, clicked }
}
/** The release, to what was pressed, and GPUI's click to what it pressed
 *  (or its auxClick, which it sends before the release), wherever the
 *  release was. */
const release = async (s: Scene, { pressed, clicked }: Press, x: number, y: number, button = 0) => {
  if (button !== 0 && clicked !== undefined) {
    s.send({ eventType: 'auxClick', elementId: clicked.nativeId, x, y, clickCount: 1, isRightClick: button === 2 })
  }
  if (pressed !== undefined) s.send({ eventType: 'mouseUp', elementId: pressed.nativeId, x, y, button, clickCount: 1 })
  if (button === 0 && clicked !== undefined) s.send({ eventType: 'click', elementId: clicked.nativeId, x, y, button, clickCount: 1 })
  await s.app.settle()
}

const MOUSE_BOUNDARY = ['mouseover', 'mouseenter', 'mouseout', 'mouseleave']
const POINTER_BOUNDARY = ['pointerover', 'pointerenter', 'pointerout', 'pointerleave']

describe('dispatch (WHATWG DOM)', () => {
  test('a listener is its callback and capture flag: added twice it runs once; the native listener goes with the last one', async () => {
    const s = await scene()
    const calls: Array<string> = []
    const listener = () => calls.push('fn')
    const object = { handleEvent: () => calls.push('object') }
    s.inner.addEventListener('click', listener)
    s.inner.addEventListener('click', listener)
    s.inner.addEventListener('click', listener, { once: true }) // same pair: ignored, `once` and all
    s.inner.addEventListener('click', listener, true)
    s.inner.addEventListener('click', object)
    s.inner.click()
    expect(calls).toEqual(['fn', 'fn', 'object'])
    await s.app.settle()
    const native = () => s.app.gpui.node(s.inner.nativeId).listeners.has('click')
    expect(native()).toBe(true)
    s.inner.removeEventListener('click', listener)
    s.inner.removeEventListener('click', listener) // not there any more: nothing
    s.inner.removeEventListener('click', object)
    await s.app.settle()
    expect(native()).toBe(true) // the capture one is still there
    s.inner.removeEventListener('click', listener, { capture: true })
    await s.app.settle()
    expect(native()).toBe(false)
  })

  test('a listener removed mid-dispatch doesn\'t run, even further along the path; one added mid-dispatch waits for the next', async () => {
    const s = await scene()
    const calls: Array<string> = []
    const second = () => calls.push('second')
    const onOuter = () => calls.push('outer')
    const late = () => calls.push('late')
    s.inner.addEventListener('click', () => {
      calls.push('first')
      s.inner.removeEventListener('click', second)
      s.outer.removeEventListener('click', onOuter)
      s.inner.addEventListener('click', late)
    })
    s.inner.addEventListener('click', second)
    s.outer.addEventListener('click', onOuter)
    s.inner.click()
    expect(calls).toEqual(['first'])
    s.inner.click()
    expect(calls).toEqual(['first', 'first', 'late'])
  })

  test('at the target, capture listeners run before the others, whatever the order they were added in', async () => {
    const s = await scene()
    const calls: Array<string> = []
    s.inner.addEventListener('click', () => calls.push('bubble'))
    s.inner.addEventListener('click', () => calls.push('capture'), true)
    s.outer.addEventListener('click', () => calls.push('outer capture'), true)
    s.outer.addEventListener('click', () => calls.push('outer bubble'))
    s.inner.click()
    expect(calls).toEqual(['outer capture', 'capture', 'bubble', 'outer bubble'])
  })

  test('once, signal, passive; stopping; the event can be dispatched again; not while it\'s being dispatched', async () => {
    const s = await scene()
    const calls: Array<string> = []
    s.inner.addEventListener('click', () => calls.push('once'), { once: true })
    const controller = new AbortController()
    s.inner.addEventListener('click', () => calls.push('signal'), { signal: controller.signal })
    s.inner.addEventListener('click', event => {
      event.preventDefault()
      calls.push(`passive prevented: ${event.defaultPrevented}`)
    }, { passive: true })
    s.inner.click()
    controller.abort()
    s.inner.click()
    expect(calls).toEqual(['once', 'signal', 'passive prevented: false', 'passive prevented: false'])
    // An aborted signal adds nothing.
    s.inner.addEventListener('click', () => calls.push('never'), { signal: controller.signal })

    const stops: Array<string> = []
    const event = new (globalThis as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent('custom', { bubbles: true })
    s.inner.addEventListener('custom', e => {
      stops.push('inner')
      e.stopPropagation()
    })
    s.inner.addEventListener('custom', () => stops.push('inner 2'))
    s.outer.addEventListener('custom', () => stops.push('outer'))
    s.inner.dispatchEvent(event)
    expect(stops).toEqual(['inner', 'inner 2'])
    // The stop is unset after the dispatch, as the spec has it.
    expect(event.cancelBubble).toBe(false)
    s.outer.dispatchEvent(event)
    expect(stops).toEqual(['inner', 'inner 2', 'outer'])
    s.outer.addEventListener('again', e => {
      expect(() => s.outer.dispatchEvent(e)).toThrow('already being dispatched')
    })
    s.outer.dispatchEvent(new (globalThis as unknown as { Event: typeof Event }).Event('again'))
  })

  test('a listener that throws is reported, and the next one still runs', async () => {
    const errors: Array<string> = []
    const s = await scene([], { onError: report => errors.push(`${report.phase}: ${(report.error as Error).message}`) })
    const calls: Array<string> = []
    s.inner.addEventListener('click', () => {
      throw new Error('boom')
    })
    s.inner.addEventListener('click', () => calls.push('next'))
    s.inner.click()
    expect(calls).toEqual(['next'])
    expect(errors).toEqual(['listener: boom'])
  })
})

describe('hover: where the pointer is, not GPUI\'s exclusive enter and leave', () => {
  test('moving onto a child: no mouseleave on the parent (the browser\'s sequence, Chrome)', async () => {
    const s = await scene(MOUSE_BOUNDARY)
    await s.move(10, 10)
    expect(s.take()).toEqual(['mouseover@outer t=outer', 'mouseenter@outer t=outer'])
    await s.move(100, 100)
    expect(s.take()).toEqual(['mouseout@outer t=outer', 'mouseover@inner t=inner', 'mouseover@outer t=inner', 'mouseenter@inner t=inner'])
    await s.move(10, 10)
    expect(s.take()).toEqual(['mouseout@inner t=inner', 'mouseout@outer t=inner', 'mouseleave@inner t=inner', 'mouseover@outer t=outer'])
    await s.move(390, 290)
    expect(s.take()).toEqual(['mouseout@outer t=outer', 'mouseleave@outer t=outer'])
    await s.move(100, 100)
    expect(s.take()).toEqual(['mouseover@inner t=inner', 'mouseover@outer t=inner', 'mouseenter@outer t=outer', 'mouseenter@inner t=inner'])
  })

  test('leaving through a child that has its own listener: the parent hears it leave, and come back (Metal: it never did)', async () => {
    const s = await scene()
    s.listen(s.outer, 'outer', ['mouseenter', 'mouseleave'])
    s.inner.addEventListener('click', () => {})
    await s.app.settle()
    await s.move(10, 10)
    await s.move(100, 100)
    await s.move(400, 100)
    await s.move(100, 100)
    expect(s.take()).toEqual(['mouseenter@outer t=outer', 'mouseleave@outer t=outer', 'mouseenter@outer t=outer'])
  })

  test('pointer boundary events come first, then the mouse ones, then the move itself', async () => {
    const s = await scene([...POINTER_BOUNDARY, ...MOUSE_BOUNDARY, 'pointermove', 'mousemove'])
    await s.move(10, 10)
    s.take()
    await s.move(100, 100)
    expect(s.take().filter(line => !line.includes('@outer'))).toEqual([
      'pointerover@inner t=inner', 'pointerenter@inner t=inner', 'mouseover@inner t=inner', 'mouseenter@inner t=inner',
      'pointermove@inner t=inner', 'mousemove@inner t=inner',
    ])
    await s.move(10, 10)
    expect(s.take()).toEqual([
      'pointerout@inner t=inner', 'pointerout@outer t=inner', 'pointerleave@inner t=inner', 'pointerover@outer t=outer',
      'mouseout@inner t=inner', 'mouseout@outer t=inner', 'mouseleave@inner t=inner', 'mouseover@outer t=outer',
      'pointermove@outer t=outer', 'mousemove@outer t=outer',
    ])
  })

  test('a move with no button held reaches document and window listeners, at the element under the pointer', async () => {
    const s = await scene()
    const seen: Array<string> = []
    s.document.addEventListener('mousemove', event => seen.push(`document ${(event.target as unknown as NativeElement).getAttribute('id')}`))
    s.document.defaultView!.addEventListener('pointermove', event => seen.push(`window ${(event.target as unknown as NativeElement).getAttribute('id')}`))
    await s.app.settle()
    await s.move(100, 100)
    await s.move(720, 320)
    expect(seen).toEqual(['window inner', 'document inner', 'window far', 'document far'])
  })

  test('GPUI\'s enter or leave with no move (out of the window): the host follows it', async () => {
    const s = await scene(['mouseenter', 'mouseleave'])
    await s.move(100, 100)
    s.take()
    s.send({ eventType: 'mouseLeave', elementId: s.inner.nativeId, hovered: false })
    await s.app.settle()
    expect(s.take()).toEqual(['mouseleave@inner t=inner', 'mouseleave@outer t=outer'])
    s.send({ eventType: 'mouseEnter', elementId: s.inner.nativeId, hovered: true })
    await s.app.settle()
    expect(s.take()).toEqual(['mouseenter@outer t=outer', 'mouseenter@inner t=inner'])
  })

  test('while a button\'s held, hover follows the pointer; after the release, it goes on from where it is', async () => {
    const s = await scene(['mouseenter', 'mouseleave', 'mousedown'])
    await s.move(100, 100)
    s.take()
    const pressed = await press(s, 100, 100)
    expect(pressed.pressed).toBe(s.inner)
    await s.move(10, 10, 0)
    await s.move(720, 320, 0)
    await release(s, pressed, 720, 320)
    await s.move(100, 100)
    expect(s.take()).toEqual([
      'mousedown@inner t=inner', 'mousedown@outer t=inner',
      'mouseleave@inner t=inner', 'mouseleave@outer t=outer', 'mouseenter@far t=far',
      'mouseleave@far t=far', 'mouseenter@outer t=outer', 'mouseenter@inner t=inner',
    ])
  })
})

describe('presses and clicks', () => {
  test('a click: pointerdown, mousedown, pointerup, mouseup, click; button and buttons as a browser has them', async () => {
    const s = await scene()
    const seen: Array<string> = []
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      s.inner.addEventListener(type, event => {
        const mouse = event as unknown as { button: number; buttons: number; target: NativeElement }
        seen.push(`${type} ${mouse.target.getAttribute('id')} ${mouse.button}/${mouse.buttons}`)
      })
    }
    await s.app.settle()
    await s.move(100, 100)
    await release(s, await press(s, 100, 100), 100, 100)
    expect(seen).toEqual(['pointerdown inner 0/1', 'mousedown inner 0/1', 'pointerup inner 0/0', 'mouseup inner 0/0', 'click inner 0/0'])
  })

  test('a press dragged off a button and let go elsewhere clicks what both have in common, not the button', async () => {
    const s = await scene(['click', 'mouseup'])
    s.document.addEventListener('click', event => {
      const target = event.target as unknown as NativeElement
      s.log.push(`click@document t=${target.getAttribute('id') ?? target.localName}`)
    })
    s.btn.addEventListener('mousedown', () => {})
    await s.app.settle()
    await s.move(540, 70)
    const pressed = await press(s, 540, 70)
    await s.move(720, 320, 0)
    await release(s, pressed, 720, 320)
    // Chrome: mouseup on what's under the pointer, the click on the body.
    expect(s.take()).toEqual(['mouseup@far t=far', 'click@document t=body'])
    // Released on it, it clicks.
    await s.move(540, 70)
    await release(s, await press(s, 540, 70), 540, 70)
    expect(s.take()).toEqual(['mouseup@btn t=btn', 'click@btn t=btn', 'click@document t=btn'])
  })

  test('the click\'s target is the deepest element pressed, not the one GPUI picked', async () => {
    const s = await scene()
    const targets: Array<string> = []
    s.outer.addEventListener('click', event => targets.push((event.target as unknown as NativeElement).getAttribute('id')!))
    await s.app.settle()
    await release(s, await press(s, 100, 100), 100, 100)
    expect(targets).toEqual(['inner'])
  })

  test('the right button: pointerdown, mousedown, contextmenu, pointerup, mouseup, auxclick (no click)', async () => {
    const s = await scene(['pointerdown', 'mousedown', 'contextmenu', 'pointerup', 'mouseup', 'auxclick', 'click'])
    await s.move(100, 100)
    const buttons: Array<string> = []
    s.inner.addEventListener('contextmenu', event => buttons.push(`${(event as unknown as MouseEvent).button}/${(event as unknown as MouseEvent).buttons}`))
    await release(s, await press(s, 100, 100, 2), 100, 100, 2)
    expect(s.take().filter(line => line.includes('@inner'))).toEqual([
      'pointerdown@inner t=inner', 'mousedown@inner t=inner', 'contextmenu@inner t=inner',
      'pointerup@inner t=inner', 'mouseup@inner t=inner', 'auxclick@inner t=inner',
    ])
    expect(buttons).toEqual(['2/2'])
  })

  test('the middle button: auxclick after the release, button 1', async () => {
    const s = await scene(['mousedown', 'mouseup', 'auxclick', 'click', 'contextmenu'])
    await s.move(100, 100)
    const buttons: Array<number> = []
    s.inner.addEventListener('auxclick', event => buttons.push((event as unknown as MouseEvent).button))
    await release(s, await press(s, 100, 100, 1), 100, 100, 1)
    expect(s.take().filter(line => line.includes('@inner'))).toEqual(['mousedown@inner t=inner', 'mouseup@inner t=inner', 'auxclick@inner t=inner'])
    expect(buttons).toEqual([1])
  })

  test('FoldKit\'s OnContextMenu on nested elements: the inner one\'s opens, and bubbles', async () => {
    const s = await scene(['contextmenu'])
    await release(s, await press(s, 100, 100, 2), 100, 100, 2)
    expect(s.take()).toEqual(['contextmenu@inner t=inner', 'contextmenu@outer t=inner'])
  })
})

describe('pointer capture (Pointer Events)', () => {
  test('setPointerCapture in pointerdown: got before the next event, moves and the release go to it, lost after pointerup', async () => {
    const s = await scene(['gotpointercapture', 'lostpointercapture', 'pointermove', 'pointerup', 'mouseup'])
    s.inner.addEventListener('pointerdown', event => {
      s.outer.setPointerCapture((event as unknown as PointerEvent).pointerId)
      expect(s.outer.hasPointerCapture(1)).toBe(true)
    })
    await s.app.settle()
    const pressed = await press(s, 100, 100)
    await s.move(720, 320, 0)
    await release(s, pressed, 720, 320)
    expect(s.take()).toEqual([
      'gotpointercapture@outer t=outer', 'pointermove@outer t=outer',
      'pointerup@outer t=outer', 'lostpointercapture@outer t=outer', 'mouseup@outer t=outer',
    ])
    expect(s.outer.hasPointerCapture(1)).toBe(false)
  })

  test('releasePointerCapture, and a capturing element taken out of the document (lost at the document)', async () => {
    const s = await scene(['gotpointercapture', 'lostpointercapture'])
    s.document.addEventListener('lostpointercapture', () => s.log.push('lostpointercapture@document'))
    s.inner.addEventListener('pointerdown', () => s.outer.setPointerCapture(1))
    await s.app.settle()
    let pressed = await press(s, 100, 100)
    await s.move(110, 110, 0)
    s.outer.releasePointerCapture(1)
    expect(s.outer.hasPointerCapture(1)).toBe(false)
    await s.move(120, 120, 0)
    await release(s, pressed, 120, 120)
    expect(s.take()).toEqual(['gotpointercapture@outer t=outer', 'lostpointercapture@outer t=outer', 'lostpointercapture@document'])

    s.far.addEventListener('pointerdown', () => s.far.setPointerCapture(1))
    await s.app.settle()
    pressed = await press(s, 720, 320)
    await s.move(730, 330, 0)
    s.far.remove()
    await s.app.settle()
    await s.move(100, 100, 0)
    await release(s, pressed, 100, 100)
    expect(s.take()).toEqual(['gotpointercapture@far t=far', 'lostpointercapture@document'])
  })

  test('no capture with no button held; another pointer id throws, as in a browser', async () => {
    const s = await scene()
    s.inner.setPointerCapture(1)
    expect(s.inner.hasPointerCapture(1)).toBe(false)
    expect(() => s.inner.setPointerCapture(7)).toThrow('No active pointer')
    const loose = s.document.createElement('div')
    expect(() => loose.setPointerCapture(1)).toThrow('not in a document')
  })

  test('a press GPUI never saw released (let go outside the window): the next move ends it, and the capture with it', async () => {
    const s = await scene(['pointerup', 'mouseup', 'lostpointercapture'])
    s.inner.addEventListener('pointerdown', () => s.inner.setPointerCapture(1))
    await s.app.settle()
    await press(s, 100, 100)
    await s.move(110, 110, 0)
    await s.move(110, 110) // no button held: the release was lost
    expect(s.take()).toEqual(['pointerup@inner t=inner', 'pointerup@outer t=inner', 'lostpointercapture@inner t=inner', 'lostpointercapture@outer t=inner', 'mouseup@inner t=inner', 'mouseup@outer t=inner'])
  })
})

describe('the wheel', () => {
  test('one wheel at the element under the pointer, bubbling, deltas as a browser\'s; scroll only where GPUI scrolled', async () => {
    const s = await scene(['wheel', 'scroll'])
    s.outer.style.overflowY = 'scroll'
    await s.app.settle()
    s.layOut()
    const wheels: Array<string> = []
    s.outer.addEventListener('wheel', event => {
      const wheel = event as unknown as WheelEvent
      event.preventDefault()
      wheels.push(`${wheel.deltaX},${wheel.deltaY} mode ${wheel.deltaMode} cancelable ${wheel.cancelable}`)
    })
    s.inner.addEventListener('wheel', () => {})
    await s.app.settle()
    // GPUI scrolled the area, then told each listening element, innermost first.
    const turn = (deltaY: number, scrolledTo: number) => {
      s.app.gpui.setScrollOffset(s.outer.nativeId, 0, scrolledTo)
      for (const element of [s.inner, s.outer, s.document.body]) {
        s.send({ eventType: 'scroll', elementId: element.nativeId, x: 100, y: 100, deltaX: 0, deltaY, precise: true })
      }
    }
    turn(-50, -50)
    await s.app.settle()
    expect(s.take()).toEqual(['wheel@inner t=inner', 'wheel@outer t=inner', 'scroll@outer t=outer'])
    expect(wheels).toEqual(['0,50 mode 0 cancelable false'])
    // At the end already: a wheel, and no scroll.
    turn(-50, -50)
    await s.app.settle()
    expect(s.take()).toEqual(['wheel@inner t=inner', 'wheel@outer t=inner'])
  })
})

describe('default actions', () => {
  test('Space activates a button on its release only if its press wasn\'t prevented', async () => {
    const s = await scene()
    const clicks: Array<string> = []
    s.btn.addEventListener('click', () => clicks.push('click'))
    let prevent = true
    s.btn.addEventListener('keydown', event => {
      if (prevent && (event as unknown as KeyboardEvent).key === ' ') event.preventDefault()
    })
    s.btn.focus()
    await s.app.settle()
    await s.app.press('space')
    expect(clicks).toEqual([])
    prevent = false
    await s.app.press('space')
    expect(clicks).toEqual(['click'])
  })
})

describe('restyles: only what can reach what\'s drawn', () => {
  test('<head>, unrelated <html> attributes and elements not yet inserted restyle nothing; <html>\'s custom properties restyle the body', async () => {
    const timings: Array<HostTimings> = []
    const s = await scene([], { css: 'html { --accent: red } .tinted { background-color: var(--accent) }', onSynced: timing => timings.push(timing) })
    s.inner.setAttribute('class', 'tinted')
    await s.app.settle()
    const restyled = async (change: () => void) => {
      timings.length = 0
      change()
      await s.app.settle()
      return timings.reduce((sum, timing) => sum + timing.restyled, 0)
    }
    expect(await restyled(() => s.document.head.setAttribute('data-x', '1'))).toBe(0)
    expect(await restyled(() => {
      const meta = s.document.createElement('meta')
      s.document.head.appendChild(meta)
      meta.setAttribute('content', 'x')
    })).toBe(0)
    expect(await restyled(() => s.document.documentElement.setAttribute('lang', 'en'))).toBe(0)
    // snabbdom sets a new element up before inserting it: only the insert restyles, and only it.
    expect(await restyled(() => {
      const fresh = s.document.createElement('div')
      fresh.setAttribute('class', 'tinted')
      fresh.style.width = '10px'
      s.far.appendChild(fresh)
    })).toBe(1) // the new element alone
    const before = s.app.gpui.node(s.inner.nativeId).style['backgroundColor']
    expect(await restyled(() => s.document.documentElement.style.setProperty('--accent', 'blue'))).toBeGreaterThan(4)
    expect(s.app.gpui.node(s.inner.nativeId).style['backgroundColor']).not.toEqual(before)
  })
})

describe.skipIf(!METAL)('real GPUI (Metal): what its dispatch decides', () => {
  /** The same page on real GPUI: hit testing, hover and dispatch are GPUI's. */
  const open = async (types: ReadonlyArray<string>) => {
    const metal = await openMetal('events', { width: 900, height: 500 })
    const { document } = metal
    const log: Array<string> = []
    const make = (id: string, style: string, parent: NativeElement, tag = 'div') => {
      const element = document.createElement(tag)
      element.setAttribute('id', id)
      element.setAttribute('style', style)
      parent.appendChild(element)
      for (const type of types) element.addEventListener(type, ((event: { target: NativeElement }) => log.push(`${type}@${id} t=${event.target.getAttribute('id')}`)) as never)
      return element
    }
    const outer = make('outer', 'position: absolute; left: 0px; top: 0px; width: 300px; height: 200px; padding: 50px; overflow-y: scroll; background-color: #eeeeee', document.body)
    const inner = make('inner', 'width: 100px; height: 600px; background-color: #333333', outer)
    const btn = make('btn', 'position: absolute; left: 500px; top: 50px; width: 80px; height: 40px', document.body, 'button')
    await metal.settle()
    return { metal, log, outer, inner, btn, r: metal.renderer, take: () => log.splice(0) }
  }

  test('hover: onto a child and back, out, and straight in (Chrome\'s sequence)', async () => {
    const { metal, r, take } = await open(MOUSE_BOUNDARY)
    try {
      const step = async (x: number, y: number) => {
        r.nativeSimulateMouseMove(x, y)
        await metal.settle()
        return take()
      }
      expect(await step(10, 10)).toEqual(['mouseover@outer t=outer', 'mouseenter@outer t=outer'])
      expect(await step(100, 100)).toEqual(['mouseout@outer t=outer', 'mouseover@inner t=inner', 'mouseover@outer t=inner', 'mouseenter@inner t=inner'])
      expect(await step(10, 10)).toEqual(['mouseout@inner t=inner', 'mouseout@outer t=inner', 'mouseleave@inner t=inner', 'mouseover@outer t=outer'])
      expect(await step(390, 290)).toEqual(['mouseout@outer t=outer', 'mouseleave@outer t=outer'])
      expect(await step(100, 100)).toEqual(['mouseover@inner t=inner', 'mouseover@outer t=inner', 'mouseenter@outer t=outer', 'mouseenter@inner t=inner'])
    } finally {
      metal.close()
    }
  })

  test('leaving through a child that only listens for clicks: the parent hears it', async () => {
    const { metal, r, take, inner } = await open(['mouseenter', 'mouseleave'])
    try {
      inner.addEventListener('click', () => {})
      for (const [x, y] of [[10, 10], [100, 100], [350, 100], [100, 100]] as const) {
        r.nativeSimulateMouseMove(x, y)
        await metal.settle()
      }
      expect(take().filter(line => line.includes('@outer'))).toEqual(['mouseenter@outer t=outer', 'mouseleave@outer t=outer', 'mouseenter@outer t=outer'])
    } finally {
      metal.close()
    }
  })

  test('the right button opens the context menu; the middle one auxclicks; neither clicks', async () => {
    const { metal, r, take } = await open(['mousedown', 'mouseup', 'contextmenu', 'auxclick', 'click'])
    try {
      r.nativeSimulateMouseMove(100, 100)
      r.nativeSimulateClick(100, 100, 2)
      await metal.settle()
      expect(take().filter(line => line.includes('@inner'))).toEqual(['mousedown@inner t=inner', 'contextmenu@inner t=inner', 'mouseup@inner t=inner', 'auxclick@inner t=inner'])
      r.nativeSimulateClick(100, 100, 1)
      await metal.settle()
      expect(take().filter(line => line.includes('@inner'))).toEqual(['mousedown@inner t=inner', 'mouseup@inner t=inner', 'auxclick@inner t=inner'])
    } finally {
      metal.close()
    }
  })

  test('the wheel: one wheel event under the pointer, and a scroll only where GPUI scrolled', async () => {
    const { metal, r, take, outer } = await open(['wheel', 'scroll'])
    try {
      r.nativeSimulateMouseMove(100, 100)
      await metal.settle()
      take()
      r.nativeSimulateScrollWheel(100, 100, 0, -50)
      await metal.settle()
      expect(take()).toEqual(['wheel@inner t=inner', 'wheel@outer t=inner', 'scroll@outer t=outer'])
      expect(outer.scrollTop).toBe(50)
    } finally {
      metal.close()
    }
  })

  test('a press dragged off a button doesn\'t click it; released on it, it does', async () => {
    const { metal, r, take } = await open(['click'])
    try {
      const drag = async (toX: number, toY: number) => {
        r.nativeSimulateMouseMove(540, 70)
        r.nativeSimulateMouseDown(540, 70)
        await metal.settle()
        r.nativeSimulateMouseMove(toX, toY, 0)
        await metal.settle()
        r.nativeSimulateMouseUp(toX, toY)
        await metal.settle()
        return take()
      }
      expect(await drag(700, 300)).toEqual([])
      expect(await drag(545, 75)).toEqual(['click@btn t=btn'])
    } finally {
      metal.close()
    }
  })
})
