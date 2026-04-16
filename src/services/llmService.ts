import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { ZodError } from 'zod';
import type { ZodType } from 'zod';
import { extractFirstJsonObject } from '../utils/json.ts';
import type { AppConfig } from '../types.ts';

interface CompletionRequest {
  system: string;
  user: string;
  temperature?: number;
}

export class LLMService {
  private readonly client: OpenAI;
  private readonly config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.llm.apiKey,
      baseURL: config.llm.baseUrl,
    });
  }

  async completeText(request: CompletionRequest): Promise<string> {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: request.system },
      { role: 'user', content: request.user },
    ];

    const response = await this.client.chat.completions.create({
      model: this.config.llm.model,
      temperature: request.temperature ?? this.config.llm.temperature,
      messages,
    });

    const content = response.choices[0]?.message?.content;
    if (!content || typeof content !== 'string') {
      throw new Error('The model returned an empty response.');
    }

    return content;
  }

  async completeJson<T>(request: CompletionRequest, schema: ZodType<T>): Promise<T> {
    const raw = await this.completeText(request);
    const payload = JSON.parse(extractFirstJsonObject(raw));

    try {
      return schema.parse(payload);
    } catch (error) {
      if (error instanceof ZodError) {
        const operationTypes = Array.isArray((payload as { operations?: unknown[] }).operations)
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
            operationTypes ? `Operation values: ${JSON.stringify(operationTypes)}` : undefined,
            `Payload: ${JSON.stringify(payload, null, 2).slice(0, 4000)}`,
          ]
            .filter(Boolean)
            .join('\n\n'),
        );
      }

      throw error;
    }
  }
}
