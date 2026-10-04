// LISTBOX
//
// Pick one option from a list, with the keyboard or the pointer. A submodel
// the FoldKit way: its own Model (which option is highlighted), Messages and
// update, wrapped by the parent; the selected value stays in the parent's
// Model and arrives through `onSelect`.
//
// Behaviour, as WAI-ARIA's listbox and Base UI's: the list is one tab stop
// and the highlighted option is its `aria-activedescendant`. Down/Up move
// the highlight (stopping at the ends), Home/End jump, a letter jumps to the
// next option starting with it, Enter or Space selects. Moving the highlight
// scrolls it into view: on FoldKit on gpuix that's GPUI's own scrollIntoView.
// A disabled option is `aria-disabled`, not HTML-disabled: the highlight
// still reaches it (so it can be read), but Enter, Space and a click don't
// select it, as APG's composite widgets have it.

import { Effect, Match, Option, Schema } from 'effect'
import { Command, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { part } from './parts.ts'

// MODEL

export const Model = Schema.Struct({
  id: Schema.String,
  highlighted: Schema.Number,
})
export type Model = typeof Model.Type

export const init = (config: { id: string; highlighted?: number }): Model => ({ id: config.id, highlighted: config.highlighted ?? 0 })

// MESSAGE

export const Message = defineMessageUnion({
  /** A navigation key on the focused list; `labels` lets a letter search. */
  PressedKey: { key: Schema.String, labels: Schema.Array(Schema.String) },
  PointedAt: { index: Schema.Number },
  CompletedScrollIntoView: {},
})
export type Message = typeof Message.Type

export const optionId = (id: string, index: number) => `${id}-option-${index}`

// COMMAND

/** Brings an option into view (GPUI's scrollIntoView on gpuix; the
 *  browser's on the web). */
export const ScrollIntoView = Command.define('ListboxScrollIntoView', {
  args: { elementId: Schema.String },
  messages: [Message.CompletedScrollIntoView],
  execute: ({ elementId }) =>
    Effect.sync(() => {
      document.getElementById(elementId)?.scrollIntoView({ block: 'nearest' })
      return Message.CompletedScrollIntoView()
    }),
})

// UPDATE

const NAVIGATION = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End'])
export const handles = (key: string) => NAVIGATION.has(key) || /^[a-z0-9]$/i.test(key)

/** The highlight after `key`, or None if the key doesn't move it. */
export const nextHighlight = (current: number, key: string, labels: ReadonlyArray<string>): Option.Option<number> => {
  const last = labels.length - 1
  if (last < 0) return Option.none()
  return Match.value(key).pipe(
    Match.when('ArrowDown', () => Option.some(Math.min(last, current + 1))),
    Match.when('ArrowUp', () => Option.some(Math.max(0, current - 1))),
    Match.when('Home', () => Option.some(0)),
    Match.when('End', () => Option.some(last)),
    Match.orElse(letter => {
      // Typeahead: the next option starting with the letter, wrapping.
      for (let step = 1; step <= labels.length; step++) {
        const index = (current + step) % labels.length
        if (labels[index]!.toLowerCase().startsWith(letter.toLowerCase())) return Option.some(index)
      }
      return Option.none()
    }),
  )
}

const highlight = (model: Model, index: number): Update.Return<Model, Message> =>
  index === model.highlighted
    ? { model }
    : {
      model: modifyFields(model, { highlighted: () => index }),
      commands: [ScrollIntoView({ elementId: optionId(model.id, index) })],
    }

export const update = (model: Model, message: Message): Update.Return<Model, Message> =>
  Message.match<Update.Return<Model, Message>>(message, {
    PressedKey: ({ key, labels }) =>
      Option.match(nextHighlight(model.highlighted, key, labels), {
        onNone: () => ({ model }),
        onSome: index => highlight(model, index),
      }),
    PointedAt: ({ index }) => (index === model.highlighted ? { model } : { model: modifyFields(model, { highlighted: () => index }) }),
    CompletedScrollIntoView: () => ({ model }),
  })

// VIEW

export type Item = Readonly<{ value: string; label: string; swatch?: string; disabled?: boolean }>

export type ViewConfig<ParentMessage> = Readonly<{
  model: Model
  label: string
  items: ReadonlyArray<Item>
  selected: string | undefined
  onSelect: (value: string) => ParentMessage
  toParentMessage: (message: Message) => ParentMessage
  maxHeight?: number
}>

export const view = <ParentMessage>(config: ViewConfig<ParentMessage>, h: HtmlBuilder<ParentMessage>): Html => {
  const { model, items, selected, onSelect, toParentMessage } = config
  const labels = items.map(item => item.label)
  const onKey = (key: string): Option.Option<ParentMessage> => {
    if (key === 'Enter' || key === ' ') {
      const item = items[model.highlighted]
      if (item === undefined) return Option.none()
      // On a disabled option the key is still the list's (Space mustn't
      // scroll it), but it selects nothing: a PressedKey that moves nothing.
      return Option.some(item.disabled === true ? toParentMessage(Message.PressedKey({ key, labels })) : onSelect(item.value))
    }
    return handles(key) ? Option.some(toParentMessage(Message.PressedKey({ key, labels }))) : Option.none()
  }
  return h.div([
    ...part(h, 'listbox', undefined),
    h.Id(model.id),
    h.Role('listbox'),
    h.AriaLabel(config.label),
    h.Tabindex(0),
    h.AriaActiveDescendant(optionId(model.id, model.highlighted)),
    h.OnKeyDownPreventDefault(onKey),
    ...(config.maxHeight === undefined ? [] : [h.Style({ 'max-height': `${config.maxHeight}px` })]),
  ], items.map((item, index) => {
    const disabled = item.disabled === true
    const state = { highlighted: index === model.highlighted, selected: item.value === selected, disabled }
    return h.div([
      ...part(h, 'listbox', 'option', state),
      h.Id(optionId(model.id, index)),
      h.Role('option'),
      h.AriaSelected(item.value === selected),
      ...(disabled ? [h.AriaDisabled(true)] : [h.OnClick(onSelect(item.value))]),
      h.OnMouseEnter(toParentMessage(Message.PointedAt({ index }))),
    ], [
      h.span([...part(h, 'listbox', 'check', state), h.AriaHidden(true)], [item.value === selected ? '✓' : '']),
      ...(item.swatch === undefined ? [] : [h.span([...part(h, 'listbox', 'swatch'), h.Style({ 'background-color': item.swatch })], [])]),
      h.span(part(h, 'listbox', 'label', state), [item.label]),
    ])
  }))
}
