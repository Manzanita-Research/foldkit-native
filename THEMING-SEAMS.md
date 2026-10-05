# Theming seams

FoldKit Native ships no theme and no styled components. A UI library (a
separate package, built on top) owns the looks. This page lists what the
renderer and primitives expose so that library can be deeply themeable, and
what GPUI/gpuix doesn't offer yet.

## What's exposed

### Semantic tokens, resolved at render time
- A token is a dotted name (`color.surface`, `space.3`, `radius.2`,
  `elevation.2`, `motion.duration.short`…). It becomes the CSS custom property
  `--fn-color-surface`; refer to it as `var(--fn-color-surface)` in CSS or
  `token('color.surface')` in TypeScript. Primitives accept token names wherever
  they take a value (`gap: 'space.3'`).
- Tokens live in the DOM's cascade, so they work anywhere CSS does: in
  shadows (`examples/themes.ts` takes its elevation from a token), in `:hover`
  rules, and scoped to a subtree
  (`tokensToCss(tokens, '[data-theme="night"]')`) for nested themes, all
  tested in `test/style.test.ts`.
- **Runtime switching without a restart:** `native.setTokens(next)` (or editing
  any stylesheet, or the root's `style`/`class`/`data-theme`) restyles the whole
  native tree on the next frame. Tested in `test/style.test.ts` (the mirror)
  and `packages/foldkit-gpuix/test/sheet.test.ts` and `theme-switch.test.ts`
  (FoldKit on gpuix); `examples/themes.ts` switches between two token sets.
- The package defines no token names or values. A UI library defines its own
  token schema (colour, type, spacing, radius, hairlines, elevation, glow,
  material, opacity, motion, density), and an app or user supplies values.
  Jem's existing token source (`theme/tokens.json` in nixos-config) would map
  straight onto this.

### Interaction states as stylable state
- `:hover` and `:active` rules become GPUI's own state styles (`hover`,
  `active`), so GPUI applies them natively with no round trip through the app.
- `:focus-visible` has no GPUI state: gpuix has no focus or focus-visible
  style. On FoldKit on gpuix the host matches it by input modality, as Chrome
  does, and restyles the focused element (`packages/foldkit-gpuix/README.md`,
  Focus). On the mirror, `:focus-visible` rules don't reach the screen.
- Model-driven states are attributes primitives set from `state`:
  `data-selected`, `data-disabled`, `data-dragging`, `data-pressed`,
  `data-open`, `data-current` (plus `aria-selected`/`aria-disabled`). A theme
  styles them with ordinary selectors: `[data-part="item"][data-selected]`.
- Nothing about a state's look is hard-coded; `data-disabled` only turns off
  pointer events.

### Parts (slots)
- Every primitive carries `data-fn` (which primitive) and `data-part` (a stable
  name the component author chooses: `item`, `item-label`, `toolbar`). A theme
  reaches inside a component by part name without forking it:
  `[data-part="dialog"] [data-part="title"] { … }`.
- Because parts are plain attributes, the same component and theme also work in
  a web build of the same FoldKit app.

### Materials, elevation, motion (what exists today)
- Colours (any CSS colour, alpha included), two-stop linear gradients
  (`linear-gradient(<deg>, a, b)`), opacity, one box shadow (usable as
  elevation or a soft glow), borders and per-corner radius.
- Window-level material: gpuix's `windowBackground: 'blurred'` (compositor blur
  behind a transparent window or layer surface).
- Motion: `motion` on any primitive (gpuix's animation of width,
  height, opacity, position and radius, with duration, delay and easing).
  Durations and curves can come from tokens read in TypeScript.
- Fonts: family, size, weight, line height, from tokens.

## What's missing (GPUI/gpuix or this renderer)

| Need | Status |
|---|---|
| Per-element backdrop blur ("glass") | Not in gpuix's style; only whole-window blur. Needs a GPUI/gpuix addition |
| Glow beyond one shadow; multiple shadows; inner shadows | One outer shadow only |
| Radial/conic gradients, more than two stops | Two-stop linear only (sRGB or OKLab) |
| Shaders as materials | Not exposed by gpuix (GPUI has paint APIs; would need a custom element) |
| Colour/shadow transitions (animated state changes) | `motion` covers size, position, opacity, radius; colours change instantly |
| CSS transitions/animations, `@keyframes` | Not mapped; use `motion` |
| Letter spacing, text transform, font features, italics | Not in gpuix's style (the renderer uppercases text itself) |
| Per-side border colours, dashed/dotted borders | One border colour, solid only |
| `::before`/`::after` | Not drawn on either path (FoldKit on gpuix reports them). Use a real element |
| `:checked`, `:disabled`, `:enabled` | Match in styles on FoldKit on gpuix; not mirrored. On the mirror, use state attributes |
| `:focus-within` | Matches in `querySelector` and `matches` on FoldKit on gpuix, but the sheet reports it (a state on an ancestor). Use a state attribute |
| Density as a token | Works as spacing/size tokens; no special support needed |
| Layout read-back (for popovers, menus, tooltips) | FoldKit on gpuix: from GPUI's last layout (`packages/foldkit-gpuix/README.md`, Geometry), and anchored popups are GPUI's own. The mirror: not yet (happy-dom has no layout) |
| Theme-aware images/icons (SVG with `currentColor`) | gpuix renders SVG; `currentColor` from tokens not wired yet |
