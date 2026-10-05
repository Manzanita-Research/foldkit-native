import { expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { collectStateRules, stateStyles } from '../src/style.ts'
import { mountFake } from './support/mount.ts'

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


test('unsupported nested, ancestor and combined states are not broadened', () => {
  const window = new Window()
  try {
    const style = window.document.createElement('style')
    style.textContent = `
      .button:not(:focus-visible) { color: red; }
      .button:not(:focus-visible):hover { color: red; }
      .button:is(:hover, .primary) { color: red; }
      .button:where(:active):hover { color: red; }
      .group:hover .button { color: red; }
      .group:hover .button:hover { color: red; }
      .button:hover:active { color: red; }
      .button:hover::before { color: red; }
    `
    window.document.head.appendChild(style)
    expect(collectStateRules(window.document as unknown as Document)).toEqual([])
  } finally {
    window.close()
  }
})

test('commas and state text inside quoted attributes and escaped names stay literal', () => {
  const window = new Window()
  try {
    const style = window.document.createElement('style')
    style.textContent = String.raw`.button[data-label="a,b):hover"]:hover, .comma\,button:hover, .literal\:hover { color: red; }`
    window.document.head.appendChild(style)
    const rules = collectStateRules(window.document as unknown as Document)
    expect(rules.map(rule => rule.base)).toEqual(['.button[data-label="a,b):hover"]', String.raw`.comma\,button`])
    const button = window.document.createElement('button')
    button.className = 'button'
    button.setAttribute('data-label', 'a,b):hover')
    expect(stateStyles(button as unknown as Element, rules, () => '').hover?.color).toBe('red')
  } finally {
    window.close()
  }
})

test('a state-only compound retains its universal target after a combinator', () => {
  const window = new Window()
  try {
    const style = window.document.createElement('style')
    style.textContent = '.parent > :hover { color: red; } :active { color: blue; }'
    window.document.head.appendChild(style)
    const rules = collectStateRules(window.document as unknown as Document)
    expect(rules.map(rule => rule.base)).toEqual(['.parent > *', '*'])
    const parent = window.document.createElement('div')
    parent.className = 'parent'
    const button = window.document.createElement('button')
    parent.appendChild(button)
    expect(stateStyles(button as unknown as Element, rules, () => '')).toMatchObject({ hover: { color: 'red' }, active: { color: 'blue' } })
  } finally {
    window.close()
  }
})

test('negated focus CSS survives attaching and refreshing the actual DOM mirror', async () => {
  const mounted = mountFake({ css: '.button:not(:focus-visible) { color: red; } .button:hover { color: blue; }' })
  try {
    const button = mounted.document.createElement('button')
    button.className = 'button'
    button.textContent = 'Sign in'
    mounted.container.appendChild(button)
    await mounted.settle()
    expect(() => mounted.mirror.refreshStyles()).not.toThrow()
    expect(mounted.nativeOf(button).style['hover']).toEqual({ color: 'blue' })
    expect(mounted.inSync()).toBe(true)
  } finally {
    await mounted.close()
  }
})
