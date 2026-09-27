---
'penumbra-veil': patch
---

Add a "take" mode to the limit order form: type the price you want the market to reach, and the form sizes a market order that stops there.

- The limit form gains a Take/Rest toggle. In Take mode the price field becomes a target: the side is derived from the target against mid (above buys, below sells), and pinning a side is still allowed. On-chain this submits a swap, not a resting liquidity position - it fills against the book at the batch auction's clearing price right now and opens no position, so there is nothing to close afterwards.
- Sizing walks the visible order book from the top of the pair's ladder towards the target and fills the two amount inputs with what that costs, stopping at the level the target sits in. A target beyond the deepest level in view takes every level shown and says so; a target costing more than the balance spends the balance and warns that it moves the market only part of the way. Editing an amount by hand detaches it from the target and the form says that too.
- Take mode withholds the ±% chips (they place a _resting_ order relative to mid) and the "crosses the spread" warning, since a take is a taker by construction. No on-chain limit price caps the fill if the book moves before the transaction lands; the summary line and the confirm modal state that plainly.
