// FoldKit on gpuix on real GPUI, offscreen (gpuix's TestRenderer with Metal;
// macOS only, as Linux can't read frames back). Layout, hit testing, focus
// and keystrokes are GPUI's own, so these check what the headless tests
// assume: GPUI's tab order, `focusNext`, and that the DOM follows it.
// Each test logs what it saw, so a CI log explains a failure.
import { afterEach, describe, expect, test } from 'bun:test'

import { loadExample } from '../../../examples/support/example.ts'
import { METAL, openMetal } from './support.ts'

type Metal = Awaited<ReturnType<typeof openMetal>>
let app: Metal | undefined
afterEach(() => {
  app?.close()
  app = undefined
})

const openExample = async (id: string) => {
  const example = await loadExample(id)
  app = await openMetal(`gpuix-${id}`, { width: example.meta.width, height: example.meta.height }, { css: example.css })
  example.start(app.container)
  await app.settle()
  return app
}

const byId = (id: string) => {
  const element = app!.document.getElementById(id)
  if (element === null) throw new Error(`no #${id}`)
  return element
}
const active = () => app!.document.activeElement?.getAttribute('id') ?? app!.document.activeElement?.localName ?? null

describe.skipIf(!METAL)('FoldKit on gpuix, Metal', () => {
  test('Form, unmodified: a click focuses a field, Tab moves through GPUI focus, typing lands', async () => {
    await openExample('form')
    app!.screenshot('form-empty')
    await app!.click(byId('name'))
    // Clicking into GPUI's editor sends no focus event; the adapter follows
    // GPUI's focus on the root's press/release and before keys.
    console.log('gpuix form after click:', JSON.stringify({ gpui: app!.gpuiFocus()?.getAttribute('id') ?? null, dom: active() }))
    const gpui = [app!.gpuiFocus()?.getAttribute('id') ?? null]
    const dom = [active()]
    for (const _ of [1, 2]) {
      await app!.keys('tab')
      gpui.push(app!.gpuiFocus()?.getAttribute('id') ?? null)
      dom.push(active())
    }
    console.log('gpuix form Tab:', JSON.stringify({ gpui, dom }))
    expect(gpui).toEqual(['name', 'email', 'message'])
    expect(dom).toEqual(gpui)
    await app!.keys('shift-tab')
    expect(active()).toBe('email')
    await app!.keys('n o p e')
    console.log('gpuix form typed email:', (byId('email') as unknown as { value: string }).value)
    expect((byId('email') as unknown as { value: string }).value).toBe('nope')
    app!.screenshot('form-tabbed')
  })

  test('element.focus() moves GPUI focus', async () => {
    await openExample('form')
    byId('message').focus()
    await app!.settle()
    expect(app!.gpuiFocus()?.getAttribute('id')).toBe('message')
  })

  test('Big List, unmodified: the theme switch, clicked through GPUI hit testing', async () => {
    await openExample('big-list')
    app!.screenshot('big-list-dark')
    const toggle = app!.document.querySelector('.theme-switch')!
    await app!.click(toggle)
    console.log('gpuix big-list after toggle:', app!.painted().filter(text => text === 'Dark' || text === 'Light'))
    expect(app!.painted()).toContain('Light')
    app!.screenshot('big-list-light')
    // And from the keyboard: Tab to it, Space.
    toggle.focus()
    await app!.press('space')
    expect(app!.painted()).toContain('Dark')
  })

  test('Native UI: Tab order, switch by Space, listbox by arrows, dialog trap', async () => {
    await openExample('native-ui')
    app!.screenshot('native-ui-start')
    const stops: Array<string | null> = []
    for (let i = 0; i < 6; i++) {
      await app!.keys('tab')
      stops.push(active())
    }
    console.log('gpuix native-ui Tab:', stops.join(' → '))
    expect(stops.slice(1, 6)).toEqual(['name', 'email', 'dark', 'accent', 'reset'])

    await app!.click(byId('name'))
    await app!.keys('A d a')
    byId('dark').focus()
    await app!.press('space')
    expect(app!.painted().some(text => text.includes('light'))).toBe(true)
    byId('accent').focus()
    await app!.settle()
    console.log('gpuix native-ui before arrows:', JSON.stringify({ dom: active(), gpui: app!.gpuiFocus()?.getAttribute('id') ?? null }))
    await app!.keys('down down down')
    console.log('gpuix native-ui after arrows:', JSON.stringify({
      dom: active(), gpui: app!.gpuiFocus()?.getAttribute('id') ?? null,
      highlighted: byId('accent').getAttribute('aria-activedescendant'),
    }))
    await app!.keys('enter')
    expect(app!.painted().some(text => text.includes('green'))).toBe(true)
    app!.screenshot('native-ui-light-green')

    byId('reset').focus()
    await app!.keys('enter')
    expect(app!.painted()).toContain('Reset profile?')
    const trapped: Array<string | null> = [app!.document.activeElement?.textContent ?? null]
    for (let i = 0; i < 3; i++) {
      await app!.keys('tab')
      trapped.push(app!.document.activeElement?.textContent ?? null)
    }
    console.log('gpuix native-ui dialog Tab:', trapped.join(' → '))
    expect(trapped).toEqual(['Cancel', 'Reset', 'Cancel', 'Reset'])
    app!.screenshot('native-ui-dialog')
    await app!.keys('escape')
    expect(app!.painted()).not.toContain('Reset profile?')
    expect(active()).toBe('reset')
  })
})

