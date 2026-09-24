import { notFound } from 'next/navigation';
import { FC } from 'react';
import { Breadcrumb, Breadcrumbs, Container } from '@/pages/inspect/explorer/components';
import {
  ProposalContainer,
  VoteTableContainer,
  VotingContainer,
  VotingEndPanelContainer,
  VotingStartPanelContainer,
} from '@/pages/inspect/explorer/containers';
export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}

const ProposalPage: FC<Props> = async props => {
  const params = await props.params;
  const id = Number(params.id);
  const searchParams = await props.searchParams;
  const page = searchParams.page ? Number(searchParams.page) - 1 : 0;

  if (Number.isNaN(id) || id < 0 || Number.isNaN(page) || page < 0) {
    notFound();
  }

  const length = 20;
  const offset = page * length;

  return (
    <Container>
      <Breadcrumbs>
        <Breadcrumb href='/explore'>Explore</Breadcrumb>
        <Breadcrumb href='/explore/governance'>Governance</Breadcrumb>
      </Breadcrumbs>
      <div className='flex flex-col gap-4 md:flex-row md:items-start'>
        <ProposalContainer
          className='lg:w-[520px]! xl:w-[640px]! md:w-[420px]'
          proposalId={id}
        />
        <div className='flex flex-1 flex-col gap-4'>
          <div className='flex flex-col gap-4 sm:flex-row'>
            <VotingStartPanelContainer className='flex-1' proposalId={id} />
            <VotingEndPanelContainer className='flex-1' proposalId={id} />
          </div>
          <VotingContainer proposalId={id} />
          <VoteTableContainer limit={{ length, offset }} proposalId={id} pagination />
        </div>
      </div>
    </Container>
  );
};

export default ProposalPage;
