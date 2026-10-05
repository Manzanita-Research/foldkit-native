// SWITCH
//
// An on/off control, with the same config as @foldkit/ui's Switch (`id`,
// `isChecked`, `onToggle`, `isDisabled`, `isReadOnly`), and a `label` and
// `description` in place of `toView`. Stateless and controlled.
//
// It's a real `<button role="switch">`, so the platform does the keyboard:
// a browser, and FoldKit on gpuix (host.ts), click a focused button on Enter
// and on Space. So there are no key handlers here, and it's a tab stop.
// Clicking the label toggles too. Behaviour as Base UI's and WAI-ARIA's
// switch: `aria-checked`, labelled by its label, described by its description.
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
  attributes?: ReadonlyArray<Attribute<Message>>
}>

export const labelId = (id: string) => `${id}-label`
export const descriptionId = (id: string) => `${id}-description`

export const view = <Message>(config: ViewConfig<Message>, h: HtmlBuilder<Message>): Html => {
  const { id, label, isChecked, onToggle, description, isDisabled = false, isReadOnly = false } = config
  const state = { checked: isChecked, disabled: isDisabled, readonly: isReadOnly }
  const toggle = isDisabled || isReadOnly ? [] : [h.OnClick(onToggle(!isChecked))]
  return h.div(part(h, 'switch', undefined, state), [
    h.button([
      ...part(h, 'switch', 'track', state),
      h.Id(id),
      h.Type('button'),
      h.Role('switch'),
      h.AriaChecked(isChecked),
      h.AriaLabelledBy(labelId(id)),
      ...(description === undefined ? [] : [h.AriaDescribedBy(descriptionId(id))]),
      ...(isDisabled ? [h.AriaDisabled(true)] : []),
      ...(isReadOnly ? [h.AriaReadonly(true)] : []),
      ...toggle,
      ...(config.attributes ?? []),
    ], [h.span(part(h, 'switch', 'thumb', state), [])]),
    h.div(part(h, 'switch', 'text'), [
      h.span([...part(h, 'switch', 'label', state), h.Id(labelId(id)), ...toggle], [label]),
      ...(description === undefined ? [] : [h.span([...part(h, 'switch', 'description'), h.Id(descriptionId(id))], [description])]),
    ]),
  ])
}
