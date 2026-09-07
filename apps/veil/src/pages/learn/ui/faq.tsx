import { Text } from '@penumbra-zone/ui/Text';
import { LearnNav } from './learn-nav';
import { FaqEntry } from './faq-entry';

/**
 * FAQ entries. Each one carries a stable kebab-case `slug` so it can be
 * deep-linked (`/learn/faq#how-ephemeral-addresses-work`) and serialised
 * into Schema.org FAQPage JSON-LD with a per-question URL — that's what
 * lets Google split a single FAQ page into many indexable entries.
 *
 * Editorial guideline: write the way a curious-but-not-expert searcher
 * would type the question. Don't repeat the question in the answer
 * verbatim — that gets penalized as keyword-stuffing. Aim for 100–300
 * words: long enough to be authoritative, short enough that Google
 * won't truncate.
 */
interface FAQ {
  slug: string;
  q: string;
  a: string;
}

const FAQS: FAQ[] = [
  {
    slug: 'what-is-penumbra',
    q: 'What is Penumbra?',
    a: 'Penumbra is a fully-shielded proof-of-stake blockchain with a built-in private DEX. Balances, swaps, and liquidity provider (LP) positions are encrypted on-chain — only you can see your activity. The chain uses zero-knowledge proofs to validate transactions without revealing inputs, and a uniform-price batch auction to clear every block, so MEV bots cannot front-run or sandwich your trades.',
  },
  {
    slug: 'what-is-um',
    q: 'What is UM?',
    a: 'UM (also written upenumbra in atomic units) is the native token of the Penumbra blockchain. It pays for transaction fees, secures the network as the staking token, serves as the numeraire for arbitrage burns, and is the governance token. Total supply on mainnet started at ~95.3M UM and grows by a small amount each block to pay validator rewards.',
  },
  {
    slug: 'how-do-i-shield-assets',
    q: 'How do I shield assets on Penumbra?',
    a: 'Shielding means moving assets into the encrypted balance pool. The most common path is USDC over IBC from Noble, the chain that issues native USDC, straight to a Penumbra address; your wallet handles the deposit. ATOM, OSMO, TIA and any IBC asset shield the same way: send an IBC transfer from the originating Cosmos chain to your Penumbra address. After one block confirmation, the asset appears in your shielded balance and is invisible to chain analysis.',
  },
  {
    slug: 'how-does-the-penumbra-dex-work',
    q: 'How does the Penumbra DEX work?',
    a: 'The Penumbra DEX clears every block using a uniform-price batch auction. All swaps for the same pair within a block fill at one clearing price, computed from the liquidity available in concentrated-liquidity positions across multiple routes. There is no transaction ordering within the batch — every trader gets the same execution price regardless of when their swap arrived in the block. Liquidity providers post limit-order-shaped positions; the protocol routes through them automatically.',
  },
  {
    slug: 'does-penumbra-have-mev',
    q: 'Does Penumbra have MEV?',
    a: 'No, in the senses that matter. Because trades clear at a uniform price per block and inputs are encrypted until execution, the typical MEV vectors — front-running, sandwiching, priority gas auctions — have nothing to extract. When the batch auction discovers a price gap between adjacent liquidity positions, the protocol itself captures the arbitrage and burns the proceeds in UM, rather than letting a searcher take it. Validators receive only inflation rewards, not fee revenue, removing their incentive to reorder transactions.',
  },
  {
    slug: 'penumbra-mev-resistance-mechanism',
    q: 'Why is Penumbra structurally resistant to MEV like sandwich attacks?',
    a: 'Front-running and sandwich attacks rely on three conditions: a public mempool where pending trades are visible, deterministic per-transaction ordering inside a block, and the ability for searchers to insert their own transactions on either side of a target. Penumbra removes all three. Swap inputs are committed via Swap actions that reveal only the trading pair, not the amount or direction relative to a clearing price; even if an attacker sees a Swap in the mempool, they cannot read its size or know whether it moves the price up or down. Inside a block, all Swap actions on the same pair are batched and clear at a single price, so per-transaction ordering is irrelevant — being first or last in the batch yields the same execution. The two-step Swap/SwapClaim flow means the user\'s output can be claimed by anyone holding the viewing data, eliminating mempool-level claim front-running. There are no leveraged liquidations or oracle settlements ordered against user trades, because there is no shared global ledger of balances to race against. The remaining MEV surface (cross-batch arbitrage between the DEX and external venues) is captured by an arbitrage burn that returns the value to UM holders rather than to searchers.',
  },
  {
    slug: 'what-is-arbitrage-burn',
    q: 'What is arbitrage burn?',
    a: 'During each block\'s batch clearing, the protocol routes swaps through a graph of liquidity positions to find the best execution price. If the route consumes a price gap (an arbitrage opportunity), the surplus UM left over after every fill is burned — permanently removed from supply. This means a busy DEX is deflationary: the more activity, the more UM is destroyed. It also means the protocol pays itself the searcher tip that other chains hand to MEV bots.',
  },
  {
    slug: 'swap-swapclaim-flow',
    q: 'Why does Penumbra split a trade into Swap and SwapClaim actions?',
    a: 'A trade on Penumbra requires two transactions, not one. The first contains a Swap action: it burns the input asset, locks a prepaid fee, and mints a non-fungible swap commitment (sometimes called a swap NFT) that records the trading pair, input amounts, the destination address, and a random seed. The Swap reveals only that some amount was committed into the next batch on this pair — not who, not how much relative to anyone else. At the end of the block, validators aggregate every Swap on each pair into a single batch flow and execute that aggregate against the on-chain liquidity positions, producing a single clearing price for inputs and outputs. In a later transaction the user submits a SwapClaim action, which spends the swap commitment, proves in zero knowledge that the prepaid fee and the user\'s pro-rata share of the batch outputs net out correctly against the cleared price, and mints two output notes (the user\'s share of each side of the trade). This two-step design is what gives Penumbra its MEV resistance: ordering inside the batch is irrelevant because everyone gets the same price, and individual amounts stay private even though the batch total is public.',
  },
  {
    slug: 'how-um-is-issued',
    q: 'How is UM issued?',
    a: 'UM is issued only to bonded stake. Each block, validators receive a base reward proportional to the fraction of supply that is actively staked. Realized inflation today runs around 0.3%/year because participation is low; the theoretical ceiling at 100% staked is roughly 1.5–2%/year. For comparison, Bitcoin runs ~0.85%/yr post-2024 halving, ETH net issuance is ~0.4%/yr, most Cosmos chains run 7–20%, and Solana is ~5%.',
  },
  {
    slug: 'how-do-i-stake-um',
    q: 'How do I stake UM?',
    a: 'Open a Penumbra wallet (Zafu, the Penumbra Labs wallet, or any compatible client), shield some UM, then delegate to a validator. The wallet shows the active validator set with commission rates and uptime. Delegations earn the same per-block reward proportional to total active stake; choose validators based on commission and reliability. Unstaking has an unbonding delay (currently a few epochs) during which the UM stays locked but earns no rewards.',
  },
  {
    slug: 'delegation-tokens-validator-exchange-rate',
    q: 'How do delegation tokens and the validator exchange rate work?',
    a: 'When you stake on Penumbra you do not "lock" UM directly. You burn UM and mint a validator-specific delegation token, often written delUM(v), where v identifies the validator. Each validator has its own exchange rate per epoch, defined as the cumulative product of (1 + reward_rate) across all prior epochs after that validator\'s commission is taken out. Delegating x UM at one epoch yields x divided by the rate in delUM. Undelegating later returns delUM × the new rate as UM. Because rewards are realised purely as appreciation of the exchange rate, a delegator never observes a reward distribution event: their delUM balance does not change, but each delUM is worth more UM over time. Two practical consequences: first, delUM from the same validator is fungible regardless of when it was bought, which makes it trivial to trade or use as collateral; second, slashing is implemented simply by adjusting the rate downward, automatically penalising every delegator pro rata. UM income is therefore not a recurring taxable event in the usual sense — it accrues into the token itself.',
  },
  {
    slug: 'bonded-vs-active-stake',
    q: 'What is the difference between bonded stake and active stake?',
    a: 'Bonded stake is every UM currently delegated, including delegations to inactive validators, queued delegations waiting for the next epoch, and unbonding delegations. Active stake is the subset securing the chain right now — delegations to validators in the active set whose voting power counts toward consensus. The two numbers can differ by tens of percent; only active stake earns rewards.',
  },
  {
    slug: 'penumbra-unbonding-period',
    q: 'How long is the Penumbra unbonding period and what happens if my validator gets slashed during it?',
    a: 'Undelegating on Penumbra does not immediately return UM. It first converts your delegation tokens (delUM) into validator-specific unbonding tokens, which are nominally 1:1 with UM but remain bound to that validator and exposed to slashing until the unbonding period elapses. The period is denominated in epochs and set by governance; mainnet epochs are up to ~34,560 blocks (about 2 days). Unbondings are processed in a FIFO queue with a per-epoch throughput cap. If the validator is jailed for downtime during your unbonding, your tokens stay in queue and finish unbonding normally. If the validator is tombstoned for byzantine behaviour, the chain adjusts that validator\'s exchange rate downward; your unbonding tokens still convert to UM at the end of the period, but at the slashed rate, so you receive proportionally less UM. Pending undelegations against a tombstoned validator can be cancelled and immediately settled with the slashing penalty applied. Unbonding tokens are themselves liquid assets in the multi-asset pool, so anyone wanting to exit faster can sell them at a market discount that prices the remaining slashing risk.',
  },
  {
    slug: 'what-is-liquidity-tournament',
    q: 'What is the Liquidity Tournament (LQT)?',
    a: 'LQT is an epoch-based program that pays additional UM rewards to liquidity providers on selected pairs (typically UM/IBC pairs). Stakers vote to direct rewards to specific assets, and LPs on those pairs split a reward pool proportional to their share of the directed liquidity. When an epoch is live, eligible pairs show a "Rewards" badge in the trading interface.',
  },
  {
    slug: 'how-do-i-provide-liquidity',
    q: 'How do I provide liquidity?',
    a: 'Penumbra LPs post concentrated-liquidity positions: you specify a price range and a fee tier, then commit reserves in either or both assets of a pair. Each position acts like a series of limit orders within the chosen range. Earnings come from the spread on swaps that route through your position. Positions are themselves shielded — the chain doesn\'t reveal which positions belong to which user. The DEX UI under /trade has a position builder.',
  },
  {
    slug: 'concentrated-liquidity-vs-uniswap-v3',
    q: 'How is Penumbra concentrated liquidity different from Uniswap v3?',
    a: 'Both protocols let liquidity providers concentrate capital around chosen prices, but the underlying primitive is very different. Uniswap v3 positions are slices of a single shared constant-product curve bounded by tick ranges. Penumbra positions are individual constant-sum AMMs: each position is its own miniature order with a fixed exchange rate, a fee tier, and reserves of two assets. A "concentrated" position in Penumbra is just a constant-sum position at a chosen price; "ranged" liquidity is built by stacking many such positions at adjacent prices, which approximates a curve. The advantage is that the chain can route through the global graph of positions as a minimum-cost flow problem, splitting a trade across positions and chaining hops (A → B → C) algorithmically without external aggregators. Each position is owned via a Liquidity Position NFT (LPNFT) that tracks its lifecycle (Opened, Closed, Withdrawn, Claimed); the position itself is a public on-chain object, but the owner of the LPNFT is shielded inside Penumbra\'s multi-asset pool. This is closer in spirit to a shielded order book with a router on top than to a continuous AMM curve.',
  },
  {
    slug: 'penumbra-positions-vs-orderbook',
    q: 'Are Penumbra liquidity positions more like AMM ranges or limit orders?',
    a: 'Both, depending on how you use them. Each Penumbra position is a constant-sum AMM: it has a fixed price, a fee tier, and a pair of reserves. A position with reserves only on one side and a tight spread acts exactly like a limit order — it fills entirely at that price and then closes itself off. A position with reserves on both sides at the same price acts like a tight range pegged to that price. Stacking many adjacent constant-sum positions reproduces a curve like Uniswap v3\'s, but you can equally use them as resting limit orders, scaled orders, or one-sided liquidity. The on-chain router treats the global graph of positions as a min-cost flow problem and walks it to fill incoming swaps, splitting size across paths as needed. Each position is owned via an LPNFT inside the shielded pool, so the position parameters (price, reserves, fees) are public — the router needs them — but the owner is private. From a trader\'s perspective this is closer to a hybrid order book than to a pure AMM, which is also why MEV does not apply: there is no mempool, batches clear at one price, and there is no continuous trade-by-trade ordering to exploit.',
  },
  {
    slug: 'how-ephemeral-addresses-work',
    q: 'How do ephemeral addresses and diversifiers prevent linkability on Penumbra?',
    a: 'Each Penumbra spending key can derive up to 2^128 distinct payment addresses through 16-byte tags called diversifiers. A diversifier is produced by encrypting an address index under a per-account diversifier key, then mapped onto the decaf377 curve to yield a unique basepoint. Combined with the incoming viewing key, that basepoint produces a transmission key, and the address also embeds a per-address detection (clue) key. The result is a Bech32m-encoded address that is cryptographically independent of every other address derived from the same wallet. Two payments to two different diversified addresses cannot be linked by an outside observer because the transmission keys are distinct group elements with no observable relationship. Crucially, the wallet does not pay a per-address scanning cost: a single incoming viewing key trial-decrypts notes for every diversified address simultaneously. This lets users hand out a fresh address per counterparty, per IBC deposit, or per invoice without fragmenting their wallet. Penumbra frontends generate a fresh address for every inbound IBC transfer specifically so that, for example, two deposits from the same exchange cannot be tied together.',
  },
  {
    slug: 'penumbra-subaccounts-address-indexes',
    q: 'How do Penumbra sub-accounts and address indices work?',
    a: 'A single Penumbra spending key controls 2^128 distinct sub-account address spaces, each identified by a 16-byte address index. Every index produces an entirely separate diversified payment address (or family of addresses) that is publicly unlinkable from any other index under the same key. Sub-accounts are useful for organising wallet state without managing multiple seeds: index 0 is your default account, index 1 might be a trading sub-account, index 2 a savings sub-account, and so on. Each sub-account has its own balance view in the wallet, but they all share one incoming viewing key, so scanning the chain for inbound notes costs the same regardless of how many sub-accounts you use. Detection keys are unique per address index, so you can delegate FMD-style scanning of a specific sub-account to a third party without exposing the others. Internally, a transfer between two of your own sub-accounts is still a normal shielded Spend+Output and is indistinguishable from a transfer to anyone else; the sub-account boundary is purely a wallet UX construct that the chain never sees.',
  },
  {
    slug: 'viewing-keys-selective-disclosure',
    q: 'How do viewing keys enable selective disclosure on Penumbra?',
    a: 'Penumbra splits authority over an account into a hierarchy of keys so users can hand out narrowly scoped capabilities without giving up spend authority. The spending key signs transactions and can do everything. From it derives the full viewing key (FVK), which contains the spend verification key and the nullifier key; an FVK holder can see the entire transaction history (incoming and outgoing) and even regenerate ZK proofs, but cannot authorise spends. The FVK in turn yields an incoming viewing key (IVK), which scans the chain for notes sent to any of the account\'s diversified addresses and decrypts their amounts and memos. There is also an outgoing viewing key (OVK), a 32-byte secret that lets the holder recover the metadata of transactions they themselves originated. Each layer is strictly less powerful than the one above it. This means you can give a tax auditor your FVK to verify a year of activity, give a portfolio tracker your IVK to monitor inbound payments, or share an OVK with an accountant to confirm outgoing transfers, all without ever exposing the spending key.',
  },
  {
    slug: 'penumbra-fmd-detection-keys',
    q: 'What is Fuzzy Message Detection on Penumbra and why does it matter?',
    a: 'Fuzzy Message Detection (FMD) is the protocol Penumbra uses to let third-party scanning services help wallets find their notes without learning the wallet\'s full activity. Each diversified address embeds a clue key derived from a per-address detection key. When a note is created, the sender attaches a "clue" tagged with a tunable false-positive rate. A scanner given a detection key can identify which clues might be for this user but receives a controlled rate of decoys, so it cannot be sure which messages actually belong to whom. The wallet then trial-decrypts only the candidate notes locally with its incoming viewing key. This is the privacy mechanism that lets mobile wallets and lightweight clients sync without downloading and trial-decrypting every note on the chain. The trade-off is that handing one entity multiple detection keys for the same wallet does let it correlate the diversified addresses associated with those keys, so the recommended deployment is to spread detection keys across several independent scanners.',
  },
  {
    slug: 'how-nullifiers-work',
    q: 'What are nullifiers and how do they prevent double-spend without revealing notes?',
    a: 'A nullifier is a deterministic, unforgeable tag that a Penumbra spend reveals to mark its input note as consumed. It is computed as a Poseidon hash over three values: the user\'s secret nullifier key, the public note commitment, and the position of that commitment in the State Commitment Tree. Because the nullifier key is private, nobody else can compute the nullifier for someone else\'s note, and because the commitment plus position uniquely identify a single tree leaf, the same note can only ever produce one valid nullifier. The chain maintains a public set of every nullifier ever revealed; a spend is rejected if its nullifier is already in the set. The privacy property is that the nullifier reveals nothing about which commitment was spent: an observer sees a fresh-looking field element with no apparent link to any specific commitment in the tree. The spend ZK proof attests, in zero knowledge, that the nullifier was correctly derived from some real, unspent commitment in the tree owned by the prover. This is the same construction Zcash Sapling pioneered, generalised to Penumbra\'s multi-asset pool.',
  },
  {
    slug: 'tiered-commitment-tree',
    q: 'What is the Tiered Commitment Tree (TCT) and why is it tiered?',
    a: 'The Tiered Commitment Tree (TCT) is the append-only Merkle tree Penumbra uses to commit to every shielded note ever created. It is implemented as the State Commitment Tree (SCT) in the spec. Unlike a typical Sparse Merkle Tree, the TCT is structured as three nested quaternary (4-ary) trees, each 8 levels deep: a global eternity tree of up to 65,536 epoch roots, each of which contains up to 65,536 block roots, each of which contains up to 65,536 note commitments. Quaternary fan-out is chosen because, for ZK-friendly hashes like Poseidon, it minimises proof size relative to depth. Tiering matters because clients have to scan the tree locally to find their own notes and to build inclusion proofs. If a block or an entire epoch contained nothing relevant, the client can drop in a single summary hash supplied by the chain instead of hashing every leaf. That makes wallet sync linear in the user\'s own activity rather than in total chain activity. Inclusion proofs from any commitment up to the global root work the same way as in any Merkle tree: the spend circuit walks the path with Poseidon hashes and verifies the root matches the on-chain anchor.',
  },
  {
    slug: 'decaf377-vs-bls12-377',
    q: 'Why does Penumbra use decaf377 instead of raw BLS12-377?',
    a: 'BLS12-377 is the pairing-friendly curve Penumbra uses for Groth16 proofs, but Penumbra also needs an embedded elliptic curve whose base field equals BLS12-377\'s scalar field, so the curve\'s arithmetic can run cheaply inside circuits. The natural candidate is the cofactor-4 Edwards curve from the Zexe paper, but its group has a non-trivial cofactor: every downstream construction (key agreement, signatures, hash-to-group) has to remember to clear the cofactor or risk subtle attacks. decaf377 applies the Decaf construction to that same Edwards curve and exposes a prime-order group on top. The abstraction is mathematically clean: developers, auditors, and circuit designers can treat decaf377 like any other prime-order group without writing or reviewing cofactor-handling logic. Inside circuits this costs slightly more constraints than working with the raw Edwards form, but the safety and composability gains are large, and lightweight (non-circuit) software callers see no overhead. decaf377 is used everywhere a generic group is needed in Penumbra: address derivation, decaf377-rdsa randomizable signatures, decaf377-ka key agreement, Poseidon hashing inputs, and the basepoints used by notes and nullifiers.',
  },
  {
    slug: 'penumbra-cryptographic-agility',
    q: 'What happens to Penumbra if BLS12-377 is broken or quantum computers arrive?',
    a: 'Penumbra\'s security today rests on the discrete-log assumption in BLS12-377 (and decaf377, which sits on the same curve). Like every other deployed pairing-based ZK system, that assumption is not post-quantum: a sufficiently large quantum computer running Shor\'s algorithm would break both the proving system and the signature scheme. The protocol does not yet ship a post-quantum migration path, but the design is structured for cryptographic agility. Notes commit only to balance and asset; spends prove a circuit that can be re-keyed under a different proving system without changing the note format. The address scheme is layered on a generic prime-order group abstraction (decaf377) which can in principle be swapped for a different group. A real migration would still require a coordinated hard fork: new proving and verifying keys, a re-issued state tree under the new commitments, and probably a window during which old-circuit spends are still accepted to drain legacy notes. None of that is trivial, but the architectural choice to abstract over the curve and to keep the proving system modular means it is at least feasible.',
  },
  {
    slug: 'shielded-ibc-transfer-mechanism',
    q: 'How do shielded IBC transfers into Penumbra actually work?',
    a: 'Penumbra implements the IBC stack natively (ICS-23 proofs, connections, channels, ICS-20 token transfers) without depending on the Cosmos SDK. The interesting piece is what happens at the destination. Penumbra has no accounts, so an inbound ICS-20 packet cannot simply credit a balance. Instead, the receiver field of the packet carries an encoded OutputDescription: a shielded note commitment plus encrypted payload describing the amount and asset. When the relayer delivers the packet, the chain inserts that OutputDescription into the multi-asset shielded pool exactly as if it had been produced by an internal Output action, and the new note is added to the State Commitment Tree. The recipient\'s wallet, scanning with its incoming viewing key, trial-decrypts the payload and discovers a new shielded balance. Importantly, the inbound packet itself is public on the source chain (Noble, Cosmos Hub, Osmosis, etc.), so the deposit amount and the encoded receiver field are visible there. The privacy boundary kicks in at the moment of arrival: from that point on, the funds live as a shielded note and any further movement (transfer, swap, stake, withdraw) is private.',
  },
  {
    slug: 'ibc-inbound-noble-penumbra',
    q: 'How do funds get from another chain into Penumbra?',
    a: 'The standard path for USDC is Noble → Penumbra. Noble is the Cosmos chain that issues native USDC, so once USDC sits in a Noble address (your wallet can get it there) you initiate an ICS-20 IBC transfer to Penumbra: source chain Noble, destination chain penumbra-1, recipient is a Penumbra ephemeral deposit address generated by your wallet. A relayer (such as Hermes) picks up the packet on Noble, generates an inclusion proof, and submits it to Penumbra. Penumbra verifies the proof, decodes the OutputDescription embedded in the receiver field, and inserts a new shielded note for that amount of USDC into the multi-asset pool. From a public observer\'s perspective the trail ends at the IBC packet. Once the note lands in Penumbra, every subsequent action is fully shielded.',
  },
  {
    slug: 'ibc-outbound-withdraw-flow',
    q: 'How does an outbound IBC withdrawal from Penumbra work?',
    a: 'Withdrawals leave the shielded pool through an Ics20Withdrawal action. The user constructs a transaction that spends shielded notes worth at least the withdrawal amount plus fee, produces a single transparent output describing an ICS-20 packet (destination chain, channel, denomination, amount, receiver address on the destination chain), and proves in zero knowledge that the spent notes balance the withdrawal. When the transaction is included on Penumbra, the chain emits the IBC packet on the relevant channel; a relayer delivers it to the destination chain (Noble, Cosmos Hub, Osmosis, etc.), which mints or unlocks the corresponding asset to the receiver. The shielded portion of the operation is everything before the packet: which notes were spent, which addresses you held at, and your remaining balance stay private. The unshielded portion is the packet itself, which is public on both chains: amount, denom, source channel, and destination address. A useful privacy property is that the withdrawal cannot be linked back to your prior shielded activity — observers only see "some amount left Penumbra and arrived at this address," not the chain of internal moves that produced it.',
  },
  {
    slug: 'multidimensional-gas-pricing',
    q: 'How does Penumbra\'s multi-dimensional gas pricing work?',
    a: 'Penumbra prices transactions across several independent resource dimensions rather than a single scalar gas figure. The dimensions reflect distinct costs that a transaction imposes on the network: execution work performed by validators, block space consumed (a proxy for full-node sync bandwidth), compact-block space (a proxy for the bandwidth that light clients and wallets must download to scan), and the cost of verifying the transaction\'s ZK proofs. Each dimension has its own price, set per-block in an EIP-1559-style mechanism so heavy resources can rise in price independently. Fees are split into a base fee, which is burned, and an optional proposer tip, which goes to the block proposer. Users can pay in UM directly, or in a configured set of alternative tokens (currently USDC, ATOM, and OSMO). Alt-token fees are subject to a governance-set multiplier so they always cost more than paying in UM, and the chain swaps them to UM and burns the proceeds at execution time. The effect is that a swap, an LP position open, and a simple transfer no longer pay for the same gas — they pay for the specific resources they actually consume.',
  },
  {
    slug: 'penumbra-fee-tokens',
    q: 'Which tokens can pay fees on Penumbra and why ATOM, OSMO, USDC?',
    a: 'Penumbra accepts UM as the native fee token and a governance-controlled allowlist of alternative tokens; today that list is ATOM, OSMO, and USDC. The choice is pragmatic: those three are the tokens that most users actually arrive holding when they enter Penumbra over IBC. ATOM is the canonical Cosmos staking asset, OSMO is the gas token of the largest IBC-native DEX, and USDC arrives via Noble as the standard stablecoin route. Letting users pay fees in those assets removes the chicken-and-egg problem of needing UM to do the very first transaction after a deposit. There is a price for the convenience: alt-token fees are charged a governance-set multiplier on top of the equivalent UM fee, so paying in UM is always cheapest. Alt-token fees are accepted at submission time, swapped for UM through the on-chain DEX, and the resulting UM is burned exactly like a direct UM fee.',
  },
  {
    slug: 'zk-proof-cost-as-spam-resistance',
    q: 'Does the cost of generating ZK proofs rate-limit spam on Penumbra?',
    a: 'Yes, indirectly. Every shielded action on Penumbra — Spend, Output, Swap, SwapClaim, Delegate, Undelegate, DelegatorVote — carries one or more Groth16 proofs that the sender must generate locally before the transaction can be broadcast. Proof generation is computationally non-trivial: it requires multi-scalar multiplications over BLS12-377 and Poseidon hashing across a circuit with thousands to tens of thousands of constraints. On a laptop a single spend takes hundreds of milliseconds; complex transactions (multi-action swaps and claims) take longer. This is not the primary anti-spam mechanism — explicit fees still apply — but it does mean attackers cannot trivially flood the chain with cheap signed transactions the way they can on a transparent chain. Each transaction has a hard, asymmetric work requirement on the sender side that the chain barely pays to verify (Groth16 verification is constant-time and very cheap).',
  },
  {
    slug: 'penumbra-vs-sui-solana-parallelism',
    q: 'How does Penumbra compare to Sui or Solana on parallel execution?',
    a: 'Sui and Solana achieve parallelism by statically analysing which on-chain accounts a transaction touches and scheduling non-overlapping transactions in parallel. That requires every transaction to declare its read/write set up front and assumes a globally shared, transparent state. Penumbra approaches the same problem from the opposite direction: there is no global mutable account state in the first place. Each user\'s balance lives as a set of immutable shielded notes commited into an append-only Merkle tree, and the only globally shared state is the nullifier set, which is monotonically growing. A spend from Alice and a spend from Bob touch completely disjoint pieces of state by construction, with the only invariant the chain enforces being "no nullifier used twice" plus the public DEX/staking pools. In effect, every user is their own actor with private state, and the chain only arbitrates the few genuinely shared resources (the nullifier set, the state tree root, batched DEX flows). This makes the bottleneck not state contention but proof verification throughput.',
  },
  {
    slug: 'private-governance-voting',
    q: 'How can a Penumbra delegator vote against their validator privately?',
    a: 'On most Cosmos chains a delegator who disagrees with their validator either has to redelegate or vote publicly with their address. Penumbra makes the override private. Validators cast a public ValidatorVote which counts as a default for their entire delegation pool. A delegator who wants to vote differently submits a DelegatorVote action that proves, in zero knowledge, that they held some amount of delUM for that validator at the snapshot taken when the proposal began, that the spend authority is theirs, and that the same delegation has not already been used to override. The action reveals only the chosen option (Yes/No/Abstain), the amount of voting power being applied, and the validator the vote is being subtracted from — never the voter\'s identity, address, or remaining balance. The validator\'s default tally is reduced by that amount and the override is added to the chosen option. The deposit and outcome are tracked via bearer NFTs (proposal_N_voting, proposal_N_passed/failed/slashed) so the system stays auditable end-to-end without any voter ever appearing on-chain by name.',
  },
  {
    slug: 'penumbra-batching-flow-encryption',
    q: 'What is flow encryption and how does Penumbra batch swaps and votes?',
    a: 'Flow encryption is the long-term cryptographic mechanism by which Penumbra reveals only aggregate flows for shared on-chain operations like batch swaps and governance tallies, not individual contributions. The construction is an additively homomorphic threshold encryption scheme: users encrypt their per-transaction contribution to a shared public key produced by validator distributed key generation, validators add the ciphertexts together over the course of an epoch, and only the aggregate is threshold-decrypted at the epoch boundary. This means an outside observer learns the total volume traded on a pair, or the total Yes/No tally on a proposal, but not who contributed what. Because validator sets only change at epoch boundaries the scheme stays stable across blocks. Important caveat: flow encryption was deferred from the v1 mainnet launch. In current Penumbra, the privacy of swap inputs comes from batching itself (your input is mixed with everyone else\'s in the same block, all clearing at one price) rather than from encryption of the inputs; encryption-of-inputs is planned for a future upgrade.',
  },
  {
    slug: 'penumbra-zcash-lineage',
    q: 'Is Penumbra a Zcash fork? What does it inherit from Sapling?',
    a: 'Penumbra is not a Zcash fork. It is an independent codebase written in Rust, built as a Tendermint/CometBFT application without the Cosmos SDK. What Penumbra does inherit from Zcash is the design of the multi-asset shielded pool: notes plus commitments plus nullifiers plus a Merkle tree of commitments, with spends and outputs proved in zero knowledge, generalised from a single asset (ZEC) to arbitrary IBC-bridged asset types. The Sapling lineage shows up in concept — note plaintexts, note ciphertexts, value commitments, balance binding signatures — but every cryptographic primitive is different: Penumbra uses BLS12-377 with Groth16 instead of BLS12-381 with Groth16, decaf377 instead of Jubjub, decaf377-rdsa instead of redjubjub, Poseidon instead of Pedersen+BLAKE2 for in-circuit hashing, and adds entirely new structures (the tiered commitment tree, FMD detection keys, swap NFTs, LPNFTs). Penumbra also goes well beyond Zcash in scope: shielded staking, shielded governance, an on-chain shielded DEX, IBC integration, and multi-dimensional gas pricing all have no Zcash analogue.',
  },
  {
    slug: 'penumbra-vs-zcash',
    q: 'How does Penumbra differ from Zcash?',
    a: 'Both use zero-knowledge proofs to shield balances. Zcash is a pure payments chain; Penumbra is a full Cosmos SDK chain with an integrated DEX, staking, governance, and IBC bridging. Penumbra uses Groth16 with BLS12-377 (vs Zcash\'s BLS12-381) tuned for general-purpose validity (not just transfers), supports liquidity provision and swaps with shielded execution, and runs proof-of-stake instead of proof-of-work.',
  },
  {
    slug: 'penumbra-vs-aztec',
    q: 'How does Penumbra differ from a chain like Aztec?',
    a: 'Both target privacy on a chain with general-purpose state. Penumbra is a sovereign Cosmos SDK chain native to the IBC ecosystem; Aztec is an Ethereum L2. Penumbra\'s privacy applies to balances, swaps, and LP positions natively (no separate "shielded mode"), and uses uniform-price batch clearing for all DEX activity. Aztec relies on private function execution within EVM-style smart contracts.',
  },
  {
    slug: 'can-validators-see-my-balance',
    q: 'Can validators see my shielded balance?',
    a: 'No. Validators only see the encrypted commitments published on-chain plus the validity proofs that authorize each transaction. The proofs reveal nothing about the spending viewing key, the asset type, the amount, or the counterparty. Validators verify the proof and update the chain state; they cannot decrypt anything.',
  },
  {
    slug: 'is-penumbra-audited',
    q: 'Is Penumbra audited?',
    a: 'The cryptographic primitives (Bulletproofs+, batch auctions, ZK circuits) and the consensus integration have been audited by Trail of Bits and other firms. Audit reports are linked from the Penumbra protocol spec. As with any new protocol, treat early-stage funds as you would any pre-mature DeFi exposure: start small, learn the system, and check the latest audit status before increasing position sizes.',
  },
  {
    slug: 'penumbra-mainnet-chain-id-rpc',
    q: 'What is the Penumbra mainnet chain ID and where can I find public RPC endpoints?',
    a: 'Penumbra\'s production network is chain ID penumbra-1, currently running pd v2.0.x. There are several public RPC endpoints maintained by infrastructure operators. The official default is rpc.penumbra.zone. Polkachu runs penumbra-rpc.polkachu.com on standard ports, and other Cosmos infra providers (Nodes.Guru, ComparedNodes) list additional public RPC, gRPC, and CometBFT endpoints. We also operate our own public endpoint at penumbra.rotko.net which exposes RPC, gRPC, and an IBC relayer. For wallet use any of these endpoints works interchangeably; the wallet does all proof generation and view-server scanning client-side, so the RPC only sees encrypted state. If a single endpoint becomes congested you can switch RPCs without losing any wallet state, because all wallet state is local.',
  },
  {
    slug: 'live-penumbra-stats',
    q: 'Where can I see live Penumbra stats?',
    a: 'On this site: /learn/tokenomics shows live supply, staked %, annualized inflation, and burns; / (the home page) shows DEX volume and trading pairs; /explore is the on-chain block explorer with blocks, transactions, validators, governance, and IBC channel data.',
  },
];

