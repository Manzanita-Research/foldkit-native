// Listbox: story tests (its update, with FoldKit's own story tools), a scene
// test, and native tests on FoldKit on gpuix.
import { describe, expect as bunExpect, test } from 'bun:test'
import { Option } from 'effect'
import { Command as SceneCommand, click, expect, given as givenScene, keydown, role, scene } from 'foldkit/scene'
import { Command, given, message, model, story } from 'foldkit/story'

import * as Listbox from '../src/listbox.ts'
import { Picker } from './apps.ts'
import { METAL, headless, metal } from './run.ts'

const labels = Picker.items.map(item => item.label)

describe('story', () => {
  test('Down moves the highlight and asks for it to be scrolled into view', () => {
    story(
      Listbox.update,
      given(Listbox.init({ id: 'fruit' })),
      message(Listbox.Message.PressedKey({ key: 'ArrowDown', labels })),
      Command.expectHas(Listbox.ScrollIntoView({ elementId: 'fruit-option-1' })),
      Command.resolve(Listbox.ScrollIntoView, Listbox.Message.CompletedScrollIntoView()),
      model(next => bunExpect(next.highlighted).toBe(1)),
    )
  })

  test('the highlight stops at the ends; Home and End jump', () => {
    story(
      Listbox.update,
      given(Listbox.init({ id: 'fruit', highlighted: 0 })),
      message(Listbox.Message.PressedKey({ key: 'ArrowUp', labels })),
      model(next => bunExpect(next.highlighted).toBe(0)),
    )
    story(
      Listbox.update,
      given(Listbox.init({ id: 'fruit', highlighted: 3 })),
      message(Listbox.Message.PressedKey({ key: 'End', labels })),
      Command.resolve(Listbox.ScrollIntoView, Listbox.Message.CompletedScrollIntoView()),
      model(next => bunExpect(next.highlighted).toBe(labels.length - 1)),
    )
  })

  test('a letter jumps to the next option starting with it, wrapping', () => {
    bunExpect(Listbox.nextHighlight(0, 'b', labels)).toEqual(Option.some(2))
    bunExpect(Listbox.nextHighlight(2, 'b', labels)).toEqual(Option.some(3))
    bunExpect(Listbox.nextHighlight(3, 'b', labels)).toEqual(Option.some(2))
    bunExpect(Listbox.nextHighlight(0, 'z', labels)).toEqual(Option.none())
  })

  test('the pointer highlights without scrolling', () => {
    story(
      Listbox.update,
      given(Listbox.init({ id: 'fruit' })),
      message(Listbox.Message.PointedAt({ index: 4 })),
      Command.expectNone(),
      model(next => bunExpect(next.highlighted).toBe(4)),
    )
  })
})

describe('scene', () => {
  test('a listbox of options; the highlighted one is the active descendant; Enter and clicks select', () => {
    scene(
      { update: Picker.update, view: Picker.view },
      givenScene(Picker.init),
      expect(role('listbox', { name: 'Fruit' })).toHaveAttr('aria-activedescendant', 'fruit-option-0'),
      expect(role('option', { name: 'Apple' })).toHaveAttr('aria-selected', 'true'),
      keydown(role('listbox'), 'ArrowDown'),
      SceneCommand.resolve(Listbox.ScrollIntoView, Listbox.Message.CompletedScrollIntoView()),
      expect(role('listbox')).toHaveAttr('aria-activedescendant', 'fruit-option-1'),
      keydown(role('listbox'), 'Enter'),
      expect(role('option', { name: 'Apricot' })).toHaveAttr('aria-selected', 'true'),
      click(role('option', { name: 'Cherry' })),
      expect(role('option', { name: 'Cherry' })).toHaveAttr('aria-selected', 'true'),
    )
  })
})

describe('native, headless', () => {
  test('one tab stop; arrows move the highlight and GPUI scrolls it into view; Enter selects', async () => {
    const app = await headless(Picker)
    try {
      const list = app.document.getElementById('fruit')!
      await app.press('tab')
      bunExpect(app.document.activeElement).toBe(list)
      for (const _ of [1, 2, 3, 4, 5]) await app.press('down')
      bunExpect(list.getAttribute('aria-activedescendant')).toBe('fruit-option-5')
      const scrolled = app.fake.scrolledIntoView.map(id => app.elementFor(id)?.getAttribute('id'))
      bunExpect(scrolled.at(-1)).toBe('fruit-option-5')
      await app.press('enter')
      bunExpect(app.model().fruit).toBe('damson')
      // One stop for the whole list: Tab doesn't walk the options.
      bunExpect(app.fake.tabOrder()).toEqual([list.nativeId])
    } finally {
      app.close()
    }
  })
})

