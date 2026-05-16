import { z, ZodTypeAny } from "zod";

interface GenerateArgs {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
}

interface GenerateWithImagesArgs extends GenerateArgs {
  images: Array<{
    dataUrl: string;
    label?: string;
  }>;
}

interface StreamArgs extends GenerateArgs {
  signal?: AbortSignal;
  onToken?: (token: string) => void | Promise<void>;
}

interface StreamWithImagesArgs extends GenerateWithImagesArgs {
  signal?: AbortSignal;
  onToken?: (token: string) => void | Promise<void>;
}

type OpenAIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface OpenAIMessage {
  role: "system" | "user";
  content: string | OpenAIContentPart[];
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

    const requestBody = JSON.stringify({
      model: this.model,
      temperature: args.temperature ?? 0.4,
      messages: [
        { role: "system", content: args.systemPrompt },
        { role: "user", content: args.userPrompt }
      ] satisfies OpenAIMessage[]
    });

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        body: requestBody
      });
    } catch (error) {
      console.error("[AIPM][LLM] request:fetch_failed", {
        model: this.model,
        baseUrl: this.baseUrl,
        durationMs: Date.now() - startedAt,
        systemPromptChars: args.systemPrompt.length,
        userPromptChars: args.userPrompt.length,
        requestBodyChars: requestBody.length,
        error: serializeUnknownError(error)
      });
      throw new Error(`OpenAI request failed before response: ${formatUnknownError(error)}`);
    }

    if (!response.ok) {
      const text = await response.text();
      console.error("[AIPM][LLM] request:error", {
        model: this.model,
        baseUrl: this.baseUrl,
        status: response.status,
        durationMs: Date.now() - startedAt,
        requestBodyChars: requestBody.length,
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

  async generateTextWithImages(args: GenerateWithImagesArgs) {
    if (!this.apiKey) {
      throw new Error("OPENAI_API_KEY is not set");
    }

    const startedAt = Date.now();
    console.info("[AIPM][LLM] vision:start", {
      model: this.model,
      baseUrl: this.baseUrl,
      systemPromptChars: args.systemPrompt.length,
      userPromptChars: args.userPrompt.length,
      imageCount: args.images.length
    });

    const userContent: OpenAIContentPart[] = [
      { type: "text", text: args.userPrompt },
      ...args.images.map((image, index) => ({
        type: "image_url" as const,
        image_url: {
          url: image.dataUrl
        }
      })),
      {
        type: "text",
        text: args.images.map((image, index) => `图片 ${index + 1}: ${image.label || "画板预览"}`).join("\n")
      }
    ];

    const requestBody = JSON.stringify({
      model: this.model,
      temperature: args.temperature ?? 0.2,
      messages: [
        { role: "system", content: args.systemPrompt },
        { role: "user", content: userContent }
      ] satisfies OpenAIMessage[]
    });

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        body: requestBody
      });
    } catch (error) {
      console.error("[AIPM][LLM] vision:fetch_failed", {
        model: this.model,
        baseUrl: this.baseUrl,
        durationMs: Date.now() - startedAt,
        systemPromptChars: args.systemPrompt.length,
        userPromptChars: args.userPrompt.length,
        imageCount: args.images.length,
        imageDataUrlChars: args.images.map((image) => image.dataUrl.length),
        requestBodyChars: requestBody.length,
        error: serializeUnknownError(error)
      });
      throw new Error(`OpenAI vision request failed before response: ${formatUnknownError(error)}`);
    }

    if (!response.ok) {
      const text = await response.text();
      console.error("[AIPM][LLM] vision:error", {
        model: this.model,
        baseUrl: this.baseUrl,
        status: response.status,
        durationMs: Date.now() - startedAt,
        requestBodyChars: requestBody.length,
        bodyPreview: text.slice(0, 500)
      });
      throw new Error(`OpenAI vision request failed: ${response.status} ${text}`);
    }

    const payload = await response.json() as ChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content;
    const text = extractText(content).trim();
    if (!text) {
      throw new Error("OpenAI vision response did not contain message content");
    }
    console.info("[AIPM][LLM] vision:success", {
      model: this.model,
      durationMs: Date.now() - startedAt,
      responseChars: text.length
    });
    return text;
  }

  async generateTextWithImagesStream(args: StreamWithImagesArgs) {
    if (!this.apiKey) {
      throw new Error("OPENAI_API_KEY is not set");
    }

    const startedAt = Date.now();
    console.info("[AIPM][LLM] vision_stream:start", {
      model: this.model,
      baseUrl: this.baseUrl,
      systemPromptChars: args.systemPrompt.length,
      userPromptChars: args.userPrompt.length,
      imageCount: args.images.length
    });

    const userContent: OpenAIContentPart[] = [
      { type: "text", text: args.userPrompt },
      ...args.images.map((image) => ({
        type: "image_url" as const,
        image_url: { url: image.dataUrl }
      })),
      {
        type: "text",
        text: args.images.map((image, index) => `图片 ${index + 1}: ${image.label || "画板预览"}`).join("\n")
      }
    ];

    const requestBody = JSON.stringify({
      model: this.model,
      temperature: args.temperature ?? 0.2,
      stream: true,
      messages: [
        { role: "system", content: args.systemPrompt },
        { role: "user", content: userContent }
      ] satisfies OpenAIMessage[]
    });

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        signal: args.signal,
        body: requestBody
      });
    } catch (error) {
      console.error("[AIPM][LLM] vision_stream:fetch_failed", {
        model: this.model,
        baseUrl: this.baseUrl,
        durationMs: Date.now() - startedAt,
        requestBodyChars: requestBody.length,
        imageCount: args.images.length,
        error: serializeUnknownError(error)
      });
      throw new Error(`OpenAI vision stream request failed before response: ${formatUnknownError(error)}`);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI vision request failed: ${response.status} ${text}`);
    }
    if (!response.body) {
      throw new Error("OpenAI vision streaming response missing body");
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

    console.info("[AIPM][LLM] vision_stream:success", {
      model: this.model,
      durationMs: Date.now() - startedAt,
      responseChars: output.length
    });
    return output.trim();
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

    const requestBody = JSON.stringify({
      model: this.model,
      temperature: args.temperature ?? 0.4,
      stream: true,
      messages: [
        { role: "system", content: args.systemPrompt },
        { role: "user", content: args.userPrompt }
      ] satisfies OpenAIMessage[]
    });

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        signal: args.signal,
        body: requestBody
      });
    } catch (error) {
      console.error("[AIPM][LLM] stream:fetch_failed", {
        model: this.model,
        baseUrl: this.baseUrl,
        durationMs: Date.now() - startedAt,
        systemPromptChars: args.systemPrompt.length,
        userPromptChars: args.userPrompt.length,
        requestBodyChars: requestBody.length,
        error: serializeUnknownError(error)
      });
      throw new Error(`OpenAI stream request failed before response: ${formatUnknownError(error)}`);
    }

    if (!response.ok) {
      const text = await response.text();
      console.error("[AIPM][LLM] stream:error", {
        model: this.model,
        baseUrl: this.baseUrl,
        status: response.status,
        durationMs: Date.now() - startedAt,
        requestBodyChars: requestBody.length,
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

  async generateJsonWithImages<S extends ZodTypeAny>(schema: S, args: GenerateWithImagesArgs): Promise<z.output<S>> {
    const text = await this.generateTextWithImagesStream({
      ...args,
      userPrompt: `${args.userPrompt}\n\n只返回 JSON，不要输出解释、代码块标记或额外文本。`
    });
    try {
      const extractedJson = extractJson(text);
      return schema.parse(JSON.parse(extractedJson));
    } catch (error) {
      throw new StructuredOutputParseError(
        error instanceof Error ? error.message : "Failed to parse structured vision LLM output",
        text,
        tryExtractJson(text)
      );
    }
  }

  async generateJsonWithImagesStream<S extends ZodTypeAny>(schema: S, args: StreamWithImagesArgs): Promise<z.output<S>> {
    const text = await this.generateTextWithImagesStream({
      ...args,
      userPrompt: `${args.userPrompt}\n\n只返回 JSON，不要输出解释、代码块标记或额外文本。`
    });
    try {
      const extractedJson = extractJson(text);
      return schema.parse(JSON.parse(extractedJson));
    } catch (error) {
      throw new StructuredOutputParseError(
        error instanceof Error ? error.message : "Failed to parse structured vision LLM output",
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

  async generateJsonStreamEarly<S extends ZodTypeAny>(schema: S, args: StreamArgs): Promise<z.output<S>> {
    if (!this.apiKey) {
      throw new Error("OPENAI_API_KEY is not set");
    }

    const startedAt = Date.now();
    const userPrompt = `${args.userPrompt}\n\n只返回 JSON，不要输出解释、代码块标记或额外文本。`;
    console.info("[AIPM][LLM] json_stream_early:start", {
      model: this.model,
      baseUrl: this.baseUrl,
      systemPromptChars: args.systemPrompt.length,
      userPromptChars: userPrompt.length
    });

    const requestBody = JSON.stringify({
      model: this.model,
      temperature: args.temperature ?? 0.4,
      stream: true,
      messages: [
        { role: "system", content: args.systemPrompt },
        { role: "user", content: userPrompt }
      ] satisfies OpenAIMessage[]
    });

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        signal: args.signal,
        body: requestBody
      });
    } catch (error) {
      console.error("[AIPM][LLM] json_stream_early:fetch_failed", {
        model: this.model,
        baseUrl: this.baseUrl,
        durationMs: Date.now() - startedAt,
        requestBodyChars: requestBody.length,
        error: serializeUnknownError(error)
      });
      throw new Error(`OpenAI stream request failed before response: ${formatUnknownError(error)}`);
    }

    if (!response.ok) {
      const text = await response.text();
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
    let lastParseError: unknown;

    const tryReturnParsed = async () => {
      const parsed = tryParseJsonWithSchema(schema, output);
      if (!parsed.ok) {
        lastParseError = parsed.error;
        return undefined;
      }
      await reader.cancel().catch(() => undefined);
      console.info("[AIPM][LLM] json_stream_early:parsed", {
        model: this.model,
        durationMs: Date.now() - startedAt,
        responseChars: output.length
      });
      return parsed.value;
    };

    try {
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
              const parsedJson = await tryReturnParsed();
              if (parsedJson !== undefined) return parsedJson;
            }
          }

          boundary = findSseBoundary(buffer);
        }

        if (readerDone) {
          done = true;
        }
      }
    } catch (error) {
      const parsedJson = tryParseJsonWithSchema(schema, output);
      if (parsedJson.ok) {
        console.warn("[AIPM][LLM] json_stream_early:using_partial_after_error", {
          model: this.model,
          durationMs: Date.now() - startedAt,
          responseChars: output.length,
          error: serializeUnknownError(error)
        });
        return parsedJson.value;
      }
      throw new StructuredOutputParseError(
        `Streaming JSON failed before a valid schema was parsed: ${formatUnknownError(error)}`,
        output,
        tryExtractJson(output)
      );
    }

    const parsed = tryParseJsonWithSchema(schema, output);
    if (parsed.ok) return parsed.value;
    throw new StructuredOutputParseError(
      lastParseError instanceof Error ? lastParseError.message : "Failed to parse structured LLM output",
      output,
      tryExtractJson(output)
    );
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

function tryParseJsonWithSchema<S extends ZodTypeAny>(schema: S, value: string): { ok: true; value: z.output<S> } | { ok: false; error: unknown } {
  try {
    const extractedJson = extractJson(value);
    return { ok: true, value: schema.parse(JSON.parse(extractedJson)) };
  } catch (error) {
    return { ok: false, error };
  }
}

function formatUnknownError(error: unknown) {
  const serialized = serializeUnknownError(error);
  return [
    serialized.name,
    serialized.message,
    serialized.code ? `code=${serialized.code}` : "",
    serialized.cause ? `cause=${JSON.stringify(serialized.cause)}` : ""
  ].filter(Boolean).join(" ");
}

function serializeUnknownError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { message: String(error) };
  }
  const cause = (error as Error & { cause?: unknown }).cause;
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    code: typeof (error as Error & { code?: unknown }).code === "string" ? (error as Error & { code?: unknown }).code : undefined,
    cause: cause ? serializeUnknownError(cause) : undefined
  };
}
