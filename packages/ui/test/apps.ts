// One small FoldKit app per component, for its tests: the component in an
// ordinary Model, Message and update, the way an app uses it.
import { Schema } from 'effect'
import { Command, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'

import { Option } from 'effect'

import { Button, Checkbox, Dialog, Listbox, RadioGroup, ScrollArea, Select, Switch, Tabs, TextField, button, part, uiCss } from '../src/index.ts'

// The theme's tokens come from the runner (run.ts), around the app.
const root = <Message>(h: HtmlBuilder<Message>, children: ReadonlyArray<Html>) =>
  h.div(part(h, 'root', undefined), [h.div([h.Style({ padding: '16px', display: 'flex', 'flex-direction': 'column', gap: '12px' })], children)])

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
    // Neither of these toggles: one's off limits, one only reports.
    Switch.view({ id: 'airplane', label: 'Airplane mode', description: 'Managed by your organisation', isChecked: false, isDisabled: true, onToggle: isChecked => Message.Toggled({ isChecked }) }, h),
    Switch.view({ id: 'location', label: 'Location', isChecked: true, isReadOnly: true, onToggle: isChecked => Message.Toggled({ isChecked }) }, h),
  ])
  return { Model, Message, init, update, view }
})()

// CHECKBOX
// "All toppings" ticks or clears the three under it, and is indeterminate
// while only some are ticked.
export const Checks = (() => {
  const toppings = ['Cheese', 'Basil', 'Olives'] as const
  const Model = Schema.Struct({ toppings: Schema.Array(Schema.String), remember: Schema.Boolean })
  const Message = defineMessageUnion({
    ToggledAll: { isChecked: Schema.Boolean },
    ToggledTopping: { name: Schema.String, isChecked: Schema.Boolean },
    ToggledRemember: { isChecked: Schema.Boolean },
  })
  type Model = typeof Model.Type
  type Message = typeof Message.Type
  const init: Model = { toppings: ['Cheese'], remember: false }
  const update = (model: Model, message: Message): Update.Return<Model, Message> =>
    Message.match<Update.Return<Model, Message>>(message, {
      ToggledAll: ({ isChecked }) => ({ model: { ...model, toppings: isChecked ? [...toppings] : [] } }),
      ToggledTopping: ({ name, isChecked }) => ({
        model: { ...model, toppings: toppings.filter(other => (other === name ? isChecked : model.toppings.includes(other))) },
      }),
      ToggledRemember: ({ isChecked }) => ({ model: { ...model, remember: isChecked } }),
    })
  const view = (model: Model, h: HtmlBuilder<Message>) => {
    const count = model.toppings.length
    return root(h, [
      Checkbox.view({
        id: 'all', label: 'All toppings', isChecked: count === toppings.length, isIndeterminate: count > 0 && count < toppings.length,
        onToggle: isChecked => Message.ToggledAll({ isChecked }),
      }, h),
      h.div([h.Style({ display: 'flex', 'flex-direction': 'column', gap: '8px', 'padding-left': '26px' })], toppings.map(name =>
        Checkbox.view({
          id: name.toLowerCase(), label: name, isChecked: model.toppings.includes(name),
          onToggle: isChecked => Message.ToggledTopping({ name, isChecked }),
        }, h))),
      Checkbox.view({
        id: 'remember', label: 'Remember me', description: 'Stay signed in on this computer', isChecked: model.remember,
        onToggle: isChecked => Message.ToggledRemember({ isChecked }),
      }, h),
      Checkbox.view({ id: 'terms', label: 'Accepted the terms', isChecked: true, isReadOnly: true, onToggle: isChecked => Message.ToggledRemember({ isChecked }) }, h),
      Checkbox.view({ id: 'beta', label: 'Beta features', description: 'Not available on your plan', isChecked: false, isDisabled: true, onToggle: isChecked => Message.ToggledRemember({ isChecked }) }, h),
    ])
  }
  return { Model, Message, init, update, view }
})()

