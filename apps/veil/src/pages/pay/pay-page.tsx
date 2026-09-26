'use client';

import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useChain } from '@cosmos-kit/react';
import { isAddress } from '@penumbra-zone/bech32m/penumbra';
import { Text } from '@penumbra-zone/ui/Text';
import { useRegistry } from '@/shared/api/registry';
import { IbcChainProvider } from '@/features/cosmos/chain-provider';
import { useBalances as useCosmosBalances } from '@/features/cosmos/use-augmented-balances';
import { PenumbraWaves } from '@/pages/explore/ui/waves';
import { PortfolioCard } from '@/pages/portfolio/ui/portfolio-card';
import { NativeShieldDialog } from '@/pages/portfolio/ui/native-shield-dialog';
import type { UnifiedAsset } from '@/pages/portfolio/api/use-unified-assets';
import { ArrivalWallet } from '@/pages/portfolio/deposit/steps/arrival-wallet';
import { ReadyList, useReadyAssets } from '@/pages/portfolio/deposit/steps/ready-to-shield';

/**
 * `/pay#<penumbra address>`: pay into someone else's Penumbra account.
 *
 * The recipient made the link on their deposit page. The address is a
 * single-use one, and it sits in the URL fragment, which the browser never
 * sends to our server. The payer needs no Penumbra wallet: they connect the
 * Injective wallet holding the funds and sign one IBC transfer to it.
 */
const readRecipient = (): string | undefined => {
  const raw = decodeURIComponent(window.location.hash.slice(1)).trim();
  return raw && isAddress(raw) ? raw : undefined;
};

export const PayPage = observer(() => {
  const { data: registry } = useRegistry();
  const [recipient, setRecipient] = useState<string | undefined>();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const update = () => {
      setRecipient(readRecipient());
      setChecked(true);
    };
    update();
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  return (
    <IbcChainProvider registry={registry}>
      <PenumbraWaves />
      <div className='container mx-auto flex max-w-[720px] flex-col gap-4 py-8'>
        <PortfolioCard title='Pay into Penumbra'>
          {checked && !recipient && (
            <Text small color='text.secondary'>
              This payment link is missing its Penumbra address or the address is not valid. Ask the
              person you are paying for a new link.
            </Text>
          )}
          {recipient && <PayFlow recipient={recipient} />}
        </PortfolioCard>
      </div>
    </IbcChainProvider>
  );
});

const PayFlow = observer(({ recipient }: { recipient: string }) => {
  const { isWalletConnected } = useChain('injective');
  const { balances, isLoading } = useCosmosBalances();
  const ready = useReadyAssets(balances);
  const [openAsset, setOpenAsset] = useState<UnifiedAsset | null>(null);

  return (
    <div className='flex flex-col gap-5'>
      <div className='flex flex-col gap-1 rounded-xl bg-other-tonal-fill5 p-4'>
        <Text detail color='text.secondary'>
          Paying to a single-use Penumbra address
        </Text>
        <div className='break-all'>
          <Text detailTechnical color='text.primary'>
            {recipient}
          </Text>
        </div>
        <Text detail color='text.secondary'>
          Funds become private once they arrive. You will not see the recipient&apos;s balance, and
          they will not see yours.
        </Text>
      </div>

      <ArrivalWallet purpose='send' />

      {isWalletConnected && (
        <div className='flex flex-col gap-2'>
          <Text variant='strong' color='text.primary'>
            What do you want to send?
          </Text>
          {ready.length > 0 && <ReadyList ready={ready} onPick={setOpenAsset} />}
          {ready.length === 0 && (
            <Text small color='text.secondary'>
              {isLoading
                ? 'Checking balances…'
                : 'Nothing Penumbra accepts is in this wallet. Add USDC, USDT or INJ on Injective, then come back.'}
            </Text>
          )}
        </div>
      )}

      {openAsset && (
        <NativeShieldDialog
          asset={openAsset}
          isOpen={!!openAsset}
          onClose={() => setOpenAsset(null)}
          receiver={recipient}
        />
      )}
    </div>
  );
});
