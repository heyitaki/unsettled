import type { SpecialBuildRule } from '../model/game'
import { activeTab, useStore } from './store'

const SPECIAL_TIMINGS = [
  { value: 'everyTurn', label: 'Every turn', hint: 'After each turn, every other player may build.' },
  { value: 'across', label: 'Across', hint: 'After each turn, the player three seats back may build, as if on a four player board.' },
] as const
const SPECIAL_WHO = [{ value: 'overSeven', label: 'Over 7 cards' }, { value: 'always', label: 'Anyone' }] as const

/** The special build rule, asked on Finish import and kept in Players for five and six seat games. */
export function SpecialBuildSetting({ rule, choose }: { rule: SpecialBuildRule | null; choose(rule: SpecialBuildRule | null): void }) {
  const pill = (selected: boolean, label: string, onClick: () => void) => <button key={label} type="button"
    className={`choice-pill${selected ? ' selected' : ''}`} aria-pressed={selected} onClick={onClick}>{label}</button>
  return <section className="special-build-setting" role="group" aria-label="Special build">
    <div className="import-question-label">Special build · Can others build between turns?</div>
    <div className="import-choices">
      {pill(rule === null, 'Off', () => choose(null))}
      {pill(rule !== null, 'On', () => choose(rule ?? { timing: 'everyTurn', who: 'always' }))}
    </div>
    {rule && <>
      <section role="group" aria-label="Special build timing">
        <div className="import-question-label">When?</div>
        <div className="import-choices">
          {SPECIAL_TIMINGS.map(({ value, label }) => pill(rule.timing === value, label, () => choose({ ...rule, timing: value })))}
        </div>
        <p className="hint import-choice-hint">{SPECIAL_TIMINGS.find(({ value }) => value === rule.timing)?.hint}</p>
      </section>
      <section role="group" aria-label="Who can special build">
        <div className="import-question-label">Who can build?</div>
        <div className="import-choices">
          {SPECIAL_WHO.map(({ value, label }) => pill(rule.who === value, label, () => choose({ ...rule, who: value })))}
        </div>
      </section>
    </>}
  </section>
}

/** The active game's rule in Players, an undoable game commit; five and six seat games only. */
export function GameSpecialBuild() {
  const { state, dispatch } = useStore()
  const { game } = activeTab(state)
  if (game.board.players.length < 5) return null
  const choose = (rule: SpecialBuildRule | null) => {
    const { specialBuild: _rule, ...rest } = game
    dispatch({ type: 'commit-game', game: rule ? { ...rest, specialBuild: rule } : rest })
  }
  return <SpecialBuildSetting rule={game.specialBuild ?? null} choose={choose} />
}
