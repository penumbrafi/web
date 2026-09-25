import { redirect } from 'next/navigation';
import { FC } from 'react';
export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

const ValidatorLegacyRedirect: FC<Props> = async props => {
  const { id } = await props.params;
  redirect(`/explore/validators/${encodeURIComponent(id)}`);
};

export default ValidatorLegacyRedirect;
