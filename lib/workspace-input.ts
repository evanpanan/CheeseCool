export function workspaceIntent(input: string): { kind: 'save' | 'search'; value: string } {
  const value = input.trim();
  if (/https?:\/\//i.test(value)) return { kind: 'save', value };
  // Browsers and share sheets sometimes omit the scheme.
  if (/^(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#][^\s]*)?$/i.test(value)) {
    return { kind: 'save', value: 'https://' + value };
  }
  return { kind: 'search', value };
}
