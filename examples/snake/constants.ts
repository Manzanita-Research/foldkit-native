// From FoldKit's examples/snake/src/constants.ts, unchanged (MIT, © 2025 Devin Jameson; see examples/FOLDKIT-LICENSE).
// https://github.com/foldkit/foldkit/tree/main/examples/snake

export const GAME = {
  GRID_SIZE: 20,
  INITIAL_POSITION: { x: 10, y: 10 },
  INITIAL_DIRECTION: 'Right',
  POINTS_PER_APPLE: 10,
} as const

export const GAME_SPEED = {
  MIN_INTERVAL: 80,
  BASE_INTERVAL: 150,
} as const
