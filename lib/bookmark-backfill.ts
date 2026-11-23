import { after } from 'next/server';
import type { database } from './supabase';
import { processBookmark } from './bookmark-processing';

type Client = Awaited<ReturnType<typeof database>>;

// Claim work in the database so concurrent tabs and refreshes do not repeat API calls.
export async function scheduleBookmarkBackfill(db: Client, wantEmbeddings: boolean) {
  const { data, error } = await db.rpc('claim_bookmark_backfill', { batch_size: 3, want_embeddings: wantEmbeddings });
  if (error || !data?.length) return false;
  after(async () => {
    await Promise.all(data.map(async ({ id }: { id: string }) => {
      try {
        await processBookmark(db, id);
      } catch {
        console.error('Bookmark backfill failed; retry is delayed', { bookmarkId: id });
      }
    }));
  });
  return true;
}
