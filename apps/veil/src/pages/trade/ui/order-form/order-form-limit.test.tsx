import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { runInAction } from 'mobx';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { enableStaticRendering } from 'mobx-react-lite';
import { TooltipProvider } from '@penumbra-zone/ui/Tooltip';
import { ClientEnvProvider } from '@/shared/api/env';
import { AssetId, Metadata } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { Address, AddressIndex } from '@penumbra-zone/protobuf/penumbra/core/keys/v1/keys_pb';
import { AssetInfo } from '@/pages/trade/model/AssetInfo';
import { connectionStore } from '@/shared/model/connection';
import type { Trace } from '@/shared/api/server/book/types';
import { LimitOrderForm } from './order-form-limit';
import { OrderFormStore } from './store/OrderFormStore';

// The app sources compile with the automatic JSX runtime under Next, but
// vitest's esbuild uses the classic transform, so expose `React` globally.
// This runs at import time, before any test body renders anything.
(globalThis as unknown as { React: typeof React }).React = React;

// The form reads the route's pair symbols and resubscribes the block stream
// per block; neither the router nor the chain exists in a server render.
vi.mock('next/navigation', () => ({
  useParams: () => ({ baseSymbol: 'UM', quoteSymbol: 'USDC' }),
  usePathname: () => '/trade/UM/USDC',
}));

// Matches `app/app.tsx`: no observable subscriptions in a server render.
enableStaticRendering(true);

const CLIENT_ENV = {
  PENUMBRA_CHAIN_ID: 'penumbra-testnet-deimos-8',
  PENUMBRA_CUILOA_URL: 'http://127.0.0.1:8080',
  PENUMBRA_GRPC_ENDPOINT: 'http://127.0.0.1:8080',
  BASE_URL: 'http://127.0.0.1:3000',
};

const row = (price: number, amount = 5): Trace => ({
  price: String(price),
  amount: String(amount),
  total: String(amount),
  hops: ['UM', 'USDC'],
});

const asset = (symbol: string, fill: number, balance?: number): AssetInfo =>
  new AssetInfo(
    new Metadata({ symbol }),
    new AssetId({ inner: new Uint8Array(Array(32).fill(fill)) }),
    6,
    symbol,
    balance,
  );

const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' | ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** The Limit tab, connected, with a book and 11.5 typed as the target. */
const makeStore = () => {
  const store = new OrderFormStore();
  store.setSubAccountIndex(new AddressIndex({ account: 0 }));
  store.setAddress(new Address({ altBech32m: 'penumbra1testaddress' }));
  store.setAssets(asset('UM', 0xaa, 100), asset('USDC', 0xbb, 1000), true);
  store.setWhichForm('Limit');
  runInAction(() => {
    store.setMarketPrice(11);
    connectionStore.connected = true;
  });
  store.limitForm.setBookRows([row(12), row(10), row(8)], [row(20), row(12), row(10)]);
  store.limitForm.setPriceInput('11.5');
  return store;
};

const render = (store: OrderFormStore) =>
  textOf(
    renderToStaticMarkup(
      <ClientEnvProvider value={CLIENT_ENV}>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          {/* The registry provider gates its children on a network fetch and
              nothing in this form reads it (the store is passed in), so it is
              deliberately left out of the tree. */}
          <TooltipProvider delayDuration={0}>
            <LimitOrderForm parentStore={store} />
          </TooltipProvider>
        </QueryClientProvider>
      </ClientEnvProvider>,
    ),
  );

test('take mode shows the target price and the size that reaches it', () => {
  const store = makeStore();
  store.limitForm.setMode('take');
  const text = render(store);

  // The chips that pick the mode, and the label on the price field.
  expect(text).toContain('Take');
  expect(text).toContain('Rest');
  expect(text).toContain('Move UM to');
  // The sizer's own account of what the order does, and the amounts it filled
  // in: 5 UM for 50 USDC, the last level taken at the typed target.
  expect(text).toContain('Takes 5 UM for 50 USDC — the last level taken sits at 11.5 USDC');
  expect(text).toContain('Buy | | 5');
  expect(text).toContain('Pay with | | 50');
  // Take is a taker by construction, so the crossing warning is replaced by
  // the line above rather than shown alongside it, and the ±% chips - which
  // place a *resting* order - are withheld.
  expect(text).not.toContain('Buy ≥ mid');
  expect(text).not.toContain('-2%');
  // Connected with a sized order: the submit button is offered.
  expect(text).toContain('Buy UM');
});

test('rest mode keeps the resting-order surface', () => {
  const store = makeStore();
  store.limitForm.setMode('rest');
  const text = render(store);

  expect(text).toContain('When UM is');
  expect(text).toContain('-2%');
  expect(text).not.toContain('Takes 5 UM');
});
