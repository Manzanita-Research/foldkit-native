// STYLE
//
// GPUI has no CSS engine, but gpuix's style object is CSS in camelCase. So the
// DOM keeps doing the cascade (happy-dom resolves stylesheets, classes and
// inline styles into a computed style), and this file copies the parts GPUI
// understands. Layout stays GPUI's (flexbox and block via taffy).

import type { StyleDesc } from '@gpuix/native/host'

type Writable<T> = { -readonly [K in keyof T]: T[K] }
type Style = Writable<StyleDesc>
type Computed = Pick<CSSStyleDeclaration, 'getPropertyValue'>

/** "12px" → 12, "1.5rem" → 24. Anything else (auto, %, normal) → undefined. */
export const px = (value: string): number | undefined => {
  const match = /^(-?[\d.]+)(px|rem|em)?$/.exec(value.trim())
  if (match === null) return undefined
  const number = Number(match[1])
  return match[2] === 'rem' || match[2] === 'em' ? number * 16 : number
}

const dimension = (value: string): number | string | undefined =>
  value.endsWith('%') ? value : px(value)

const isColor = (value: string) =>
  value !== '' && value !== 'transparent' && value !== 'rgba(0, 0, 0, 0)' && value !== 'initial'

/** `linear-gradient(180deg, #44304f, #19161d)` → a gpuix two-stop gradient. */
const gradient = (value: string): StyleDesc['background'] | undefined => {
  const match = /linear-gradient\(\s*(-?[\d.]+)deg\s*,\s*([^,]+?)\s*,\s*([^,]+?)\s*\)/.exec(value)
  if (match === null) return undefined
  return {
    type: 'linear-gradient',
    angle: Number(match[1]),
    stops: [
      { color: match[2]!, position: 0 },
      { color: match[3]!, position: 1 },
    ],
  }
}

const LENGTHS = [
  ['gap', 'gap'], ['row-gap', 'rowGap'], ['column-gap', 'columnGap'],
  ['padding-top', 'paddingTop'], ['padding-right', 'paddingRight'],
  ['padding-bottom', 'paddingBottom'], ['padding-left', 'paddingLeft'],
  ['margin-top', 'marginTop'], ['margin-right', 'marginRight'],
  ['margin-bottom', 'marginBottom'], ['margin-left', 'marginLeft'],
  ['border-top-width', 'borderTopWidth'], ['border-right-width', 'borderRightWidth'],
  ['border-bottom-width', 'borderBottomWidth'], ['border-left-width', 'borderLeftWidth'],
  ['border-top-left-radius', 'borderTopLeftRadius'], ['border-top-right-radius', 'borderTopRightRadius'],
  ['border-bottom-left-radius', 'borderBottomLeftRadius'], ['border-bottom-right-radius', 'borderBottomRightRadius'],
  ['top', 'top'], ['right', 'right'], ['bottom', 'bottom'], ['left', 'left'],
] as const

const DIMENSIONS = [
  ['width', 'width'], ['height', 'height'], ['min-width', 'minWidth'], ['min-height', 'minHeight'],
  ['max-width', 'maxWidth'], ['max-height', 'maxHeight'],
] as const

const KEYWORDS = [
  ['flex-direction', 'flexDirection'], ['flex-wrap', 'flexWrap'], ['align-items', 'alignItems'],
  ['align-self', 'alignSelf'], ['justify-content', 'justifyContent'], ['position', 'position'],
  ['text-align', 'textAlign'], ['overflow-x', 'overflowX'], ['overflow-y', 'overflowY'],
  ['visibility', 'visibility'],
] as const

