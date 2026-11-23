import type { AuthState } from './actions';
async function requestSession(operation: string, form = new FormData()): Promise<AuthState> {
  form.set('operation',operation);
  try {
    const response=await fetch('/auth/session',{method:'POST',body:form,credentials:'same-origin',cache:'no-store'});
    const state: AuthState=await response.json();
    if(!response.ok && !state.error) return {error:'暂时无法连接登录服务，请重试。'};
    return state;
  } catch { return {error:'网络连接中断，请检查网络后重试。'}; }
}
export function oauthSignIn(_: AuthState, form: FormData) { return requestSession('oauth',form); }
export function signOut(_: AuthState) { return requestSession('logout'); }
