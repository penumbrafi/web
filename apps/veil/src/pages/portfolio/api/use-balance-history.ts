import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ViewService } from '@penumbra-zone/protobuf';
import { AddressIndex } from '@penumbra-zone/protobuf/penumbra/core/keys/v1/keys_pb';
import { AssetId } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { getDisplayDenomExponent } from '@penumbra-zone/getters/metadata';
import { joinLoHi } from '@penumbra-zone/types/lo-hi';
import { uint8ArrayToBase64, base64ToUint8Array } from '@penumbra-zone/types/base64';
import { penumbra } from '@/shared/const/penumbra';
import { connectionStore } from '@/shared/model/connection';
import { useGetMetadata } from '@/shared/api/assets';
import {
  HistoryRange,
  PortfolioHistoryResponse,
} from '@/shared/api/server/portfolio-history/types';

/** A note's lifetime: counts toward its asset from `created` until `spent` (0 = unspent). */
export interface NoteSpan {
  assetId: string;
  amount: bigint;
  created: number;
  spent: number;
}

const fetchNoteSpans = async (account: number): Promise<NoteSpan[]> => {
  const out: NoteSpan[] = [];
  for await (const res of penumbra.service(ViewService).notes({
    includeSpent: true,
    addressIndex: new AddressIndex({ account }),
  })) {
    const record = res.noteRecord;
    const value = record?.note?.value;
    const inner = value?.assetId?.inner;
    if (!record || !value?.amount || !inner) {
      continue;
    }
    // The filter is by account, but be strict: a randomized address of the
    // same account is fine, another account's note is not.
    if ((record.addressIndex?.account ?? 0) !== account) {
      continue;
    }
    out.push({
      assetId: uint8ArrayToBase64(inner),
      amount: joinLoHi(value.amount.lo, value.amount.hi),
      created: Number(record.heightCreated),
      spent: Number(record.heightSpent),
    });
  }
  return out;
};

/**
 * Wallet value at each point: sum over notes alive at that height, times the
 * asset's USD price at that point. Assets without a price are skipped.
 */
export const valueSeries = ({
  spans,
  history,
  exponentOf,
}: {
  spans: NoteSpan[];
  history: PortfolioHistoryResponse;
  exponentOf: (assetId: string) => number | undefined;
}): number[] =>
  history.points.map(({ height }, i) => {
    let total = 0;
    for (const s of spans) {
      if (s.created > height || (s.spent !== 0 && s.spent <= height)) {
        continue;
      }
      const price = history.usd[s.assetId]?.[i];
      const exp = exponentOf(s.assetId);
      if (price === undefined || exp === undefined) {
        continue;
      }
      total += (Number(s.amount) / 10 ** exp) * price;
    }
    return total;
  });

export interface BalanceHistory {
  points: { timeMs: number; usd: number }[];
  /** Value at the last point. */
  current?: number;
  /** Value change over the last 24h, when the range covers it. */
  change24h?: number;
  isLoading: boolean;
}

/**
 * Balance history built in the browser from the wallet's own notes. The
 * server only supplies public data (block times, prices) and is asked for a
 * range, never for assets or an account, so it learns nothing about the
 * wallet.
 *
 * Counts shielded notes only: funds in LP positions and staked UM are not
 * notes and are not in this series.
 */
export const useBalanceHistory = (range: HistoryRange): BalanceHistory => {
  const account = connectionStore.subaccount;
  const getMetadata = useGetMetadata();

  const notes = useQuery({
    queryKey: ['view-note-spans', account],
    queryFn: () => fetchNoteSpans(account),
    enabled: connectionStore.connected,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const history = useQuery({
    queryKey: ['portfolio-history', range],
    queryFn: async (): Promise<PortfolioHistoryResponse> => {
      const res = await fetch(`/api/portfolio-history?range=${range}`);
      if (!res.ok) {
        throw new Error(`portfolio-history ${res.status}`);
      }
      return (await res.json()) as PortfolioHistoryResponse;
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  return useMemo(() => {
    const isLoading = notes.isLoading || history.isLoading;
    if (!notes.data || !history.data) {
      return { points: [], isLoading };
    }
    const exponentOf = (assetId: string) => {
      const meta = getMetadata(new AssetId({ inner: base64ToUint8Array(assetId) }));
      return meta ? getDisplayDenomExponent.optional(meta) : undefined;
    };
    const values = valueSeries({ spans: notes.data, history: history.data, exponentOf });
    const points = history.data.points.map((p, i) => ({ timeMs: p.timeMs, usd: values[i] ?? 0 }));
    const last = points[points.length - 1];

    let change24h: number | undefined;
    if (last) {
      const dayAgo = last.timeMs - 86_400_000;
      const base = points.find(p => p.timeMs >= dayAgo);
      if (base && base !== last && (points[0]?.timeMs ?? Infinity) <= dayAgo + 3_600_000) {
        change24h = last.usd - base.usd;
      }
    }
    return { points, current: last?.usd, change24h, isLoading };
  }, [notes.data, notes.isLoading, history.data, history.isLoading, getMetadata]);
};
