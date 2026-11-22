export function isAiAdmin(userId: string) {
  return (process.env.AI_ADMIN_USER_IDS ?? '').split(',')
    .some(id => id.trim().toLowerCase() === userId.toLowerCase() && id.trim() !== '');
}
