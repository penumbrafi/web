import { useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { Search } from 'lucide-react';
import { Metadata } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { BalancesResponse } from '@penumbra-zone/protobuf/penumbra/view/v1/view_pb';
import {
  getAddressIndex,
  getBalanceView,
  getMetadataFromBalancesResponse,
} from '@penumbra-zone/getters/balances-response';
import { Text } from '@penumbra-zone/ui/Text';
import { Dialog } from '@penumbra-zone/ui/Dialog';
import { AssetIcon } from '@penumbra-zone/ui/AssetIcon';
import {
  groupAndSortBalances,
  AssetSelectorValue,
  isBalancesResponse,
  filterAssets as filterUnswappableAssets,
} from '@penumbra-zone/ui/AssetSelector';
import { BridgeStatusBadge } from '@/shared/ui/bridge-status-badge';
import { useAssets } from '@/shared/api/assets';
import { useBalances } from '@/shared/api/balances';
import { connectionStore } from '@/shared/model/connection';
import { ValueViewComponent } from '@penumbra-zone/ui/ValueView';
import { recentPairsStore } from './store';

export interface SearchResultsProps {
  onSelect: (asset: Metadata) => void;
  search?: string;
}

// Caller is responsible for lowercasing `searchLc` once — avoids re-running
// String#toLowerCase on the same query for every asset in the list.
const filterAsset = (asset: Metadata, searchLc: string): boolean => {
  return (
    asset.symbol.toLowerCase().includes(searchLc) ||
    asset.description.toLowerCase().includes(searchLc)
  );
};

const useFilteredAssets = (options: AssetSelectorValue[], search: string) => {
  // Memoize so typing in the search box doesn't re-walk the whole asset list
  // and the upstream useMemo on `merged` keeps a stable reference.
  return useMemo(() => {
    if (!search) {
      return options;
    }
    const searchLc = search.toLowerCase();
    return options.filter(option => {
      const metadata = isBalancesResponse(option)
        ? getMetadataFromBalancesResponse(option)
        : option;
      return filterAsset(metadata, searchLc);
    });
  }, [options, search]);
};

const mergeOptions = (
  assets: Metadata[],
  balances: BalancesResponse[],
  account: number,
): AssetSelectorValue[] => {
  const grouped = groupAndSortBalances(balances);
  const balancesPerAccount = grouped.find(group => group[0] === account.toString())?.[1] ?? [];
  const filteredAssets = filterUnswappableAssets(assets)
    .filter(
      asset =>
        !balancesPerAccount.some(
          balance => getMetadataFromBalancesResponse(balance).symbol === asset.symbol,
        ),
    )
    .sort((a, b) => Number(b.priorityScore) - Number(a.priorityScore));
  return [...balancesPerAccount, ...filteredAssets];
};

export const SearchResults = observer(({ onSelect, search }: SearchResultsProps) => {
  const { recent, add } = recentPairsStore;
  const { subaccount } = connectionStore;

  const { data: assets } = useAssets();
  const { data: balances } = useBalances(subaccount);

  // mergeOptions does a groupAndSortBalances + asset.filter + sort by
  // priorityScore — non-trivial work that doesn't depend on the search
  // text. Memoize so each keystroke only re-runs the cheaper text filter.
  const merged = useMemo(
    () => mergeOptions(assets, balances ?? [], subaccount),
    [assets, balances, subaccount],
  );
  const filtered = useFilteredAssets(merged, search ?? '');

  const onClick = (asset: Metadata) => {
    add(asset);
    onSelect(asset);
  };

  if (!filtered.length) {
    return (
      <div className='flex grow flex-col items-center justify-center gap-2 py-4 text-text-secondary'>
        <Search className='size-8' />
        <Text small>No results</Text>
      </div>
    );
  }

  return (
    <>
      {!search && !!recent.length && (
        <div className='flex flex-col gap-2 text-text-secondary'>
          <Text small>Recent</Text>
          <Dialog.RadioGroup>
            <div className='flex flex-col gap-1'>
              {recent.map(asset => (
                <Dialog.RadioItem
                  key={`${asset.symbol}-${asset.display}`}
                  value={`${asset.symbol}-${asset.display}`}
                  startAdornment={<AssetIcon metadata={asset} size='lg' />}
                  title={
                    <div
                      className={
                        asset.name ? 'flex items-center gap-2' : 'flex h-10 items-center gap-2'
                      }
                    >
                      <Text color='text.primary'>{asset.symbol}</Text>
                      <BridgeStatusBadge assets={[asset]} />
                    </div>
                  }
                  description={
                    asset.name && (
                      <div className='-mt-2'>
                        <Text detail color='text.secondary'>
                          {asset.name}
                        </Text>
                      </div>
                    )
                  }
                  onSelect={() => onClick(asset)}
                />
              ))}
            </div>
          </Dialog.RadioGroup>
        </div>
      )}

      <div className='flex flex-col gap-2 text-text-secondary'>
        <Text small>Search results</Text>
        <Dialog.RadioGroup>
          <div className='flex flex-col gap-1'>
            {filtered.map(option => {
              const asset = isBalancesResponse(option)
                ? getMetadataFromBalancesResponse(option)
                : option;
              const balance = isBalancesResponse(option)
                ? {
                    addressIndexAccount: getAddressIndex.optional(option)?.account,
                    valueView: getBalanceView.optional(option),
                  }
                : undefined;

              return (
                <Dialog.RadioItem
                  key={`${asset.symbol}-${asset.display}`}
                  value={`${asset.symbol}-${asset.display}`}
                  startAdornment={<AssetIcon metadata={asset} size='lg' />}
                  endAdornment={
                    balance && (
                      <ValueViewComponent
                        showSymbol={false}
                        showIcon={false}
                        context='table'
                        valueView={balance.valueView}
                      />
                    )
                  }
                  title={
                    <div
                      className={
                        asset.name ? 'flex items-center gap-2' : 'flex h-10 items-center gap-2'
                      }
                    >
                      <Text color='text.primary'>{asset.symbol}</Text>
                      <BridgeStatusBadge assets={[asset]} />
                    </div>
                  }
                  description={
                    asset.name && (
                      <div className='-mt-2'>
                        <Text detail color='text.secondary'>
                          {asset.name}
                        </Text>
                      </div>
                    )
                  }
                  onSelect={() => onClick(asset)}
                />
              );
            })}
          </div>
        </Dialog.RadioGroup>
      </div>
    </>
  );
});
