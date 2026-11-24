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
  const trigger = useRef<HTMLButtonElement>(null);
  const [state, action, pending] = useActionState(signOut, {});
  useEffect(() => { if (state.ok) { panel.current?.close(); void finishAuthNavigation('/', 'logout'); } },[state]);
  const titleId = useId();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [brokenAvatar, setBrokenAvatar] = useState<string | null>(null);
  const safeAvatar = typeof avatarUrl === 'string' && /^https?:\/\//i.test(avatarUrl) ? avatarUrl : undefined;
  const profileName = typeof displayName === 'string' ? displayName.trim() : '';
  const name = profileName || email || '你';
  const initial = Array.from(name)[0].toLocaleUpperCase();
  const avatar = safeAvatar && brokenAvatar !== safeAvatar ? <img src={safeAvatar} alt="" referrerPolicy="no-referrer"
    onError={() => setBrokenAvatar(safeAvatar)}/> : initial;
  function positionPanel() {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect || !panel.current) return;
    panel.current.style.setProperty('--account-top', `${Math.max(12, Math.min(rect.bottom + 12, window.innerHeight - 360))}px`);
    panel.current.style.setProperty('--account-right', `${Math.max(16, window.innerWidth - rect.right)}px`);
  }
  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', positionPanel);
    return () => window.removeEventListener('resize', positionPanel);
  }, [open]);

  return <div className="account-menu">
    <button ref={trigger} type="button" className="account-trigger header-control" title="账户" aria-haspopup="dialog" aria-label="账户菜单" aria-expanded={open} aria-controls={panelId}
      onClick={event => {
        event.currentTarget.focus({ preventScroll: true });
        positionPanel();
        panel.current?.showModal();
        panel.current?.querySelector<HTMLElement>('[data-account-heading]')?.focus({ preventScroll: true });
        setOpen(true);
      }}>
      <span className="account-avatar" aria-hidden="true">
        {avatar}
      </span>
    </button>
    <dialog id={panelId} ref={panel} onClose={() => { setOpen(false); trigger.current?.focus({ preventScroll: true }); }} className="account-panel" aria-labelledby={titleId}
      onClick={event => { if (event.target === event.currentTarget) panel.current?.close(); }}>
      <div className="account-panel-content">
        <div className="account-panel-header">
          <h2 id={titleId} data-account-heading tabIndex={-1}><AiSignal size={19}/>账户</h2>
          <button type="button" className="icon-button" aria-label="关闭账户菜单" onClick={() => panel.current?.close()}>
            <Icon name="close" size={19}/>
          </button>
        </div>
        <div className="account-identity">
          <span className="account-profile-avatar" aria-hidden="true">{avatar}</span>
          <div><p className="account-name">{profileName || '我的账户'}</p>
            {email && <p className="account-email">{email}</p>}</div>
        </div>
        <nav className="account-navigation" aria-label="账户管理">
          <Link className="account-action" href="/manage" onClick={()=>panel.current?.close()}>
            <Icon name="archive"/><span>内容管理</span><Icon name="chevron" size={16}/>
          </Link>
          {showAdmin && <Link className="account-action" href="/settings" aria-current={adminPage ? 'page' : undefined}
            onClick={() => panel.current?.close()}><Icon name="adjust"/><span>站点管理</span><Icon name="chevron" size={16}/></Link>}
        </nav>
        <form action={action} className="account-signout">
          <button type="submit" className="account-action" disabled={pending || state.ok}>{state.ok ? '已退出 ✓' : pending ? '正在退出…' : '退出登录'}</button>
        </form>
        {state.error && <p className="error" role="alert">{state.error}</p>}
      </div>
    </dialog>
  </div>;
}
