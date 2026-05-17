import OpenAI from 'openai';
import type { ChatCompletionChunk, ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { ZodError } from 'zod';
import type { ZodType } from 'zod';
import {
  extractFirstJsonCandidate,
  extractFirstJsonObject,
  fixUnescapedQuotes,
  repairIncompleteJson,
  sanitizeJsonStringControlChars,
  stripThinkingBlocks,
} from '../utils/json.ts';
import type { AppConfig } from '../types.ts';
import type { TraceLogger } from './traceLogger.ts';
import {
  providerRateLimitKey,
  providerRateLimitRetryDelayMs,
  providerRateLimitRetryMaxAttempts,
  throttleProviderRequestStart,
  waitForProviderRateLimitRetry,
} from './rateLimiter.ts';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

interface CompletionRequest {
  system: string;
  user: string;
  temperature?: number;
  jsonMode?: boolean;
  label?: string;
  logger?: TraceLogger;
  traceData?: Record<string, unknown>;
  onUsage?: (usage: TokenUsage) => void;
}

interface ProviderErrorDetails {
  status?: number;
  code?: string;
  type?: string;
  requestId?: string;
  message: string;
}

function supportsTemperature(config: AppConfig): boolean {
  return !(config.llm.provider === 'openai' && /^gpt-5(?:[.-]|$)/i.test(config.llm.model));
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function extractTokenUsage(chunk: unknown): TokenUsage | undefined {
  const usage = (chunk as { usage?: Record<string, unknown> | null }).usage;
  if (!usage) return undefined;

  const inputTokens =
    readNumber(usage.prompt_tokens) ??
    readNumber(usage.input_tokens) ??
    readNumber(usage.inputTokens);
  const outputTokens =
    readNumber(usage.completion_tokens) ??
    readNumber(usage.output_tokens) ??
    readNumber(usage.outputTokens);

  return inputTokens !== undefined && outputTokens !== undefined
    ? { inputTokens, outputTokens }
    : undefined;
}

export class LLMService {
  private readonly client: OpenAI;
  private readonly config: AppConfig;
  private readonly rateLimitKey: string;

  constructor(config: AppConfig) {
    this.config = config;
    this.rateLimitKey = providerRateLimitKey(config.llm.baseUrl);
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

  private async throttleRequestStart(logger?: TraceLogger, label?: string): Promise<void> {
    await throttleProviderRequestStart({
      key: this.rateLimitKey,
      requestsPerMinute: this.config.limits.requestsPerMinute,
      logger,
      label,
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
    // Some openai-compatible servers (e.g. mlx_lm) reject a leading system role
    // or treat it as a user turn, producing two consecutive user messages.
    // Fold system into user for these providers.
    const messages: ChatCompletionMessageParam[] =
      this.config.llm.provider === 'openai-compatible'
        ? [{ role: 'user', content: `${request.system}\n\n${request.user}` }]
        : [
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
    let capturedUsage: TokenUsage | undefined;
    const maxAttempts = providerRateLimitRetryMaxAttempts();
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.throttleRequestStart(request.logger, label);
        const createParams: any = {
          model: this.config.llm.model,
          messages,
          stream: true,
          ...(this.config.llm.provider === 'ollama' && this.config.llm.numCtx
            ? { options: { num_ctx: this.config.llm.numCtx } }
            : {}),
          ...(request.jsonMode &&
          this.config.llm.provider !== 'anthropic' &&
          this.config.llm.provider !== 'openai-compatible'
            ? { response_format: { type: 'json_object' } }
            : {}),
        };
        if (supportsTemperature(this.config)) {
          createParams.temperature = request.temperature ?? this.config.llm.temperature;
        }
        // Stream tokens so the HTTP connection stays alive during long generations.
        // Without streaming, Ollama's write timeout (~5 min) closes the connection mid-response.
        if (this.config.llm.provider !== 'anthropic') {
          createParams.stream_options = { include_usage: true };
        }
        const stream = (await this.client.chat.completions.create(createParams)) as unknown as AsyncIterable<ChatCompletionChunk>;
        const chunks: string[] = [];
        capturedUsage = undefined;
        for await (const chunk of stream) {
          chunks.push(chunk.choices[0]?.delta?.content ?? '');
          const usage = extractTokenUsage(chunk);
          if (usage) {
            capturedUsage = usage;
          }
        }
        content = stripThinkingBlocks(chunks.join(''));
        if (capturedUsage) {
          request.onUsage?.(capturedUsage);
        }
        break;
      } catch (error) {
        const details = this.extractProviderErrorDetails(error);

        if (details.status === 429 && attempt < maxAttempts) {
          const waitMs = providerRateLimitRetryDelayMs({
            key: this.rateLimitKey,
            source: error as { headers?: unknown },
          });
          await waitForProviderRateLimitRetry({
            logger: request.logger,
            event: 'llm:rate-limit-wait',
            label,
            status: details.status,
            attempt,
            maxAttempts,
            waitMs,
            traceData: request.traceData,
          });
          continue;
        }

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
    }

    if (!content! || typeof content !== 'string') {
      throw new Error('The model returned an empty response.');
    }

    if (request.logger) {
      await request.logger.info('llm:end', {
        label,
        durationMs: Date.now() - startedAt,
        responseChars: content.length,
        inputTokens: capturedUsage?.inputTokens,
        outputTokens: capturedUsage?.outputTokens,
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

  private preprocessJson(raw: string): string {
    return fixUnescapedQuotes(sanitizeJsonStringControlChars(raw));
  }

  private parseJsonPayload(preprocessed: string): unknown {
    return JSON.parse(extractFirstJsonObject(preprocessed));
  }

  private parseJsonPayloadWithLocalRepair(raw: string): {
    payload: unknown;
    repaired: boolean;
  } {
    const preprocessed = this.preprocessJson(raw);
    try {
      return {
        payload: this.parseJsonPayload(preprocessed),
        repaired: false,
      };
    } catch {
      const repairedCandidate = repairIncompleteJson(extractFirstJsonCandidate(preprocessed));
      return {
        payload: JSON.parse(repairedCandidate),
        repaired: true,
      };
    }
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
    let parseMode: 'direct' | 'local_repair' | 'model_repair' | 'model_repair_local_repair' =
      'direct';

    try {
      const parsed = this.parseJsonPayloadWithLocalRepair(raw);
      payload = parsed.payload;
      parseMode = parsed.repaired ? 'local_repair' : 'direct';
    } catch (localRepairError) {
      // Skip model repair for openai-compatible: thinking models (e.g. Qwen3) return
      // empty content for the repair call, making it unreliable and expensive.
      if (this.config.llm.provider !== 'openai-compatible') {
        if (request.logger) {
          await request.logger.info('llm:json-local-repair-failed', {
            label: request.label ?? 'completion',
            localRepairError:
              localRepairError instanceof Error
                ? localRepairError.message
                : String(localRepairError),
            rawPreview: raw.slice(0, 800),
            ...request.traceData,
          });
        }
        try {
          const repairedByModel = await this.repairJsonWithModel(raw, request);
          const parsed = this.parseJsonPayloadWithLocalRepair(repairedByModel);
          payload = parsed.payload;
          parseMode = parsed.repaired ? 'model_repair_local_repair' : 'model_repair';
        } catch {
          if (request.logger) {
            await request.logger.error('llm:json-parse-failed', {
              label: request.label ?? 'completion',
              localRepairError:
                localRepairError instanceof Error
                  ? localRepairError.message
                  : String(localRepairError),
              rawPreview: raw.slice(0, 800),
              ...request.traceData,
            });
          }
          throw new Error('The model returned malformed JSON and JSON repair failed.');
        }
      } else {
        if (request.logger) {
          await request.logger.error('llm:json-parse-failed', {
            label: request.label ?? 'completion',
            localRepairError:
              localRepairError instanceof Error
                ? localRepairError.message
                : String(localRepairError),
            rawPreview: raw.slice(0, 800),
            ...request.traceData,
          });
        }
        throw new Error('The model returned malformed JSON and JSON repair failed.');
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
