// VIRTUAL LIST
//
// A long list (ten thousand rows, or a million) to pick from with the
// keyboard or the pointer, rendering only a window of rows. A submodel like
// the Listbox: its Model (the highlighted row, the window), Messages and
// update, wrapped by the parent; what's chosen arrives through `chosen`.
//
// On FoldKit on gpuix the rows sit in GPUI's own `virtual-list`
// (`data-fn-virtual-list`): it knows how many rows there are, lays out and
// paints only those near its viewport, and scrolls by row. The app renders
// the window around where it's scrolled (GPUI's `visiblerange` says where)
// and around the highlight, so FoldKit diffs a few dozen rows, not all of
// them. Where it's scrolled comes back as a scroll area's would: `OnScroll`
// with its scrollTop (on gpuix, GPUI's top row times the row height). In a
// browser the same markup shows the window only: it's virtual only on gpuix
// (@foldkit/ui's VirtualList measures DOM rows instead).
//
// Behaviour, as WAI-ARIA's listbox: one tab stop, the highlighted row its
// `aria-activedescendant`. Down/Up move the highlight, Page Down/Up by a
// viewport, Home/End to the ends; Enter or Space, or a click, choose. Moving
// the highlight scrolls it into view (FoldKit's `Dom.scrollIntoView`; on
// gpuix, GPUI's list scrolls to the row's index).

