import { readFile } from "node:fs/promises";
import type { PriorityLevel, Requirement, ScoreRecord } from "../../shared/types/models.js";
import { scoreSchema } from "../../shared/types/models.js";
import { nowIso } from "../../shared/utils/time.js";
import type { RequirementStore } from "../../domain/requirement/requirement-store.js";

type PositiveDimension = "userValue" | "businessValue" | "strategicFit" | "urgency" | "reach";
type NegativeDimension = "implementationCost" | "deliveryRisk";

export interface ScoreRequirementInput {
  requirementId: string;
  scores: Record<PositiveDimension | NegativeDimension, number>;
  reason?: string;
  overrideLevel?: PriorityLevel;
  overrideReason?: string;
}

interface WeightConfig {
  modelVersion: string;
  scale: { min: 1; max: 5 };
  positiveDimensions: Record<PositiveDimension, { weight: number; direction: "positive" }>;
  negativeDimensions: Record<NegativeDimension, { weight: number; direction: "negative" }>;
  scoreMix: { valueWeight: number; feasibilityWeight: number };
  manualAdjustment: { min: number; max: number };
  priorityThresholds: Record<PriorityLevel, { min: number }>;
}

export class ScoringService {
  constructor(
    private readonly repository: RequirementStore,
    private readonly configPath: string
  ) {}

  async scoreRequirement(input: ScoreRequirementInput) {
    const requirement = await this.repository.getRequirement(input.requirementId);
    const config = await this.loadConfig();
    const createdAt = nowIso();

    const positiveDimensions = this.buildPositiveDimensions(input.scores, config);
    const negativeDimensions = this.buildNegativeDimensions(input.scores, config);

    const positiveScore = weightedAverage(Object.values(positiveDimensions).map((item) => ({
      value: item.normalizedScore,
      weight: item.weight
    })));
    const negativeScore = weightedAverage(Object.values(negativeDimensions).map((item) => ({
      value: item.normalizedScore,
      weight: item.weight
    })));
    const valueScore = round(positiveScore);
    const feasibilityScore = round(100 - negativeScore);
    const basePriorityScore = round(
      valueScore * config.scoreMix.valueWeight +
      feasibilityScore * config.scoreMix.feasibilityWeight
    );

    const inferredLevel = resolvePriorityLevel(basePriorityScore, config.priorityThresholds);
    let finalPriorityScore = basePriorityScore;
    let priorityLevel = inferredLevel;
    let override: ScoreRecord["override"];

    if (input.overrideLevel && input.overrideLevel !== inferredLevel) {
      const adjustmentTarget = midPointForLevel(input.overrideLevel, config.priorityThresholds);
      const rawAdjustment = adjustmentTarget - basePriorityScore;
      const adjustment = clamp(rawAdjustment, config.manualAdjustment.min, config.manualAdjustment.max);
      finalPriorityScore = clamp(basePriorityScore + adjustment, 0, 100);
      priorityLevel = input.overrideLevel;
      override = {
        applied: true,
        fromLevel: inferredLevel,
        toLevel: input.overrideLevel,
        reason: input.overrideReason,
        at: createdAt
      };
    }

    const scoreId = await this.repository.nextScoreId();
    const scoreRecord = scoreSchema.parse({
      id: scoreId,
      requirementId: requirement.id,
      modelVersion: config.modelVersion,
      scale: config.scale,
      dimensions: {
        ...positiveDimensions,
        ...negativeDimensions
      },
      computed: {
        positiveScore: round(positiveScore),
        negativeScore: round(negativeScore),
        feasibilityScore,
        manualAdjustment: finalPriorityScore - basePriorityScore,
        finalPriorityScore
      },
      valueScore,
      priorityScore: finalPriorityScore,
      priorityLevel,
      recommendation: recommendationForLevel(priorityLevel),
      scoreReasoning: input.reason ?? defaultReasoning(requirement, valueScore, finalPriorityScore),
      priorityReasoning: priorityReasoning(priorityLevel, finalPriorityScore),
      override,
      createdAt
    });

    const updatedRequirement: Requirement = {
      ...requirement,
      valueScore,
      priorityScore: finalPriorityScore,
      priorityLevel,
      scoreReasoning: scoreRecord.scoreReasoning,
      scoreRef: scoreRecord.id,
      updatedAt: createdAt,
      version: {
        ...requirement.version,
        revision: requirement.version.revision + 1
      }
    };

    await this.repository.saveScore(requirement.id, scoreRecord);
    await this.repository.saveRequirement(updatedRequirement);
    await this.repository.appendChangelog({
      type: "requirement.score",
      requirementId: requirement.id,
      scoreId: scoreRecord.id,
      priorityLevel,
      at: createdAt
    });

    return scoreRecord;
  }

