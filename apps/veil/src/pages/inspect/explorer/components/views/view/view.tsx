import { FC, ReactNode } from 'react';
import { classNames } from '@/pages/inspect/explorer/lib/utils';
import { ViewNavigationProps } from '../viewNavigation';

export interface Props extends ViewNavigationProps {
  children?: ReactNode;
  className?: string;
  title: string;
  /** Rendered at the right of the header, e.g. a view toggle. */
  headerEnd?: ReactNode;
}

const View: FC<Props> = props => (
  <article
    className={classNames(
      'border-other-tonal-stroke flex flex-col gap-4 rounded-lg',
      'border-1 bg-radial-[100%_100%_at_0%_0%]',
      'from-[rgba(174,174,174,0.25)] from-0%',
      'to-[rgba(174,174,174,0.03)] to-100% p-6 backdrop-blur-md',
      props.className,
    )}
  >
    <header className='flex items-center justify-between'>
      <h1 className='text-base font-medium'>{props.title}</h1>
      {props.headerEnd}
      {/* <ViewNavigation*/}
      {/*    nextHref={props.nextHref}*/}
      {/*    prevHref={props.prevHref}*/}
      {/*/ >*/}
    </header>
    {props.children}
  </article>
);

export default View;
