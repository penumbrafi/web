import gql from 'graphql-tag';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends Record<string, unknown>> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends Record<string, unknown>, K extends keyof T> = Partial<Record<K, never>>;
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
export type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;
/** All built-in and custom scalars, mapped to their actual values */
export interface Scalars {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  DateTime: { input: string; output: string; }
  Decimal: { input: number | string; output: number | string; }
  /** A scalar that can represent any JSON value. */
  JSON: { input: unknown; output: unknown; }
}

export type Action = IbcRelay | NotYetSupportedAction | Output | Spend;

export interface ActiveProposal {
  __typename?: 'ActiveProposal';
  endBlockHeight: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  kind: ProposalKind;
  state: ProposalState;
  title: Scalars['String']['output'];
}

export interface AssetId {
  __typename?: 'AssetId';
  altBaseDenom: Scalars['String']['output'];
  altBech32M: Scalars['String']['output'];
  inner: Scalars['String']['output'];
}

export interface BatchSwap {
  __typename?: 'BatchSwap';
  executionType: Scalars['String']['output'];
  id: Scalars['Int']['output'];
  individualSwaps: IndividualSwap[];
  individualSwapsCount: Scalars['Int']['output'];
  totalInputAmount: Scalars['String']['output'];
  totalInputAssetId: Scalars['String']['output'];
  totalOutputAmount: Scalars['String']['output'];
  totalOutputAssetId: Scalars['String']['output'];
}

export interface Block {
  __typename?: 'Block';
  chainId?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['DateTime']['output'];
  height: Scalars['Int']['output'];
  rawEvents: Event[];
  rawJson: Scalars['JSON']['output'];
  transactions: Transaction[];
  transactionsCount: Scalars['Int']['output'];
}

export interface BlockCollection {
  __typename?: 'BlockCollection';
  items: Block[];
  total: Scalars['Int']['output'];
}

export interface BlockFilter {
  height?: InputMaybe<Scalars['Int']['input']>;
}

export interface BlockParticipation {
  __typename?: 'BlockParticipation';
  height: Scalars['Int']['output'];
  signed: Scalars['Boolean']['output'];
}

export interface BlockUpdate {
  __typename?: 'BlockUpdate';
  createdAt: Scalars['DateTime']['output'];
  height: Scalars['Int']['output'];
  transactionsCount: Scalars['Int']['output'];
}

export enum BondingState {
  BondingStateEnumBonded = 'BONDING_STATE_ENUM_BONDED',
  BondingStateEnumUnbonded = 'BONDING_STATE_ENUM_UNBONDED',
  BondingStateEnumUnbonding = 'BONDING_STATE_ENUM_UNBONDING',
  BondingStateEnumUnspecified = 'BONDING_STATE_ENUM_UNSPECIFIED'
}

export interface ChainParameters {
  __typename?: 'ChainParameters';
  chainId: Scalars['String']['output'];
  currentBlockHeight: Scalars['Int']['output'];
  currentBlockTime: Scalars['DateTime']['output'];
  currentEpoch: Scalars['Int']['output'];
  epochDuration: Scalars['Int']['output'];
  lastUpdated: Scalars['DateTime']['output'];
  nextEpochIn: Scalars['Int']['output'];
}

export interface ChainParametersUpdate {
  __typename?: 'ChainParametersUpdate';
  chainId: Scalars['String']['output'];
  currentBlockHeight: Scalars['Int']['output'];
  currentBlockTime: Scalars['DateTime']['output'];
  currentEpoch: Scalars['Int']['output'];
  epochDuration: Scalars['Int']['output'];
  lastUpdated: Scalars['DateTime']['output'];
  nextEpochIn: Scalars['Int']['output'];
}

export enum ClientStatus {
  Active = 'active',
  Expired = 'expired',
  Frozen = 'frozen',
  Unknown = 'unknown'
}

export interface CollectionLimit {
  length?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
}

export interface CommissionInfo {
  __typename?: 'CommissionInfo';
  rateBps: Scalars['Int']['output'];
  recipientAddress?: Maybe<Scalars['String']['output']>;
  streamType: Scalars['String']['output'];
}

export interface DbBlock {
  __typename?: 'DbBlock';
  blockHashHex?: Maybe<Scalars['String']['output']>;
  chainId?: Maybe<Scalars['String']['output']>;
  height: Scalars['Int']['output'];
  numTransactions: Scalars['Int']['output'];
  previousBlockHashHex?: Maybe<Scalars['String']['output']>;
  rootHex: Scalars['String']['output'];
  timestamp: Scalars['DateTime']['output'];
  totalFees?: Maybe<Scalars['String']['output']>;
  validatorIdentityKey?: Maybe<Scalars['String']['output']>;
}

export interface DbRawTransaction {
  __typename?: 'DbRawTransaction';
  blockHeight: Scalars['Int']['output'];
  chainId?: Maybe<Scalars['String']['output']>;
  clientId?: Maybe<Scalars['String']['output']>;
  feeAmount?: Maybe<Scalars['String']['output']>;
  ibcStatus: Scalars['String']['output'];
  rawDataHex?: Maybe<Scalars['String']['output']>;
  rawJson: Scalars['JSON']['output'];
  timestamp: Scalars['DateTime']['output'];
  txHashHex: Scalars['String']['output'];
}

export interface Delegate {
  __typename?: 'Delegate';
  blockHeight: Scalars['Int']['output'];
  delegationAmount: Scalars['String']['output'];
  epochIndex: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  timestamp: Scalars['DateTime']['output'];
  txHash: Scalars['String']['output'];
  unbondedAmount: Scalars['String']['output'];
  validatorIdentityKey: Scalars['String']['output'];
}

export interface DexStats {
  __typename?: 'DexStats';
  openPositions: Scalars['Int']['output'];
  totalExecutions: Scalars['Int']['output'];
}

export interface Event {
  __typename?: 'Event';
  type: Scalars['String']['output'];
  value: Scalars['String']['output'];
}

export interface Fee {
  __typename?: 'Fee';
  amount: Scalars['String']['output'];
  assetId?: Maybe<AssetId>;
}

export interface GovernanceParameters {
  __typename?: 'GovernanceParameters';
  /** The deposit amount required to submit a proposal (in UM) */
  depositAmount: Scalars['Decimal']['output'];
  /** The percentage of votes required for a proposal to pass */
  passingThreshold: Scalars['Decimal']['output'];
  /** The duration of proposal voting in blocks */
  proposalDuration: Scalars['Int']['output'];
  /** The percentage threshold for slashing */
  slashingThreshold: Scalars['Decimal']['output'];
  /** The quorum percentage required for a proposal to be valid */
  validQuorum: Scalars['Decimal']['output'];
}

export interface IbcFlowHistory {
  __typename?: 'IbcFlowHistory';
  date: Scalars['String']['output'];
  inflowCount: Scalars['Int']['output'];
  inflowVolume: Scalars['String']['output'];
  outflowCount: Scalars['Int']['output'];
  outflowVolume: Scalars['String']['output'];
}

export interface IbcRelay {
  __typename?: 'IbcRelay';
  rawAction: Scalars['String']['output'];
}

export interface IbcStats {
  __typename?: 'IbcStats';
  channelId?: Maybe<Scalars['String']['output']>;
  clientId: Scalars['String']['output'];
  counterpartyChannelId?: Maybe<Scalars['String']['output']>;
  expiredTxCount: Scalars['Int']['output'];
  lastUpdated?: Maybe<Scalars['DateTime']['output']>;
  pendingTxCount: Scalars['Int']['output'];
  shieldedTxCount: Scalars['Int']['output'];
  shieldedVolume: Scalars['String']['output'];
  status: ClientStatus;
  totalTxCount: Scalars['Int']['output'];
  unshieldedTxCount: Scalars['Int']['output'];
  unshieldedVolume: Scalars['String']['output'];
}

