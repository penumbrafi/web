# penumbra-veil

## 0.2.4

### Patch Changes

- 277ee5b: Add a "take" mode to the limit order form: type the price you want the market to reach, and the form sizes a market order that stops there.

  - The limit form gains a Take/Rest toggle. In Take mode the price field becomes a target: the side is derived from the target against mid (above buys, below sells), and pinning a side is still allowed. On-chain this submits a swap, not a resting liquidity position - it fills against the book at the batch auction's clearing price right now and opens no position, so there is nothing to close afterwards.
  - Sizing walks the visible order book from the top of the pair's ladder towards the target and fills the two amount inputs with what that costs, stopping at the level the target sits in. A target beyond the deepest level in view takes every level shown and says so; a target costing more than the balance spends the balance and warns that it moves the market only part of the way. Editing an amount by hand detaches it from the target and the form says that too.
  - Take mode withholds the ±% chips (they place a _resting_ order relative to mid) and the "crosses the spread" warning, since a take is a taker by construction. No on-chain limit price caps the fill if the book moves before the transaction lands; the summary line and the confirm modal state that plainly.

- 335f89c: Draw a live `1b` (one chain block) candle view on the trade chart, straight from the block stream.

  - New `1b` timeframe: one bar per block, keyed by the block header's time. Each block first appends a flat bar at the pair's current mid, then the block's own swap traces (from the CometBFT `NewBlock` event) replace it in place with a bar carrying the real executed price and volume. Blocks with no trade for the pair keep the flat mid bar, so the chart advances at the chain's ~6s rhythm even when pindexer's tick is late or its stream is down.
  - `1b` is a live view, not an archive: the window is not pageable (an idle block stores nothing), so infinite scroll is disabled for it and the server serves only the last ~15 minutes of block buckets, capped at 150 traded heights - the cap alone would reach back months on a pair that trades rarely.
  - `DurationWindow` gains `1b`, and the calendar-step helpers (`addDurationWindow`, gap/tail fill) are typed against `WallClockWindow` so block time can never be stepped by a fixed increment.

- ab18ac0: Correct the staking-APY model on the tokenomics page and add measured per-validator yields to the explorer.

  - Tokenomics: read staking and LQT issuance from the chain's own `distributions_params` (app gRPC) and annualize with the empirically measured block cadence, instead of inferring issuance from indexed supply deltas with a hard-coded block time. Staking APY is stated as gross issuance over active bonded stake: the per-block budget is fixed, so the per-staker rate falls as more UM is bonded rather than scaling with participation.
  - Explorer validators: add `Est. APY (net)` (budget APY less validator commission) and `Realized (30d)` (annualized exchange-rate growth measured from indexed snapshots) columns, both sortable, and a per-validator yield panel that compares the two against UM supply growth — the return over simply holding UM. Unmeasurable history renders as "no indexed history" instead of a fabricated number.
  - Degrade reads against unreachable or partially indexed databases instead of failing the page, and cover the snapshot math with a fixture-backed regression test.

- Updated dependencies [d170339]
- Updated dependencies [8920434]
- Updated dependencies [a05953a]
- Updated dependencies [a6b95be]
- Updated dependencies [1f2d5d6]
  - @penumbra-zone/ui@16.0.4
  - @penumbrafi/types@38.0.0
  - @penumbra-zone/perspective@61.1.2

## 0.2.3

### Patch Changes

- 4657582: import `BigNumber` correctly
- Updated dependencies [4657582]
  - @penumbra-zone/types@36.0.0
  - @penumbra-zone/ui@16.0.3

## 0.2.2

### Patch Changes

- @penumbra-zone/ui@16.0.2

## 0.2.1

### Patch Changes

- Updated dependencies [bdb700d]
- Updated dependencies [cda1a99]
- Updated dependencies [f1e701a]
  - @penumbra-zone/types@35.0.0
  - @penumbra-zone/ui@16.0.1
  - @penumbra-zone/protobuf@11.0.0
  - @penumbra-zone/bech32m@18.0.0
  - @penumbra-zone/client@29.0.0
  - @penumbra-zone/getters@28.0.0

## 0.2.0

### Minor Changes

- 23d578b: Add additional props to Icon & TextInput

### Patch Changes

- d3b1d78: feat: establish minifront-v2 app with Transactions UI and Transfer Page
- 044daa9: Remove absoluteStrokeWidth prop from Icon
- Updated dependencies [ad72bd1]
- Updated dependencies [82700e9]
- Updated dependencies [54543d9]
- Updated dependencies [23d578b]
- Updated dependencies [9658941]
- Updated dependencies [14a8ccd]
- Updated dependencies [a42b5c2]
- Updated dependencies [d3b1d78]
- Updated dependencies [044daa9]
  - @penumbra-zone/ui@16.0.0

## 0.1.7

### Patch Changes

- Updated dependencies [82d034e]
  - @penumbra-zone/bech32m@17.0.1
  - @penumbra-zone/client@28.1.1
  - @penumbra-zone/crypto-web@46.0.1
  - @penumbra-zone/getters@27.0.1
  - @penumbra-zone/perspective@60.0.1
  - @penumbra-zone/protobuf@10.1.1
  - @penumbra-zone/transport-dom@7.5.2
  - @penumbra-zone/types@34.2.1
  - @penumbra-zone/ui@15.0.2
  - @penumbra-zone/wasm@51.0.1

