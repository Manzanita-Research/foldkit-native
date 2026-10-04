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

/** "12px" → 12, "1.5rem" → 24, "calc(.25rem * 4)" → 16. Anything else
 *  (auto, %, normal) → undefined. A bare number is taken as pixels. */
export const px = (value: string): number | undefined => {
  const length = evaluate(value)
  return length === undefined ? undefined : length.value
}

type Length = { value: number; unit: 'px' | '' }

/** A length or a `calc()` of lengths and numbers (Tailwind writes
 *  `calc(var(--spacing) * 4)`; happy-dom substitutes the variable and leaves
 *  the arithmetic). rem and em are 16px. */
const evaluate = (value: string): Length | undefined => {
  const source = value.trim()
  const tokens = /^calc\(/.test(source) ? source.slice(5, -1).match(/-?[\d.]+(?:px|rem|em)?|[-+*/()]/g) : [source]
  if (tokens === null) return undefined
  let at = 0
  const atom = (): Length | undefined => {
    const token = tokens[at++]
    if (token === '(') {
      const inner = sum()
      at++
      return inner
    }
    const match = /^(-?[\d.]+)(px|rem|em)?$/.exec(token ?? '')
    if (match === null) return undefined
    const number = Number(match[1])
    return match[2] === undefined ? { value: number, unit: '' } : { value: match[2] === 'px' ? number : number * 16, unit: 'px' }
  }
  const product = (): Length | undefined => {
    let left = atom()
    while (left !== undefined && (tokens[at] === '*' || tokens[at] === '/')) {
      const op = tokens[at++]
      const right = atom()
      if (right === undefined) return undefined
      left = { value: op === '*' ? left.value * right.value : left.value / right.value, unit: left.unit || right.unit }
    }
    return left
  }
  const sum = (): Length | undefined => {
    let left = product()
    while (left !== undefined && (tokens[at] === '+' || tokens[at] === '-')) {
      const op = tokens[at++]
      const right = product()
      if (right === undefined) return undefined
      left = { value: op === '+' ? left.value + right.value : left.value - right.value, unit: left.unit || right.unit }
    }
    return left
  }
  const result = sum()
  return result === undefined || at !== tokens.length || !Number.isFinite(result.value) ? undefined : result
}

/** Splits on commas outside parentheses: shadow lists, gradient stops. */
const splitTopLevel = (value: string): Array<string> => {
  const parts: Array<string> = []
  let depth = 0
  let start = 0
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '(') depth++
    else if (value[i] === ')') depth--
    else if (value[i] === ',' && depth === 0) {
      parts.push(value.slice(start, i).trim())
      start = i + 1
    }
  }
  parts.push(value.slice(start).trim())
  return parts
}

const dimension = (value: string): number | string | undefined =>
  value.endsWith('%') ? value : px(value)

const isColor = (value: string) =>
  value !== '' && value !== 'transparent' && value !== 'rgba(0, 0, 0, 0)' && value !== 'initial'

const SIDES: Readonly<Record<string, number>> = {
  'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270,
  'to top right': 45, 'to right top': 45, 'to bottom right': 135, 'to right bottom': 135,
  'to bottom left': 225, 'to left bottom': 225, 'to top left': 315, 'to left top': 315,
}

/** `linear-gradient(180deg, #44304f, #19161d)` or Tailwind's
 *  `linear-gradient(to bottom right in oklab, #dbeafe 0%, #90c5ff 100%)` → a
 *  gpuix gradient. gpuix draws two stops, so a longer list keeps its ends. */
const gradient = (value: string): StyleDesc['background'] | undefined => {
  const match = /linear-gradient\((.*)\)/.exec(value)
  if (match === null) return undefined
  const parts = splitTopLevel(match[1]!)
  let angle = 180
  const direction = parts[0]!.replace(/\s+in\s+[\w-]+$/, '').trim()
  const degrees = /^(-?[\d.]+)deg$/.exec(direction)
  if (degrees !== null) angle = Number(degrees[1])
  else if (SIDES[direction] !== undefined) angle = SIDES[direction]!
  if (degrees !== null || SIDES[direction] !== undefined || /^in\s/.test(parts[0]!)) parts.shift()
  const stops = parts.map(stop => stop.replace(/\s+-?[\d.]+%$/, '').trim()).filter(Boolean)
  if (stops.length < 2) return undefined
  return {
    type: 'linear-gradient',
    angle,
    stops: [
      { color: stops[0]!, position: 0 },
      { color: stops.at(-1)!, position: 1 },
    ],
  }
}

/** The first visible shadow in a list. Tailwind stacks ring, inset and drop
 *  shadows, with `0 0 #0000` for the unused ones; gpuix draws one shadow. */
