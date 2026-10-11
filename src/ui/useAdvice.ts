import { createContext, useContext, useEffect, useState } from 'react'
import type { AdviceResponse, Decision } from '../engine/advice/protocol'
import type { Game } from '../model/game'
import { createAdviceClient, decisionKey } from './adviceClient'
import { activeTab, useStore } from './store'

export const AdviceContext = createContext<ReturnType<typeof createAdviceClient> | null>(null)

export function useAdviceClient() {
  const client = useContext(AdviceContext)
  if (!client) throw new Error('useAdvice must be used inside AdviceProvider')
  return client
}

export interface AdviceState {
  status: 'pending' | 'ready' | 'error'
  response?: AdviceResponse
  retry(): void
}

export function adviceResponse<K extends Decision['kind']>(
  response: AdviceResponse | undefined,
  kind: K,
): Extract<AdviceResponse, { kind: K }> | null {
  return response && 'kind' in response && response.kind === kind
    ? response as Extract<AdviceResponse, { kind: K }>
    : null
}

export function useAdvice(decision: Decision | null, observer: string | null): AdviceState {
  const client = useAdviceClient()
  const { state } = useStore()
  const { game, id: tabId } = activeTab(state)
  const key = decision === null ? '' : decisionKey(decision)
  const [attempt, setAttempt] = useState(0)
  const [completed, setCompleted] = useState<{
    game: Game; tabId: string; key: string; observer: string; attempt: number; response: AdviceResponse
  } | null>(null)

  // Callers create decision objects during render; the key changes only when their contents change.
  useEffect(() => {
    if (key === '' || observer === null) return
    let current = true
    const decision = JSON.parse(key) as Decision
    void client.request({ game, decision, observer }).then((response) => {
      if (current) setCompleted({ game, tabId, key, observer, attempt, response })
    })
    return () => { current = false }
  }, [client, game, tabId, key, observer, attempt])
  const response = decision !== null && completed?.game === game && completed.tabId === tabId
    && completed.key === key && completed.observer === observer && completed.attempt === attempt
    ? completed.response : undefined
  return {
    status: response === undefined ? 'pending' : 'error' in response ? 'error' : 'ready',
    response,
    retry: () => setAttempt((value) => value + 1),
  }
}
