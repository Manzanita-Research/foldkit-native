// Native UI's view, with FoldKit's scene tools: by role and label, as a
// person (or a screen reader) finds things.
import { Command, click, expect, given, keydown, label, role, scene, text, type } from 'foldkit/scene'
import { describe, test } from 'vitest'

import { Listbox } from '@foldkit-native/ui'

import { initialModel, update, view } from './main'

describe('view', () => {
  test('the profile fields are labelled; a bad email is described as the error', () => {
    scene(
      { update, view },
      given(initialModel),
      expect(role('heading', { name: 'Preferences' })).toExist(),
      expect(label('Name')).toExist(),
      type(label('Email'), 'nope'),
      expect(label('Email')).toHaveAttr('aria-invalid', 'true'),
      expect(text('That doesn’t look like an email address')).toExist(),
    )
  })

  test('the dark theme switch toggles the theme the view shows', () => {
    scene(
      { update, view },
      given(initialModel),
      expect(role('switch', { name: 'Dark theme' })).toHaveAttr('aria-checked', 'true'),
      click(role('switch', { name: 'Dark theme' })),
      expect(text('FoldKit on gpuix · light · violet')).toExist(),
    )
  })

  test('the accent listbox: arrows highlight, Enter selects', () => {
    scene(
      { update, view },
      given(initialModel),
      keydown(role('listbox', { name: 'Accent colour' }), 'ArrowDown'),
      Command.resolve(Listbox.ScrollIntoView, Listbox.Message.CompletedScrollIntoView()),
      keydown(role('listbox', { name: 'Accent colour' }), 'Enter'),
      expect(text('FoldKit on gpuix · dark · blue')).toExist(),
      expect(role('option', { name: 'Blue' })).toHaveAttr('aria-selected', 'true'),
    )
  })

  test('the reset dialog: a modal dialog with a title; Escape closes it', () => {
    scene(
      { update, view },
      given(initialModel),
      click(role('button', { name: 'Reset profile…' })),
      expect(role('dialog', { name: 'Reset profile?' })).toHaveAttr('aria-modal', 'true'),
      keydown(role('dialog'), 'Escape'),
      expect(role('dialog')).toBeAbsent(),
    )
  })
})
