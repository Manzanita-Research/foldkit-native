// THEME
//
// Looks, kept apart from behaviour. Three layers, each overridable without
// touching the one below:
//
// 1. Semantic tokens: what components read (`color.accent`, `radius.control`,
//    `space.3`). A theme is a full set of them; `defineTheme` builds one from a
//    base and overrides, so a theme can be one accent colour or everything.
// 2. Component tokens, defaulting to semantic ones (`switch.track-on` falls
//    back to `color.accent`). Set one to restyle one component everywhere.
// 3. Parts and states. Every element a component draws carries `data-ui`
//    (which component), `data-part` (which piece) and its state as data
//    attributes (`data-checked`, `data-highlighted`, `data-invalid`…), as
//    Base UI does. `uiCss` styles them with selectors on one element only, so
//    the same rules run in a browser and in FoldKit on gpuix's flat sheet. An
//    app adds its own rules after `uiCss` to restyle any part.
//
// Tokens are CSS custom properties (`--fn-color-accent`), so a theme switches
// live (FoldKit Native's `setTokens`), and `themeStyle` scopes one to a
// subtree from the view: theme as data in the Model, no restart, no Command.

/** Every semantic token a component reads. Lengths are pixels. */
export type Theme = Readonly<{
  'color.canvas': string
  'color.surface': string
  'color.surface-raised': string
  'color.text': string
  'color.text-muted': string
  'color.border': string
  'color.border-strong': string
  'color.accent': string
  'color.accent-hover': string
  'color.accent-text': string
  'color.focus': string
  'color.danger': string
  'color.highlight': string
  'color.backdrop': string
  'radius.control': number
  'radius.panel': number
  'radius.full': number
  'space.1': number
  'space.2': number
  'space.3': number
  'space.4': number
  'space.6': number
  'font.family': string
  'font.size.sm': number
  'font.size.md': number
  'font.size.lg': number
  'font.weight.strong': number
  'size.control': number
  'focus.ring': number
  'elevation.overlay': string
}>

export type TokenName = keyof Theme

const property = (name: string) => `--fn-${name.replace(/[^a-zA-Z0-9-]/g, '-')}`

/** `var(--fn-color-accent)`, or with a fallback. */
export const token = (name: TokenName | string, fallback?: string) =>
  fallback === undefined ? `var(${property(name)})` : `var(${property(name)}, ${fallback})`

const shared = {
  'radius.control': 8, 'radius.panel': 14, 'radius.full': 999,
  'space.1': 4, 'space.2': 8, 'space.3': 12, 'space.4': 16, 'space.6': 24,
  'font.family': 'system-ui', 'font.size.sm': 13, 'font.size.md': 15, 'font.size.lg': 20, 'font.weight.strong': 600,
  'size.control': 36, 'focus.ring': 2,
} as const

export const dusk: Theme = {
  ...shared,
  'color.canvas': '#141318', 'color.surface': '#1d1c23', 'color.surface-raised': '#26252e',
  'color.text': '#ecebf2', 'color.text-muted': '#9d9aab', 'color.border': '#34323d', 'color.border-strong': '#4a4756',
  'color.accent': '#8b7cf6', 'color.accent-hover': '#9d90f8', 'color.accent-text': '#ffffff',
  'color.focus': '#b9b0ff', 'color.danger': '#f2727f', 'color.highlight': '#2f2b45', 'color.backdrop': '#08070bcc',
  'elevation.overlay': '0 18px 40px #00000099',
}

export const paper: Theme = {
  ...shared,
  'color.canvas': '#f4f1ea', 'color.surface': '#fffdf8', 'color.surface-raised': '#ffffff',
  'color.text': '#24211c', 'color.text-muted': '#6f695f', 'color.border': '#ddd6c8', 'color.border-strong': '#bfb6a5',
  'color.accent': '#3d6df2', 'color.accent-hover': '#2f5ee0', 'color.accent-text': '#ffffff',
  'color.focus': '#3d6df2', 'color.danger': '#c93545', 'color.highlight': '#e7eefc', 'color.backdrop': '#24211c66',
  'elevation.overlay': '0 18px 40px #24211c33',
}

/** A theme from a base and overrides: one accent, or everything. */
export const defineTheme = (base: Theme, overrides: Partial<Theme> & Readonly<Record<string, string | number>> = {}): Theme =>
  ({ ...base, ...overrides }) as Theme

