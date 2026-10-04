// @foldkit-native/ui
//
// Themeable FoldKit components. Each is ordinary FoldKit (a view, and for the
// stateful ones a Model, Messages and update), so it runs in a browser and on
// FoldKit on gpuix alike; the platform supplies focus, Tab order, scrolling
// and text editing. Looks come from the theme (theme.ts): tokens, then parts
// and states.

export * as Dialog from './dialog.ts'
export * as Listbox from './listbox.ts'
export * as ScrollArea from './scroll-area.ts'
export * as Switch from './switch.ts'
export * as TextField from './text-field.ts'
export { type Theme, type TokenName, defineTheme, dusk, paper, themeStyle, themeTokens, token, uiCss } from './theme.ts'
export { part } from './parts.ts'

import type { Attribute, Html, HtmlBuilder } from 'foldkit/html'

import { part } from './parts.ts'

/** A plain button in the theme: `variant` picks primary, danger or default. */
export const button = <Message>(
  config: Readonly<{ label: string; onClick: Message; variant?: 'primary' | 'danger'; attributes?: ReadonlyArray<Attribute<Message>> }>,
  h: HtmlBuilder<Message>,
): Html =>
  h.button([
    ...part(h, 'button', undefined, { variant: config.variant }),
    h.Type('button'),
    h.OnClick(config.onClick),
    ...(config.attributes ?? []),
  ], [config.label])
