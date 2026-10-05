// TextField: FoldKit's scene test (the view, by role and label), and native
// tests on FoldKit on gpuix (headless, and real GPUI on macOS in both themes).
import { describe, expect as bunExpect, test } from 'bun:test'
import { expect, given, label, scene, type } from 'foldkit/scene'

import { Fields } from './apps.ts'
import { METAL, headless, metal } from './run.ts'

describe('scene', () => {
  test('labelled, described, and typing reaches the model', () => {
    scene(
      { update: Fields.update, view: Fields.view },
      given(Fields.init),
      expect(label('Name')).toExist(),
      expect(label('Email')).toHaveAttr('aria-describedby', 'email-description'),
      type(label('Email'), 'ada'),
      expect(label('Email')).toHaveAttr('aria-invalid', 'true'),
      expect(label('Email')).toHaveValue('ada'),
    )
  })
})

describe('native, headless', () => {
  test('GPUI\'s own input, a tab stop; Tab goes field to field; the error shows', async () => {
    const app = await headless(Fields)
    try {
      bunExpect(app.native('Ada').type).toBe('input')
      await app.press('tab')
      bunExpect(app.document.activeElement?.getAttribute('id')).toBe('name')
      await app.press('tab')
      bunExpect(app.document.activeElement?.getAttribute('id')).toBe('email')
      await app.type('Email', 'nope')
      bunExpect(app.model().email).toBe('nope')
      bunExpect(app.texts()).toContain('Needs an @')
      bunExpect(app.native('Email').style['borderColor']).toBe('#f2727f')
    } finally {
      app.close()
    }
  })
})

describe.skipIf(!METAL)('native, Metal', () => {
  for (const theme of ['paper', 'dusk'] as const) {
    test(`${theme}: click into Name, type, Tab, type: each field gets its keys; AccessKit names them by their labels`, async () => {
      const app = await metal('text-field', Fields, theme)
      try {
        await app.click(app.document.getElementById('name')!)
        await app.keys('A d a')
        await app.keys('tab')
        await app.keys('a @ b')
        console.log('ui text-field:', JSON.stringify(app.model()))
        bunExpect(app.model()).toEqual({ name: 'Ada', email: 'a@b' })
        const tree = JSON.stringify(app.renderer.getA11yTree())
        for (const name of ['"Name"', '"Email"']) bunExpect(tree).toContain(name)
        app.screenshot('typed')
        await app.keys('backspace backspace')
        bunExpect(app.painted()).toContain('Needs an @')
        app.screenshot('invalid')
      } finally {
        app.close()
      }
    })
  }
})
