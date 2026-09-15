import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { handleChatHistoryApi } from '../src/serve/routes/chatHistoryRoutes.ts';

let root: string;

interface CallResult {
  status: number;
  body: unknown;
}

async function call(
  method: string,
  urlPath: string,
  body = '',
): Promise<CallResult> {
  let status = 0;
  let text = '';
  const res = {
    writeHead: (s: number) => {
      status = s;
    },
    end: (c?: string) => {
      text = c ?? '';
    },
  };
  await handleChatHistoryApi(
    root,
    { method } as never,
    res,
    urlPath,
    async () => body,
    (_res, s, data) => {
      status = s;
      text = JSON.stringify(data);
    },
  );
  return { status, body: text ? JSON.parse(text) : null };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'chat-history-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('chat history rename', () => {
  it('renames a conversation without touching its messages', async () => {
    const created = await call(
      'POST',
      '/api/chat/history',
      JSON.stringify({
        id: 'conv_abcdef',
        title: 'Auto title',
        messages: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'hi' },
        ],
      }),
    );
    expect(created.status).toBe(201);
    expect((created.body as { customTitle?: boolean }).customTitle).toBe(false);

    const renamed = await call(
      'PATCH',
      '/api/chat/history/conv_abcdef',
      JSON.stringify({ title: 'Rapport réseau' }),
    );
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({
      id: 'conv_abcdef',
      title: 'Rapport réseau',
      customTitle: true,
      messageCount: 2,
    });

    const fetched = await call('GET', '/api/chat/history/conv_abcdef');
    expect(fetched.status).toBe(200);
    expect(fetched.body).toMatchObject({
      title: 'Rapport réseau',
      customTitle: true,
      messageCount: 2,
    });
    expect((fetched.body as { messages: unknown[] }).messages).toHaveLength(2);

    const index = await call('GET', '/api/chat/history');
    expect(index.body).toMatchObject([
      { id: 'conv_abcdef', title: 'Rapport réseau', customTitle: true, messageCount: 2 },
    ]);
  });

  it('keeps a renamed title when the full conversation is saved again', async () => {
    await call(
      'POST',
      '/api/chat/history',
      JSON.stringify({ id: 'conv_abcdef', title: 'Auto title', messages: [{ role: 'user', content: 'x' }] }),
    );
    await call('PATCH', '/api/chat/history/conv_abcdef', JSON.stringify({ title: 'Keep me' }));

    await call(
      'PUT',
      '/api/chat/history/conv_abcdef',
      JSON.stringify({
        id: 'conv_abcdef',
        title: 'Keep me',
        customTitle: true,
        messages: [
          { role: 'user', content: 'x' },
          { role: 'assistant', content: 'y' },
        ],
      }),
    );

    const fetched = await call('GET', '/api/chat/history/conv_abcdef');
    expect(fetched.body).toMatchObject({ title: 'Keep me', customTitle: true, messageCount: 2 });
  });

  it('refuses an empty title and an unknown conversation', async () => {
    await call(
      'POST',
      '/api/chat/history',
      JSON.stringify({ id: 'conv_abcdef', title: 'T', messages: [] }),
    );
    expect((await call('PATCH', '/api/chat/history/conv_abcdef', JSON.stringify({ title: '  ' }))).status).toBe(400);
    expect((await call('PATCH', '/api/chat/history/conv_zzzzzz', JSON.stringify({ title: 'x' }))).status).toBe(404);
  });
});
