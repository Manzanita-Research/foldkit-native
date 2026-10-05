// Layer bar on FoldKit on gpuix: the app's own start and CSS, no happy-dom.
// Headless on the fake GPUI, and on Metal, where `bar()` is a small window
// of the bar's shape (macOS has no layer shell). On Linux the layer surface
// itself is tested in a headless compositor (layer.test.ts).
import { afterEach, describe, expect, test } from 'bun:test'

import { type Headless, METAL, mountHeadless, openMetal } from '../../packages/foldkit-gpuix/test/support.ts'
import { loadExample } from '../support/example.ts'
import { barWindow } from './app.ts'
import { clockText } from './main'

let app: Headless | undefined
afterEach(() => {
  app?.close()
  app = undefined
})

const open = async () => {
  const example = await loadExample('layer-bar')
  app = mountHeadless({ css: example.css, viewport: { width: example.meta.width, height: example.meta.height } })
  example.start(app.container)
  await app.settle()
  return app
}

describe('the window', () => {
  test('a top bar 40 px thick: anchored to the top and both sides, an exclusive zone of its thickness, keys on demand', () => {
    expect(barWindow).toMatchObject({
      appId: 'dev.foldkit-native.layer-bar', width: 720, height: 40, resizable: false,
      layerShell: { anchor: ['top', 'left', 'right'], exclusiveZone: 40, exclusiveEdge: 'top', keyboardInteractivity: 'on-demand' },
    })
  })
})

describe('headless', () => {
  test('the clock and both buttons, with every CSS rule usable on gpuix', async () => {
    const bar = await open()
    expect(bar.unsupported).toEqual([])
    const shown = bar.texts()
    expect(shown).toEqual(expect.arrayContaining(['FoldKit', 'Quiet', 'Light']))
    // The clock shows the time now, to the minute.
    expect([clockText(Date.now()), clockText(Date.now() - 60_000)]).toContain(bar.document.getElementById('clock')!.textContent)
  })

  test('keyboard: Tab to Quiet, Space toggles it; Tab to the theme button, Enter switches theme', async () => {
    const bar = await open()
    await bar.press('tab')
    expect(bar.document.activeElement?.getAttribute('id')).toBe('quiet')
    await bar.press('space')
    expect(bar.document.getElementById('quiet')!.getAttribute('aria-pressed')).toBe('true')
    await bar.press('tab')
    await bar.press('enter')
    expect(bar.texts()).toContain('Dark')
    // The paper theme's surface on the bar now.
    const root = bar.document.querySelector('.bar')!
    expect(bar.gpui.node(root.nativeId).style).toMatchObject({ backgroundColor: '#fffdf8' })
  })
})

describe.skipIf(!METAL)('Metal: the fallback window', () => {
  test('a 720 × 40 window: the bar fills it, the buttons click through GPUI\'s hit test; both themes', async () => {
    const example = await loadExample('layer-bar')
    const bar = await openMetal('layer-bar', { width: 720, height: 40 }, { css: example.css })
    try {
      example.start(bar.container)
      await bar.settle()
      const root = bar.document.querySelector('.bar')!.getBoundingClientRect()
      console.log('layer bar on Metal:', JSON.stringify(root))
      expect([root.x, root.y, root.width, root.height]).toEqual([0, 0, 720, 40])
      expect(bar.painted()).toEqual(expect.arrayContaining(['FoldKit', 'Quiet', 'Light']))
      bar.screenshot('dusk')
      await bar.click(bar.document.getElementById('quiet')!)
      expect(bar.document.getElementById('quiet')!.getAttribute('aria-pressed')).toBe('true')
      await bar.click(bar.document.getElementById('theme')!)
      expect(bar.painted()).toContain('Dark')
      const tree = JSON.stringify(bar.renderer.getA11yTree())
      for (const name of ['"Quiet on"', '"Dark"']) expect(tree).toContain(name)
      bar.screenshot('paper')
    } finally {
      bar.close()
    }
  })
})
