import { ChevronDown } from 'lucide-react';
import { AssetIcon } from '@penumbra-zone/ui/AssetIcon';
import { Dialog } from '@penumbra-zone/ui/Dialog';
import { Text } from '@penumbra-zone/ui/Text';
import { Pair } from '@/features/star-pair';
import { BridgeStatusBadge } from '@/shared/ui/bridge-status-badge';

export interface TriggerProps {
  onClick: VoidFunction;
  pair: Pair;
}

export const Trigger = ({ onClick, pair }: TriggerProps) => {
  return (
    <Dialog.Trigger asChild>
      <button
        type='button'
        title='Switch pair  ·  press / to open from anywhere'
        className='group flex cursor-pointer items-center gap-1.5'
        onClick={onClick}
      >
        <div className='z-10'>
          <AssetIcon metadata={pair.base} size='lg' />
        </div>
        <div className='-ml-4'>
          <AssetIcon metadata={pair.quote} size='lg' />
        </div>

        <Text body>
          {pair.base.symbol}/{pair.quote.symbol}
        </Text>

        <BridgeStatusBadge assets={[pair.base, pair.quote]} />

        {/* Discoverable shortcut hint, same idiom Slack / Linear / GitHub
            use. Hidden on small screens so it doesn't crowd the pair
            label on mobile, where the shortcut isn't usable anyway. */}
        <kbd
          className='hidden h-5 min-w-5 items-center justify-center rounded-sm border border-other-tonal-stroke px-1 text-[10px] leading-none text-text-secondary tabular-nums opacity-70 transition-opacity group-hover:opacity-100 desktop:inline-flex'
          aria-hidden='true'
        >
          /
        </kbd>

        <i className='flex size-6 items-center justify-center p-1'>
          <ChevronDown />
        </i>
      </button>
    </Dialog.Trigger>
  );
};
