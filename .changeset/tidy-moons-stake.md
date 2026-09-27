---
'penumbra-veil': patch
---

Correct the staking-APY model on the tokenomics page and add measured per-validator yields to the explorer.

- Tokenomics: read staking and LQT issuance from the chain's own `distributions_params` (app gRPC) and annualize with the empirically measured block cadence, instead of inferring issuance from indexed supply deltas with a hard-coded block time. Staking APY is stated as gross issuance over active bonded stake: the per-block budget is fixed, so the per-staker rate falls as more UM is bonded rather than scaling with participation.
- Explorer validators: add `Est. APY (net)` (budget APY less validator commission) and `Realized (30d)` (annualized exchange-rate growth measured from indexed snapshots) columns, both sortable, and a per-validator yield panel that compares the two against UM supply growth — the return over simply holding UM. Unmeasurable history renders as "no indexed history" instead of a fabricated number.
- Degrade reads against unreachable or partially indexed databases instead of failing the page, and cover the snapshot math with a fixture-backed regression test.
