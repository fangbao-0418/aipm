import type { ArtifactStore } from "../../domain/artifact/artifact-store.js";
import type { RequirementStore } from "../../domain/requirement/requirement-store.js";
import {
  patchDocumentSchema,
  reviewResultSchema,
  type ClarifyQuestionPack,
  type PatchDocument,
  type ReviewResult
} from "../../shared/types/artifacts.js";
import { nowIso } from "../../shared/utils/time.js";
import { ClarifyService } from "../clarify/clarify-service.js";

type ReviewStage = "clarify" | "product_model" | "prd" | "wireframe" | "ui" | "safety";

export class ReviewService {
  constructor(
    private readonly requirements: RequirementStore,
    private readonly artifacts: ArtifactStore,
    private readonly clarify: ClarifyService
  ) {}

  async run(requirementId: string, stage: ReviewStage) {
    if (stage === "clarify") {
      return this.clarify.review(requirementId);
    }

    if (stage === "prd") {
      return this.reviewPrd(requirementId);
    }

    if (stage === "product_model") {
      return this.reviewProductModel(requirementId);
    }

    throw new Error(`Review stage is not implemented yet: ${stage}`);
  }

  async get(requirementId: string, reviewId: string) {
    return this.artifacts.getReviewResult(requirementId, reviewId);
  }

  async list(requirementId: string) {
    return this.artifacts.listReviewResults(requirementId);
  }

  private async reviewProductModel(requirementId: string) {
    const model = await this.artifacts.getProductModel(requirementId);
    const reviewId = await this.artifacts.nextReviewId(requirementId);
    const generatedAt = nowIso();
    const findings = [];

    if (model.meta.generator === "template") {
      findings.push({
        id: "finding-001",
        severity: "critical" as const,
        category: "coverage" as const,
        title: "Product model 仍为模板回退结果",
        message: "当前 product model 来自模板回退，不能作为正式 PRD 的稳定输入。",
        suggestion: "请配置 AI 生成链路，并在 clarify 通过后重新生成。",
        location: {
          artifactType: "product_model" as const,
          fieldPath: "/meta/generator"
        }
      });
    }

    if (model.features.length < 3) {
      findings.push({
        id: `finding-${String(findings.length + 1).padStart(3, "0")}`,
        severity: "major" as const,
        category: "coverage" as const,
        title: "功能拆解偏少",
        message: "当前 product model 的功能点过少，后续 PRD 容易过于抽象。",
        suggestion: "至少补到主流程、关键状态和管理/例外三个层次。",
        location: {
          artifactType: "product_model" as const,
          fieldPath: "/features"
        }
      });
    }

    return this.persistReview(requirementId, reviewId, generatedAt, {
      stage: "product_model",
      artifactRef: "context/product-model.json",
      summary: findings.length === 0
        ? "Product model 结构完整，可以继续进入 PRD。"
        : "Product model 仍有需要修正的问题。",
      findings,
      requiredPatches: [],
      status: findings.some((item) => item.severity === "critical") ? "block" : findings.length > 0 ? "warning" : "pass",
      reviewerName: "product-model-reviewer",
      canContinue: findings.length === 0
    });
  }

