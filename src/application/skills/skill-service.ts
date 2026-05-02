import type { Skill } from "../../shared/types/skills.js";
import type { SkillRepository } from "../../infrastructure/files/skill-repository.js";

export class SkillService {
  constructor(private readonly repository: SkillRepository) {}

  async list(stage?: string) {
    return this.repository.listApplicableSkills(stage);
  }

  async get(id: string) {
    return this.repository.getSkill(id);
  }

  async summarize(skills: Skill[]) {
    return skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      status: skill.status,
      stages: skill.stages,
      tags: skill.tags
    }));
  }
}
