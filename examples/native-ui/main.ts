// Native UI: a preferences panel built from @foldkit-native/ui, drawn by
// FoldKit on gpuix (no happy-dom, no mirror). Written for the FKN-11 spike.
//
// Each component is here for a reason: two text fields (Tab moves between
// them in GPUI's own focus order), a switch that changes the theme live, a
// listbox of accent colours in a scroll area (the keyboard highlight scrolls
// into view), and a dialog (Tab stays inside it, Escape closes it, focus
// comes back to the button that opened it). The theme is data in the Model:
// the view sets it on the root as custom properties, with no Command.

import { Schema } from 'effect'
import { Command, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { Dialog, Listbox, ScrollArea, Switch, TextField, button, defineTheme, dusk, paper, part, themeStyle } from '@foldkit-native/ui'

// MODEL

export const ACCENTS: ReadonlyArray<Listbox.Item> = [
  { value: 'violet', label: 'Violet', swatch: '#8b7cf6' },
  { value: 'blue', label: 'Blue', swatch: '#3d6df2' },
  { value: 'teal', label: 'Teal', swatch: '#14a3a0' },
  { value: 'green', label: 'Green', swatch: '#3fa34d' },
  { value: 'lime', label: 'Lime', swatch: '#84b818' },
  { value: 'amber', label: 'Amber', swatch: '#e0a020' },
  { value: 'orange', label: 'Orange', swatch: '#ef7a2f' },
  { value: 'red', label: 'Red', swatch: '#e5484d' },
  { value: 'pink', label: 'Pink', swatch: '#e2559f' },
  { value: 'plum', label: 'Plum', swatch: '#a855c8' },
  { value: 'slate', label: 'Slate', swatch: '#64748b' },
  { value: 'sand', label: 'Sand', swatch: '#b19470' },
]

export const Model = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
  isDark: Schema.Boolean,
  accent: Schema.String,
  accents: Listbox.Model,
  isDialogOpen: Schema.Boolean,
  resets: Schema.Number,
})
export type Model = typeof Model.Type

export const initialModel: Model = {
  name: '',
  email: '',
  isDark: true,
  accent: 'violet',
  accents: Listbox.init({ id: 'accent' }),
  isDialogOpen: false,
  resets: 0,
}

export const init = (): Update.Return<Model, Message> => ({ model: initialModel })

// MESSAGE

export const Message = defineMessageUnion({
  ChangedName: { value: Schema.String },
  ChangedEmail: { value: Schema.String },
  ToggledDark: { isChecked: Schema.Boolean },
  SelectedAccent: { value: Schema.String },
  GotAccentsMessage: { message: Listbox.Message },
  ClickedReset: {},
  ClosedDialog: {},
  ConfirmedReset: {},
})
export type Message = typeof Message.Type

const toAccentsMessage = (message: Listbox.Message) => Message.GotAccentsMessage({ message })

// UPDATE

export const emailError = (email: string): string | undefined =>
  email === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? undefined : 'That doesn’t look like an email address'

export const update = (model: Model, message: Message): Update.Return<Model, Message> =>
  Message.match<Update.Return<Model, Message>>(message, {
    ChangedName: ({ value }) => ({ model: modifyFields(model, { name: () => value }) }),
    ChangedEmail: ({ value }) => ({ model: modifyFields(model, { email: () => value }) }),
    ToggledDark: ({ isChecked }) => ({ model: modifyFields(model, { isDark: () => isChecked }) }),
    SelectedAccent: ({ value }) => {
      const index = ACCENTS.findIndex(item => item.value === value)
      return {
        model: modifyFields(model, {
          accent: () => value,
          accents: accents => (index === -1 ? accents : { ...accents, highlighted: index }),
        }),
      }
    },
    GotAccentsMessage: ({ message: child }) => {
      const next = Listbox.update(model.accents, child)
      return {
        model: modifyFields(model, { accents: () => next.model }),
        commands: Command.mapMessages(next.commands, toAccentsMessage),
      }
    },
    ClickedReset: () => ({ model: modifyFields(model, { isDialogOpen: () => true }) }),
    ClosedDialog: () => ({ model: modifyFields(model, { isDialogOpen: () => false }) }),
    ConfirmedReset: () => ({
      model: { ...initialModel, isDark: model.isDark, resets: model.resets + 1 },
    }),
  })

// VIEW

export const themeFor = (model: Model) => {
  const swatch = ACCENTS.find(item => item.value === model.accent)?.swatch ?? dusk['color.accent']
  return defineTheme(model.isDark ? dusk : paper, { 'color.accent': swatch, 'color.accent-hover': swatch, 'color.focus': swatch })
}

const section = (h: HtmlBuilder<Message>, title: string, children: ReadonlyArray<Html>) =>
  h.section([h.Class('section')], [h.h2([h.Class('section-title')], [title]), ...children])

export const view = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div([...part(h, 'root', undefined), h.Style(themeStyle(themeFor(model)))], [
    h.header([h.Class('header')], [
      h.h1([h.Class('title')], ['Preferences']),
      h.p([h.Class('subtitle')], [`FoldKit on gpuix · ${model.isDark ? 'dark' : 'light'} · ${model.accent}`]),
    ]),
    ScrollArea.view({ label: 'Preferences', fill: true }, [
      h.div([h.Class('page')], [
        section(h, 'Profile', [
          TextField.view({
            id: 'name', label: 'Name', value: model.name, placeholder: 'Ada Lovelace',
            onInput: value => Message.ChangedName({ value }),
          }, h),
          TextField.view({
            id: 'email', label: 'Email', value: model.email, placeholder: 'ada@example.com', type: 'email',
            onInput: value => Message.ChangedEmail({ value }),
            ...(emailError(model.email) === undefined ? { description: 'Only used to sign you in.' } : { error: emailError(model.email)! }),
          }, h),
        ]),
        section(h, 'Appearance', [
          Switch.view({
            id: 'dark', label: 'Dark theme', description: 'Switches every token live.', isChecked: model.isDark,
            onToggle: isChecked => Message.ToggledDark({ isChecked }),
          }, h),
          h.label([h.Class('list-label'), h.For('accent')], ['Accent colour']),
          Listbox.view({
            model: model.accents, label: 'Accent colour', items: ACCENTS, selected: model.accent, maxHeight: 168,
            onSelect: value => Message.SelectedAccent({ value }), toParentMessage: toAccentsMessage,
          }, h),
        ]),
        section(h, 'Danger zone', [
          h.p([h.Class('note')], [model.resets === 0 ? 'Nothing reset yet.' : `Reset ${model.resets} time${model.resets === 1 ? '' : 's'}.`]),
          h.div([h.Class('actions')], [button({ label: 'Reset profile…', onClick: Message.ClickedReset(), attributes: [h.Id('reset')] }, h)]),
        ]),
      ]),
    ], h),
    Dialog.view({
      id: 'confirm-reset',
      isOpen: model.isDialogOpen,
      title: 'Reset profile?',
      description: 'This clears your name, email and accent colour.',
      onClose: Message.ClosedDialog(),
      content: [
        h.div(part(h, 'dialog', 'actions'), [
          button({ label: 'Cancel', onClick: Message.ClosedDialog(), attributes: Dialog.initialFocus(h) }, h),
          button({ label: 'Reset', onClick: Message.ConfirmedReset(), variant: 'danger' }, h),
        ]),
      ],
    }, h),
  ])
