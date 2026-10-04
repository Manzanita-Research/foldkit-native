// PARTS
//
// The attributes every element a component draws carries, so a theme can
// reach it: `data-ui` (the component), `data-part` (the piece) and its state
// as empty data attributes (`data-checked`), as Base UI does.

import type { Attribute, HtmlBuilder } from 'foldkit/html'

export type PartState = Readonly<Record<string, boolean | string | undefined>>

export const part = <Message>(
  h: HtmlBuilder<Message>,
  component: string,
  name: string | undefined,
  state: PartState = {},
): Array<Attribute<Message>> => {
  const out: Array<Attribute<Message>> = [h.DataAttribute('ui', component)]
  if (name !== undefined) out.push(h.DataAttribute('part', name))
  for (const [key, value] of Object.entries(state)) {
    if (value === true) out.push(h.DataAttribute(key, ''))
    else if (typeof value === 'string') out.push(h.DataAttribute(key, value))
  }
  return out
}
