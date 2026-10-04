import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { TRACKS, TRACK_COUNT, matching } from './library'
import {
  LIST_HEIGHT,
  Message,
  type Model,
  ROW_HEIGHT,
  ScrollList,
  update,
  visibleRange,
} from './main'

const initialModel: Model = {
  query: '',
  selected: 0,
  maybeOpenId: Option.none(),
  theme: 'dark',
  scrollTop: 0,
}

const scrolled = Message.CompletedScrollList()

describe('library', () => {
  test('has 10,000 tracks, the same on every run', () => {
    expect(TRACKS).toHaveLength(TRACK_COUNT)
    expect(TRACKS[0]).toEqual(matching('')[0])
    expect(new Set(TRACKS.map(track => track.id)).size).toBe(TRACK_COUNT)
  })

  test('a query matches every word, in any field, ignoring case', () => {
    const matches = matching('VELVET folk')
    expect(matches.length).toBeGreaterThan(0)
    expect(matches.length).toBeLessThan(TRACK_COUNT)
    for (const track of matches) {
      const haystack = `${track.title} ${track.artist} ${track.album} ${track.genre}`.toLowerCase()
      expect(haystack).toContain('velvet')
      expect(haystack).toContain('folk')
    }
  })
})

describe('update', () => {
  describe('filtering', () => {
    test('typing a query filters, selects the first match and scrolls to the top', () => {
      story(
        update,
        given(modifyFields(initialModel, { selected: () => 40, scrollTop: () => 1500 })),
        message(Message.ChangedQuery({ value: 'velvet' })),
        model(model => {
          expect(model.query).toBe('velvet')
          expect(model.selected).toBe(0)
          expect(model.scrollTop).toBe(0)
        }),
        Command.expectExact(ScrollList({ scrollTop: 0 })),
        Command.resolve(ScrollList, scrolled),
      )
    })

    test('the same query again keeps the selection', () => {
      story(
        update,
        given(modifyFields(initialModel, { query: () => 'jazz', selected: () => 2 })),
        message(Message.ChangedQuery({ value: 'jazz' })),
        model(model => {
          expect(model.selected).toBe(2)
        }),
        Command.expectNone(),
      )
    })

    test('typing at the top of the list asks for no scroll', () => {
      story(
        update,
        given(initialModel),
        message(Message.ChangedQuery({ value: 'jazz' })),
        Command.expectNone(),
      )
    })
  })

  describe('keyboard selection', () => {
    test('ArrowDown and ArrowUp move the selection one row', () => {
      story(
        update,
        given(initialModel),
        message(Message.PressedKey({ key: 'ArrowDown' })),
        message(Message.PressedKey({ key: 'ArrowDown' })),
        message(Message.PressedKey({ key: 'ArrowUp' })),
        model(model => {
          expect(model.selected).toBe(1)
        }),
      )
    })

    test('the selection stops at the first row', () => {
      story(
        update,
        given(initialModel),
        message(Message.PressedKey({ key: 'ArrowUp' })),
        model(model => {
          expect(model.selected).toBe(0)
        }),
        Command.expectNone(),
      )
    })

    test('End jumps to the last match and scrolls it into view', () => {
      const lastTop = (TRACK_COUNT - 1) * ROW_HEIGHT
      const scrollTop = lastTop + ROW_HEIGHT - LIST_HEIGHT
      story(
        update,
        given(initialModel),
        message(Message.PressedKey({ key: 'End' })),
        model(model => {
          expect(model.selected).toBe(TRACK_COUNT - 1)
          expect(model.scrollTop).toBe(scrollTop)
        }),
        Command.expectExact(ScrollList({ scrollTop })),
        Command.resolve(ScrollList, scrolled),
      )
    })

    test('Home jumps back to the first row and scrolls to the top', () => {
      story(
        update,
        given(modifyFields(initialModel, { selected: () => 500, scrollTop: () => 500 * ROW_HEIGHT })),
        message(Message.PressedKey({ key: 'Home' })),
        model(model => {
          expect(model.selected).toBe(0)
          expect(model.scrollTop).toBe(0)
        }),
        Command.expectExact(ScrollList({ scrollTop: 0 })),
        Command.resolve(ScrollList, scrolled),
      )
    })

    test('End stays inside the filtered list', () => {
      story(
        update,
        given(modifyFields(initialModel, { query: () => 'velvet folk' })),
        message(Message.PressedKey({ key: 'End' })),
        model(model => {
          expect(model.selected).toBe(matching('velvet folk').length - 1)
        }),
        Command.resolve(ScrollList, scrolled),
      )
    })

    test('PageDown moves a page and scrolls only as far as it must', () => {
      story(
        update,
        given(initialModel),
        message(Message.PressedKey({ key: 'PageDown' })),
        Command.expectExact(ScrollList({ scrollTop: 13 * ROW_HEIGHT - LIST_HEIGHT })),
        Command.resolve(ScrollList, scrolled),
        message(Message.PressedKey({ key: 'PageDown' })),
        model(model => {
          expect(model.selected).toBe(24)
          expect(model.scrollTop).toBe(25 * ROW_HEIGHT - LIST_HEIGHT)
        }),
        Command.expectExact(ScrollList({ scrollTop: 25 * ROW_HEIGHT - LIST_HEIGHT })),
        Command.resolve(ScrollList, scrolled),
      )
    })

    test('moving within the visible rows asks for no scroll', () => {
      story(
        update,
        given(modifyFields(initialModel, { selected: () => 3 })),
        message(Message.PressedKey({ key: 'ArrowDown' })),
        Command.expectNone(),
      )
    })
  })

  describe('detail card', () => {
    test('Enter opens the selected track, Escape closes it', () => {
      story(
        update,
        given(modifyFields(initialModel, { selected: () => 2 })),
        message(Message.PressedKey({ key: 'Enter' })),
        model(model => {
          expect(model.maybeOpenId).toEqual(Option.some(TRACKS[2]!.id))
        }),
        message(Message.PressedKey({ key: 'Escape' })),
        model(model => {
          expect(Option.isNone(model.maybeOpenId)).toBe(true)
        }),
      )
    })

    test('submitting the filter (Enter in the field) opens the selected track', () => {
      story(
        update,
        given(modifyFields(initialModel, { query: () => 'jazz', selected: () => 3 })),
        message(Message.SubmittedFilter()),
        model(model => {
          expect(model.maybeOpenId).toEqual(Option.some(matching('jazz')[3]!.id))
        }),
      )
    })

    test('Enter opens the track under the selection in the filtered list', () => {
      const second = matching('jazz')[1]!
      story(
        update,
        given(modifyFields(initialModel, { query: () => 'jazz', selected: () => 1 })),
        message(Message.PressedKey({ key: 'Enter' })),
        model(model => {
          expect(model.maybeOpenId).toEqual(Option.some(second.id))
        }),
      )
    })

    test('Enter with no matches opens nothing', () => {
      story(
        update,
        given(modifyFields(initialModel, { query: () => 'zzzz no such track' })),
        message(Message.PressedKey({ key: 'Enter' })),
        model(model => {
          expect(Option.isNone(model.maybeOpenId)).toBe(true)
        }),
      )
    })

    test('clicking a row selects and opens it', () => {
      story(
        update,
        given(initialModel),
        message(Message.ClickedRow({ index: 5 })),
        model(model => {
          expect(model.selected).toBe(5)
          expect(model.maybeOpenId).toEqual(Option.some(TRACKS[5]!.id))
        }),
        message(Message.ClickedCloseDetail()),
        model(model => {
          expect(Option.isNone(model.maybeOpenId)).toBe(true)
        }),
      )
    })
  })

  describe('theme', () => {
    test('the switch flips between dark and light', () => {
      story(
        update,
        given(initialModel),
        message(Message.ClickedThemeSwitch()),
        model(model => {
          expect(model.theme).toBe('light')
        }),
        message(Message.ClickedThemeSwitch()),
        model(model => {
          expect(model.theme).toBe('dark')
        }),
      )
    })
  })

  describe('scrolling', () => {
    test('the list reports its scroll position', () => {
      story(
        update,
        given(initialModel),
        message(Message.ScrolledList({ scrollTop: 4400 })),
        model(model => {
          expect(model.scrollTop).toBe(4400)
        }),
      )
    })

    test('only the rows near the scroll position are rendered', () => {
      const atTop = visibleRange(initialModel, TRACK_COUNT)
      expect(atTop.start).toBe(0)
      expect(atTop.end).toBeLessThan(60)

      const deep = visibleRange(modifyFields(initialModel, { scrollTop: () => 100 * ROW_HEIGHT }), TRACK_COUNT)
      expect(deep.start).toBeLessThan(100)
      expect(deep.end).toBeGreaterThan(100 + Math.ceil(LIST_HEIGHT / ROW_HEIGHT))
      expect(deep.end - deep.start).toBeLessThan(60)

      const atEnd = visibleRange(modifyFields(initialModel, { scrollTop: () => TRACK_COUNT * ROW_HEIGHT }), TRACK_COUNT)
      expect(atEnd.end).toBe(TRACK_COUNT)
    })
  })
})
