// Big List: 10,000 tracks, filtered live, picked with the keyboard. Written
// for FoldKit Native as a showcase, the FoldKit way: one Model, factual
// Messages, a pure update, a view, and a Subscription for the keys.
//
// Only the rows near the scroll position are rendered (with two spacers
// standing in for the rest), so a keystroke re-renders about fifty rows, not
// ten thousand. The list's scroll position comes back as `OnScroll`.

import { Effect, Match, Option, Schema } from 'effect'
import { Command, Runtime, Subscription, type Update } from 'foldkit'
import { Document, Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { TRACK_COUNT, type Track, formatCount, formatLength, matching } from './library'

// CONSTANT

/** Every row is this tall, so a scroll position maps straight to a row. */
export const ROW_HEIGHT = 44
/** Rows rendered past each edge of the visible ones, so a quick scroll
 *  doesn't outrun the next render. */
export const OVERSCAN = 10
/** Taller than the list ever is on screen: enough rows for a big window. */
export const VIEWPORT_HEIGHT = 1100
/** The list's visible height in the example's window (styles.css: the
 *  window, less the header, the toolbar and the column labels). */
export const LIST_HEIGHT = 538
/** How far PageUp and PageDown move the selection. */
export const PAGE_ROWS = 12
export const LIST_ID = 'tracks'

// MODEL

export const Theme = Schema.Literals(['dark', 'light'])
export type Theme = typeof Theme.Type

export const Model = Schema.Struct({
  query: Schema.String,
  /** Position of the selected row in the filtered list. */
  selected: Schema.Number,
  maybeOpenId: Schema.Option(Schema.Number),
  theme: Theme,
  scrollTop: Schema.Number,
})
export type Model = typeof Model.Type

// MESSAGE

export const NavigationKey = Schema.Literals([
  'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Enter', 'Escape',
])
export type NavigationKey = typeof NavigationKey.Type

export const Message = defineMessageUnion({
  ChangedQuery: { value: Schema.String },
  SubmittedFilter: {},
  PressedKey: { key: NavigationKey },
  ClickedRow: { index: Schema.Number },
  ClickedCloseDetail: {},
  ClickedThemeSwitch: {},
  ScrolledList: { scrollTop: Schema.Number },
  CompletedScrollList: {},
})
export type Message = typeof Message.Type

// INIT

export const init: Runtime.ApplicationInit<Model, Message> = () => ({
  model: {
    query: '',
    selected: 0,
    maybeOpenId: Option.none(),
    theme: 'dark',
    scrollTop: 0,
  },
})

// COMMAND

/** Scrolls the list so the selected row shows: a browser fires `scroll`
 *  back, and FoldKit Native's mirror does the same. */
export const ScrollList = Command.define('ScrollList', {
  args: { scrollTop: Schema.Number },
  messages: [Message.CompletedScrollList],
  execute: ({ scrollTop }) =>
    Effect.sync(() => {
      const list = document.getElementById(LIST_ID)
      if (list !== null) list.scrollTop = scrollTop
      return Message.CompletedScrollList()
    }),
})

// UPDATE

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))

/** The scroll position that brings row `index` fully into view, moving as
 *  little as possible; None if it already shows. */
export const scrollFor = (model: Model, index: number): Option.Option<number> => {
  const top = index * ROW_HEIGHT
  const bottom = top + ROW_HEIGHT
  if (top < model.scrollTop) return Option.some(top)
  if (bottom > model.scrollTop + LIST_HEIGHT) return Option.some(bottom - LIST_HEIGHT)
  return Option.none()
}

const select = (model: Model, index: number): Update.Return<Model, Message> => {
  const count = matching(model.query).length
  const selected = count === 0 ? 0 : clamp(index, 0, count - 1)
  return Option.match(scrollFor(model, selected), {
    onNone: () => ({ model: modifyFields(model, { selected: () => selected }) }),
    onSome: scrollTop => ({
      model: modifyFields(model, { selected: () => selected, scrollTop: () => scrollTop }),
      commands: [ScrollList({ scrollTop })],
    }),
  })
}

const selectedTrack = (model: Model): Option.Option<Track> =>
  Option.fromNullishOr(matching(model.query)[model.selected])

