import { ChevronRightIcon } from 'lucide-react'
import { Children, FC, ReactElement } from 'react'
import { classNames } from '@/pages/inspect/explorer/lib/utils'
import { BreadcrumbProps } from './breadcrumb'

interface Props {
    children?:
        | (| ReactElement<BreadcrumbProps>[]
              | false
              | null
              | ReactElement<BreadcrumbProps>
              | undefined)[]
        | ReactElement<BreadcrumbProps>
    className?: string
}

const Breadcrumbs: FC<Props> = props => {
    const lastIndex = Children.count(props.children) - 1

    return (
        <nav
            className={classNames(
                'mb-4 flex flex-wrap items-center gap-x-2 gap-y-1',
                props.className
            )}
        >
            {Children.map(props.children, (child, index) => (
                <>
                    {child}
                    {index < lastIndex && (
                        <ChevronRightIcon className="size-5 text-text-muted sm:size-6" />
                    )}
                </>
            ))}
        </nav>
    )
}

export default Breadcrumbs
