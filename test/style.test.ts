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

  test("margin: auto isn't sent: gpuix's margins are numbers, and a string fails the whole style", async () => {
    // Tailwind's mx-auto. gpuix rejects "auto": `invalid type: string "auto", expected f64`.
    const { box } = await styleOf('margin: 8px auto;')
    expect(box).toMatchObject({ marginTop: 8, marginBottom: 8 })
    expect(box).not.toHaveProperty('marginLeft')
    expect(box).not.toHaveProperty('marginRight')
  })

  test('calc(), as Tailwind writes it once happy-dom substitutes the variables', () => {
    expect([px('calc(.25rem * 4)'), px('calc(0.25rem * -2)'), px('calc(10px + 2 * 3px)'), px('calc((4px + 2px) / 2)'), px('calc(1px * auto)')])
      .toEqual([16, -8, 16, 3, undefined])
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

  test("a border with no colour of its own is the text colour, as Tailwind 4's `border` is", async () => {
    // Tailwind's preflight, then `border` (a width only).
    const black = await styleOf('border: 0 solid; border-width: 1px;')
    expect(black.box).toMatchObject({ borderTopWidth: 1, borderColor: '#000000' })
    const coloured = await styleOf('border: 0 solid; border-top-width: 1px; color: #112233;')
    expect(coloured.box).toMatchObject({ borderTopWidth: 1, borderColor: '#112233' })
    const none = await styleOf('border: 0 solid; color: #112233;')
    expect(none.box['borderColor']).toBeUndefined()
  })

  test("Tailwind's shapes: unitless line height, stacked shadows, keyword gradients", async () => {
    const { box, text } = await styleOf(`font-size: 36px; line-height: calc(2.5 / 2.25);
      box-shadow: 0 0 #0000, 0 0 rgba(0, 0, 0, 0), 0 10px 15px -3px rgba(0, 0, 0, .1), 0 4px 6px -4px rgba(0, 0, 0, .1);
      background-image: linear-gradient(to bottom right in oklab, #dbeafe 0%, #c0d8ff 50%, #90c5ff 100%);`)
    expect(text.lineHeight).toBeCloseTo(40)
    expect(box.boxShadow).toEqual({ offsetX: 0, offsetY: 10, blurRadius: 15, spreadRadius: -3, color: 'rgba(0, 0, 0, .1)' })
    expect(box.background).toEqual({ type: 'linear-gradient', angle: 135, stops: [{ color: '#dbeafe', position: 0 }, { color: '#90c5ff', position: 1 }] })
    const { text: plain } = await styleOf('font-size: 16px; line-height: 1.5;')
    expect(plain.lineHeight).toBe(24)
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
  test('an input draws its own text, so it gets the text style too', async () => {
    mounted = mountFake({ css: 'input { background-color: #111318; color: #eceef4; font-size: 15px; font-weight: 600; }' })
    const input = mounted.document.createElement('input')
    mounted.container.appendChild(input)
    await mounted.settle()
    expect(mounted.nativeOf(input).style).toMatchObject({
      backgroundColor: '#111318', color: '#eceef4', fontSize: 15, fontWeight: 600,
    })
  })

  test("a button centres its label, as a browser's own stylesheet does; the app's CSS can override it", async () => {
    mounted = mountFake({ css: '.left { text-align: left; }' })
    const centred = mounted.document.createElement('button')
    centred.textContent = 'Join Waitlist'
    const left = mounted.document.createElement('button')
    left.className = 'left'
    left.textContent = 'Menu'
    mounted.container.append(centred, left)
    await mounted.settle()
    expect(mounted.nativeOf(centred).style).toMatchObject({ textAlign: 'center' })
    expect(mounted.nativeOf(left).style).toMatchObject({ textAlign: 'left' })
  })
})

describe('the page', () => {
  test('scrolls like a browser viewport: the root fills the window and scrolls what overflows', async () => {
    mounted = mountFake()
    await mounted.settle()
    expect(mounted.nativeOf(mounted.document.body).style).toMatchObject({ height: '100%', overflowY: 'scroll' })
  })

  test("the app's CSS can turn it off", async () => {
    mounted = mountFake({ css: 'body { overflow-y: visible; }' })
    await mounted.settle()
    expect(mounted.nativeOf(mounted.document.body).style['overflowY']).toBeUndefined()
  })
})

describe('text selection', () => {
  test('like a native app, UI text is not selectable: the root opts out and everything inherits it', async () => {
    const { box, text } = await styleOf('padding: 4px;')
    expect(mounted.nativeOf(mounted.document.body).style.userSelect).toBe('none')
    // Unset below the root, so GPUI's inheritance keeps it off.
    expect(box.userSelect).toBeUndefined()
    expect(text.userSelect).toBeUndefined()
  })

  test('text opts back in with user-select (text, all and contain all mean selectable)', async () => {
    for (const value of ['text', 'all', 'contain']) {
      const { box, text } = await styleOf(`user-select: ${value};`)
      expect([box.userSelect, text.userSelect]).toEqual(['text', 'text'])
      await mounted.close()
    }
    const { box } = await styleOf('user-select: auto;')
    expect(box.userSelect).toBeUndefined()
  })

  test("the app's CSS can make the whole window selectable again", async () => {
    mounted = mountFake({ css: 'body { user-select: text; }' })
    await mounted.settle()
    expect(mounted.nativeOf(mounted.document.body).style.userSelect).toBe('text')
  })
})

describe('interaction states', () => {
  const hovered = async (css: string) => {
    mounted = mountFake({ css })
    const div = mounted.document.createElement('div')
    div.className = 'b'
    mounted.container.appendChild(div)
    await mounted.settle()
    return div
  }

  test('a state rule written with var() gets the value, as Tailwind writes every hover colour', async () => {
    const div = await hovered(':root { --h: #123456; } .b:hover { background-color: var(--h); }')
    expect(mounted.nativeOf(div).style['hover']).toEqual({ backgroundColor: '#123456' })
  })

  test('hover rules inside @media (hover: hover), where Tailwind 4 puts them, count', async () => {
    const div = await hovered(':root { --h: #123456; } @media (hover: hover) { .b:hover { background-color: var(--h); } }')
    expect(mounted.nativeOf(div).style['hover']).toEqual({ backgroundColor: '#123456' })
  })

  test("var() in a state rule falls back when the property isn't set", async () => {
    const div = await hovered('.b:hover { background-color: var(--missing, var(--also-missing, #abcdef)); color: var(--c, #fff); }')
    expect(mounted.nativeOf(div).style['hover']).toEqual({ backgroundColor: '#abcdef', color: '#fff' })
  })

  test('a theme switch changes a var() hover colour', async () => {
    const div = await hovered(`.app { --h: #111111; } .app[data-theme="light"] { --h: #eeeeee; }
      .b:hover { background-color: var(--h); box-shadow: 0px 2px 4px 0px var(--h); }`)
    const app = mounted.document.createElement('div')
    app.className = 'app'
    mounted.container.appendChild(app)
    app.appendChild(div)
    await mounted.settle()
    expect(mounted.nativeOf(div).style['hover']).toMatchObject({ backgroundColor: '#111111', boxShadow: { color: '#111111' } })
    app.setAttribute('data-theme', 'light')
    await mounted.settle()
    expect(mounted.nativeOf(div).style['hover']).toMatchObject({ backgroundColor: '#eeeeee', boxShadow: { color: '#eeeeee' } })
  })

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

describe('viewport', () => {
  test('vh, vw and media queries measure the window attachDom is given, not happy-dom’s 1024 × 768', async () => {
    mounted = mountFake({
      viewport: { width: 600, height: 900 },
      css: '.x { min-height: 100vh; width: 50vw; } @media (min-width: 768px) { .x { padding-top: 7px; } }',
    })
    const div = mounted.document.createElement('div')
    div.className = 'x'
    mounted.container.appendChild(div)
    await mounted.settle()
    expect(mounted.window.innerWidth).toBe(600)
    const style = mounted.nativeOf(div).style
    expect(style).toMatchObject({ minHeight: 900, width: 300 })
    expect(style['paddingTop']).toBeUndefined()
  })
})
