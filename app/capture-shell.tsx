import type { AccountMenuProps } from './account-menu';
import { AddBookmark } from './controls';
import { CheeseMark } from './icons';
import { WorkspaceHeader } from './workspace-header';

export function CaptureShell({ account }: { account: AccountMenuProps }) {
  return <>
    <WorkspaceHeader account={account} active="capture"/>
    <main className="capture-page">
      <section className="hero" aria-labelledby="hero-title">
        <div className="frame hero-content">
          <div className="hero-mark"><CheeseMark size={46}/></div>
          <h1 id="hero-title">把好东西都存起来。</h1>
          <AddBookmark/>
        </div>
      </section>
    </main>
  </>;
}
