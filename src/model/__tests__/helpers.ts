import { setHexTile, setNumberToken } from '../board'
import type { AxialCoord, Board, TileKind } from '../types'

export function setTile(
  board: Board,
  coord: AxialCoord,
  tile: TileKind | null,
  numberToken: number | null = null,
): Board {
  const withTile = setHexTile(board, coord, tile)
  return setNumberToken(withTile, coord, tile === 'desert' ? null : numberToken)
}
