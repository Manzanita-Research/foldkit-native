// POPOVER
//
// A button that opens a panel beside it: a few controls, a short form, more
// detail. A submodel like @foldkit/ui's Popover: its Model (open or not,
// modal or not), Messages and update, wrapped by the parent; what's in the
// panel is the parent's.
//
// The panel is anchored, as the Select's popup is: on FoldKit on gpuix it's
// GPUI's `anchored` element (`data-fn-anchored`), placed beside the trigger,
// flipped to fit the window and painted over everything; on the web the
// theme places it under the trigger. A transparent backdrop under it takes a
// click outside, which closes it.
//
// Behaviour, as @foldkit/ui's and Base UI's Popover: the trigger is a button
// with `aria-haspopup="dialog"`, `aria-expanded` and `aria-controls`; a
// click, Enter or Space opens it, and focus moves into the panel (a
// `role="dialog"` named by its title), or to the element `initialFocus`
// names. Escape and a click outside close it and put focus back on the
// trigger. Focus leaving the panel (Tab past its end, Shift-Tab before its
// start) closes it and lets focus go on. A modal popover keeps Tab inside
// (`aria-modal`), makes everything else inert and locks the page's scroll,
// through FoldKit's own `Dom` Commands: the platform's (host.ts) on gpuix.

