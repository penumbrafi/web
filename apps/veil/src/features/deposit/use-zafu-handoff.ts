import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { penumbra } from '@/shared/const/penumbra';
import { connectionStore } from '@/shared/model/connection';

/**
 * Hand the Injective shield off to the Zafu wallet (zafu_open_shield).
 *
 * When the connected Penumbra wallet is Zafu, Veil can ask it to open its OWN
 * shield screen instead of telling the user where to find it. Nothing crosses
 * back: no address, key or amount. Zafu picks the surface (its side panel or a
 * popup) and runs the flow, including gas sponsorship.
 *
 * Detection: the connected provider's origin is `chrome-extension://<id>`, and
 * only Zafu answers `{ type: 'ping' }` over externally_connectable with
 * `{ zafu: true }`, so other Penumbra wallets simply don't get the button.
 */

interface ChromeRuntimeLike {
  sendMessage?: (
    extensionId: string,
    message: unknown,
    callback: (response: unknown) => void,
  ) => void;
  lastError?: { message?: string };
}

const runtime = (): ChromeRuntimeLike | undefined =>
  (globalThis as { chrome?: { runtime?: ChromeRuntimeLike } }).chrome?.runtime;

const extensionIdFromOrigin = (origin: string | undefined): string | undefined => {
  if (!origin?.startsWith('chrome-extension://')) {
    return undefined;
  }
  return new URL(origin).host || undefined;
};

const sendToExtension = (extensionId: string, message: unknown): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const rt = runtime();
    if (!rt?.sendMessage) {
      reject(new Error('wallet messaging is not available in this browser'));
      return;
    }
    rt.sendMessage(extensionId, message, response => {
      const err = runtime()?.lastError;
      if (err) {
        reject(new Error(err.message ?? 'wallet did not respond'));
      } else {
        resolve(response);
      }
    });
  });

export const useZafuHandoff = () => {
  const extensionId = connectionStore.connected
    ? extensionIdFromOrigin(penumbra.origin)
    : undefined;

  const { data: isZafu = false } = useQuery({
    queryKey: ['zafu-ping', extensionId],
    enabled: !!extensionId,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      if (!extensionId) {
        return false;
      }
      const res = (await sendToExtension(extensionId, { type: 'ping' })) as
        | { zafu?: boolean }
        | undefined;
      return res?.zafu === true;
    },
  });

  const [isOpening, setIsOpening] = useState(false);
  const [error, setError] = useState<string>();

  const openShield = useCallback(async () => {
    if (!extensionId) {
      return;
    }
    setIsOpening(true);
    setError(undefined);
    try {
      const res = (await sendToExtension(extensionId, {
        type: 'zafu_open_shield',
        chainId: 'injective',
      })) as { opened?: boolean; error?: string } | undefined;
      if (!res?.opened) {
        setError(res?.error ?? 'Zafu could not open its shield screen');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsOpening(false);
    }
  }, [extensionId]);

  return { isZafu, openShield, isOpening, error };
};