export enum IbcStatus {
  Completed = 'COMPLETED',
  Error = 'ERROR',
  Expired = 'EXPIRED',
  Pending = 'PENDING',
  Unknown = 'UNKNOWN'
}

export enum IbcStatusFilter {
  Completed = 'COMPLETED',
  Error = 'ERROR',
  Expired = 'EXPIRED',
  Pending = 'PENDING',
  Unknown = 'UNKNOWN'
}

export interface IbcTransactionUpdate {
  __typename?: 'IbcTransactionUpdate';
  blockHeight: Scalars['Int']['output'];
  clientId: Scalars['String']['output'];
  isStatusUpdate: Scalars['Boolean']['output'];
  raw: Scalars['String']['output'];
  status: Scalars['String']['output'];
  timestamp: Scalars['DateTime']['output'];
  txHash: Scalars['String']['output'];
}

export interface IndividualSwap {
  __typename?: 'IndividualSwap';
  inputAmount: Scalars['String']['output'];
  inputAssetId: Scalars['String']['output'];
  outputAmount: Scalars['String']['output'];
  outputAssetId: Scalars['String']['output'];
  routeSteps: RouteStep[];
  swapIndex: Scalars['Int']['output'];
}

export interface LiquidityPosition {
  __typename?: 'LiquidityPosition';
  feePercentage: Scalars['Float']['output'];
  positionId: Scalars['String']['output'];
  reserves1Amount: Scalars['String']['output'];
  reserves2Amount: Scalars['String']['output'];
  state: LiquidityPositionState;
  tradingPairAsset1: Scalars['String']['output'];
  tradingPairAsset2: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
}

export interface LiquidityPositionCollection {
  __typename?: 'LiquidityPositionCollection';
  items: LiquidityPosition[];
  total: Scalars['Int']['output'];
}

export interface LiquidityPositionFilter {
  state?: InputMaybe<LiquidityPositionStateFilter>;
}

export enum LiquidityPositionState {
  Closed = 'CLOSED',
  Executing = 'EXECUTING',
  Open = 'OPEN',
  Withdrawn = 'WITHDRAWN'
}

export enum LiquidityPositionStateFilter {
  Closed = 'CLOSED',
  Open = 'OPEN'
}

export interface NotYetSupportedAction {
  __typename?: 'NotYetSupportedAction';
  debug: Scalars['String']['output'];
}

export interface NotePayload {
  __typename?: 'NotePayload';
  encryptedNote: Scalars['String']['output'];
  ephemeralKey: Scalars['String']['output'];
  noteCommitment: Scalars['String']['output'];
}

export interface Output {
  __typename?: 'Output';
  body: OutputBody;
  proof: Scalars['String']['output'];
}

export interface OutputBody {
  __typename?: 'OutputBody';
  balanceCommitment: Scalars['String']['output'];
  notePayload: NotePayload;
  ovkWrappedKey: Scalars['String']['output'];
  wrappedMemoKey: Scalars['String']['output'];
}

export interface PastProposal {
  __typename?: 'PastProposal';
  endBlockHeight: Scalars['Int']['output'];
  endTimestamp?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['Int']['output'];
  kind: ProposalKind;
  outcome?: Maybe<ProposalOutcome>;
  state: ProposalState;
  title: Scalars['String']['output'];
  totalVotes: Scalars['Decimal']['output'];
}

export interface PastProposalCollection {
  __typename?: 'PastProposalCollection';
  items: PastProposal[];
  total: Scalars['Int']['output'];
}

export interface ProposalDetail {
  __typename?: 'ProposalDetail';
  abstainVotes: Scalars['Decimal']['output'];
  abstainVotesPercentage: Scalars['Decimal']['output'];
  depositAmount: Scalars['Decimal']['output'];
  description: Scalars['String']['output'];
  id: Scalars['Int']['output'];
  kind: ProposalKind;
  noVotes: Scalars['Decimal']['output'];
  noVotesPercentage: Scalars['Decimal']['output'];
  outcome?: Maybe<ProposalOutcome>;
  payload: Scalars['JSON']['output'];
  quorum: Scalars['Decimal']['output'];
  state: ProposalState;
  title: Scalars['String']['output'];
  totalVotes: Scalars['Decimal']['output'];
  votes: VoteCollection;
  votingEndedBlockHeight: Scalars['Int']['output'];
  votingEndedTimestamp?: Maybe<Scalars['DateTime']['output']>;
  votingStartedBlockHeight: Scalars['Int']['output'];
  votingStartedTimestamp: Scalars['DateTime']['output'];
  yesVotes: Scalars['Decimal']['output'];
  yesVotesPercentage: Scalars['Decimal']['output'];
}


export interface ProposalDetailVotesArgs {
  limit?: InputMaybe<CollectionLimit>;
}

export enum ProposalKind {
  CommunityPoolSpend = 'COMMUNITY_POOL_SPEND',
  Emergency = 'EMERGENCY',
  FreezeIbcClient = 'FREEZE_IBC_CLIENT',
  ParameterChange = 'PARAMETER_CHANGE',
  Signaling = 'SIGNALING',
  UnfreezeIbcClient = 'UNFREEZE_IBC_CLIENT',
  UpgradePlan = 'UPGRADE_PLAN'
}

export enum ProposalOutcome {
  Failed = 'FAILED',
  Passed = 'PASSED',
  Slashed = 'SLASHED'
}

export enum ProposalState {
  Claimed = 'CLAIMED',
  Finished = 'FINISHED',
  Voting = 'VOTING',
  Withdrawn = 'WITHDRAWN'
}

export interface QueryRoot {
  __typename?: 'QueryRoot';
  activeProposals: ActiveProposal[];
  block?: Maybe<Block>;
  blocks: BlockCollection;
  dbBlock?: Maybe<DbBlock>;
  dbBlocks: DbBlock[];
  dbLatestBlock?: Maybe<DbBlock>;
  dbRawTransaction?: Maybe<DbRawTransaction>;
  dbRawTransactions: DbRawTransaction[];
  dexStats: DexStats;
  getVoteForTransaction?: Maybe<VoteForTransaction>;
  governanceParameters?: Maybe<GovernanceParameters>;
  ibcFlowHistory: IbcFlowHistory[];
  ibcStats: IbcStats[];
  ibcTotalShieldedVolume: TotalShieldedVolume;
  latestExecutions: SwapExecution[];
  liquidityPositions: LiquidityPositionCollection;
  pastProposals: PastProposalCollection;
  pendingUndelegations: Undelegate[];
  proposalDetail?: Maybe<ProposalDetail>;
  recentSwapPrices: RecentSwapPrice[];
  search?: Maybe<SearchResult>;
  stats: Stats;
  swapVolumeHistory: SwapVolumeHistory[];
  tradingPairLiquidity: TradingPairLiquidity[];
  tradingVolume24h: TradingVolume24h[];
  transaction?: Maybe<Transaction>;
  transactions: TransactionCollection;
  undelegationsReleasingSoon: Undelegate[];
  validatorDelegates: Delegate[];
  validatorDetails?: Maybe<ValidatorDetails>;
  validatorStakingStats?: Maybe<ValidatorStakingStats>;
  validatorUndelegates: Undelegate[];
  validatorVotingPowerHistory: VotingPowerHistoryEntry[];
  validatorsHomepage: ValidatorHomepageData;
}


export interface QueryRootBlockArgs {
  height: Scalars['Int']['input'];
}


export interface QueryRootBlocksArgs {
  filter?: InputMaybe<BlockFilter>;
  limit: CollectionLimit;
}


