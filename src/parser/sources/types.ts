import type { Game } from '../../model/game'
import type { Rect } from '../image'

export interface ParseIssue {
  stage: 'registration' | 'sharpness' | 'tokens' | 'ports' | 'roster' | 'pieces' | 'stats' | 'ocr'
  severity: 'warning' | 'unreadable'
  message: string
  ref?: string
}

export type SourceParse =
  | { ok: true; game: Game; issues: ParseIssue[]; nameRects: { playerId: string; rect: Rect }[] }
  | { ok: false; error: string }
