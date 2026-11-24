'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { signOut } from './auth/client';
import { Icon } from './icons';
import { finishAuthNavigation } from './session-motion';

export type AccountMenuProps = { email?: string; avatarUrl?: string; displayName?: string; showAdmin?: boolean; adminPage?: boolean };

export function AccountMenu({ email, avatarUrl, displayName, showAdmin, adminPage }: AccountMenuProps) {
  const panel = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pointerActivation = useRef(false);
  const surfaceAnimation = useRef<Animation | null>(null);
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

  function animatePanel(entering: boolean) {
    const element = panel.current, button = trigger.current;
    if (!element || !button || typeof element.animate !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    surfaceAnimation.current?.cancel();
    const box = element.getBoundingClientRect(), anchor = button.getBoundingClientRect();
    const x = Math.max(22, Math.min(box.width - 22, anchor.left + anchor.width / 2 - box.left));
    const y = Math.max(22, Math.min(box.height - 22, anchor.top + anchor.height / 2 - box.top));
    const collapsed = `inset(${Math.max(0,y-22)}px ${Math.max(0,box.width-x-22)}px ${Math.max(0,box.height-y-22)}px ${Math.max(0,x-22)}px round 22px)`;
    const frames = [{clipPath:collapsed,opacity:0.3},{clipPath:'inset(0px 0px 0px 0px round 0px)',opacity:1}];
    const animation = element.animate(entering ? frames : [...frames].reverse(), {duration:entering?420:220,easing:entering?'cubic-bezier(.16,1,.3,1)':'cubic-bezier(.4,0,1,1)',fill:'both'});
    surfaceAnimation.current = animation;
    if (entering) {
      animation.finished.then(()=>animation.cancel()).catch(()=>{});
      element.querySelectorAll('.account-identity,.account-navigation,.account-signout').forEach((item,index)=>item.animate([{opacity:0,transform:'translateY(12px)'},{opacity:1,transform:'translateY(0)'}],{duration:300,delay:110+index*45,easing:'cubic-bezier(.2,.8,.2,1)',fill:'backwards'}));
    }
    return animation;
  }
  async function closePanel() {
    const animation = animatePanel(false);
    if (animation) try { await animation.finished; } catch { return; }
    panel.current?.close();animation?.cancel();
  }

  return <div className="account-menu">
    <button ref={trigger} type="button" className="account-trigger header-control" title="账户" aria-haspopup="dialog" aria-label="账户菜单" aria-expanded={open} aria-controls={panelId}
      onPointerDown={() => { pointerActivation.current = true; }}
      onKeyDown={() => { pointerActivation.current = false; }}
      onClick={event => {
        if (!pointerActivation.current) event.currentTarget.focus({ preventScroll: true });
        positionPanel();
        panel.current?.showModal();
        panel.current?.querySelector<HTMLElement>('[data-account-heading]')?.focus({ preventScroll: true });
        setOpen(true);
        animatePanel(true);
      }}>
      <span className="account-avatar" aria-hidden="true">
        {avatar}
      </span>
    </button>
    <dialog id={panelId} ref={panel} onClose={() => { setOpen(false); if (pointerActivation.current) trigger.current?.blur(); else trigger.current?.focus({ preventScroll: true }); }}
      onCancel={event => { event.preventDefault(); void closePanel(); }} className="account-panel" aria-labelledby={titleId}
      onClick={event => { if (event.target === event.currentTarget) void closePanel(); }}>
      <div className="account-panel-content">
        <div className="account-panel-header">
          <h2 id={titleId} data-account-heading tabIndex={-1}>账户</h2>
          <button type="button" className="icon-button" aria-label="关闭账户菜单" onClick={() => void closePanel()}>
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
