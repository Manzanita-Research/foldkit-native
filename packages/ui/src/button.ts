// BUTTON
//
// A button in the theme. The same config as @foldkit/ui's Button where it has
// one (`onClick`, `isDisabled`, `type`, `isAutofocus`), with a `label` and a
// `variant` in place of `toView`. Stateless.
//
// It's a real `<button>`, so the platform does the keyboard: a browser, and
// FoldKit on gpuix (host.ts), click a focused button on Enter and on Space's
// release. A disabled button is `aria-disabled`, as @foldkit/ui's and Base
// UI's `focusableWhenDisabled` have it: it stays a tab stop, so it can be
// found and read, but nothing clicks it.

import type { Attribute, Html, HtmlBuilder } from 'foldkit/html'

import { part } from './parts.ts'

export type ViewConfig<Message> = Readonly<{
  label: string
  onClick?: Message
  /** The default is a quiet button; `primary` is the accent, `danger` warns. */
  variant?: 'primary' | 'danger'
  isDisabled?: boolean
  type?: 'button' | 'submit' | 'reset'
  isAutofocus?: boolean
  id?: string
  attributes?: ReadonlyArray<Attribute<Message>>
}>

export const view = <Message>(config: ViewConfig<Message>, h: HtmlBuilder<Message>): Html => {
  const { label, onClick, variant, isDisabled = false, type = 'button', isAutofocus = false, id } = config
  return h.button([
    ...part(h, 'button', undefined, { variant, disabled: isDisabled }),
    h.Type(type),
    ...(id === undefined ? [] : [h.Id(id)]),
    ...(isDisabled ? [h.AriaDisabled(true)] : onClick === undefined ? [] : [h.OnClick(onClick)]),
    ...(isAutofocus ? [h.Autofocus(true)] : []),
    ...(config.attributes ?? []),
  ], [label])
}
