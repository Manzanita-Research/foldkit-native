// @foldkit-native/ui
//
// Themeable FoldKit components. Each is ordinary FoldKit (a view, and for the
// stateful ones a Model, Messages and update), so it runs in a browser and on
// FoldKit on gpuix alike; the platform supplies focus, Tab order, scrolling
// and text editing. Looks come from the theme (theme.ts): tokens, then parts
// and states.

export * as Button from './button.ts'
export * as Checkbox from './checkbox.ts'
export * as Dialog from './dialog.ts'
export * as Listbox from './listbox.ts'
export * as ScrollArea from './scroll-area.ts'
export * as Select from './select.ts'
export * as Switch from './switch.ts'
export * as TextField from './text-field.ts'
export * as RadioGroup from './radio-group.ts'
export * as Tabs from './tabs.ts'
export * as Input from './input.ts'
export * as Textarea from './textarea.ts'
export { type Theme, type TokenName, defineTheme, dusk, paper, themeStyle, themeTokens, token, uiCss } from './theme.ts'
export { part } from './parts.ts'

import { view } from './button.ts'

/** `Button.view`, by its old name. */
export const button = view
