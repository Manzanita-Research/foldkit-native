// CSS → gpuix style, and tokens. The cascade is happy-dom's; these check what
// the mirror copies out of the computed style and how tokens resolve.
import { afterEach, describe, expect, test } from 'bun:test'

import { fontFamily, px } from '../src/style.ts'
import { setTokens, token, tokensToCss } from '../src/theme.ts'
import { type Mounted, mountFake } from './support/mount.ts'

let mounted: Mounted
afterEach(() => mounted?.close())

/** The gpuix style of a `<div>` with this CSS, and of the text inside it. */
const styleOf = async (css: string, tokens?: Record<string, string | number>) => {
  mounted = mountFake({ css: `.x { ${css} }`, ...(tokens === undefined ? {} : { tokens }) })
  const div = mounted.document.createElement('div')
  div.className = 'x'
  div.textContent = 'text'
  mounted.container.appendChild(div)
  await mounted.settle()
  const box = mounted.nativeOf(div)
  return { box: box.style, text: mounted.gpui.node(box.children[0]!).style, div }
}

describe('values', () => {
  test('px', () => {
    expect([px('12px'), px('1.5rem'), px('2em'), px('-4px'), px('7'), px('auto'), px('50%')])
      .toEqual([12, 24, 32, -4, 7, undefined, undefined])
  })

  test('font families: the first one, generic names resolved to GPUI names', () => {
    expect(fontFamily('"Inter", system-ui, sans-serif')).toBe('Inter')
    expect(fontFamily('system-ui, sans-serif')).toBe('.SystemUIFont')
    expect(fontFamily('-apple-system, BlinkMacSystemFont')).toBe('.SystemUIFont')
    expect(fontFamily('sans-serif')).toBe('.SystemUIFont')
    expect(fontFamily('ui-monospace, monospace')).toBe('.ZedMono')
    expect(fontFamily("'Times New Roman'")).toBe('Times New Roman')
    expect(fontFamily('')).toBeUndefined()
  })
})

describe('box', () => {
  test('flex layout, spacing and sizes', async () => {
    const { box } = await styleOf(`display: flex; flex-direction: column; align-items: center; justify-content: space-between;
      gap: 8px; padding: 4px 6px; margin-top: 2px; width: 50%; height: 120px; min-width: 10px; flex-grow: 1; flex-shrink: 0;`)
    expect(box).toMatchObject({
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between',
      gap: 8, paddingTop: 4, paddingRight: 6, paddingBottom: 4, paddingLeft: 6, marginTop: 2,
      width: '50%', height: 120, minWidth: 10, flexGrow: 1, flexShrink: 0,
    })
  })

  test('grid columns become a track count', async () => {
    expect((await styleOf('display: grid; grid-template-columns: repeat(3, 1fr);')).box.gridTemplateColumns).toBe(3)
    expect((await styleOf('display: grid; grid-template-columns: 1fr 1fr;')).box.gridTemplateColumns).toBe(2)
  })

  test('colours, borders, radius, opacity, cursor', async () => {
    const { box } = await styleOf(`background-color: #123456; border: 2px solid #abcdef; border-radius: 6px;
      opacity: 0.5; cursor: pointer; user-select: none; pointer-events: none;`)
    expect(box).toMatchObject({
      backgroundColor: '#123456', borderColor: '#abcdef', borderTopWidth: 2, borderLeftWidth: 2,
      borderTopLeftRadius: 6, borderBottomRightRadius: 6, opacity: 0.5, cursor: 'pointer', userSelect: 'none', pointerEvents: 'none',
    })
  })

  test('a two-stop linear gradient and a box shadow', async () => {
    const { box } = await styleOf('background: linear-gradient(180deg, #44304f, #19161d); box-shadow: 0px 10px 30px 2px #00000080;')
    expect(box.background).toEqual({ type: 'linear-gradient', angle: 180, stops: [{ color: '#44304f', position: 0 }, { color: '#19161d', position: 1 }] })
    expect(box.boxShadow).toEqual({ offsetX: 0, offsetY: 10, blurRadius: 30, spreadRadius: 2, color: '#00000080' })
  })

  test('display: none hides the element and nothing else is copied', async () => {
    expect((await styleOf('display: none; width: 10px; color: red;')).box).toEqual({ display: 'none' })
  })
})

