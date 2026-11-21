import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}

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
