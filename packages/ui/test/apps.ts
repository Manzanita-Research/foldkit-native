// One small FoldKit app per component, for its tests: the component in an
// ordinary Model, Message and update, the way an app uses it.
import { Schema } from 'effect'
import { Command, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'

import { Dialog, Listbox, ScrollArea, Switch, TextField, button, dusk, part, themeStyle, uiCss } from '../src/index.ts'

const root = <Message>(h: HtmlBuilder<Message>, children: ReadonlyArray<Html>) =>
  h.div([...part(h, 'root', undefined), h.Style(themeStyle(dusk))], [h.div([h.Style({ padding: '16px', display: 'flex', 'flex-direction': 'column', gap: '12px' })], children)])

export const css = uiCss

// TEXT FIELD
export const Fields = (() => {
  const Model = Schema.Struct({ name: Schema.String, email: Schema.String })
  const Message = defineMessageUnion({ ChangedName: { value: Schema.String }, ChangedEmail: { value: Schema.String } })
  type Model = typeof Model.Type
  type Message = typeof Message.Type
  const init: Model = { name: '', email: '' }
  const update = (model: Model, message: Message): Update.Return<Model, Message> =>
    Message.match<Update.Return<Model, Message>>(message, {
      ChangedName: ({ value }) => ({ model: { ...model, name: value } }),
      ChangedEmail: ({ value }) => ({ model: { ...model, email: value } }),
    })
  const view = (model: Model, h: HtmlBuilder<Message>) => root(h, [
    TextField.view({ id: 'name', label: 'Name', value: model.name, placeholder: 'Ada', onInput: value => Message.ChangedName({ value }) }, h),
    TextField.view({
      id: 'email', label: 'Email', value: model.email, placeholder: 'ada@example.com', type: 'email',
      onInput: value => Message.ChangedEmail({ value }),
      ...(model.email.includes('@') || model.email === '' ? { description: 'We never share it.' } : { error: 'Needs an @' }),
    }, h),
  ])
  return { Model, Message, init, update, view }
})()

// SWITCH
export const Toggle = (() => {
  const Model = Schema.Struct({ on: Schema.Boolean })
  const Message = defineMessageUnion({ Toggled: { isChecked: Schema.Boolean } })
  type Model = typeof Model.Type
  type Message = typeof Message.Type
  const init: Model = { on: false }
  const update = (_: Model, message: Message): Update.Return<Model, Message> => ({ model: { on: message.isChecked } })
  const view = (model: Model, h: HtmlBuilder<Message>) => root(h, [
    Switch.view({ id: 'wifi', label: 'Wi-Fi', description: 'Join known networks', isChecked: model.on, onToggle: isChecked => Message.Toggled({ isChecked }) }, h),
  ])
  return { Model, Message, init, update, view }
})()

// SCROLL AREA
export const Scroller = (() => {
  const Model = Schema.Struct({})
  const Message = defineMessageUnion({ Nothing: {} })
  type Model = typeof Model.Type
  type Message = typeof Message.Type
  const update = (model: Model): Update.Return<Model, Message> => ({ model })
  const view = (_: Model, h: HtmlBuilder<Message>) => root(h, [
    ScrollArea.view({ label: 'Log', maxHeight: 120 }, Array.from({ length: 30 }, (_, i) => h.p([h.Style({ margin: '0', height: '24px' })], [`Line ${i + 1}`])), h),
  ])
  return { Model, Message, init: {} as Model, update, view }
})()

// LISTBOX
export const Picker = (() => {
  const items: ReadonlyArray<Listbox.Item> = ['Apple', 'Apricot', 'Banana', 'Blueberry', 'Cherry', 'Damson', 'Elderberry', 'Fig', 'Grape', 'Kiwi']
    .map(label => ({ value: label.toLowerCase(), label }))
  const Model = Schema.Struct({ list: Listbox.Model, fruit: Schema.String })
  const Message = defineMessageUnion({ Picked: { value: Schema.String }, GotListMessage: { message: Listbox.Message } })
  type Model = typeof Model.Type
  type Message = typeof Message.Type
  const toList = (message: Listbox.Message) => Message.GotListMessage({ message })
  const init: Model = { list: Listbox.init({ id: 'fruit' }), fruit: 'apple' }
  const update = (model: Model, message: Message): Update.Return<Model, Message> =>
    Message.match<Update.Return<Model, Message>>(message, {
      Picked: ({ value }) => ({ model: { ...model, fruit: value } }),
      GotListMessage: ({ message: child }) => {
        const next = Listbox.update(model.list, child)
        return { model: { ...model, list: next.model }, commands: Command.mapMessages(next.commands, toList) }
      },
    })
  const view = (model: Model, h: HtmlBuilder<Message>) => root(h, [
    Listbox.view({
      model: model.list, label: 'Fruit', items, selected: model.fruit, maxHeight: 120,
      onSelect: value => Message.Picked({ value }), toParentMessage: toList,
    }, h),
  ])
  return { Model, Message, init, update, view, items }
})()

// DIALOG
export const Confirm = (() => {
  const Model = Schema.Struct({ open: Schema.Boolean, confirmed: Schema.Number })
  const Message = defineMessageUnion({ Opened: {}, Closed: {}, Confirmed: {} })
  type Model = typeof Model.Type
  type Message = typeof Message.Type
  const init: Model = { open: false, confirmed: 0 }
  const update = (model: Model, message: Message): Update.Return<Model, Message> =>
    Message.match<Update.Return<Model, Message>>(message, {
      Opened: () => ({ model: { ...model, open: true } }),
      Closed: () => ({ model: { ...model, open: false } }),
      Confirmed: () => ({ model: { open: false, confirmed: model.confirmed + 1 } }),
    })
  const view = (model: Model, h: HtmlBuilder<Message>) => h.div([...part(h, 'root', undefined), h.Style(themeStyle(dusk))], [
    h.div([h.Style({ padding: '16px', display: 'flex', 'flex-direction': 'row', gap: '8px' })], [
      button({ label: 'Delete…', onClick: Message.Opened(), attributes: [h.Id('open')] }, h),
      h.input([h.Id('behind'), h.Placeholder('Behind the dialog')]),
    ]),
    Dialog.view({
      id: 'confirm', isOpen: model.open, title: 'Delete file?', description: 'You can’t undo this.', onClose: Message.Closed(),
      content: [h.div(part(h, 'dialog', 'actions'), [
        button({ label: 'Cancel', onClick: Message.Closed(), attributes: Dialog.initialFocus(h) }, h),
        button({ label: 'Delete', onClick: Message.Confirmed(), variant: 'danger' }, h),
      ])],
    }, h),
  ])
  return { Model, Message, init, update, view }
})()
