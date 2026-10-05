// CHECKBOX
//
// A box to tick, with the same config as @foldkit/ui's Checkbox (`id`,
// `isChecked`, `onToggle`, `isDisabled`, `isReadOnly`, `isIndeterminate`),
// and a `label` and `description` in place of `toView`. Stateless and
// controlled.
//
// It's a `<button role="checkbox">`, as @foldkit/ui's and Base UI's are, so
// the platform does the keyboard: a browser, and FoldKit on gpuix (host.ts),
// click a focused button on Space's release (and on Enter, as @foldkit/ui's
// does in a browser). Clicking the label toggles too. `aria-checked` is
// `mixed` while indeterminate, and a toggle from there checks it.
// Disabled and read-only stay tab stops (`aria-disabled`, `aria-readonly`)
// and don't toggle.

import type { Attribute, Html, HtmlBuilder } from 'foldkit/html'

import { part } from './parts.ts'

export type ViewConfig<Message> = Readonly<{
  id: string
  label: string
  isChecked: boolean
  onToggle: (isChecked: boolean) => Message
  description?: string
  isDisabled?: boolean
  isReadOnly?: boolean
  /** Some, not all: a "select all" over a partly ticked list. */
  isIndeterminate?: boolean
  attributes?: ReadonlyArray<Attribute<Message>>
}>

export const labelId = (id: string) => `${id}-label`
export const descriptionId = (id: string) => `${id}-description`

export const view = <Message>(config: ViewConfig<Message>, h: HtmlBuilder<Message>): Html => {
  const { id, label, isChecked, onToggle, description, isDisabled = false, isReadOnly = false, isIndeterminate = false } = config
  const state = {
    checked: isChecked && !isIndeterminate, indeterminate: isIndeterminate, disabled: isDisabled, readonly: isReadOnly,
  }
  const toggle = isDisabled || isReadOnly ? [] : [h.OnClick(onToggle(isIndeterminate || !isChecked))]
  return h.div(part(h, 'checkbox', undefined, state), [
    h.button([
      ...part(h, 'checkbox', 'control', state),
      h.Id(id),
      h.Type('button'),
      h.Role('checkbox'),
      h.AriaChecked(isIndeterminate ? 'mixed' : isChecked),
      h.AriaLabelledBy(labelId(id)),
      ...(description === undefined ? [] : [h.AriaDescribedBy(descriptionId(id))]),
      ...(isDisabled ? [h.AriaDisabled(true)] : []),
      ...(isReadOnly ? [h.AriaReadonly(true)] : []),
      ...toggle,
      ...(config.attributes ?? []),
    ], [h.span([...part(h, 'checkbox', 'indicator', state), h.AriaHidden(true)], [isIndeterminate ? '–' : isChecked ? '✓' : ''])]),
    h.div(part(h, 'checkbox', 'text'), [
      h.span([...part(h, 'checkbox', 'label', state), h.Id(labelId(id)), ...toggle], [label]),
      ...(description === undefined ? [] : [h.span([...part(h, 'checkbox', 'description'), h.Id(descriptionId(id))], [description])]),
    ]),
  ])
}
