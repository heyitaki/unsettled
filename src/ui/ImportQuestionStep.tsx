import { useEffect, useState } from 'react'
import type { Game, ScreenshotRead } from '../model/game'
import { RESOURCES, type Board, type VertexId } from '../model/types'
import { CounterGlyph, ResourceGlyph, StructureGlyph } from './glyphs'
import { AWARDS, importQuestions, otherAward, turnOrderFrom, type ImportAnswers } from './importQuestions'
import { SpecialBuildSetting } from './SpecialBuildSetting'
import { SpotTiles } from './SpotTiles'
import type { HighlightMark } from './store'
import { vertexDescription, vertexParts } from './vertexParts'

/** The cards a second settlement on `vertexId` hands out: one per adjacent resource hex. */
function startingCards(board: Board, vertexId: VertexId) {
  const parts = vertexParts(board, vertexId)
  return RESOURCES.map((resource) => ({ resource, count: parts.filter((part) => part.kind === 'hex' && part.tile === resource).length }))
    .filter(({ count }) => count > 0)
}
export function ImportQuestionStep({ game, read, onDone, onSkip, onMarks }: {
  game: Game
  read: ScreenshotRead
  onDone(answers: ImportAnswers): void
  onSkip(): void
  /** Board marks for the answered second settlements: each player's pick numbers on their pieces. */
  onMarks?(marks: HighlightMark[]): void
}) {
  const [draft, setDraft] = useState<{ game: Game; answers: ImportAnswers }>({ game, answers: {} })
  const answers = draft.game === game ? draft.answers : {}
  const setAnswers = (answers: ImportAnswers) => setDraft({ game, answers })
  if (draft.game !== game) setAnswers({})
  const questions = importQuestions(game, read, answers)
  // Award pills offer every holder the points allow, so a wrong pair can always be switched.
  const { longestRoad: _road, largestArmy: _army, ...unawarded } = answers
  const offered = answers.longestRoad === undefined && answers.largestArmy === undefined ? questions : importQuestions(game, read, unawarded)
  const { board } = game
  const order = answers.order ?? []
  const awardAnswered = (kind: typeof AWARDS[number]) => {
    const answer = answers[kind]
    return answer !== undefined && questions[kind]?.includes(answer) === true
  }
  const invalidAwards = AWARDS.filter((kind) => answers[kind] !== undefined && !awardAnswered(kind))
  if (invalidAwards.length > 0) {
    const next = { ...answers }
    for (const kind of invalidAwards) delete next[kind]
    setAnswers(next)
  }
  const marks = questions.picks.flatMap(({ playerId, settlements }) => {
    const chosen = answers.second?.[playerId]
    const { color } = board.players.find((player) => player.id === playerId)!
    return chosen === undefined ? [] : settlements.map((vertexId) => ({ ref: vertexId, color, label: vertexId === chosen ? '2' : '1' }))
  })
  const marksKey = JSON.stringify(marks)
  // Keyed on content: the marks are rebuilt every render, and an unchanged set must not dispatch again.
  useEffect(() => onMarks?.(marks), [marksKey]) // eslint-disable-line react-hooks/exhaustive-deps
  // Done counts down the unanswered questions; the whole turn order is one question.
  const remaining = (questions.order && order.length !== board.players.length ? 1 : 0) +
    questions.picks.filter(({ playerId, settlements }) => !settlements.some((vertex) => vertex === answers.second?.[playerId])).length +
    AWARDS.filter((kind) => questions[kind] !== null && !awardAnswered(kind)).length +
    (questions.firstRound && answers.firstRound === undefined ? 1 : 0)
  const playerLabel = (id: string | null) => {
    const player = board.players.find((player) => player.id === id)
    return player ? <><span className="swatch" style={{ background: player.color }} />{player.name}</> : 'Nobody'
  }
  return (
    <div className="import-questions">
      <p className="hint">The screenshot doesn't show these. Best picks and Best moves open once they're answered.</p>
      {questions.order && <section role="group" aria-label="Turn order">
        <div className="import-question-label">{questions.order === 'first' ? 'Who went first?' : 'Tap players in turn order'}</div>
        <div className="import-choices">
          {board.players.map((player, seat) => {
            if (questions.order === 'first' && !questions.firstChoices.includes(player.id)) return null
            const index = order.indexOf(player.id)
            const selected = questions.order === 'first' ? index === 0 : index >= 0
            return <button key={player.id} type="button" className={`choice-pill${selected ? ' selected' : ''}`}
              aria-pressed={selected} onClick={() => setAnswers({ ...answers, order: questions.order === 'first'
                ? turnOrderFrom(board, seat)
                : index >= 0 ? order.slice(0, index) : [...order, player.id] })}>
              {questions.order === 'all' && index >= 0 && `${index + 1} `}{playerLabel(player.id)}
            </button>
          })}
        </div>
      </section>}
      {questions.picks.length > 0 && <section role="group" aria-label="Second settlement">
        <div className="import-question-label">Which settlement came second?</div>
        <div className="import-settlements">
          {questions.picks.map(({ playerId, settlements }) => {
            const chosen = answers.second?.[playerId]
            const { name, color } = board.players.find((player) => player.id === playerId)!
            return <div className="import-settlement" key={playerId}>
              <span className="import-question-player">
                <span className="swatch" style={{ background: color }} />
                <span className="import-player-name">{name}</span>
                {chosen !== undefined && <span className="ledger-hand import-starting-cards">
                  {startingCards(board, chosen).map(({ resource, count }) => <span className="ledger-hand-chip" key={resource} role="img" aria-label={`${count} ${resource}`}>
                    <ResourceGlyph resource={resource} />{count}
                  </span>)}
                </span>}
              </span>
              <div className="import-settlement-choices">
                {settlements.map((vertexId) => <button key={vertexId} type="button"
                  className={chosen === undefined ? undefined : chosen === vertexId ? 'chosen' : 'other'}
                  aria-pressed={chosen === vertexId}
                  aria-label={`${name}'s settlement on ${vertexDescription(board, vertexId)}`}
                  onClick={() => setAnswers({ ...answers, second: { ...answers.second, [playerId]: vertexId } })}>
                  <SpotTiles board={board} vertexId={vertexId} small />
                </button>)}
              </div>
            </div>
          })}
        </div>
      </section>}
      {questions.firstRound && <section role="group" aria-label="First round">
        <div className="import-question-label">Is this the first round?</div>
        <div className="import-choices">
          {[true, false].map((yes) => <button key={String(yes)} type="button"
            className={`choice-pill${answers.firstRound === yes ? ' selected' : ''}`} aria-pressed={answers.firstRound === yes}
            onClick={() => setAnswers({ ...answers, firstRound: yes })}>{yes ? 'Yes' : 'No'}</button>)}
        </div>
        {answers.firstRound && <p className="hint import-choice-hint">Hands start from the draft's starting cards, less any roads and dev cards bought. This assumes nobody traded, and a card the robber could have taken stays unknown.</p>}
      </section>}
      {AWARDS.map((kind) => {
        const options = questions[kind] && offered[kind]
        const label = kind === 'longestRoad' ? 'Longest road' : 'Largest army'
        // A pick that the other award's answer rules out clears that answer instead.
        const choose = (id: string | null) => {
          const next = { ...answers, [kind]: id }
          const other = otherAward(kind)
          const otherAnswer = next[other]
          if (otherAnswer !== undefined && !importQuestions(game, read, next)[other]?.includes(otherAnswer)) delete next[other]
          setAnswers(next)
        }
        return options && <section key={kind} role="group" aria-label={label}>
          <div className="import-question-label">
            <span className="ledger-medal" aria-hidden="true">{kind === 'longestRoad'
              ? <StructureGlyph shape="road" color="var(--accent)" size={14} /> : <CounterGlyph shape="knight" />}</span>
            {label} · Who holds it?
          </div>
          <div className="import-choices">
            {options.map((id) => <button key={id ?? 'nobody'} type="button"
              className={`choice-pill${answers[kind] === id ? ' selected' : ''}`} aria-pressed={answers[kind] === id}
              onClick={() => choose(id)}>{playerLabel(id)}</button>)}
          </div>
        </section>
      })}
      {questions.specialBuild && <SpecialBuildSetting rule={answers.specialBuild ?? null}
        choose={(specialBuild) => setAnswers({ ...answers, specialBuild })} />}
      <div className="confirm-actions">
        <button type="button" onClick={onSkip}>Skip</button>
        <button type="button" className="primary" disabled={remaining > 0} onClick={() => onDone(answers)}>{remaining > 0 ? `${remaining} left` : 'Done'}</button>
      </div>
    </div>
  )
}
