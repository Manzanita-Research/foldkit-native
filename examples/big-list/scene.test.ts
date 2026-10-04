import { Option } from 'effect'
import {
  Command,
  Subscription,
  all,
  click,
  expect,
  expectAll,
  given,
  inside,
  first,
  label,
  last,
  nth,
  role,
  scene,
  selector,
  submit,
  text,
  type,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'

import { TRACKS, TRACK_COUNT, formatCount, matching } from './library'
import {
  LIST_HEIGHT,
  Message,
  type Model,
  type NavigationKey,
  ROW_HEIGHT,
  ScrollList,
  update,
  view,
  visibleRange,
} from './main'

const initialModel: Model = {
  query: '',
  selected: 0,
  maybeOpenId: Option.none(),
  theme: 'dark',
  scrollTop: 0,
}

const press = (key: NavigationKey) =>
  Subscription.emit(Message.PressedKey({ key }))

const renderedRows = (model: Model) => {
  const { start, end } = visibleRange(model, matching(model.query).length)
  return end - start
}

describe('view', () => {
  test('shows the heading, the count and the first rows of the library', () => {
    scene(
      { update, view },
      given(initialModel),
      expect(role('heading', { name: 'Big List' })).toExist(),
      expect(text('10,000 of 10,000')).toExist(),
      expect(label('Filter')).toHaveValue(''),
      expect(role('listbox', { name: 'Tracks' })).toHaveHandler('scroll'),
      inside(first(all.role('option')), expect(text(TRACKS[0]!.title)).toExist()),
      expect(role('option', { selected: true })).toExist(),
      expect(text('Pick a track')).toExist(),
    )
  })

  test('renders only the rows near the top, not all 10,000', () => {
    scene(
      { update, view },
      given(initialModel),
      expectAll(all.role('option')).toHaveCount(renderedRows(initialModel)),
      expect(selector('.app')).toHaveAttr('data-theme', 'dark'),
    )
  })

  test('scrolled deep into the list, it renders the rows around the scroll position', () => {
    const model = modifyFields(initialModel, { scrollTop: () => 5000 * ROW_HEIGHT })
    const { start, end } = visibleRange(model, TRACK_COUNT)
    scene(
      { update, view },
      given(model),
      expectAll(all.role('option')).toHaveCount(end - start),
      inside(first(all.role('option')), expect(text(String(start + 1))).toExist()),
      inside(last(all.role('option')), expect(text(String(end))).toExist()),
    )
  })

  test('typing in the filter narrows the list and updates the count', () => {
    const matches = matching('velvet folk')
    scene(
      { update, view },
      given(initialModel),
      type(label('Filter'), 'velvet folk'),
      expect(label('Filter')).toHaveValue('velvet folk'),
      expect(text(`${formatCount(matches.length)} of 10,000`)).toExist(),
      inside(first(all.role('option')), expect(text(matches[0]!.title)).toExist()),
      expectAll(all.role('option')).toHaveCount(Math.min(matches.length, renderedRows(initialModel))),
    )
  })

  test('a filter with no matches says so', () => {
    scene(
      { update, view },
      given(initialModel),
      type(label('Filter'), 'zzzz'),
      expect(text('0 of 10,000')).toExist(),
      expect(text('No tracks match “zzzz”')).toExist(),
      expect(role('listbox')).toBeAbsent(),
    )
  })
})

describe('keyboard', () => {
  test('arrows move the selection, Enter opens the detail card, Escape closes it', () => {
    const track = TRACKS[2]!
    scene(
      { update, view },
      given(initialModel),
      press('ArrowDown'),
      press('ArrowDown'),
      inside(role('option', { selected: true }), expect(text(track.title)).toExist()),
      press('Enter'),
      inside(
        role('dialog', { name: track.title }),
        expect(role('heading', { name: track.title })).toExist(),
        expect(text(track.artist)).toExist(),
        expect(text(track.album)).toExist(),
        expect(text(String(track.year))).toExist(),
        expect(text('3 of 10,000')).toExist(),
      ),
      press('Escape'),
      expect(role('dialog')).toBeAbsent(),
      expect(text('Pick a track')).toExist(),
    )
  })

  test('Enter in the filter field submits it, which opens the selected match', () => {
    const matches = matching('velvet')
    scene(
      { update, view },
      given(initialModel),
      type(label('Filter'), 'velvet'),
      press('ArrowDown'),
      submit(role('search')),
      expect(role('dialog', { name: matches[1]!.title })).toExist(),
    )
  })

  test('End selects the last track and scrolls the list down to it', () => {
    const scrollTop = TRACK_COUNT * ROW_HEIGHT - LIST_HEIGHT
    scene(
      { update, view },
      given(initialModel),
      press('End'),
      Command.expectExact(ScrollList({ scrollTop })),
      Command.resolve(ScrollList, Message.CompletedScrollList()),
      inside(role('option', { selected: true }), expect(text('10000')).toExist()),
      inside(last(all.role('option')), expect(text(TRACKS[TRACK_COUNT - 1]!.title)).toExist()),
    )
  })

  test('the selection follows the filter: it starts at the first match', () => {
    const matches = matching('jazz')
    scene(
      { update, view },
      given(modifyFields(initialModel, { selected: () => 4 })),
      type(label('Filter'), 'jazz'),
      press('ArrowDown'),
      press('Enter'),
      expect(role('dialog', { name: matches[1]!.title })).toExist(),
    )
  })
})

describe('pointer', () => {
  test('clicking a row selects it and opens it', () => {
    const track = TRACKS[3]!
    scene(
      { update, view },
      given(initialModel),
      click(nth(all.role('option'), 3)),
      inside(role('option', { selected: true }), expect(text(track.title)).toExist()),
      expect(role('dialog', { name: track.title })).toExist(),
      click(role('button', { name: 'Close' })),
      expect(role('dialog')).toBeAbsent(),
    )
  })

  test('the theme switch flips data-theme on the app root', () => {
    scene(
      { update, view },
      given(initialModel),
      expect(role('switch', { name: 'Dark theme', checked: true })).toExist(),
      click(role('switch', { name: 'Dark theme' })),
      expect(selector('.app')).toHaveAttr('data-theme', 'light'),
      expect(role('switch', { name: 'Dark theme', checked: false })).toExist(),
      expect(text('Light')).toExist(),
      click(role('switch', { name: 'Dark theme' })),
      expect(selector('.app')).toHaveAttr('data-theme', 'dark'),
    )
  })
})
