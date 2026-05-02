import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ProjectContext } from "../files/project-context.js";

export type PromptKey =
  | "product-model.system"
  | "prd.system"
  | "prd-validate.system"
  | "prd-compare.system"
  | "wireframe.system"
  | "wireframe-annotate.system"
  | "ui.system"
  | "refine.system";

export class PromptCatalog {
  constructor(private readonly context: ProjectContext, private readonly profile = process.env.AIPM_PROMPT_PROFILE ?? "default") {}

  async getSystemPrompt(key: PromptKey, fallback: string) {
    const path = resolve(this.context.rootDir, "prompts", this.profile, `${key}.md`);
    try {
      await access(path);
      return await readFile(path, "utf-8");
    } catch {
      return fallback;
    }
  }
}
