/** A display alias only. Never replaces the archived title or search text. */
export function displayTitle(title: string, recordType = 'web'): string {
  const clean = title.replace(/\s+/gu, ' ').trim();
  if (recordType !== 'web') return clean;
  // Site taglines often follow a spaced dash or pipe. Keep the leading name or
  // article heading; unspaced hyphens inside names and dates are meaningful.
  const leading = clean.split(/\s*[|｜]\s*|\s+[—–·]\s+|\s+-\s+/u)[0].trim();
  return Array.from(leading).length >= 3 ? leading : clean;
}
