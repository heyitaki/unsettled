import type { Game } from '../../model/game'

export interface ParseIssue {
  stage: 'registration' | 'sharpness' | 'tokens' | 'ports' | 'roster' | 'pieces' | 'stats'
  severity: 'warning' | 'unreadable'
  message: string
  ref?: string
}

export type SourceParse =
  | { ok: true; game: Game; issues: ParseIssue[] }
  | { ok: false; error: string }
