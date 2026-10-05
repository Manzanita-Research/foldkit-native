// Layer bar's update: the clock, the quiet toggle, the theme.
import { describe, expect as bunExpect, test } from 'bun:test'
import { given, message, model, story } from 'foldkit/story'

import { Message, clockText, init, update } from './main'

// Monday 5 October 2026, 09:07 local time.
const MONDAY = new Date(2026, 9, 5, 9, 7, 30).getTime()

describe('update', () => {
  test('the clock ticks; quiet toggles; the theme switches and back', () => {
    story(
      update,
      given(init(MONDAY)().model),
      message(Message.TickedClock({ now: MONDAY + 60_000 })),
      model(next => bunExpect(next.now).toBe(MONDAY + 60_000)),
      message(Message.ToggledQuiet()),
      model(next => bunExpect(next.isQuiet).toBe(true)),
      message(Message.ToggledQuiet()),
      model(next => bunExpect(next.isQuiet).toBe(false)),
      message(Message.SwitchedTheme()),
      model(next => bunExpect(next.theme).toBe('paper')),
      message(Message.SwitchedTheme()),
      model(next => bunExpect(next.theme).toBe('dusk')),
    )
  })

  test('the clock reads as a day and a 24-hour time, in local time', () => {
    bunExpect(clockText(MONDAY)).toBe('Mon 09:07')
    bunExpect(clockText(new Date(2026, 9, 10, 23, 59).getTime())).toBe('Sat 23:59')
  })
})
