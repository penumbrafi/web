import { useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import Image from 'next/image';
import { Wallet2 } from 'lucide-react';
import { Text } from '@penumbra-zone/ui/Text';
import { Button, ButtonProps } from '@penumbra-zone/ui/Button';
import { Density } from '@penumbra-zone/ui/Density';
import { Dialog } from '@penumbra-zone/ui/Dialog';
import { PenumbraClient } from '@penumbra-zone/client';
import { connectionStore } from '@/shared/model/connection';
import { useProviderManifests } from '@/shared/api/providerManifests';
import dynamic from 'next/dynamic';

const ConnectButtonInner = observer(
  ({
    actionType = 'accent',
    variant = 'default',
    children,
  }: {
    actionType?: ButtonProps['actionType'];
    variant?: 'default' | 'minimal' | 'mobile';
    children?: React.ReactNode;
  }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [isInstallOpen, setIsInstallOpen] = useState(false);
    const { data: providerManifests } = useProviderManifests();

    const providerOrigins = useMemo(() => Object.keys(PenumbraClient.getProviders()), []);

    const onConnectClick = () => {
      if (providerOrigins.length > 1) {
        setIsOpen(true);
      } else if (providerOrigins.length === 1 && providerOrigins[0]) {
        connect(providerOrigins[0]);
      }
    };

    // Ordered by our recommendation: Zafu first (actively maintained fork,
    // Rotko-supported), Prax second (upstream, currently receiving fewer
    // updates). Users who already know Prax can still pick it.
    const installOptions = [
      {
        name: 'Zafu',
        url: 'https://zafu.pro/',
        description: 'Recommended — maintained Penumbra wallet',
      },
      {
        name: 'Prax',
        url: 'https://praxwallet.com/',
        description: 'Original Penumbra wallet by Penumbra Labs',
      },
    ];

    const connect = (provider: string) => {
      // Wrap so a broken provider entry — typically an orphaned content
      // script in window[PenumbraSymbol] — can't bubble an unhandled
      // promise rejection. Common failure modes:
      //   - chrome-extension://invalid/  (Chrome's orphan sentinel after
      //     a Web Store extension reload; affects unpatched Zafu, etc.)
      //   - PenumbraProviderNotAvailableError on a Prax record whose
      //     manifest fetch race-fails on click.
      // Either way, the user gets a console warning and stays on the
      // picker instead of seeing a stack trace and a hung page.
      void connectionStore.connect(provider).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn(`[connect] ${provider} unavailable, try another wallet:`, err);
        setIsOpen(true);
      });
    };

    return (
      <>
        <Density variant={variant === 'default' ? 'sparse' : 'compact'}>
          {providerOrigins.length === 0 ? (
            <Button
              icon={Wallet2}
              actionType={actionType}
              iconOnly={variant === 'mobile'}
              onClick={() => setIsInstallOpen(true)}
            >
              Get Wallet
            </Button>
          ) : (
            <Button
              icon={Wallet2}
              iconOnly={variant === 'mobile'}
              actionType={actionType}
              onClick={onConnectClick}
            >
              {children ?? 'Connect wallet'}
            </Button>
          )}
        </Density>

        <Dialog isOpen={isInstallOpen} onClose={() => setIsInstallOpen(false)}>
          <Dialog.Content title='Install a Penumbra wallet'>
            <Dialog.RadioGroup>
              <div className='flex flex-col gap-2 pt-1'>
                {installOptions.map(opt => (
                  <Dialog.RadioItem
                    key={opt.url}
                    value={opt.url}
                    title={<Text color='text.primary'>{opt.name}</Text>}
                    description={
                      <Text detail color='text.secondary'>
                        {opt.description}
                      </Text>
                    }
                    onSelect={() => {
                      window.open(opt.url, '_blank', 'noopener,noreferrer');
                      setIsInstallOpen(false);
                    }}
                  />
                ))}
              </div>
            </Dialog.RadioGroup>
          </Dialog.Content>
        </Dialog>

        <Dialog isOpen={isOpen} onClose={() => setIsOpen(false)}>
          <Dialog.Content title='Choose wallet'>
            <Dialog.RadioGroup>
              <div className='flex flex-col gap-2 pt-1'>
                {Object.entries(providerManifests ?? {}).map(([key, manifest]) => (
                  <Dialog.RadioItem
                    key={key}
                    value={key}
                    title={<Text color='text.primary'>{manifest.name}</Text>}
                    description={
                      <Text detail color='text.secondary'>
                        {manifest.description}
                      </Text>
                    }
                    startAdornment={
                      <Image
                        height={32}
                        width={32}
                        src={URL.createObjectURL(manifest.icons['128'])}
                        alt={manifest.name}
                      />
                    }
                    onSelect={() => connect(key)}
                  />
                ))}
              </div>
            </Dialog.RadioGroup>
          </Dialog.Content>
        </Dialog>
      </>
    );
  },
);

// Need to disable SSR given usage of window access in getProviders()
export const ConnectButton = dynamic(() => Promise.resolve(ConnectButtonInner), {
  ssr: false,
});
