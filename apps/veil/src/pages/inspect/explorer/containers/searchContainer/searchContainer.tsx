'use client'

import { SearchIcon } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import {
    ChangeEvent,
    FC,
    MouseEvent,
    useCallback,
    useEffect,
    useRef,
    useState,
} from 'react'
import { useClient } from 'urql'
import { SearchResult, SearchResultOverlay } from '@/pages/inspect/explorer/components'
import {
    SearchQuery,
    SearchQueryVariables,
} from '@/pages/inspect/explorer/lib/graphql/generated/types'
import { searchQuery } from '@/pages/inspect/explorer/lib/graphql/queries'
import { useDebounce, useLocalStorage } from '@/pages/inspect/explorer/lib/hooks'
import { searchIbc } from '@/pages/inspect/explorer/lib/ibc'
import { StoredSearchResult } from '@/pages/inspect/explorer/lib/types'
import { classNames } from '@/pages/inspect/explorer/lib/utils'

interface Props {
    autoFocus?: boolean
    className?: string
    onBlur?: () => void
}

const SearchContainer: FC<Props> = props => {
    const graphqlClient = useClient()
    const inputRef = useRef<HTMLInputElement>(null)
    const [focused, setFocused] = useState(false)
    const [inputQuery, setInputQuery] = useState('')
    const [searchResult, setSearchResult] = useState<StoredSearchResult>()
    const [queryExecuted, setQueryExecuted] = useState(false)

    const [executeSearchQuery, cancelSearchQuery] = useDebounce<
        (query: string) => Promise<StoredSearchResult | undefined>
    >(async (query: string) => {
        const result = await graphqlClient
            .query<
                SearchQuery,
                SearchQueryVariables
            >(searchQuery, { slug: query })
            .toPromise()

        if (result.error || !result.data?.search) {
            const client = searchIbc(query)

            if (client) {
                return {
                    id: client.id,
                    type: 'client',
                }
            }
        } else if (result.data.search.__typename === 'Block') {
            return {
                height: result.data.search.height,
                type: 'block',
            }
        } else if (result.data.search.__typename === 'Transaction') {
            return {
                hash: result.data.search.hash.toLowerCase(),
                type: 'transaction',
            }
        } else if (result.data.search.__typename === 'ValidatorSearchResults') {
            const first = result.data.search.items[0]
            if (first) {
                return {
                    id: first.id,
                    name: first.displayName,
                    type: 'validator',
                }
            }
        }
        return undefined
    }, 300)

    const [recentSearchResults, setRecentSearchResults] =
        useLocalStorage<StoredSearchResult[]>('search')

    useEffect(() => {
        if (!searchResult) {
            return
        }

        if (recentSearchResults?.length) {
            if (recentSearchResults[0] === searchResult) {
                return
            }

            setRecentSearchResults(
                [
                    searchResult,
                    ...recentSearchResults.filter(result => {
                        if (
                            result.type === 'block' &&
                            result.type === searchResult.type
                        ) {
                            return result.height !== searchResult.height
                        } else if (
                            result.type === 'transaction' &&
                            result.type === searchResult.type
                        ) {
                            return result.hash !== searchResult.hash
                        } else if (
                            result.type === 'client' &&
                            result.type === searchResult.type
                        ) {
                            return result.id !== searchResult.id
                        } else if (
                            result.type === 'validator' &&
                            result.type === searchResult.type
                        ) {
                            return result.id !== searchResult.id
                        }

                        return true
                    }),
                ].slice(0, 5)
            )
        } else {
            setRecentSearchResults([searchResult])
        }
    }, [recentSearchResults, searchResult, setRecentSearchResults])

    const focusInput = useCallback(() => inputRef.current?.focus(), [])

    const onInputFocus = useCallback(() => setFocused(true), [])

    // Without this, the dropdown unmounts the instant the user clicks a
    // result link (focus leaves the input → setFocused(false) →
    // <AnimatePresence> tears the link out before the click registers).
    // If the new focus target is inside the search container (a Link or
    // the recent-results list), keep the dropdown open and let the click
    // navigate. Anything outside the container — close as before.
    const containerRef = useRef<HTMLDivElement>(null)

    const onInputBlur = useCallback(
        (e: React.FocusEvent<HTMLInputElement>) => {
            const next = e.relatedTarget as Node | null
            if (next && containerRef.current?.contains(next)) {
                return
            }
            setFocused(false)
            props.onBlur?.call(undefined)
        },
        [props.onBlur],
    )

    const onInputChange = useCallback(
        (e: ChangeEvent<HTMLInputElement>) => {
            const value = e.currentTarget.value
            setInputQuery(value)

            const cleanedValue = value.trim().replaceAll(',', '')

            if (cleanedValue) {
                // Catch so queryExecuted flips even if the GraphQL endpoint
                // errors. Without this, a transient network blip would leave
                // queryExecuted=false and the dropdown would never render.
                executeSearchQuery(cleanedValue)
                    .then(result => {
                        setSearchResult(result)
                        setQueryExecuted(true)
                    })
                    .catch(() => {
                        setSearchResult(undefined)
                        setQueryExecuted(true)
                    })
            } else {
                cancelSearchQuery()
                setQueryExecuted(false)
                setSearchResult(undefined)
            }
        },
        [cancelSearchQuery, executeSearchQuery]
    )

    // istanbul ignore next
    const onClick = useCallback((e: MouseEvent) => e.stopPropagation(), [])

    let searchResults

    if (inputQuery && queryExecuted) {
        if (searchResult) {
            const titles = {
                block: 'Block',
                client: 'IBC chain',
                transaction: 'Transaction',
                validator: 'Validator',
            }

            searchResults = (
                <SearchResultOverlay title={titles[searchResult.type]}>
                    <ul
                        className={classNames(
                            'flex flex-col gap-2 font-mono text-sm',
                            'font-medium'
                        )}
                    >
                        <SearchResult searchResult={searchResult} />
                    </ul>
                </SearchResultOverlay>
            )
        } else {
            searchResults = (
                <SearchResultOverlay>
                    <p className="px-2 py-1 font-default text-sm font-normal">
                        We couldn’t find any results matching your search.
                    </p>
                </SearchResultOverlay>
            )
        }
    } else if (recentSearchResults?.length) {
        searchResults = (
            <SearchResultOverlay title="Recent search results">
                <ul
                    className={classNames(
                        'flex flex-col gap-2 font-mono text-sm',
                        'font-medium'
                    )}
                >
                    {recentSearchResults.map((searchResult, i) => (
                        <SearchResult key={i} searchResult={searchResult} />
                    ))}
                </ul>
            </SearchResultOverlay>
        )
    }

    return (
        <div
            ref={containerRef}
            className={classNames(
                'relative w-full sm:w-[568px] xl:w-[639px]!',
                props.className
            )}
            onClick={onClick}
        >
            <SearchIcon
                className={classNames(
                    'transition-stroke absolute top-1/2 left-4 z-10',
                    'stroke-text-secondary -translate-y-1/2 cursor-pointer',
                    'hover:stroke-text-primary duration-200 ease-out'
                )}
                onClick={focusInput}
                size={16}
            />
            <input
                ref={inputRef}
                autoFocus={props.autoFocus}
                className={classNames(
                    'font-default bg-other-tonal-fill5 w-full rounded-sm p-4',
                    'text-text-secondary pl-11 text-base outline-2',
                    'outline-transparent backdrop-blur-lg',
                    'focus:outline-text-secondary focus:transition-none'
                )}
                onBlur={onInputBlur}
                onChange={onInputChange}
                onFocus={onInputFocus}
                placeholder="Search the blockchain"
                type="text"
                value={inputQuery}
            />
            {/* Render the dropdown when focused OR when the user has typed
                something — typing alone is enough intent to show results
                even if the input briefly loses focus to an autocomplete or
                a parent click handler. */}
            <AnimatePresence initial={false}>
                {(focused || inputQuery) && searchResults}
            </AnimatePresence>
        </div>
    )
}

export default SearchContainer