export interface QueryRootDbBlockArgs {
  height: Scalars['Int']['input'];
}


export interface QueryRootDbBlocksArgs {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
}


export interface QueryRootDbRawTransactionArgs {
  txHashHex: Scalars['String']['input'];
}


export interface QueryRootDbRawTransactionsArgs {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
}


export interface QueryRootGetVoteForTransactionArgs {
  txHash: Scalars['String']['input'];
}


export interface QueryRootIbcFlowHistoryArgs {
  clientId?: InputMaybe<Scalars['String']['input']>;
  days?: InputMaybe<Scalars['Int']['input']>;
}


export interface QueryRootIbcStatsArgs {
  clientId?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  timePeriod?: InputMaybe<TimePeriod>;
}


export interface QueryRootLatestExecutionsArgs {
  filter?: InputMaybe<SwapExecutionFilter>;
}


export interface QueryRootLiquidityPositionsArgs {
  filter?: InputMaybe<LiquidityPositionFilter>;
  limit: CollectionLimit;
}


export interface QueryRootPastProposalsArgs {
  limit: CollectionLimit;
}


export interface QueryRootPendingUndelegationsArgs {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
}


export interface QueryRootProposalDetailArgs {
  id: Scalars['Int']['input'];
}


export interface QueryRootRecentSwapPricesArgs {
  limit?: InputMaybe<Scalars['Int']['input']>;
}


export interface QueryRootSearchArgs {
  slug: Scalars['String']['input'];
}


export interface QueryRootSwapVolumeHistoryArgs {
  days?: InputMaybe<Scalars['Int']['input']>;
}


export interface QueryRootTradingPairLiquidityArgs {
  limit?: InputMaybe<Scalars['Int']['input']>;
}


export interface QueryRootTradingVolume24hArgs {
  limit?: InputMaybe<Scalars['Int']['input']>;
}


export interface QueryRootTransactionArgs {
  hash: Scalars['String']['input'];
}


export interface QueryRootTransactionsArgs {
  filter?: InputMaybe<TransactionFilter>;
  limit: CollectionLimit;
}


export interface QueryRootUndelegationsReleasingSoonArgs {
  blocksAhead?: InputMaybe<Scalars['Int']['input']>;
  currentHeight: Scalars['Int']['input'];
}


export interface QueryRootValidatorDelegatesArgs {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  validatorId: Scalars['String']['input'];
}


export interface QueryRootValidatorDetailsArgs {
  id: Scalars['String']['input'];
}


export interface QueryRootValidatorStakingStatsArgs {
  validatorId: Scalars['String']['input'];
}


export interface QueryRootValidatorUndelegatesArgs {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  pendingOnly?: InputMaybe<Scalars['Boolean']['input']>;
  validatorId: Scalars['String']['input'];
}


export interface QueryRootValidatorVotingPowerHistoryArgs {
  endTime?: InputMaybe<Scalars['DateTime']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  startTime?: InputMaybe<Scalars['DateTime']['input']>;
  validatorId: Scalars['String']['input'];
}


export interface QueryRootValidatorsHomepageArgs {
  filter?: InputMaybe<ValidatorFilter>;
}

export interface RecentSwapPrice {
  __typename?: 'RecentSwapPrice';
  avgPrice: Scalars['Float']['output'];
  inputAssetId: Scalars['String']['output'];
  latestSwap?: Maybe<Scalars['DateTime']['output']>;
  outputAssetId: Scalars['String']['output'];
  swapCount: Scalars['Int']['output'];
}

export interface Root {
  __typename?: 'Root';
  blocks: BlockUpdate;
  chainParameters: ChainParametersUpdate;
  ibcTransactions: IbcTransactionUpdate;
  latestBlocks: BlockUpdate;
  latestIbcTransactions: IbcTransactionUpdate;
  latestTransactions: TransactionUpdate;
  totalShieldedVolume: TotalShieldedVolumeUpdate;
  transactionCount: TransactionCountUpdate;
  transactions: TransactionUpdate;
  validatorBlocks: ValidatorBlockUpdate;
}


export interface RootIbcTransactionsArgs {
  clientId?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
}


export interface RootLatestBlocksArgs {
  limit?: InputMaybe<Scalars['Int']['input']>;
}


export interface RootLatestIbcTransactionsArgs {
  clientId?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
}


export interface RootLatestTransactionsArgs {
  limit?: InputMaybe<Scalars['Int']['input']>;
}


export interface RootValidatorBlocksArgs {
  validatorId: Scalars['String']['input'];
}

export interface RouteStep {
  __typename?: 'RouteStep';
  amount: Scalars['String']['output'];
  assetId: Scalars['String']['output'];
  routeStep: Scalars['Int']['output'];
}

export type SearchResult = Block | Transaction | ValidatorSearchResults;

export interface Spend {
  __typename?: 'Spend';
  authSig: Scalars['String']['output'];
  body: SpendBody;
  proof: Scalars['String']['output'];
}

export interface SpendBody {
  __typename?: 'SpendBody';
  balanceCommitment: Scalars['String']['output'];
  nullifier: Scalars['String']['output'];
  rk: Scalars['String']['output'];
}

export interface StakingParameters {
  __typename?: 'StakingParameters';
  activeValidatorCount: Scalars['Int']['output'];
  activeValidatorLimit: Scalars['Int']['output'];
  minValidatorStake: Scalars['Int']['output'];
  slashingPenaltyDowntime: Scalars['Float']['output'];
  slashingPenaltyMisbehavior: Scalars['Float']['output'];
  totalStaked: Scalars['Int']['output'];
  unbondingDelay: Scalars['Int']['output'];
  uptimeBlocksWindow: Scalars['Int']['output'];
  uptimeMinRequired: Scalars['Float']['output'];
}

export interface Stats {
  __typename?: 'Stats';
  totalTransactionsCount: Scalars['Int']['output'];
}

export interface SwapExecution {
  __typename?: 'SwapExecution';
  batchSwaps: BatchSwap[];
  blockHeight: Scalars['Int']['output'];
  timestamp: Scalars['DateTime']['output'];
}

export interface SwapExecutionFilter {
  height?: InputMaybe<Scalars['Int']['input']>;
}

export interface SwapVolumeHistory {
  __typename?: 'SwapVolumeHistory';
  arbCount: Scalars['Int']['output'];
  date: Scalars['String']['output'];
  organicCount: Scalars['Int']['output'];
  swapCount: Scalars['Int']['output'];
  totalVolume: Scalars['String']['output'];
}

export enum TimePeriod {
  All = 'ALL',
  Day = 'DAY',
  Month = 'MONTH'
}

export interface TotalShieldedVolume {
  __typename?: 'TotalShieldedVolume';
  /** Total shielded volume across all IBC clients */
  value: Scalars['String']['output'];
}

export interface TotalShieldedVolumeUpdate {
  __typename?: 'TotalShieldedVolumeUpdate';
  value: Scalars['String']['output'];
}

export interface TradingPairLiquidity {
  __typename?: 'TradingPairLiquidity';
  activePositions: Scalars['Int']['output'];
  avgFeePercentage: Scalars['Float']['output'];
  totalReserves1: Scalars['String']['output'];
  totalReserves2: Scalars['String']['output'];
  tradingPairAsset1: Scalars['String']['output'];
  tradingPairAsset2: Scalars['String']['output'];
}

export interface TradingVolume24h {
  __typename?: 'TradingVolume24h';
  assetId: Scalars['String']['output'];
  periodEnd?: Maybe<Scalars['DateTime']['output']>;
  periodStart?: Maybe<Scalars['DateTime']['output']>;
  swapCount24h: Scalars['Int']['output'];
  volume24h: Scalars['String']['output'];
}