  private async reviewPrd(requirementId: string) {
    const [requirement, prd] = await Promise.all([
      this.requirements.getRequirement(requirementId),
      this.artifacts.getPrdDocument(requirementId)
    ]);

    let clarifyPack: ClarifyQuestionPack | null = null;
    try {
      clarifyPack = await this.artifacts.getClarifyQuestionPack(requirementId);
    } catch {}

    const reviewId = await this.artifacts.nextReviewId(requirementId);
    const generatedAt = nowIso();
    const findings = [];
    const requiredPatches: PatchDocument[] = [];
    const clarifyScenario = typeof clarifyPack?.answeredFieldMap.coreScenario === "string"
      ? clarifyPack.answeredFieldMap.coreScenario
      : "";

    if (prd.meta.generator === "template") {
      findings.push({
        id: "finding-001",
        severity: "critical" as const,
        category: "coverage" as const,
        title: "PRD 仍为模板回退结果",
        message: "当前 PRD 不是正式 AI 生成产物，不能作为真实设计与研发评审输入。",
        suggestion: "请完成 clarify 并启用正式模型后重新生成。",
        location: {
          artifactType: "prd" as const,
          fieldPath: "/meta/generator"
        }
      });

      requiredPatches.push(await this.createPatch(requirementId, reviewId, {
        artifactType: "prd",
        summary: "把模板摘要替换成更贴近业务场景的描述",
        operations: [
          {
            op: "replace",
            path: "/overview/summary",
            value: clarifyScenario
              ? `${requirement.title} 第一版 PRD，首发聚焦“${clarifyScenario}”主闭环，并以前置安全规则和转化路径为设计约束。`
              : `${requirement.title} 第一版 PRD，需要把目标用户、主流程和安全约束落成正式方案。`,
            reason: "先替换模板化摘要，避免继续沿用泛化表达。"
          }
        ]
      }));
    }

    const clarifiedTargetUsers = normalizeTargetUsers(clarifyPack?.answeredFieldMap.targetUsers);
    const currentTargetUsers = prd.targetUsers.map((item) => item.name).filter(Boolean);
    if (clarifiedTargetUsers.length > 0 && !sameStringArray(clarifiedTargetUsers, currentTargetUsers)) {
      findings.push({
        id: `finding-${String(findings.length + 1).padStart(3, "0")}`,
        severity: "major" as const,
        category: "consistency" as const,
        title: "PRD 目标用户与澄清结果不一致",
        message: "当前 PRD 的 targetUsers 没有使用 clarify 阶段确认的目标用户。",
        suggestion: "用澄清结果替换目标用户描述，并同步到需求、页面和成功指标。",
        location: {
          artifactType: "prd" as const,
          fieldPath: "/targetUsers"
        }
      });

      requiredPatches.push(await this.createPatch(requirementId, reviewId, {
        artifactType: "prd",
        summary: "同步澄清后的目标用户到 PRD",
        operations: [
          {
            op: "replace",
            path: "/targetUsers",
            value: clarifiedTargetUsers.map((name) => ({
              name,
              needs: [`希望 ${requirement.title} 能更高效满足其社交或匹配需求`],
              scenarios: [`围绕 ${requirement.title} 完成首轮匹配与后续互动`]
            })),
            reason: "使用 clarify 中确认的目标用户覆盖通用占位内容。"
          }
        ]
      }));
    }

    const safetyAnswer = typeof clarifyPack?.answeredFieldMap.safetyRules === "string"
      ? clarifyPack.answeredFieldMap.safetyRules
      : "";
    const hasSafetyRisk = prd.risks.some((item) => /(安全|审核|举报|封禁|实名|未成年人)/.test(item));
    if (safetyAnswer && !hasSafetyRisk) {
      findings.push({
        id: `finding-${String(findings.length + 1).padStart(3, "0")}`,
        severity: "major" as const,
        category: "safety" as const,
        title: "PRD 缺少安全与审核风险",
        message: "clarify 已给出安全规则，但 PRD 风险部分没有体现审核、实名或举报封禁风险。",
        suggestion: "至少补一条安全风险，并在功能范围或开放问题里体现审核约束。",
        location: {
          artifactType: "prd" as const,
          fieldPath: "/risks"
        }
      });

      requiredPatches.push(await this.createPatch(requirementId, reviewId, {
        artifactType: "prd",
        summary: "补充 PRD 的安全与审核风险",
        operations: [
          {
            op: "add",
            path: "/risks/-",
            value: `安全与审核规则尚需落实到实名、举报封禁和内容审核流程，否则 ${requirement.title} 存在上线风险。`,
            reason: "补充 clarify 中已确认但 PRD 尚未体现的安全风险。"
          }
        ]
      }));
    }

    if (prd.openQuestions.length > 2) {
      findings.push({
        id: `finding-${String(findings.length + 1).padStart(3, "0")}`,
        severity: "minor" as const,
        category: "coverage" as const,
        title: "PRD 待确认项偏多",
        message: "开放问题过多会影响原型和 UI 的稳定推进。",
        suggestion: "先把 blocker 级开放问题前置收敛，再继续走交互和视觉。",
        location: {
          artifactType: "prd" as const,
          fieldPath: "/openQuestions"
        }
      });
    }

    if (prd.functionalRequirements.some((item) => item.acceptanceCriteria.length < 2)) {
      findings.push({
        id: `finding-${String(findings.length + 1).padStart(3, "0")}`,
        severity: "major" as const,
        category: "coverage" as const,
        title: "功能验收标准不足",
        message: "部分功能点没有足够清晰的验收标准，后续拆任务会出现理解偏差。",
        suggestion: "为每个核心功能补上主流程、状态反馈和异常兜底。",
        location: {
          artifactType: "prd" as const,
          fieldPath: "/functionalRequirements"
        }
      });
    }

    return this.persistReview(requirementId, reviewId, generatedAt, {
      stage: "prd",
      artifactRef: "prd/prd.json",
      summary: findings.length === 0
        ? "PRD 已通过最小规则审查，可以继续进入原型阶段。"
        : findings.some((item) => item.severity === "critical")
          ? "PRD 存在阻断问题，当前不应继续进入后续阶段。"
          : "PRD 已生成，但仍需先修补关键问题再继续。",
      findings,
      requiredPatches,
      status: findings.some((item) => item.severity === "critical") ? "block" : findings.length > 0 ? "warning" : "pass",
      reviewerName: "prd-rule-reviewer",
      canContinue: findings.length === 0
    });
  }

