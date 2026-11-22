import assert from 'node:assert/strict';
import test from 'node:test';
import { understand } from '../lib/ai';
import { isAiAdmin } from '../lib/ai-admin';
import { encryptKey, resolveAi, type Provider } from '../lib/ai-settings';

test('encrypts site keys and binds ciphertext to its provider', () => {
  const key = Buffer.alloc(32, 9);
  const old = process.env.AI_SETTINGS_ENCRYPTION_KEY;
  process.env.AI_SETTINGS_ENCRYPTION_KEY = key.toString('hex');
  try {
    const ciphertext = encryptKey('site-secret', key, 'kimi');
    const settings = { provider: 'kimi', model: 'example-model', kimi_key: ciphertext } as const;
    assert.notEqual(ciphertext, 'site-secret');
    assert.equal(resolveAi(settings).chat?.key, 'site-secret');
    assert.throws(() => resolveAi({ provider: 'deepseek', model: null, deepseek_key: ciphertext }));
  } finally {
    if (old === undefined) delete process.env.AI_SETTINGS_ENCRYPTION_KEY;
    else process.env.AI_SETTINGS_ENCRYPTION_KEY = old;
  }
});

test('allows only explicitly configured administrator IDs and uses the site fallback', () => {
  const old = { AI_ADMIN_USER_IDS: process.env.AI_ADMIN_USER_IDS, AI_PROVIDER: process.env.AI_PROVIDER, KIMI_API_KEY: process.env.KIMI_API_KEY };
  try {
    process.env.AI_ADMIN_USER_IDS = ' admin-1, admin-2 ';
    assert.equal(isAiAdmin('admin-2'), true);
    assert.equal(isAiAdmin('ordinary-user'), false);
    assert.equal(isAiAdmin(''), false);
    process.env.AI_PROVIDER = 'kimi';
    process.env.KIMI_API_KEY = 'site-kimi';
    assert.deepEqual(resolveAi(null).chat, { provider: 'kimi', key: 'site-kimi', model: process.env.KIMI_CHAT_MODEL || 'kimi-k2.5' });
  } finally {
    for (const [name, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('sends summaries to the selected provider using its request format', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const [provider, model, expected] of [
      ['openai', 'gpt-4o-mini', 'https://api.openai.com/v1/chat/completions'],
      ['kimi', 'kimi-k2.5', 'https://api.moonshot.cn/v1/chat/completions'],
      ['deepseek', 'deepseek-flash', 'https://api.deepseek.com/chat/completions'],
    ] as const) {
      globalThis.fetch = async (url, options) => {
        assert.equal(String(url), expected);
        assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer test-key');
        const payload = JSON.parse(String(options?.body));
        assert.equal(payload.model, model);
        assert.equal(payload.response_format.type, 'json_object');
        assert.equal(payload.max_completion_tokens ?? payload.max_tokens, 750);
        return Response.json({ choices: [{ message: { content: JSON.stringify({ summary: '摘要', tags: ['主题'] }) } }] });
      };
      assert.deepEqual(await understand('标题', '正文', { provider: provider as Provider, key: 'test-key', model }), {
        summary: '摘要', tags: ['主题'],
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
