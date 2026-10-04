// The gallery's update, with FoldKit's story tests.
import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { expect, test } from 'vitest'

import { type Entry, Message, type Model, OpenExample, update } from './main'

const weather: Entry = {
  id: 'weather', title: 'Weather', blurb: 'b', foldkit: 'f', gpui: 'g', ported: true,
  command: ['examples/open.ts', 'weather'],
}
const gallery: Model = { entries: [weather], opened: Option.none() }

test('clicking an entry opens that example, then says so', () => {
  story(
    update,
    given(gallery),
    message(Message.ClickedEntry({ id: 'weather' })),
    Command.expectExact(OpenExample({ id: 'weather', command: ['examples/open.ts', 'weather'] })),
    Command.resolve(OpenExample, Message.OpenedExample({ id: 'weather' })),
    model(model => {
      expect(model.opened).toEqual(Option.some('weather'))
    }),
  )
})

test('an unknown entry opens nothing', () => {
  story(
    update,
    given(gallery),
    message(Message.ClickedEntry({ id: 'nope' })),
    Command.expectNone(),
  )
})
