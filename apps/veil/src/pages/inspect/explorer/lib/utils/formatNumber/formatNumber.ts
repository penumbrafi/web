/** Decimal scalars may arrive as numeric strings; both format the same. */
const formatNumber = (number: number | string, toFixed?: number) => {
    const options: Intl.NumberFormatOptions = {}

    if (typeof toFixed !== 'undefined') {
        options.minimumFractionDigits = toFixed
        options.maximumFractionDigits = toFixed
    }

    return new Intl.NumberFormat('en-US', options).format(Number(number))
}

export default formatNumber
