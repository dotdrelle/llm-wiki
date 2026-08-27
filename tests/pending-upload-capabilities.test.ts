import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PENDING_CONVERTIBLE_EXTENSIONS,
  PENDING_MARKDOWN_EXTENSIONS,
  pendingUploadCapabilities,
} from '../src/serve/routes/uploadRoutes.ts';
import { WIKI_LAYOUT_SCRIPT } from '../src/serve/html/wikiLayoutScript.ts';

/*
 The Pending panel used to accept Markdown and nothing else. It now also takes
 the formats the documents agent can convert — and only while that agent is
 actually answering, because a drop it cannot convert would leave the user with
 a file that never reaches raw/untracked and a panel that says nothing.

 "Configured" and "not answering" are two different refusals and must stay two
 different sentences: the first is a deployment that never wired the agent, the
 second is a container that is down right now.
*/

// postMcp reads response.text() and parses the JSON-RPC envelope itself. A mock
// that only implements .json() returns an empty body, the tool result parses to
// {}, and the code falls back to its "older agent" branch — which happens to
// look like a pass. That is how a first version of this file went green while
// asserting nothing; the envelope is reproduced faithfully here.
function endpointFetch(handler: (name: string) => unknown) {
  return async (_url: string, init: { body?: string }) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const name = (body?.params as { name?: string } | undefined)?.name ?? '';
    const payload = handler(name);
    if (payload instanceof Error) throw payload;
    const envelope = JSON.stringify({
      jsonrpc: '2.0',
      id: body?.id ?? 1,
      result: { content: [{ type: 'text', text: JSON.stringify(payload) }] },
    });
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => envelope,
    } as unknown as Response;
  };
}

const documentsEndpoint = { name: 'documents', url: 'http://documents.invalid/mcp', headers: {} };

describe('Pending upload capabilities', () => {
  it('offers no conversion when the documents agent is not configured', async () => {
    const caps = await pendingUploadCapabilities({ externalMcpEndpoints: [], version: '0' });
    expect(caps.markdown).toEqual(PENDING_MARKDOWN_EXTENSIONS);
    expect(caps.convertible).toEqual([]);
    expect(caps.documents).toEqual({ configured: false, up: false, reason: 'documents MCP endpoint is not configured' });
  });

  it('offers the policy formats the running agent declares', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = endpointFetch(() => ({
      ok: true,
      supportedExtensions: ['.pdf', '.txt', '.png', '.docx'],
    })) as typeof fetch;
    try {
      const caps = await pendingUploadCapabilities({ externalMcpEndpoints: [documentsEndpoint], version: '0' });
      expect(caps.documents.up).toBe(true);
      expect(caps.convertible).toEqual(PENDING_CONVERTIBLE_EXTENSIONS);
      // The agent converts images and Office formats too; the panel does not
      // promise them, and a drop must not silently become an OCR run.
      expect(caps.convertible).not.toContain('.png');
      expect(caps.convertible).not.toContain('.docx');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('never offers a format the running agent does not declare', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = endpointFetch(() => ({ ok: true, supportedExtensions: ['.txt'] })) as typeof fetch;
    try {
      const caps = await pendingUploadCapabilities({ externalMcpEndpoints: [documentsEndpoint], version: '0' });
      expect(caps.convertible).toEqual(['.txt']);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('refuses every conversion, with a reason, when the agent is down', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error('fetch failed: ECONNREFUSED'); }) as typeof fetch;
    try {
      const caps = await pendingUploadCapabilities({ externalMcpEndpoints: [documentsEndpoint], version: '0' });
      expect(caps.convertible).toEqual([]);
      expect(caps.documents.configured).toBe(true);
      expect(caps.documents.up).toBe(false);
      expect(caps.documents.reason).toBe('documents agent is not answering');
      // Markdown must survive a dead agent: it never needed conversion.
      expect(caps.markdown).toEqual(PENDING_MARKDOWN_EXTENSIONS);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('Pending drop handler', () => {
  it('asks for capabilities on every drop rather than caching them at load', () => {
    expect(WIKI_LAYOUT_SCRIPT).toContain("fetch('/api/uploads/capabilities')");
    const dropHandler = WIKI_LAYOUT_SCRIPT.slice(WIKI_LAYOUT_SCRIPT.indexOf("document.addEventListener('drop'"));
    expect(dropHandler).toContain('await refreshPendingCapabilities()');
  });

  it('routes a convertible file through the upload endpoint, not the file writer', () => {
    expect(WIKI_LAYOUT_SCRIPT).toContain("fetch('/api/upload'");
    // A conversion the agent left as 'stored' is a failure, not a success:
    // nothing was written to raw/untracked.
    expect(WIKI_LAYOUT_SCRIPT).toContain("upload.status !== 'converted'");
  });
});
