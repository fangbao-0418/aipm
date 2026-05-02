import type { Requirement, ScoreRecord } from "../../shared/types/models.js";

export interface RequirementStore {
  nextRequirementId(): Promise<string>;
  nextScoreId(): Promise<string>;
  saveRequirement(requirement: Requirement): Promise<void>;
  saveScore(requirementId: string, score: ScoreRecord): Promise<void>;
  getRequirement(id: string): Promise<Requirement>;
  getScore(requirementId: string): Promise<ScoreRecord>;
  listRequirements(): Promise<Requirement[]>;
  appendComment(requirementId: string, comment: string): Promise<void>;
  appendChangelog(event: Record<string, unknown>): Promise<void>;
}
