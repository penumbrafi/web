'use client';

import { Info, Settings } from 'lucide-react';
import { Popover } from '@penumbra-zone/ui/Popover';
import { Button } from '@penumbra-zone/ui/Button';
import { Text } from '@penumbra-zone/ui/Text';
import { Density } from '@penumbra-zone/ui/Density';
import { SegmentedControl } from '@penumbra-zone/ui/SegmentedControl';
import { Tooltip } from '@penumbra-zone/ui/Tooltip';
import { useBroadcastMode, type BroadcastMode } from '@/shared/model/broadcast-mode';

export const SettingsPopover = () => {
  const { mode, setMode } = useBroadcastMode();

  return (
    <Popover>
      <Popover.Trigger>
        <Button icon={Settings} iconOnly>
          Settings
        </Button>
      </Popover.Trigger>
      <Popover.Content align='end' side='bottom'>
        {/* w-[min(...)] keeps the popover inside the viewport on narrow
            phones (iPhone SE ~320px chrome-included) — fixed w-72 used
            to overhang the right edge with content clipped. */}
        <div className='flex w-[min(18rem,calc(100vw-1rem))] flex-col gap-4 p-2 text-text-primary'>
          <div className='flex flex-col gap-2'>
            <div className='flex items-center gap-1'>
              <Text small color='text.primary'>
                Broadcast via
              </Text>
              {/* Inline explanation moved off the popover body — it
                  used to wrap onto 4-5 lines and overflow on narrow
                  widths. Tooltip keeps the rationale one tap away
                  without crowding the control. */}
              <Tooltip
                title='Broadcast via'
                message="Veil submits signed transactions through its own fullnode for lower latency. Switch to Wallet to route through your Zafu extension's RPC instead."
              >
                <Info className='size-3.5 text-text-secondary' aria-label='About broadcast modes' />
              </Tooltip>
            </div>
            <Density compact>
              <SegmentedControl
                value={mode}
                onChange={value => setMode(value as BroadcastMode)}
              >
                <SegmentedControl.Item value='veil' style='filled'>
                  Veil
                </SegmentedControl.Item>
                <SegmentedControl.Item value='wallet' style='unfilled'>
                  Wallet
                </SegmentedControl.Item>
              </SegmentedControl>
            </Density>
          </div>
        </div>
      </Popover.Content>
    </Popover>
  );
};
