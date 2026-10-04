// TEXT FIELD
//
// A label, a text input, and a description or an error. Stateless and
// controlled: the parent's Model holds the value, and `onInput` gets each
// change. The input is GPUI's own editor on FoldKit on gpuix (selection,
// IME, undo, caret), and it's a tab stop where it sits in the view, so Tab
// moves through fields in order with no work here.
//
// Accessibility: the label names the input (`for`), the description or
// error describes it (`aria-describedby`), and an error sets `aria-invalid`.

import type { Attribute, Html, HtmlBuilder } from 'foldkit/html'

import { part } from './parts.ts'

export type ViewConfig<Message> = Readonly<{
  id: string
  label: string
  value: string
  onInput: (value: string) => Message
  placeholder?: string
  description?: string
  /** Shown instead of the description, and marks the field invalid. */
  error?: string
  type?: 'text' | 'email' | 'password' | 'search' | 'url' | 'tel'
  attributes?: ReadonlyArray<Attribute<Message>>
}>

export const descriptionId = (id: string) => `${id}-description`

export const view = <Message>(config: ViewConfig<Message>, h: HtmlBuilder<Message>): Html => {
  const { id, label, value, onInput, placeholder, description, error, type = 'text' } = config
  const note = error ?? description
  return h.div(part(h, 'field', undefined, { invalid: error !== undefined }), [
    h.label([...part(h, 'field', 'label'), h.For(id)], [label]),
    h.input([
      ...part(h, 'field', 'input', { invalid: error !== undefined }),
      h.Id(id),
      h.Type(type),
      h.Value(value),
      h.OnInput(onInput),
      ...(placeholder === undefined ? [] : [h.Placeholder(placeholder)]),
      ...(note === undefined ? [] : [h.AriaDescribedBy(descriptionId(id))]),
      ...(error === undefined ? [] : [h.AriaInvalid(true)]),
      ...(config.attributes ?? []),
    ]),
    ...(note === undefined
      ? []
      : [h.p([...part(h, 'field', error === undefined ? 'description' : 'error'), h.Id(descriptionId(id))], [note])]),
  ])
}
