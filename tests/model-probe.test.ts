import { describe, expect, it } from 'vitest';
import { messageShowsThinking, probeModelCapabilities } from '../src/config/modelProbe.ts';
import { probedCapabilities, reasoningEffortParam, supportsTemperature } from '../src/config/engineCapabilities.ts';
import type { LlmConfig } from '../src/types.ts';

const llm: LlmConfig = {
  provider: 'openai-compatible',
  engine: 'albert',
  model: 'deepseek-v4-flash',
  apiKey: 'k',
  baseUrl: 'https://llm.example/v1',
  temperature: 0.1,
  timeoutMs: 1000,
};

type Body = Record<string, unknown>;

/** A fake provider: `respond` decides each answer from the request body. */
function fakeFetch(respond: (body: Body) => { status: number; json?: unknown; text?: string }) {
  const calls: Body[] = [];
  const impl = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Body;
    calls.push(body);
    const answer = respond(body);
    const text = answer.text ?? JSON.stringify(answer.json ?? {});
    return new Response(text, { status: answer.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const okMessage = (message: Body) => ({ status: 200, json: { choices: [{ message }] } });

describe('probeModelCapabilities', () => {
  it('records a thinking model that refuses a named tool_choice but accepts auto', async () => {
    const { impl } = fakeFetch((body) => {
      if (typeof body.tool_choice === 'object') {
        return { status: 400, text: '{"error":{"message":"Thinking mode does not support this tool_choice"}}' };
      }
      return okMessage({ content: 'OK', reasoning_content: 'The user wants OK.' });
    });
    const result = await probeModelCapabilities(llm, impl);
    expect(result).toEqual({
      capabilities: { model: 'deepseek-v4-flash', temperature: true, thinking: true, reasoningEffort: true, toolChoice: 'auto' },
      toolCallingUnsupported: false,
      recommendedReasoningEffort: 'low',
    });
  });

  it('records a refused temperature and still measures the rest without it', async () => {
    const { impl, calls } = fakeFetch((body) => {
      if ('temperature' in body) return { status: 400, text: 'Unsupported value: temperature' };
      return okMessage({ content: 'OK' });
    });
    const result = await probeModelCapabilities(llm, impl);
    expect(result.capabilities).toEqual({ model: 'deepseek-v4-flash', temperature: false, thinking: false, reasoningEffort: true, toolChoice: 'named' });
    // A model that refuses temperature is a reasoning model: it gets the default effort.
    expect(result.recommendedReasoningEffort).toBe('low');
    // Once refused, the temperature is never sent again.
    expect(calls.slice(1).every((call) => !('temperature' in call))).toBe(true);
  });

  it('flags a model that refuses tool calling altogether', async () => {
    const { impl } = fakeFetch((body) => (body.tools
      ? { status: 400, text: '{"error":{"message":"Function tools with reasoning_effort are not supported"}}' }
      : okMessage({ content: 'OK' })));
    const result = await probeModelCapabilities(llm, impl);
    expect(result.toolCallingUnsupported).toBe(true);
    expect(result.toolCallingRefusal).toBe('Function tools with reasoning_effort are not supported');
    expect(result.capabilities.toolChoice).toBeUndefined();
  });

  it('reports an unreachable provider as a failure, not as a verdict', async () => {
    const { impl } = fakeFetch(() => ({ status: 503, text: 'busy' }));
    const result = await probeModelCapabilities(llm, impl);
    expect(result.failure).toContain('HTTP 503');
    expect(result.capabilities).toEqual({ model: 'deepseek-v4-flash' });
  });
});

describe('reasoning effort', () => {
  const thinking = () => okMessage({ content: 'OK', reasoning_content: 'The user wants OK.' });

  it('recommends low for a reasoning model configured without an effort', async () => {
    const { impl, calls } = fakeFetch(thinking);
    const result = await probeModelCapabilities(llm, impl);
    expect(result.recommendedReasoningEffort).toBe('low');
    expect(result.capabilities.reasoningEffort).toBe(true);
    // Tools are then measured with the effort that will be written.
    expect(calls.filter((call) => call.tools).every((call) => call.reasoning_effort === 'low')).toBe(true);
  });

  it('recommends nothing when the reasoning model refuses reasoning_effort', async () => {
    const { impl, calls } = fakeFetch((body) => ('reasoning_effort' in body
      ? { status: 400, text: 'Unrecognized request argument supplied: reasoning_effort' }
      : thinking()));
    const result = await probeModelCapabilities(llm, impl);
    expect(result.recommendedReasoningEffort).toBeUndefined();
    expect(result.capabilities).toMatchObject({ thinking: true, reasoningEffort: false, toolChoice: 'named' });
    expect(calls.filter((call) => call.tools).every((call) => !('reasoning_effort' in call))).toBe(true);
  });

  it('never second-guesses an effort the user wrote, nor probes one for a non-reasoning model', async () => {
    const written = fakeFetch(thinking);
    const kept = await probeModelCapabilities({ ...llm, reasoningEffort: 'high' }, written.impl);
    expect(kept.recommendedReasoningEffort).toBeUndefined();
    expect(written.calls.every((call) => call.reasoning_effort === 'high')).toBe(true);

    const plain = fakeFetch(() => okMessage({ content: 'OK' }));
    const none = await probeModelCapabilities(llm, plain.impl);
    expect(none.recommendedReasoningEffort).toBeUndefined();
    expect(plain.calls.every((call) => !('reasoning_effort' in call))).toBe(true);
  });

  it('recommends the lowest effort that makes tool calling work', async () => {
    const { impl, calls } = fakeFetch((body) => {
      if (body.tools && body.reasoning_effort !== 'none') {
        return { status: 400, text: '{"error":{"message":"Function tools with reasoning_effort are not supported for gpt-6-luna. Set reasoning_effort to \'none\'."}}' };
      }
      return okMessage({ content: 'OK' });
    });
    const result = await probeModelCapabilities({ ...llm, model: 'gpt-6-luna' }, impl);
    expect(result.toolCallingUnsupported).toBe(false);
    expect(result.recommendedReasoningEffort).toBe('none');
    expect(result.capabilities).toMatchObject({ reasoningEffort: true, toolChoice: 'named' });
    // The forced tool choice is measured with the effort that made tools work.
    expect(calls.at(-1)?.reasoning_effort).toBe('none');
  });

  it('records a refused reasoning_effort and measures the rest without it', async () => {
    const { impl, calls } = fakeFetch((body) => ('reasoning_effort' in body
      ? { status: 400, text: 'Unrecognized request argument supplied: reasoning_effort' }
      : okMessage({ content: 'OK' })));
    const result = await probeModelCapabilities({ ...llm, reasoningEffort: 'low' }, impl);
    expect(result.capabilities).toMatchObject({ reasoningEffort: false, toolChoice: 'named' });
    expect(calls.slice(1).every((call) => !('reasoning_effort' in call))).toBe(true);
  });

  it('is never sent once measured as refused', () => {
    expect(reasoningEffortParam({ ...llm, reasoningEffort: 'minimal' })).toBe('minimal');
    expect(reasoningEffortParam({ ...llm, reasoningEffort: 'minimal', capabilities: { model: llm.model, reasoningEffort: false } })).toBeUndefined();
  });
});

describe('recorded capabilities', () => {
  it('override the static temperature rule only for the model they were measured on', () => {
    const recorded = { ...llm, capabilities: { model: 'deepseek-v4-flash', temperature: false } };
    expect(supportsTemperature(recorded)).toBe(false);
    const otherModel = { ...recorded, model: 'mistral-small' };
    expect(probedCapabilities(otherModel)).toBeUndefined();
    expect(supportsTemperature(otherModel)).toBe(true);
  });

  it('detect thinking from reasoning fields or an inline think block', () => {
    expect(messageShowsThinking({ content: 'OK', reasoning: 'hmm' })).toBe(true);
    expect(messageShowsThinking({ content: '<think>x</think>OK' })).toBe(true);
    expect(messageShowsThinking({ content: 'OK', reasoning_content: '' })).toBe(false);
  });
});
