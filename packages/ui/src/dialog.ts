// DIALOG
//
// A modal panel over the app. Controlled: the parent's Model says whether
// it's open, and `onClose` is the Message for Escape, a click on the backdrop,
// or a cancel button.
//
// Behaviour, as WAI-ARIA's modal dialog and Base UI's: `role="dialog"` with
// `aria-modal`, named by its title and described by its description. While
// it's open, Tab and Shift-Tab cycle inside it, the element marked `initial`
// takes focus when it opens, and focus goes back where it was when it closes.
// On FoldKit on gpuix all three are the platform's: GPUI's `focusNextWithin`
// keeps Tab inside an `aria-modal` element, `autofocus` focuses on insertion,
// and focus returns when the focused scope goes away (host.ts). On the web the
// same markup gets them from `<dialog>`'s showModal.

import { Option } from 'effect'
import type { Attribute, Html, HtmlBuilder } from 'foldkit/html'

import { part } from './parts.ts'

export type ViewConfig<Message> = Readonly<{
  id: string
  isOpen: boolean
  title: string
  description?: string
  onClose: Message
  /** The panel's content (actions, fields). */
  content: ReadonlyArray<Html>
}>

export const titleId = (id: string) => `${id}-title`
export const descriptionId = (id: string) => `${id}-description`

/** Spread on the element that should take focus when the dialog opens. */
export const initialFocus = <Message>(h: HtmlBuilder<Message>): ReadonlyArray<Attribute<Message>> => [h.Autofocus(true)]

export const view = <Message>(config: ViewConfig<Message>, h: HtmlBuilder<Message>): Html => {
  const { id, isOpen, title, description, onClose, content } = config
  if (!isOpen) return h.div([h.Id(`${id}-closed`), h.Hidden(true)], [])
  // The backdrop is the panel's sibling, under it, so a click in the panel
  // never reaches it.
  return h.div(part(h, 'dialog', 'layer', { open: true }), [
    h.div([...part(h, 'dialog', 'backdrop', { open: true }), h.OnClick(onClose)], []),
    h.div([
      ...part(h, 'dialog', 'panel', { open: true }),
      h.Id(id),
      h.Role('dialog'),
      h.AriaModal(true),
      h.AriaLabelledBy(titleId(id)),
      ...(description === undefined ? [] : [h.AriaDescribedBy(descriptionId(id))]),
      h.Tabindex(-1),
      h.OnKeyDownPreventDefault(key => (key === 'Escape' ? Option.some(onClose) : Option.none())),
    ], [
      h.h2([...part(h, 'dialog', 'title'), h.Id(titleId(id))], [title]),
      ...(description === undefined ? [] : [h.p([...part(h, 'dialog', 'description'), h.Id(descriptionId(id))], [description])]),
      ...content,
    ]),
  ])
}
