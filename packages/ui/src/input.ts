// INPUT
//
// A one-line text field: a label, the input, and a description or an error.
// The same config as @foldkit/ui's Input (`id`, `value`, `onInput`,
// `isDisabled`, `isReadOnly`, `isInvalid`, `isAutofocus`, `name`, `type`,
// `placeholder`), with a `label`, `description` and `error` in place of
// `toView`. Stateless and controlled: the parent's Model holds the value.
//
// The input is GPUI's own editor on FoldKit on gpuix (selection, IME, undo,
// caret, clipboard), and a tab stop where it sits in the view. Disabled is
// HTML's `disabled` (out of the tab order, no edits); read-only stays a tab
// stop and takes no edits. Both are the adapter's, in GPUI's editor itself.
//
// Accessibility: the label names the input (`for`), the description or
// error describes it (`aria-describedby`), and `isInvalid` (or an error)
// sets `aria-invalid`. With no label, give `ariaLabel`.

import type { Attribute, Html, HtmlBuilder, TextareaAttribute } from 'foldkit/html'

import { part } from './parts.ts'

export type ViewConfig<Message> = Readonly<{
  id: string
  value?: string
  onInput?: (value: string) => Message
  label?: string
  /** The input's name when there's no visible label. */
  ariaLabel?: string
  description?: string
  /** Shown instead of the description, and marks the field invalid. */
  error?: string
  placeholder?: string
  /** 'password' throws on FoldKit on gpuix, which has no masked input yet. */
  type?: 'text' | 'email' | 'password' | 'search' | 'url' | 'tel' | 'number'
  name?: string
  isDisabled?: boolean
  isReadOnly?: boolean
  isInvalid?: boolean
  isAutofocus?: boolean
  attributes?: ReadonlyArray<Attribute<Message>>
}>

export const descriptionId = (id: string) => `${id}-description`

/** The label, the control and the note under it, shared with Textarea. */
export const field = <Message>(
  config: Readonly<{ id: string; label?: string; description?: string; error?: string; isInvalid?: boolean; isDisabled?: boolean; isReadOnly?: boolean }>,
  control: (state: Readonly<Record<string, boolean>>, describedBy: ReadonlyArray<TextareaAttribute<Message>>) => Html,
  h: HtmlBuilder<Message>,
): Html => {
  const { id, label, description, error } = config
  const note = error ?? description
  const state = {
    invalid: error !== undefined || config.isInvalid === true, disabled: config.isDisabled === true, readonly: config.isReadOnly === true,
  }
  return h.div(part(h, 'field', undefined, state), [
    ...(label === undefined ? [] : [h.label([...part(h, 'field', 'label', state), h.For(id)], [label])]),
    control(state, note === undefined ? [] : [h.AriaDescribedBy(descriptionId(id))]),
    ...(note === undefined
      ? []
      : [h.p([...part(h, 'field', error === undefined ? 'description' : 'error'), h.Id(descriptionId(id))], [note])]),
  ])
}

export const view = <Message>(config: ViewConfig<Message>, h: HtmlBuilder<Message>): Html => {
  const { id, value, onInput, placeholder, type = 'text', name, ariaLabel, isDisabled = false, isReadOnly = false, isAutofocus = false } = config
  return field(config, (state, describedBy) => h.input([
    ...part(h, 'field', 'input', state),
    h.Id(id),
    h.Type(type),
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
