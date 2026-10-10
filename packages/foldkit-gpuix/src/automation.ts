// AUTOMATION
//
// What gpuix's automation serves when an app asks for it (index.ts's
// `automation`): the renderer, less a person's secrets.
//
// - The tree. gpuix's automation tree carries no field values today (types,
//   ids, boxes; automation.test.ts pins it). Any `value` or `text` on an
//   input or textarea node is taken off anyway, so a gpuix upgrade that
//   adds one doesn't start serving what people type.
// - Secret fields. A field whose `autocomplete` says it holds a secret
//   (`current-password`, `new-password`, `one-time-code`, `cc-number`,
//   `cc-csc`: the intent a password field would carry, since `type=password`
//   is refused) never has its text served: in the painted text, all the
//   text, and the selection, it's bullets, one per character. The window
//   itself still shows it (gpuix has no masked input), so a screenshot
//   would too.

/** HTML autofill names that mark a field as holding a secret. */
export const SECRET_AUTOCOMPLETE: ReadonlySet<string> = new Set(['current-password', 'new-password', 'one-time-code', 'cc-number', 'cc-csc'])

type Field = { localName: string; getAttribute(name: string): string | null; value: string }

/** Whether a field holds a secret, by its `autocomplete`. */
export const isSecretField = (element: Field): boolean =>
  (element.localName === 'input' || element.localName === 'textarea') &&
  (element.getAttribute('autocomplete') ?? '').toLowerCase().split(/\s+/).some(token => SECRET_AUTOCOMPLETE.has(token))

/** The text of every secret field among `fields`, longest first. */
export const secretValues = (fields: Iterable<Field>): Array<string> =>
  [...fields].filter(isSecretField).map(field => field.value).filter(value => value !== '').sort((a, b) => b.length - a.length)

const hide = (text: string, secrets: ReadonlyArray<string>) =>
  secrets.reduce((out, secret) => out.split(secret).join('•'.repeat([...secret].length)), text)

type TreeNode = { type?: string; children?: Array<TreeNode> } & Record<string, unknown>
const stripValues = (node: TreeNode): void => {
  if (node.type === 'input' || node.type === 'textarea') {
    delete node['value']
    delete node['text']
  }
  for (const child of node.children ?? []) stripValues(child)
}

/** The tree as gpuix's automation serves it, with no field values. */
export const redactTree = (json: string): string => {
  const tree = JSON.parse(json) as TreeNode | null
  if (tree === null) return json
  stripValues(tree)
  return JSON.stringify(tree)
}

/** `renderer`, as automation should see it: the tree with no field values,
 *  and secret fields' text (from `secrets`, read on each call) as bullets.
 *  Everything else is the renderer's own. */
export const redactingRenderer = <R extends object>(renderer: R, secrets: () => ReadonlyArray<string>): R => {
  const texts = (read: () => ReadonlyArray<string>) => {
    // A secret callback may acknowledge a draw. Read the snapshot afterwards,
    // so an old snapshot cannot outlive the secrets that protected it.
    const hidden = secrets()
    const list = read()
    return hidden.length === 0 ? list : list.map(text => hide(text, hidden))
  }
  const own = renderer as unknown as Record<string, (...args: Array<unknown>) => unknown>
  const overrides: Record<string, (...args: Array<unknown>) => unknown> = {
    getAutomationTree: () => redactTree(own['getAutomationTree']!.call(renderer) as string),
    getPaintedText: () => texts(() => own['getPaintedText']!.call(renderer) as Array<string>),
    getAllText: () => texts(() => own['getAllText']!.call(renderer) as Array<string>),
    getSelectedText: () => {
      const hidden = secrets()
      const selected = own['getSelectedText']!.call(renderer) as string | null
      return selected === null ? null : hide(selected, hidden)
    },
  }
  return new Proxy(renderer, {
    get: (target, key) => {
      if (typeof key === 'string' && key in overrides && typeof own[key] === 'function') return overrides[key]
      const value = Reflect.get(target, key, target) as unknown
      return typeof value === 'function' ? (value as (...args: Array<unknown>) => unknown).bind(target) : value
    },
  })
}
