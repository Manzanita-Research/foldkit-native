// bar(): the window options for a bar along a screen edge. A layer-shell
// surface on Wayland (gpuix's `layerShell`), and elsewhere a small fixed
// window of the same shape, since gpuix ignores `layerShell` there.
import { describe, expect, test } from 'bun:test'

import { bar, isLayerShell } from '../src/index.ts'

describe('bar()', () => {
  test('a top bar by default: anchored to the top and both sides, an exclusive zone of its thickness, keys on demand', () => {
    expect(bar({ appId: 'dev.example.bar' }, false)).toEqual({
      appId: 'dev.example.bar', title: 'dev.example.bar', width: 720, height: 36, resizable: false,
      layerShell: {
        namespace: 'dev.example.bar', layer: 'top', anchor: ['top', 'left', 'right'],
        exclusiveZone: 36, exclusiveEdge: 'top', keyboardInteractivity: 'on-demand',
      },
    })
  })

  test('each edge: anchored along it, and the fallback window is its shape', () => {
    const shape = (edge: 'top' | 'bottom' | 'left' | 'right') => {
      const { width, height, layerShell } = bar({ appId: 'a', edge, thickness: 48, fallbackLength: 600 }, false)
      return { width, height, anchor: layerShell.anchor, exclusiveEdge: layerShell.exclusiveEdge }
    }
    expect(shape('bottom')).toEqual({ width: 600, height: 48, anchor: ['bottom', 'left', 'right'], exclusiveEdge: 'bottom' })
    expect(shape('left')).toEqual({ width: 48, height: 600, anchor: ['left', 'top', 'bottom'], exclusiveEdge: 'left' })
    expect(shape('right')).toEqual({ width: 48, height: 600, anchor: ['right', 'top', 'bottom'], exclusiveEdge: 'right' })
  })

  test('a layer surface asks for no length along its edge (0: the compositor chooses), only its thickness', () => {
    expect(bar({ appId: 'a', thickness: 40 }, true)).toMatchObject({ width: 0, height: 40 })
    expect(bar({ appId: 'a', edge: 'left', thickness: 40 }, true)).toMatchObject({ width: 40, height: 0 })
    expect(bar({ appId: 'a' }, isLayerShell())).toEqual(bar({ appId: 'a' }))
  })

  test('not exclusive: it asks for no space to be kept (-1); namespace, layer, keys and title as given', () => {
    expect(bar({ appId: 'a', exclusive: false, namespace: 'shell-bar', layer: 'overlay', keyboard: 'none', title: 'Bar' })).toMatchObject({
      title: 'Bar', layerShell: { namespace: 'shell-bar', layer: 'overlay', exclusiveZone: -1, keyboardInteractivity: 'none' },
    })
  })

  test('a layer surface on Linux with a Wayland display; a window anywhere else', () => {
    expect(isLayerShell({ WAYLAND_DISPLAY: 'wayland-1' }, 'linux')).toBe(true)
    expect(isLayerShell({ DISPLAY: ':0' }, 'linux')).toBe(false)
    expect(isLayerShell({ WAYLAND_DISPLAY: '' }, 'linux')).toBe(false)
    expect(isLayerShell({ WAYLAND_DISPLAY: 'wayland-1' }, 'darwin')).toBe(false)
  })
})
