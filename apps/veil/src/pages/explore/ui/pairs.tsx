'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Text } from '@penumbra-zone/ui/Text';
import { TextInput } from '@penumbra-zone/ui/TextInput';
import { Icon } from '@penumbra-zone/ui/Icon';
import { Pagination } from '@penumbra-zone/ui/Pagination';
import { PairCard } from '@/pages/explore/ui/pair-card';
import type { SummaryWithPrices } from '@/shared/api/server/summary';
import { useDebounce } from '@/shared/utils/use-debounce';
import { deserialize, Serialized } from '@/shared/utils/serializer';
import { isPairMarked } from '@/shared/config/bridge-health';
import { usePausedChannels } from '@/shared/api/ibc-bridge';
import { joinLoHi } from '@penumbra-zone/types/lo-hi';

// Ten per page: the list is sorted working-pairs-first, so page one is the
// markets you can actually move money in and out of, and the long tail on
// closed bridges no longer paints the home page red. More channels are
// coming, so the list only grows.
const PAGE_SIZE = 10;

interface ExplorePairsProps {
  summaries: Serialized<SummaryWithPrices[]>;
}

// 24h volume as a single comparable bigint. All summaries are denominated in the
// same indexing asset, so raw amounts compare directly across pairs.
const volumeBigInt = (s: SummaryWithPrices): bigint => {
  const amt = s.volume.amount;
  return joinLoHi(amt?.lo, amt?.hi);
};

export const ExplorePairs = ({ summaries }: ExplorePairsProps) => {
  const pausedChannels = usePausedChannels();
  const sortedSummaries = useMemo(() => {
    const deserialized = deserialize<SummaryWithPrices[]>(summaries);
    // Server-side resolution guarantees startAsset/endAsset are populated,
    // so there's no need to look them up through the client registry.
    const out = deserialized.slice();
    // Unmarked (settleable) pairs first, then by 24h trading volume desc within
    // each group. "Unmarked" means a working path in and out — today that is
    // the Injective-routed markets; markets on expired channels and Noble's
    // sunsetting USDC sink below them.
    out.sort((a, b) => {
      const am = isPairMarked(a.startAsset, a.endAsset, pausedChannels);
      const bm = isPairMarked(b.startAsset, b.endAsset, pausedChannels);
      if (am !== bm) {
        return am ? 1 : -1;
      }
      const av = volumeBigInt(a);
      const bv = volumeBigInt(b);
      if (av === bv) {
        return 0;
      }
      return av > bv ? -1 : 1;
    });
    return out;
  }, [summaries, pausedChannels]);
  const [rawSearch, setSearch] = useState('');
  const search = useDebounce(rawSearch, 200);
  const filteredSummaries = useMemo(() => {
    if (!search) {
      return sortedSummaries;
    }
    const target = search.toUpperCase();
    return sortedSummaries.filter(
      s =>
        s.startAsset.symbol.toUpperCase().includes(target) ||
        s.endAsset.symbol.toUpperCase().includes(target),
    );
  }, [sortedSummaries, search]);

  const [page, setPage] = useState(1);
  // A new search starts from its first page.
  useEffect(() => setPage(1), [search]);
  const pageSummaries = filteredSummaries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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

        {pageSummaries.map(summary => (
          <PairCard
            summary={summary}
            key={`${summary.startAsset.penumbraAssetId?.toJsonString() ?? summary.startAsset.symbol}-${summary.endAsset.penumbraAssetId?.toJsonString() ?? summary.endAsset.symbol}`}
          />
        ))}
      </div>

      {filteredSummaries.length > PAGE_SIZE && (
        <Pagination
          value={page}
          onChange={setPage}
          limit={PAGE_SIZE}
          totalItems={filteredSummaries.length}
          visibleItems={pageSummaries.length}
          hideLimitSelector
        />
      )}
    </div>
  );
};
