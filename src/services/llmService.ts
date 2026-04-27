import OpenAI from 'openai';
import type { ChatCompletionChunk, ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { ZodError } from 'zod';
import type { ZodType } from 'zod';
import {
  extractFirstJsonCandidate,
  extractFirstJsonObject,
  repairIncompleteJson,
} from '../utils/json.ts';
import type { AppConfig } from '../types.ts';
import type { TraceLogger } from './traceLogger.ts';

interface CompletionRequest {
  system: string;
  user: string;
  temperature?: number;
  jsonMode?: boolean;
  label?: string;
  logger?: TraceLogger;
  traceData?: Record<string, unknown>;
}

interface ProviderErrorDetails {
  status?: number;
  code?: string;
  type?: string;
  requestId?: string;
  message: string;
}

export class LLMService {
  private readonly client: OpenAI;
  private readonly config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.llm.apiKey,
      baseURL: config.llm.baseUrl,
      timeout: config.llm.timeoutMs,
      defaultHeaders:
        config.llm.provider === 'anthropic'
          ? { 'anthropic-version': '2023-06-01' }
          : undefined,
    });
  }

  private extractProviderErrorDetails(error: unknown): ProviderErrorDetails {
    const candidate = error as {
      status?: unknown;
      code?: unknown;
      type?: unknown;
      requestID?: unknown;
      message?: unknown;
      error?: {
        message?: unknown;
      };
    };

    return {
      status: typeof candidate?.status === 'number' ? candidate.status : undefined,
      code: typeof candidate?.code === 'string' ? candidate.code : undefined,
      type: typeof candidate?.type === 'string' ? candidate.type : undefined,
      requestId:
        typeof candidate?.requestID === 'string' ? candidate.requestID : undefined,
      message:
        typeof candidate?.error?.message === 'string'
          ? candidate.error.message
          : error instanceof Error
            ? error.message
            : typeof candidate?.message === 'string'
              ? candidate.message
              : String(error),
    };
  }

  private normalizeProviderError(error: unknown): Error {
    const details = this.extractProviderErrorDetails(error);
    const lowerMessage = details.message.toLowerCase();
    const providerTarget = `${this.config.llm.provider}/${this.config.llm.model}`;
    const requestSuffix = details.requestId ? ` Request ID: ${details.requestId}.` : '';

    if (
      details.status === 401 ||
      /invalid api key|authentication|unauthorized|forbidden/i.test(details.message)
    ) {
      return new Error(
        `LLM request failed for ${providerTarget}: authentication was rejected. Check llm.apiKey, llm.baseUrl, and the selected provider in .wikirc.yaml.${requestSuffix}`,
        { cause: error instanceof Error ? error : undefined },
      );
    }

    if (
      details.status === 429 ||
      /credit balance is too low|insufficient credits|insufficient quota|quota|billing|rate limit/i.test(
        lowerMessage,
      )
    ) {
      return new Error(
        `LLM request failed for ${providerTarget}: the provider account appears to be out of credits or quota. Refill billing or switch llm.provider/model/baseUrl in .wikirc.yaml.${requestSuffix}`,
        { cause: error instanceof Error ? error : undefined },
      );
    }

    if (details.status === 500 && this.config.llm.provider === 'ollama') {
      return new Error(
        `Ollama returned HTTP 500 for ${providerTarget}: ${details.message}. This usually means the prompt exceeded the active context window or Ollama ran out of memory. Run \`wiki doctor\` to see the effective numCtx and RAM estimate. Then reduce build.slotBatchSize, retrieval.maxContextFiles, or retrieval.maxChunkChars in .wikirc.yaml; if the model supports it and RAM allows it, increase llm.numCtx.${requestSuffix}`,
        { cause: error instanceof Error ? error : undefined },
      );
    }

    if (details.status && details.status >= 400) {
      return new Error(
        `LLM request failed for ${providerTarget} with HTTP ${details.status}: ${details.message}${requestSuffix}`,
        { cause: error instanceof Error ? error : undefined },
      );
    }

    if (error instanceof Error) {
      return error;
    }

    return new Error(details.message);
  }

  async completeText(request: CompletionRequest): Promise<string> {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: request.system },
      { role: 'user', content: request.user },
    ];
    const startedAt = Date.now();
    const label = request.label ?? 'completion';

    if (request.logger) {
      await request.logger.info('llm:start', {
        label,
        provider: this.config.llm.provider,
        model: this.config.llm.model,
        timeoutMs: this.config.llm.timeoutMs,
        promptChars: request.system.length + request.user.length,
        ...request.traceData,
      });
    }

    let content: string;
    try {
      const createParams: any = {
        model: this.config.llm.model,
        temperature: request.temperature ?? this.config.llm.temperature,
        messages,
        stream: true,
        ...(this.config.llm.provider === 'ollama' && this.config.llm.numCtx
          ? { options: { num_ctx: this.config.llm.numCtx } }
          : {}),
        ...(request.jsonMode && this.config.llm.provider !== 'anthropic'
          ? { response_format: { type: 'json_object' } }
          : {}),
      };
      // Stream tokens so the HTTP connection stays alive during long generations.
      // Without streaming, Ollama's write timeout (~5 min) closes the connection mid-response.
      const stream = (await this.client.chat.completions.create(createParams)) as unknown as AsyncIterable<ChatCompletionChunk>;
      const chunks: string[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk.choices[0]?.delta?.content ?? '');
      }
      content = chunks.join('');
    } catch (error) {
      const details = this.extractProviderErrorDetails(error);

      if (/timed? ?out|abort/i.test(details.message)) {
        if (request.logger) {
          await request.logger.error('llm:timeout', {
            label,
            durationMs: Date.now() - startedAt,
            ...request.traceData,
          });
        }
        throw new Error(
          `LLM request timed out after ${this.config.llm.timeoutMs} ms. Increase llm.timeoutMs in .wikirc.yaml or reduce the prompt size.`,
        );
      }

      if (request.logger) {
        await request.logger.error('llm:error', {
          label,
          durationMs: Date.now() - startedAt,
          status: details.status,
          code: details.code,
          type: details.type,
          requestId: details.requestId,
          message: details.message,
          ...request.traceData,
        });
      }

      throw this.normalizeProviderError(error);
    }

    if (!content || typeof content !== 'string') {
      throw new Error('The model returned an empty response.');
    }

    if (request.logger) {
      await request.logger.info('llm:end', {
        label,
        durationMs: Date.now() - startedAt,
        responseChars: content.length,
        ...request.traceData,
      });
    }

    return content;
  }

  private validateStructuredPayload<T>(payload: unknown, schema: ZodType<T>): T {
    try {
      return schema.parse(payload);
    } catch (error) {
      if (error instanceof ZodError) {
        const operationTypes = Array.isArray(
          (payload as { operations?: unknown[] }).operations,
        )
          ? (payload as { operations: Array<Record<string, unknown>> }).operations.map(
              (operation) =>
                operation.type ??
                operation.action ??
                operation.operation ??
                operation.op ??
                operation.kind,
            )
          : undefined;

        throw new Error(
          [
            'Invalid structured JSON returned by the model.',
            error.message,
            operationTypes
              ? `Operation values: ${JSON.stringify(operationTypes)}`
              : undefined,
            `Payload: ${JSON.stringify(payload, null, 2).slice(0, 4000)}`,
          ]
            .filter(Boolean)
            .join('\n\n'),
        );
      }

      throw error;
    }
  }

  private parseJsonPayload(raw: string): unknown {
    return JSON.parse(extractFirstJsonObject(raw));
  }

  private async repairJsonWithModel(
    raw: string,
    request?: Pick<CompletionRequest, 'logger' | 'traceData' | 'label'>,
  ): Promise<string> {
    return this.completeText({
      system: [
        'You repair malformed JSON.',
        'Return only valid JSON.',
        'Do not explain anything.',
        'Preserve the original keys and values as much as possible.',
      ].join('\n'),
      user: [
        'Repair the following malformed JSON-like response into strict valid JSON only:',
        raw,
      ].join('\n\n'),
      temperature: 0,
      jsonMode: true,
      label: 'json_repair',
      logger: request?.logger,
      traceData: request?.traceData,
    });
  }

  async completeJson<T>(request: CompletionRequest, schema: ZodType<T>): Promise<T> {
    const raw = await this.completeText({ ...request, jsonMode: true });
    let payload: unknown;
    let parseMode: 'direct' | 'local_repair' | 'model_repair' = 'direct';

    try {
      payload = this.parseJsonPayload(raw);
    } catch {
      try {
        const repairedCandidate = repairIncompleteJson(extractFirstJsonCandidate(raw));
        payload = this.parseJsonPayload(repairedCandidate);
        parseMode = 'local_repair';
      } catch {
        const repairedByModel = await this.repairJsonWithModel(raw, request);
        payload = this.parseJsonPayload(repairedByModel);
        parseMode = 'model_repair';
      }
    }

    if (request.logger) {
      await request.logger.info('llm:json', {
        label: request.label ?? 'completion',
        parseMode,
        ...request.traceData,
      });
    }

    return this.validateStructuredPayload(payload, schema);
  }
}
