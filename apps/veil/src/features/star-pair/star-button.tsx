'use client';

import { FC, MouseEventHandler } from 'react';
import { observer } from 'mobx-react-lite';
import { Star } from 'lucide-react';
import { Button } from '@penumbra-zone/ui/Button';
import { Density } from '@penumbra-zone/ui/Density';
import StarFilled from './star-filled.svg';
import type { Pair } from './storage';
import { starStore } from './store';

export interface StarButtonProps {
  pair: Pair;
  adornment?: boolean;
}

export const StarButton = observer(({ pair, adornment }: StarButtonProps) => {
  const { star, unstar, isStarred } = starStore;
  const starred = isStarred(pair);

  const onClick: MouseEventHandler<HTMLButtonElement> = event => {
    // Star toggles never navigate or submit — stop the React event from
    // bubbling to an enclosing <Link>/<form> handler, and preventDefault
    // in case a parent anchor would still be activated by the browser.
    event.stopPropagation();
    event.preventDefault();
    if (starred) {
      unstar(pair);
    } else {
      star(pair);
    }
  };

  return (
    <Density compact>
      <Button
        icon={starred ? (StarFilled as FC) : Star}
        priority={adornment ? 'primary' : 'secondary'}
        iconOnly={adornment ? 'adornment' : true}
        onClick={onClick}
      >
        Favorite
      </Button>
    </Density>
  );
});
