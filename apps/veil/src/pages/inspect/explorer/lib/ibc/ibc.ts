// Chain icons live in /public/inspect-icons/ibc/ as plain static SVGs.
// Importing the SVGs directly resolves them through @svgr/webpack as React
// components, which can't be passed as `src` to Client Components (e.g. the
// Avatar in @penumbra-zone/ui).
const icon = (slug: string) => `/inspect-icons/ibc/${slug}.svg`

export const ibc = [
    {
        chainId: 'cosmoshub-4',
        id: '07-tendermint-0',
        image: icon('cosmoshub'),
        name: 'Cosmos Hub',
        slug: 'cosmoshub',
    },
    {
        chainId: 'noble-1',
        id: '07-tendermint-2',
        image: icon('noble'),
        name: 'Noble',
        slug: 'noble',
    },
    {
        chainId: 'celestia',
        id: '07-tendermint-3',
        image: icon('celestia'),
        name: 'Celestia',
        slug: 'celestia',
    },
    {
        chainId: 'osmosis-1',
        id: '07-tendermint-4',
        image: icon('osmosis'),
        name: 'Osmosis',
        slug: 'osmosis',
    },
    {
        chainId: 'axelar-dojo-1',
        id: '07-tendermint-11',
        image: icon('axelar'),
        name: 'Axelar',
        slug: 'axelar',
    },
    {
        chainId: 'stride-1',
        id: '07-tendermint-12',
        image: icon('stride'),
        name: 'Stride',
        slug: 'stride',
    },
    {
        chainId: 'neutron-1',
        id: '07-tendermint-14',
        image: icon('neutron'),
        name: 'Neutron',
        slug: 'neutron',
    },
    {
        chainId: 'injective-1',
        id: '07-tendermint-26',
        image: icon('injective'),
        name: 'Injective Finance',
        slug: 'injective',
    },
    {
        chainId: 'dxdy-mainnet-1',
        id: '07-tendermint-22',
        image: icon('dydx'),
        name: 'dYdX Protocol',
        slug: 'dydx',
    },
]

export const searchIbc = (query: string) => {
    if (query.length < 2) {
        return
    }

    const transformedQuery = query.toLowerCase()

    return ibc.find(client =>
        client.name.toLowerCase().startsWith(transformedQuery)
    )
}
