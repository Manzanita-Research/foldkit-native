// TEXTAREA
//
// A text field of several lines: a label, the textarea, and a description
// or an error. The same config as @foldkit/ui's Textarea (`id`, `value`,
// `onInput`, `rows`, `isDisabled`, `isReadOnly`, `isInvalid`, `isAutofocus`,
// `name`, `placeholder`), with a `label`, `description` and `error` in place
// of `toView`. Stateless and controlled, like Input, and the same field
// parts in the theme.
//
// It's GPUI's own multi-line editor on FoldKit on gpuix: Enter is a new
// line, Tab moves on (it never types a tab). `rows` sets its height, since
// the flat sheet has no intrinsic size for it: that many lines of the
// theme's text, plus its padding.

import type { Html, HtmlBuilder, TextareaAttribute } from 'foldkit/html'

import { field } from './input.ts'
import { part } from './parts.ts'
import { token } from './theme.ts'

export type ViewConfig<Message> = Readonly<{
  id: string
  value?: string
  onInput?: (value: string) => Message
  label?: string
  ariaLabel?: string
  description?: string
  error?: string
  placeholder?: string
  /** Lines of text it shows; 3 by default. */
  rows?: number
  name?: string
  isDisabled?: boolean
  isReadOnly?: boolean
  isInvalid?: boolean
  isAutofocus?: boolean
  attributes?: ReadonlyArray<TextareaAttribute<Message>>
}>

export { descriptionId } from './input.ts'

/** A line of the textarea's text, in pixels (its line height). */
export const LINE = 20

export const view = <Message>(config: ViewConfig<Message>, h: HtmlBuilder<Message>): Html => {
  const { id, value, onInput, placeholder, rows = 3, name, ariaLabel, isDisabled = false, isReadOnly = false, isAutofocus = false } = config
  return field(config, (state, describedBy) => h.textarea([
    ...part(h, 'field', 'textarea', state),
    h.Id(id),
    h.Rows(rows),
    // Its lines, its vertical padding and its border.
    h.Style({ height: `calc(${rows * LINE}px + 2 * ${token('space.2')} + 2px)` }),
    ...(value === undefined ? [] : [h.Value(value)]),
    ...(onInput === undefined || isDisabled || isReadOnly ? [] : [h.OnInput(onInput)]),
    ...(placeholder === undefined ? [] : [h.Placeholder(placeholder)]),
    ...(name === undefined ? [] : [h.Name(name)]),
    ...(ariaLabel === undefined ? [] : [h.AriaLabel(ariaLabel)]),
    ...describedBy,
    ...(state['invalid'] ? [h.AriaInvalid(true)] : []),
    ...(isDisabled ? [h.Disabled(true)] : []),
    ...(isReadOnly ? [h.Readonly(true)] : []),
    ...(isAutofocus ? [h.Autofocus(true)] : []),
    ...(config.attributes ?? []),
  ]), h)
}
