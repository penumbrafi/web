/* eslint-disable @typescript-eslint/require-await -- async on purpose: a wasm error becomes a rejected promise, as callers expect */
import './instance.js';
import {
  generate_spend_key,
  get_address_by_index,
  get_ephemeral_address,
  get_full_viewing_key,
  get_noble_forwarding_addr,
  get_transparent_address,
  get_transmission_key_by_address,
  get_wallet_id,
} from '../wasm/index.js';
import {
  Address,
  FullViewingKey,
  SpendKey,
  WalletId,
} from '@penumbra-zone/protobuf/penumbra/core/keys/v1/keys_pb';

export const generateSpendKey = async (seedPhrase: string) => {
  return SpendKey.fromBinary(generate_spend_key(seedPhrase));
};

export const getFullViewingKey = async (spendKey: SpendKey) => {
  return FullViewingKey.fromBinary(get_full_viewing_key(spendKey.toBinary()));
};

export const getAddressByIndex = async (
  fullViewingKey: FullViewingKey,
  account: number,
  randomizer?: Uint8Array,
) => {
  const bytes = get_address_by_index(
    fullViewingKey.toBinary(),
    account,
    randomizer ?? new Uint8Array(),
  );
  return Address.fromBinary(bytes);
};

export const getEphemeralByIndex = async (fullViewingKey: FullViewingKey, index: number) => {
  const bytes = get_ephemeral_address(fullViewingKey.toBinary(), index);
  return Address.fromBinary(bytes);
};

export const getWalletId = async (fullViewingKey: FullViewingKey) => {
  return WalletId.fromBinary(get_wallet_id(fullViewingKey.toBinary()));
};

export interface NobleAddrResponse {
  // A noble address that will be used for registration on the noble network
  nobleAddrBech32: string;
  // Byte representation of the noble forwarding address. Used for broadcasting cosmos message.
  nobleAddrBytes: Uint8Array;
  // The penumbra address that a deposit to the noble address with forward to
  penumbraAddr: Address;
}

// Generates an address that can be used as a forwarding address for Noble
export const getNobleForwardingAddr = async (
  sequence: number,
  fvk: FullViewingKey,
  channel: string,
  account?: number,
): Promise<NobleAddrResponse> => {
  const res = get_noble_forwarding_addr(sequence, fvk.toBinary(), channel, account);
  return {
    nobleAddrBech32: res.noble_addr_bech32,
    nobleAddrBytes: res.noble_addr_bytes,
    penumbraAddr: Address.fromBinary(res.penumbra_addr_bytes),
  };
};

// Generates a transparent address that ensures bech32m encoding compatibility.
export const getTransparentAddress = async (fvk: FullViewingKey) => {
  const res = get_transparent_address(fvk.toBinary());
  return {
    address: Address.fromBinary(res.address),
    encoding: res.encoding,
  };
};

export const getTransmissionKeyByAddress = async (address: Address) => {
  const transmission_key = get_transmission_key_by_address(address.toBinary());
  return transmission_key;
};