  async prioritize() {
    const requirements = await this.repository.listRequirements();
    return requirements
      .slice()
      .sort((left, right) => {
        const rightScore = right.priorityScore ?? -1;
        const leftScore = left.priorityScore ?? -1;
        if (rightScore !== leftScore) {
          return rightScore - leftScore;
        }
        return left.id.localeCompare(right.id);
      });
  }

  private async loadConfig() {
    const content = await readFile(this.configPath, "utf-8");
    return JSON.parse(content) as WeightConfig;
  }

  private buildPositiveDimensions(scores: ScoreRequirementInput["scores"], config: WeightConfig) {
    return {
      userValue: buildDimension(scores.userValue, config.scale, config.positiveDimensions.userValue.weight, "positive", "User value impact"),
      businessValue: buildDimension(scores.businessValue, config.scale, config.positiveDimensions.businessValue.weight, "positive", "Business value impact"),
      strategicFit: buildDimension(scores.strategicFit, config.scale, config.positiveDimensions.strategicFit.weight, "positive", "Strategic fit impact"),
      urgency: buildDimension(scores.urgency, config.scale, config.positiveDimensions.urgency.weight, "positive", "Urgency impact"),
      reach: buildDimension(scores.reach, config.scale, config.positiveDimensions.reach.weight, "positive", "Reach impact")
    };
  }

  private buildNegativeDimensions(scores: ScoreRequirementInput["scores"], config: WeightConfig) {
    return {
      implementationCost: buildDimension(scores.implementationCost, config.scale, config.negativeDimensions.implementationCost.weight, "negative", "Implementation cost impact"),
      deliveryRisk: buildDimension(scores.deliveryRisk, config.scale, config.negativeDimensions.deliveryRisk.weight, "negative", "Delivery risk impact")
    };
  }
}

function normalizeScore(rawScore: number, scale: { min: number; max: number }) {
  return ((rawScore - scale.min) / (scale.max - scale.min)) * 100;
}

function buildDimension(
  rawScore: number,
  scale: { min: number; max: number },
  weight: number,
  direction: "positive" | "negative",
  rationale: string
) {
  return {
    direction,
    rawScore,
    normalizedScore: round(normalizeScore(rawScore, scale)),
    weight,
    rationale
  };
}

function weightedAverage(items: Array<{ value: number; weight: number }>) {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  return items.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight;
}

function round(value: number) {
  return Math.round(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function resolvePriorityLevel(score: number, thresholds: Record<PriorityLevel, { min: number }>): PriorityLevel {
  if (score >= thresholds.P0.min) {
    return "P0";
  }
  if (score >= thresholds.P1.min) {
    return "P1";
  }
  if (score >= thresholds.P2.min) {
    return "P2";
  }
  return "P3";
}

function midPointForLevel(level: PriorityLevel, thresholds: Record<PriorityLevel, { min: number }>) {
  switch (level) {
    case "P0":
      return 92;
    case "P1":
      return Math.round((thresholds.P1.min + thresholds.P0.min - 1) / 2);
    case "P2":
      return Math.round((thresholds.P2.min + thresholds.P1.min - 1) / 2);
    case "P3":
      return Math.round(thresholds.P2.min / 2);
  }
}

function recommendationForLevel(level: PriorityLevel): ScoreRecord["recommendation"] {
  switch (level) {
    case "P0":
      return "do_now";
    case "P1":
      return "plan_next";
    case "P2":
      return "candidate_pool";
    case "P3":
      return "observe_or_archive";
  }
}

function defaultReasoning(requirement: Requirement, valueScore: number, priorityScore: number) {
  return `Requirement ${requirement.id} scored ${valueScore} on value and ${priorityScore} on overall priority.`;
}

function priorityReasoning(level: PriorityLevel, score: number) {
  return `Priority resolved to ${level} with a final score of ${score}.`;
}
