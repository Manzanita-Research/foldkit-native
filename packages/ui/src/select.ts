// SELECT
//
// A button that opens a list of options under it, to pick one. A submodel,
// like the Listbox it opens: its own Model (open or not, and the list's
// highlight), Messages and update, wrapped by the parent; the selected value
// stays in the parent's Model and arrives through `chosen`.
//
// The popup is anchored: on FoldKit on gpuix it's GPUI's `anchored` element
// (`data-fn-anchored`), which places it under the trigger, flips it above
// when there's no room, and paints it over everything; on the web the theme
// positions it under the trigger. A transparent backdrop under the popup
// closes it on a click outside.
//
// Behaviour, as WAI-ARIA's select-only combobox and Base UI's Select: the
// trigger is a button with `role="combobox"`, `aria-expanded` and
// `aria-controls`; a click, Enter, Space, or Down/Up opens it, and focus
// moves to the list (the Listbox: arrows, Home/End, letters). Enter or Space
// picks and closes; Escape closes; either way focus comes back to the
// trigger. Tab closes it and moves on, as focus would.

import { Effect, Option, Schema } from 'effect'
import { Command, Render, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import * as Listbox from './listbox.ts'
import { part } from './parts.ts'

// MODEL

export const Model = Schema.Struct({
  id: Schema.String,
  isOpen: Schema.Boolean,
  list: Listbox.Model,
})
export type Model = typeof Model.Type

export const init = (config: { id: string; selectedIndex?: number }): Model => ({
  id: config.id,
  isOpen: false,
  list: Listbox.init({ id: `${config.id}-list`, ...(config.selectedIndex === undefined ? {} : { highlighted: config.selectedIndex }) }),
})

export const triggerId = (id: string) => `${id}-trigger`
export const listId = (id: string) => `${id}-list`

// MESSAGE

export const Message = defineMessageUnion({
  /** Opened, with the highlight on the selected option. */
  Opened: { selectedIndex: Schema.Number },
  /** Closed; `restoreFocus` puts focus back on the trigger (not for Tab). */
  Closed: { restoreFocus: Schema.Boolean },
  Chose: { value: Schema.String },
  GotListMessage: { message: Listbox.Message },
  CompletedFocus: {},
  /** A key the popup doesn't act on (the list may). */
  Ignored: {},
})
export type Message = typeof Message.Type

/** The value a Message picked, if it picked one: the parent's cue. */
export const chosen = (message: Message): Option.Option<string> =>
  message._tag === 'Chose' ? Option.some(message.value) : Option.none()

// COMMAND

/** Focuses an element once the render that drew it is in. */
export const FocusAfterCommit = Command.define('SelectFocusAfterCommit', {
  args: { elementId: Schema.String },
  messages: [Message.CompletedFocus],
  execute: ({ elementId }) =>
    Render.afterCommit.pipe(
      Effect.andThen(Effect.sync(() => {
        document.getElementById(elementId)?.focus()
        return Message.CompletedFocus()
      })),
    ),
})

// UPDATE

const close = (model: Model, restoreFocus: boolean): Update.Return<Model, Message> => ({
  model: modifyFields(model, { isOpen: () => false }),
  commands: restoreFocus ? [FocusAfterCommit({ elementId: triggerId(model.id) })] : [],
})

export const update = (model: Model, message: Message): Update.Return<Model, Message> =>
  Message.match<Update.Return<Model, Message>>(message, {
    Opened: ({ selectedIndex }) => ({
      model: modifyFields(model, {
        isOpen: () => true,
        list: list => ({ ...list, highlighted: Math.max(0, selectedIndex) }),
      }),
      commands: [FocusAfterCommit({ elementId: listId(model.id) })],
    }),
    Closed: ({ restoreFocus }) => close(model, restoreFocus),
    Chose: () => close(model, true),
    GotListMessage: ({ message: child }) => {
      const next = Listbox.update(model.list, child)
      return {
        model: modifyFields(model, { list: () => next.model }),
        commands: Command.mapMessages(next.commands, message => Message.GotListMessage({ message })),
      }
    },
    CompletedFocus: () => ({ model }),
    Ignored: () => ({ model }),
  })

// VIEW

export type ViewConfig<ParentMessage> = Readonly<{
  model: Model
  label: string
  items: ReadonlyArray<Listbox.Item>
  selected: string | undefined
  toParentMessage: (message: Message) => ParentMessage
  /** Popup placement on gpuix: side, align and gap, as gpuix's anchored. */
  placement?: Readonly<{ side?: 'top' | 'right' | 'bottom' | 'left'; align?: 'start' | 'center' | 'end'; gap?: number }>
  maxHeight?: number
}>

export const view = <ParentMessage>(config: ViewConfig<ParentMessage>, h: HtmlBuilder<ParentMessage>): Html => {
  const { model, items, selected, toParentMessage: up } = config
  const selectedIndex = items.findIndex(item => item.value === selected)
  const current = items[selectedIndex]
  const open = up(Message.Opened({ selectedIndex }))
  const trigger = h.button([
    ...part(h, 'select', 'trigger', { open: model.isOpen }),
    h.Type('button'),
    h.Id(triggerId(model.id)),
    h.Role('combobox'),
    h.AriaLabel(config.label),
    h.AriaHasPopup('listbox'),
    h.AriaExpanded(model.isOpen),
    h.AriaControls(listId(model.id)),
    // Enter and Space click the button (the platform's own activation).
    h.OnClick(model.isOpen ? up(Message.Closed({ restoreFocus: true })) : open),
    h.OnKeyDownPreventDefault(key => (!model.isOpen && (key === 'ArrowDown' || key === 'ArrowUp') ? Option.some(open) : Option.none())),
  ], [
    h.span(part(h, 'select', 'value', { placeholder: current === undefined }), [current?.label ?? 'Choose…']),
    h.span([...part(h, 'select', 'icon'), h.AriaHidden(true)], ['▾']),
  ])
  if (!model.isOpen) return h.div(part(h, 'select', undefined), [trigger])
  return h.div(part(h, 'select', undefined, { open: true }), [
    trigger,
    h.div([...part(h, 'select', 'backdrop'), h.OnClick(up(Message.Closed({ restoreFocus: true })))], []),
    h.div([
      ...part(h, 'select', 'anchor'),
      h.DataAttribute('fn-anchored', JSON.stringify({ side: 'bottom', align: 'start', gap: 4, ...config.placement })),
    ], [
      h.div([
        ...part(h, 'select', 'popup'),
        h.OnKeyDown(key => key === 'Escape' ? up(Message.Closed({ restoreFocus: true })) : key === 'Tab' ? up(Message.Closed({ restoreFocus: false })) : up(Message.Ignored())),
      ], [
        Listbox.view({
          model: model.list, label: config.label, items, selected,
          onSelect: value => up(Message.Chose({ value })),
          toParentMessage: message => up(Message.GotListMessage({ message })),
          ...(config.maxHeight === undefined ? {} : { maxHeight: config.maxHeight }),
        }, h),
      ]),
    ]),
  ])
}
