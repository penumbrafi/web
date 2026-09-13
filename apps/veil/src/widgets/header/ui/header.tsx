import { Density } from '@penumbra-zone/ui/Density';
import { HeaderLogo } from './logo';
import { StatusPopover } from './status-popover';
import { HelpPopover } from './help-popover';
import { SettingsPopover } from './settings-popover';
import { MobileNav } from './mobile-nav';
import { DesktopNav } from './desktop-nav';
import { Connection } from './connection';

export const Header = () => {
  return (
    <header className='grid grid-cols-3 items-center p-4'>
      <div className='flex items-center'>
        <HeaderLogo />
      </div>

      <div className='flex justify-center'>
        <DesktopNav />
      </div>

      <div className='flex items-center justify-end gap-2'>
        <div className='hidden items-center gap-2 lg:flex'>
          <Density sparse>
            <StatusPopover />
            <SettingsPopover />
            <HelpPopover />
            <Connection />
          </Density>
        </div>

        <div className='flex items-center gap-2 lg:hidden'>
          <Density compact>
            {/* Mobile top bar keeps only the primary wallet action and the
                menu button. Status / Settings / Help / Deposit collapse
                into the drawer to declutter narrow viewports. */}
            <Connection mobile />
            <MobileNav />
          </Density>
        </div>
      </div>
    </header>
  );
};
