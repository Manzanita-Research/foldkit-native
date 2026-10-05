// DISCLOSURE
//
// A button that shows and hides a panel under it. The same config as
// @foldkit/ui's Disclosure (`id`, `isOpen`, `onToggle`, `isDisabled`,
// `ariaLabel`, `ariaLabelledBy`), with a `label` and the panel's `content`
// in place of `toView`. Stateless and controlled: the parent's Model says
// whether it's open.
//
// Behaviour, as WAI-ARIA's disclosure and Base UI's Collapsible: a
// `<button>` with `aria-expanded`, and `aria-controls` naming the panel
// while it's open. It's a real button, so Enter and Space (on its release)
// are the platform's own activation. The panel is drawn only while open.
// A disabled disclosure is `aria-disabled`: it stays a tab stop, and
// nothing opens it.

import type { Html, HtmlBuilder } from 'foldkit/html'

import { part } from './parts.ts'

export type ViewConfig<Message> = Readonly<{
  id: string
  label: string
  isOpen: boolean
  onToggle: (isOpen: boolean) => Message
  /** What the panel shows while open. */
  content: ReadonlyArray<Html>
  isDisabled?: boolean
  /** Names the button instead of its label. */
  ariaLabel?: string
  ariaLabelledBy?: string
}>

export const buttonId = (id: string) => `${id}-button`
export const panelId = (id: string) => `${id}-panel`

export const view = <Message>(config: ViewConfig<Message>, h: HtmlBuilder<Message>): Html => {
  const { id, label, isOpen, onToggle, content, isDisabled = false, ariaLabel, ariaLabelledBy } = config
  const state = { open: isOpen, disabled: isDisabled }
  return h.div(part(h, 'disclosure', undefined, state), [
    h.button([
      ...part(h, 'disclosure', 'trigger', state),
      h.Id(buttonId(id)),
      h.Type('button'),
      h.AriaExpanded(isOpen),
      ...(isOpen ? [h.AriaControls(panelId(id))] : []),
      ...(ariaLabel !== undefined ? [h.AriaLabel(ariaLabel)] : ariaLabelledBy !== undefined ? [h.AriaLabelledBy(ariaLabelledBy)] : []),
      ...(isDisabled ? [h.AriaDisabled(true)] : [h.OnClick(onToggle(!isOpen))]),
    ], [
      h.span([...part(h, 'disclosure', 'icon', state), h.AriaHidden(true)], [isOpen ? '▾' : '▸']),
      h.span(part(h, 'disclosure', 'label', state), [label]),
    ]),
    ...(isOpen ? [h.div([...part(h, 'disclosure', 'panel', state), h.Id(panelId(id))], [...content])] : []),
  ])
}
