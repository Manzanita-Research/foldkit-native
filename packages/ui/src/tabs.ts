// TABS
//
// A row (or column) of tabs over one panel. A submodel, with @foldkit/ui's
// Tabs' Model, Messages, OutMessage and update (`SelectedTab`, `FocusedTab`,
// `FocusTab`, `Selected`, `activationMode`), so swapping one for the other is
// an import and a view. The selected tab stays in the parent's Model: it
// comes in as `selectedValue` and goes out as the `Selected` OutMessage.
//
// Behaviour, as WAI-ARIA's tabs and @foldkit/ui's: the tab list is one tab
// stop (a roving tabindex), and Tab from it goes to the panel. The arrow
// keys along its orientation move to the next or previous enabled tab,
// wrapping; Home and End jump. `Automatic` activation selects the tab the
// arrows reach; `Manual` only focuses it, and Enter or Space selects. Each
// tab is a `<button role="tab">`, so Enter and Space (on its release) are
// the platform's own activation. A disabled tab is `aria-disabled`: the
// arrows skip it and a click does nothing.
//
// Moving focus is FoldKit's own `Dom.focus`, a Command, which runs on the
// native document as on the web.

import { Array, Effect, Option, Schema, pipe } from 'effect'
import { Command, Dom, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { keyToIndex } from './keyboard.ts'
import { part } from './parts.ts'

// MODEL

export const Orientation = Schema.Literals(['Horizontal', 'Vertical'])
export type Orientation = typeof Orientation.Type

/** `Automatic`: a tab is selected as the arrows reach it. `Manual`: the
 *  arrows move focus, and Enter or Space selects. */
export const ActivationMode = Schema.Literals(['Automatic', 'Manual'])
export type ActivationMode = typeof ActivationMode.Type

/** Which tab has focus, when it isn't the selected one (`None`). */
export const Model = Schema.Struct({
  id: Schema.String,
  maybeFocusedIndex: Schema.Option(Schema.Number),
  activationMode: ActivationMode,
})
export type Model = typeof Model.Type

export const init = (config: { id: string; activationMode?: ActivationMode }): Model => ({
  id: config.id,
  maybeFocusedIndex: Option.none(),
  activationMode: config.activationMode ?? 'Automatic',
})

// MESSAGE

export const Message = defineMessageUnion({
  SelectedTab: { index: Schema.Number, value: Schema.String },
  FocusedTab: { index: Schema.Number },
  CompletedFocusTab: {},
})
export type Message = typeof Message.Type

/** The parent's cue: a tab was selected. */
export const OutMessage = defineMessageUnion({
  Selected: { value: Schema.String, index: Schema.Number },
})
export type OutMessage = typeof OutMessage.Type

export const tabId = (id: string, index: number) => `${id}-tab-${index}`
export const panelId = (id: string, index: number) => `${id}-panel-${index}`

// COMMAND

/** Focuses a tab, once the render that made it the tab stop is in. */
export const FocusTab = Command.define('FocusTab', {
  args: { id: Schema.String, index: Schema.Number },
  messages: [Message.CompletedFocusTab],
  execute: ({ id, index }) =>
    Dom.focus(`#${tabId(id, index)}`).pipe(Effect.ignore, Effect.as(Message.CompletedFocusTab())),
})

// UPDATE

export const update = (model: Model, message: Message): Update.ReturnWithOutMessage<Model, Message, OutMessage> =>
  Message.match<Update.ReturnWithOutMessage<Model, Message, OutMessage>>(message, {
    SelectedTab: ({ index, value }) => ({
      model: modifyFields(model, { maybeFocusedIndex: () => Option.none() }),
      commands: [FocusTab({ id: model.id, index })],
      outMessage: OutMessage.Selected({ value, index }),
    }),
    FocusedTab: ({ index }) => ({
      model: modifyFields(model, { maybeFocusedIndex: () => Option.some(index) }),
      commands: [FocusTab({ id: model.id, index })],
    }),
    CompletedFocusTab: () => ({ model }),
  })

// VIEW

/** Draw only the selected tab's panel, or every panel with the rest hidden
 *  (to keep their state, a scroll position or a half-typed field). */
export const PanelMount = Schema.Literals(['ActiveOnly', 'All'])
export type PanelMount = typeof PanelMount.Type

export type ViewConfig<ParentMessage, Value extends string = string> = Readonly<{
  model: Model
  tabs: ReadonlyArray<Value>
  selectedValue: Value
  ariaLabel: string
  toParentMessage: (message: Message) => ParentMessage
  /** A panel's content. */
  panel: (value: Value, index: number) => ReadonlyArray<Html>
  /** The label a tab shows (its value, by default). */
  tabLabel?: (value: Value, index: number) => string
  isTabDisabled?: (value: Value, index: number) => boolean
  orientation?: Orientation
  panelMount?: PanelMount
}>

export const view = <ParentMessage, Value extends string = string>(
  config: ViewConfig<ParentMessage, Value>,
  h: HtmlBuilder<ParentMessage>,
): Html => {
  const { model, tabs, selectedValue, toParentMessage: up, orientation = 'Horizontal', panelMount = 'ActiveOnly' } = config
  const { id } = model
  const isDisabled = (index: number) => config.isTabDisabled?.(tabs[index]!, index) ?? false
  const activeIndex = pipe(Array.findFirstIndex(tabs, tab => tab === selectedValue), Option.getOrElse(() => 0))
  const focusedIndex = pipe(model.maybeFocusedIndex, Option.filter(index => index < tabs.length), Option.getOrElse(() => activeIndex))
  const [nextKey, previousKey] = orientation === 'Horizontal' ? ['ArrowRight', 'ArrowLeft'] : ['ArrowDown', 'ArrowUp']
  const toIndex = keyToIndex(nextKey, previousKey, tabs.length, focusedIndex, isDisabled)
  const moves = new Set([nextKey, previousKey, 'Home', 'End', 'PageUp', 'PageDown'])
  const onKey = (key: string): Option.Option<ParentMessage> => {
    if (!moves.has(key)) return Option.none()
    const index = toIndex(key)
    return Option.some(up(model.activationMode === 'Automatic'
      ? Message.SelectedTab({ index, value: tabs[index]! })
      : Message.FocusedTab({ index })))
  }
  const direction = orientation === 'Horizontal' ? 'horizontal' : 'vertical'
  const panels = tabs.flatMap((value, index) => {
    const isActive = index === activeIndex
    if (!isActive && panelMount === 'ActiveOnly') return []
    return [h.div([
      ...part(h, 'tabs', 'panel', { selected: isActive, orientation: direction }),
      h.Id(panelId(id, index)),
      h.Role('tabpanel'),
      h.AriaLabelledBy(tabId(id, index)),
      h.Tabindex(isActive ? 0 : -1),
      ...(isActive ? [] : [h.Hidden(true)]),
    ], [...config.panel(value, index)])]
  })
  return h.div(part(h, 'tabs', undefined, { orientation: direction }), [
    h.div([
      ...part(h, 'tabs', 'list', { orientation: direction }),
      h.Role('tablist'),
      h.AriaOrientation(direction),
      h.AriaLabel(config.ariaLabel),
    ], tabs.map((value, index) => {
      const isActive = index === activeIndex
      const disabled = isDisabled(index)
      return h.button([
        ...part(h, 'tabs', 'tab', { selected: isActive, disabled, orientation: direction }),
        h.Id(tabId(id, index)),
        h.Type('button'),
        h.Role('tab'),
        h.AriaSelected(isActive),
        ...(isActive || panelMount === 'All' ? [h.AriaControls(panelId(id, index))] : []),
        h.Tabindex(index === focusedIndex ? 0 : -1),
        ...(disabled ? [h.AriaDisabled(true)] : [h.OnClick(up(Message.SelectedTab({ index, value })))]),
        h.OnKeyDownPreventDefault(onKey),
      ], [config.tabLabel?.(value, index) ?? value])
    })),
    ...panels,
  ])
}
