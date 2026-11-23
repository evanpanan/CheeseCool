import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { POST } from '../app/auth/session/route';
import { GET } from '../app/auth/callback/route';
function request(operation:string, origin='https://cheesecool.test', provider='google') {
  const form=new FormData();form.set('operation',operation);form.set('provider',provider);
  return new NextRequest('https://cheesecool.test/auth/session',{method:'POST',headers:{origin},body:form});
}
test('account mutations reject requests from another origin',async()=>{
  const response=await POST(request('logout','https://other.test'));
  assert.equal(response.status,403);
  assert.ok((await response.json()).error);
});
test('unknown account operations are rejected',async()=>{
  const response=await POST(request('unknown'));
  assert.equal(response.status,400);
});
test('missing account configuration returns recoverable errors without a session',async()=>{
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  try {
    for(const operation of ['oauth','logout']) {
      const result=await (await POST(request(operation))).json();
      assert.ok(result.error);assert.equal(result.ok,undefined);assert.equal(result.redirectTo,undefined);
    }
    const callback=await GET(new NextRequest('https://cheesecool.test/auth/callback?code=expired&next=//other.test'));
    assert.match(callback.headers.get('location')!,/\/login\?error=callback$/);
    assert.equal(callback.headers.get('set-cookie'),null);
  } finally {
    if(url!==undefined)process.env.NEXT_PUBLIC_SUPABASE_URL=url;
    if(key!==undefined)process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=key;
    if(anon!==undefined)process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY=anon;
  }
});

test('email registration, password login and unsupported OAuth providers are unavailable',async()=>{
  for(const operation of ['email','register','google'])assert.equal((await POST(request(operation))).status,400);
  for(const provider of ['google','github']) {
    const result=await (await POST(request('oauth',undefined,provider))).json();
    assert.match(result.error,new RegExp(provider==='google'?'Google':'GitHub'));
  }
  const result=await (await POST(request('oauth',undefined,'discord'))).json();
  assert.match(result.error,/Google 或 GitHub/);assert.equal(result.redirectTo,undefined);
});