export interface Transaction {
  __typename?: 'Transaction';
  anchor: Scalars['String']['output'];
  bindingSig: Scalars['String']['output'];
  block: Block;
  body: TransactionBody;
  clientId?: Maybe<Scalars['String']['output']>;
  hash: Scalars['String']['output'];
  ibcStatus: IbcStatus;
  index: Scalars['Int']['output'];
  raw: Scalars['String']['output'];
  rawEvents: Event[];
  rawJson: Scalars['JSON']['output'];
}

export interface TransactionBody {
  __typename?: 'TransactionBody';
  actions: Action[];
  actionsCount: Scalars['Int']['output'];
  detectionData: Scalars['String']['output'][];
  memo?: Maybe<Scalars['String']['output']>;
  parameters: TransactionParameters;
  rawActions: Scalars['String']['output'][];
}

export interface TransactionCollection {
  __typename?: 'TransactionCollection';
  items: Transaction[];
  total: Scalars['Int']['output'];
}

export interface TransactionCountUpdate {
  __typename?: 'TransactionCountUpdate';
  count: Scalars['Int']['output'];
}

export interface TransactionFilter {
  clientId?: InputMaybe<Scalars['String']['input']>;
  hash?: InputMaybe<Scalars['String']['input']>;
  ibcStatus?: InputMaybe<IbcStatusFilter>;
  validator?: InputMaybe<Scalars['String']['input']>;
}

export interface TransactionParameters {
  __typename?: 'TransactionParameters';
  chainId: Scalars['String']['output'];
  expiryHeight: Scalars['Int']['output'];
  fee: Fee;
}

export interface TransactionUpdate {
  __typename?: 'TransactionUpdate';
  hash: Scalars['String']['output'];
  id: Scalars['Int']['output'];
  raw: Scalars['String']['output'];
}

export interface Undelegate {
  __typename?: 'Undelegate';
  blockHeight: Scalars['Int']['output'];
  claimed: Scalars['Boolean']['output'];
  delegationAmount: Scalars['String']['output'];
  epochIndex: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  releaseHeight: Scalars['Int']['output'];
  timestamp: Scalars['DateTime']['output'];
  txHash: Scalars['String']['output'];
  unbondedAmount: Scalars['String']['output'];
  unbondingStartHeight: Scalars['Int']['output'];
  validatorIdentityKey: Scalars['String']['output'];
}

export interface Validator {
  __typename?: 'Validator';
  bondingState: BondingState;
  commission: Scalars['Float']['output'];
  firstSeenTime?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['String']['output'];
  name?: Maybe<Scalars['String']['output']>;
  state: ValidatorState;
  uptime?: Maybe<Scalars['Float']['output']>;
  votingPower: Scalars['Int']['output'];
  votingPowerActivePercentage: Scalars['Float']['output'];
}

export interface ValidatorBlockUpdate {
  __typename?: 'ValidatorBlockUpdate';
  blockHeight: Scalars['Int']['output'];
  signed: Scalars['Boolean']['output'];
  validatorId: Scalars['String']['output'];
}

export interface ValidatorDetails {
  __typename?: 'ValidatorDetails';
  activeSince?: Maybe<Scalars['DateTime']['output']>;
  bondingState: BondingState;
  commissionPercentage: Scalars['Float']['output'];
  commissionStreams: CommissionInfo[];
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  last300Blocks: BlockParticipation[];
  missedBlocks: Scalars['Int']['output'];
  name?: Maybe<Scalars['String']['output']>;
  signedBlocks: Scalars['Int']['output'];
  state: ValidatorState;
  totalUptime?: Maybe<Scalars['Float']['output']>;
  uptimeBlockWindow: Scalars['Int']['output'];
  votingPower: Scalars['Int']['output'];
  votingPowerActivePercentage: Scalars['Float']['output'];
  website?: Maybe<Scalars['String']['output']>;
}

export interface ValidatorFilter {
  state?: InputMaybe<ValidatorStateFilter>;
}

export interface ValidatorHomepageData {
  __typename?: 'ValidatorHomepageData';
  chainParameters?: Maybe<ChainParameters>;
  stakingParameters: StakingParameters;
  validators: Validator[];
}

export interface ValidatorSearchResult {
  __typename?: 'ValidatorSearchResult';
  displayName: Scalars['String']['output'];
  id: Scalars['String']['output'];
}

export interface ValidatorSearchResults {
  __typename?: 'ValidatorSearchResults';
  items: ValidatorSearchResult[];
  total: Scalars['Int']['output'];
}

export interface ValidatorStakingStats {
  __typename?: 'ValidatorStakingStats';
  nextReleaseHeight?: Maybe<Scalars['Int']['output']>;
  pendingUndelegateCount: Scalars['Int']['output'];
  pendingUndelegations: Scalars['String']['output'];
  totalDelegations: Scalars['String']['output'];
  totalUndelegations: Scalars['String']['output'];
  validatorIdentityKey: Scalars['String']['output'];
}

export enum ValidatorState {
  ValidatorStateEnumActive = 'VALIDATOR_STATE_ENUM_ACTIVE',
  ValidatorStateEnumDefined = 'VALIDATOR_STATE_ENUM_DEFINED',
  ValidatorStateEnumDisabled = 'VALIDATOR_STATE_ENUM_DISABLED',
  ValidatorStateEnumInactive = 'VALIDATOR_STATE_ENUM_INACTIVE',
  ValidatorStateEnumJailed = 'VALIDATOR_STATE_ENUM_JAILED',
  ValidatorStateEnumTombstoned = 'VALIDATOR_STATE_ENUM_TOMBSTONED',
  ValidatorStateEnumUnspecified = 'VALIDATOR_STATE_ENUM_UNSPECIFIED'
}

export enum ValidatorStateFilter {
  Active = 'ACTIVE',
  All = 'ALL',
  Inactive = 'INACTIVE'
}

export interface Vote {
  __typename?: 'Vote';
  effectiveVotingPower: Scalars['Decimal']['output'];
  id?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  txHash?: Maybe<Scalars['String']['output']>;
  vote?: Maybe<VoteValue>;
  votedAt: Scalars['DateTime']['output'];
  votingPowerPercentage: Scalars['Decimal']['output'];
}

export interface VoteCollection {
  __typename?: 'VoteCollection';
  items: Vote[];
  total: Scalars['Int']['output'];
}

export interface VoteForTransaction {
  __typename?: 'VoteForTransaction';
  id?: Maybe<Scalars['String']['output']>;
  proposal: Scalars['Int']['output'];
  vote?: Maybe<VoteValue>;
  votingPower: Scalars['Decimal']['output'];
}

export enum VoteValue {
  Abstain = 'ABSTAIN',
  No = 'NO',
  Yes = 'YES'
}

export interface VotingPowerHistoryEntry {
  __typename?: 'VotingPowerHistoryEntry';
  blockHeight: Scalars['Int']['output'];
  timestamp: Scalars['DateTime']['output'];
  validatorIdentityKey: Scalars['String']['output'];
  votingPower: Scalars['Int']['output'];
}

export interface BlockFragment { __typename?: 'Block', height: number, createdAt: string, rawJson: unknown, transactions: { __typename?: 'Transaction', hash: string, ibcStatus: IbcStatus, raw: string, block: { __typename?: 'Block', height: number, createdAt: string } }[] }

export interface PartialBlockFragment { __typename?: 'Block', height: number, createdAt: string, transactionsCount: number }

export interface PartialTransactionFragment { __typename?: 'Transaction', hash: string, ibcStatus: IbcStatus, raw: string, block: { __typename?: 'Block', height: number, createdAt: string } }

