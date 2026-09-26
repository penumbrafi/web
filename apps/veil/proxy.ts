// "/trade" → last-viewed pair (cookie, written by the trade page) or default.
export const config = {
  matcher: ['/trade'],
};

export { routingProxy as proxy } from '@/shared/index.server';
