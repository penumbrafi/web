import { redirect } from 'next/navigation';

// Staking now lives inside /portfolio (positions + unbonding) with the actual
// delegate/undelegate flow triggered from /explore/validators/[id]. This
// route stays as a bookmark redirect for a while so old links don't 404.
export default function PortfolioStakingRedirect() {
  redirect('/portfolio');
}