## 0.1.6

### Patch Changes

- Updated dependencies [c770cd5]
- Updated dependencies [91eb242]
  - @penumbra-zone/ui@15.0.1
  - @penumbra-zone/client@28.1.0

## 0.1.5

### Patch Changes

- Updated dependencies [6de12ea]
- Updated dependencies [61270de]
- Updated dependencies [dcfbe8a]
- Updated dependencies [78e36b8]
- Updated dependencies [78e36b8]
- Updated dependencies [dcfbe8a]
- Updated dependencies [2066c86]
  - @penumbra-zone/wasm@51.0.0
  - @penumbra-zone/ui@15.0.0
  - @penumbra-zone/perspective@60.0.0

## 0.1.4

### Patch Changes

- Updated dependencies [cee8150]
  - @penumbra-zone/types@34.2.0
  - @penumbra-zone/crypto-web@46.0.0
  - @penumbra-zone/ui@14.0.4
  - @penumbra-zone/wasm@50.0.0
  - @penumbra-zone/perspective@59.0.0

## 0.1.3

### Patch Changes

- Updated dependencies [ec85373]
- Updated dependencies [cba3daf]
  - @penumbra-zone/types@34.1.0
  - @penumbra-zone/perspective@58.0.0
  - @penumbra-zone/crypto-web@45.0.0
  - @penumbra-zone/ui@14.0.3
  - @penumbra-zone/wasm@49.0.0

## 0.1.2

### Patch Changes

- Updated dependencies [dc1eb8b]
- Updated dependencies [f9cd9dd]
  - @penumbra-zone/protobuf@10.1.0
  - @penumbra-zone/types@34.0.0
  - @penumbra-zone/wasm@48.0.0
  - @penumbra-zone/bech32m@17.0.0
  - @penumbra-zone/client@28.0.0
  - @penumbra-zone/getters@27.0.0
  - @penumbra-zone/perspective@57.0.0
  - @penumbra-zone/ui@14.0.2
  - @penumbra-zone/crypto-web@44.0.0

## 0.1.1

### Patch Changes

- Updated dependencies [085e855]
  - @penumbra-zone/types@33.1.0
  - @penumbra-zone/crypto-web@43.0.0
  - @penumbra-zone/ui@14.0.1
  - @penumbra-zone/wasm@47.0.0
  - @penumbra-zone/perspective@56.0.0

## 0.1.0

### Minor Changes

- 694319c: bump registry version

### Patch Changes

- Updated dependencies [4a51a46]
- Updated dependencies [4a51a46]
  - @penumbra-zone/ui@14.0.0

## 0.0.9

### Patch Changes

- Updated dependencies [93f1d05]
- Updated dependencies [28a251c]
  - @penumbra-zone/protobuf@10.0.0
  - @penumbra-zone/types@33.0.0
  - @penumbra-zone/wasm@46.0.0
  - @penumbra-zone/ui@13.18.0
  - @penumbra-zone/bech32m@16.0.0
  - @penumbra-zone/client@27.0.0
  - @penumbra-zone/getters@26.0.0
  - @penumbra-zone/perspective@55.0.0
  - @penumbra-zone/crypto-web@42.0.0

## 0.0.8

### Patch Changes

- Updated dependencies [43249b0]
  - @penumbra-zone/wasm@45.1.0
  - @penumbra-zone/perspective@54.0.0
  - @penumbra-zone/ui@13.17.4

## 0.0.7

### Patch Changes

- @penumbra-zone/wasm@45.0.2
- @penumbra-zone/perspective@53.0.2
- @penumbra-zone/ui@13.17.3

## 0.0.6

### Patch Changes

- Updated dependencies [405b5b1]
  - @penumbra-zone/getters@25.0.1
  - @penumbra-zone/types@32.2.1
  - @penumbra-zone/ui@13.17.2
  - @penumbra-zone/perspective@53.0.1
  - @penumbra-zone/crypto-web@41.0.1
  - @penumbra-zone/wasm@45.0.1

## 0.0.5

### Patch Changes

- Updated dependencies [ce4c43e]
  - @penumbra-zone/types@32.2.0
  - @penumbra-zone/crypto-web@41.0.0
  - @penumbra-zone/ui@13.17.1
  - @penumbra-zone/wasm@45.0.0
  - @penumbra-zone/perspective@53.0.0

## 0.0.4

### Patch Changes

- 80148ae: Fix bugs related to transaction history and transaction/action views
- Updated dependencies [8e6e60c]
- Updated dependencies [80148ae]
- Updated dependencies [a5e14e9]
- Updated dependencies [b0e0eef]
- Updated dependencies [5c45f2c]
- Updated dependencies [85022e1]
- Updated dependencies [5c45f2c]
- Updated dependencies [3c48120]
  - @penumbra-zone/ui@13.17.0
  - @penumbra-zone/perspective@52.0.0
  - @penumbra-zone/types@32.1.0
  - @penumbra-zone/crypto-web@40.0.0
  - @penumbra-zone/wasm@44.0.0

## 0.0.3

### Patch Changes

- Updated dependencies [b430e10]
  - @penumbra-zone/ui@13.16.0
