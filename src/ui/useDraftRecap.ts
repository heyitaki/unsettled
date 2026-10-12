import { useEffect, useState } from 'react'
import type { Game } from '../model/game'
import { activeTab, useStore } from './store'
import { useAdviceClient } from './useAdvice'

export const RECAP_GAMES = 1000
export const RECAP_BATCH = 50

interface RecapState {
  games: number
  wins: Record<string, number>
  draws: number
  error: string | null
}

function emptyRecap(game: Game): RecapState {
  return { games: 0, wins: Object.fromEntries(game.board.players.map(({ id }) => [id, 0])), draws: 0, error: null }
}

export function useDraftRecap(enabled: boolean) {
  const client = useAdviceClient()
  const { state } = useStore()
  const { game, id: tabId } = activeTab(state)
  const [attempt, setAttempt] = useState(0)
  const [completed, setCompleted] = useState<{
    game: Game; tabId: string; attempt: number; recap: RecapState
  } | null>(null)

  useEffect(() => {
    if (!enabled) return
    let current = true
    let recap = emptyRecap(game)
    const run = async () => {
      for (let batch = 0; batch < RECAP_GAMES / RECAP_BATCH; batch += 1) {
        try {
          const response = await client.request({ game, observer: game.board.players[0].id,
            decision: { kind: 'recap', games: RECAP_BATCH, batch } })
          if (!current) return
          if ('error' in response) {
            recap = { ...recap, error: response.error }
          } else if (response.kind !== 'recap') {
            recap = { ...recap, error: 'Unexpected recap response' }
          } else {
            recap = { games: recap.games + response.games, draws: recap.draws + response.draws, error: null,
              wins: Object.fromEntries(game.board.players.map(({ id }) => [id, recap.wins[id] + response.wins[id]])) }
          }
        } catch (error) {
          if (!current) return
          recap = { ...recap, error: error instanceof Error ? error.message : 'Unable to simulate games' }
        }
        setCompleted({ game, tabId, attempt, recap })
        if (recap.error !== null) return
      }
    }
    void run()
    return () => { current = false }
  }, [client, game, tabId, attempt, enabled])

  const recap: RecapState = enabled && completed?.game === game && completed.tabId === tabId && completed.attempt === attempt
    ? completed.recap
    : emptyRecap(game)
  return { ...recap, done: recap.games === RECAP_GAMES, retry: () => setAttempt((value) => value + 1) }
}
