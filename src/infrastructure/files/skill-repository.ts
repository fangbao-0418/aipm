import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { ProjectContext } from "./project-context.js";
import { readJsonFile } from "../../shared/utils/json.js";
import { skillSchema, type Skill } from "../../shared/types/skills.js";

export class SkillRepository {
  constructor(private readonly context: ProjectContext) {}

  skillsRoot() {
    return this.context.path("skills");
  }

  skillDir(id: string) {
    return this.context.path("skills", id);
  }

  manifestPath(id: string) {
    return this.context.path("skills", id, "skill.json");
  }

  async ensureReady() {
    await mkdir(this.skillsRoot(), { recursive: true });
  }

  async listSkills() {
    await this.ensureReady();
    const entries = await readdir(this.skillsRoot(), { withFileTypes: true });
    const skills = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const manifest = await readJsonFile<unknown>(join(this.skillsRoot(), entry.name, "skill.json"));
          return skillSchema.parse(manifest);
        })
    );

    return skills.sort((left, right) => left.id.localeCompare(right.id));
  }

  async getSkill(id: string) {
    const manifest = await readJsonFile<unknown>(this.manifestPath(id));
    return skillSchema.parse(manifest);
  }

  async listApplicableSkills(stage?: string) {
    const skills = await this.listSkills();
    if (!stage) {
      return skills.filter((skill) => skill.status !== "disabled");
    }
    return skills.filter((skill) => skill.status !== "disabled" && skill.stages.includes(stage as Skill["stages"][number]));
  }
}
