'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Text } from '@penumbra-zone/ui/Text';
import { TextInput } from '@penumbra-zone/ui/TextInput';
import { Icon } from '@penumbra-zone/ui/Icon';
import { PairCard } from '@/pages/explore/ui/pair-card';
import type { SummaryWithPrices } from '@/shared/api/server/summary';
import { useDebounce } from '@/shared/utils/use-debounce';
import { useGetMetadata } from '@/shared/api/assets';
import { deserialize, Serialized } from '@/shared/utils/serializer';
import { isPairMarked } from '@/shared/config/bridge-health';
import { usePausedChannels } from '@/shared/api/ibc-bridge';
import type { Metadata } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';

interface ExplorePairsProps {
  summaries: Serialized<SummaryWithPrices[]>;
}

// 24h volume as a single comparable bigint. All summaries are denominated in the
// same indexing asset, so raw amounts compare directly across pairs.
const volumeBigInt = (s: SummaryWithPrices): bigint => {
  const amt = s.volume.amount;
  return ((amt?.hi ?? 0n) << 64n) | (amt?.lo ?? 0n);
};

export const ExplorePairs = ({ summaries }: ExplorePairsProps) => {
  const getMetadata = useGetMetadata();
  const pausedChannels = usePausedChannels();
  const augmentedSummaries = useMemo(() => {
    const deserialized = deserialize<SummaryWithPrices[]>(summaries);
    const out: [SummaryWithPrices, Metadata | undefined, Metadata | undefined][] = deserialized.map(
      x => [x, getMetadata(x.start), getMetadata(x.end)],
    );
    // Unmarked (settleable) pairs first, then by 24h trading volume desc within
    // each group. "Unmarked" means a working path in and out — today that is
    // the Injective-routed markets; markets on expired channels and Noble's
    // sunsetting USDC sink below them.
    out.sort((a, b) => {
      const am = isPairMarked(a[1], a[2], pausedChannels);
      const bm = isPairMarked(b[1], b[2], pausedChannels);
      if (am !== bm) {
        return am ? 1 : -1;
      }
      const av = volumeBigInt(a[0]);
      const bv = volumeBigInt(b[0]);
      if (av === bv) {
        return 0;
      }
      return av > bv ? -1 : 1;
    });
    return out;
  }, [summaries, getMetadata, pausedChannels]);
  const [rawSearch, setSearch] = useState('');
  const search = useDebounce(rawSearch, 200);
  const filteredSummaries = useMemo(() => {
    if (!search) {
      return augmentedSummaries.map(x => x[0]);
    }
    const target = search.toUpperCase();
    return augmentedSummaries
      .filter(([, base, quote]) =>
        (base?.symbol.toUpperCase() ?? '').includes(target) ||
        (quote?.symbol.toUpperCase() ?? '').includes(target),
      )
      .map(([summary]) => summary);
  }, [augmentedSummaries, search]);

  return (
    <div className='flex w-full flex-col gap-4'>
      <div className='flex items-center justify-between gap-4 text-text-primary'>
        <Text large whitespace='nowrap'>
          Trading Pairs
        </Text>
        <TextInput
          value={rawSearch}
          placeholder='Search pair'
          startAdornment={<Icon size='md' IconComponent={Search} />}
          onChange={setSearch}
        />
      </div>

      <div className='grid grid-cols-[1fr_1fr_1fr_1fr_128px_56px] gap-2 overflow-x-auto overflow-y-auto desktop:overflow-x-hidden'>
        <div className='col-span-6 grid grid-cols-subgrid px-3 py-2'>
          <Text detail color='text.secondary' align='left'>
            Pair
          </Text>
          <Text detail color='text.secondary' align='right'>
            Price
          </Text>
          <Text detail color='text.secondary' align='right'>
            Liquidity
          </Text>
          <Text detail color='text.secondary' align='right' whitespace='nowrap'>
            24h Volume
          </Text>
          <Text detail color='text.secondary' align='right' whitespace='nowrap'>
            24h Price Change
          </Text>
          <Text detail color='text.secondary' align='right'>
            Actions
          </Text>
        </div>

        {filteredSummaries.length === 0 && (
          <div className='col-span-5 py-5 text-text-secondary'>
            <Text small>No pairs found matching your search</Text>
          </div>
        )}

        {filteredSummaries.map(summary => (
          <PairCard
            summary={summary}
            key={`${summary.start.toJsonString()}${summary.end.toJsonString()}`}
          />
        ))}
      </div>
    </div>
  );
};
