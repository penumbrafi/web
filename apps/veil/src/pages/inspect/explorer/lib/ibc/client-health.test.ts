import { describe, expect, it } from 'vitest'
import { ClientStatus } from '@/pages/inspect/explorer/lib/graphql/generated/types'
import { FILTER_STATUS, clientExpiresAt, isClientFilter } from './client-health'

describe('isClientFilter', () => {
    it('accepts every tab and rejects anything else', () => {
        expect(isClientFilter('open')).toBe(true)
        expect(isClientFilter('expired')).toBe(true)
        expect(isClientFilter('frozen')).toBe(true)
        expect(isClientFilter('all')).toBe(true)
        // ?filter= is user input: unknown values fall back to the default tab.
        expect(isClientFilter('Open')).toBe(false)
        expect(isClientFilter('')).toBe(false)
        expect(isClientFilter(undefined)).toBe(false)
    })
})

describe('FILTER_STATUS', () => {
    it('lists one status per tab, and every status under all', () => {
        expect(FILTER_STATUS.open).toBe(ClientStatus.Active)
        expect(FILTER_STATUS.expired).toBe(ClientStatus.Expired)
        expect(FILTER_STATUS.frozen).toBe(ClientStatus.Frozen)
        expect(FILTER_STATUS.all).toBeUndefined()
    })
})

describe('clientExpiresAt', () => {
    const DAY = 24 * 60 * 60 * 1000
    const LAST_UPDATE = 1_756_500_000_000

    it('adds the trusting period to the last activity', () => {
        expect(clientExpiresAt(ClientStatus.Active, LAST_UPDATE, 14 * DAY)).toBe(
            LAST_UPDATE + 14 * DAY
        )
    })

    it('dates expired clients too, so the tab shows how long ago they lapsed', () => {
        expect(clientExpiresAt(ClientStatus.Expired, LAST_UPDATE, 14 * DAY)).toBe(
            LAST_UPDATE + 14 * DAY
        )
    })

    it('never expires a frozen client', () => {
        expect(clientExpiresAt(ClientStatus.Frozen, LAST_UPDATE, 14 * DAY)).toBeUndefined()
    })

    it('has no estimate without a trusting period', () => {
        expect(clientExpiresAt(ClientStatus.Active, LAST_UPDATE, undefined)).toBeUndefined()
    })

    it('has no estimate without a last update time', () => {
        expect(clientExpiresAt(ClientStatus.Active, Number.NaN, 14 * DAY)).toBeUndefined()
    })
})
