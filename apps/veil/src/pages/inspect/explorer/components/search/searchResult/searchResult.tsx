'use client'

import { BoxIcon, CheckCheckIcon } from 'lucide-react'
import Link from 'next/link'
import { FC } from 'react'
import ibc from '@/pages/inspect/explorer/lib/ibc'
import { placeholderAvatarImage } from '@/pages/inspect/explorer/lib/images'
import { StoredSearchResult } from '@/pages/inspect/explorer/lib/types'
import { classNames, formatNumber, shortenHash } from '@/pages/inspect/explorer/lib/utils'
import { validatorImages } from '@/pages/inspect/explorer/lib/validators'
import Avatar from '../../avatar'

export interface Props {
    searchResult: StoredSearchResult
}

const SearchResult: FC<Props> = props => {
    const linkClassName = 'text-text-primary! flex gap-1 px-2 py-1 break-all'
    const iconClassName = '-mt-0.5 min-w-6 p-1'
    let link

    switch (props.searchResult.type) {
        case 'block':
            link = (
                <Link
                    className={linkClassName}
                    href={`/explore/block/${props.searchResult.height}`}
                >
                    <BoxIcon className={iconClassName} />
                    {formatNumber(props.searchResult.height)}
                </Link>
            )
            break
        case 'transaction':
            link = (
                <Link
                    className={linkClassName}
                    href={`/explore/tx/${props.searchResult.hash}`}
                >
                    <CheckCheckIcon className={iconClassName} />
                    {props.searchResult.hash}
                </Link>
            )
            break
        case 'client':
            const client = ibc.find(
                c =>
                    props.searchResult.type === 'client' &&
                    c.id === props.searchResult.id
            )

            if (!client) {
                break
            }

            link = (
                <Link className={linkClassName} href={`/explore/ibc/${client.slug}`}>
                    <Avatar
                        alt={client.name}
                        className="-mt-0.5 h-6 w-6 p-1"
                        fallback={placeholderAvatarImage}
                        src={client.image}
                    />
                    {client.name}
                </Link>
            )
            break
        case 'validator':
            link = (
                <Link
                    className={linkClassName}
                    href={`/explore/validators/${encodeURIComponent(props.searchResult.id)}`}
                >
                    <Avatar
                        alt={props.searchResult.name ?? props.searchResult.id}
                        className="-mt-0.5 h-6 w-6 p-1"
                        fallback={placeholderAvatarImage}
                        src={validatorImages[props.searchResult.id]}
                        fallbackLetter
                    />
                    {props.searchResult.name ??
                        shortenHash(props.searchResult.id, 16)}
                </Link>
            )
            break
    }

    if (!link) {
        return
    }

    return (
        <li
            className={classNames(
                'rounded-sm transition-colors duration-200',
                'hover:bg-action-hover-overlay ease-out'
            )}
        >
            {link}
        </li>
    )
}

export default SearchResult
