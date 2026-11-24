/** A display alias only. Never replaces the archived title or search text. */
export function displayTitle(title: string, recordType = 'web', platform = 'web', tags: string[] = []): string {
  const clean = title.replace(/\s+/gu, ' ').trim();
  if (recordType !== 'web') return clean;
  if(platform==='x'&&Array.from(clean).length>26){const phrase=clean.split(/[，,。！？!?；;\n]/u)[0].trim();return Array.from(phrase).length>=4&&Array.from(phrase).length<=22?phrase:(tags[0]&&Array.from(tags[0]).length<=12?tags[0]+' · 推文':'X · 推文');}
  // Site taglines often follow a spaced dash or pipe. Keep the leading name or
  // article heading; unspaced hyphens inside names and dates are meaningful.
  const leading = clean.split(/\s*[|｜]\s*|\s+[—–·]\s+|\s+-\s+/u)[0].trim();
  return Array.from(leading).length >= 3 ? leading : clean;
}
