/** Public client credentials only. Never use service-role/secret keys for user sessions. */
export function supabaseConfig(env:Record<string,string|undefined>=process.env) {
  const url=env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key=env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return url && key?{url,key}:null;
}
