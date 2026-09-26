'use client';

import { observer } from 'mobx-react-lite';
import { Check, Copy, ExternalLink, Users } from 'lucide-react';
import { useState } from 'react';
import Image from 'next/image';
import { useChain } from '@cosmos-kit/react';
import { Button } from '@penumbra-zone/ui/Button';
import { Text } from '@penumbra-zone/ui/Text';
import { useZafuHandoff } from '@/features/deposit/use-zafu-handoff';

// Wallets that can't hold Injective for a website: Zafu refuses Ethermint
// chains over its Keplr-shaped provider (it has its own in-wallet flow).
const NOT_FOR_INJECTIVE = new Set(['zafu-extension']);

const logoSrc = (logo: unknown): string | undefined => {
  if (typeof logo === 'string') {
    return logo;
  }
  if (logo && typeof logo === 'object' && 'major' in logo) {
    return String((logo as { major: string }).major);
  }
  return undefined;
};

const short = (address: string) => `${address.slice(0, 10)}…${address.slice(-6)}`;

/**
 * First step of the deposit: which Injective wallet the funds arrive in.
 *
 * Every deposit route lands on Injective before it is shielded, and the
 * exchange path needs that wallet's inj1 address, so nothing else makes
 * sense until this is answered. One button per wallet rather than
 * cosmos-kit's connect(): connect() silently retries the last-used wallet,
 * so a wallet that refused (or was uninstalled) left the button doing
 * nothing and no way to pick another.
 */
interface ArrivalWalletProps {
  /** 'receive': the user's own deposit (default). 'send': paying someone
   *  else on /pay, where the wallet is the source, not the destination. */
  purpose?: 'receive' | 'send';
  /** Deposit only: offer "Someone else is sending" alongside the wallets. */
  onSomeoneElse?: () => void;
}

export const ArrivalWallet = observer(
  ({ purpose = 'receive', onSomeoneElse }: ArrivalWalletProps) => {
    const chain = useChain('injective');
    const sending = purpose === 'send';
    const zafu = useZafuHandoff();
    const [copied, setCopied] = useState(false);

    if (chain.isWalletConnected && chain.address) {
      const address = chain.address;
      return (
        <div className='flex flex-wrap items-center justify-between gap-3 rounded-xl bg-other-tonal-fill5 p-4'>
          <div className='flex flex-col gap-1'>
            <Text detail color='text.secondary'>
              {sending ? 'Sending from' : 'Arriving in'} {chain.wallet?.prettyName ?? 'your wallet'}{' '}
              on Injective
            </Text>
            <button
              type='button'
              className='flex items-center gap-2 text-left focus:outline-none'
              onClick={() => {
                void navigator.clipboard.writeText(address).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              <Text detailTechnical color='text.primary'>
                {short(address)}
              </Text>
              {copied ? (
                <Check className='h-3.5 w-3.5 text-success-light' />
              ) : (
                <Copy className='h-3.5 w-3.5 text-text-secondary' />
              )}
            </button>
          </div>
          <Button density='compact' priority='secondary' onClick={() => void chain.disconnect()}>
            Use another wallet
          </Button>
        </div>
      );
    }

    const wallets = chain.walletRepo.wallets.filter(w => !NOT_FOR_INJECTIVE.has(w.walletName));
    const failed = chain.isWalletError || chain.isWalletRejected;

    return (
      <div className='flex flex-col gap-4'>
        <div className='flex flex-col gap-1'>
          <Text variant='strong' color='text.primary'>
            {sending
              ? 'Which wallet are you paying from?'
              : 'Which wallet will receive your funds?'}
          </Text>
          <Text small color='text.secondary'>
            {sending
              ? 'Connect the Injective wallet that holds the funds. You sign one transfer; it goes straight into their Penumbra account.'
              : 'Deposits arrive on Injective first, then move into Penumbra in one signature. Pick the wallet that holds your Injective address.'}
          </Text>
        </div>

        <div className='grid grid-cols-1 gap-2 tablet:grid-cols-3'>
          {!sending && zafu.isZafu && (
            <WalletButton
              name='Zafu'
              logo='/assets/zafu.png'
              hint='Deposits and shields inside Zafu'
              busy={zafu.isOpening}
              onClick={() => void zafu.openShield()}
            />
          )}
          {wallets.map(w => {
            const missing = w.isWalletNotExist;
            const download = w.walletInfo.downloads?.find(d => d.browser === 'chrome')?.link;
            return (
              <WalletButton
                key={w.walletName}
                name={w.walletPrettyName}
                logo={logoSrc(w.walletInfo.logo)}
                hint={missing ? 'Not installed' : undefined}
                busy={w.isWalletConnecting}
                href={missing ? download : undefined}
                onClick={() => void w.connect()}
              />
            );
          })}
          {onSomeoneElse && (
            <WalletButton
              name='Someone else is sending'
              hint='Share a link, they pay from their wallet'
              icon={<Users className='h-5 w-5 text-text-secondary' />}
              onClick={onSomeoneElse}
            />
          )}
        </div>

        {zafu.error && (
          <Text detail color='destructive.light'>
            {zafu.error}
          </Text>
        )}
        {failed && (
          <Text detail color='destructive.light'>
            {chain.message ?? 'The wallet did not connect.'} Try again or pick another wallet.
          </Text>
        )}
      </div>
    );
  },
);

const WalletButton = ({
  name,
  logo,
  icon,
  hint,
  busy,
  href,
  onClick,
}: {
  name: string;
  logo?: string;
  icon?: React.ReactNode;
  hint?: string;
  busy?: boolean;
  href?: string;
  onClick: () => void;
}) => {
  const body = (
    <>
      {icon && (
        <div className='flex h-8 w-8 items-center justify-center rounded-md bg-other-tonal-fill10'>
          {icon}
        </div>
      )}
      {!icon && logo ? (
        // Wallet logos are data URIs or remote files; nothing to optimise.
        <Image
          src={logo}
          alt=''
          width={32}
          height={32}
          unoptimized
          className='h-8 w-8 rounded-md'
        />
      ) : (
        !icon && <div className='h-8 w-8 rounded-md bg-other-tonal-fill10' />
      )}
      <div className='flex flex-col'>
        <Text small color='text.primary'>
          {busy ? `Connecting ${name}…` : name}
        </Text>
        {hint && (
          <Text detail color='text.secondary'>
            {hint}
          </Text>
        )}
      </div>
      {href && <ExternalLink className='ml-auto h-4 w-4 text-text-secondary' />}
    </>
  );
  const cls =
    'flex items-center gap-3 rounded-xl bg-other-tonal-fill5 p-3 text-left transition-colors hover:bg-other-tonal-fill10 disabled:opacity-50';
  if (href) {
    return (
      <a href={href} target='_blank' rel='noreferrer' className={cls}>
        {body}
      </a>
    );
  }
  return (
    <button type='button' className={cls} disabled={busy} onClick={onClick}>
      {body}
    </button>
  );
};
