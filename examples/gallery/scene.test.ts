// The gallery's view, with FoldKit's scene tests.
import { Option } from 'effect'
import { Command, click, expect, given, role, scene, text } from 'foldkit/scene'
import { test } from 'vitest'

import { type Entry, Message, type Model, OpenExample, update, view } from './main'

const entry = (id: string, title: string, ported: boolean): Entry => ({
  id, title, blurb: `${title} blurb`, foldkit: `${title} on FoldKit`, gpui: `${title} on GPUI`, ported,
  command: ['examples/open.ts', id],
})
const gallery: Model = {
  entries: [entry('weather', 'Weather', true), entry('big-list', 'Big List', false)],
  opened: Option.none(),
}

test('lists every example with what it shows from FoldKit and from GPUI', () => {
  scene(
    { update, view },
    given(gallery),
    expect(role('button', { name: 'Open Weather' })).toExist(),
    expect(role('button', { name: 'Open Big List' })).toExist(),
    expect(text('Weather on FoldKit')).toExist(),
    expect(text('Big List on GPUI')).toExist(),
    expect(text('FoldKit example')).toExist(),
    expect(text('2 examples')).toExist(),
  )
})

test('clicking a card opens it', () => {
  scene(
    { update, view },
    given(gallery),
    click(role('button', { name: 'Open Weather' })),
    Command.resolve(OpenExample, Message.OpenedExample({ id: 'weather' })),
    expect(text('Opened Weather.')).toExist(),
  )
})
