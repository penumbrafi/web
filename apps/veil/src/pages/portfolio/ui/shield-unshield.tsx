import type { ShieldedBalance, UnifiedAsset } from '@/pages/portfolio/api/use-unified-assets.ts';
import { Button } from '@penumbra-zone/ui/Button';
import { Tooltip } from '@penumbra-zone/ui/Tooltip';
import { useCallback, useState } from 'react';
import { useRegistry } from '@/shared/api/registry.tsx';
import { UnshieldDialog } from '@/pages/portfolio/ui/unshield-dialog.tsx';
import { NativeShieldDialog } from '@/pages/portfolio/ui/native-shield-dialog.tsx';
import { useRouter } from 'next/navigation';

export function UnshieldButton({ asset }: { asset: ShieldedBalance }) {
  return <UnshieldDialog asset={asset} />;
}

/** Generic "Shield Assets" entry point: the same deposit flow as every
 *  other Deposit button. */
export function GenericShieldButton() {
  const router = useRouter();

  return (
    <Button
      actionType='accent'
      density='compact'
      priority='primary'
      onClick={() => router.push('/portfolio/deposit')}
    >
      Shield Assets
    </Button>
  );
}

/**
 * Per-asset shield button on the portfolio row. Uses the native ICS-20 path:
 * a MsgTransfer signed by the user's cosmos wallet on the source chain (we
 * currently ship Injective + Noble). The Skip widget lives only inside the
 * Deposit dialog's "advanced" tab for chains we lack a direct channel to.
 */
export const ShieldButton = ({ asset }: { asset: UnifiedAsset }) => {
  const [isOpen, setIsOpen] = useState(false);
  const { data: registry } = useRegistry();

  const sourceChainId = asset.publicBalances[0]?.chainId;
  const hasIbcRoute =
    !!sourceChainId && registry.ibcConnections.some(c => c.chainId === sourceChainId);

  const handleClose = useCallback(() => setIsOpen(false), []);

  const buttonElement = (
    <Button
      actionType='accent'
      density='slim'
      priority='secondary'
      onClick={() => setIsOpen(true)}
      disabled={!hasIbcRoute}
    >
      Shield
    </Button>
  );

  return (
    <>
      {hasIbcRoute ? (
        buttonElement
      ) : (
        <Tooltip message='No IBC route registered for this asset'>{buttonElement}</Tooltip>
      )}

      {isOpen && hasIbcRoute && (
        <NativeShieldDialog asset={asset} isOpen={isOpen} onClose={handleClose} />
      )}
    </>
  );
};
