# Post-draft move adviser — specification

Status: built and landed on main. The sections below describe the adviser as shipped.

## Goal

When the draft is complete, Best picks becomes Best moves. The panel tracks the game turn by turn for every player and advises whoever's turn it is. The advice is the existing Rust turn policy (`simulator/crates/engine/src/policy/`) compiled to WebAssembly and run in a worker. Settlement picks stayed on the TypeScript engine when this was built and have since moved into the same `engine.wasm`: Best picks is its `analyze` export, `simulator/crates/engine/src/placement/analysis.rs`, and the TypeScript analysis is deleted.

## Findings that shape the plan

- The engine crate already compiles for `wasm32-unknown-unknown` unchanged (checked 2026-10-10, cargo 1.94.0). `std::fs` in `policy/params_file.rs` is inside `#[cfg(test)]` only.
- `programme.md` names no other reference policy, so the adviser runs `heuristic-v1-trader-aware-threat-devcards-denial` with `HeuristicParams::default()` plus that kind's four default gates.
- `heuristic_v1::recommend` scores builds, the dev card buy, bank trades, the knight and Pass. Trade offers are chosen separately in `heuristic_v1_trader::action`, and Road Building, Year of Plenty and Monopoly are only ever chosen by `pre_roll`. The bridge joins these without changing any score.
- Nothing in the policy reads `GameState::round` or `current_seat`, so both default with no effect on advice.
- A rival's cards are read two ways only: the hand total, and `BeliefState` bounds per resource. A rival's dev cards are read only as a count.
- `trade::acceptance_probability` is the one `exp()` on any adviser path, and `respond_trade` then draws a random number against it. `exp` is the kind of call that can differ in the last bit between native and wasm.
- The policy models a player trade only as one or two cards of one resource for one card of another.
- Phone work is approved from a rendered mock-up, not from prose (process note in project memory).

## Decisions

### The active player

One notion, stored in the game: `turn.playerId` is whose turn it is, whose advice is shown, and who the action bar acts for. `End turn` moves it to the next seat. Tapping a circle in the turn-order row sets it directly. The claimed player (`mePlayerId`) stays who you are: your cards are exact, and yours are the dev cards known by type.

```ts
turn?: {
  playerId: string
  rolled: number | null   // this turn's dice total, null before the roll
  devPlayed: boolean      // a dev card was played this turn
  progressPlayed: Record<Exclude<DevKind, 'knight'>, number>  // progress cards recorded as played all game, by kind: they have left the deck
}
```

Optional, following `awards?`. Absent means the claimed player's turn, not yet rolled.

### State the policy reads that `Game` lacks

| Gap | Resolution | Shown in panel |
| --- | --- | --- |
| Whose turn, who decides | `turn.playerId`, sent to the bridge as `observer`. | the turn-order row |
| Round, current seat | Defaulted to 0; no policy reads them. | no |
| Bank stock | Derived: rule supply minus every known card. Cards in `handUnknown` are not subtracted. | `Bank estimated: N cards of unknown type` when any `handUnknown` > 0 |
| Dev deck remaining | Derived: deck size minus cards held by all players, minus knights played. Progress cards played are counted once they are recorded through the action bar; earlier ones are not known. | `Dev deck: N left` |
| My dev cards by type, bought this turn | `Game.devHand` (below). Absent: no playable cards. | the table's dev cell |
| Dev card already played this turn | `turn.devPlayed`. | no |
| The deciding player's hand | Exact for the claimed player. For a rival, the known cards only. | `N of Red's cards are of unknown type and ignored` |
| Other players' hands by resource | Belief bounds: lower = `hand[r]`, upper = `hand[r] + handUnknown`, total = both. | the table shows the same range |
| Other players' dev cards | Count from `stats.devCards`; knights from `stats.knights`. | the table |
| Dev cards of unknown type held by the deciding player (any rival, or the claimed player before their cards are entered by type) | Counted as knights bought this turn: held, not playable. This shifts the dev card buy score slightly. | `Red's 2 dev cards are treated as unplayed knights`, or for the claimed player `Set your dev cards by type in the table` |
| Awards | `Game.awards` when set; the engine's own rule when absent. | the table |
| Offers already made this turn | Defaulted to 0. | no |
| Player trading | `RuleConfig::player_trading = Some(TradeConfig::default())`, set by the bridge. | no |

### `Game.devHand`

```ts
devHand?: {
  playerId: string
  playable: Record<DevKind, number>   // knight | roadBuilding | yearOfPlenty | monopoly
  bought: Record<DevKind, number>     // bought this turn, not yet playable
}
```

Optional, validated with exact keys and a roster check, carried by backups because they serialize whole games. Read only while `playerId` is the claimed player. VP cards stay in `stats.vpCards`. Edits keep `stats.devCards` equal to the sum of both records so every existing reader stays right. Ending that player's turn moves `bought` into `playable`.

### Card ranges

`hand` is what a player is known to hold by resource and `handUnknown` is how many more cards they hold of a type nobody saw. A resource's range is `hand[r]` to `hand[r] + handUnknown`. Recorded actions narrow it:

- A card gained in the open (production, a bank trade, Year of Plenty, a trade) adds to `hand[r]`.
- A card spent in the open (a build, a dev card buy, a trade) comes off `hand[r]` first and off `handUnknown` when `hand[r]` is empty.
- A card lost unseen (a steal between two rivals, a rival's discard entered without types) lowers every `hand[r]` by one, floor zero, lowers the total by one, and puts the difference in `handUnknown`.
- A steal that involves the claimed player names its resource.

ponytail: the upper bound is always lower plus unknown. Storing an upper bound per resource would keep "nobody has wood after that Monopoly"; add it if the ranges prove too loose.

### Panel structure

Heading, turn-order row, standings table, action bar, the open action's own controls, recommendations, notes. The same component renders in both trees.

- **Turn order** replaces the draft ribbon once the draft is complete: one circle per player in seat order, the active player ringed. Nothing marks the claimed player there; the draft ribbon lost its dot too.
- **Standings table**: one row per player. A `Cards` view shows each resource (a number, or a range), the hand total and dev cards. A `Points` view shows settlements, cities, road length, knights, VP cards and the total, with the award holders marked. Tapping a row opens that player's stepper chips for corrections. Under it, the claimed player's dev cards by type as chips in three states (playable, none held, bought this turn as a faded grey outline with no label). It sits on the main page in both trees, and its row editor is the only place a player's card and knight counts are edited.
- **Action bar**: Roll, Trade, Build, Buy dev card, Play dev card, End turn. Each acts for the active player; selecting one opens its controls.
  - Roll: eleven totals. Any total but seven asks the bridge for production and credits every player's `hand`. A seven lists every player holding more than seven cards with a discard to record (advised for each, typed for the claimed player, untyped by default for rivals), then the robber move.
  - Trade: the other party (bank or port at the active player's rate, or a player), what is given and what is received. When the claimed player is the one answering and the shape is one the policy models, the verdict is shown before recording.
  - Build: road, settlement or city, then the spot on the board; the cost is deducted.
  - Buy dev card: the cost is deducted; the claimed player says what was drawn.
  - Play dev card: Knight (robber move, knights played plus one), Road Building (two roads), Year of Plenty (two cards), Monopoly (the resource, and how many each player gave).
  - End turn: next seat, flags cleared, bought cards made playable.
- **Recommendations** are for the active player: the pre-roll line before the roll, the ranked list after it. Every one has Apply. Apply commits when the bridge's answer is the whole fact (a build, a bank trade, a discard, Year of Plenty, Pass ends the turn). Otherwise it opens the matching action with the advice filled in, for the one thing only the table knows: who accepted an offer, what was drawn, what was stolen, how many cards a Monopoly took.
- Each recorded action is one `commit-game`, so one undo takes it back.
- Selecting a recommendation pins its mark with the Best picks rules. A robber destination is a ring on a hex, which is a new mark kind.
- Scores are shown as the policy's raw numbers.
- The heading holds the store's Undo and Redo, drawn as straight arrows (the user's pick). Never the Unicode curved arrows.
- The surface is specified in desktop D8 and mobile S10.

### Advice surface

- Ranked list: `recommend`'s actions plus the trader's scored offers, sorted by score descending, ties in scorer order.
- Dev card line: the `pre_roll` decision, shown before the roll, and after it while no dev card has been played (a knight is left to the ranked list after the roll).
- Trade response: `accept` is `acceptance_margin > 0`, the deterministic centre of the policy's random draw. The margin is the reported score. This also keeps `exp()` off every parity path.
- Reasons: `advice.rs` builds each one-line reason from the terms the scorer already computes. `vertex_score` is split into named terms summed in the original order. No score expression changes.
- Any action that reaches the winning VP says `Wins the game` in its reason.
- Super cities: counted for production and VP by the base rules already; `legal_city` only upgrades settlements, so none is ever recommended. The panel says so.

### Build and staleness

- New `simulator/crates/wasm`: a small `cdylib` exporting `alloc(len)`, `dealloc(ptr, len)` and `advise(ptr, len)`, JSON in and out. `advise` returns a pointer to a buffer holding a 4-byte little-endian length followed by that many bytes of UTF-8 JSON, which the caller frees with `dealloc(ptr, len + 4)`. No `wasm-bindgen`, no `wasm-pack`. Best picks later added `analyze(ptr, len)` with the same buffer convention and the crate's one import, `env.progress(f64)`, to which the adviser's worker passes a no-op.
- `simulator/tools/build-wasm.sh` builds it and writes `src/engine/advice/engine.wasm` plus `engine.wasm.src-hash`, which holds a SHA-256 over the engine sources, the wasm crate, the topology files, `simulator/placement/default-weights.json`, the `simulator/placement/seat-weights` files and the workspace manifests and lock file, then a SHA-256 of the binary. `--check` recomputes both and fails on a mismatch. The CI `rust` job runs it.
- CI does not rebuild and byte-compare: identical bytes from a macOS build and a Linux build are unproven. Behavioural staleness is caught separately, because the wasm parity test and the native parity test read the same fixture.
- `npm run build` needs no Rust: the `.wasm` is a committed asset the worker loads by URL. Workbox precaches `*.wasm`.

### Parity fixture

`simulator/fixtures/advice-parity.json`: at least 20 mid-game positions, both layouts, each with native advice for all five decision kinds. A new `crates/engine/tests/advice_parity.rs` checks it natively and regenerates it on request by driving self-play through the arena's existing `_for_test` hooks with literal test seeds. This is `cargo test`, not a simulator command, and spends no seed domain. Some rival cards are moved to `handUnknown` so belief bounds are exercised, and some positions are observed from a rival's seat.

## Left as built

Deferred by choice: `pick?:` stays optional on the store (requiring it edits four older test fixtures), the advice worker is still replaced when a game changes during a request, and `adviceEnabled` is threaded through tray props. Inherited and not fixed because it would change policy scores: `etw.rs` estimates the observer's own known VP cards as unidentified dev cards.

## Out of scope

Choosing among several accepting trade partners for the active player. The `extension6` special build phase. Any change to `simulator/topology/*.json`. Boons and curses. Tuning any parameter. Player trades of more than one resource a side. Moving settlement picks to WebAssembly was out of scope here and was done afterwards as its own piece of work.

## Stop conditions

Stop and ask if wasm and native output differ on any fixture, or if a reason cannot be produced without changing a score expression.