import { Array as Arr, Effect, Option, Schema } from 'effect'
import { Command, Dom, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { part } from './parts.ts'

// MODEL

export const Model = Schema.Struct({
  id: Schema.String,
  isOpen: Schema.Boolean,
  isModal: Schema.Boolean,
  /** The id of what takes focus when it opens; the panel itself if none. */
  initialFocus: Schema.Option(Schema.String),
})
export type Model = typeof Model.Type

export const init = (config: { id: string; isModal?: boolean; initialFocus?: string }): Model => ({
  id: config.id,
  isOpen: false,
  isModal: config.isModal ?? false,
  initialFocus: Option.fromNullishOr(config.initialFocus),
})

export const triggerId = (id: string) => `${id}-trigger`
export const panelId = (id: string) => `${id}-panel`
export const titleId = (id: string) => `${id}-title`
export const descriptionId = (id: string) => `${id}-description`
const backdropId = (id: string) => `${id}-backdrop`

// MESSAGE

export const Message = defineMessageUnion({
  Opened: {},
  /** Closed; `restoreFocus` puts focus back on the trigger (not when focus
   *  left the panel on its own). */
  Closed: { restoreFocus: Schema.Boolean },
  CompletedFocus: {},
  CompletedIsolation: {},
})
export type Message = typeof Message.Type

// COMMAND

const selector = (id: string) => `#${id}`

/** Moves focus into the panel once it's drawn (FoldKit's `Dom.focus`). */
export const FocusPanel = Command.define('PopoverFocusPanel', {
  args: { elementId: Schema.String },
  messages: [Message.CompletedFocus],
  execute: ({ elementId }) => Dom.focus(selector(elementId)).pipe(Effect.ignore, Effect.as(Message.CompletedFocus())),
})

/** Puts focus back on the trigger. */
export const FocusTrigger = Command.define('PopoverFocusTrigger', {
  args: { id: Schema.String },
  messages: [Message.CompletedFocus],
  execute: ({ id }) => Dom.focus(selector(triggerId(id))).pipe(Effect.ignore, Effect.as(Message.CompletedFocus())),
})

/** Modal: the page's scroll locked, everything but the popover inert. */
export const Isolate = Command.define('PopoverIsolate', {
  args: { id: Schema.String },
  messages: [Message.CompletedIsolation],
  execute: ({ id }) =>
    Dom.lockScroll.pipe(
      Effect.andThen(Dom.inertOthers(id, [triggerId(id), backdropId(id), panelId(id)].map(selector))),
      Effect.as(Message.CompletedIsolation()),
    ),
})

/** Modal, closing: the page scrolls again and nothing is inert. */
export const Release = Command.define('PopoverRelease', {
  args: { id: Schema.String },
  messages: [Message.CompletedIsolation],
  execute: ({ id }) =>
    Dom.unlockScroll.pipe(Effect.andThen(Dom.restoreInert(id)), Effect.as(Message.CompletedIsolation())),
})

// UPDATE

export const update = (model: Model, message: Message): Update.Return<Model, Message> =>
  Message.match<Update.Return<Model, Message>>(message, {
    Opened: () =>
      model.isOpen ? { model } : {
        model: modifyFields(model, { isOpen: () => true }),
        commands: [
          ...(model.isModal ? [Isolate({ id: model.id })] : []),
          FocusPanel({ elementId: Option.getOrElse(model.initialFocus, () => panelId(model.id)) }),
        ],
      },
    // Escape, then the panel losing focus as it goes: one close.
    Closed: ({ restoreFocus }) =>
      !model.isOpen ? { model } : {
        model: modifyFields(model, { isOpen: () => false }),
        commands: Arr.flatten([
          model.isModal ? [Release({ id: model.id })] : [],
          restoreFocus ? [FocusTrigger({ id: model.id })] : [],
        ]),
      },
    CompletedFocus: () => ({ model }),
    CompletedIsolation: () => ({ model }),
  })

/** Opens it from the parent's update (a shortcut, say). */
export const open = (model: Model) => update(model, Message.Opened())
/** Closes it from the parent's update (an action in the panel was taken),
 *  focus back on the trigger. Nothing happens if it's closed. */
export const close = (model: Model) => update(model, Message.Closed({ restoreFocus: true }))

// VIEW

export type ViewConfig<ParentMessage> = Readonly<{
  model: Model
  /** The trigger's text. */
  label: string
  /** The panel's title, which names it. */
  title: string
  description?: string
  /** What's in the panel after its title and description. */
  content: ReadonlyArray<Html>
  toParentMessage: (message: Message) => ParentMessage
  /** Panel placement on gpuix: side, align and gap, as gpuix's anchored. */
  placement?: Readonly<{ side?: 'top' | 'right' | 'bottom' | 'left'; align?: 'start' | 'center' | 'end'; gap?: number }>
}>

export const view = <ParentMessage>(config: ViewConfig<ParentMessage>, h: HtmlBuilder<ParentMessage>): Html => {
  const { model, title, description, content, toParentMessage: up } = config
  const { id, isOpen } = model
  const close = (restoreFocus: boolean) => up(Message.Closed({ restoreFocus }))
  const trigger = h.button([
    ...part(h, 'popover', 'trigger', { open: isOpen }),
    h.Type('button'),
    h.Id(triggerId(id)),
    h.AriaHasPopup('dialog'),
    h.AriaExpanded(isOpen),
    ...(isOpen ? [h.AriaControls(panelId(id))] : []),
    // Enter and Space click the button (the platform's own activation).
    h.OnClick(isOpen ? close(true) : up(Message.Opened())),
  ], [config.label])
  if (!isOpen) return h.div(part(h, 'popover', undefined), [trigger])
  return h.div(part(h, 'popover', undefined, { open: true, modal: model.isModal }), [
    trigger,
    h.div([...part(h, 'popover', 'backdrop'), h.Id(backdropId(id)), h.OnClick(close(true))], []),
    h.div([
      ...part(h, 'popover', 'anchor'),
      h.DataAttribute('fn-anchored', JSON.stringify({ side: 'bottom', align: 'start', gap: 8, ...config.placement })),
    ], [
      h.div([
        ...part(h, 'popover', 'panel', { modal: model.isModal }),
        h.Id(panelId(id)),
        h.Role('dialog'),
        h.AriaLabelledBy(titleId(id)),
        ...(description === undefined ? [] : [h.AriaDescribedBy(descriptionId(id))]),
        ...(model.isModal ? [h.AriaModal(true)] : []),
        h.Tabindex(0),
        h.OnKeyDownPreventDefault(key => (key === 'Escape' ? Option.some(close(true)) : Option.none())),
        h.OnFocusLeave(close(false)),
      ], [
        h.h2([...part(h, 'popover', 'title'), h.Id(titleId(id))], [title]),
        ...(description === undefined ? [] : [h.p([...part(h, 'popover', 'description'), h.Id(descriptionId(id))], [description])]),
        ...content,
      ]),
    ]),
  ])
}