/** Layout and box properties of an element. */
export const boxStyle = (computed: Computed): Style => {
  const style: Style = {}
  const get = (name: string) => computed.getPropertyValue(name).trim()
  const display = get('display')
  if (display === 'none') return { display: 'none' }
  if (display === 'flex' || display === 'inline-flex') style.display = 'flex'
  if (display === 'grid') style.display = 'grid'
  for (const [css, key] of KEYWORDS) {
    const value = get(css)
    if (value !== '' && value !== 'normal' && value !== 'visible' && value !== 'static') {
      ;(style as Record<string, unknown>)[key] = value
    }
  }
  for (const [css, key] of LENGTHS) {
    const value = px(get(css))
    if (value !== undefined && value !== 0) (style as Record<string, unknown>)[key] = value
  }
  for (const [css, key] of DIMENSIONS) {
    const value = dimension(get(css))
    if (value !== undefined) (style as Record<string, unknown>)[key] = value
  }
  if (style.display === 'grid') {
    // gpuix grids are N equal tracks: `repeat(3, 1fr)` or `1fr 1fr 1fr` → 3.
    const columns = get('grid-template-columns')
    const repeat = /repeat\(\s*(\d+)/.exec(columns)
    const count = repeat !== null ? Number(repeat[1]) : columns.split(/\s+/).filter(Boolean).length
    if (count > 0) style.gridTemplateColumns = count
  }
  if (get('pointer-events') === 'none') style.pointerEvents = 'none'
  const grow = Number(get('flex-grow'))
  if (grow > 0) style.flexGrow = grow
  if (get('flex-shrink') === '0') style.flexShrink = 0
  const background = get('background-image') || get('background')
  const linear = background.includes('linear-gradient') ? gradient(background) : undefined
  if (linear !== undefined) style.background = linear
  else if (isColor(get('background-color'))) style.backgroundColor = get('background-color')
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const color = get(`border-${side}-color`)
    if (isColor(color) && (px(get(`border-${side}-width`)) ?? 0) > 0) style.borderColor = color
  }
  const opacity = get('opacity')
  if (opacity !== '' && opacity !== '1') style.opacity = Number(opacity)
  const select = get('user-select')
  if (select === 'none' || select === 'text') style.userSelect = select
  const cursor = get('cursor')
  if (cursor === 'pointer' || cursor === 'text' || cursor === 'grab' || cursor === 'move') {
    style.cursor = cursor as StyleDesc['cursor']
  }
  const shadow = get('box-shadow')
  if (shadow !== '' && shadow !== 'none') {
    const match = /(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?\s+(.+)$/.exec(shadow)
    if (match !== null) {
      style.boxShadow = {
        offsetX: Number(match[1]), offsetY: Number(match[2]), blurRadius: Number(match[3]),
        spreadRadius: Number(match[4] ?? 0), color: match[5]!,
      }
    }
  }
  return style
}

/** Text properties. GPUI text doesn't inherit, so every text node gets its
 *  parent's computed (already inherited) values. */
export const textStyle = (computed: Computed): Style => {
  const style: Style = {}
  const get = (name: string) => computed.getPropertyValue(name).trim()
  if (isColor(get('color'))) style.color = get('color')
  const family = get('font-family')
  if (family !== '') style.fontFamily = family.split(',')[0]!.replace(/["']/g, '').trim()
  const size = px(get('font-size'))
  if (size !== undefined) style.fontSize = size
  const weight = get('font-weight')
  if (weight !== '' && weight !== 'normal' && weight !== '400') {
    style.fontWeight = weight === 'bold' ? 700 : Number(weight)
  }
  const line = px(get('line-height'))
  if (line !== undefined) style.lineHeight = line
  if (get('white-space') === 'nowrap') style.whiteSpace = 'nowrap'
  if (get('text-overflow') === 'ellipsis') style.textOverflow = 'ellipsis'
  const select = get('user-select')
  if (select === 'none' || select === 'text') style.userSelect = select
  return style
}

/** Interaction states GPUI can style itself, and the CSS pseudo-class for each. */
const STATES = [
  ['hover', ':hover'],
  ['active', ':active'],
  ['focusVisible', ':focus-visible'],
] as const

export type StateRule = Readonly<{ state: (typeof STATES)[number][0]; base: string; style: CSSStyleDeclaration }>

/** The styles `x:hover`, `x:active` and `x:focus-visible` rules would add to an
 *  element, found by matching each rule's selector without the pseudo-class
 *  (the DOM doesn't know where the pointer is; GPUI does, and applies them). */
export const stateStyles = (element: Element, rules: ReadonlyArray<StateRule>): Partial<Record<StateRule['state'], Style>> => {
  const states: Partial<Record<StateRule['state'], Style>> = {}
  for (const rule of rules) {
    if (!element.matches(rule.base)) continue
    states[rule.state] = { ...states[rule.state], ...boxStyle(rule.style), ...textStyle(rule.style) }
  }
  return states
}

/** Collects the state rules from every stylesheet in the document. */
export const collectStateRules = (document: Document): ReadonlyArray<StateRule> => {
  const rules: Array<StateRule> = []
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules) as Array<CSSStyleRule>) {
      if (rule.selectorText === undefined) continue
      for (const selector of rule.selectorText.split(',')) {
        for (const [state, pseudo] of STATES) {
          if (!selector.includes(pseudo)) continue
          rules.push({ state, base: selector.split(pseudo).join('').trim() || '*', style: rule.style })
        }
      }
    }
  }
  return rules
}
