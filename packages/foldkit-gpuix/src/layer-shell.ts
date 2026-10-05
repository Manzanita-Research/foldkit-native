// LAYER SHELL
//
// A window that is a bar along a screen edge: on Wayland, a wlr-layer-shell
// surface the compositor anchors to that edge and stretches along it, with
// an exclusive zone so other windows keep clear of it; elsewhere (macOS,
// Windows, X11), where gpuix ignores `layerShell`, a small window of the
// same shape. One options object, for `mountGpuix`:
//
//   const app = mountGpuix({ ...bar({ appId: 'dev.example.bar', edge: 'top', thickness: 36 }), css })
//
// On Wayland the compositor decides the length along the edge (the output's
// width for a top bar), and the adapter follows the size it gives as a
// resize, as with any window.

import type { LayerShellOptions, WindowOptions } from '@gpuix/native'

export type Edge = 'top' | 'bottom' | 'left' | 'right'

export type BarOptions = Readonly<{
  /** Wayland's app_id (and the window's class elsewhere): compositor rules
   *  find the bar by it. */
  appId: string
  /** The edge it sits on. Default `top`. */
  edge?: Edge
  /** Its size across the edge, in logical pixels: a top bar's height. Default 36. */
  thickness?: number
  /** Keep other windows clear of it (an exclusive zone of its thickness).
   *  Default true; false lets it overlap them. */
  exclusive?: boolean
  /** The layer-shell namespace, for compositor rules. Default the appId. */
  namespace?: string
  /** Which layer it's drawn in. Default `top`, over ordinary windows. */
  layer?: 'background' | 'bottom' | 'top' | 'overlay'
  /** Whether it takes the keyboard. Default `on-demand`: when it's clicked,
   *  so its buttons work from the keyboard too; never otherwise. */
  keyboard?: 'none' | 'on-demand' | 'exclusive'
  /** Where it isn't a layer surface: its length along the edge, in logical
   *  pixels. Default 720. */
  fallbackLength?: number
  /** The window's title, where it has one. Default the namespace. */
  title?: string
}>

const ACROSS: Readonly<Record<Edge, readonly [Edge, Edge]>> = {
  top: ['left', 'right'], bottom: ['left', 'right'], left: ['top', 'bottom'], right: ['top', 'bottom'],
}

/** The window options for a bar on `edge`: a layer surface on Wayland, a
 *  small fixed window of the same shape elsewhere. */
export const bar = (options: BarOptions): WindowOptions & { layerShell: LayerShellOptions } => {
  const { appId, edge = 'top', thickness = 36, exclusive = true, layer = 'top', keyboard = 'on-demand', fallbackLength = 720 } = options
  const namespace = options.namespace ?? appId
  const horizontal = edge === 'top' || edge === 'bottom'
  return {
    appId,
    title: options.title ?? namespace,
    width: horizontal ? fallbackLength : thickness,
    height: horizontal ? thickness : fallbackLength,
    resizable: false,
    layerShell: {
      namespace,
      layer,
      // The edge and both ends of it: stretched along the edge.
      anchor: [edge, ...ACROSS[edge]],
      exclusiveZone: exclusive ? thickness : -1,
      exclusiveEdge: edge,
      keyboardInteractivity: keyboard,
    },
  }
}

/** Whether gpuix would open a layer surface here: Linux, on Wayland. */
export const isLayerShell = (env: Readonly<Record<string, string | undefined>> = process.env, platform: string = process.platform) =>
  platform === 'linux' && (env['WAYLAND_DISPLAY'] ?? '') !== ''
