import Link from 'next/link';
import { signOut } from './actions';
import { Brand, Icon } from './icons';

export function WorkspaceHeader({ active }: { active: 'library' | 'network' | 'settings' }) {
  return <header className="topbar">
    <div className="frame topbar-inner">
      <Link href="/" aria-label="CheeseCool 首页"><Brand/></Link>
      <div className="workspace-nav">
        <nav aria-label="主导航">
          <Link href="/" aria-current={active === 'library' ? 'page' : undefined}>收藏</Link>
          <Link href="/network" aria-current={active === 'network' ? 'page' : undefined}>芝士库</Link>
          <Link href="/settings" aria-current={active === 'settings' ? 'page' : undefined}>AI 设置</Link>
        </nav>
        <form action={signOut}>
          <button className="icon-button" aria-label="退出登录" title="退出登录"><Icon name="logout"/></button>
        </form>
      </div>
    </div>
  </header>;
}
