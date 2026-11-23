import Link from 'next/link';
import { ThemeSwitch } from './theme-switch';
import { Brand } from './icons';
import { AccountMenu, type AccountMenuProps } from './account-menu';

export function WorkspaceHeader({ account, workspace }: { account?: AccountMenuProps; workspace?: boolean }) {
  return <header className={account ? 'topbar workspace-topbar' : 'topbar'}>
    <div className="frame topbar-inner">
      {account ? <>
        <Link className="workspace-brand" href="/" aria-label="CheeseCool 首页"><Brand/></Link>
        {!workspace && <Link className="workspace-home" href="/">芝士库</Link>}
        <div className="workspace-header-actions"><ThemeSwitch/><AccountMenu {...account}/></div>
      </> : <>
        <Link href="/" aria-label="CheeseCool 首页"><Brand/></Link>
        <ThemeSwitch/>
      </>}
    </div>
  </header>;
}
