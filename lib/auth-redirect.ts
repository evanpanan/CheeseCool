export function safeAuthNext(value: string | null | undefined) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(value)) return '/';
  const target = new URL(value, 'https://auth.local');
  return target.origin === 'https://auth.local' ? target.pathname + target.search + target.hash : '/';
}
