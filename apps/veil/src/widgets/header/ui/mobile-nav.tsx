import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useRouter } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { Button } from '@penumbra-zone/ui/Button';
import { Density } from '@penumbra-zone/ui/Density';
import { Dialog } from '@penumbra-zone/ui/Dialog';
import { Display } from '@penumbra-zone/ui/Display';
import { MenuItem } from '@penumbra-zone/ui/MenuItem';
import { connectionStore } from '@/shared/model/connection';
import { DepositButton } from '@/features/deposit/deposit-button';
import { HeaderLogo } from './logo';
import { HEADER_LINKS } from './links';
import { StatusPopover } from './status-popover';
import { SettingsPopover } from './settings-popover';
import { HelpPopover } from './help-popover';

export const MobileNav = observer(() => {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);

  const onNavigate = (link: string) => {
    router.push(link);
    setIsOpen(false);
  };

  return (
    <Dialog isOpen={isOpen} onClose={() => setIsOpen(false)}>
      <Button
        iconOnly
        icon={Menu}
        onClick={() => setIsOpen(true)}
        aria-expanded={isOpen}
        aria-haspopup='menu'
      >
        Menu
      </Button>
      <Dialog.EmptyContent title='Navigation menu'>
        <div className='pointer-events-auto h-full overflow-hidden bg-black'>
          <Display>
            <nav className='flex items-center justify-between py-5'>
              <HeaderLogo />

              <Button iconOnly icon={X} onClick={() => setIsOpen(false)}>
                Close
              </Button>
            </nav>

            <div className='flex flex-col gap-4'>
              {HEADER_LINKS.map(link => (
                <MenuItem
                  key={link.value}
                  label={link.label}
                  icon={link.icon}
                  onClick={() => onNavigate(link.value)}
                />
              ))}
            </div>

            {/* Controls previously crowding the mobile top bar. Kept in
                the drawer so status/settings/help/deposit are still one
                tap away without competing with the wallet chip. */}
            <div className='mt-6 flex flex-wrap items-center gap-2 border-t border-other-tonal-stroke pt-4'>
              <Density compact>
                <StatusPopover />
                <SettingsPopover />
                <HelpPopover />
                {connectionStore.connected && <DepositButton variant='minimal' />}
              </Density>
            </div>
          </Display>
        </div>
      </Dialog.EmptyContent>
    </Dialog>
  );
});