// BUTTON: the variants, and a disabled one.
export const Actions = (() => {
  const Model = Schema.Struct({ pressed: Schema.Array(Schema.String) })
  const Message = defineMessageUnion({ Pressed: { label: Schema.String } })
  type Model = typeof Model.Type
  type Message = typeof Message.Type
  const init: Model = { pressed: [] }
  const update = (model: Model, message: Message): Update.Return<Model, Message> => ({ model: { pressed: [...model.pressed, message.label] } })
  const press = (label: string) => Message.Pressed({ label })
  const view = (model: Model, h: HtmlBuilder<Message>) => root(h, [
    h.div([h.Style({ display: 'flex', 'flex-direction': 'row', gap: '8px' })], [
      Button.view({ id: 'save', label: 'Save', variant: 'primary', onClick: press('Save') }, h),
      Button.view({ id: 'cancel', label: 'Cancel', onClick: press('Cancel') }, h),
      Button.view({ id: 'delete', label: 'Delete', variant: 'danger', onClick: press('Delete') }, h),
      Button.view({ id: 'archive', label: 'Archive', isDisabled: true, onClick: press('Archive') }, h),
    ]),
    h.p([h.Id('pressed')], [`Pressed: ${model.pressed.join(', ') || 'nothing'}`]),
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
// Escape, from inside the list, marks the highlighted fruit sold out (its
// option disabled) or back in stock.
export const Picker = (() => {
  const items: ReadonlyArray<Listbox.Item> = ['Apple', 'Apricot', 'Banana', 'Blueberry', 'Cherry', 'Damson', 'Elderberry', 'Fig', 'Grape', 'Kiwi']
    .map(label => ({ value: label.toLowerCase(), label }))
  const Model = Schema.Struct({ list: Listbox.Model, fruit: Schema.String, soldOut: Schema.Array(Schema.String) })
  const Message = defineMessageUnion({ Picked: { value: Schema.String }, GotListMessage: { message: Listbox.Message }, ToggledSoldOut: {} })
  type Model = typeof Model.Type
  type Message = typeof Message.Type
  const toList = (message: Listbox.Message) => Message.GotListMessage({ message })
  const init: Model = { list: Listbox.init({ id: 'fruit' }), fruit: 'apple', soldOut: [] }
  const update = (model: Model, message: Message): Update.Return<Model, Message> =>
    Message.match<Update.Return<Model, Message>>(message, {
      Picked: ({ value }) => ({ model: { ...model, fruit: value } }),
      ToggledSoldOut: () => {
        const value = items[model.list.highlighted]!.value
        const soldOut = model.soldOut.includes(value) ? model.soldOut.filter(other => other !== value) : [...model.soldOut, value]
        return { model: { ...model, soldOut } }
      },
      GotListMessage: ({ message: child }) => {
        const next = Listbox.update(model.list, child)
        return { model: { ...model, list: next.model }, commands: Command.mapMessages(next.commands, toList) }
      },
    })
  const view = (model: Model, h: HtmlBuilder<Message>) => root(h, [
    h.div([h.OnKeyDownPreventDefault(key => (key === 'Escape' ? Option.some(Message.ToggledSoldOut()) : Option.none()))], [
      Listbox.view({
        model: model.list, label: 'Fruit', selected: model.fruit, maxHeight: 120,
        items: items.map(item => (model.soldOut.includes(item.value) ? { ...item, disabled: true } : item)),
        onSelect: value => Message.Picked({ value }), toParentMessage: toList,
      }, h),
    ]),
  ])
  return { Model, Message, init, update, view, items }
})()

// SELECT
export const Chooser = (() => {
  const items = Picker.items
  const Model = Schema.Struct({ fruit: Schema.String, select: Select.Model })
  const Message = defineMessageUnion({ GotSelectMessage: { message: Select.Message } })
  type Model = typeof Model.Type
  type Message = typeof Message.Type
  const toSelect = (message: Select.Message) => Message.GotSelectMessage({ message })
  const init: Model = { fruit: 'banana', select: Select.init({ id: 'fruit' }) }
  const update = (model: Model, message: Message): Update.Return<Model, Message> => {
    const next = Select.update(model.select, message.message)
    return {
      model: { fruit: Option.getOrElse(Select.chosen(message.message), () => model.fruit), select: next.model },
      commands: Command.mapMessages(next.commands, toSelect),
    }
  }
  const view = (model: Model, h: HtmlBuilder<Message>) => root(h, [
    button({ label: 'Before', onClick: Message.GotSelectMessage({ message: Select.Message.Ignored() }), attributes: [h.Id('before')] }, h),
    Select.view({ model: model.select, label: 'Fruit', items, selected: model.fruit, toParentMessage: toSelect, maxHeight: 168 }, h),
    h.input([h.Id('after'), h.Placeholder('After')]),
    h.p([h.Id('picked')], [`Picked: ${model.fruit}`]),
  ])
  return { Model, Message, init, update, view, items }
})()

// BUTTONS: two of the theme's, for focus rings.
export const Buttons = (() => {
  const Model = Schema.Struct({ pressed: Schema.Array(Schema.String) })
  const Message = defineMessageUnion({ Pressed: { label: Schema.String } })
  type Model = typeof Model.Type
  type Message = typeof Message.Type
  const init: Model = { pressed: [] }
  const update = (model: Model, message: Message): Update.Return<Model, Message> => ({ model: { pressed: [...model.pressed, message.label] } })
  const view = (_: Model, h: HtmlBuilder<Message>) => root(h, [
    h.div([h.Style({ display: 'flex', 'flex-direction': 'row', gap: '16px' })], ['First', 'Second'].map(label =>
      button({ label, onClick: Message.Pressed({ label }), attributes: [h.Id(label.toLowerCase())] }, h))),
  ])
  return { Model, Message, init, update, view }
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
  const view = (model: Model, h: HtmlBuilder<Message>) => h.div(part(h, 'root', undefined), [
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

// RADIO GROUP
// A plan to pick (Team isn't available), and a billing period that only
// reports (read-only).
export const Plans = (() => {
  const plans = ['hobby', 'pro', 'team'] as const
  const labels: Record<string, string> = { hobby: 'Hobby', pro: 'Pro', team: 'Team', monthly: 'Monthly', yearly: 'Yearly' }
  const descriptions: Record<string, string> = { hobby: 'For side projects', pro: 'For one person, every feature', team: 'Coming soon' }
  const Model = Schema.Struct({ plan: RadioGroup.Model, billing: RadioGroup.Model, chosen: Schema.String })
  const Message = defineMessageUnion({ GotPlanMessage: { message: RadioGroup.Message }, GotBillingMessage: { message: RadioGroup.Message } })
  type Model = typeof Model.Type
  type Message = typeof Message.Type
  const toPlan = (message: RadioGroup.Message) => Message.GotPlanMessage({ message })
  const toBilling = (message: RadioGroup.Message) => Message.GotBillingMessage({ message })
  const init: Model = { plan: RadioGroup.init({ id: 'plan' }), billing: RadioGroup.init({ id: 'billing' }), chosen: 'hobby' }
  const update = (model: Model, message: Message): Update.Return<Model, Message> =>
    Message.match<Update.Return<Model, Message>>(message, {
      GotPlanMessage: ({ message: child }) => {
        const next = RadioGroup.update(model.plan, child)
        return {
          model: { ...model, plan: next.model, chosen: next.outMessage?.value ?? model.chosen },
          commands: Command.mapMessages(next.commands, toPlan),
        }
      },
      GotBillingMessage: ({ message: child }) => {
        const next = RadioGroup.update(model.billing, child)
        return { model: { ...model, billing: next.model }, commands: Command.mapMessages(next.commands, toBilling) }
      },
    })
  const view = (model: Model, h: HtmlBuilder<Message>) => root(h, [
    RadioGroup.view({
      model: model.plan, options: plans, selectedValue: Option.some(model.chosen), ariaLabel: 'Plan', toParentMessage: toPlan,
      optionLabel: value => labels[value]!, optionDescription: value => descriptions[value],
      isOptionDisabled: value => value === 'team',
    }, h),
    RadioGroup.view({
      model: model.billing, options: ['monthly', 'yearly'], selectedValue: Option.some('yearly'), ariaLabel: 'Billing',
      toParentMessage: toBilling, optionLabel: value => labels[value]!, orientation: 'Horizontal', isReadOnly: true,
    }, h),
    h.p([h.Id('chosen')], [`Plan: ${labels[model.chosen]}`]),
  ])
  return { Model, Message, init, update, view }
})()

// TABS
// Settings in tabs along the top (selected as the arrows reach them), with
// Advanced not available; `activationMode` and `orientation` from the init.
const makeTabbed = (config: { activationMode: Tabs.ActivationMode; orientation: Tabs.Orientation }) => {
  const sections = ['general', 'privacy', 'advanced', 'about'] as const
  const titles: Record<string, string> = { general: 'General', privacy: 'Privacy', advanced: 'Advanced', about: 'About' }
  const Model = Schema.Struct({ tabs: Tabs.Model, section: Schema.String, name: Schema.String })
  const Message = defineMessageUnion({ GotTabsMessage: { message: Tabs.Message }, ChangedName: { value: Schema.String } })
  type Model = typeof Model.Type
  type Message = typeof Message.Type
  const toTabs = (message: Tabs.Message) => Message.GotTabsMessage({ message })
  const init: Model = { tabs: Tabs.init({ id: 'settings', activationMode: config.activationMode }), section: 'general', name: 'Ada' }
  const update = (model: Model, message: Message): Update.Return<Model, Message> =>
    Message.match<Update.Return<Model, Message>>(message, {
      GotTabsMessage: ({ message: child }) => {
        const next = Tabs.update(model.tabs, child)
        return {
          model: { ...model, tabs: next.model, section: next.outMessage?.value ?? model.section },
          commands: Command.mapMessages(next.commands, toTabs),
        }
      },
      ChangedName: ({ value }) => ({ model: { ...model, name: value } }),
    })
  const panel = (h: HtmlBuilder<Message>, model: Model) => (value: string) => {
    if (value === 'general') return [TextField.view({ id: 'name', label: 'Display name', value: model.name, onInput: value => Message.ChangedName({ value }) }, h)]
    if (value === 'privacy') return [h.p([], ['Nobody sees your activity.'])]
    return [h.p([], [`${titles[value]} settings`])]
  }
  const view = (model: Model, h: HtmlBuilder<Message>) => root(h, [
    Tabs.view({
      model: model.tabs, tabs: sections, selectedValue: model.section, ariaLabel: 'Settings', toParentMessage: toTabs,
      tabLabel: value => titles[value]!, panel: panel(h, model), isTabDisabled: value => value === 'advanced',
      orientation: config.orientation,
    }, h),
  ])
  return { Model, Message, init, update, view }
}
export const Settings = makeTabbed({ activationMode: 'Automatic', orientation: 'Horizontal' })
export const Sidebar = makeTabbed({ activationMode: 'Manual', orientation: 'Vertical' })
