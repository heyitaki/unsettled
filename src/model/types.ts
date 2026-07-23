export const RESOURCES = ['wood', 'sheep', 'wheat', 'brick', 'ore'] as const
export type Resource = (typeof RESOURCES)[number]
export type TileKind = Resource | 'desert'
export type LayoutId = 'standard4' | 'extension6'

export interface AxialCoord {
  q: number
  r: number
}

export type VertexId = `v:${string}`
export type EdgeId = `e:${string}`

export interface Hex {
  coord: AxialCoord
  tile: TileKind | null
  numberToken: number | null
}

export interface Port {
  edgeId: EdgeId
  resource: Resource | null
  rate: number
}

export type BuildingTier = 'settlement' | 'city' | 'superCity'
export type PieceTier = 'road' | BuildingTier

export interface Road {
  edgeId: EdgeId
  playerId: string
}

export interface Building {
  vertexId: VertexId
  playerId: string
  tier: BuildingTier
}

export interface Player {
  id: string
  name: string
  color: string
}

export interface Board {
  schemaVersion: 1
  layout: LayoutId
  hexes: Hex[]
  ports: Port[]
  robber: AxialCoord | null
  roads: Road[]
  buildings: Building[]
  players: Player[]
  mePlayerId: string | null
}

export interface Issue {
  severity: 'error' | 'warning'
  code: string
  message: string
  ref?: string
}

export const PLAYER_PALETTE = {
  red: '#c23f38',
  blue: '#3063ba',
  orange: '#e58331',
  white: '#ffffff',
  green: '#5d9e52',
  brown: '#7a5230',
} as const

export type PlayerPaletteName = keyof typeof PLAYER_PALETTE
