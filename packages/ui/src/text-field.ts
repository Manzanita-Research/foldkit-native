// TEXT FIELD
//
// A label, a text input, and a description or an error: Input with a label
// it always has. Stateless and controlled: the parent's Model holds the
// value, and `onInput` gets each change. The input is GPUI's own editor on
// FoldKit on gpuix (selection, IME, undo, caret), and it's a tab stop where
// it sits in the view, so Tab moves through fields in order with no work
// here.
//
// Accessibility: the label names the input (`for`), the description or
// error describes it (`aria-describedby`), and an error sets `aria-invalid`.

import type { Attribute, Html, HtmlBuilder } from 'foldkit/html'

import * as Input from './input.ts'

export type ViewConfig<Message> = Readonly<{
  id: string
  label: string
  value: string
  onInput: (value: string) => Message
  placeholder?: string
  description?: string
  /** Shown instead of the description, and marks the field invalid. */
  error?: string
  /** 'password' throws on FoldKit on gpuix, which has no masked input yet. */
  type?: Input.ViewConfig<Message>['type']
  isDisabled?: boolean
  isReadOnly?: boolean
  attributes?: ReadonlyArray<Attribute<Message>>
}>

export const descriptionId = Input.descriptionId

export const view = <Message>(config: ViewConfig<Message>, h: HtmlBuilder<Message>): Html => Input.view(config, h)
