// The sheet's contract (FKN-18), gate by gate: what it styles, how a change
// reaches what it styled, and what it says it can't do. Specificity, source
// order, inline style and `!important` are in adapter.test.ts ("the cascade").
import { afterEach, describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import { Runtime } from 'foldkit'
import type { HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'

import { sheetFromCss } from '../src/index.ts'
import { mountHeadless } from './support.ts'

type Headless = ReturnType<typeof mountHeadless>
let app: Headless | undefined
afterEach(() => {
  app?.close()
  app = undefined
})

const Message = defineMessageUnion({ Set: { state: Schema.String } })
type Message = typeof Message.Type

/** A FoldKit app whose view is `view(state)`, moved by `set(state)`. */
const open = async (css: string, view: (state: string, h: HtmlBuilder<Message>) => unknown, viewport = { width: 800, height: 600 }) => {
  app = mountHeadless({ css, viewport })
  const mounted = app
  mounted.own(Runtime.embed(Runtime.makeElement({
    Model: Schema.Struct({ state: Schema.String }),
    init: () => ({ model: { state: 'a' } }),
    update: (_: unknown, message: Message) => ({ model: { state: message.state } }),
    view: (model: { state: string }, h: HtmlBuilder<Message>) => view(model.state, h),
    container: mounted.container,
  } as never)))
  await mounted.settle()
  const style = (id: string) => mounted.gpui.node(mounted.document.getElementById(id)!.nativeId).style
  const textStyle = (id: string) => mounted.gpui.node(mounted.gpui.node(mounted.document.getElementById(id)!.nativeId).children[0]!).style
  return { app: mounted, style, textStyle }
}
describe('the sheet\'s contract', () => {
  test('descendant and child combinators follow an ancestor\'s state (Big List\'s selected row)', async () => {
    const { style, textStyle } = await open(`
      .row .cell { color: #777777; }
      .row[data-selected] .cell { color: #ffffff; }
      .list > .row { padding: 2px; }
      .list .row { margin-top: 1px; }
    `, (state, h) => h.div([h.Class('list')], [
      h.div([h.Class('row'), h.Id('row'), ...(state === 'on' ? [h.DataAttribute('selected', '')] : [])], [h.span([h.Class('cell'), h.Id('cell')], ['Song'])]),
      h.button([h.Id('on'), h.OnClick(Message.Set({ state: 'on' }))], ['on']),
      h.button([h.Id('off'), h.OnClick(Message.Set({ state: 'off' }))], ['off']),
    ]))
    expect(textStyle('cell')).toMatchObject({ color: '#777777' })
    expect(style('row')).toMatchObject({ paddingTop: 2, marginTop: 1 })
    await app!.click('on')
    expect(textStyle('cell')).toMatchObject({ color: '#ffffff' })
    // The attribute goes away: the descendant rule stops applying.
    await app!.click('off')
    expect(textStyle('cell')).toMatchObject({ color: '#777777' })
  })

  test('a class removed: its rule stops applying', async () => {
    const { style } = await open(`.box { padding: 4px; } .wide { width: 200px; }`, (state, h) =>
      h.div([], [h.div([h.Id('box'), h.Class(state === 'a' ? 'box wide' : 'box')], ['x']), h.button([h.Id('b'), h.OnClick(Message.Set({ state: 'b' }))], ['b'])]))
    expect(style('box')).toMatchObject({ paddingTop: 4, width: 200 })
    await app!.click('b')
    expect(style('box')['width']).toBeUndefined()
    expect(style('box')).toMatchObject({ paddingTop: 4 })
  })

  test('keyed rows reordered: the same elements, in GPUI\'s new order, styled as before', async () => {
    const { style } = await open(`.list > .row { padding: 3px; } .row[data-first] { padding: 7px; }`, (state, h) => {
      const ids = state === 'a' ? ['r1', 'r2', 'r3'] : ['r3', 'r1', 'r2']
      return h.div([], [
        h.div([h.Class('list'), h.Id('list')], ids.map((id, i) =>
          h.keyed('div')(id, [h.Id(id), h.Class('row'), ...(i === 0 ? [h.DataAttribute('first', '')] : [])], [id]))),
        h.button([h.Id('move'), h.OnClick(Message.Set({ state: 'b' }))], ['move']),
      ])
    })
    const r3 = app!.document.getElementById('r3')!
    expect(style('r1')).toMatchObject({ paddingTop: 7 })
    expect(style('r3')).toMatchObject({ paddingTop: 3 })
    await app!.click('move')
    expect(app!.document.getElementById('r3')).toBe(r3)
    const list = app!.gpui.node(app!.document.getElementById('list')!.nativeId)
    expect(list.children).toEqual(['r3', 'r1', 'r2'].map(id => app!.document.getElementById(id)!.nativeId))
    expect(style('r3')).toMatchObject({ paddingTop: 7 })
    expect(style('r1')).toMatchObject({ paddingTop: 3 })
  })

  test('an element that moves to another parent is styled for where it is now', async () => {
    const { style } = await open(`.left .item { padding: 1px; } .right .item { padding: 9px; }`, (state, h) => {
      const item = h.div([h.Id('item'), h.Class('item')], ['item'])
      return h.div([], [
        h.div([h.Class('left')], state === 'a' ? [item] : []),
        h.div([h.Class('right')], state === 'a' ? [] : [item]),
        h.button([h.Id('move'), h.OnClick(Message.Set({ state: 'b' }))], ['move']),
      ])
    })
    expect(style('item')).toMatchObject({ paddingTop: 1 })
    await app!.click('move')
    expect(style('item')).toMatchObject({ paddingTop: 9 })
  })

  test('a token swap restyles everything that reads it, text included', async () => {
    const { style, textStyle } = await open(`
      .surface { background-color: var(--fn-color-surface); color: var(--fn-color-text); }
    `, (_, h) => h.div([h.Class('surface'), h.Id('surface')], [h.p([h.Id('para')], ['Hello'])]))
    app!.setTokens({ 'color-surface': '#101010', 'color-text': '#eeeeee' })
    await app!.settle()
    expect(style('surface')).toMatchObject({ backgroundColor: '#101010' })
    expect(textStyle('para')).toMatchObject({ color: '#eeeeee' })
    app!.setTokens({ 'color-surface': '#fafafa', 'color-text': '#111111' })
    app!.host.restyleAll()
    await app!.settle()
    expect(style('surface')).toMatchObject({ backgroundColor: '#fafafa' })
    expect(textStyle('para')).toMatchObject({ color: '#111111' })
  })

  test('text properties inherit down the tree, and an ancestor\'s change reaches the text', async () => {
    const { textStyle } = await open(`
      .a { color: #123456; font-size: 18px; font-weight: 700; }
      .b { font-size: 12px; }
      .a[data-dim] { color: #999999; }
    `, (state, h) => h.div([h.Class('a'), ...(state === 'dim' ? [h.DataAttribute('dim', '')] : [])], [
      h.div([h.Class('b')], [h.span([h.Id('deep')], ['deep'])]),
      h.button([h.Id('dim'), h.OnClick(Message.Set({ state: 'dim' }))], ['dim']),
    ]))
    expect(textStyle('deep')).toMatchObject({ color: '#123456', fontSize: 12, fontWeight: 700 })
    await app!.click('dim')
    expect(textStyle('deep')).toMatchObject({ color: '#999999', fontSize: 12 })
  })

  test('@media follows the window: a resize restyles, and `resize` fires', async () => {
    const { style } = await open(`
      .panel { padding: 4px; }
      @media (min-width: 900px) { .panel { padding: 24px; } }
      @media (width < 500px) { .panel { padding: 0; } }
    `, (_, h) => h.div([h.Class('panel'), h.Id('panel')], ['p']))
    expect(style('panel')).toMatchObject({ paddingTop: 4 })
    let resized = 0
    window.addEventListener('resize', () => resized++)
    app!.fake.resize(1200, 600)
    app!.host.drawn()
    await app!.settle()
    expect(window.innerWidth).toBe(1200)
    expect(resized).toBe(1)
    expect(style('panel')).toMatchObject({ paddingTop: 24 })
    app!.fake.resize(400, 600)
    app!.host.drawn()
    await app!.settle()
    expect(style('panel')['paddingTop']).toBeUndefined()
    expect(matchMedia('(width < 500px)').matches).toBe(true)
  })

  test('viewport units and auto margins: Tailwind\'s min-h-screen and mx-auto', async () => {
    const { style } = await open(`
      .page { min-height: 100vh; }
      .card { max-width: 28rem; margin-left: auto; margin-right: auto; }
      .half { width: 50vw; }
    `, (_, h) => h.div([h.Class('page'), h.Id('page')], [h.div([h.Class('card'), h.Id('card')], ['c']), h.div([h.Class('half'), h.Id('half')], ['h'])]))
    expect(style('page')).toMatchObject({ minHeight: 600, display: 'flex', flexDirection: 'column' })
    expect(style('card')).toMatchObject({ alignSelf: 'center', width: '100%', maxWidth: 448 })
    expect(style('half')).toMatchObject({ width: 400 })
    app!.fake.resize(1000, 700)
    app!.host.drawn()
    await app!.settle()
    expect(style('page')).toMatchObject({ minHeight: 700 })
    expect(style('half')).toMatchObject({ width: 500 })
  })

  test('h.Style: keys and units as the sheet reads them', async () => {
    const { style } = await open('', (_, h) => h.div([h.Id('styled'), h.Style({
      'padding': '4px 8px', 'margin-top': '1rem', 'width': '50%', 'border': '2px solid #ff0000', 'background-color': '#00ff00',
      'border-radius': '6px', 'gap': '3px', 'display': 'flex', 'flex-direction': 'column',
    })], ['s']))
    expect(style('styled')).toMatchObject({
      paddingTop: 4, paddingRight: 8, marginTop: 16, width: '50%', borderTopWidth: 2, backgroundColor: '#00ff00',
      borderTopLeftRadius: 6, gap: 3, display: 'flex', flexDirection: 'column',
    })
  })

  test('@supports is evaluated, not always taken; an escaped colon is part of a name', () => {
    const sheet = sheetFromCss(`
      @supports (color: rgb(from red r g b)) { .relative { color: red } }
      @supports (color: oklch(0.5 0.1 200)) { .oklch { color: red } }
      @supports not (color: color-mix(in lab, red, red)) { .no-mix { color: red } }
      @supports selector(.a > .b) { .child-ok { color: red } }
      @supports selector(.a + .b) { .sibling { color: red } }
      .md\\:hover\\:x:hover { color: red }
      @supports (((-webkit-hyphens: none)) and (not (margin-trim: inline))) or ((-moz-orient: inline) and (not (color: rgb(from red r g b)))) { .tw-defaults { color: red } }
    `)
    expect(sheet.rules.map(rule => rule.source)).toEqual(['.oklch', '.no-mix', '.child-ok', '.md\\:hover\\:x:hover', '.tw-defaults'])
    expect(sheet.rules.find(rule => rule.source.startsWith('.md'))?.state).toBe('hover')
  })
})
