import { z, ZodTypeAny } from "zod";

interface GenerateArgs {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
}

interface StreamArgs extends GenerateArgs {
  signal?: AbortSignal;
  onToken?: (token: string) => void | Promise<void>;
}

interface OpenAIMessage {
  role: "system" | "user";
  content: string;
}

export interface LlmConnectionValidationResult {
  ok: boolean;
  model: string;
  baseUrl: string;
  message: string;
}

export class StructuredOutputParseError extends Error {
  constructor(
    message: string,
    readonly rawText: string,
    readonly extractedJson?: string
  ) {
    super(message);
    this.name = "StructuredOutputParseError";
  }
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
    delta?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

export class OpenAIClient {
  readonly enabled: boolean;
  readonly model: string;
  readonly resolvedBaseUrl: string;

  constructor(
    private readonly apiKey = process.env.OPENAI_API_KEY,
    private readonly baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini"
  ) {
    this.enabled = Boolean(apiKey);
    this.model = model;
    this.resolvedBaseUrl = baseUrl;
  }

  async generateText(args: GenerateArgs) {
    if (!this.apiKey) {
      throw new Error("OPENAI_API_KEY is not set");
    }

    const startedAt = Date.now();
    console.info("[AIPM][LLM] request:start", {
      model: this.model,
      baseUrl: this.baseUrl,
      systemPromptChars: args.systemPrompt.length,
      userPromptChars: args.userPrompt.length
    });

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        temperature: args.temperature ?? 0.4,
        messages: [
          { role: "system", content: args.systemPrompt },
          { role: "user", content: args.userPrompt }
        ] satisfies OpenAIMessage[]
      })
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("[AIPM][LLM] request:error", {
        model: this.model,
        status: response.status,
        durationMs: Date.now() - startedAt,
        bodyPreview: text.slice(0, 500)
      });
      throw new Error(`OpenAI request failed: ${response.status} ${text}`);
    }

    const payload = await response.json() as ChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content === "string") {
      console.info("[AIPM][LLM] request:success", {
        model: this.model,
        durationMs: Date.now() - startedAt,
        responseChars: content.length
      });
      return content.trim();
    }
    if (Array.isArray(content)) {
      const text = content
        .filter((item) => item.type === "text" && item.text)
        .map((item) => item.text)
        .join("\n")
        .trim();
      if (text) {
        console.info("[AIPM][LLM] request:success", {
          model: this.model,
          durationMs: Date.now() - startedAt,
          responseChars: text.length
        });
        return text;
      }
    }

    throw new Error("OpenAI response did not contain message content");
  }

  async generateTextStream(args: StreamArgs) {
    if (!this.apiKey) {
      throw new Error("OPENAI_API_KEY is not set");
    }

    const startedAt = Date.now();
    console.info("[AIPM][LLM] stream:start", {
      model: this.model,
      baseUrl: this.baseUrl,
      systemPromptChars: args.systemPrompt.length,
      userPromptChars: args.userPrompt.length
    });

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      signal: args.signal,
      body: JSON.stringify({
        model: this.model,
        temperature: args.temperature ?? 0.4,
        stream: true,
        messages: [
          { role: "system", content: args.systemPrompt },
          { role: "user", content: args.userPrompt }
        ] satisfies OpenAIMessage[]
      })
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("[AIPM][LLM] stream:error", {
        model: this.model,
        status: response.status,
        durationMs: Date.now() - startedAt,
        bodyPreview: text.slice(0, 500)
      });
      throw new Error(`OpenAI request failed: ${response.status} ${text}`);
    }

    if (!response.body) {
      throw new Error("OpenAI streaming response missing body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let output = "";
    let done = false;

    while (!done) {
      const { value, done: readerDone } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !readerDone });

      let boundary = findSseBoundary(buffer);
      while (boundary) {
        const rawEvent = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        const parsed = parseSseData(rawEvent);

        if (parsed === "[DONE]") {
          done = true;
          break;
        }

        if (parsed) {
          const payload = JSON.parse(parsed) as ChatCompletionResponse;
          const chunk = extractText(payload.choices?.[0]?.delta?.content);
          if (chunk) {
            output += chunk;
            await args.onToken?.(chunk);
          }
        }

        boundary = findSseBoundary(buffer);
      }

      if (readerDone) {
        done = true;
      }
    }

    console.info("[AIPM][LLM] stream:success", {
      model: this.model,
      durationMs: Date.now() - startedAt,
      responseChars: output.length
    });
    return output.trim();
  }

  async generateJson<S extends ZodTypeAny>(schema: S, args: GenerateArgs): Promise<z.output<S>> {
    const text = await this.generateText({
      ...args,
      userPrompt: `${args.userPrompt}\n\n只返回 JSON，不要输出解释、代码块标记或额外文本。`
    });
    try {
      const extractedJson = extractJson(text);
      return schema.parse(JSON.parse(extractedJson));
    } catch (error) {
      throw new StructuredOutputParseError(
        error instanceof Error ? error.message : "Failed to parse structured LLM output",
        text,
        tryExtractJson(text)
      );
    }
  }

  async generateJsonStream<S extends ZodTypeAny>(schema: S, args: StreamArgs): Promise<z.output<S>> {
    const text = await this.generateTextStream({
      ...args,
      userPrompt: `${args.userPrompt}\n\n只返回 JSON，不要输出解释、代码块标记或额外文本。`
    });
    try {
      const extractedJson = extractJson(text);
      return schema.parse(JSON.parse(extractedJson));
    } catch (error) {
      throw new StructuredOutputParseError(
        error instanceof Error ? error.message : "Failed to parse structured LLM output",
        text,
        tryExtractJson(text)
      );
    }
  }

  async validateConnection(signal?: AbortSignal): Promise<LlmConnectionValidationResult> {
    if (!this.apiKey) {
      return {
        ok: false,
        model: this.model,
        baseUrl: this.baseUrl,
        message: "缺少 API Key，无法验证模型连接。"
      };
    }

    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiKey}`
        },
        signal
      });

      if (!response.ok) {
        const text = await response.text();
        return {
          ok: false,
          model: this.model,
          baseUrl: this.baseUrl,
          message: `模型连接校验失败：${response.status} ${text.slice(0, 160)}`
        };
      }

      const payload = await response.json() as { data?: Array<{ id?: string }> };
      const hasModel = payload.data?.some((item) => item.id === this.model) ?? false;
      return {
        ok: true,
        model: this.model,
        baseUrl: this.baseUrl,
        message: hasModel
          ? `模型连接正常，已找到模型 ${this.model}。`
          : `模型连接正常，但未在模型列表中明确找到 ${this.model}。`
      };
    } catch (error) {
      return {
        ok: false,
        model: this.model,
        baseUrl: this.baseUrl,
        message: error instanceof Error ? `模型连接校验失败：${error.message}` : "模型连接校验失败。"
      };
    }
  }
}

function extractText(content?: string | Array<{ type?: string; text?: string }>) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter((item) => item.type === "text" && item.text)
      .map((item) => item.text)
      .join("");
  }

  return "";
}

function parseSseData(rawEvent: string) {
  const data = rawEvent
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n")
    .trim();

  return data || null;
}

function findSseBoundary(buffer: string) {
  const crlfIndex = buffer.indexOf("\r\n\r\n");
  const lfIndex = buffer.indexOf("\n\n");

  if (crlfIndex === -1) {
    return lfIndex >= 0 ? { index: lfIndex, length: 2 } : null;
  }

  if (lfIndex === -1) {
    return { index: crlfIndex, length: 4 };
  }

  return crlfIndex < lfIndex
    ? { index: crlfIndex, length: 4 }
    : { index: lfIndex, length: 2 };
}

function extractJson(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return trimmed;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  throw new Error("Failed to extract JSON from AI response");
}

function tryExtractJson(value: string) {
  try {
    return extractJson(value);
  } catch {
    return undefined;
  }
}
