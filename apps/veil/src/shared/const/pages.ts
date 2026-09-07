import { usePagePath } from '@/shared/utils/usePagePath.ts';

export enum PagePath {
  Home = '/',
  // Was '/inspect' (chain explorer); promoted to '/explore' as the
  // top-level chain-explorer namespace. The market-overview/landing page
  // that used to live at '/explore' is now the root `Home`.
  Explore = '/explore',
  // Staking lives here: the validator list and the delegate/undelegate
  // actions are the same page.
  ExploreValidators = '/explore/validators',
  Trade = '/trade',
  Portfolio = '/portfolio',
  Tournament = '/tournament',
  Tokenomics = '/learn/tokenomics',
  TournamentRound = '/tournament/:epoch',
  TournamentDelegator = '/tournament/delegator/:address',
  TradePair = '/trade/:primary/:numeraire',
  ExploreLp = '/explore/lp/:id',
  LpLeaderboard = '/explore/lp-leaderboard',
  Learn = '/learn',
  LearnFaq = '/learn/faq',
}

const basePath: Partial<Record<PagePath, PagePath>> = {
  [PagePath.TradePair]: PagePath.Trade,
  [PagePath.ExploreValidators]: PagePath.Explore,
  '/explore/lp/:id': PagePath.Explore,
  '/tournament/:epoch': PagePath.Tournament,
};

// predefined query params for pages
export enum QueryParams {
  PortfolioShowShieldingTicker = 'showShieldingTicker',
}

// Used for dynamic routing when wanting to exclude the dynamic elements
export const useBasePath = (): PagePath => {
  const path = usePagePath();

  const base = basePath[path];
  if (base) {
    return base;
  }
  return path;
};

export const getTradePairPath = (
  primary: string,
  numeraire: string,
  options: { highlight?: 'liquidity' } = {},
): string => {
  const route = PagePath.TradePair.replace(':primary', primary).replace(':numeraire', numeraire);
  const query = options.highlight ? `?highlight=${options.highlight}` : '';
  return `${route}${query}`;
};

export const getPortfolioPath = (options: { showShieldingTicker?: boolean } = {}): string => {
  const route = PagePath.Portfolio;
  let query = '';

  if (options.showShieldingTicker === true) {
    query = `?${QueryParams.PortfolioShowShieldingTicker}=true`;
  }

  if (options.showShieldingTicker === false) {
    query = `?${QueryParams.PortfolioShowShieldingTicker}=false`;
  }

  return `${route}${query}`;
};
