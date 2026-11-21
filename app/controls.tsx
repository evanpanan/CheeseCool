'use client';

import { useActionState, useEffect, useState } from 'react';
import { retryBookmark, saveBookmark, signIn } from './actions';
import { Icon } from './icons';

export function AddBookmark() {
  const [value, setValue] = useState('');
  const [state, action, pending] = useActionState(saveBookmark, {});
  useEffect(() => {
    if (state.ok) setValue('');
  }, [state]);

  return <form action={action} className="capture-form" data-pending={pending}>
    <div className="capture-field">
      <Icon name="link" size={20}/>
      <input id="capture-url" name="url" aria-label="链接或分享文字"
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
  return <form action={action} className="login-form">
    <label htmlFor="email">邮箱</label>
    <input id="email" name="email" type="email" autoComplete="username" required placeholder="you@example.com"/>
    <label htmlFor="password">密码</label>
    <input id="password" name="password" type="password" autoComplete="current-password" required/>
    {state.error && <p className="error" role="alert">{state.error}</p>}
    <button className="primary form-submit" disabled={pending}>{pending ? '登录中…' : '登录 CheeseCool'}</button>
  </form>;
}
