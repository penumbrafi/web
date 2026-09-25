/**
 * Narrowing for the indexer's untyped JSON scalars (rawJson, payload).
 * A missing or reshaped field reads as empty instead of throwing, so one odd
 * row can't take a whole page down with a 500.
 */
export type JsonRecord = Record<string, unknown>

export const asRecord = (value: unknown): JsonRecord =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as JsonRecord)
        : {}

export const asArray = (value: unknown): unknown[] =>
    Array.isArray(value) ? (value as unknown[]) : []

/** A DateTime scalar (ISO string or epoch) for dayjs; anything else reads as invalid. */
export const asTime = (value: unknown): number | string | undefined =>
    typeof value === 'string' || typeof value === 'number' ? value : undefined

export interface RawEvent {
    attributes: unknown
    event_id: unknown
    type: unknown
}

/** Events as stored by the indexer, in emission order. */
export const sortedEvents = (value: unknown): RawEvent[] =>
    asArray(value)
        .map(asRecord)
        .map(event => ({
            event_id: event['event_id'],
            type: event['type'],
            attributes: event['attributes'],
        }))
        .toSorted((a, b) => Number(a.event_id) - Number(b.event_id))
