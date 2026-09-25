/** The string if it has content, else undefined - so `nonEmpty(name) ?? id` treats '' as missing. */
const nonEmpty = (value: null | string | undefined): string | undefined =>
    value?.length ? value : undefined

export default nonEmpty