const openSelected = (model: Model): Model =>
  modifyFields(model, {
    maybeOpenId: () => Option.map(selectedTrack(model), track => track.id),
  })

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    // A native field can report its value again unchanged (on Enter, say):
    // that's no new query, so the selection stays.
    ChangedQuery: ({ value }) => value === model.query ? { model } : ({
      model: modifyFields(model, {
        query: () => value,
        selected: () => 0,
        scrollTop: () => 0,
      }),
      commands: model.scrollTop === 0 ? [] : [ScrollList({ scrollTop: 0 })],
    }),

    PressedKey: ({ key }) =>
      Match.value(key).pipe(
        Match.withReturnType<Update.Return<Model, Message>>(),
        Match.when('ArrowDown', () => select(model, model.selected + 1)),
        Match.when('ArrowUp', () => select(model, model.selected - 1)),
        Match.when('PageDown', () => select(model, model.selected + PAGE_ROWS)),
        Match.when('PageUp', () => select(model, model.selected - PAGE_ROWS)),
        Match.when('Home', () => select(model, 0)),
        Match.when('End', () => select(model, matching(model.query).length - 1)),
        Match.when('Enter', () => ({ model: openSelected(model) })),
        Match.when('Escape', () => ({
          model: modifyFields(model, { maybeOpenId: () => Option.none() }),
        })),
        Match.exhaustive,
      ),

    // Enter in the filter field: a native text field (and a browser's)
    // submits its form rather than passing Enter on.
    SubmittedFilter: () => ({ model: openSelected(model) }),

    ClickedRow: ({ index }) => {
      const { model: selected, commands } = select(model, index)
      return {
        model: openSelected(selected),
        ...(commands === undefined ? {} : { commands }),
      }
    },

    ClickedCloseDetail: () => ({
      model: modifyFields(model, { maybeOpenId: () => Option.none() }),
    }),

    ClickedThemeSwitch: () => ({
      model: modifyFields(model, {
        theme: theme => (theme === 'dark' ? 'light' : 'dark'),
      }),
    }),

    ScrolledList: ({ scrollTop }) => ({
      model: modifyFields(model, { scrollTop: () => scrollTop }),
    }),

    CompletedScrollList: () => ({ model }),
  })

// SUBSCRIPTION

const NAVIGATION_KEYS: ReadonlyArray<NavigationKey> = NavigationKey.literals

export const subscriptions = Subscription.make<Model, Message>()(() => ({
  keyboard: Subscription.persistent(
    Subscription.keyBindings<Message>({
      target: () => document,
      bindings: NAVIGATION_KEYS.map(key => ({
        keys: key,
        // The filter field keeps focus while you pick: arrows move the
        // selection, Enter opens it, as in a command palette.
        whileTyping: 'Allow' as const,
        whenRepeated: 'Allow' as const,
        mapEvent: () => Message.PressedKey({ key }),
      })),
    }),
  ),
}))

// VIEW

/** The rows to render: the visible ones plus `OVERSCAN` either side. */
export const visibleRange = (model: Model, count: number): Readonly<{ start: number; end: number }> => {
  const first = Math.floor(model.scrollTop / ROW_HEIGHT)
  const start = clamp(first - OVERSCAN, 0, count)
  const end = clamp(first + Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT) + OVERSCAN, 0, count)
  return { start, end }
}

const headerView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.header(
    [h.Class('header')],
    [
      h.div(
        [h.Class('brand')],
        [
          h.div([h.Class('logo')], []),
          h.div(
            [h.Class('brand-text')],
            [
              h.h1([h.Class('title')], ['Big List']),
              h.p([h.Class('subtitle')], [`${formatCount(TRACK_COUNT)} tracks, one FoldKit list`]),
            ],
          ),
        ],
      ),
      h.button(
        [
          h.Class('theme-switch'),
          h.Type('button'),
          h.Role('switch'),
          h.AriaChecked(model.theme === 'dark'),
          h.AriaLabel('Dark theme'),
          h.OnClick(Message.ClickedThemeSwitch()),
        ],
        [
          h.span([h.Class('theme-switch-track')], [h.span([h.Class('theme-switch-knob')], [])]),
          h.span([h.Class('theme-switch-label')], [model.theme === 'dark' ? 'Dark' : 'Light']),
        ],
      ),
    ],
  )

const toolbarView = (model: Model, count: number, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('toolbar')],
    [
      h.form(
        [h.Class('filter-form'), h.Role('search'), h.OnSubmit(Message.SubmittedFilter())],
        [
          h.input([
            h.Class('filter'),
            h.Type('search'),
            h.Value(model.query),
            h.Placeholder(`Filter ${formatCount(TRACK_COUNT)} tracks`),
            h.AriaLabel('Filter'),
            h.Autocomplete('off'),
            h.Autofocus(true),
            h.OnInput(value => Message.ChangedQuery({ value })),
          ]),
        ],
      ),
      h.p(
        [h.Class('count'), h.AriaLive('polite')],
        [`${formatCount(count)} of ${formatCount(TRACK_COUNT)}`],
      ),
    ],
  )

