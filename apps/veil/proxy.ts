// "/trade" → last-viewed pair (cookie) or default,
// "/trade/:base/:quote" → records last-viewed pair in a cookie.
export const config = {
  matcher: ['/trade', '/trade/:base/:quote'],
};

export { routingProxy as proxy } from '@/shared/index.server';