// Where GPUI painted things, as the document reads them (FKN-29): the border
// box, from gpuix's automation tree, for every kind of element GPUI draws.
describe.skipIf(!METAL)('geometry on Metal', () => {
  /** Plain elements under the body, from HTML-ish specs. */
  const build = async (html: Array<{ tag: string; id: string; style: string; parent?: string }>) => {
    app = await openMetal('gpuix-geometry', { width: 400, height: 300 })
    for (const { tag, id, style, parent } of html) {
      const element = app.document.createElement(tag)
      element.setAttribute('id', id)
      element.setAttribute('style', style)
      ;(parent === undefined ? app.document.body : byId(parent)).appendChild(element)
    }
    await app.settle()
  }
  const box = (id: string) => {
    const { x, y, width, height } = byId(id).getBoundingClientRect()
    return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
  }

  // gpuix reports a single-line input's box from its content corner across,
  // but down from its border plus half the difference of its top and bottom
  // padding (its editor shares the vertical padding out evenly). Read as a
  // div's, a padded input's top was 8 px too high (FKN-21 found it).
  test('padded fields and a padded div side by side: the same top, their border boxes', async () => {
    // GPUI sizes border boxes (Tailwind's preflight does the same).
    const padded = 'padding: 8px 12px; border: 1px solid #888; width: 80px; flex-shrink: 0'
    await build([
      { tag: 'div', id: 'row', style: 'display: flex; flex-direction: row; align-items: flex-start; gap: 10px; padding: 20px' },
      { tag: 'div', id: 'label', style: `${padded}; height: 40px`, parent: 'row' },
      { tag: 'input', id: 'field', style: padded, parent: 'row' },
      { tag: 'input', id: 'tall', style: 'padding: 20px 4px 2px; border: 3px solid #888; width: 80px; flex-shrink: 0', parent: 'row' },
      { tag: 'textarea', id: 'notes', style: `${padded}; height: 60px`, parent: 'row' },
      { tag: 'input', id: 'low', style: 'padding: 0 0 10px; border: 0; width: 20px; flex-shrink: 0', parent: 'row' },
    ])
    const seen = { label: box('label'), field: box('field'), tall: box('tall'), notes: box('notes'), low: box('low') }
    const raw = Object.fromEntries(['label', 'field', 'tall', 'notes', 'low'].map(id => [id, app!.bounds(byId(id))]))
    console.log('gpuix geometry, padded fields:', JSON.stringify({ seen, raw }))
    expect(seen.label).toEqual({ x: 20, y: 20, width: 80, height: 40 })
    expect(seen.field).toMatchObject({ x: 110, y: 20, width: 80 })
    expect(seen.tall).toMatchObject({ x: 200, y: 20, width: 80 })
    expect(seen.notes).toEqual({ x: 290, y: 20, width: 80, height: 60 })
    expect(seen.low).toMatchObject({ x: 380, y: 20, width: 20 })
  })

  test('elementsFromPoint agrees with GPUI\'s own hit test: a re-homed popover on top, a scroll area clipping', async () => {
    const fill = (colour: string) => `background-color: ${colour}`
    await build([
      { tag: 'div', id: 'panel', style: `position: relative; height: 140px; ${fill('#eee')}` },
      { tag: 'div', id: 'wrapper', style: 'height: 60px', parent: 'panel' },
      // Absolute: GPUI draws it under `panel`, its containing block, last.
      { tag: 'div', id: 'popover', style: `position: absolute; top: 10px; left: 10px; width: 150px; height: 100px; ${fill('#fc0')}`, parent: 'wrapper' },
      { tag: 'div', id: 'after', style: `height: 60px; ${fill('#9cf')}`, parent: 'panel' },
      { tag: 'div', id: 'list', style: `overflow-y: scroll; height: 60px; ${fill('#ccc')}` },
      { tag: 'div', id: 'first', style: `height: 40px; flex-shrink: 0; ${fill('#f99')}`, parent: 'list' },
      { tag: 'div', id: 'second', style: `height: 40px; flex-shrink: 0; ${fill('#9f9')}`, parent: 'list' },
      { tag: 'div', id: 'below', style: `height: 60px; ${fill('#99f')}` },
    ])
    // Which element GPUI's hit test picks: the innermost a click reaches.
    let clicked: string | null = null
    for (const id of ['panel', 'wrapper', 'popover', 'after', 'list', 'first', 'second', 'below']) {
      byId(id).addEventListener('click', event => {
        clicked ??= (event.target as unknown as { getAttribute: (name: string) => string | null }).getAttribute('id')
      })
    }
    await app!.settle()
    app!.screenshot('geometry-hits')
    const points = {
      // Over `after`, under the popover (painted later, so on top).
      popover: { x: 50, y: 90 },
      after: { x: 300, y: 90 },
      first: { x: 50, y: 150 },
      // `second` runs past the list's bottom, over `below`: clipped there.
      clipped: { x: 50, y: 210 },
    }
    const seen: Record<string, { document: string | null; gpui: string | null }> = {}
    for (const [name, { x, y }] of Object.entries(points)) {
      clicked = null
      app!.renderer.nativeSimulateClick(x, y)
      await app!.settle()
      seen[name] = { document: app!.document.elementFromPoint(x, y)?.getAttribute('id') ?? null, gpui: clicked }
    }
    console.log('gpuix geometry, hits:', JSON.stringify(seen))
    for (const { document, gpui } of Object.values(seen)) expect(document).toBe(gpui)
    expect(seen).toMatchObject({ popover: { gpui: 'popover' }, after: { gpui: 'after' }, first: { gpui: 'first' }, clipped: { gpui: 'below' } })
  })
})
