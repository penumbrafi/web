import { UmPriceData } from '@/pages/inspect/explorer/lib/types'

interface Data {
    current_price: number
    price_change_percentage_24h: number
    error?: string
}

// Route through the veil server: on the browser side CoinGecko does not
// send Access-Control-Allow-Origin, and calling this from the client
// otherwise fails CORS. On the server side the module runs inside Next's
// Node runtime, so the same relative URL works.
const url =
    typeof window === 'undefined'
        ? `${process.env['BASE_URL'] ?? 'http://localhost:3001'}/api/um-price`
        : '/api/um-price'

const getUmPrice = async (): Promise<UmPriceData | undefined> => {
    try {
        const data: Data = await fetch(url).then(res => res.json())
        if (data.error || typeof data.current_price !== 'number') {return undefined}
        return {
            change: data.price_change_percentage_24h,
            price: data.current_price,
        }
    } catch (e) {
        console.error(e)
        return undefined
    }
}

export default getUmPrice
