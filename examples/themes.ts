// Runtime theme switching with the primitives. The app's CSS refers only to
// semantic tokens and parts/states; the two token sets below are example
// values, not themes this package ships. Click "switch theme": the native tree
// is restyled on the next frame, with no restart.
import { mountNative } from '../src/index.ts'
import type { Tokens } from '../src/theme.ts'

const dusk: Tokens = {
  'color.canvas': '#17151c', 'color.surface': '#24212b', 'color.surface-raised': '#2f2b38',
  'color.text': '#f3eef8', 'color.text-muted': '#a9a2b4', 'color.accent': '#ff78e1', 'color.accent-text': '#17151c',
  'color.hairline': '#ffffff1f', 'radius.2': 10, 'radius.3': 16, 'space.2': 8, 'space.3': 12, 'space.5': 24,
  'type.size.body': 16, 'type.size.title': 32, 'elevation.2': '0px 10px 30px 0px #00000080',
}
const paper: Tokens = {
  'color.canvas': '#f4f1ea', 'color.surface': '#ffffff', 'color.surface-raised': '#fbf8f2',
  'color.text': '#1f1b16', 'color.text-muted': '#6b6359', 'color.accent': '#2f5d50', 'color.accent-text': '#ffffff',
  'color.hairline': '#1f1b161f', 'radius.2': 4, 'radius.3': 6, 'space.2': 6, 'space.3': 10, 'space.5': 20,
  'type.size.body': 15, 'type.size.title': 28, 'elevation.2': '0px 2px 6px 0px #1f1b1626',
}

const css = `
  body { margin: 0; height: 100%; background-color: var(--fn-color-canvas); }
  [data-part="app"] { height: 100%; padding: var(--fn-space-5); background-color: var(--fn-color-canvas); }
  [data-part="title"] { margin: 0; font-size: var(--fn-type-size-title); color: var(--fn-color-text); }
  [data-part="card"] { padding: var(--fn-space-3); border-radius: var(--fn-radius-3); border: 1px solid var(--fn-color-hairline);
                       background-color: var(--fn-color-surface); box-shadow: var(--fn-elevation-2); }
  [data-part="item"] { padding: var(--fn-space-2) var(--fn-space-3); border-radius: var(--fn-radius-2); cursor: pointer; }
  [data-part="item"]:hover { background-color: var(--fn-color-surface-raised); }
  [data-part="item"][data-selected] { background-color: var(--fn-color-accent); }
  [data-part="item-label"] { font-size: var(--fn-type-size-body); color: var(--fn-color-text); }
  [data-selected] [data-part="item-label"] { color: var(--fn-color-accent-text); }
  [data-part="switch"] { padding: var(--fn-space-2) var(--fn-space-3); border-radius: var(--fn-radius-2); cursor: pointer;
                         border: 1px solid var(--fn-color-hairline); }
  [data-part="switch"]:active { background-color: var(--fn-color-surface-raised); }
  [data-part="switch-label"] { font-size: var(--fn-type-size-body); color: var(--fn-color-text-muted); }
`

const native = mountNative({ title: 'FoldKit Native: themes', width: 640, height: 480, appId: 'foldkit-native-themes', css, tokens: process.env['THEME'] === 'paper' ? paper : dusk })

const { Schema } = await import('effect')
const { Runtime } = await import('foldkit')
const { defineMessageUnion } = await import('foldkit/message')
const Command = await import('foldkit/command')
const { Effect } = await import('effect')
const { stack, row, text, box } = await import('../src/primitives.ts')

const Model = Schema.Struct({ selected: Schema.Number, theme: Schema.Literals(['dusk', 'paper']) })
type Model = typeof Model.Type
const Message = defineMessageUnion({ ClickedItem: { index: Schema.Number }, ClickedSwitch: {}, AppliedTheme: {} })
type Message = typeof Message.Type

const ApplyTheme = Command.define('ApplyTheme', {
  args: { theme: Schema.Literals(['dusk', 'paper']) },
  messages: [Message.AppliedTheme],
  execute: ({ theme }) => Effect.sync(() => native.setTokens(theme === 'dusk' ? dusk : paper)).pipe(Effect.as(Message.AppliedTheme())),
})

const ITEMS = ['Inbox', 'Projects', 'Threads', 'Settings']

Runtime.run(Runtime.makeElement({
  Model,
  init: () => ({ model: { selected: 0, theme: process.env['THEME'] === 'paper' ? 'paper' as const : 'dusk' as const } }),
  update: (model: Model, message: Message) =>
    Message.match(message, {
      ClickedItem: ({ index }) => ({ model: { ...model, selected: index } }),
      ClickedSwitch: () => {
        const theme = model.theme === 'dusk' ? 'paper' as const : 'dusk' as const
        return { model: { ...model, theme }, commands: [ApplyTheme({ theme })] }
      },
      AppliedTheme: () => ({ model }),
    }),
  view: (model: Model, h: any) =>
    stack({ part: 'app', gap: 'space.5' }, [
      row({ part: 'header', justify: 'between', align: 'center' }, [
        text({ part: 'title', as: 'h1' }, 'Themes', h),
        box({ part: 'switch', attributes: [h.OnClick(Message.ClickedSwitch())] }, [
          text({ part: 'switch-label' }, `switch theme (${model.theme})`, h),
        ], h),
      ], h),
      stack({ part: 'card', gap: 'space.2' }, ITEMS.map((label, index) =>
        box({ part: 'item', state: { selected: index === model.selected }, attributes: [h.OnClick(Message.ClickedItem({ index }))] }, [
          text({ part: 'item-label' }, label, h),
        ], h),
      ), h),
    ], h),
  container: native.container,
}))
