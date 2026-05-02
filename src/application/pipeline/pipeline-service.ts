import { ClarifyGateError, ClarifyService } from "../clarify/clarify-service.js";
import { GenerationService } from "../generation/generation-service.js";
import { PatchService } from "../patch/patch-service.js";
import { ReviewService } from "../review/review-service.js";

const orderedStages = ["clarify", "product_model", "prd", "wireframe", "ui"] as const;

type PipelineStage = (typeof orderedStages)[number];
type PipelineMode = "stop_on_block" | "continue_on_warning";

export interface PipelineRunInput {
  fromStage: PipelineStage;
  toStage: PipelineStage;
  mode?: PipelineMode;
  autoApplyPatches?: boolean;
}

export interface PipelineRunStep {
  stage: PipelineStage;
  status: "completed" | "blocked" | "warning" | "skipped";
  summary: string;
  reviewId?: string;
  patchIds?: string[];
  artifactKeys?: string[];
  missingFieldKeys?: string[];
}

export interface PipelineRunResult {
  requirementId: string;
  status: "completed" | "blocked";
  fromStage: PipelineStage;
  toStage: PipelineStage;
  stoppedAt?: PipelineStage;
  steps: PipelineRunStep[];
}

export class PipelineService {
  constructor(
    private readonly clarify: ClarifyService,
    private readonly generation: GenerationService,
    private readonly review: ReviewService,
    private readonly patch: PatchService
  ) {}

  async run(requirementId: string, input: PipelineRunInput): Promise<PipelineRunResult> {
    const mode = input.mode ?? "stop_on_block";
    const autoApplyPatches = input.autoApplyPatches ?? false;
    const stages = sliceStages(input.fromStage, input.toStage);
    const steps: PipelineRunStep[] = [];

    for (const stage of stages) {
      if (stage === "clarify") {
        const pack = await this.clarify.ensureQuestionPack(requirementId);
        const review = await this.clarify.review(requirementId);
        const step: PipelineRunStep = {
          stage,
          status: review.status === "block" ? "blocked" : review.status === "warning" ? "warning" : "completed",
          summary: review.summary,
          reviewId: review.id,
          missingFieldKeys: pack.gating.missingFieldKeys
        };
        steps.push(step);

        if (review.status === "block") {
          return {
            requirementId,
            status: "blocked",
            fromStage: input.fromStage,
            toStage: input.toStage,
            stoppedAt: stage,
            steps
          };
        }
        continue;
      }

      if (stage === "product_model") {
        try {
          await this.clarify.assertGateSatisfied(requirementId, "product_model");
        } catch (error) {
          if (error instanceof ClarifyGateError) {
            steps.push({
              stage,
              status: "blocked",
              summary: "Clarify gate 未通过，当前不能进入 product model。",
              missingFieldKeys: error.missingFieldKeys
            });
            return {
              requirementId,
              status: "blocked",
              fromStage: input.fromStage,
              toStage: input.toStage,
              stoppedAt: stage,
              steps
            };
          }
          throw error;
        }

        await this.generation.generateProductModel(requirementId);
        const review = await this.review.run(requirementId, "product_model");
        steps.push({
          stage,
          status: review.status === "block" ? "blocked" : review.status === "warning" ? "warning" : "completed",
          summary: review.summary,
          reviewId: review.id,
          artifactKeys: ["productModel"]
        });

        if (review.status === "block" || (review.status === "warning" && mode === "stop_on_block")) {
          return {
            requirementId,
            status: "blocked",
            fromStage: input.fromStage,
            toStage: input.toStage,
            stoppedAt: stage,
            steps
          };
        }
        continue;
      }

      if (stage === "prd") {
        try {
          await this.clarify.assertGateSatisfied(requirementId, "prd");
        } catch (error) {
          if (error instanceof ClarifyGateError) {
            steps.push({
              stage,
              status: "blocked",
              summary: "Clarify gate 未通过，当前不能进入 PRD。",
              missingFieldKeys: error.missingFieldKeys
            });
            return {
              requirementId,
              status: "blocked",
              fromStage: input.fromStage,
              toStage: input.toStage,
              stoppedAt: stage,
              steps
            };
          }
          throw error;
        }

        await this.generation.generatePrd(requirementId);
        const review = await this.review.run(requirementId, "prd");
        const patchIds: string[] = [];
        if (autoApplyPatches) {
          for (const patchDocument of review.requiredPatches) {
            await this.patch.apply(requirementId, patchDocument.id);
            patchIds.push(patchDocument.id);
          }
        }

        steps.push({
          stage,
          status: review.status === "block" ? "blocked" : review.status === "warning" ? "warning" : "completed",
          summary: review.summary,
          reviewId: review.id,
          patchIds,
          artifactKeys: ["prd"]
        });

        if (review.status === "block" || (review.status === "warning" && mode === "stop_on_block")) {
          return {
            requirementId,
            status: "blocked",
            fromStage: input.fromStage,
            toStage: input.toStage,
            stoppedAt: stage,
            steps
          };
        }
        continue;
      }

      if (stage === "wireframe") {
        await this.generation.generateWireframe(requirementId);
        await this.generation.annotateWireframe(requirementId);
        steps.push({
          stage,
          status: "completed",
          summary: "已生成 wireframe 与 annotations。",
          artifactKeys: ["wireframe", "annotations"]
        });
        continue;
      }

      if (stage === "ui") {
        await this.generation.generateUi(requirementId);
        steps.push({
          stage,
          status: "completed",
          summary: "已生成 UI。",
          artifactKeys: ["ui"]
        });
      }
    }

    return {
      requirementId,
      status: "completed",
      fromStage: input.fromStage,
      toStage: input.toStage,
      steps
    };
  }
}

function sliceStages(fromStage: PipelineStage, toStage: PipelineStage) {
  const fromIndex = orderedStages.indexOf(fromStage);
  const toIndex = orderedStages.indexOf(toStage);
  if (fromIndex < 0 || toIndex < 0 || fromIndex > toIndex) {
    throw new Error(`Invalid pipeline range: ${fromStage} -> ${toStage}`);
  }
  return orderedStages.slice(fromIndex, toIndex + 1);
}
