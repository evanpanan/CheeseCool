'use client';

import { useActionState, useId, useRef } from 'react';
import Link from 'next/link';
import { signOut } from './actions';
import { Brand, Icon } from './icons';

export type AccountMenuProps = { email?: string; showAdmin?: boolean; adminPage?: boolean };

export function AccountMenu({ email, showAdmin, adminPage }: AccountMenuProps) {
  const panel = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState(signOut, {});
  const titleId = useId();

  return <div className="account-menu">
    <button type="button" className="account-trigger" aria-haspopup="dialog" aria-label="账户菜单"
      onClick={event => {
        event.currentTarget.focus({ preventScroll: true });
        panel.current?.showModal();
      }}>
      <span className="account-menu-label">账户</span>
      <span className="account-menu-icon" aria-hidden="true"><i/><i/></span>
    </button>
    <dialog ref={panel} className="account-panel" aria-labelledby={titleId}
      onClick={event => { if (event.target === event.currentTarget) panel.current?.close(); }}>
      <div className="account-panel-content">
        <div className="account-panel-header">
          <h2 id={titleId}><Brand/></h2>
          <button type="button" className="icon-button" aria-label="关闭账户菜单" onClick={() => panel.current?.close()}>
            <Icon name="close" size={19}/>
          </button>
        </div>
        {email && <p className="account-email">{email}</p>}
        {showAdmin && <Link className="account-action" href="/settings" aria-current={adminPage ? 'page' : undefined}
          onClick={() => panel.current?.close()}>站点管理</Link>}
        <form action={action}>
          <button type="submit" className="account-action" disabled={pending}>{pending ? '正在退出…' : '退出登录'}</button>
        </form>
        {state.error && <p className="error" role="alert">{state.error}</p>}
      </div>
    </dialog>
  </div>;
}
