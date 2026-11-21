import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';

test('production migration isolates accounts, deduplicates links and indexes relationships', async () => {
  const db = new PGlite({ extensions: { vector } });
  const alice = '00000000-0000-0000-0000-000000000001';
  const bob = '00000000-0000-0000-0000-000000000002';
  const direction = JSON.stringify([1, ...Array(1535).fill(0)]);
  const far = JSON.stringify([0, 1, ...Array(1534).fill(0)]);
  try {
    await db.exec(`
      create role authenticated;
      create role anon;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
      grant usage on schema auth to authenticated;
      insert into auth.users values ('${alice}'), ('${bob}');
    `);
    await db.exec(await readFile('supabase/migrations/001_second_brain.sql', 'utf8'));
    await db.exec(await readFile('supabase/migrations/002_ai_settings.sql', 'utf8'));
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${alice}';`);

    const insert = async (slug: string, title: string, sourceHash: string) => {
      const url = 'https://example.org/' + slug;
      const { rows } = await db.query<{ id: string }>(`
        insert into public.bookmarks(original_url,canonical_url,platform,title,source_hash)
        values ($1,$1,'web',$2,$3) returning id`, [url, title, sourceHash]);
      return rows[0].id;
    };
    const index = (id: string, hash: string, embedding: string) => db.query(
      "select public.index_bookmark($1,$2,'整理方法',array['知识管理'],$3)", [id, hash, embedding],
    );
    const first = await insert('one', '个人知识库', 'a');
    const second = await insert('two', '网页归档', 'b');
    const unrelated = await insert('three', '烘焙食谱', 'c');
    await assert.rejects(insert('one', '重复收藏', 'duplicate'), /duplicate key/);
    await index(first, 'a', direction);
    await index(second, 'wrong hash', direction);
    assert.equal((await db.query('select * from public.bookmark_edges')).rows.length, 0);
    await index(second, 'b', direction);
    await index(unrelated, 'c', far);
    assert.equal((await db.query('select * from public.bookmark_edges')).rows.length, 1);
    const semantic = await db.query<{ id: string }>("select * from public.search_bookmarks('如何保存读过的材料', $1)", [direction]);
    assert.deepEqual(new Set(semantic.rows.map(row => row.id)), new Set([first, second]));
    const lexical = await db.query<{ id: string }>("select * from public.search_bookmarks('知识库')");
    assert.deepEqual(lexical.rows, [{ id: first }]);

    await db.exec("insert into public.ai_settings(provider, kimi_key) values ('kimi','ciphertext');");
    assert.deepEqual((await db.query('select provider from public.ai_settings')).rows, [{ provider: 'kimi' }]);
    await db.exec(`set request.jwt.claim.sub = '${bob}';`);
    assert.equal((await db.query('select provider, kimi_key from public.ai_settings')).rows.length, 0);
    await assert.rejects(db.query("insert into public.ai_settings(user_id,provider) values ($1,'deepseek')", [alice]), /row-level security/);
    assert.equal((await db.query('select * from public.bookmarks')).rows.length, 0);
    assert.equal((await db.query('select * from public.bookmark_edges')).rows.length, 0);
    assert.equal((await db.query("select * from public.search_bookmarks('知识库',$1)", [direction])).rows.length, 0);
    await insert('one', '独立的一条收藏', 'bob');
  } finally {
    await db.close();
  }
});
