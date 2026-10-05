// TOAST
//
// Short notices that come and go in a corner of the window. A submodel like
// @foldkit/ui's Toast: its Model (the toasts showing, the region's hover and
// focus), Messages, update, and a Subscription the parent lifts
// (`Subscription.lift(Toast.subscriptions)`); the parent adds one with
// `Toast.show`.
//
// Behaviour, as @foldkit/ui's and Base UI's Toast:
// - A live region: the viewport is a `role="region"` landmark, and each toast
//   is `role="status"` (info, success: announced politely) or
//   `role="alert"` (warning, error: announced at once), `aria-atomic`.
// - Timed: each toast has a duration, and goes when it's used up. The clock
//   is a Subscription that ticks only while there are toasts and the region
//   isn't paused, so the update stays pure and a story can drive it.
// - Paused while the pointer is over the region or focus is in it: the time
//   left is kept and the clock goes on from there, so a toast someone's
//   reading or about to dismiss stays.
// - Stacked: newest nearest the corner, at most `limit` at once (showing one
//   more dismisses the oldest).
// - Keyboard: each toast's dismiss button is a tab stop; Escape in a toast
//   dismisses it, and focus moves to the next toast, if there is one.

import { Array as Arr, Duration, Effect, Option, Schema, Stream } from 'effect'
import { Command, Dom, Subscription, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { part } from './parts.ts'

// MODEL

export const Variant = Schema.Literals(['info', 'success', 'warning', 'error'])
export type Variant = typeof Variant.Type

export const Entry = Schema.Struct({
  id: Schema.String,
  variant: Variant,
  title: Schema.String,
  description: Schema.Option(Schema.String),
  /** Milliseconds left before it goes. */
  remaining: Schema.Number,
})
export type Entry = typeof Entry.Type

export const Model = Schema.Struct({
  id: Schema.String,
  entries: Schema.Array(Entry),
  nextKey: Schema.Number,
  /** How long a toast shows, in milliseconds, unless `show` says otherwise. */
  duration: Schema.Number,
  /** The most showing at once. */
  limit: Schema.Number,
  isHovered: Schema.Boolean,
  isFocused: Schema.Boolean,
})
export type Model = typeof Model.Type

export const DEFAULT_DURATION = 5000
export const DEFAULT_LIMIT = 3
/** How often the clock ticks while a toast is running. */
export const TICK_MS = 100

export const init = (config: { id: string; duration?: number; limit?: number }): Model => ({
  id: config.id,
  entries: [],
  nextKey: 0,
  duration: config.duration ?? DEFAULT_DURATION,
  limit: config.limit ?? DEFAULT_LIMIT,
  isHovered: false,
  isFocused: false,
})

export const entryId = (id: string, key: number) => `${id}-${key}`
export const titleId = (entry: string) => `${entry}-title`
export const dismissId = (entry: string) => `${entry}-dismiss`
/** The role a variant is announced with: politely, or at once. */
export const roleOf = (variant: Variant) => (variant === 'warning' || variant === 'error' ? 'alert' : 'status')

/** Whether the clock is running: toasts showing, and the region not paused. */
export const isRunning = (model: Model) => model.entries.length > 0 && !model.isHovered && !model.isFocused

// MESSAGE

export const Message = defineMessageUnion({
  /** The clock, from the Subscription: `ms` went by. */
  Ticked: { ms: Schema.Number },
  /** Its dismiss button, or Escape in it; `refocus` moves focus to the next toast. */
  Dismissed: { entryId: Schema.String, refocus: Schema.Boolean },
  HoveredRegion: {},
  LeftRegion: {},
  FocusedRegion: {},
  BlurredRegion: {},
  CompletedFocus: {},
})
export type Message = typeof Message.Type

// COMMAND

/** Focus to another toast's dismiss button, after the dismissed one goes. */
export const FocusDismiss = Command.define('ToastFocusDismiss', {
  args: { entryId: Schema.String },
  messages: [Message.CompletedFocus],
  execute: ({ entryId }) => Dom.focus(`#${dismissId(entryId)}`).pipe(Effect.ignore, Effect.as(Message.CompletedFocus())),
})

// SUBSCRIPTION

/** The clock: a tick every TICK_MS while `isRunning`. Lift it into the
 *  parent's subscriptions. */
export const subscriptions = Subscription.make<Model, Message>()(entry => ({
  clock: entry({ isRunning: Schema.Boolean }, {
    modelToDependencies: model => ({ isRunning: isRunning(model) }),
    dependenciesToStream: ({ isRunning }) =>
      Stream.when(
        // Stream.tick's first tick is at once: the time starts after it.
        Stream.tick(Duration.millis(TICK_MS)).pipe(Stream.drop(1), Stream.map(() => Message.Ticked({ ms: TICK_MS }))),
        Effect.sync(() => isRunning),
      ),
  }),
}))

// UPDATE

export type ShowConfig = Readonly<{ title: string; description?: string; variant?: Variant; duration?: number }>

/** Adds a toast: the parent's update calls it. Past the limit, the oldest goes. */
export const show = (model: Model, config: ShowConfig): Update.Return<Model, Message> => {
  const added: Entry = {
    id: entryId(model.id, model.nextKey),
    variant: config.variant ?? 'info',
    title: config.title,
    description: Option.fromNullishOr(config.description),
    remaining: config.duration ?? model.duration,
  }
  return {
    model: modifyFields(model, {
      entries: entries => [...entries, added].slice(-model.limit),
      nextKey: key => key + 1,
    }),
  }
}

const dismiss = (model: Model, id: string, refocus: boolean): Update.Return<Model, Message> => {
  const at = model.entries.findIndex(entry => entry.id === id)
  if (at === -1) return { model }
  const entries = model.entries.filter(entry => entry.id !== id)
  // The one that took its place nearest the corner, else the one before it.
  const next = entries[Math.min(at, entries.length - 1)]
  return {
    // With none left, focus is no longer in the region (its button went).
    model: modifyFields(model, { entries: () => entries, isFocused: focused => focused && entries.length > 0 }),
    commands: refocus && next !== undefined ? [FocusDismiss({ entryId: next.id })] : [],
  }
}

export const update = (model: Model, message: Message): Update.Return<Model, Message> =>
  Message.match<Update.Return<Model, Message>>(message, {
    Ticked: ({ ms }) => {
      if (!isRunning(model)) return { model }
      const entries = model.entries.map(entry => ({ ...entry, remaining: entry.remaining - ms }))
      return { model: modifyFields(model, { entries: () => entries.filter(entry => entry.remaining > 0) }) }
    },
    Dismissed: ({ entryId, refocus }) => dismiss(model, entryId, refocus),
    HoveredRegion: () => ({ model: modifyFields(model, { isHovered: () => true }) }),
    LeftRegion: () => ({ model: modifyFields(model, { isHovered: () => false }) }),
    FocusedRegion: () => ({ model: modifyFields(model, { isFocused: () => true }) }),
    BlurredRegion: () => ({ model: modifyFields(model, { isFocused: () => false }) }),
    CompletedFocus: () => ({ model }),
  })

/** Dismisses every toast (the parent's "clear all"). */
export const dismissAll = (model: Model): Update.Return<Model, Message> => ({
  model: modifyFields(model, { entries: () => [], isFocused: () => false }),
})

// VIEW

export type ViewConfig<ParentMessage> = Readonly<{
  model: Model
  toParentMessage: (message: Message) => ParentMessage
  /** The region's name, for assistive technology. */
  label?: string
}>

export const view = <ParentMessage>(config: ViewConfig<ParentMessage>, h: HtmlBuilder<ParentMessage>): Html => {
  const { model, toParentMessage: up } = config
  const toast = (entry: Entry) => {
    const state = { variant: entry.variant }
    return h.div([
      ...part(h, 'toast', 'toast', state),
      h.Id(entry.id),
      h.Role(roleOf(entry.variant)),
      h.AriaAtomic(true),
      h.AriaLabelledBy(titleId(entry.id)),
      h.OnKeyDownPreventDefault(key => (key === 'Escape' ? Option.some(up(Message.Dismissed({ entryId: entry.id, refocus: true }))) : Option.none())),
    ], [
      h.span([...part(h, 'toast', 'indicator', state), h.AriaHidden(true)], []),
      h.div(part(h, 'toast', 'text'), [
        h.p([...part(h, 'toast', 'title', state), h.Id(titleId(entry.id))], [entry.title]),
        ...Option.match(entry.description, {
          onNone: () => [],
          onSome: description => [h.p(part(h, 'toast', 'description'), [description])],
        }),
      ]),
      h.button([
        ...part(h, 'toast', 'dismiss'),
        h.Type('button'),
        h.Id(dismissId(entry.id)),
        h.AriaLabel(`Dismiss: ${entry.title}`),
        h.OnClick(up(Message.Dismissed({ entryId: entry.id, refocus: true }))),
      ], ['✕']),
    ])
  }
  return h.div([
    ...part(h, 'toast', 'viewport', { paused: !isRunning(model) && model.entries.length > 0 }),
    h.Id(model.id),
    h.Role('region'),
    h.AriaLabel(config.label ?? 'Notifications'),
    h.OnMouseEnter(up(Message.HoveredRegion())),
    h.OnMouseLeave(up(Message.LeftRegion())),
    h.OnFocusEnter(up(Message.FocusedRegion())),
    h.OnFocusLeave(up(Message.BlurredRegion())),
  ], Arr.map(model.entries, toast))
}
