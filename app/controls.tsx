'use client';

import { useActionState } from 'react';
import { retryBookmark } from './actions';
import { AiSignal } from './ai-signal';

export function Retry({ id }: { id: string }) {
  const [state, action, pending] = useActionState(retryBookmark, {});
  return <form action={action}>
    <input type="hidden" name="id" value={id}/>
    <button className="text-button retry-action" disabled={pending}>{pending && <AiSignal state="thinking" size={16}/>} {pending ? '正在重试…' : '再试一次'}</button>
    {state.error && <p className="error" role="alert">{state.error}</p>}
  </form>;
}

export { AuthForm as LoginForm } from './auth/auth-form';
