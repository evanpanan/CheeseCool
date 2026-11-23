import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import {supabaseConfig} from './supabase-config';
export {supabaseConfig} from './supabase-config';

export async function database() {
  const config = supabaseConfig();
  if (!config) throw new Error('请配置 Supabase。');
  const store = await cookies();
  return createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values) => {
        try { for (const { name, value, options } of values) store.set(name, value, options); }
        catch { /* The proxy refreshes cookies for server components. */ }
      },
    },
  });
}


export function serviceDatabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });
}
