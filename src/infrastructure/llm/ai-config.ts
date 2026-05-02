import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ProjectContext } from "../files/project-context.js";

export interface AiRuntimeConfig {
  temperature: {
    productModel: number;
    prd: number;
    prdValidate: number;
    prdCompare: number;
    wireframe: number;
    wireframeAnnotate: number;
    ui: number;
    refine: number;
  };
}

const defaultConfig: AiRuntimeConfig = {
  temperature: {
    productModel: 0.35,
    prd: 0.3,
    prdValidate: 0.2,
    prdCompare: 0.45,
    wireframe: 0.35,
    wireframeAnnotate: 0.25,
    ui: 0.55,
    refine: 0.45
  }
};

export async function loadAiRuntimeConfig(context: ProjectContext): Promise<AiRuntimeConfig> {
  const path = resolve(context.rootDir, "configs", "ai-runtime.json");
  try {
    await access(path);
    const content = await readFile(path, "utf-8");
    const parsed = JSON.parse(content) as Partial<AiRuntimeConfig>;
    return {
      ...defaultConfig,
      ...parsed,
      temperature: {
        ...defaultConfig.temperature,
        ...(parsed.temperature ?? {})
      }
    };
  } catch {
    return defaultConfig;
  }
}
