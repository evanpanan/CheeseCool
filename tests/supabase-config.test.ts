import test from 'node:test';
import assert from 'node:assert/strict';
import {supabaseConfig} from '../lib/supabase-config';
test('user sessions support both Supabase public key conventions consistently',()=>{
 const url='https://project.supabase.co';
 assert.deepEqual(supabaseConfig({NEXT_PUBLIC_SUPABASE_URL:url,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'publishable'}),{url,key:'publishable'});
 assert.deepEqual(supabaseConfig({NEXT_PUBLIC_SUPABASE_URL:' '+url+'\n',NEXT_PUBLIC_SUPABASE_ANON_KEY:' legacy\n'}),{url,key:'legacy'});
 assert.deepEqual(supabaseConfig({NEXT_PUBLIC_SUPABASE_URL:url,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'preferred',NEXT_PUBLIC_SUPABASE_ANON_KEY:'legacy'}),{url,key:'preferred'});
 assert.equal(supabaseConfig({NEXT_PUBLIC_SUPABASE_URL:url,SUPABASE_SECRET_KEY:'secret',SUPABASE_SERVICE_ROLE_KEY:'service'}),null);
 assert.equal(supabaseConfig({NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'publishable'}),null);
});
