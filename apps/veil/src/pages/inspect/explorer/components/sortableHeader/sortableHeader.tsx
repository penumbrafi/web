'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { FC, useCallback } from 'react'
import { classNames } from '@/pages/inspect/explorer/lib/utils'

interface Props {
    children: React.ReactNode
    className?: string
    currentSort?: string
    direction?: 'asc' | 'desc'
    sortKey: string
}

const SortableHeader: FC<Props> = props => {
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const router = useRouter()

    const isActive = props.currentSort === props.sortKey
    const currentDirection = isActive ? props.direction : undefined

    const onClick = useCallback(() => {
        const params = new URLSearchParams(searchParams ?? undefined)
        params.set('sort', props.sortKey)
        params.set('dir', currentDirection === 'desc' ? 'asc' : 'desc')
        params.delete('page')
        router.push(`${pathname}?${params}`)
    }, [currentDirection, pathname, props.sortKey, router, searchParams])

    let arrow = '\u2195'
    if (isActive) {
        arrow = currentDirection === 'asc' ? '\u2191' : '\u2193'
    }

    return (
        <button
            className={classNames(
                'inline-flex items-center gap-1 text-left',
                isActive ? 'text-text-primary' : 'text-text-secondary',
                'hover:text-text-primary transition-colors',
                props.className
            )}
            onClick={onClick}
            type="button"
        >
            {props.children}
            <span className="text-xs">
                {arrow}
            </span>
        </button>
    )
}

export default SortableHeader
