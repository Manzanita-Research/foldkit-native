// The smallest FoldKit app on gpuix, for scripts/nightly.ts: a count and two
// buttons. Run it with `bun bench/counter.ts`.
import { Schema } from 'effect'
import { Runtime } from 'foldkit'
import type { HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { mountGpuix } from 'foldkit-gpuix'

const Model = Schema.Struct({ count: Schema.Number })
type Model = typeof Model.Type
const Message = defineMessageUnion({ ClickedIncrement: {}, ClickedReset: {} })
type Message = typeof Message.Type

const update = (model: Model, message: Message) =>
  Message.match(message, {
    ClickedIncrement: () => ({ model: { count: model.count + 1 } }),
    ClickedReset: () => ({ model: { count: 0 } }),
  })

const view = (model: Model, h: HtmlBuilder<Message>) =>
  h.div([h.Class('app')], [
    h.h1([h.Class('title')], ['FoldKit Native']),
    h.p([h.Class('count')], [`Count: ${model.count}`]),
    h.div([h.Class('row')], [
      h.button([h.Class('button'), h.OnClick(Message.ClickedIncrement())], ['+1']),
      h.button([h.Class('button ghost'), h.OnClick(Message.ClickedReset())], ['Reset']),
    ]),
  ])

const css = `
  body { margin: 0; height: 100%; background-color: #1d1d21; font-family: system-ui, sans-serif; }
  .app { display: flex; flex-direction: column; gap: 16px; padding: 40px; height: 100%; }
  .title { margin: 0; font-size: 40px; color: #f2f2f2; }
  .count { margin: 0; font-size: 22px; color: #c9c9d1; }
  .row { display: flex; flex-direction: row; gap: 12px; }
  .button { padding: 10px 18px; border-radius: 10px; background-color: #3b82f6; color: #ffffff;
            font-size: 16px; cursor: pointer; border-width: 0; }
  .button:hover { background-color: #2563eb; }
  .ghost { background-color: transparent; color: #f2f2f2; border: 1px solid #ffffff33; }
`

const app = mountGpuix({ title: 'Counter', appId: 'dev.foldkit-native.bench-counter', width: 720, height: 420, css })
app.own(Runtime.embed(Runtime.makeElement({ Model, init: () => ({ model: { count: 0 } }), update, view, container: app.container })))