const rowView = (track: Track, index: number, model: Model, h: HtmlBuilder<Message>): Html => {
  const isSelected = index === model.selected
  return h.div(
    [
      h.Key(String(track.id)),
      h.Class('row'),
      h.Role('option'),
      h.AriaSelected(isSelected),
      ...(isSelected ? [h.DataAttribute('selected', '')] : []),
      h.OnClick(Message.ClickedRow({ index })),
    ],
    [
      h.span([h.Class('cell cell-number')], [String(track.id + 1)]),
      h.span([h.Class('cell cell-title')], [track.title]),
      h.span([h.Class('cell cell-artist')], [track.artist]),
      h.span([h.Class('cell cell-album')], [track.album]),
      h.span([h.Class('cell cell-length')], [formatLength(track.seconds)]),
    ],
  )
}

const listView = (model: Model, tracks: ReadonlyArray<Track>, h: HtmlBuilder<Message>): Html => {
  const { start, end } = visibleRange(model, tracks.length)
  return h.section(
    [h.Class('panel list-panel')],
    [
      h.div(
        [h.Class('columns'), h.AriaHidden(true)],
        [
          h.span([h.Class('cell cell-number')], ['#']),
          h.span([h.Class('cell cell-title')], ['Title']),
          h.span([h.Class('cell cell-artist')], ['Artist']),
          h.span([h.Class('cell cell-album')], ['Album']),
          h.span([h.Class('cell cell-length')], ['Time']),
        ],
      ),
      tracks.length === 0
        ? h.div([h.Class('empty')], [`No tracks match “${model.query}”`])
        : h.div(
          [
            h.Id(LIST_ID),
            h.Class('list'),
            h.Role('listbox'),
            h.AriaLabel('Tracks'),
            // Focusable, so a click in the list takes the keys from the
            // filter field (which keeps Home and End for its caret).
            h.Tabindex(0),
            h.OnScroll(scrollTop => Message.ScrolledList({ scrollTop })),
          ],
          [
            h.div([h.Key('above'), h.Class('spacer'), h.Style({ height: `${start * ROW_HEIGHT}px` })], []),
            ...tracks.slice(start, end).map((track, offset) => rowView(track, start + offset, model, h)),
            h.div([h.Key('below'), h.Class('spacer'), h.Style({ height: `${(tracks.length - end) * ROW_HEIGHT}px` })], []),
          ],
        ),
    ],
  )
}

const detailView = (model: Model, h: HtmlBuilder<Message>): Html =>
  Option.match(Option.flatMap(model.maybeOpenId, id => Option.fromNullishOr(matching('')[id])), {
    onNone: () =>
      h.aside(
        [h.Class('detail detail-empty')],
        [
          h.p([h.Class('detail-hint')], ['Pick a track']),
          h.p([h.Class('detail-keys')], ['↑ ↓ to move, Enter to open, Esc to close']),
        ],
      ),
    onSome: track =>
      h.aside(
        [h.Class('detail'), h.Role('dialog'), h.AriaLabel(track.title)],
        [
          h.div([h.Class('cover')], [h.span([h.Class('cover-initial')], [track.title.slice(0, 1)])]),
          h.h2([h.Class('detail-title')], [track.title]),
          h.p([h.Class('detail-artist')], [track.artist]),
          h.dl(
            [h.Class('facts')],
            [
              factView('Album', track.album, h),
              factView('Genre', track.genre, h),
              factView('Year', String(track.year), h),
              factView('Length', formatLength(track.seconds), h),
              factView('Track', `${formatCount(track.id + 1)} of ${formatCount(TRACK_COUNT)}`, h),
            ],
          ),
          h.button(
            [h.Class('close'), h.Type('button'), h.OnClick(Message.ClickedCloseDetail())],
            ['Close'],
          ),
        ],
      ),
  })

const factView = (label: string, value: string, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('fact')],
    [h.dt([h.Class('fact-label')], [label]), h.dd([h.Class('fact-value')], [value])],
  )

export const view = (model: Model, h: HtmlBuilder<Message>): Document => {
  const tracks = matching(model.query)
  return {
    title: 'Big List',
    body: h.div(
      [h.Class('app'), h.DataAttribute('theme', model.theme)],
      [
        headerView(model, h),
        toolbarView(model, tracks.length, h),
        h.main([h.Class('content')], [listView(model, tracks, h), detailView(model, h)]),
      ],
    ),
  }
}
