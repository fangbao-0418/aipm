import type { Requirement, ScoreRecord } from "../shared/types/models.js";

export function printRequirementSummary(requirement: Requirement) {
  console.log(`${requirement.id} ${requirement.title}`);
  console.log(`status: ${requirement.status}`);
  console.log(`source: ${requirement.source.type} / ${requirement.source.name}`);
  if (requirement.priorityLevel) {
    console.log(`priority: ${requirement.priorityLevel}`);
  }
  if (requirement.priorityScore !== null) {
    console.log(`priorityScore: ${requirement.priorityScore}`);
  }
}

export function printRequirementList(requirements: Requirement[]) {
  if (requirements.length === 0) {
    console.log("No requirements found.");
    return;
  }

  for (const requirement of requirements) {
    const level = requirement.priorityLevel ?? "-";
    const score = requirement.priorityScore ?? "-";
    console.log(`${requirement.id}  [${requirement.status}]  [${level}]  [${score}]  ${requirement.title}`);
  }
}

export function printScoreSummary(score: ScoreRecord) {
  console.log(`${score.requirementId} scored`);
  console.log(`valueScore: ${score.valueScore}`);
  console.log(`priorityScore: ${score.priorityScore}`);
  console.log(`priorityLevel: ${score.priorityLevel}`);
  if (score.scoreReasoning) {
    console.log(`reason: ${score.scoreReasoning}`);
  }
}
