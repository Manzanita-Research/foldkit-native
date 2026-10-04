// CLICK-THROUGH (FKN-12). gpuix lets an element that paints a fill block hits
// to everything behind it, its own ancestors included; a browser bubbles a
// click on a child up to its parent. So a child of an element listening for
// the pointer, with no listeners of its own, gets gpuix's pointerEvents
// 'none' (which only stops it blocking), and the hit lands on the listener.
import { afterEach, describe, expect, test } from 'bun:test'

import { type Mounted, mountFake } from './support/mount.ts'

let mounted: Mounted
afterEach(() => mounted?.close())

const css = `.fill { width: 40px; height: 20px; background-color: #ff0000; }
  .floating { position: absolute; }
  .scroller { overflow-y: auto; height: 40px; }
  .auto { pointer-events: auto; }
  .ghost { pointer-events: none; }`

/** Mounts `html` in the container and returns a lookup for its elements' native styles. */
const setup = async (html: string) => {
  mounted = mountFake({ css })
  await mounted.settle()
  mounted.container.innerHTML = html
  await mounted.settle()
  const $ = (selector: string) => mounted.document.querySelector(selector)!
  return { $, pointer: (selector: string) => mounted.nativeOf($(selector)).style['pointerEvents'] }
}

describe('click-through', () => {
  test("a listener's filled children, and theirs, let hits through to it", async () => {
    const { $, pointer } = await setup('<div id="card"><div id="chip" class="fill"><div id="dot" class="fill"></div></div></div>')
    expect(pointer('#chip')).toBeUndefined()
    $('#card').addEventListener('click', () => {})
    await mounted.settle()
    expect(pointer('#chip')).toBe('none')
    expect(pointer('#dot')).toBe('none')
    // The rest of the style is untouched, and the listener itself still blocks.
    expect(mounted.nativeOf($('#chip')).style).toMatchObject({ backgroundColor: '#ff0000', width: 40 })
    expect(pointer('#card')).toBeUndefined()
  })

  test('mouse down, moves and hover make a listener a target too', async () => {
    for (const type of ['pointerdown', 'mouseup', 'mouseenter', 'pointermove']) {
      const { $, pointer } = await setup('<div id="card"><div id="chip" class="fill"></div></div>')
      $('#card').addEventListener(type, () => {})
      await mounted.settle()
      expect(pointer('#chip')).toBe('none')
      await mounted.close()
    }
  })

  test('only a pointer listener counts: keys, or nothing, leave children blocking', async () => {
    const { $, pointer } = await setup('<div id="card" tabindex="0"><div id="chip" class="fill"></div></div><div id="plain"><div id="other" class="fill"></div></div>')
    $('#card').addEventListener('keydown', () => {})
    await mounted.settle()
    expect(pointer('#chip')).toBeUndefined()
    expect(pointer('#other')).toBeUndefined()
  })

  test('a document listener (a drag tracked on document) makes nothing click-through', async () => {
    const { pointer } = await setup('<div id="card" class="fill"><div id="chip" class="fill"></div></div>')
    mounted.document.addEventListener('pointermove', () => {})
    await mounted.settle()
    expect(pointer('#card')).toBeUndefined()
    expect(pointer('#chip')).toBeUndefined()
  })

  test('a child with listeners of its own keeps its hits, and its children let them through to it', async () => {
    const { $, pointer } = await setup('<div id="card"><div id="button" class="fill"><div id="icon" class="fill"></div></div></div>')
    $('#card').addEventListener('click', () => {})
    $('#button').addEventListener('click', () => {})
    await mounted.settle()
    expect(pointer('#button')).toBeUndefined()
    expect(pointer('#icon')).toBe('none')
  })

  test('positioned children, scrollers, fields and CSS pointer-events keep their own behaviour', async () => {
    const { $, pointer } = await setup(`<div id="card">
      <div id="floating" class="fill floating"><div id="inside" class="fill"></div></div>
      <div id="scroller" class="fill scroller"><div id="row" class="fill"></div></div>
      <input id="field">
      <div id="auto" class="fill auto"></div>
    </div>`)
    $('#card').addEventListener('click', () => {})
    await mounted.settle()
    // A positioned box can sit outside its listener, over something else.
    expect(pointer('#floating')).toBeUndefined()
    expect(pointer('#inside')).toBeUndefined()
    expect(pointer('#scroller')).toBeUndefined()
    expect(pointer('#row')).toBeUndefined()
    expect(pointer('#field')).toBeUndefined()
    expect(pointer('#auto')).toBeUndefined()
  })

  test('CSS pointer-events: none reaches the children, as a browser inherits it', async () => {
    const { pointer } = await setup('<div id="ghost" class="fill ghost"><div id="part" class="fill"><div id="deep" class="fill"></div></div><div id="back" class="fill auto"></div></div>')
    expect(pointer('#ghost')).toBe('none')
    expect(pointer('#part')).toBe('none')
    expect(pointer('#deep')).toBe('none')
    expect(pointer('#back')).toBeUndefined()
  })

  test('a listener going away makes its children block again; one coming back lets them through', async () => {
    const { $, pointer } = await setup('<div id="card"><div id="chip" class="fill"><div id="dot" class="fill"></div></div></div>')
    const onClick = () => {}
    $('#card').addEventListener('click', onClick)
    await mounted.settle()
    expect(pointer('#dot')).toBe('none')
    $('#card').removeEventListener('click', onClick)
    await mounted.settle()
    expect(pointer('#chip')).toBeUndefined()
    expect(pointer('#dot')).toBeUndefined()
    // A child gaining a listener of its own keeps its hits; its children pass to it.
    $('#card').addEventListener('click', onClick)
    $('#chip').addEventListener('click', onClick)
    await mounted.settle()
    expect(pointer('#chip')).toBeUndefined()
    expect(pointer('#dot')).toBe('none')
    expect(mounted.inSync()).toBe(true)
  })

  test('a child moved out of a listener blocks again; one moved in lets hits through', async () => {
    const { $, pointer } = await setup('<div id="card"><div id="chip" class="fill"></div></div><div id="plain"></div>')
    $('#card').addEventListener('click', () => {})
    await mounted.settle()
    expect(pointer('#chip')).toBe('none')
    $('#plain').appendChild($('#chip'))
    await mounted.settle()
    expect(pointer('#chip')).toBeUndefined()
    $('#card').appendChild($('#chip'))
    await mounted.settle()
    expect(pointer('#chip')).toBe('none')
  })

  test('a restyle keeps it (a class change recomputes the whole style)', async () => {
    const { $, pointer } = await setup('<div id="card"><div id="chip" class="fill"></div></div>')
    $('#card').addEventListener('click', () => {})
    await mounted.settle()
    $('#chip').setAttribute('data-on', '')
    $('#card').setAttribute('class', 'x')
    await mounted.settle()
    expect(pointer('#chip')).toBe('none')
  })
})
