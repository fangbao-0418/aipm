import { createReadStream, createWriteStream } from "node:fs";
import { readFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const { parser } = require("stream-json");
const { streamArray } = require("stream-json/streamers/stream-array.js");
const { chain } = require("stream-chain");

export async function readJsonFile<T>(path: string): Promise<T> {
  const content = await readFile(path, "utf-8");
  return JSON.parse(content) as T;
}

function* stringifyJson(value: unknown): Generator<string> {
  if (value === null) {
    yield "null";
    return;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    yield JSON.stringify(value);
    return;
  }

  if (Array.isArray(value)) {
    yield "[";

    for (let i = 0; i < value.length; i++) {
      if (i > 0) yield ",";
      yield* stringifyJson(value[i]);
    }

    yield "]";
    return;
  }

  if (typeof value === "object") {
    yield "{";

    let first = true;

    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined || typeof item === "function" || typeof item === "symbol") {
        continue;
      }

      if (!first) yield ",";
      first = false;

      yield JSON.stringify(key);
      yield ":";
      yield* stringifyJson(item);
    }

    yield "}";
    return;
  }

  yield "null";
}

export async function writeJsonFile(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });

  await pipeline(
    Readable.from(stringifyJson(value)),
    createWriteStream(path, { encoding: "utf-8" })
  );
}

/**
 * 专门读取超大 JSON 数组：
 *
 * [
 *   { "id": 1 },
 *   { "id": 2 }
 * ]
 */
export async function* readJsonArrayFile<T>(path: string): AsyncGenerator<T> {
  const jsonPipeline = chain([
    createReadStream(path, { encoding: "utf-8" }),
    parser(),
    streamArray(),
  ]);

  for await (const data of jsonPipeline) {
    yield data.value as T;
  }
}