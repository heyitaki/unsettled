import { useEffect, useRef } from 'react'
import type { Game } from '../model/game'
import { ImportQuestionStep } from './ImportQuestionStep'
import { settleImport } from './importQuestions'
import { LedgerPanel } from './LedgerPanel'
import { activeTab, useStore, type HighlightMark } from './store'

export function ImportReviewPanel({ className }: { className: string }) {
  const { state, dispatch } = useStore()
  const game = activeTab(state).game
  const read = game.pendingImport!
  // Whether the board shows this card's marks, so an import issue's highlight is never cleared by an empty set.
  const marked = useRef(false)
  const mark = (marks: HighlightMark[]) => {
    if (marks.length === 0 && !marked.current) return
    marked.current = marks.length > 0
    dispatch({ type: 'highlight', marks: marked.current ? marks : null })
  }
  useEffect(() => () => {
    if (marked.current) dispatch({ type: 'highlight', marks: null })
  }, [dispatch])
  const finish = (next: Game) => {
    const { pendingImport: _pending, ...resolved } = next
    dispatch({ type: 'commit-game', game: resolved })
  }
  return (
    <>
      <LedgerPanel className={className} importing />
      <section className={`${className} best-moves-panel import-review-panel`}>
        <div className="panel-heading"><h2>Finish import</h2></div>
        <ImportQuestionStep game={game} read={read} onMarks={mark}
          onDone={(answers) => finish(settleImport(game, read, answers))} onSkip={() => finish(game)} />
      </section>
    </>
  )
}
