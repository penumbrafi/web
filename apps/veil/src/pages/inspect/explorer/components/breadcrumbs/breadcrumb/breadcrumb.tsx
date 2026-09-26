import Link from 'next/link'
import { FC } from 'react'
import { classNames } from '@/pages/inspect/explorer/lib/utils'

export interface Props {
    children: string
    href?: string
}

const Breadcrumb: FC<Props> = props => {
    const className = classNames('font-heading text-xl font-medium sm:text-3xl')

    return props.href ? (
        <Link
            className={classNames(
                className,
                'hover:text-text-primary text-text-muted'
            )}
            href={props.href}
        >
            {props.children}
        </Link>
    ) : (
        <span className={className}>{props.children}</span>
    )
}

export default Breadcrumb
