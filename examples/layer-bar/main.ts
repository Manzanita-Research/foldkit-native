// Layer bar: a thin bar along the top of the screen, as a desktop shell has.
// On Wayland it's a layer-shell surface with an exclusive zone (other
// windows keep clear of it); elsewhere a small window of the same shape.
// The window side is one options object, foldkit-gpuix's `bar()` (app.ts);
// this is only the app: a clock, a quiet toggle and a theme button, built
// from @foldkit-native/ui.
import { Duration, Effect, Schema, Stream } from 'effect'
import { Subscription, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'

import { Button, dusk, paper, part, themeStyle } from '@foldkit-native/ui'

// MODEL

export const Model = Schema.Struct({
  /** The time now, in ms since the epoch, from the clock Subscription. */
  now: Schema.Number,
  isQuiet: Schema.Boolean,
  theme: Schema.Literals(['dusk', 'paper']),
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  TickedClock: { now: Schema.Number },
  ToggledQuiet: {},
  SwitchedTheme: {},
})
export type Message = typeof Message.Type

export const init = (now: number) => (): Update.Return<Model, Message> => ({ model: { now, isQuiet: false, theme: 'dusk' } })

// UPDATE

export const update = (model: Model, message: Message): Update.Return<Model, Message> =>
  Message.match<Update.Return<Model, Message>>(message, {
    TickedClock: ({ now }) => ({ model: { ...model, now } }),
    ToggledQuiet: () => ({ model: { ...model, isQuiet: !model.isQuiet } }),
    SwitchedTheme: () => ({ model: { ...model, theme: model.theme === 'dusk' ? 'paper' : 'dusk' } }),
  })

// SUBSCRIPTION

/** The clock: the time every second. */
export const subscriptions = Subscription.make<Model, Message>()(() => ({
  clock: Subscription.persistent(
    Stream.tick(Duration.seconds(1)).pipe(Stream.mapEffect(() => Effect.sync(() => Message.TickedClock({ now: Date.now() })))),
  ),
}))

// VIEW

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const two = (value: number) => String(value).padStart(2, '0')
/** "Mon 14:05", in local time. */
export const clockText = (now: number) => {
  const date = new Date(now)
  return `${DAYS[date.getDay()]} ${two(date.getHours())}:${two(date.getMinutes())}`
}

export const view = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div([...part(h, 'root', undefined), h.Class('bar'), h.Style(themeStyle(model.theme === 'dusk' ? dusk : paper))], [
    h.div([h.Class('bar-start')], [h.span([h.Class('bar-name')], ['FoldKit'])]),
    h.div([h.Class('bar-middle')], [h.span([h.Id('clock'), h.Class('bar-clock'), h.AriaLive('polite')], [clockText(model.now)])]),
    h.div([h.Class('bar-end')], [
      Button.view({
        id: 'quiet', label: model.isQuiet ? 'Quiet on' : 'Quiet', onClick: Message.ToggledQuiet(),
        ...(model.isQuiet ? { variant: 'primary' as const } : {}),
        attributes: [h.AriaPressed(String(model.isQuiet))],
      }, h),
      Button.view({ id: 'theme', label: model.theme === 'dusk' ? 'Light' : 'Dark', onClick: Message.SwitchedTheme() }, h),
    ]),
  ])
