import { SITE } from '@/shared/config/site';

// A short guide for AI assistants (https://llmstxt.org): what this site is,
// where things are, and what it will never ask for. Plain facts, no data.
const BODY = `# ${SITE.name}

> ${SITE.description}

Penumbra is a proof-of-stake chain where every balance and transaction is shielded by
default. This site is a front end for it: a DEX with concentrated liquidity, staking,
a block explorer, and deposits and withdrawals over IBC. It runs in the browser with the
Zafu wallet (or another Penumbra wallet); your keys and balances stay in the wallet.

## Pages

- [Home](/): markets, prices, 24h volume.
- [Trade](/trade): order book, chart, market and limit orders, liquidity positions.
- [Portfolio](/portfolio): your balances (decrypted in your wallet), positions, staking.
- [Deposit](/portfolio/deposit): move funds in from an exchange or a Cosmos wallet; or share a
  deposit link so someone else can pay into your account.
- [Explorer](/explore): blocks, transactions, validators, governance, IBC channels, DEX stats.
  Your own transactions can be decrypted in place with your wallet.
- [Tournament](/tournament): the liquidity tournament and its rewards.
- [Learn](/learn): how Penumbra, shielding and liquidity positions work.

## Privacy

- Balances, trades and positions are only readable by their owner's wallet. The site
  decrypts nothing on its server.
- Deposits land on a fresh single-use address, so the sending chain cannot link them to
  your main address.
- The site never asks for a seed phrase or private key.

## Links

- Source: https://github.com/penumbrafi/web
- Penumbra protocol: https://github.com/penumbrafi/penumbra
`;

export const dynamic = 'force-static';

export function GET() {
  return new Response(BODY, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