  private async createPatch(
    requirementId: string,
    reviewId: string,
    input: {
      artifactType: "prd" | "annotation";
      summary: string;
      operations: PatchDocument["operations"];
    }
  ) {
    const patch = patchDocumentSchema.parse({
      id: await this.artifacts.nextPatchId(requirementId),
      requirementId,
      sourceReviewId: reviewId,
      target: {
        artifactType: input.artifactType
      },
      summary: input.summary,
      generator: "rule_engine",
      generatedAt: nowIso(),
      operations: input.operations
    });
    await this.artifacts.savePatchDocument(requirementId, patch);
    return patch;
  }

  private async persistReview(
    requirementId: string,
    reviewId: string,
    generatedAt: string,
    input: {
      stage: "product_model" | "prd";
      artifactRef: string;
      summary: string;
      findings: ReviewResult["findings"];
      requiredPatches: PatchDocument[];
      status: ReviewResult["status"];
      reviewerName: string;
      canContinue: boolean;
    }
  ) {
    const review = reviewResultSchema.parse({
      id: reviewId,
      requirementId,
      stage: input.stage,
      artifactRef: input.artifactRef,
      reviewer: {
        kind: "rule_engine",
        name: input.reviewerName,
        version: "1.0.0"
      },
      status: input.status,
      score: input.status === "pass" ? 90 : input.status === "warning" ? 72 : 40,
      confidence: 0.84,
      summary: input.summary,
      canContinue: input.canContinue,
      blockingReason: input.status === "block" ? input.summary : undefined,
      findings: input.findings,
      requiredPatches: input.requiredPatches,
      recommendedActions: input.requiredPatches.length > 0
        ? [{ label: "应用 patch", action: "apply_patch", reason: "先修补规则问题再继续。" }]
        : input.canContinue
          ? [{ label: "进入下一阶段", action: "go_to_next_stage", reason: "当前审查未发现阻断项。" }]
          : [{ label: "重新生成", action: input.stage === "prd" ? "regenerate_prd" : "regenerate_model", reason: "先处理阻断问题。" }],
      generatedAt
    });

    await this.artifacts.saveReviewResult(requirementId, review);
    await this.requirements.appendChangelog({
      type: "review.completed",
      requirementId,
      reviewId,
      stage: input.stage,
      status: review.status,
      at: generatedAt
    });
    return review;
  }
}

function normalizeTargetUsers(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function sameStringArray(left: string[], right: string[]) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}
