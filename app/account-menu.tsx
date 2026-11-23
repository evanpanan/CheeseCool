'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { signOut } from './auth/client';
import { Icon } from './icons';
import { AiSignal } from './ai-signal';
import { finishAuthNavigation } from './session-motion';

export type AccountMenuProps = { email?: string; avatarUrl?: string; displayName?: string; showAdmin?: boolean; adminPage?: boolean };

export function AccountMenu({ email, avatarUrl, displayName, showAdmin, adminPage }: AccountMenuProps) {
  const panel = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState(signOut, {});
  useEffect(() => { if (state.ok) { panel.current?.close(); void finishAuthNavigation('/', 'logout'); } },[state]);
  const titleId = useId();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [brokenAvatar, setBrokenAvatar] = useState<string | null>(null);
  const safeAvatar = typeof avatarUrl === 'string' && /^https?:\/\//i.test(avatarUrl) ? avatarUrl : undefined;
  const name = (typeof displayName === 'string' && displayName.trim()) || email || '你';
  const initial = Array.from(name)[0].toLocaleUpperCase();

  return <div className="account-menu">
    <button type="button" className="account-trigger header-control" title="账户" aria-haspopup="dialog" aria-label="账户菜单" aria-expanded={open} aria-controls={panelId}
      onClick={event => {
        event.currentTarget.focus({ preventScroll: true });
        panel.current?.showModal();
        setOpen(true);
      }}>
      <span className="account-avatar" aria-hidden="true">
        {safeAvatar && brokenAvatar !== safeAvatar ? <img src={safeAvatar} alt="" referrerPolicy="no-referrer"
          onError={() => setBrokenAvatar(safeAvatar)}/> : initial}
      </span>
    </button>
    <dialog id={panelId} ref={panel} onClose={() => setOpen(false)} className="account-panel" aria-labelledby={titleId}
      onClick={event => { if (event.target === event.currentTarget) panel.current?.close(); }}>
      <div className="account-panel-content">
        <div className="account-panel-header">
          <h2 id={titleId}><AiSignal size={19}/>账户</h2>
          <button type="button" className="icon-button" aria-label="关闭账户菜单" onClick={() => panel.current?.close()}>
            <Icon name="close" size={19}/>
          </button>
        </div>
        {email && <p className="account-email">{email}</p>}
        <Link className="account-action" href="/manage" onClick={()=>panel.current?.close()}>内容管理</Link>
        {showAdmin && <Link className="account-action" href="/settings" aria-current={adminPage ? 'page' : undefined}
          onClick={() => panel.current?.close()}>站点管理</Link>}
        <form action={action}>
          <button type="submit" className="account-action" disabled={pending || state.ok}>{state.ok ? '已退出 ✓' : pending ? '正在退出…' : '退出登录'}</button>
        </form>
        {state.error && <p className="error" role="alert">{state.error}</p>}
      </div>
    </dialog>
  </div>;
}