export interface TransactionFragment { __typename?: 'Transaction', hash: string, raw: string, rawJson: unknown, block: { __typename?: 'Block', height: number, createdAt: string }, body: { __typename?: 'TransactionBody', parameters: { __typename?: 'TransactionParameters', chainId: string, fee: { __typename?: 'Fee', amount: string } } } }

export type ActiveProposalsQueryVariables = Exact<Record<string, never>>;


export interface ActiveProposalsQuery { __typename?: 'QueryRoot', activeProposals: { __typename?: 'ActiveProposal', endBlockHeight: number, id: number, kind: ProposalKind, state: ProposalState, title: string }[] }

export type ActiveValidatorsQueryVariables = Exact<Record<string, never>>;


export interface ActiveValidatorsQuery { __typename?: 'QueryRoot', validatorsHomepage: { __typename?: 'ValidatorHomepageData', stakingParameters: { __typename?: 'StakingParameters', activeValidatorCount: number, activeValidatorLimit: number } } }

export type ActiveVotingPowerQueryVariables = Exact<{
  filter?: InputMaybe<ValidatorFilter>;
}>;


export interface ActiveVotingPowerQuery { __typename?: 'QueryRoot', validatorsHomepage: { __typename?: 'ValidatorHomepageData', stakingParameters: { __typename?: 'StakingParameters', totalStaked: number } } }

export type BlockQueryVariables = Exact<{
  height: Scalars['Int']['input'];
}>;


export interface BlockQuery { __typename?: 'QueryRoot', block?: { __typename?: 'Block', height: number, createdAt: string, rawJson: unknown, transactions: { __typename?: 'Transaction', hash: string, ibcStatus: IbcStatus, raw: string, block: { __typename?: 'Block', height: number, createdAt: string } }[] } | null }

export type BlocksQueryVariables = Exact<{
  limit: CollectionLimit;
  filter?: InputMaybe<BlockFilter>;
}>;


export interface BlocksQuery { __typename?: 'QueryRoot', blocks: { __typename?: 'BlockCollection', total: number, items: { __typename?: 'Block', height: number, createdAt: string, transactionsCount: number }[] } }

export type ChainParametersQueryVariables = Exact<Record<string, never>>;


export interface ChainParametersQuery { __typename?: 'QueryRoot', validatorsHomepage: { __typename?: 'ValidatorHomepageData', chainParameters?: { __typename?: 'ChainParameters', chainId: string, currentBlockTime: string, currentBlockHeight: number, currentEpoch: number, epochDuration: number, nextEpochIn: number } | null } }

export type DexBlockExecutionsQueryVariables = Exact<{
  filter?: InputMaybe<SwapExecutionFilter>;
}>;


export interface DexBlockExecutionsQuery { __typename?: 'QueryRoot', latestExecutions: { __typename?: 'SwapExecution', blockHeight: number, timestamp: string, batchSwaps: { __typename?: 'BatchSwap', id: number, executionType: string, totalInputAssetId: string, totalInputAmount: string, totalOutputAssetId: string, totalOutputAmount: string, individualSwaps: { __typename?: 'IndividualSwap', routeSteps: { __typename?: 'RouteStep', assetId: string, amount: string }[] }[] }[] }[] }

export type DexLiquidityPositionsQueryVariables = Exact<{
  limit: CollectionLimit;
  filter?: InputMaybe<LiquidityPositionFilter>;
}>;


export interface DexLiquidityPositionsQuery { __typename?: 'QueryRoot', liquidityPositions: { __typename?: 'LiquidityPositionCollection', total: number, items: { __typename?: 'LiquidityPosition', tradingPairAsset1: string, tradingPairAsset2: string, reserves1Amount: string, reserves2Amount: string, state: LiquidityPositionState, feePercentage: number, updatedAt: string, positionId: string }[] } }

export type DexOpenPositionsQueryVariables = Exact<Record<string, never>>;


export interface DexOpenPositionsQuery { __typename?: 'QueryRoot', dexStats: { __typename?: 'DexStats', openPositions: number } }

export type DexTotalExecutionsQueryVariables = Exact<Record<string, never>>;


export interface DexTotalExecutionsQuery { __typename?: 'QueryRoot', dexStats: { __typename?: 'DexStats', totalExecutions: number } }

export type GovParametersQueryVariables = Exact<Record<string, never>>;


export interface GovParametersQuery { __typename?: 'QueryRoot', governanceParameters?: { __typename?: 'GovernanceParameters', depositAmount: number | string, passingThreshold: number | string, proposalDuration: number, slashingThreshold: number | string, validQuorum: number | string } | null }

export type IbcFlowHistoryQueryVariables = Exact<{
  clientId?: InputMaybe<Scalars['String']['input']>;
  days?: InputMaybe<Scalars['Int']['input']>;
}>;


export interface IbcFlowHistoryQuery { __typename?: 'QueryRoot', ibcFlowHistory: { __typename?: 'IbcFlowHistory', date: string, inflowVolume: string, outflowVolume: string, inflowCount: number, outflowCount: number }[] }

export type IbcStatsQueryVariables = Exact<{
  clientId?: InputMaybe<Scalars['String']['input']>;
}>;


export interface IbcStatsQuery { __typename?: 'QueryRoot', ibcStats: { __typename?: 'IbcStats', status: ClientStatus, channelId?: string | null, counterpartyChannelId?: string | null, lastUpdated?: string | null, shieldedVolume: string, shieldedTxCount: number, unshieldedVolume: string, unshieldedTxCount: number, totalTxCount: number, pendingTxCount: number, expiredTxCount: number, id: string }[] }

export type MinValidatorStakeQueryVariables = Exact<Record<string, never>>;


export interface MinValidatorStakeQuery { __typename?: 'QueryRoot', validatorsHomepage: { __typename?: 'ValidatorHomepageData', stakingParameters: { __typename?: 'StakingParameters', minValidatorStake: number } } }

export type PastProposalsQueryVariables = Exact<{
  limit: CollectionLimit;
}>;


export interface PastProposalsQuery { __typename?: 'QueryRoot', pastProposals: { __typename?: 'PastProposalCollection', total: number, items: { __typename?: 'PastProposal', endBlockHeight: number, endTimestamp?: string | null, id: number, kind: ProposalKind, outcome?: ProposalOutcome | null, state: ProposalState, title: string, totalVotes: number | string }[] } }

export type ProposalQueryVariables = Exact<{
  id: Scalars['Int']['input'];
}>;


export interface ProposalQuery { __typename?: 'QueryRoot', proposalDetail?: { __typename?: 'ProposalDetail', depositAmount: number | string, description: string, id: number, kind: ProposalKind, outcome?: ProposalOutcome | null, payload: unknown, state: ProposalState, title: string } | null }

export type RecentSwapPricesQueryVariables = Exact<{
  limit?: InputMaybe<Scalars['Int']['input']>;
}>;


export interface RecentSwapPricesQuery { __typename?: 'QueryRoot', recentSwapPrices: { __typename?: 'RecentSwapPrice', inputAssetId: string, outputAssetId: string, avgPrice: number, swapCount: number, latestSwap?: string | null }[] }

export type SearchQueryVariables = Exact<{
  slug: Scalars['String']['input'];
}>;


export interface SearchQuery { __typename?: 'QueryRoot', search?: { __typename: 'Block', height: number } | { __typename: 'Transaction', hash: string } | { __typename: 'ValidatorSearchResults', items: { __typename?: 'ValidatorSearchResult', id: string, displayName: string }[] } | null }

export type StatsQueryVariables = Exact<Record<string, never>>;


export interface StatsQuery { __typename?: 'QueryRoot', stats: { __typename?: 'Stats', totalTransactionsCount: number } }

export type SwapVolumeHistoryQueryVariables = Exact<{
  days?: InputMaybe<Scalars['Int']['input']>;
}>;


