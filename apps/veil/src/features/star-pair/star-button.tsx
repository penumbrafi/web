'use client';

import { FC, KeyboardEvent, MouseEvent } from 'react';
import { observer } from 'mobx-react-lite';
import { Star } from 'lucide-react';
import { Button } from '@penumbra-zone/ui/Button';
import { Density } from '@penumbra-zone/ui/Density';
import StarFilled from './star-filled.svg';
import type { Pair } from './storage';
import { starStore } from './store';

export interface StarButtonProps {
  pair: Pair;
  /**
   * Inside a row that is itself a button (the pair selector's radio items).
   * Rendered as a focusable span with role="button", since a <button>
   * can't contain another <button>.
   */
  adornment?: boolean;
}

export const StarButton = observer(({ pair, adornment }: StarButtonProps) => {
  const { star, unstar, isStarred } = starStore;
  const starred = isStarred(pair);

  const onClick = (event: MouseEvent | KeyboardEvent) => {
    // Star toggles never navigate, submit or select — stop the React event
    // from bubbling to an enclosing <Link>/<form>/row handler, and
    // preventDefault in case a parent anchor would still be activated.
    event.stopPropagation();
    event.preventDefault();
    if (starred) {
      unstar(pair);
    } else {
      star(pair);
    }
  };

  if (adornment) {
    const Icon = starred ? (StarFilled as FC<{ className?: string }>) : Star;
    return (
      <span
        role='button'
        tabIndex={0}
        aria-label='Favorite'
        aria-pressed={starred}
        title='Favorite'
        onClick={onClick}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            onClick(event);
          }
        }}
        className='flex size-6 cursor-pointer items-center justify-center rounded-full text-text-primary hover:bg-action-hover-overlay focus-visible:outline-2 focus-visible:outline-action-neutral-focus-outline'
      >
        <Icon className='size-4' />
      </span>
    );
  }

  return (
    <Density compact>
      <Button
        icon={starred ? (StarFilled as FC) : Star}
        priority='secondary'
        iconOnly
        onClick={onClick}
      >
        Favorite
      </Button>
    </Density>
  );
});
