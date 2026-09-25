import { redirect } from 'next/navigation';

// Staking-related actions now live on /explore/validators — one list, one
// place to act. This route stays as a bookmark redirect so old links don't
// 404. `?delegate=<identityKey>` is preserved so deep links from tournament
// pages / third parties still open the delegate dialog on the right row.
export default async function PortfolioStakingRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {qs.set(key, value);}
  }
  const q = qs.toString();
  redirect(q ? `/explore/validators?${q}` : '/explore/validators');
}
