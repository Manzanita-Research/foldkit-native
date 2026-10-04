// The gallery: a FoldKit app (drawn by FoldKit Native, like the rest) that
// lists the examples and opens one in its own window when clicked.
import { Effect, Option, Schema } from 'effect'
import { Command, Runtime, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'

// MODEL

export const Entry = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  blurb: Schema.String,
  foldkit: Schema.String,
  gpui: Schema.String,
  ported: Schema.Boolean,
  command: Schema.Array(Schema.String),
})
export type Entry = typeof Entry.Type

export const Model = Schema.Struct({
  entries: Schema.Array(Entry),
  /** The example opened last, for the status line. */
  opened: Schema.Option(Schema.String),
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  ClickedEntry: { id: Schema.String },
  OpenedExample: { id: Schema.String },
})
export type Message = typeof Message.Type

// COMMAND

/** Starts the example as its own process, in its own window. */
export const OpenExample = Command.define('OpenExample', {
  args: { id: Schema.String, command: Schema.Array(Schema.String) },
  messages: [Message.OpenedExample],
  execute: ({ id, command }) =>
    Effect.sync(() => {
      launch([...command])
      return Message.OpenedExample({ id })
    }),
})

/** How a command is run; the entry point sets it (tests never do). */
let launch: (command: Array<string>) => void = () => {}
export const setLauncher = (run: (command: Array<string>) => void) => {
  launch = run
}

// UPDATE

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    ClickedEntry: ({ id }) => {
      const entry = model.entries.find(candidate => candidate.id === id)
      return entry === undefined
        ? { model }
        : { model, commands: [OpenExample({ id, command: entry.command })] }
    },
    OpenedExample: ({ id }) => ({ model: { ...model, opened: Option.some(id) } }),
  })

// INIT

export const init = (entries: ReadonlyArray<Entry>): Runtime.ElementInit<Model, Message> => () => ({
  model: { entries, opened: Option.none() },
})

// VIEW

const card = (entry: Entry, h: HtmlBuilder<Message>): Html =>
  h.button(
    [h.Class('card'), h.OnClick(Message.ClickedEntry({ id: entry.id })), h.AriaLabel(`Open ${entry.title}`)],
    [
      h.div([h.Class('card-head')], [
        h.span([h.Class('card-title')], [entry.title]),
        h.span([h.Class(entry.ported ? 'badge' : 'badge native')], [entry.ported ? 'FoldKit example' : 'FoldKit Native']),
      ]),
      h.p([h.Class('card-blurb')], [entry.blurb]),
      h.div([h.Class('shows')], [
        h.span([h.Class('shows-label')], ['FoldKit']),
        h.span([h.Class('shows-text')], [entry.foldkit]),
      ]),
      h.div([h.Class('shows')], [
        h.span([h.Class('shows-label gpui')], ['GPUI']),
        h.span([h.Class('shows-text')], [entry.gpui]),
      ]),
    ],
  )

export const view = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div([h.Class('gallery')], [
    h.header([h.Class('header')], [
      h.h1([h.Class('title')], ['FoldKit Native']),
      h.p([h.Class('subtitle')], ['FoldKit apps, drawn by GPUI. Click one to open it in its own window.']),
    ]),
    h.div([h.Class('scroll')], [h.div([h.Class('grid')], model.entries.map(entry => card(entry, h)))]),
    h.p([h.Class('status')], [
      Option.match(model.opened, {
        onNone: () => `${model.entries.length} examples`,
        onSome: id => `Opened ${model.entries.find(entry => entry.id === id)?.title ?? id}.`,
      }),
    ]),
  ])