// A sold-out fruit's option is aria-disabled: still reached by the
// highlight (and the list keeps its focus), but never selected.
describe('disabled options (aria-disabled, focusable)', () => {
  test('the view: aria-disabled and no click; Enter and Space select nothing', () => {
    scene(
      { update: Picker.update, view: Picker.view },
      givenScene({ ...Picker.init, soldOut: ['apricot'] }),
      expect(role('option', { name: 'Apricot' })).toHaveAttr('aria-disabled', 'true'),
      keydown(role('listbox'), 'ArrowDown'),
      SceneCommand.resolve(Listbox.ScrollIntoView, Listbox.Message.CompletedScrollIntoView()),
      expect(role('listbox')).toHaveAttr('aria-activedescendant', 'fruit-option-1'),
      keydown(role('listbox'), 'Enter'),
      keydown(role('listbox'), ' '),
      expect(role('option', { name: 'Apple' })).toHaveAttr('aria-selected', 'true'),
    )
  })

  test('headless: disabled while highlighted and focused, the list keeps focus and nothing selects; back in stock, Enter selects', async () => {
    const app = await headless(Picker)
    try {
      const list = app.document.getElementById('fruit')!
      await app.press('tab')
      await app.press('down')
      await app.press('escape')
      bunExpect(app.model().soldOut).toEqual(['apricot'])
      // aria-disabled is not HTML's disabled: still the focused tab stop.
      bunExpect(app.document.activeElement).toBe(list)
      bunExpect(app.fake.tabOrder()).toEqual([list.nativeId])
      await app.press('enter')
      await app.press('space')
      bunExpect(app.model().fruit).toBe('apple')
      // A click on it: GPUI has no listener there to tell.
      bunExpect(app.gpui.node(app.document.getElementById('fruit-option-1')!.nativeId).listeners.has('click')).toBe(false)
      // The highlight still moves past it and back.
      await app.press('down')
      await app.press('up')
      bunExpect(list.getAttribute('aria-activedescendant')).toBe('fruit-option-1')
      await app.press('escape')
      await app.press('enter')
      bunExpect(app.model().fruit).toBe('apricot')
    } finally {
      app.close()
    }
  })
})

describe.skipIf(!METAL)('native, Metal', () => {
  test('a disabled option: keys and a click don\'t select it, the list keeps focus; re-enabled, it selects', async () => {
    const app = await metal('listbox-disabled', Picker)
    try {
      const list = app.document.getElementById('fruit')!
      await app.keys('tab')
      bunExpect(app.document.activeElement).toBe(list)
      await app.keys('down')
      await app.press('escape')
      bunExpect(app.model().soldOut).toEqual(['apricot'])
      bunExpect(app.document.activeElement).toBe(list)
      bunExpect(app.gpuiFocus()).toBe(list)
      await app.press('enter')
      await app.press('space')
      // Space is the list's even here: it doesn't scroll the list a page.
      bunExpect(list.scrollTop).toBe(0)
      await app.click(app.document.getElementById('fruit-option-1')!)
      bunExpect(app.model().fruit).toBe('apple')
      app.screenshot('sold-out')
      await app.keys('down up')
      await app.press('escape')
      await app.press('enter')
      bunExpect(app.model().fruit).toBe('apricot')
      app.screenshot('back-in-stock')
    } finally {
      app.close()
    }
  })

  test('arrowing past the fold scrolls the highlighted option into view (GPUI\'s scrollIntoView)', async () => {
    const app = await metal('listbox', Picker)
    try {
      const list = app.document.getElementById('fruit')!
      // The adapter reveals through painted bounds and scrollTo, which moves
      // only the list (gpuix's own scrollIntoView moved the page too).
      list.focus()
      await app.keys('down down down down down down down down')
      const option = app.document.getElementById('fruit-option-8')!
      // The document's boxes: gpuix reports a scrolled list's own box moved
      // by its scroll offset, and the adapter puts it back.
      const listBox = list.getBoundingClientRect()
      const optionBox = option.getBoundingClientRect()
      console.log('ui listbox:', JSON.stringify({ listBox, optionBox, scrollTop: list.scrollTop }))
      bunExpect(optionBox.y).toBeGreaterThanOrEqual(listBox.y)
      bunExpect(optionBox.y + optionBox.height).toBeLessThanOrEqual(listBox.y + listBox.height + 1)
      app.screenshot('highlight-scrolled')
      await app.keys('enter')
      bunExpect(app.model().fruit).toBe('grape')
    } finally {
      app.close()
    }
  })
})