import { Effect, Match, Option, Schema } from 'effect'
import { Command, Dom, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { part } from './parts.ts'

// MODEL

export const Model = Schema.Struct({
  id: Schema.String,
  highlighted: Schema.Number,
  /** The first row rendered. */
  windowStart: Schema.Number,
})
export type Model = typeof Model.Type

export const init = (config: { id: string; highlighted?: number }): Model => ({
  id: config.id,
  highlighted: config.highlighted ?? 0,
  windowStart: Math.max(0, (config.highlighted ?? 0) - OVERSCAN),
})

/** Rows rendered past each edge of the viewport, so a quick scroll doesn't
 *  outrun the next render. */
export const OVERSCAN = 20

export const rowId = (id: string, index: number) => `${id}-row-${index}`

/** How many rows fill the viewport, and the window rendered for it. */
export const viewportRows = (config: { height: number; rowHeight: number }) => Math.ceil(config.height / config.rowHeight)
export const windowSize = (config: { height: number; rowHeight: number }) => viewportRows(config) + 2 * OVERSCAN

// MESSAGE

export const Message = defineMessageUnion({
  /** A navigation key on the focused list. */
  PressedKey: { key: Schema.String, count: Schema.Number, pageRows: Schema.Number },
  /** The list scrolled: row `start` is at its top. */
  ShowedRows: { start: Schema.Number, count: Schema.Number, pageRows: Schema.Number },
  /** Enter, Space or a click on a row. */
  Chose: { index: Schema.Number },
  CompletedScrollIntoView: {},
})
export type Message = typeof Message.Type

/** The row a Message chose, if it chose one: the parent's cue. */
export const chosen = (message: Message): Option.Option<number> =>
  message._tag === 'Chose' ? Option.some(message.index) : Option.none()

// COMMAND

/** Brings the highlighted row into view, once the render that holds it is
 *  in (FoldKit's `Dom.scrollIntoView`). */
export const ScrollIntoView = Command.define('VirtualListScrollIntoView', {
  args: { elementId: Schema.String },
  messages: [Message.CompletedScrollIntoView],
  execute: ({ elementId }) =>
    Dom.scrollIntoView(`#${elementId}`, { block: 'nearest' }).pipe(Effect.ignore, Effect.as(Message.CompletedScrollIntoView())),
})

// UPDATE

const NAVIGATION = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'])
export const handles = (key: string) => NAVIGATION.has(key)

/** The highlight after `key`, or None if the key doesn't move it. */
export const nextHighlight = (current: number, key: string, count: number, pageRows: number): Option.Option<number> => {
  const last = count - 1
  if (last < 0) return Option.none()
  return Match.value(key).pipe(
    Match.when('ArrowDown', () => Option.some(Math.min(last, current + 1))),
    Match.when('ArrowUp', () => Option.some(Math.max(0, current - 1))),
    Match.when('PageDown', () => Option.some(Math.min(last, current + pageRows))),
    Match.when('PageUp', () => Option.some(Math.max(0, current - pageRows))),
    Match.when('Home', () => Option.some(0)),
    Match.when('End', () => Option.some(last)),
    Match.orElse(() => Option.none()),
  )
}

/** The window that holds row `index`: unchanged if it already does. */
const windowHolding = (model: Model, index: number, count: number, pageRows: number) => {
  const size = pageRows + 2 * OVERSCAN
  if (index >= model.windowStart && index < model.windowStart + size) return model.windowStart
  // Above it: the row near the window's top; below: near its bottom.
  const start = index < model.windowStart ? index - OVERSCAN : index - pageRows - OVERSCAN + 1
  return Math.max(0, Math.min(start, count - size))
}

export const update = (model: Model, message: Message): Update.Return<Model, Message> =>
  Message.match<Update.Return<Model, Message>>(message, {
    PressedKey: ({ key, count, pageRows }) =>
      Option.match(nextHighlight(model.highlighted, key, count, pageRows), {
        onNone: () => ({ model }),
        onSome: index => (index === model.highlighted ? { model } : {
          model: modifyFields(model, {
            highlighted: () => index,
            windowStart: () => windowHolding(model, index, count, pageRows),
          }),
          commands: [ScrollIntoView({ elementId: rowId(model.id, index) })],
        }),
      }),
    ShowedRows: ({ start, count, pageRows }) => {
      // The window follows the scroll, a little behind it (half the
      // overscan), so a slow scroll doesn't re-render on every row.
      const wanted = Math.max(0, Math.min(start - OVERSCAN, count - pageRows - 2 * OVERSCAN))
      return Math.abs(wanted - model.windowStart) < OVERSCAN / 2 ? { model } : { model: modifyFields(model, { windowStart: () => Math.max(0, wanted) }) }
    },
    Chose: ({ index }) => ({ model: modifyFields(model, { highlighted: () => index }) }),
    CompletedScrollIntoView: () => ({ model }),
  })

// VIEW

export type ViewConfig<ParentMessage> = Readonly<{
  model: Model
  label: string
  /** How many rows there are. */
  count: number
  /** Each row's height, in pixels (GPUI's estimate; it measures as it lays out). */
  rowHeight: number
  /** The viewport's height, in pixels. */
  height: number
  /** What's in row `index`. */
  row: (index: number) => ReadonlyArray<Html | string>
  /** The chosen row, shown selected. */
  selected?: number
  toParentMessage: (message: Message) => ParentMessage
}>

export const view = <ParentMessage>(config: ViewConfig<ParentMessage>, h: HtmlBuilder<ParentMessage>): Html => {
  const { model, count, rowHeight, height, selected, toParentMessage: up } = config
  const pageRows = viewportRows(config)
  const end = Math.min(count, model.windowStart + windowSize(config))
  const onKey = (key: string): Option.Option<ParentMessage> => {
    if (key === 'Enter' || key === ' ') return count === 0 ? Option.none() : Option.some(up(Message.Chose({ index: model.highlighted })))
    return handles(key) ? Option.some(up(Message.PressedKey({ key, count, pageRows }))) : Option.none()
  }
  const rows: Array<Html> = []
  for (let index = model.windowStart; index < end; index++) {
    const state = { highlighted: index === model.highlighted, selected: index === selected }
    rows.push(h.div([
      ...part(h, 'virtual-list', 'row', state),
      h.Id(rowId(model.id, index)),
      h.Role('option'),
      h.AriaSelected(index === selected),
      h.AriaPosinset(index + 1),
      h.AriaSetsize(count),
      h.Style({ height: `${rowHeight}px` }),
      h.OnClick(up(Message.Chose({ index }))),
    ], config.row(index)))
  }
  return h.div([
    ...part(h, 'virtual-list', undefined),
    h.Id(model.id),
    h.Role('listbox'),
    h.AriaLabel(config.label),
    h.Tabindex(0),
    ...(count === 0 ? [] : [h.AriaActiveDescendant(rowId(model.id, model.highlighted))]),
    h.OnKeyDownPreventDefault(onKey),
    h.Style({ height: `${height}px` }),
  ], [
    h.div([
      ...part(h, 'virtual-list', 'viewport'),
      h.DataAttribute('fn-virtual-list', JSON.stringify({ itemCount: count, estimatedItemHeight: rowHeight, windowStart: model.windowStart })),
      h.OnScroll(scrollTop => up(Message.ShowedRows({ start: Math.floor(scrollTop / rowHeight), count, pageRows }))),
    ], rows),
  ])
}