/** A theme as FoldKit Native tokens (`native.setTokens(themeTokens(dusk))`). */
export const themeTokens = (theme: Theme): Readonly<Record<string, string | number>> => theme

/** A theme as inline custom properties, for `h.Style(themeStyle(theme))` on
 *  any element: that subtree uses it. Works on the web and on gpuix. */
export const themeStyle = (theme: Theme): Record<string, string> =>
  Object.fromEntries(Object.entries(theme).map(([name, value]) => [property(name), typeof value === 'number' ? `${value}px` : value]))

/** One element's selector: `ui('switch', 'track')` → `[data-ui="switch"][data-part="track"]`;
 *  `ui('switch')` is the component's own root, not its parts. */
const ui = (component: string, part?: string) =>
  `[data-ui="${component}"]${part === undefined ? ':not([data-part])' : `[data-part="${part}"]`}`
const t = token

/** The components' rules: one element per selector, states as attributes. */
export const uiCss = `
${ui('root')} {
  display: flex; flex-direction: column; height: 100%;
  background-color: ${t('color.canvas')}; color: ${t('color.text')};
  font-family: ${t('font.family')}; font-size: ${t('font.size.md')};
}

${ui('field')} { display: flex; flex-direction: column; gap: ${t('space.1')}; }
${ui('field', 'label')} { font-size: ${t('font.size.sm')}; color: ${t('color.text-muted')}; font-weight: ${t('font.weight.strong')}; }
${ui('field', 'input')} {
  height: ${t('size.control')}; padding: 0 ${t('space.3')};
  background-color: ${t('field.background', t('color.surface'))}; color: ${t('color.text')};
  border: 1px solid ${t('color.border')}; border-radius: ${t('radius.control')};
}
${ui('field', 'input')}:hover { border-color: ${t('color.border-strong')}; }
${ui('field', 'input')}:focus { border-color: ${t('color.focus')}; box-shadow: 0 0 0 1px ${t('color.focus')}; }
${ui('field', 'input')}[data-invalid] { border-color: ${t('color.danger')}; }
${ui('field', 'description')} { font-size: ${t('font.size.sm')}; color: ${t('color.text-muted')}; }
${ui('field', 'error')} { font-size: ${t('font.size.sm')}; color: ${t('color.danger')}; }

${ui('switch')} { display: flex; flex-direction: row; align-items: center; gap: ${t('space.3')}; }
${ui('switch', 'track')} {
  display: flex; flex-direction: row; align-items: center; flex-shrink: 0;
  width: 42px; height: 24px; padding: 3px; border-radius: ${t('radius.full')};
  background-color: ${t('switch.track', t('color.border-strong'))}; cursor: pointer;
}
${ui('switch', 'track')}[data-checked] { justify-content: flex-end; background-color: ${t('switch.track-on', t('color.accent'))}; }
${ui('switch', 'track')}:hover { background-color: ${t('switch.track-hover', t('color.text-muted'))}; }
${ui('switch', 'track')}[data-checked]:hover { background-color: ${t('switch.track-on-hover', t('color.accent-hover'))}; }
${ui('switch', 'track')}:focus-visible { box-shadow: 0 0 0 ${t('focus.ring')} ${t('color.focus')}; }
${ui('switch', 'thumb')} { width: 18px; height: 18px; border-radius: ${t('radius.full')}; background-color: ${t('switch.thumb', '#ffffff')}; }
${ui('switch', 'label')} { cursor: pointer; }
${ui('switch', 'description')} { font-size: ${t('font.size.sm')}; color: ${t('color.text-muted')}; }

${ui('scroll-area')} { overflow-y: auto; min-height: 0; }
${ui('scroll-area')}:focus-visible { box-shadow: 0 0 0 ${t('focus.ring')} ${t('color.focus')}; }

${ui('listbox')} {
  display: flex; flex-direction: column; padding: ${t('space.1')}; overflow-y: auto;
  background-color: ${t('color.surface')}; border: 1px solid ${t('color.border')}; border-radius: ${t('radius.control')};
}
${ui('listbox')}:focus-visible { border-color: ${t('color.focus')}; box-shadow: 0 0 0 1px ${t('color.focus')}; }
${ui('listbox', 'option')} {
  display: flex; flex-direction: row; align-items: center; gap: ${t('space.2')}; flex-shrink: 0;
  height: 32px; padding: 0 ${t('space.2')}; border-radius: 6px; cursor: pointer;
}
${ui('listbox', 'option')}:hover { background-color: ${t('color.highlight')}; }
${ui('listbox', 'option')}[data-highlighted] { background-color: ${t('color.highlight')}; }
${ui('listbox', 'option')}[data-selected] { font-weight: ${t('font.weight.strong')}; color: ${t('color.accent')}; }
${ui('listbox', 'option')}[data-disabled] { color: ${t('color.text-muted')}; cursor: default; }
${ui('listbox', 'swatch')} { width: 12px; height: 12px; border-radius: ${t('radius.full')}; }
${ui('listbox', 'check')} { width: 16px; color: ${t('color.accent')}; }

${ui('select')} { position: relative; display: flex; flex-direction: column; }
${ui('select', 'trigger')} {
  display: flex; flex-direction: row; align-items: center; justify-content: space-between; gap: ${t('space.2')};
  height: 36px; padding: 0 ${t('space.3')}; cursor: pointer; color: ${t('color.text')}; font-size: ${t('font.size.md')};
  background-color: ${t('color.surface')}; border: 1px solid ${t('color.border')}; border-radius: ${t('radius.control')};
}
${ui('select', 'trigger')}:hover { border-color: ${t('color.border-strong')}; }
${ui('select', 'trigger')}[data-open] { border-color: ${t('color.focus')}; }
${ui('select', 'trigger')}:focus-visible { border-color: ${t('color.focus')}; box-shadow: 0 0 0 1px ${t('color.focus')}; }
${ui('select', 'value')}[data-placeholder] { color: ${t('color.text-muted')}; }
${ui('select', 'icon')} { color: ${t('color.text-muted')}; }
${ui('select', 'backdrop')} { position: fixed; top: 0; right: 0; bottom: 0; left: 0; }
${ui('select', 'anchor')} { position: absolute; top: 100%; left: 0; margin-top: 4px; z-index: 20; }
${ui('select', 'popup')} {
  display: flex; flex-direction: column; min-width: 220px; border-radius: ${t('radius.control')};
  background-color: ${t('color.surface-raised')}; box-shadow: ${t('elevation.overlay')};
}

${ui('dialog', 'layer')} {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0;
  display: flex; align-items: center; justify-content: center;
}
${ui('dialog', 'backdrop')} { position: absolute; top: 0; right: 0; bottom: 0; left: 0; background-color: ${t('color.backdrop')}; }
${ui('dialog', 'panel')} {
  display: flex; flex-direction: column; gap: ${t('space.3')}; width: 360px; padding: ${t('space.6')};
  background-color: ${t('color.surface-raised')}; border: 1px solid ${t('color.border')};
  border-radius: ${t('radius.panel')}; box-shadow: ${t('elevation.overlay')};
}
${ui('dialog', 'title')} { font-size: ${t('font.size.lg')}; font-weight: ${t('font.weight.strong')}; }
${ui('dialog', 'description')} { color: ${t('color.text-muted')}; }
${ui('dialog', 'actions')} { display: flex; flex-direction: row; justify-content: flex-end; gap: ${t('space.2')}; }

${ui('button')} {
  display: flex; align-items: center; justify-content: center; height: ${t('size.control')}; padding: 0 ${t('space.4')};
  border-radius: ${t('radius.control')}; border: 1px solid ${t('color.border')};
  background-color: ${t('color.surface')}; color: ${t('color.text')}; cursor: pointer;
}
${ui('button')}:hover { border-color: ${t('color.border-strong')}; }
${ui('button')}[data-variant="primary"] { background-color: ${t('color.accent')}; border-color: ${t('color.accent')}; color: ${t('color.accent-text')}; }
${ui('button')}[data-variant="primary"]:hover { background-color: ${t('color.accent-hover')}; }
${ui('button')}[data-variant="danger"] { background-color: ${t('color.danger')}; border-color: ${t('color.danger')}; color: #ffffff; }
${ui('button')}:focus-visible { box-shadow: 0 0 0 ${t('focus.ring')} ${t('color.focus')}; }
`