const PAGE_URL = 'https://dex.rotko.net/learn/faq';

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQS.map(({ q, a, slug }) => ({
    '@type': 'Question',
    name: q,
    '@id': `${PAGE_URL}#${slug}`,
    url: `${PAGE_URL}#${slug}`,
    acceptedAnswer: { '@type': 'Answer', text: a },
  })),
};

export const FaqPage = () => (
  <>
    <LearnNav />
    <section className='mx-auto flex max-w-[820px] flex-col gap-8 p-4 desktop:py-10'>
      <header className='flex flex-col gap-3'>
        <Text variant='h1' color='text.primary'>
          Penumbra FAQ
        </Text>
        <Text variant='large' color='text.secondary'>
          Common questions about UM, the shielded DEX, staking, IBC bridging, governance,
          and how Penumbra prevents MEV. Each answer has a stable anchor link — click the
          # next to a question to copy a deep link to that specific entry.
        </Text>
      </header>

      <div className='flex flex-col gap-3'>
        {FAQS.map(({ slug, q, a }) => (
          <FaqEntry key={slug} slug={slug} q={q} a={a} />
        ))}
      </div>

      {/* Schema.org FAQPage structured data — lets Google render rich
          snippets directly in search results and indexes each entry as a
          deep-linkable question with its own URL anchor. */}
      <script
        type='application/ld+json'
        // eslint-disable-next-line react/no-danger -- structured data
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
    </section>
  </>
);
