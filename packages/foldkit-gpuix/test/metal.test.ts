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
    await app!.keys('down down down enter')
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
