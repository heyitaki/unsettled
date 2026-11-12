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

One notion, stored in the game: `turn.playerId` is whose turn it is, whose advice is shown, and who the recorded actions are for. `End turn` moves it to the next seat. Tapping a circle in the turn-order row sets it directly. The claimed player (`mePlayerId`) stays who you are: your cards are exact, and yours are the dev cards known by type.

```ts
turn?: {
  playerId: string
  rolled: number | null   // this turn's dice total, null before the roll
  robberMoved?: boolean   // false after a seven until its robber move is recorded; absent otherwise
  devBought?: number      // dev cards bought this turn (a rival cannot play them yet)
  devPlayed: boolean      // a dev card was played this turn
  progressPlayed: Record<Exclude<DevKind, 'knight'>, number>  // progress cards recorded as played all game, by kind: they have left the deck
}
```

Optional, following `awards?`. Absent means the claimed player's turn, not yet rolled. `robberMoved` and `devBought` are app-only: `adviceClient` drops them before a request reaches the engine, whose `Turn` rejects unknown keys.

### State the policy reads that `Game` lacks

| Gap | Resolution | Shown in panel |
| --- | --- | --- |
| Whose turn, who decides | `turn.playerId`, sent to the bridge as `observer`. | the turn-order row |
| Round, current seat | Defaulted to 0; no policy reads them. | no |
| Bank stock | Derived: rule supply minus every known card. Cards in `handUnknown` are not subtracted. | `Bank estimated: N cards of unknown type` when any `handUnknown` > 0 |
| Dev deck remaining | Derived: deck size minus cards held by all players, minus knights played. Progress cards played are counted once they are recorded in the panel; earlier ones are not known. | no (it hides `Buy card` at zero) |
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

Two sections: `Record your turn` (heading, turn-order row, context line, standings table, then the step rail with the open action's own controls), then `Best moves` (recommendations, notes). The same component renders in both trees.

- **Turn order** replaces the draft ribbon once the draft is complete: one circle per player in seat order, the active player ringed. Nothing marks the claimed player there; the draft ribbon lost its dot too.
- **Standings table**: one row per player. A `Cards` view shows each resource (a number, or a range), the hand total and dev cards. A `Points` view shows settlements, cities, road length, knights, VP cards and the total, with the award holders marked. Tapping a row opens that player's stepper chips for corrections. Under it, the claimed player's dev cards by type as chips in three states (playable, none held, bought this turn as a faded grey outline with no label). It sits on the main page in both trees, and its row editor is the only place a player's card and knight counts are edited.
- **Step rail**: Roll, then the actions (`Trade`, `Buy card`, `Play card`, `Build`, each shown only when it can happen), then End turn. Each acts for the active player, and selecting an action opens its controls.
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
- The `Record your turn` heading holds the store's Undo and Redo, drawn as straight arrows (the user's pick). Never the Unicode curved arrows.
- The surface is specified in desktop D8 and mobile S10.

### Advice surface

