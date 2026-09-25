'use client'

import { motion } from 'motion/react'
import { FC, ReactElement } from 'react'
import { classNames } from '@/pages/inspect/explorer/lib/utils'
import { SearchResultProps } from '../searchResult'

export interface Props {
    children?:
        | (| ReactElement<SearchResultProps>[]
              | false
              | null
              | ReactElement<SearchResultProps>
              | undefined)[]
        | ReactElement<SearchResultProps>
    title?: string
}

const SearchResultOverlay: FC<Props> = props => (
    <motion.div
        animate={{ opacity: 1, transition: { duration: 0 } }}
        className={classNames(
            'border-other-tonal-stroke bg-other-dialog-background absolute',
            'top-16 z-10 flex w-full flex-col gap-2 rounded-sm border px-2',
            'py-3 backdrop-blur-lg'
        )}
        exit={{
            opacity: 0,
            transition: { duration: 0.2, ease: 'easeOut' },
        }}
        initial={{ opacity: 0 }}
        // mousedown fires *before* blur, so cancelling its default keeps
        // focus on the input — the subsequent click on a Link still
        // navigates because click happens after.
        onMouseDown={e => e.preventDefault()}
    >
        {props.title && (
            <h3 className="px-2 py-1 text-sm text-text-secondary">
                {props.title}
            </h3>
        )}
        {props.children}
    </motion.div>
)

export default SearchResultOverlay
