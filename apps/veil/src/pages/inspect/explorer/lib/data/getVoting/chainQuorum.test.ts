import { describe, expect, it } from 'vitest'
import { parseRatio } from './chainQuorum'

describe('parseRatio', () => {
    it('parses the "n/d" form pd emits', () => {
        expect(parseRatio('40/100')).toBe(0.4)
    })
    it('parses a plain decimal', () => {
        expect(parseRatio('0.4')).toBe(0.4)
    })
    it('rejects garbage and zero denominators', () => {
        expect(parseRatio('')).toBeUndefined()
        expect(parseRatio('1/0')).toBeUndefined()
        expect(parseRatio('1/2/3')).toBeUndefined()
        expect(parseRatio('abc')).toBeUndefined()
    })
})
