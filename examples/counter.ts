// An ordinary FoldKit counter, drawn natively. Only the first import is new.
import { native } from './counter-native.ts'

import { Schema } from 'effect'
import { Runtime } from 'foldkit'
import type { HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'

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

Runtime.run(Runtime.makeElement({ Model, init: () => ({ model: { count: 0 } }), update, view, container: native.container }))
