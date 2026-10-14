import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { proxyRuntimeEvents } from '../src/serve/sse/runtimeEvents.ts';

describe('runtime events proxy', () => {
  it('ends a silent upstream so the browser reconnects instead of waiting forever', async () => {
    // An upstream that opens the stream, sends one frame, then goes silent —
    // what a socket left half-open by a sleep looks like.
    const upstream = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('event: state\ndata: {}\n\n');
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const { port } = upstream.address() as AddressInfo;
    const req = new EventEmitter() as unknown as IncomingMessage;
    const chunks: string[] = [];
    let ended = false;
    const res: { headersSent: boolean; writeHead: () => void; write: (chunk: Buffer) => boolean; end: () => void } = {
      headersSent: false,
      writeHead() { res.headersSent = true; },
      write(chunk: Buffer) { chunks.push(chunk.toString()); return true; },
      end() { ended = true; },
    };
    try {
      await proxyRuntimeEvents(req, res as unknown as ServerResponse, '/events/stream', {
        runtimeUrl: () => `http://127.0.0.1:${port}`,
        runtimeToken: () => null,
        readRequestBuffer: async () => Buffer.alloc(0),
        sendJson: () => {},
      }, 100);
      expect(chunks.join('')).toContain('event: state');
      expect(ended).toBe(true);
    } finally {
      upstream.closeAllConnections();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });
});
