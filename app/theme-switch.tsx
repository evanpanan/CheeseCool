'use client';

import { useSyncExternalStore } from 'react';
import { appearanceColors, appearanceKey, type Appearance } from '@/lib/appearance';

const appearanceEvent = 'cheesecool:appearance';

function currentAppearance(): Appearance {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function applyAppearance(theme: Appearance) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', appearanceColors[theme]);
}

function listen(onChange: () => void) {
  function syncStorage(event: StorageEvent) {
    if (event.key !== appearanceKey && event.key !== null) return;
    applyAppearance(event.newValue === 'dark' ? 'dark' : 'light');
    onChange();
  }

  window.addEventListener(appearanceEvent, onChange);
  window.addEventListener('storage', syncStorage);
  return () => {
    window.removeEventListener(appearanceEvent, onChange);
    window.removeEventListener('storage', syncStorage);
  };
}

const serverAppearance = (): Appearance => 'light';

export function useAppearance(): Appearance {
  return useSyncExternalStore(listen, currentAppearance, serverAppearance);
}

export function ThemeSwitch() {
  const theme = useAppearance();

  function toggleAppearance() {
    const next = currentAppearance() === 'light' ? 'dark' : 'light';
    applyAppearance(next);
    try { localStorage.setItem(appearanceKey, next); } catch { /* The preference still applies in this tab. */ }
    window.dispatchEvent(new Event(appearanceEvent));
  }

  return <button type="button" className="appearance-switch" role="switch" aria-checked={theme === 'dark'}
    aria-label="暗色模式" title={theme === 'dark' ? '切换到浅色模式' : '切换到暗色模式'} onClick={toggleAppearance}>
    <span className="appearance-face appearance-night-action" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none"><path d="M18.7 15.3A8.1 8.1 0 0 1 8.7 5.1a8.2 8.2 0 1 0 10 10.2Z"/><path d="m17.4 3 .7 2.4 2.4.7-2.4.7-.7 2.4-.7-2.4-2.4-.7 2.4-.7Z" fill="currentColor" stroke="none"/></svg>
    </span>
    <span className="appearance-face appearance-light-action" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3.8"/><path d="M12 2.6v2.1m0 14.6v2.1M2.6 12h2.1m14.6 0h2.1M5.4 5.4l1.5 1.5m10.2 10.2 1.5 1.5M5.4 18.6l1.5-1.5M17.1 6.9l1.5-1.5"/></svg>
    </span>
  </button>;
}
