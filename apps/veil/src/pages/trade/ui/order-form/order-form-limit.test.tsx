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

test('a limit through the market shows what fills now and what rests', () => {
  const store = makeStore();
  store.limitForm.setQuoteInput('100');
  const text = render(store);

  // No mode switch any more: one price field, and the ±% chips for resting.
  expect(text).not.toContain('Move UM to');
  expect(text).toContain('Buy UM at');
  expect(text).toContain('-2%');
  // The 10 ask (5 UM, 50 USDC) is at or below 11.5; the other 50 USDC waits.
  expect(text).toContain('5 UM fills now against the book (worst 10 USDC)');
  expect(text).toContain('50 USDC rests at 11.5 USDC');
  // Connected with a complete order: the submit button is offered.
  expect(text).toContain('Buy UM');
});

test('a limit behind the book only rests', () => {
  const store = makeStore();
  store.limitForm.setPriceInput('9');
  store.limitForm.setQuoteInput('90');
  const text = render(store);

  expect(text).toContain('90 USDC rests at 9 USDC');
  expect(text).not.toContain('fills now');
});
