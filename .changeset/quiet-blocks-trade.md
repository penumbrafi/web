---
'penumbra-veil': patch
---

Draw a live `1b` (one chain block) candle view on the trade chart, straight from the block stream.

- New `1b` timeframe: one bar per block, keyed by the block header's time. Each block first appends a flat bar at the pair's current mid, then the block's own swap traces (from the CometBFT `NewBlock` event) replace it in place with a bar carrying the real executed price and volume. Blocks with no trade for the pair keep the flat mid bar, so the chart advances at the chain's ~6s rhythm even when pindexer's tick is late or its stream is down.
- `1b` is a live view, not an archive: the window is not pageable (an idle block stores nothing), so infinite scroll is disabled for it and the server serves only the last ~15 minutes of block buckets.
- `DurationWindow` gains `1b`, and the calendar-step helpers (`addDurationWindow`, gap/tail fill) are typed against `WallClockWindow` so block time can never be stepped by a fixed increment.