export interface SwapVolumeHistoryQuery { __typename?: 'QueryRoot', swapVolumeHistory: { __typename?: 'SwapVolumeHistory', date: string, totalVolume: string, swapCount: number, arbCount: number, organicCount: number }[] }

export type TotalShieldedVolumeQueryVariables = Exact<Record<string, never>>;


export interface TotalShieldedVolumeQuery { __typename?: 'QueryRoot', ibcTotalShieldedVolume: { __typename?: 'TotalShieldedVolume', value: string } }

export type TradingPairLiquidityQueryVariables = Exact<{
  limit?: InputMaybe<Scalars['Int']['input']>;
}>;


export interface TradingPairLiquidityQuery { __typename?: 'QueryRoot', tradingPairLiquidity: { __typename?: 'TradingPairLiquidity', tradingPairAsset1: string, tradingPairAsset2: string, activePositions: number, totalReserves1: string, totalReserves2: string, avgFeePercentage: number }[] }

export type TradingVolume24hQueryVariables = Exact<{
  limit?: InputMaybe<Scalars['Int']['input']>;
}>;


export interface TradingVolume24hQuery { __typename?: 'QueryRoot', tradingVolume24h: { __typename?: 'TradingVolume24h', assetId: string, volume24h: string, swapCount24h: number, periodStart?: string | null, periodEnd?: string | null }[] }

export type TransactionQueryVariables = Exact<{
  hash: Scalars['String']['input'];
}>;


export interface TransactionQuery { __typename?: 'QueryRoot', transaction?: { __typename?: 'Transaction', hash: string, raw: string, rawJson: unknown, block: { __typename?: 'Block', height: number, createdAt: string }, body: { __typename?: 'TransactionBody', parameters: { __typename?: 'TransactionParameters', chainId: string, fee: { __typename?: 'Fee', amount: string } } } } | null }

export type TransactionsQueryVariables = Exact<{
  limit: CollectionLimit;
  filter?: InputMaybe<TransactionFilter>;
}>;


export interface TransactionsQuery { __typename?: 'QueryRoot', transactions: { __typename?: 'TransactionCollection', total: number, items: { __typename?: 'Transaction', hash: string, ibcStatus: IbcStatus, raw: string, block: { __typename?: 'Block', height: number, createdAt: string } }[] } }

export type ValidatorActiveSinceQueryVariables = Exact<{
  id: Scalars['String']['input'];
}>;


export interface ValidatorActiveSinceQuery { __typename?: 'QueryRoot', validatorDetails?: { __typename?: 'ValidatorDetails', activeSince?: string | null } | null }

export type ValidatorBlocksQueryVariables = Exact<{
  id: Scalars['String']['input'];
}>;


export interface ValidatorBlocksQuery { __typename?: 'QueryRoot', validatorDetails?: { __typename?: 'ValidatorDetails', state: ValidatorState, last300Blocks: { __typename?: 'BlockParticipation', height: number, signed: boolean }[] } | null }

export type ValidatorDelegatesQueryVariables = Exact<{
  validatorId: Scalars['String']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
}>;


export interface ValidatorDelegatesQuery { __typename?: 'QueryRoot', validatorDelegates: { __typename?: 'Delegate', id: number, txHash: string, validatorIdentityKey: string, delegationAmount: string, unbondedAmount: string, epochIndex: number, blockHeight: number, timestamp: string }[] }

export type ValidatorParametersQueryVariables = Exact<Record<string, never>>;


export interface ValidatorParametersQuery { __typename?: 'QueryRoot', validatorsHomepage: { __typename?: 'ValidatorHomepageData', stakingParameters: { __typename?: 'StakingParameters', uptimeBlocksWindow: number, uptimeMinRequired: number, slashingPenaltyDowntime: number, slashingPenaltyMisbehavior: number, unbondingDelay: number } } }

export type ValidatorQueryVariables = Exact<{
  id: Scalars['String']['input'];
}>;


export interface ValidatorQuery { __typename?: 'QueryRoot', validatorDetails?: { __typename?: 'ValidatorDetails', id: string, name?: string | null, state: ValidatorState, bondingState: BondingState, website?: string | null, description?: string | null, totalUptime?: number | null, uptimeBlockWindow: number, signedBlocks: number, missedBlocks: number, commissionPercentage: number, commissionStreams: { __typename?: 'CommissionInfo', recipientAddress?: string | null, streamType: string, rateBps: number }[] } | null }

export type ValidatorStakingStatsQueryVariables = Exact<{
  validatorId: Scalars['String']['input'];
}>;


export interface ValidatorStakingStatsQuery { __typename?: 'QueryRoot', validatorStakingStats?: { __typename?: 'ValidatorStakingStats', validatorIdentityKey: string, totalDelegations: string, totalUndelegations: string, pendingUndelegations: string, pendingUndelegateCount: number, nextReleaseHeight?: number | null } | null }

export type ValidatorUndelegatesQueryVariables = Exact<{
  validatorId: Scalars['String']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  pendingOnly?: InputMaybe<Scalars['Boolean']['input']>;
}>;


export interface ValidatorUndelegatesQuery { __typename?: 'QueryRoot', validatorUndelegates: { __typename?: 'Undelegate', id: number, txHash: string, validatorIdentityKey: string, delegationAmount: string, unbondedAmount: string, epochIndex: number, unbondingStartHeight: number, releaseHeight: number, blockHeight: number, timestamp: string, claimed: boolean }[] }

export type ValidatorVotingPercentageQueryVariables = Exact<{
  id: Scalars['String']['input'];
}>;


export interface ValidatorVotingPercentageQuery { __typename?: 'QueryRoot', validatorDetails?: { __typename?: 'ValidatorDetails', votingPowerActivePercentage: number } | null }

export type ValidatorVotingPowerHistoryQueryVariables = Exact<{
  validatorId: Scalars['String']['input'];
  startTime?: InputMaybe<Scalars['DateTime']['input']>;
  endTime?: InputMaybe<Scalars['DateTime']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
}>;


export interface ValidatorVotingPowerHistoryQuery { __typename?: 'QueryRoot', validatorVotingPowerHistory: { __typename?: 'VotingPowerHistoryEntry', validatorIdentityKey: string, votingPower: number, blockHeight: number, timestamp: string }[] }

export type ValidatorVotingPowerQueryVariables = Exact<{
  id: Scalars['String']['input'];
}>;


export interface ValidatorVotingPowerQuery { __typename?: 'QueryRoot', validatorDetails?: { __typename?: 'ValidatorDetails', state: ValidatorState, votingPower: number } | null }

export type ValidatorsQueryVariables = Exact<{
  filter?: InputMaybe<ValidatorFilter>;
}>;


export interface ValidatorsQuery { __typename?: 'QueryRoot', validatorsHomepage: { __typename?: 'ValidatorHomepageData', validators: { __typename?: 'Validator', id: string, name?: string | null, state: ValidatorState, bondingState: BondingState, votingPower: number, votingPowerActivePercentage: number, uptime?: number | null, firstSeenTime?: string | null, commission: number }[] } }

export type VotesQueryVariables = Exact<{
  proposalId: Scalars['Int']['input'];
  limit: CollectionLimit;
}>;


export interface VotesQuery { __typename?: 'QueryRoot', proposalDetail?: { __typename?: 'ProposalDetail', votes: { __typename?: 'VoteCollection', total: number, items: { __typename?: 'Vote', effectiveVotingPower: number | string, id?: string | null, name: string, txHash?: string | null, vote?: VoteValue | null, votedAt: string, votingPowerPercentage: number | string }[] } } | null }

export type VotingEndQueryVariables = Exact<{
  proposalId: Scalars['Int']['input'];
}>;


