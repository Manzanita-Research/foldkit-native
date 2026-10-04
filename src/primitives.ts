// PRIMITIVES
//
// Generic building blocks for FoldKit views, with no looks of their own.
// Each renders an ordinary element (so it also works on the web) marked with:
//
//   data-fn="stack"       which primitive it is
//   data-part="toolbar"   a stable part name the app or a UI library chooses,
//                         so a theme can style inside a component without forking it
//   data-selected, data-disabled, data-dragging, data-pressed, data-open,
//   data-current          interaction state, as attributes a theme can select on
//
// The only CSS they bring is structural (primitivesCss: flex direction, grid,
// scrolling, overlay placement). Every visual value (colour, type, spacing,
// radius, borders, elevation, materials, motion) comes from the app's or a UI
// library's stylesheet, normally through semantic tokens (see theme.ts).
// Hover and press styles are ordinary :hover and :active rules; GPUI applies
// them natively. (:focus-visible rules don't reach the screen yet: gpuix has
// no focus state.)
//
// Like FoldKit's own view helpers, each takes the `h` builder last.

import type { Attribute, Html, HtmlBuilder } from 'foldkit/html'

import { token } from './theme.ts'

/** Interaction state, rendered as data attributes (and ARIA where one exists). */
export type State = Readonly<{
  selected?: boolean
  disabled?: boolean
  dragging?: boolean
  pressed?: boolean
  open?: boolean
  current?: boolean
}>

/** GPUI motion (gpuix's `motion` prop): animate size, position, opacity or
 *  radius when they change. Durations in seconds; easing names or a cubic bezier. */
export type Motion = Readonly<{
  initial?: Readonly<Record<string, number>> | false
  animate: Readonly<Record<string, number>>
  exit?: Readonly<Record<string, number>>
  transition?: Readonly<{ duration?: number; delay?: number; ease?: string | readonly [number, number, number, number] }>
}>

export type Common<Message> = Readonly<{
  /** Stable part name for theming, e.g. "item", "item-title", "toolbar". */
  part: string
  state?: State
  /** Keyboard focus: tab order (0 = in order, -1 = programmatic only) and autofocus. */
  focus?: Readonly<{ order?: number; auto?: boolean }>
  motion?: Motion
  /** Anything else, exactly as FoldKit takes it (events, ARIA, ids…). */
  attributes?: ReadonlyArray<Attribute<Message>>
}>

/** A token name ("space.3") becomes var(--fn-space-3); anything else is raw CSS. */
const value = (v: string) => (/^[a-z]+(\.[a-z0-9-]+)+$/i.test(v) ? token(v) : v)

const base = <Message>(
  kind: string,
  config: Common<Message>,
  h: HtmlBuilder<Message>,
  style: Readonly<Record<string, string>> = {},
): Array<Attribute<Message>> => {
  const state = config.state ?? {}
  const attributes: Array<Attribute<Message>> = [h.DataAttribute('fn', kind), h.DataAttribute('part', config.part)]
  for (const [name, on] of Object.entries(state)) if (on === true) attributes.push(h.DataAttribute(name, ''))
  if (state.selected !== undefined) attributes.push(h.AriaSelected(state.selected))
  if (state.disabled !== undefined) attributes.push(h.AriaDisabled(state.disabled))
  if (config.focus?.order !== undefined) attributes.push(h.Tabindex(config.focus.order))
  if (config.focus?.auto === true) attributes.push(h.Autofocus(true))
  if (config.motion !== undefined) attributes.push(h.DataAttribute('fn-motion', JSON.stringify(config.motion)))
  if (Object.keys(style).length > 0) attributes.push(h.Style(style))
  return [...attributes, ...(config.attributes ?? [])]
}

