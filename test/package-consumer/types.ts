import { attachDom, mountNative, token, type NativeOptions } from 'foldkit-native'
import { stack, primitivesCss } from 'foldkit-native/primitives'
import { tokensToCss, type Tokens } from 'foldkit-native/theme'
import { px, nativeDefaultsCss } from 'foldkit-native/style'
import { mountGpuix, attachGpuix, sheetFromCss, NativeDocument, type WindowRenderer } from 'foldkit-gpuix'
import { Button, Listbox, paper, uiCss, type Theme } from '@foldkit-native/ui'
import { Schema } from 'effect'
import { Runtime } from 'foldkit'
import type { HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'

const tokens: Tokens = { 'space.3': 12 }
const theme: Theme = paper
const options: NativeOptions = { title: 'Consumer', css: nativeDefaultsCss + primitivesCss, tokens }
const Message = defineMessageUnion({ Incremented: {} })
type Message = typeof Message.Type
const Model = Schema.Struct({ count: Schema.Number })
const view = (model: typeof Model.Type, h: HtmlBuilder<Message>) =>
  stack({ part: 'counter' }, [Button.view({ label: String(model.count), onClick: Message.Incremented() }, h)], h)
const rendererType = (renderer: WindowRenderer) => attachGpuix(renderer, { tokens: theme, css: uiCss })
const app = mountGpuix({ title: 'Consumer', css: uiCss, tokens: theme, exitOnClose: false })
app.own(Runtime.embed(Runtime.makeElement({
  Model, init: () => ({ model: { count: 0 } }),
  update: model => ({ model: { count: model.count + 1 } }), view, container: app.container,
})))
const listbox: Listbox.Model = Listbox.init({ id: 'items' })
void [attachDom, mountNative, options, token('space.3'), tokensToCss(tokens), px('12px'),
  sheetFromCss(uiCss), NativeDocument, rendererType, listbox]
// Ensure declarations constrain application use, rather than resolving to any.
// @ts-expect-error CSS values must be strings or numbers.
const invalid: Tokens = { 'space.3': false }
// @ts-expect-error Buttons require a visible label.
Button.view({}, {} as HtmlBuilder<Message>)
void invalid
