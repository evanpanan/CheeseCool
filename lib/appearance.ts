export type Appearance = 'light' | 'dark';

export const appearanceKey = 'cheesecool.appearance.v1';
export const appearanceColors = { light: '#f7f8fb', dark: '#111116' } as const;

// In the initial HTML so a returning visitor sees their canvas colour on first paint.
export const appearanceBootstrap = `(() => {
  let mode = 'light';
  try { if (localStorage.getItem(${JSON.stringify(appearanceKey)}) === 'dark') mode = 'dark'; } catch {}
  document.documentElement.dataset.theme = mode;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = mode === 'dark' ? '${appearanceColors.dark}' : '${appearanceColors.light}';
})();`;
