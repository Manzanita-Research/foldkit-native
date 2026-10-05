// RADIO GROUP
//
// Pick one of a few options, all in view. A submodel, with @foldkit/ui's
// RadioGroup's Model, Messages, OutMessage and update (`SelectedOption`,
// `FocusedOption`, `FocusOption`, `Selected`), so swapping one for the other
// is an import and a view. The selected value stays in the parent's Model:
// it comes in as `selectedValue` and goes out as the `Selected` OutMessage.
//
// Behaviour, as WAI-ARIA's radio group and @foldkit/ui's: the group is one
// tab stop (a roving tabindex: the selected option, or the first enabled
// one). The arrow keys along its orientation move to the next or previous
// enabled option and select it, wrapping; Home and End jump. Each option is
// a `<button role="radio">`, so Space (on its release) and a click select it
// through the platform's own activation. Read-only: the arrows move focus
// and nothing selects. A disabled option is `aria-disabled`: the arrows skip
// it and a click does nothing.
//
// Moving focus is FoldKit's own `Dom.focus`, a Command, which runs on the
// native document as on the web.

import { Array, Effect, Option, Predicate, Schema, pipe } from 'effect'
import { Command, Dom, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { keyToIndex } from './keyboard.ts'
import { part } from './parts.ts'

// MODEL

export const Orientation = Schema.Literals(['Horizontal', 'Vertical'])
export type Orientation = typeof Orientation.Type

/** Which option has focus, when it isn't the selected one (`None`). */
export const Model = Schema.Struct({
  id: Schema.String,
  maybeFocusedIndex: Schema.Option(Schema.Number),
})
export type Model = typeof Model.Type

export const init = (config: { id: string }): Model => ({ id: config.id, maybeFocusedIndex: Option.none() })

// MESSAGE

export const Message = defineMessageUnion({
  SelectedOption: { index: Schema.Number, value: Schema.String },
  FocusedOption: { index: Schema.Number },
  CompletedFocusOption: {},
})
export type Message = typeof Message.Type

/** The parent's cue: an option was selected. */
export const OutMessage = defineMessageUnion({
  Selected: { value: Schema.String, index: Schema.Number },
})
export type OutMessage = typeof OutMessage.Type

export const optionId = (id: string, index: number) => `${id}-option-${index}`
export const labelId = (id: string, index: number) => `${id}-option-${index}-label`
export const descriptionId = (id: string, index: number) => `${id}-option-${index}-description`

// COMMAND

/** Focuses an option, once the render that made it the tab stop is in. */
export const FocusOption = Command.define('FocusOption', {
  args: { id: Schema.String, index: Schema.Number },
  messages: [Message.CompletedFocusOption],
  execute: ({ id, index }) =>
    Dom.focus(`#${optionId(id, index)}`).pipe(Effect.ignore, Effect.as(Message.CompletedFocusOption())),
})

// UPDATE

export const update = (model: Model, message: Message): Update.ReturnWithOutMessage<Model, Message, OutMessage> =>
  Message.match<Update.ReturnWithOutMessage<Model, Message, OutMessage>>(message, {
    SelectedOption: ({ index, value }) => ({
      model: modifyFields(model, { maybeFocusedIndex: () => Option.none() }),
      commands: [FocusOption({ id: model.id, index })],
      outMessage: OutMessage.Selected({ value, index }),
    }),
    FocusedOption: ({ index }) => ({
      model: modifyFields(model, { maybeFocusedIndex: () => Option.some(index) }),
      commands: [FocusOption({ id: model.id, index })],
    }),
    CompletedFocusOption: () => ({ model }),
  })

// VIEW

export type ViewConfig<ParentMessage, Value extends string = string> = Readonly<{
  model: Model
  options: ReadonlyArray<Value>
  selectedValue: Option.Option<Value>
  ariaLabel: string
  toParentMessage: (message: Message) => ParentMessage
  /** The label an option shows (its value, by default). */
  optionLabel?: (value: Value, index: number) => string
  optionDescription?: (value: Value, index: number) => string | undefined
  orientation?: Orientation
  isOptionDisabled?: (value: Value, index: number) => boolean
  isDisabled?: boolean
  isReadOnly?: boolean
}>

export const view = <ParentMessage, Value extends string = string>(
  config: ViewConfig<ParentMessage, Value>,
  h: HtmlBuilder<ParentMessage>,
): Html => {
  const { model, options, selectedValue, toParentMessage: up, orientation = 'Vertical', isReadOnly = false } = config
  const { id } = model
  const isDisabled = (index: number) =>
    config.isDisabled === true || (config.isOptionDisabled?.(options[index]!, index) ?? false)
  const selectedIndex = Option.flatMap(selectedValue, value => Array.findFirstIndex(options, option => option === value))
  const firstEnabled = pipe(Array.makeBy(options.length, index => index), Array.findFirst(Predicate.not(isDisabled)), Option.getOrElse(() => 0))
  // A disabled selected option can't be the tab stop: nothing could leave it.
  const tabStop = pipe(selectedIndex, Option.filter(Predicate.not(isDisabled)), Option.getOrElse(() => firstEnabled))
  const focusedIndex = pipe(model.maybeFocusedIndex, Option.filter(index => index < options.length && !isDisabled(index)), Option.getOrElse(() => tabStop))
  const [nextKey, previousKey] = orientation === 'Horizontal' ? ['ArrowRight', 'ArrowLeft'] : ['ArrowDown', 'ArrowUp']
  const toIndex = keyToIndex(nextKey, previousKey, options.length, focusedIndex, isDisabled)
  const moves = new Set([nextKey, previousKey, 'Home', 'End', 'PageUp', 'PageDown'])
  const onKey = (key: string): Option.Option<ParentMessage> => {
    if (!moves.has(key)) return Option.none()
    const index = toIndex(key)
    return Option.some(up(isReadOnly
      ? Message.FocusedOption({ index })
      : Message.SelectedOption({ index, value: options[index]! })))
  }
  const group = { orientation: orientation.toLowerCase(), disabled: config.isDisabled === true, readonly: isReadOnly }
  return h.div([
    ...part(h, 'radio-group', undefined, group),
    h.Id(id),
    h.Role('radiogroup'),
    h.AriaLabel(config.ariaLabel),
    h.AriaOrientation(orientation === 'Horizontal' ? 'horizontal' : 'vertical'),
    ...(isReadOnly ? [h.AriaReadonly(true)] : []),
  ], options.map((value, index) => {
    const disabled = isDisabled(index)
    const isSelected = Option.exists(selectedIndex, selected => selected === index)
    const state = { checked: isSelected, active: index === focusedIndex, disabled, readonly: isReadOnly }
    const select = disabled || isReadOnly ? [] : [h.OnClick(up(Message.SelectedOption({ index, value })))]
    const description = config.optionDescription?.(value, index)
    return h.div(part(h, 'radio-group', 'item', state), [
      h.button([
        ...part(h, 'radio-group', 'radio', state),
        h.Id(optionId(id, index)),
        h.Type('button'),
        h.Role('radio'),
        h.AriaChecked(isSelected),
        h.AriaLabelledBy(labelId(id, index)),
        ...(description === undefined ? [] : [h.AriaDescribedBy(descriptionId(id, index))]),
        h.Tabindex(index === focusedIndex ? 0 : -1),
        ...(disabled ? [h.AriaDisabled(true)] : [h.OnKeyDownPreventDefault(onKey)]),
        ...select,
      ], [h.span([...part(h, 'radio-group', 'indicator', state), h.AriaHidden(true)], [])]),
      h.div(part(h, 'radio-group', 'text'), [
        h.span([...part(h, 'radio-group', 'label', state), h.Id(labelId(id, index)), ...select], [config.optionLabel?.(value, index) ?? value]),
        ...(description === undefined ? [] : [h.span([...part(h, 'radio-group', 'description'), h.Id(descriptionId(id, index))], [description])]),
      ]),
    ])
  }))
}
