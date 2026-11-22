import Link from 'next/link';
import { Brand } from './icons';
import { CheeseTabs, type CheeseMode } from './cheese-tabs';
import { AccountMenu, type AccountMenuProps } from './account-menu';

export function WorkspaceHeader({ account, active }: { account?: AccountMenuProps; active?: CheeseMode }) {
  return <header className={account ? 'topbar workspace-topbar' : 'topbar'}>
    <div className="frame topbar-inner">
      {account ? <>
        <AccountMenu {...account}/>
        <CheeseTabs active={active}/>
      </> : <Link href="/" aria-label="CheeseCool 首页"><Brand/></Link>}
    </div>
  </header>;
}