- Ranked list: `recommend`'s actions plus the trader's scored offers, sorted by score descending, ties in scorer order.
- Dev card line: the `pre_roll` decision, shown before the roll, and after it while no dev card has been played (a knight is left to the ranked list after the roll).
- Trade response: `accept` is `acceptance_margin > 0`, the deterministic centre of the policy's random draw. The margin is the reported score. This also keeps `exp()` off every parity path.
- Reasons: `advice.rs` builds each one-line reason from the terms the scorer already computes. `vertex_score` is split into named terms summed in the original order. No score expression changes.
- Any action that reaches the winning VP says `Wins the game` in its reason.
- Super cities: counted for production and VP by the base rules already; `legal_city` only upgrades settlements, so none is ever recommended. The panel no longer says so (removed 2026-11-12 at the owner's request).

### Build and staleness

- New `simulator/crates/wasm`: a small `cdylib` exporting `alloc(len)`, `dealloc(ptr, len)` and `advise(ptr, len)`, JSON in and out. `advise` returns a pointer to a buffer holding a 4-byte little-endian length followed by that many bytes of UTF-8 JSON, which the caller frees with `dealloc(ptr, len + 4)`. No `wasm-bindgen`, no `wasm-pack`. Best picks later added `analyze(ptr, len)` and `setup_road(ptr, len)` with the same buffer convention and the crate's one import, `env.progress(f64)`, to which the adviser's worker passes a no-op.
- `simulator/tools/build-wasm.sh` builds it and writes `src/engine/advice/engine.wasm` plus `engine.wasm.src-hash`, which holds a SHA-256 over the engine sources, the wasm crate, the topology files, `simulator/placement/default-weights.json`, the `simulator/placement/seat-weights` files and the workspace manifests and lock file, then a SHA-256 of the binary. `--check` recomputes both and fails on a mismatch. The CI `rust` job runs it.
- CI does not rebuild and byte-compare: identical bytes from a macOS build and a Linux build are unproven. Behavioural staleness is caught separately, because the wasm parity test and the native parity test read the same fixture.
- `npm run build` needs no Rust: the `.wasm` is a committed asset the worker loads by URL. Workbox precaches `*.wasm`.

### Parity fixture

`simulator/fixtures/advice-parity.json`: at least 20 mid-game positions, both layouts, each with native advice for all five decision kinds. A new `crates/engine/tests/advice_parity.rs` checks it natively and regenerates it on request by driving self-play through the arena's existing `_for_test` hooks with literal test seeds. This is `cargo test`, not a simulator command, and spends no seed domain. Some rival cards are moved to `handUnknown` so belief bounds are exercised, and some positions are observed from a rival's seat.

## Draft recap

Status: built 2026-10-12; starting hands (below) built the same day. Between the last starting settlement and the first recorded turn, the analysis panel shows each player's estimated chance of winning from the drafted position.

### When it shows

The panel is the recap when the board has tiles, `game.turn` is absent, every building is a settlement and every player owns exactly two. Any other finished draft (a recorded turn, a city, an extra or missing settlement) shows Best moves as before. `Start game` commits `setActivePlayer(game, board.players[0].id)` as one `commit-game`, which records a turn and so switches to Best moves; undo brings the recap back.

### Starting hands

The moment the last starting settlement lands, every player is dealt their starting resources into `Game.stats`, so the recap, the Players panel and the first turn all show the same hands. `Start game` changes no hand.

- `setupGrants(board)` (`src/model/board.ts`) is null unless every building is a settlement and every player owns exactly two. Otherwise it gives each player one card per resource hex touching their second settlement, taken as their second building in board order: the rule the engine's `grant_setup_resources` applies, so the dealt hands are the ones the recap simulates with. A desert or blank hex gives nothing. `awaitingFirstTurn` is this predicate plus `game.turn === undefined`.
- The deal lives in `withBoard`, the one write path for board edits, and only while `game.turn` is absent. A player whose hand still equals what the old board dealt them (all zeros when it dealt nothing) and who has no `handUnknown` cards gets what the new board deals, zeros when it deals nothing. So the last settlement deals, a step back or a removed settlement takes the cards back, and a second settlement moved to another corner swaps them.
- A hand that does not match the old board's deal is never touched: one corrected in Players, or one whose size a screenshot read. A finished draft that arrives whole (a screenshot or JSON import, a game saved before this) is not dealt on load, and `mergeScreenshot` skips the rule altogether: a later screenshot says what each hand holds now, so a dealt hand is neither cleared nor replaced by it.
- Undo and redo restore whole games, so they need nothing.
- `withBoard` still returns the same game reference when nothing changed.

### The estimate

Win chance is measured, not scored: the engine plays the game out from the drafted board many times with the adviser's reference policy in every seat and counts who wins. Turn order is part of the position, so the first seat's edge is in the number.

- New decision on the existing `advise` export: `{ kind: 'recap', games, batch }`. No new wasm export. `observer` stays in the request shape and is ignored.
- Response: `{ kind: 'recap', games, wins: { <playerId>: count }, draws }`. `wins` names every player, and the counts plus `draws` (games that hit the turn cap) sum to `games`.
- Rules and policy are the adviser's: `RuleConfig::base(layout)` with player trading on, `POLICY` in every seat, default modifiers.
- Hands: each seat is dealt the setup grant of its second settlement, taken as its second building in board order, by the same rule `setup_pick` applies (shared helper, dealt in reverse seat order). `Game.stats` is not read: the app deals the same hands by the same rule (Starting hands, above), and a screenshot gives only hand sizes.
- Game `i` of a call is seeded `derive_game_seed(RECAP_SEED, batch, i)`, so one board always gives the same numbers and batches never repeat a game. `RECAP_SEED` is a literal in the engine and spends no simulator seed domain.
- `GameArena::play_from_draft` is `prepare`, the grants, the road recompute and the same turn loop `play` runs, shared through one private function. `play` itself must not change: `bench-hashes.json` passing unregenerated is the proof.
- The request is refused with an `error` when `games` is outside 1 to 1000 or a seat does not hold exactly two settlements. The board checks the adviser already makes apply unchanged.
- Native and wasm are each deterministic but are not required to agree with each other: self-play reaches `trade::acceptance_probability`, whose `exp()` may differ in the last bit. So the recap has no row in `advice-parity.json`, and its tests assert totals and repeatability on each side separately.

### Client

`useDraftRecap` asks for `RECAP_GAMES` (1,000) in batches of `RECAP_BATCH` (50) through the advice client, up to `recapWorkers` at a time (the core count less one, capped at four), and adds the counts up as they arrive, so the percentages settle on screen. More than one puts the batches on that many extra workers, picked by batch index and stopped when the last pending batch answers. `decisionKey` includes `games` and `batch`. The client's per-game cache makes a return to the recap (an undo of `Start game`) instant. A game change cancels the run the way it cancels advice.

### Surface

One component in both trees, in place of Best moves:

- Heading `Draft recap`, with the same `Undo` and `Redo` buttons as `Record your turn`.
- Approved mock-up (2026-11-12): the `Draft recap · proposed` artboard on the `Recap and ports` page of https://claude.ai/artifact/GpfbeCAGbda2AegvcEvLKb.
- Under the heading, a header for one player: the claimed player, or the highest win chance when nobody is claimed. A muted 13px line `{name}'s win chance`, then the whole percentage at 46px weight 800, then one 14px weight 700 line in `--accent-dark`: `Leads {second} by {n} points` when that player has the highest win chance, `Trails {leader} by {n} points` when not, and `Level with {name}` when the rounded percentages are equal. Before the first batch the percentage reads `…` and the line is absent.
- Under the header, an 8px share bar split across the players in card order, each segment as wide as that player's win count, in the player's colour with 2px gaps and 4px radii; a white player's segment takes a 1px ink inset ring. Absent before the first batch.
- One card per player in a two-column grid with 10px gaps, highest win chance first, ties in turn order: the row surface, hairline border and 6px radius, 12px padding. Each card holds the rank circle in the player's colour, the name, a `YOU` tag in `--accent-dark` on the claimed player's card, the whole percentage at 26px weight 800, the player's two spots as the Best picks tile thumbnails, and the player's hand from `Game.stats` as `CardAmounts` when it holds a card. The claimed player's card takes the selected Best picks row treatment (1px accent border, 7% accent wash). Cards are not selectable and put no marks on the board. Before the first batch the percentage reads `…`.
- While batches are outstanding, the Best picks progress bar with `Simulating games…`.
- `Start game`, the primary button, as wide as the rows and enabled at all times.
- Once every game is counted, one note: `Win chance over 1,000 simulated games, every seat played by the adviser. Expect about 3 points of noise.` A second line gives the draw count when any game hit the turn cap. Neither shows mid-run, after an error or on a blocked board, where the claim would be false.
- When `adviceBlockers` is not empty the rows give way to the same `Finish the board to get advice:` list, and an engine error shows as an alert with `Retry`. `Start game` stays in both cases.

## Left as built

Deferred by choice: `pick?:` stays optional on the store (requiring it edits four older test fixtures), the advice worker is still replaced when a game changes during a request, and `adviceEnabled` is threaded through tray props. Inherited and not fixed because it would change policy scores: `etw.rs` estimates the observer's own known VP cards as unidentified dev cards.

## Out of scope

Choosing among several accepting trade partners for the active player. The `extension6` special build phase. Any change to `simulator/topology/*.json`. Boons and curses. Tuning any parameter. Player trades of more than one resource a side. Moving settlement picks to WebAssembly was out of scope here and was done afterwards as its own piece of work.

## Stop conditions

Stop and ask if wasm and native output differ on any fixture, or if a reason cannot be produced without changing a score expression.
