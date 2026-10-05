// Layer bar's view, by role: the clock and the two buttons.
import { describe, test } from 'bun:test'
import { click, expect, given, role, scene, text } from 'foldkit/scene'

import { init, update, view } from './main'

const MONDAY = new Date(2026, 9, 5, 9, 7, 30).getTime()

describe('view', () => {
  test('the clock; Quiet is a toggle button that says it is pressed; the theme button names the other theme', () => {
    scene(
      { update, view },
      given(init(MONDAY)().model),
      expect(text('Mon 09:07')).toExist(),
      expect(role('button', { name: 'Quiet' })).toHaveAttr('aria-pressed', 'false'),
      click(role('button', { name: 'Quiet' })),
      expect(role('button', { name: 'Quiet on' })).toHaveAttr('aria-pressed', 'true'),
      click(role('button', { name: 'Light' })),
      expect(role('button', { name: 'Dark' })).toExist(),
    )
  })
})
