// Apps for the overlay components (Popover, Toast) and VirtualList: each in
// an ordinary Model, Message and update, the way an app uses it. (The other
// components' apps are in apps.ts; the runner gives every app its theme.)
import { Option, Schema } from 'effect'
import { Command, Subscription, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'

import { Button, Checkbox, Popover, Toast, VirtualList, part } from '../src/index.ts'

const root = <Message>(h: HtmlBuilder<Message>, children: ReadonlyArray<Html>) =>
  h.div(part(h, 'root', undefined), [h.div([h.Style({ padding: '16px', display: 'flex', 'flex-direction': 'column', gap: '12px' })], children)])

// POPOVER
// Share is non-modal and focuses its link field when it opens; Filters is
// modal (Tab stays in, the page is inert, its scroll locked).
export const Sharing = (() => {
  const Model = Schema.Struct({ share: Popover.Model, filters: Popover.Model, copied: Schema.Number, onlyOpen: Schema.Boolean })
  const Message = defineMessageUnion({
    GotShareMessage: { message: Popover.Message },
    GotFiltersMessage: { message: Popover.Message },
    Copied: {},
    ToggledOnlyOpen: { isChecked: Schema.Boolean },
    AppliedFilters: {},
  })
  type Model = typeof Model.Type
  type Message = typeof Message.Type
  const toShare = (message: Popover.Message) => Message.GotShareMessage({ message })
  const toFilters = (message: Popover.Message) => Message.GotFiltersMessage({ message })
  const init: Model = {
    share: Popover.init({ id: 'share', initialFocus: 'share-copy' }),
    filters: Popover.init({ id: 'filters', isModal: true }),
    copied: 0,
    onlyOpen: false,
  }
  const step = (next: Update.Return<Popover.Model, Popover.Message>, to: (message: Popover.Message) => Message) => ({
    model: next.model, commands: Command.mapMessages(next.commands ?? [], to),
  })
  const update = (model: Model, message: Message): Update.Return<Model, Message> =>
    Message.match<Update.Return<Model, Message>>(message, {
      GotShareMessage: ({ message: child }) => {
        const next = step(Popover.update(model.share, child), toShare)
        return { model: { ...model, share: next.model }, commands: next.commands }
      },
      GotFiltersMessage: ({ message: child }) => {
        const next = step(Popover.update(model.filters, child), toFilters)
        return { model: { ...model, filters: next.model }, commands: next.commands }
      },
      Copied: () => {
        const next = step(Popover.close(model.share), toShare)
        return { model: { ...model, share: next.model, copied: model.copied + 1 }, commands: next.commands }
      },
      ToggledOnlyOpen: ({ isChecked }) => ({ model: { ...model, onlyOpen: isChecked } }),
      AppliedFilters: () => {
        const next = step(Popover.close(model.filters), toFilters)
        return { model: { ...model, filters: next.model }, commands: next.commands }
      },
    })
  const view = (model: Model, h: HtmlBuilder<Message>) => root(h, [
    h.div([h.Style({ display: 'flex', 'flex-direction': 'row', gap: '12px', 'align-items': 'flex-start' })], [
      Button.view({ label: 'Before', id: 'before' }, h),
      Popover.view({
        model: model.share, label: 'Share', title: 'Share link', description: 'Anyone with the link can view this board.',
        toParentMessage: toShare,
        content: [
          h.p([h.Id('share-url'), h.Style({ 'font-size': '13px' })], ['foldkit.dev/b/7f3a']),
          h.div(part(h, 'popover', 'actions'), [
            Button.view({ label: 'Copy link', id: 'share-copy', variant: 'primary', onClick: Message.Copied() }, h),
          ]),
        ],
      }, h),
      Popover.view({
        model: model.filters, label: 'Filters', title: 'Filters', toParentMessage: toFilters,
        content: [
          Checkbox.view({ id: 'only-open', label: 'Only open issues', isChecked: model.onlyOpen, onToggle: isChecked => Message.ToggledOnlyOpen({ isChecked }) }, h),
          h.div(part(h, 'popover', 'actions'), [
            Button.view({ label: 'Apply', id: 'filters-apply', variant: 'primary', onClick: Message.AppliedFilters() }, h),
          ]),
        ],
      }, h),
    ]),
    h.input([h.Id('after'), h.Placeholder('After')]),
    h.p([h.Id('status')], [`Copied ${model.copied} times${model.onlyOpen ? ', open issues only' : ''}`]),
  ])
  return { Model, Message, init, update, view }
})()

// TOAST
// Each button shows one variant; the clock is the Toast's Subscription,
// lifted into the app's.
const notices = (duration: number) => {
  const Model = Schema.Struct({ toasts: Toast.Model })
  const Message = defineMessageUnion({
    Showed: { variant: Toast.Variant },
    GotToastMessage: { message: Toast.Message },
  })
  type Model = typeof Model.Type
  type Message = typeof Message.Type
  const toToast = (message: Toast.Message) => Message.GotToastMessage({ message })
  const init: Model = { toasts: Toast.init({ id: 'toasts', duration }) }
  const NOTICES: Readonly<Record<Toast.Variant, Toast.ShowConfig>> = {
    info: { title: 'Syncing', description: 'Your board is up to date in a moment.' },
    success: { title: 'Saved', description: '3 files written.' },
    warning: { title: 'Disk nearly full', description: '1.2 GB left.' },
    error: { title: 'Couldn’t publish', description: 'The server said no. Try again?' },
  }
  const update = (model: Model, message: Message): Update.Return<Model, Message> => {
    const next = message._tag === 'Showed'
      ? Toast.show(model.toasts, { ...NOTICES[message.variant], variant: message.variant })
      : Toast.update(model.toasts, message.message)
    return { model: { toasts: next.model }, commands: Command.mapMessages(next.commands ?? [], toToast) }
  }
  const view = (model: Model, h: HtmlBuilder<Message>) => root(h, [
    h.div([h.Style({ display: 'flex', 'flex-direction': 'row', gap: '8px', 'flex-wrap': 'wrap' })],
      (['info', 'success', 'warning', 'error'] as const).map(variant =>
        Button.view({ label: `Show ${variant}`, id: `show-${variant}`, onClick: Message.Showed({ variant }) }, h))),
    h.input([h.Id('field'), h.Placeholder('Somewhere else')]),
    Toast.view({ model: model.toasts, toParentMessage: toToast }, h),
  ])
  const subscriptions = Subscription.lift(Toast.subscriptions)<Model, Message>({
    toChildModel: model => model.toasts,
    toParentMessage: toToast,
  })
  return { Model, Message, init, update, view, subscriptions }
}
export const Notices = notices(4000)
/** Toasts that go in 300 ms, for the clock's tests. */
export const QuickNotices = notices(300)

// VIRTUAL LIST
// Ten thousand tracks; the chosen one shows under the list.
export const TRACK_COUNT = 10_000
const tracks = (shape: { rowHeight: number; height: number }) => {
  const Model = Schema.Struct({ list: VirtualList.Model, picked: Schema.Option(Schema.Number) })
  const Message = defineMessageUnion({ GotListMessage: { message: VirtualList.Message } })
  type Model = typeof Model.Type
  type Message = typeof Message.Type
  const toList = (message: VirtualList.Message) => Message.GotListMessage({ message })
  const init: Model = { list: VirtualList.init({ id: 'tracks' }), picked: Option.none() }
  const update = (model: Model, message: Message): Update.Return<Model, Message> => {
    const next = VirtualList.update(model.list, message.message)
    const picked = VirtualList.chosen(message.message)
    return {
      model: { list: next.model, picked: Option.isSome(picked) ? picked : model.picked },
      commands: Command.mapMessages(next.commands ?? [], toList),
    }
  }
  const minutes = (index: number) => `${2 + (index * 7) % 5}:${String((index * 37) % 60).padStart(2, '0')}`
  const view = (model: Model, h: HtmlBuilder<Message>) => root(h, [
    Button.view({ label: 'Before', id: 'before' }, h),
    VirtualList.view({
      model: model.list, label: 'Tracks', count: TRACK_COUNT, ...shape,
      selected: Option.getOrUndefined(model.picked),
      row: index => [
        h.span([h.Style({ width: '48px', 'flex-shrink': '0' }), h.AriaHidden(true)], [String(index + 1)]),
        h.span([h.Style({ 'flex-grow': '1' })], [`Track ${index + 1}`]),
        h.span([h.AriaHidden(true)], [minutes(index)]),
      ],
      toParentMessage: toList,
    }, h),
    h.p([h.Id('picked')], [Option.match(model.picked, { onNone: () => 'Nothing picked', onSome: index => `Picked: Track ${index + 1}` })]),
  ])
  return { Model, Message, init, update, view }
}
export const Tracks = tracks({ rowHeight: 32, height: 200 })
/** Big List's shape (44 px rows, its 538 px list), to compare the two. */
export const BigTracks = tracks({ rowHeight: 44, height: 538 })
