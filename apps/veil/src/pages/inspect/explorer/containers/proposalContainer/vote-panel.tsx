'use client';

import { type ReactNode, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@penumbra-zone/ui/Button';
import {
  Vote,
  Vote_Vote,
} from '@penumbra-zone/protobuf/penumbra/core/component/governance/v1/governance_pb';
import { AddressIndex } from '@penumbra-zone/protobuf/penumbra/core/keys/v1/keys_pb';
import { TransactionPlannerRequest } from '@penumbra-zone/protobuf/penumbra/view/v1/view_pb';
import { TransactionPlan } from '@penumbra-zone/protobuf/penumbra/core/transaction/v1/transaction_pb';
import { ConnectButton } from '@/features/connect/connect-button';
import { planBuildBroadcast } from '@/entities/transaction/api/plan-build-broadcast';
import { connectionStore } from '@/shared/model/connection';
import { apiFetch } from '@/shared/utils/api-fetch';
import type { VoteContext } from '@/shared/api/server/governance/vote-context';

const CHOICES: { label: string; vote: Vote_Vote }[] = [
  { label: 'Yes', vote: Vote_Vote.YES },
  { label: 'No', vote: Vote_Vote.NO },
  { label: 'Abstain', vote: Vote_Vote.ABSTAIN },
];

const NO_VOTING_POWER =
  'This account held no staked UM when voting opened on this proposal, so it has no votes to cast. Only delegations that existed at the proposal start, to a validator that was active then, can vote. Try another account if your stake is elsewhere.';

/**
 * The planner returns a plan even when it found nothing to vote with: a
 * fee-only transaction. Signing that costs a fee and votes nothing, which is
 * the failure users of the old Zafu vote screen hit. Refuse it before the
 * wallet ever asks for approval.
 */
const requireVote = (plan: TransactionPlan) => {
  if (!plan.actions.some(a => a.action.case === 'delegatorVote')) {
    throw new Error(NO_VOTING_POWER);
  }
};

/**
 * Vote on a proposal from the explorer page, as a delegator.
 *
 * Votes go through the connected wallet's planner and signer; this component
 * only supplies the proposal-start context (height, tree position, rate
 * data) that the planner needs and cannot look up itself. See
 * `vote-context.ts` for why getting those right is the whole job.
 */
export const VotePanel = observer(({ proposalId }: { proposalId: number }) => {
  const [pending, setPending] = useState<Vote_Vote | null>(null);
  const [cast, setCast] = useState<{ vote: Vote_Vote; account: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const context = useQuery({
    queryKey: ['governance-vote-context', proposalId],
    // Proposal-start data is immutable once the proposal exists.
    staleTime: Infinity,
    queryFn: () => apiFetch<VoteContext>('/api/governance/vote-context', { proposalId }),
  });

  const submit = async (vote: Vote_Vote) => {
    if (!context.data) {
      return;
    }
    setPending(vote);
    setError(null);
    const account = connectionStore.subaccount;
    try {
      const req = new TransactionPlannerRequest({
        source: new AddressIndex({ account }),
        delegatorVotes: [
          {
            proposal: BigInt(proposalId),
            vote: new Vote({ vote }),
            startBlockHeight: BigInt(context.data.startBlockHeight),
            startPosition: BigInt(context.data.startPosition),
            rateData: context.data.rateData,
          },
        ],
      });
      const result = await planBuildBroadcast('delegatorVote', req, { validatePlan: requireVote });
      if (result) {
        setCast({ vote, account });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  };

  let voteArea: ReactNode;
  if (!connectionStore.connected) {
    voteArea = (
      <div className='w-fit'>
        <ConnectButton actionType='accent' />
      </div>
    );
  } else if (context.isError) {
    voteArea = (
      <span className='text-sm text-destructive-light'>
        Could not load this proposal&apos;s voting data. Reload the page to try again.
      </span>
    );
  } else {
    voteArea = (
      <div className='flex flex-wrap gap-2'>
        {CHOICES.map(c => (
          <div key={c.label} className='min-w-24'>
            <Button
              actionType={c.vote === Vote_Vote.YES ? 'accent' : 'default'}
              disabled={!context.data || pending !== null}
              onClick={() => void submit(c.vote)}
            >
              {pending === c.vote ? 'Voting…' : c.label}
            </Button>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-3 rounded-lg border border-other-tonal-stroke p-4'>
      <div className='flex flex-col gap-1'>
        <span className='text-base font-medium'>Cast your vote</span>
        <span className='text-sm text-text-secondary'>
          Your vote carries the UM you had staked when voting opened. Your wallet shows the
          transaction before you sign. A vote is final: it cannot be changed once cast.
        </span>
      </div>

      {voteArea}

      {cast && (
        <span className='text-sm text-success-light'>
          Voted {CHOICES.find(c => c.vote === cast.vote)?.label} from account #{cast.account}.
        </span>
      )}
      {error && <span className='text-sm text-destructive-light'>{error}</span>}
    </div>
  );
});