export interface VotingEndQuery { __typename?: 'QueryRoot', proposalDetail?: { __typename?: 'ProposalDetail', state: ProposalState, votingEndedBlockHeight: number, votingEndedTimestamp?: string | null } | null }

export type VotingQueryVariables = Exact<{
  proposalId: Scalars['Int']['input'];
}>;


export interface VotingQuery { __typename?: 'QueryRoot', proposalDetail?: { __typename?: 'ProposalDetail', abstainVotes: number | string, abstainVotesPercentage: number | string, noVotes: number | string, noVotesPercentage: number | string, outcome?: ProposalOutcome | null, quorum: number | string, state: ProposalState, totalVotes: number | string, yesVotes: number | string, yesVotesPercentage: number | string } | null }

export type VotingStartQueryVariables = Exact<{
  proposalId: Scalars['Int']['input'];
}>;


export interface VotingStartQuery { __typename?: 'QueryRoot', proposalDetail?: { __typename?: 'ProposalDetail', votingStartedBlockHeight: number, votingStartedTimestamp: string } | null }

export type BlockUpdateSubscriptionVariables = Exact<Record<string, never>>;


export interface BlockUpdateSubscription { __typename?: 'Root', latestBlocks: { __typename?: 'BlockUpdate', height: number, createdAt: string, transactionsCount: number } }

export type ChainParametersUpdateSubscriptionVariables = Exact<Record<string, never>>;


export interface ChainParametersUpdateSubscription { __typename?: 'Root', chainParameters: { __typename?: 'ChainParametersUpdate', chainId: string, currentBlockTime: string, currentBlockHeight: number, currentEpoch: number, epochDuration: number, nextEpochIn: number } }

export type TotalShieldedVolumeUpdateSubscriptionVariables = Exact<Record<string, never>>;


export interface TotalShieldedVolumeUpdateSubscription { __typename?: 'Root', totalShieldedVolume: { __typename?: 'TotalShieldedVolumeUpdate', value: string } }

export type TransactionCountUpdateSubscriptionVariables = Exact<Record<string, never>>;


export interface TransactionCountUpdateSubscription { __typename?: 'Root', transactionCount: { __typename?: 'TransactionCountUpdate', count: number } }

export type TransactionUpdateSubscriptionVariables = Exact<Record<string, never>>;


export interface TransactionUpdateSubscription { __typename?: 'Root', latestTransactions: { __typename?: 'TransactionUpdate', hash: string, id: number, raw: string } }

export type ValidatorBlockUpdateSubscriptionVariables = Exact<{
  id: Scalars['String']['input'];
}>;


export interface ValidatorBlockUpdateSubscription { __typename?: 'Root', validatorBlocks: { __typename?: 'ValidatorBlockUpdate', blockHeight: number, signed: boolean } }

export const PartialTransactionFragmentDoc = gql`
    fragment PartialTransaction on Transaction {
  hash
  block {
    height
    createdAt
  }
  ibcStatus
  raw
}
    `;
export const BlockFragmentDoc = gql`
    fragment Block on Block {
  height
  createdAt
  transactions {
    ...PartialTransaction
  }
  rawJson
}
    ${PartialTransactionFragmentDoc}`;
export const PartialBlockFragmentDoc = gql`
    fragment PartialBlock on Block {
  height
  createdAt
  transactionsCount
}
    `;
export const TransactionFragmentDoc = gql`
    fragment Transaction on Transaction {
  hash
  block {
    height
    createdAt
  }
  body {
    parameters {
      chainId
      fee {
        amount
      }
    }
  }
  raw
  rawJson
}
    `;
export const ActiveProposalsDocument = gql`
    query ActiveProposals {
  activeProposals {
    endBlockHeight
    id
    kind
    state
    title
  }
}
    `;
export const ActiveValidatorsDocument = gql`
    query ActiveValidators {
  validatorsHomepage {
    stakingParameters {
      activeValidatorCount
      activeValidatorLimit
    }
  }
}
    `;
export const ActiveVotingPowerDocument = gql`
    query ActiveVotingPower($filter: ValidatorFilter) {
  validatorsHomepage(filter: $filter) {
    stakingParameters {
      totalStaked
    }
  }
}
    `;
export const BlockDocument = gql`
    query Block($height: Int!) {
  block(height: $height) {
    ...Block
  }
}
    ${BlockFragmentDoc}`;
export const BlocksDocument = gql`
    query Blocks($limit: CollectionLimit!, $filter: BlockFilter) {
  blocks(limit: $limit, filter: $filter) {
    items {
      ...PartialBlock
    }
    total
  }
}
    ${PartialBlockFragmentDoc}`;
export const ChainParametersDocument = gql`
    query ChainParameters {
  validatorsHomepage {
    chainParameters {
      chainId
      currentBlockTime
      currentBlockHeight
      currentEpoch
      epochDuration
      nextEpochIn
    }
  }
}
    `;
export const DexBlockExecutionsDocument = gql`
    query DexBlockExecutions($filter: SwapExecutionFilter) {
  latestExecutions(filter: $filter) {
    blockHeight
    timestamp
    batchSwaps {
      id
      executionType
      totalInputAssetId
      totalInputAmount
      totalOutputAssetId
      totalOutputAmount
      individualSwaps {
        routeSteps {
          assetId
          amount
        }
      }
    }
  }
}
    `;
export const DexLiquidityPositionsDocument = gql`
    query DexLiquidityPositions($limit: CollectionLimit!, $filter: LiquidityPositionFilter) {
  liquidityPositions(limit: $limit, filter: $filter) {
    items {
      tradingPairAsset1
      tradingPairAsset2
      reserves1Amount
      reserves2Amount
      state
      feePercentage
      updatedAt
      positionId
    }
    total
  }
}
    `;
export const DexOpenPositionsDocument = gql`
    query DexOpenPositions {
  dexStats {
    openPositions
  }
}
    `;
export const DexTotalExecutionsDocument = gql`
    query DexTotalExecutions {
  dexStats {
    totalExecutions
  }
}
    `;
export const GovParametersDocument = gql`
    query GovParameters {
  governanceParameters {
    depositAmount
    passingThreshold
    proposalDuration
    slashingThreshold
    validQuorum
  }
}
    `;
export const IbcFlowHistoryDocument = gql`
    query IbcFlowHistory($clientId: String, $days: Int) {
  ibcFlowHistory(clientId: $clientId, days: $days) {
    date
    inflowVolume
    outflowVolume
    inflowCount
    outflowCount
  }
}
    `;
export const IbcStatsDocument = gql`
    query IbcStats($clientId: String) {
  ibcStats(clientId: $clientId) {
    id: clientId
    status
    channelId
    counterpartyChannelId
    lastUpdated
    shieldedVolume
    shieldedTxCount
    unshieldedVolume
    unshieldedTxCount
    totalTxCount
    pendingTxCount
    expiredTxCount
  }
}
    `;
export const MinValidatorStakeDocument = gql`
    query MinValidatorStake {
  validatorsHomepage {
    stakingParameters {
      minValidatorStake
    }
  }
}
    `;
export const PastProposalsDocument = gql`
    query PastProposals($limit: CollectionLimit!) {
  pastProposals(limit: $limit) {
    items {
      endBlockHeight
      endTimestamp
      id
      kind
      outcome
      state
      title
      totalVotes
    }
    total
  }
}
    `;
export const ProposalDocument = gql`
    query Proposal($id: Int!) {
  proposalDetail(id: $id) {
    depositAmount
    description
    id
    kind
    outcome
    payload
    state
    title
  }
}
    `;