describe('text', () => {
  test('text style comes from the parent, inherited values included', async () => {
    const { text } = await styleOf(`color: #fafafa; font-family: system-ui; font-size: 18px; font-weight: bold;
      line-height: 24px; white-space: nowrap; text-overflow: ellipsis;`)
    expect(text).toMatchObject({
      color: '#fafafa', fontFamily: '.SystemUIFont', fontSize: 18, fontWeight: 700, lineHeight: 24,
      whiteSpace: 'nowrap', textOverflow: 'ellipsis',
    })
  })
})

describe('interaction states', () => {
  test(':hover, :active and :focus-visible become GPUI state styles', async () => {
    mounted = mountFake({
      css: `.b { background-color: #000000; } .b:hover { background-color: #111111; color: #eeeeee; }
        .b:active { background-color: #222222; } .b:focus-visible { border: 2px solid #333333; }`,
    })
    const button = mounted.document.createElement('button')
    button.className = 'b'
    mounted.container.appendChild(button)
    await mounted.settle()
    const style = mounted.nativeOf(button).style
    expect(style['backgroundColor']).toBe('#000000')
    expect(style['hover']).toEqual({ backgroundColor: '#111111', color: '#eeeeee' })
    expect(style['active']).toEqual({ backgroundColor: '#222222' })
    expect(style['focusVisible']).toMatchObject({ borderColor: '#333333', borderTopWidth: 2 })
  })
})

describe('tokens', () => {
  test('token() and tokensToCss()', () => {
    expect(token('color.surface')).toBe('var(--fn-color-surface)')
    expect(token('space.3', '4px')).toBe('var(--fn-space-3, 4px)')
    expect(tokensToCss({ 'color.text': '#fff', 'radius.2': 8 }))
      .toBe(':root {\n  --fn-color-text: #fff;\n  --fn-radius-2: 8px;\n}')
  })

  test('tokens resolve in colours, lengths and shadows, and switch live', async () => {
    const { div } = await styleOf(
      `background-color: ${token('color.surface')}; padding: ${token('space.3')}; box-shadow: ${token('elevation.2')}; color: ${token('color.text')};`,
      { 'color.surface': '#111111', 'space.3': 12, 'elevation.2': '0px 2px 6px 0px #00000026', 'color.text': '#eeeeee' },
    )
    const box = () => mounted.nativeOf(div).style
    const text = () => mounted.gpui.node(mounted.nativeOf(div).children[0]!).style
    expect(box()).toMatchObject({ backgroundColor: '#111111', paddingTop: 12, boxShadow: { offsetY: 2, blurRadius: 6, color: '#00000026' } })
    expect(text()['color']).toBe('#eeeeee')
    mounted.setTokens({ 'color.surface': '#fefefe', 'space.3': 4, 'elevation.2': '0px 1px 2px 0px #000000', 'color.text': '#000000' })
    await mounted.settle()
    expect(box()).toMatchObject({ backgroundColor: '#fefefe', paddingTop: 4, boxShadow: { offsetY: 1, blurRadius: 2 } })
    expect(text()['color']).toBe('#000000')
  })

  test('a subtree can carry its own token scope', async () => {
    mounted = mountFake({ css: `.card { background-color: ${token('color.surface')}; }`, tokens: { 'color.surface': '#111111' } })
    setTokens(mounted.document, { 'color.surface': '#ffffff' }, '[data-theme="light"]')
    const outer = mounted.document.createElement('div')
    outer.className = 'card'
    const scope = mounted.document.createElement('div')
    scope.setAttribute('data-theme', 'light')
    const inner = mounted.document.createElement('div')
    inner.className = 'card'
    scope.appendChild(inner)
    mounted.container.append(outer, scope)
    await mounted.settle()
    expect(mounted.nativeOf(outer).style['backgroundColor']).toBe('#111111')
    expect(mounted.nativeOf(inner).style['backgroundColor']).toBe('#ffffff')
  })

  test('changing the root data-theme restyles everything', async () => {
    mounted = mountFake({ css: `:root { --fn-bg: #111111; } :root[data-theme="light"] { --fn-bg: #ffffff; } .x { background-color: var(--fn-bg); }` })
    const div = mounted.document.createElement('div')
    div.className = 'x'
    mounted.container.appendChild(div)
    await mounted.settle()
    expect(mounted.nativeOf(div).style['backgroundColor']).toBe('#111111')
    mounted.document.documentElement.setAttribute('data-theme', 'light')
    await mounted.settle()
    expect(mounted.nativeOf(div).style['backgroundColor']).toBe('#ffffff')
  })
})
