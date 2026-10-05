import { expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { collectStateRules, stateStyles } from '../src/style.ts'

test('negated focus state does not produce an invalid native state selector', () => {
  const window = new Window()
  const style = window.document.createElement('style')
  style.textContent = '.button:not(:focus-visible) { color: red; }'
  window.document.head.appendChild(style)
  const button = window.document.createElement('button')
  button.className = 'button'
  const rules = collectStateRules(window.document as unknown as Document)
  expect(() => stateStyles(button as unknown as Element, rules, () => '')).not.toThrow()
  expect(rules).toEqual([])
  window.close()
})

test('functional selector lists and escaped class names keep their syntax', () => {
  const window = new Window()
  const style = window.document.createElement('style')
  style.textContent = '.button:is(.primary, .secondary):hover, .hover\\:button:hover { color: red; }'
  window.document.head.appendChild(style)
  const rules = collectStateRules(window.document as unknown as Document)
  expect(rules.map(rule => rule.base)).toEqual(['.button:is(.primary, .secondary)', '.hover\\:button'])
  const button = window.document.createElement('button')
  button.className = 'button primary'
  expect(stateStyles(button as unknown as Element, rules, () => '').hover?.color).toBe('red')
  window.close()
})
