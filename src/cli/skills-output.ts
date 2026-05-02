import type { Skill } from "../shared/types/skills.js";

export function printSkillList(skills: Skill[]) {
  if (skills.length === 0) {
    console.log("No skills found.");
    return;
  }

  for (const skill of skills) {
    console.log(`${skill.id}  [${skill.status}]  ${skill.name}`);
  }
}

export function printSkillDetail(skill: Skill) {
  console.log(`${skill.id} ${skill.name}`);
  console.log(`status: ${skill.status}`);
  console.log(`version: ${skill.version}`);
  console.log(`stages: ${skill.stages.join(", ")}`);
  if (skill.tags.length > 0) {
    console.log(`tags: ${skill.tags.join(", ")}`);
  }
  console.log("");
  console.log(skill.description);
}