const boxShadow = (value: string): StyleDesc['boxShadow'] | undefined => {
  for (const shadow of splitTopLevel(value)) {
    if (/\binset\b/.test(shadow)) continue
    const match = /^(-?[\d.]+)(?:px)?\s+(-?[\d.]+)(?:px)?(?:\s+(-?[\d.]+)(?:px)?)?(?:\s+(-?[\d.]+)(?:px)?)?\s+(.+)$/.exec(shadow)
    if (match === null) continue
    const color = match[5]!.trim()
    if (!isColor(color) || /^#0000(?:0000)?$/.test(color) || /^rgba\([^)]*,\s*0\)$/.test(color)) continue
    return {
      offsetX: Number(match[1]), offsetY: Number(match[2]), blurRadius: Number(match[3] ?? 0),
      spreadRadius: Number(match[4] ?? 0), color,
    }
  }
  return undefined
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

/** CSS `user-select` → gpuix's. `auto` (or unset) is left out, so the nearest
 *  ancestor's value carries down: gpuix inherits it, as a browser does. */
const userSelect = (value: string): 'none' | 'text' | undefined =>
  value === 'none' ? 'none' : value === 'text' || value === 'all' || value === 'contain' ? 'text' : undefined

/** What a native app does where a web page doesn't, applied before the app's
 *  CSS so it can override any of it. UI text isn't selectable: a double click
 *  on a button or a list row shouldn't highlight its label. Text that should be
 *  selectable opts in with `user-select: text`, as in a native toolkit. Inputs
 *  keep their own editing and selection. A button centres its label, as a
 *  browser's own stylesheet does. And the page scrolls, as a browser's
 *  viewport does: the body, GPUI's root, fills the window and scrolls what
 *  doesn't fit (`scroll`, which GPUI scrolls; a page that fits doesn't move). */
export const nativeDefaultsCss = `
body { user-select: none; height: 100%; overflow-y: scroll; }
button { text-align: center; }
`

/** A translation in pixels from `transform: translate(…)`/`translate3d(…)`/
 *  `translateX|Y(…)`, or the `translate` property ("10px 20px"). Anything
 *  else (rotate, scale, %, a matrix) → undefined: GPUI has no transforms. */
export const translation = (transform: string, translate = ''): { x: number; y: number } | undefined => {
  const fn = /^translate(3d|X|Y)?\((.*)\)$/.exec(transform.trim())
  const args = fn !== null ? fn[2]!.split(',') : translate.trim() !== '' && translate !== 'none' ? translate.trim().split(/\s+/) : undefined
  if (args === undefined) return undefined
  const [first, second] = args.map(arg => px(arg))
  if (first === undefined) return undefined
  if (fn?.[1] === 'Y') return { x: 0, y: first }
  if (fn?.[1] === 'X') return { x: first, y: 0 }
  return args.length > 1 && second === undefined ? undefined : { x: first, y: second ?? 0 }
}

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
  // happy-dom computes the `overflow` shorthand without its longhands.
  const [overflowX, overflowY = overflowX] = get('overflow').split(/\s+/)
  if (style.overflowX === undefined && overflowX !== undefined && overflowX !== '' && overflowX !== 'visible') style.overflowX = overflowX
  if (style.overflowY === undefined && overflowY !== undefined && overflowY !== '' && overflowY !== 'visible') style.overflowY = overflowY
  for (const [css, key] of LENGTHS) {
    const value = px(get(css))
    if (value !== undefined && value !== 0) (style as Record<string, unknown>)[key] = value
  }
  // GPUI has no transforms. A translate on a positioned element is an offset,
  // so it moves top/left: FoldKit's drag ghost follows the pointer this way.
  const shift = style.position === undefined ? undefined : translation(get('transform'), get('translate'))
  if (shift !== undefined) {
    if (shift.x !== 0) style.left = (style.left ?? 0) + shift.x
    if (shift.y !== 0) style.top = (style.top ?? 0) + shift.y
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
    if ((px(get(`border-${side}-width`)) ?? 0) === 0) continue
    // A border with no colour of its own (Tailwind 4's `border`: preflight's
    // `border: 0 solid`) has the initial one, currentcolor: the text colour,
    // black by default. happy-dom reports it as `initial`.
    const own = get(`border-${side}-color`)
    const color = own === '' || own === 'initial' || own.toLowerCase() === 'currentcolor'
      ? isColor(get('color')) ? get('color') : '#000000'
      : own
    if (isColor(color)) style.borderColor = color
  }
  const opacity = get('opacity')
  if (opacity !== '' && opacity !== '1') style.opacity = Number(opacity)
  const select = userSelect(get('user-select'))
  if (select !== undefined) style.userSelect = select
  const cursor = get('cursor')
  if (cursor === 'pointer' || cursor === 'text' || cursor === 'grab' || cursor === 'move') {
    style.cursor = cursor as StyleDesc['cursor']
  }
  const shadow = get('box-shadow')
  if (shadow !== '' && shadow !== 'none') {
    const parsed = boxShadow(shadow)
    if (parsed !== undefined) style.boxShadow = parsed
  }
  return style
}

/** CSS generic families → the names GPUI resolves itself: `.SystemUIFont` is
 *  the platform's UI font (San Francisco on macOS) and `.ZedMono` a monospace
 *  GPUI bundles. Without this the family is a name no font has, and the text
 *  falls back to whatever the platform picks (Times on macOS). */
const GENERIC_FAMILIES: Readonly<Record<string, string>> = {
  'system-ui': '.SystemUIFont', '-apple-system': '.SystemUIFont', BlinkMacSystemFont: '.SystemUIFont',
  'ui-sans-serif': '.SystemUIFont', 'sans-serif': '.SystemUIFont', monospace: '.ZedMono', 'ui-monospace': '.ZedMono',
}

/** The first family in a `font-family` list, generic names resolved. */
export const fontFamily = (value: string): string | undefined => {
  const first = value.split(',')[0]!.replace(/["']/g, '').trim()
  return first === '' ? undefined : GENERIC_FAMILIES[first] ?? first
}

/** Text properties. GPUI text doesn't inherit, so every text node gets its
 *  parent's computed (already inherited) values. */
export const textStyle = (computed: Computed): Style => {
  const style: Style = {}
  const get = (name: string) => computed.getPropertyValue(name).trim()
  if (isColor(get('color'))) style.color = get('color')
  const family = fontFamily(get('font-family'))
  if (family !== undefined) style.fontFamily = family
  const size = px(get('font-size'))
  if (size !== undefined) style.fontSize = size
  const weight = get('font-weight')
  if (weight !== '' && weight !== 'normal' && weight !== '400') {
    style.fontWeight = weight === 'bold' ? 700 : Number(weight)
  }
  const line = evaluate(get('line-height'))
  if (line !== undefined) style.lineHeight = line.unit === 'px' ? line.value : line.value * (size ?? 16)
  if (get('white-space') === 'nowrap') style.whiteSpace = 'nowrap'
  if (get('text-overflow') === 'ellipsis') style.textOverflow = 'ellipsis'
  const select = userSelect(get('user-select'))
  if (select !== undefined) style.userSelect = select
  return style
}

/** Interaction states GPUI can style itself, and the CSS pseudo-class for each. */
const STATES = [
  ['hover', ':hover'],
  ['active', ':active'],
  ['focusVisible', ':focus-visible'],
] as const

export type StateRule = Readonly<{ state: (typeof STATES)[number][0]; base: string; style: CSSStyleDeclaration }>

/** Substitutes every `var(--x)` and `var(--x, fallback)` in a value with the
 *  custom property `lookup` finds, or the fallback when it finds none. A
 *  rule's own declaration isn't cascaded, so nobody else does this for it. */
export const resolveVars = (value: string, lookup: (name: string) => string, depth = 0): string => {
  const start = value.indexOf('var(')
  if (start === -1 || depth > 8) return value
  let end = start + 4
  for (let open = 1; end < value.length && open > 0; end++) {
    if (value[end] === '(') open++
    else if (value[end] === ')') open--
  }
  const inner = value.slice(start + 4, end - 1)
  const [name = '', ...rest] = splitTopLevel(inner)
  const own = lookup(name.trim())
  const replacement = resolveVars(own !== '' ? own : rest.join(', '), lookup, depth + 1)
  return resolveVars(value.slice(0, start) + replacement + value.slice(end), lookup, depth + 1)
}

/** The styles `x:hover`, `x:active` and `x:focus-visible` rules would add to an
 *  element, found by matching each rule's selector without the pseudo-class
 *  (the DOM doesn't know where the pointer is; GPUI does, and applies them).
 *  `lookup` finds the element's custom properties, for the rules' var()s. */
export const stateStyles = (
  element: Element,
  rules: ReadonlyArray<StateRule>,
  lookup: (name: string) => string,
): Partial<Record<StateRule['state'], Style>> => {
  const states: Partial<Record<StateRule['state'], Style>> = {}
  for (const rule of rules) {
    if (!element.matches(rule.base)) continue
    const resolved: Computed = { getPropertyValue: name => resolveVars(rule.style.getPropertyValue(name), lookup) }
    states[rule.state] = { ...states[rule.state], ...boxStyle(resolved), ...textStyle(resolved) }
  }
  return states
}

/** Collects the state rules from every stylesheet in the document. */
export const collectStateRules = (document: Document): ReadonlyArray<StateRule> => {
  const rules: Array<StateRule> = []
  const collect = (list: CSSRuleList) => {
    for (const rule of Array.from(list) as Array<CSSStyleRule & CSSMediaRule>) {
      // Tailwind 4 puts every hover: inside `@media (hover: hover)`. A desktop
      // pointer hovers, so those count, as does any media query that matches.
      if (rule.selectorText === undefined) {
        const media = rule.media?.mediaText
        if (media !== undefined && rule.cssRules !== undefined &&
          (/\(\s*hover\s*:\s*hover\s*\)/.test(media) || document.defaultView?.matchMedia(media).matches)) {
          collect(rule.cssRules)
        }
        continue
      }
      for (const selector of rule.selectorText.split(',')) {
        for (const [state, pseudo] of STATES) {
          if (!selector.includes(pseudo)) continue
          rules.push({ state, base: selector.split(pseudo).join('').trim() || '*', style: rule.style })
        }
      }
    }
  }
  for (const sheet of Array.from(document.styleSheets)) collect(sheet.cssRules)
  return rules
}
