'use client';

import { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { Button } from '@penumbra-zone/ui/Button';
import { Text } from '@penumbra-zone/ui/Text';

/**
 * A transaction hash that does not phone home by default.
 *
 * Opening a third-party block explorer hands that site the user's IP address
 * together with the tx id, which links them to the transaction. So the hash is
 * shown as copyable text, and "view on explorer" first explains what the
 * explorer learns and suggests looking it up over Tor/VPN instead. Users who
 * accept that can tick "don't warn me again"; the choice is kept in this
 * browser only.
 */

const ACK_KEY = 'veil:explorer-warning-ack';

const readAck = (): boolean => {
  try {
    return localStorage.getItem(ACK_KEY) === '1';
  } catch {
    return false;
  }
};

const writeAck = () => {
  try {
    localStorage.setItem(ACK_KEY, '1');
  } catch {
    // storage unavailable (private mode): just ask again next time
  }
};

const openExternal = (url: string) => {
  // noopener/noreferrer: the explorer gets neither a handle to this window
  // nor the Referer telling it which app the user came from.
  window.open(url, '_blank', 'noopener,noreferrer');
};

export const PrivateTxHash = ({
  hash,
  explorerUrl,
}: {
  hash: string;
  explorerUrl?: string | null;
}) => {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [dontAsk, setDontAsk] = useState(false);

  const host = explorerUrl ? new URL(explorerUrl).host : undefined;

  const onCopy = () => {
    void navigator.clipboard.writeText(hash).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const onView = () => {
    if (!explorerUrl) {
      return;
    }
    if (readAck()) {
      openExternal(explorerUrl);
      return;
    }
    setConfirming(true);
  };

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex items-start gap-2'>
        <span className='min-w-0 flex-1 font-mono text-xs break-all text-text-secondary'>
          {hash}
        </span>
        <button
          type='button'
          onClick={onCopy}
          aria-label='Copy transaction id'
          className='shrink-0 rounded-md p-1 text-text-secondary transition-colors hover:bg-other-tonal-fill10 hover:text-text-primary'
        >
          {copied ? <Check className='h-4 w-4' /> : <Copy className='h-4 w-4' />}
        </button>
      </div>

      {explorerUrl && !confirming && (
        <button
          type='button'
          onClick={onView}
          className='flex w-fit items-center gap-1 text-xs text-text-secondary hover:text-text-primary'
        >
          <ExternalLink className='h-3 w-3' />
          View on {host}
        </button>
      )}

      {explorerUrl && confirming && (
        <div className='flex flex-col gap-2 rounded-md border border-caution-main/40 bg-caution-main/10 p-3'>
          <Text detail color='caution.light'>
            {host} will see your IP address together with this transaction id, which can link you to
            it. To stay private, copy the id and look it up over Tor or a VPN.
          </Text>
          <label className='flex items-center gap-2 text-xs text-text-secondary'>
            <input type='checkbox' checked={dontAsk} onChange={e => setDontAsk(e.target.checked)} />
            Don&apos;t warn me again in this browser
          </label>
          <div className='flex gap-2'>
            <Button
              actionType='default'
              priority='secondary'
              density='compact'
              onClick={() => {
                if (dontAsk) {
                  writeAck();
                }
                setConfirming(false);
                openExternal(explorerUrl);
              }}
            >
              Open {host}
            </Button>
            <Button
              actionType='default'
              priority='secondary'
              density='compact'
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
