import type { IncomingMessage } from 'node:http';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathExists, safeWriteFile } from '../../utils/fs.ts';

const CHAT_HISTORY_DIR = path.join('.wiki', 'chat-history');
const CHAT_HISTORY_INDEX = 'index.json';

type ChatHistorySummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  toolCallCount: number;
};

type ChatConversation = ChatHistorySummary & Record<string, unknown>;

function chatHistoryDir(rootDir: string): string {
  return path.join(rootDir, CHAT_HISTORY_DIR);
}

function chatHistoryIndexPath(rootDir: string): string {
  return path.join(chatHistoryDir(rootDir), CHAT_HISTORY_INDEX);
}

function assertChatId(id: string): string {
  if (!/^[a-zA-Z0-9_-]{6,80}$/.test(id)) {
    throw new Error('INVALID_CHAT_ID');
  }
  return id;
}

function chatConversationPath(rootDir: string, id: string): string {
  return path.join(chatHistoryDir(rootDir), `${assertChatId(id)}.json`);
}

function summarizeConversation(conversation: ChatConversation): ChatHistorySummary {
  return {
    id: String(conversation.id),
    title: String(conversation.title || 'Nouvelle discussion'),
    createdAt: String(conversation.createdAt || new Date().toISOString()),
    updatedAt: String(conversation.updatedAt || new Date().toISOString()),
    messageCount: Number(conversation.messageCount || 0),
    toolCallCount: Number(conversation.toolCallCount || 0),
  };
}

async function readChatHistoryIndex(rootDir: string): Promise<ChatHistorySummary[]> {
  const indexPath = chatHistoryIndexPath(rootDir);
  if (!(await pathExists(indexPath))) return [];
  try {
    const data = JSON.parse(await readFile(indexPath, 'utf8')) as unknown;
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (item): item is ChatHistorySummary =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as ChatHistorySummary).id === 'string',
      )
      .map(summarizeConversation)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

async function writeChatHistoryIndex(
  rootDir: string,
  summaries: ChatHistorySummary[],
): Promise<void> {
  await mkdir(chatHistoryDir(rootDir), { recursive: true });
  const deduped = new Map<string, ChatHistorySummary>();
  for (const summary of summaries) deduped.set(summary.id, summary);
  const sorted = [...deduped.values()].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  await safeWriteFile(
    chatHistoryIndexPath(rootDir),
    `${JSON.stringify(sorted, null, 2)}\n`,
  );
}

function countToolCalls(messages: unknown): number {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((count, message) => {
    if (!message || typeof message !== 'object') return count;
    const msg = message as { role?: string; tool_calls?: unknown };
    const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls.length : 0;
    return count + calls + (msg.role === 'tool' ? 1 : 0);
  }, 0);
}

function normalizeConversationPayload(
  raw: string,
  existing?: ChatConversation,
): ChatConversation {
  const parsed = JSON.parse(raw || '{}') as Record<string, unknown>;
  const now = new Date().toISOString();
  const id = assertChatId(String(parsed.id || existing?.id || `conv_${Date.now()}`));
  const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
  return {
    ...existing,
    ...parsed,
    id,
    title: String(parsed.title || existing?.title || 'Nouvelle discussion').slice(0, 120),
    createdAt: String(parsed.createdAt || existing?.createdAt || now),
    updatedAt: String(parsed.updatedAt || now),
    messageCount: messages.length,
    toolCallCount: countToolCalls(messages),
  };
}

async function readConversation(
  rootDir: string,
  id: string,
): Promise<ChatConversation | null> {
  const conversationPath = chatConversationPath(rootDir, id);
  if (!(await pathExists(conversationPath))) return null;
  return JSON.parse(await readFile(conversationPath, 'utf8')) as ChatConversation;
}

async function upsertConversation(
  rootDir: string,
  rawBody: string,
  existing?: ChatConversation,
): Promise<ChatConversation> {
  const conversation = normalizeConversationPayload(rawBody, existing);
  await mkdir(chatHistoryDir(rootDir), { recursive: true });
  await safeWriteFile(
    chatConversationPath(rootDir, conversation.id),
    `${JSON.stringify(conversation, null, 2)}\n`,
  );
  const summaries = await readChatHistoryIndex(rootDir);
  await writeChatHistoryIndex(rootDir, [
    summarizeConversation(conversation),
    ...summaries.filter((item) => item.id !== conversation.id),
  ]);
  return conversation;
}

export async function handleChatHistoryApi(
  rootDir: string,
  req: IncomingMessage,
  res: {
    writeHead: (s: number, h: Record<string, string>) => void;
    end: (c?: string) => void;
  },
  urlPath: string,
  readRequestBody: (req: IncomingMessage) => Promise<string>,
  sendJson: (
    res: { writeHead: (s: number, h: Record<string, string>) => void; end: (c?: string) => void },
    status: number,
    data: unknown,
  ) => void,
): Promise<boolean> {
  if (!urlPath.startsWith('/api/chat/history')) return false;
  try {
    const id = urlPath.replace(/^\/api\/chat\/history\/?/, '').replace(/\/+$/, '');
    if (!id) {
      if (req.method === 'GET') {
        sendJson(res, 200, await readChatHistoryIndex(rootDir));
        return true;
      }
      if (req.method === 'POST') {
        const conversation = await upsertConversation(
          rootDir,
          await readRequestBody(req),
        );
        sendJson(res, 201, summarizeConversation(conversation));
        return true;
      }
    } else {
      assertChatId(id);
      if (req.method === 'GET') {
        const conversation = await readConversation(rootDir, id);
        if (!conversation) {
          sendJson(res, 404, { error: 'Conversation not found' });
          return true;
        }
        sendJson(res, 200, conversation);
        return true;
      }
      if (req.method === 'PUT') {
        const existing = await readConversation(rootDir, id);
        const conversation = await upsertConversation(
          rootDir,
          await readRequestBody(req),
          existing ?? ({ id } as ChatConversation),
        );
        sendJson(res, 200, summarizeConversation(conversation));
        return true;
      }
      if (req.method === 'DELETE') {
        await rm(chatConversationPath(rootDir, id), { force: true });
        const summaries = await readChatHistoryIndex(rootDir);
        await writeChatHistoryIndex(
          rootDir,
          summaries.filter((item) => item.id !== id),
        );
        sendJson(res, 200, { ok: true });
        return true;
      }
    }
    sendJson(res, 405, { error: 'Method not allowed' });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, message === 'INVALID_CHAT_ID' ? 400 : 500, { error: message });
    return true;
  }
}


