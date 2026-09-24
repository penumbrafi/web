import { describe, expect, it } from 'vitest'
import { toParagraphs } from './paragraphs'

describe('toParagraphs', () => {
    it('rejoins hard-wrapped lines and splits on blank lines', () => {
        expect(
            toParagraphs(
                'dexParams.fixedCandidates is a routing hint. When a user swaps\nA for B and there is no direct pair.\n\nSecond paragraph.'
            )
        ).toEqual([
            [
                'dexParams.fixedCandidates is a routing hint. When a user swaps A for B and there is no direct pair.',
            ],
            ['Second paragraph.'],
        ])
    })

    it('keeps headings and list items on their own lines', () => {
        expect(
            toParagraphs('WHAT THE TWO LISTS DO\n- one\n  continued\n- two\n1. three')
        ).toEqual([['WHAT THE TWO LISTS DO', '- one continued', '- two', '1. three']])
    })

    it('handles CRLF and empty input', () => {
        expect(toParagraphs('a\r\nb')).toEqual([['a b']])
        expect(toParagraphs('  \n\n ')).toEqual([])
    })
})
