// SCROLL AREA
//
// A region that scrolls when its content doesn't fit. GPUI does the scrolling
// (wheel, trackpad momentum); this is a labelled region (`role="region"`)
// and a tab stop, so the keyboard scrolls it too: FoldKit on gpuix scrolls a
// focused scroll area with the arrows, Page Up/Down, Space, Home and End, as
// browsers do. `maxHeight` bounds it; inside a flex column it can instead
// grow to fill the space left (`fill`).

import type { Attribute, Html, HtmlBuilder } from 'foldkit/html'

import { part } from './parts.ts'

export type ViewConfig<Message> = Readonly<{
  label: string
  maxHeight?: number
  /** Take the rest of a flex column's height (the page's main area). */
  fill?: boolean
  attributes?: ReadonlyArray<Attribute<Message>>
}>

export const view = <Message>(config: ViewConfig<Message>, children: ReadonlyArray<Html>, h: HtmlBuilder<Message>): Html =>
  h.div([
    ...part(h, 'scroll-area', undefined),
    h.Role('region'),
    h.AriaLabel(config.label),
    h.Tabindex(0),
    ...(config.maxHeight === undefined && config.fill !== true
      ? []
      : [h.Style({
        ...(config.maxHeight === undefined ? {} : { 'max-height': `${config.maxHeight}px` }),
        ...(config.fill === true ? { 'flex-grow': '1' } : {}),
      })]),
    ...(config.attributes ?? []),
  ], [...children])