type Align = 'start' | 'center' | 'end' | 'stretch' | 'baseline'
type Justify = 'start' | 'center' | 'end' | 'between'
const ALIGN: Readonly<Record<Align, string>> = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch', baseline: 'baseline' }
const JUSTIFY: Readonly<Record<Justify, string>> = { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between' }

type Flow = Readonly<{ gap?: string; align?: Align; justify?: Justify; grow?: boolean }>

const flowStyle = (flow: Flow): Record<string, string> => ({
  ...(flow.gap === undefined ? {} : { gap: value(flow.gap) }),
  ...(flow.align === undefined ? {} : { 'align-items': ALIGN[flow.align] }),
  ...(flow.justify === undefined ? {} : { 'justify-content': JUSTIFY[flow.justify] }),
  ...(flow.grow === true ? { 'flex-grow': '1', 'min-height': '0', 'min-width': '0' } : {}),
})

/** A plain box: a styling hook with no layout of its own. */
export const box = <Message>(config: Common<Message>, children: ReadonlyArray<Html>, h: HtmlBuilder<Message>): Html =>
  h.div(base('box', config, h), [...children])

/** Children top to bottom. `gap` is a token name ("space.3") or CSS. */
export const stack = <Message>(config: Common<Message> & Flow, children: ReadonlyArray<Html>, h: HtmlBuilder<Message>): Html =>
  h.div(base('stack', config, h, flowStyle(config)), [...children])

/** Children left to right; `wrap` lets them flow onto more lines. */
export const row = <Message>(config: Common<Message> & Flow & Readonly<{ wrap?: boolean }>, children: ReadonlyArray<Html>, h: HtmlBuilder<Message>): Html =>
  h.div(base('row', config, h, { ...flowStyle(config), ...(config.wrap === true ? { 'flex-wrap': 'wrap' } : {}) }), [...children])

/** Equal columns. */
export const grid = <Message>(config: Common<Message> & Readonly<{ columns: number; gap?: string }>, children: ReadonlyArray<Html>, h: HtmlBuilder<Message>): Html =>
  h.div(base('grid', config, h, {
    'grid-template-columns': `repeat(${config.columns}, 1fr)`,
    ...(config.gap === undefined ? {} : { gap: value(config.gap) }),
  }), [...children])

/** Text. `as` picks the element for semantics (headings, labels); looks come from the theme. */
export const text = <Message>(
  config: Common<Message> & Readonly<{ as?: 'span' | 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'label' }>,
  content: string,
  h: HtmlBuilder<Message>,
): Html => {
  const attributes = base('text', config, h)
  switch (config.as ?? 'span') {
    case 'p': return h.p(attributes, [content])
    case 'h1': return h.h1(attributes, [content])
    case 'h2': return h.h2(attributes, [content])
    case 'h3': return h.h3(attributes, [content])
    case 'h4': return h.h4(attributes, [content])
    case 'label': return h.label(attributes, [content])
    default: return h.span(attributes, [content])
  }
}

/** An image from a path, data URL or http(s) URL; `object-fit` comes from CSS. */
export const image = <Message>(config: Common<Message> & Readonly<{ src: string; alt: string }>, h: HtmlBuilder<Message>): Html =>
  h.img([...base('image', config, h), h.Src(config.src), h.Alt(config.alt)])

/** A text field. GPUI draws a native input; FoldKit gets `input` events as usual. */
export const input = <Message>(
  config: Common<Message> & Readonly<{ value: string; placeholder?: string; onInput: (value: string) => Message; multiline?: boolean }>,
  h: HtmlBuilder<Message>,
): Html => {
  const attributes = [
    ...base('input', config, h),
    h.Value(config.value),
    h.OnInput(config.onInput),
    ...(config.placeholder === undefined ? [] : [h.Placeholder(config.placeholder)]),
  ]
  // FoldKit narrows textarea attributes; everything above is valid on it.
  return config.multiline === true ? h.textarea(attributes as never) : h.input(attributes)
}

/** A scrolling region (vertical by default). */
export const scroll = <Message>(config: Common<Message> & Readonly<{ axis?: 'y' | 'x' | 'both' }>, children: ReadonlyArray<Html>, h: HtmlBuilder<Message>): Html =>
  h.div([...base('scroll', config, h), h.DataAttribute('axis', config.axis ?? 'y')], [...children])

/** A layer over the rest of the window (dialogs, sheets, popover backdrops).
 *  Hidden unless `state.open`. Later surfaces sit above earlier ones. */
export const surface = <Message>(config: Common<Message>, children: ReadonlyArray<Html>, h: HtmlBuilder<Message>): Html =>
  h.div(base('surface', config, h), [...children])

/** Structural rules only: no colour, type, spacing, radius or motion. */
export const primitivesCss = `
[data-fn="stack"] { display: flex; flex-direction: column; }
[data-fn="row"] { display: flex; flex-direction: row; }
[data-fn="grid"] { display: grid; }
[data-fn="scroll"] { min-height: 0; min-width: 0; overflow-y: scroll; }
[data-fn="scroll"][data-axis="x"] { overflow-y: visible; overflow-x: scroll; }
[data-fn="scroll"][data-axis="both"] { overflow-x: scroll; }
[data-fn="surface"] { position: absolute; top: 0; right: 0; bottom: 0; left: 0; display: flex; }
[data-fn="surface"]:not([data-open]) { display: none; }
[data-fn][data-disabled] { pointer-events: none; }
`
