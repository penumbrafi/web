import {
  Address,
  AddressView,
  FullViewingKey,
} from '@penumbra-zone/protobuf/penumbra/core/keys/v1/keys_pb';
import { getAddressIndexByAddress } from '@penumbrafi/wasm/address';

export const getAddressView = async (
  address: Address,
  fullViewingKey: FullViewingKey,
): Promise<AddressView> => {
  const index = await getAddressIndexByAddress(fullViewingKey, address);

  if (index) {
    return new AddressView({
      addressView: {
        case: 'decoded',
        value: {
          address,
          index,
        },
      },
    });
  } else {
    return new AddressView({
      addressView: {
        case: 'opaque',
        value: {
          address,
        },
      },
    });
  }
};
