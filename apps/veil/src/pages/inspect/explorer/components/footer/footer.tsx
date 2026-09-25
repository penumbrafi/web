import { FC } from 'react'
import { appVersion, envName } from '@/pages/inspect/explorer/lib/constants'
import { classNames } from '@/pages/inspect/explorer/lib/utils'
import Container from '../container'
import { Discord, GitHub, LogoMinimal, Penumbra, Twitter } from '../vectors'

interface Props {
    className?: string
}

const Footer: FC<Props> = props => (
    <Container
        as="footer"
        className={classNames(
            'grid gap-6 pb-6 sm:grid-cols-[1fr_auto_1fr]',
            props.className
        )}
    >
        <div className="flex flex-col items-center gap-2 sm:items-start">
            <LogoMinimal />
            <div className="flex gap-2">
                <a
                    className={classNames(
                        'border-other-tonal-stroke inline-flex h-8 w-8',
                        'items-center justify-center rounded-full border-1'
                    )}
                    href="http://discord.gg/penumbrazone"
                    target="_blank" rel="noreferrer"
                >
                    <Discord />
                </a>
                <a
                    className={classNames(
                        'border-other-tonal-stroke inline-flex h-8 w-8',
                        'items-center justify-center rounded-full border-1'
                    )}
                    href="https://github.com/penumbrafi/penumbra-explorer"
                    target="_blank" rel="noreferrer"
                >
                    <GitHub />
                </a>
                <a
                    className={classNames(
                        'border-other-tonal-stroke inline-flex h-8 w-8',
                        'items-center justify-center rounded-full border-1'
                    )}
                    href="https://twitter.com/penumbrazone"
                    target="_blank" rel="noreferrer"
                >
                    <Twitter />
                </a>
            </div>
        </div>
        <div className="flex flex-col items-center gap-1 sm:col-3 sm:items-end">
            <span className="text-xs text-text-secondary">Powered by</span>
            <a href="https://penumbra.zone/" target="_blank" rel="noreferrer">
                <Penumbra />
            </a>
        </div>
        <div
            className={classNames(
                'text-text-secondary text-center text-xs sm:col-3 sm:row-2',
                'sm:text-right'
            )}
        >
            Supported by
            <br />
            <a href="https://numogrammatics.org/" target="_blank" rel="noreferrer">
                IAN
            </a>
            ,{' '}
            <a href="https://penumbralabs.xyz/" target="_blank" rel="noreferrer">
                Penumbra Labs
            </a>
            ,{' '}
            <a href="https://radiantcommons.com/" target="_blank" rel="noreferrer">
                Radiant Commons
            </a>
        </div>
        <div
            className={classNames(
                'text-text-secondary text-center text-xs sm:col-1 sm:row-2',
                'sm:self-end sm:text-left'
            )}
        >
            Questions or fixes? Ping{' '}
            <a
                className="text-text-secondary hover:text-text-special"
                href="https://discord.gg/penumbrazone"
                target="_blank" rel="noreferrer"
            >
                #dev-chat on the Penumbra Discord
            </a>
            .
        </div>
        <div
            className={classNames(
                'text-text-muted text-center text-xs sm:col-2 sm:row-2',
                'sm:self-end'
            )}
        >
            {envName !== 'prod' ? `${envName}-` : ''}v{appVersion}
        </div>
    </Container>
)

export default Footer