export const RecentSwapPricesDocument = gql`
    query RecentSwapPrices($limit: Int) {
  recentSwapPrices(limit: $limit) {
    inputAssetId
    outputAssetId
    avgPrice
    swapCount
    latestSwap
  }
}
    `;
export const SearchDocument = gql`
    query Search($slug: String!) {
  search(slug: $slug) {
    __typename
    ... on Block {
      height
    }
    ... on Transaction {
      hash
    }
    ... on ValidatorSearchResults {
      items {
        id
        displayName
      }
    }
  }
}
    `;
export const StatsDocument = gql`
    query Stats {
  stats {
    totalTransactionsCount
  }
}
    `;
export const SwapVolumeHistoryDocument = gql`
    query SwapVolumeHistory($days: Int) {
  swapVolumeHistory(days: $days) {
    date
    totalVolume
    swapCount
    arbCount
    organicCount
  }
}
    `;
export const TotalShieldedVolumeDocument = gql`
    query TotalShieldedVolume {
  ibcTotalShieldedVolume {
    value
  }
}
    `;
export const TradingPairLiquidityDocument = gql`
    query TradingPairLiquidity($limit: Int) {
  tradingPairLiquidity(limit: $limit) {
    tradingPairAsset1
    tradingPairAsset2
    activePositions
    totalReserves1
    totalReserves2
    avgFeePercentage
  }
}
    `;
export const TradingVolume24hDocument = gql`
    query TradingVolume24h($limit: Int) {
  tradingVolume24h(limit: $limit) {
    assetId
    volume24h
    swapCount24h
    periodStart
    periodEnd
  }
}
    `;
export const TransactionDocument = gql`
    query Transaction($hash: String!) {
  transaction(hash: $hash) {
    ...Transaction
  }
}
    ${TransactionFragmentDoc}`;
export const TransactionsDocument = gql`
    query Transactions($limit: CollectionLimit!, $filter: TransactionFilter) {
  transactions(limit: $limit, filter: $filter) {
    items {
      ...PartialTransaction
    }
    total
  }
}
    ${PartialTransactionFragmentDoc}`;
export const ValidatorActiveSinceDocument = gql`
    query ValidatorActiveSince($id: String!) {
  validatorDetails(id: $id) {
    activeSince
  }
}
    `;
export const ValidatorBlocksDocument = gql`
    query ValidatorBlocks($id: String!) {
  validatorDetails(id: $id) {
    state
    last300Blocks {
      height
      signed
    }
  }
}
    `;
export const ValidatorDelegatesDocument = gql`
    query ValidatorDelegates($validatorId: String!, $limit: Int, $offset: Int) {
  validatorDelegates(validatorId: $validatorId, limit: $limit, offset: $offset) {
    id
    txHash
    validatorIdentityKey
    delegationAmount
    unbondedAmount
    epochIndex
    blockHeight
    timestamp
  }
}
    `;
export const ValidatorParametersDocument = gql`
    query ValidatorParameters {
  validatorsHomepage {
    stakingParameters {
      uptimeBlocksWindow
      uptimeMinRequired
      slashingPenaltyDowntime
      slashingPenaltyMisbehavior
      unbondingDelay
    }
  }
}
    `;
export const ValidatorDocument = gql`
    query Validator($id: String!) {
  validatorDetails(id: $id) {
    id
    name
    state
    bondingState
    website
    description
    totalUptime
    uptimeBlockWindow
    signedBlocks
    missedBlocks
    commissionPercentage
    commissionStreams {
      recipientAddress
      streamType
      rateBps
    }
  }
}
    `;
export const ValidatorStakingStatsDocument = gql`
    query ValidatorStakingStats($validatorId: String!) {
  validatorStakingStats(validatorId: $validatorId) {
    validatorIdentityKey
    totalDelegations
    totalUndelegations
    pendingUndelegations
    pendingUndelegateCount
    nextReleaseHeight
  }
}
    `;
export const ValidatorUndelegatesDocument = gql`
    query ValidatorUndelegates($validatorId: String!, $limit: Int, $offset: Int, $pendingOnly: Boolean) {
  validatorUndelegates(
    validatorId: $validatorId
    limit: $limit
    offset: $offset
    pendingOnly: $pendingOnly
  ) {
    id
    txHash
    validatorIdentityKey
    delegationAmount
    unbondedAmount
    epochIndex
    unbondingStartHeight
    releaseHeight
    blockHeight
    timestamp
    claimed
  }
}
    `;
export const ValidatorVotingPercentageDocument = gql`
    query ValidatorVotingPercentage($id: String!) {
  validatorDetails(id: $id) {
    votingPowerActivePercentage
  }
}
    `;
export const ValidatorVotingPowerHistoryDocument = gql`
    query ValidatorVotingPowerHistory($validatorId: String!, $startTime: DateTime, $endTime: DateTime, $limit: Int) {
  validatorVotingPowerHistory(
    validatorId: $validatorId
    startTime: $startTime
    endTime: $endTime
    limit: $limit
  ) {
    validatorIdentityKey
    votingPower
    blockHeight
    timestamp
  }
}
    `;
export const ValidatorVotingPowerDocument = gql`
    query ValidatorVotingPower($id: String!) {
  validatorDetails(id: $id) {
    state
    votingPower
  }
}
    `;
export const ValidatorsDocument = gql`
    query Validators($filter: ValidatorFilter) {
  validatorsHomepage(filter: $filter) {
    validators {
      id
      name
      state
      bondingState
      votingPower
      votingPowerActivePercentage
      uptime
      firstSeenTime
      commission
    }
  }
}
    `;
export const VotesDocument = gql`
    query Votes($proposalId: Int!, $limit: CollectionLimit!) {
  proposalDetail(id: $proposalId) {
    votes(limit: $limit) {
      items {
        effectiveVotingPower
        id
        name
        txHash
        vote
        votedAt
        votingPowerPercentage
      }
      total
    }
  }
}
    `;
export const VotingEndDocument = gql`
    query VotingEnd($proposalId: Int!) {
  proposalDetail(id: $proposalId) {
    state
    votingEndedBlockHeight
    votingEndedTimestamp
  }
}
    `;
export const VotingDocument = gql`
    query Voting($proposalId: Int!) {
  proposalDetail(id: $proposalId) {
    abstainVotes
    abstainVotesPercentage
    noVotes
    noVotesPercentage
    outcome
    quorum
    state
    totalVotes
    yesVotes
    yesVotesPercentage
  }
}
    `;
export const VotingStartDocument = gql`
    query VotingStart($proposalId: Int!) {
  proposalDetail(id: $proposalId) {
    votingStartedBlockHeight
    votingStartedTimestamp
  }
}
    `;
export const BlockUpdateDocument = gql`
    subscription BlockUpdate {
  latestBlocks(limit: 1) {
    height
    createdAt
    transactionsCount
  }
}
    `;
export const ChainParametersUpdateDocument = gql`
    subscription ChainParametersUpdate {
  chainParameters {
    chainId
    currentBlockTime
    currentBlockHeight
    currentEpoch
    epochDuration
    nextEpochIn
  }
}
    `;
export const TotalShieldedVolumeUpdateDocument = gql`
    subscription TotalShieldedVolumeUpdate {
  totalShieldedVolume {
    value
  }
}
    `;
export const TransactionCountUpdateDocument = gql`
    subscription TransactionCountUpdate {
  transactionCount {
    count
  }
}
    `;
export const TransactionUpdateDocument = gql`
    subscription TransactionUpdate {
  latestTransactions(limit: 1) {
    hash
    id
    raw
  }
}
    `;
export const ValidatorBlockUpdateDocument = gql`
    subscription ValidatorBlockUpdate($id: String!) {
  validatorBlocks(validatorId: $id) {
    blockHeight
    signed
  }
}
    `;