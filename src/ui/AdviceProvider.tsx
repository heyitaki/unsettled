import { useLayoutEffect, useState, type ReactNode } from 'react'
import { createAdviceClient } from './adviceClient'
import { activeTab, useStore } from './store'
import { AdviceContext } from './useAdvice'

export function AdviceProvider({ children }: { children: ReactNode }) {
  const { state } = useStore()
  const game = activeTab(state).game
  const [client] = useState(() => createAdviceClient(() =>
    new Worker(new URL('../engine/advice/advice.worker.ts', import.meta.url), { type: 'module' })))

  // Cancel before children's passive effects request advice for the new game.
  useLayoutEffect(() => () => client.cancelAll(), [client, game, state.activeTabId])
  useLayoutEffect(() => () => client.dispose(), [client])
  return <AdviceContext.Provider value={client}>{children}</AdviceContext.Provider>
}

