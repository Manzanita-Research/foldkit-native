// A made-up music library: 10,000 tracks, generated from a fixed seed, so
// every run (and every test) sees the same rows. No network, no files.

export type Track = Readonly<{
  id: number
  title: string
  artist: string
  album: string
  genre: string
  year: number
  /** Length in seconds. */
  seconds: number
}>

export const TRACK_COUNT = 10_000

/** mulberry32: a small, fast, seeded PRNG. Same seed, same library. */
const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const ADJECTIVES = [
  'Velvet', 'Neon', 'Quiet', 'Golden', 'Broken', 'Electric', 'Hollow', 'Paper',
  'Midnight', 'Silver', 'Crimson', 'Northern', 'Slow', 'Wild', 'Glass', 'Distant',
  'Lucky', 'Sunday', 'Static', 'Lonely', 'Burning', 'Secret', 'Endless', 'Faded',
  'Cosmic', 'Little', 'Summer', 'Winter', 'Analog', 'Tender',
]
const NOUNS = [
  'Highway', 'Garden', 'Satellite', 'River', 'Heart', 'Signal', 'Morning', 'Ocean',
  'Machine', 'Letters', 'Window', 'Echo', 'Harbor', 'Dream', 'Fever', 'Lights',
  'Mirror', 'Thunder', 'Avenue', 'Silence', 'Horizon', 'Parade', 'Season', 'Ghost',
  'Engine', 'Island', 'Weather', 'Static', 'Valley', 'Comet',
]
const TITLE_SHAPES: ReadonlyArray<(a: string, n: string, m: string) => string> = [
  (a, n) => `${a} ${n}`,
  (a, n) => `The ${a} ${n}`,
  (_, n, m) => `${n} of the ${m}`,
  (a, n) => `${n} (${a} Mix)`,
  (a) => `${a}`,
  (_, n, m) => `${n} & ${m}`,
]
const FIRST = [
  'Ada', 'Miles', 'Nina', 'Otis', 'June', 'Ravi', 'Lena', 'Theo', 'Mara', 'Felix',
  'Iris', 'Hugo', 'Zora', 'Elio', 'Noor', 'Sami', 'Ines', 'Kai', 'Rosa', 'Arlo',
]
const LAST = [
  'Vance', 'Okafor', 'Lindqvist', 'Moreau', 'Tanaka', 'Reyes', 'Castellan', 'Hale',
  'Novak', 'Achebe', 'Brandt', 'Quinn', 'Soto', 'Marlowe', 'Ibsen', 'Kowalski',
]
const BANDS = [
  'The Paper Kites', 'Glass Animals', 'Night Swimmers', 'Low Orbit', 'The Static Hearts',
  'Velvet Machine', 'Northern Lights Club', 'Satellite Choir', 'The Slow Rivers',
  'Golden Hour', 'Analog Ghosts', 'Comet Parade', 'The Hollow Season', 'Echo Harbor',
]
const GENRES = ['Indie', 'Jazz', 'Electronic', 'Folk', 'Soul', 'Ambient', 'Rock', 'Hip-Hop', 'Classical', 'Pop']

const pick = <A>(next: () => number, from: ReadonlyArray<A>): A => from[Math.floor(next() * from.length)]!

const generate = (): ReadonlyArray<Track> => {
  const next = random(20251004)
  // Artists first, each with a handful of albums, so the same artist and
  // album repeat across rows the way a real library does.
  const artists = Array.from({ length: 400 }, () =>
    next() < 0.35 ? pick(next, BANDS) : `${pick(next, FIRST)} ${pick(next, LAST)}`)
  const albums = artists.map(() =>
    Array.from({ length: 1 + Math.floor(next() * 4) }, () => `${pick(next, ADJECTIVES)} ${pick(next, NOUNS)}`))
  return Array.from({ length: TRACK_COUNT }, (_, id) => {
    const artistIndex = Math.floor(next() * artists.length)
    const title = pick(next, TITLE_SHAPES)(pick(next, ADJECTIVES), pick(next, NOUNS), pick(next, NOUNS))
    return {
      id,
      title,
      artist: artists[artistIndex]!,
      album: pick(next, albums[artistIndex]!),
      genre: pick(next, GENRES),
      year: 1962 + Math.floor(next() * 63),
      seconds: 95 + Math.floor(next() * 330),
    }
  })
}

export const TRACKS: ReadonlyArray<Track> = generate()

/** Lowercased search text per track, built once. */
const HAYSTACKS: ReadonlyArray<string> = TRACKS.map(track =>
  `${track.title}\n${track.artist}\n${track.album}\n${track.genre}`.toLowerCase())

let lastQuery: string | undefined
let lastMatches: ReadonlyArray<Track> = TRACKS

/** The tracks whose title, artist, album or genre contains every word of the
 *  query, in library order. Remembers the last answer: `update` and `view` ask
 *  for the same query many times per keystroke. */
export const matching = (query: string): ReadonlyArray<Track> => {
  if (query === lastQuery) return lastMatches
  const words = query.toLowerCase().split(/\s+/).filter(word => word.length > 0)
  lastQuery = query
  lastMatches = words.length === 0
    ? TRACKS
    : TRACKS.filter((_, i) => words.every(word => HAYSTACKS[i]!.includes(word)))
  return lastMatches
}

/** 245 → "4:05". */
export const formatLength = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

/** 10000 → "10,000", without depending on the platform's locale data. */
export const formatCount = (count: number): string =>
  String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
