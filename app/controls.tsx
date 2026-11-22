'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { retryBookmark, saveBookmark, signIn } from './actions';
import { Icon } from './icons';

export function AddBookmark() {
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const composer = form.current;
    if (!composer) return;
    const viewport = window.visualViewport;
    const page = composer.closest<HTMLElement>('.capture-page');
    const mobile = window.matchMedia('(max-width: 650px), (max-width: 960px) and (pointer: coarse)');
    const update = () => {
      const inset = viewport && mobile.matches && viewport.scale === 1
        ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
        : 0;
      page?.style.setProperty('--keyboard-inset', `${inset}px`);
    };
    update();
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    if (mobile.matches && document.activeElement === document.body) {
      input.current?.focus({ preventScroll: true });
    }
    return () => {
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  const [value, setValue] = useState('');
  const [state, action, pending] = useActionState(saveBookmark, {});
  useEffect(() => {
    if (state.ok) setValue('');
  }, [state]);

  return <form ref={form} action={action} className="capture-form" data-pending={pending}>
    <div className="capture-field">
      <Icon name="link" size={20}/>
      <input ref={input} id="capture-url" autoFocus name="url" aria-label="链接或分享文字"
        autoCapitalize="off" autoComplete="off" autoCorrect="off" spellCheck={false}
        enterKeyHint="done" placeholder="粘贴链接或分享文字…" required maxLength={8000}
        value={value} readOnly={pending} onChange={event => setValue(event.target.value)}/>
      <button className="primary add-button" type="submit" aria-label="收藏链接" title="收藏链接" disabled={pending}>
        {pending ? <span className="capture-progress" aria-hidden="true"><i/><i/><i/></span> : <Icon name="plus" size={23}/>}
      </button>
    </div>
    <p className="capture-status" role="status">{pending ? '正在保存…' : state.ok && !value ? '已收藏' : ''}</p>
    {!pending && state.error && <p className="error" role="alert">{state.error}</p>}
  </form>;
}

export function Retry({ id }: { id: string }) {
  const [state, action, pending] = useActionState(retryBookmark, {});
  return <form action={action}>
    <input type="hidden" name="id" value={id}/>
    <button className="text-button" disabled={pending}>{pending ? '处理中…' : '重试处理'}</button>
    {state.error && <p className="error" role="alert">{state.error}</p>}
  </form>;
}

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, {});
  const [email, setEmail] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  return <form action={action} className="login-form">
    <label htmlFor="email">邮箱</label>
    <input id="email" name="email" type="email" autoComplete="username" autoCapitalize="none"
      enterKeyHint="next" spellCheck={false} required value={email}
      onChange={event => setEmail(event.target.value)}/>
    <label htmlFor="password">密码</label>
    <div className="password-field">
      <input id="password" name="password" type={showPassword ? 'text' : 'password'}
        autoComplete="current-password" autoCapitalize="none" spellCheck={false} enterKeyHint="go" required/>
      <button type="button" aria-controls="password" onClick={() => setShowPassword(value => !value)}>
        {showPassword ? '隐藏' : '显示'}
      </button>
    </div>
    {state.error && <p className="error" role="alert">{state.error}</p>}
    <button className="primary form-submit" disabled={pending}>{pending ? '登录中…' : '登录'}</button>
  </form>;
}
