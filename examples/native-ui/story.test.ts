// Native UI's logic, with FoldKit's story tools: each component's Messages
// through the app's update.
import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'

import { Listbox } from '@foldkit-native/ui'

import { Message, initialModel, emailError, themeFor, update } from './main'

describe('update', () => {
  test('text fields: typing updates the profile; a bad email is an error', () => {
    story(
      update,
      given(initialModel),
      message(Message.ChangedName({ value: 'Ada' })),
      message(Message.ChangedEmail({ value: 'ada@' })),
      model(next => {
        expect(next.name).toBe('Ada')
        expect(emailError(next.email)).toBe('That doesn’t look like an email address')
      }),
    )
    expect(emailError('ada@example.com')).toBeUndefined()
  })

  test('switch: the theme flips, and every token with it', () => {
    story(
      update,
      given(initialModel),
      message(Message.ToggledDark({ isChecked: false })),
      model(next => {
        expect(next.isDark).toBe(false)
        expect(themeFor(next)['color.canvas']).toBe('#f4f1ea')
      }),
    )
  })

  test('listbox: keys move the highlight (and scroll it into view); selecting sets the accent token', () => {
    story(
      update,
      given(initialModel),
      message(Message.GotAccentsMessage({ message: Listbox.Message.PressedKey({ key: 'ArrowDown', labels: ['Violet', 'Blue'] }) })),
      Command.resolve(Listbox.ScrollIntoView, Listbox.Message.CompletedScrollIntoView()),
      message(Message.SelectedAccent({ value: 'teal' })),
      model(next => {
        expect(next.accents.highlighted).toBe(2)
        expect(next.accent).toBe('teal')
        expect(themeFor(next)['color.accent']).toBe('#14a3a0')
      }),
    )
  })

  test('dialog: opens, cancels, and a confirmed reset keeps the theme', () => {
    story(
      update,
      given({ ...initialModel, name: 'Ada', isDark: false }),
      message(Message.ClickedReset()),
      model(next => expect(next.isDialogOpen).toBe(true)),
      message(Message.ClosedDialog()),
      model(next => expect(next.isDialogOpen).toBe(false)),
      message(Message.ClickedReset()),
      message(Message.ConfirmedReset()),
      model(next => {
        expect(next).toMatchObject({ name: '', isDark: false, isDialogOpen: false, resets: 1 })
      }),
    )
  })
})
