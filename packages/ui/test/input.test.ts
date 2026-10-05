// Input and Textarea: scene test, and native tests on FoldKit on gpuix
// (headless, and on Metal in both themes), where both are GPUI's editors.
import { describe, expect as bunExpect, test } from 'bun:test'
import { expect, given, label, scene, type } from 'foldkit/scene'

import { Profile } from './apps.ts'
import { METAL, THEMES, headless, metal } from './run.ts'

describe('scene', () => {
  test('labelled and described; disabled says so; typing reaches the model', () => {
    scene(
      { update: Profile.update, view: Profile.view },
      given(Profile.init),
      expect(label('Name')).toHaveAttr('aria-describedby', 'name-description'),
      expect(label('Invite code')).toBeDisabled(),
      expect(label('Bio')).toHaveAttr('rows', '3'),
      type(label('Bio'), 'Counts engines'),
      expect(label('Bio')).toHaveValue('Counts engines'),
      type(label('Name'), 'Augusta Ada King, Countess of Lovelace'),
      expect(label('Name')).toHaveAttr('aria-invalid', 'true'),
    )
  })
})

describe('native, headless', () => {
  test('GPUI\'s editors; Tab goes field to field, past the disabled one; read-only takes no edits', async () => {
    const app = await headless(Profile)
    try {
      const active = () => app.document.activeElement?.getAttribute('id') ?? null
      const node = (id: string) => app.gpui.node(app.document.getElementById(id)!.nativeId)
      bunExpect([node('name').type, node('bio').type]).toEqual(['input', 'textarea'])
      bunExpect(node('name').props).toMatchObject({ role: 'textbox', 'aria-label': 'Name', placeholder: 'Ada Lovelace' })
      bunExpect(node('bio').props['aria-label']).toBe('Bio')
      bunExpect(node('handle').props).toMatchObject({ readOnly: true, tabIndex: 0 })
      bunExpect(node('invite').props).toMatchObject({ readOnly: true, tabIndex: -1 })
      const stops: Array<string | null> = []
      for (const _ of [1, 2, 3]) {
        await app.press('tab')
        stops.push(active())
      }
      bunExpect(stops).toEqual(['name', 'handle', 'bio'])
      await app.type('Name', 'Ada')
      await app.type('Bio', 'Counts\nengines')
      bunExpect(app.model()).toEqual({ name: 'Ada', bio: 'Counts\nengines' })
      bunExpect(app.texts()).toContain('14 of 160')
      await app.type('Name', 'Augusta Ada King, Countess of Lovelace')
      bunExpect(app.texts()).toContain('At most 20 characters')
      bunExpect(node('name').props['aria-invalid'] ?? app.document.getElementById('name')!.getAttribute('aria-invalid')).toBe('true')
    } finally {
      app.close()
    }
  })

  for (const theme of ['paper', 'dusk'] as const) {
    test(`${theme}: fields are the surface with the border; read-only the canvas; disabled half-strength; Bio three lines tall`, async () => {
      const app = await headless(Profile, theme)
      try {
        const tokens = THEMES[theme]
        const style = (id: string) => app.gpui.node(app.document.getElementById(id)!.nativeId).style
        bunExpect(style('name')).toMatchObject({ backgroundColor: tokens['color.surface'], borderColor: tokens['color.border'] })
        bunExpect(style('bio')).toMatchObject({ backgroundColor: tokens['color.surface'], borderColor: tokens['color.border'] })
        bunExpect(style('handle')).toMatchObject({ backgroundColor: tokens['color.canvas'] })
        bunExpect(style('handle')['hover']).toBeUndefined()
        bunExpect(style('invite')['opacity']).toBe(0.5)
        // Three 20px lines, 8px padding above and below, a 1px border each side.
        bunExpect(style('bio')['height']).toBe(78)
        await app.type('Name', 'Augusta Ada King, Countess of Lovelace')
        bunExpect(style('name')).toMatchObject({ borderColor: tokens['color.danger'] })
      } finally {
        app.close()
      }
    })
  }
})

describe.skipIf(!METAL)('native, Metal', () => {
  for (const theme of ['paper', 'dusk'] as const) {
    test(`${theme}: click into Name and type, Tab past the disabled field into Bio, type lines; AccessKit has the text fields`, async () => {
      const app = await metal('input', Profile, theme)
      try {
        app.screenshot('initial')
        await app.click(app.document.getElementById('name')!)
        await app.keys('A d a')
        await app.keys('tab')
        bunExpect(app.document.activeElement?.getAttribute('id')).toBe('handle')
        // Read-only: GPUI's editor takes no keys.
        await app.keys('x')
        await app.keys('tab')
        bunExpect(app.document.activeElement?.getAttribute('id')).toBe('bio')
        await app.keys('h i enter t h e r e')
        console.log(`ui input (${theme}):`, JSON.stringify(app.model()))
        bunExpect(app.model()).toEqual({ name: 'Ada', bio: 'hi\nthere' })
        bunExpect(app.document.getElementById('handle')!.value).toBe('@ada')
        bunExpect(app.painted()).toContain('8 of 160')
        const tree = JSON.stringify(app.renderer.getA11yTree())
        console.log(`ui input a11y (${theme}):`, tree.slice(0, 700))
        for (const name of ['Name', 'Handle', 'Invite code', 'Bio']) bunExpect(tree).toContain(`"${name}"`)
        app.screenshot('typed')
      } finally {
        app.close()
      }
    })
  }
})
