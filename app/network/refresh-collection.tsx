'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function RefreshCollection({ until }: { until: number }) {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    const remaining = until - Date.now();
    if (remaining <= 0) return;
    const interval = window.setInterval(refresh, 3500);
    const timeout = window.setTimeout(() => {
      window.clearInterval(interval);
      refresh();
    }, remaining);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [router, until]);

  return null;
}
