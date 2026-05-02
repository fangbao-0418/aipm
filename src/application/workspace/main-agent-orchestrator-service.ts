import { z } from "zod";
import { OpenAIClient } from "../../infrastructure/llm/openai-client.js";
import { WorkspaceProjectRepository } from "../../infrastructure/files/workspace-project-repository.js";
import type {
  WorkspaceBundle,
  WorkspaceMainAgentDecision,
  WorkspaceStageTaskPlan
} from "../../shared/types/workspace.js";

const decisionSchema = z.object({
  orchestrationStatus: z.enum(["planning", "executing", "reviewing", "awaiting_user_confirmation", "blocked"]),
  stageGoal: z.string(),
  shouldRunStageAgent: z.boolean(),
  shouldRunReview: z.boolean(),
  canAdvance: z.boolean(),
  userConfirmationRequired: z.boolean(),
  blockers: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  suggestedActions: z.array(z.string()).default([]),
  responseCard: z.object({
    status: z.enum(["blocked", "working", "ready"]),
    headline: z.string(),
    summary: z.string(),
    bullets: z.array(z.string()).default([]),
    ctaLabel: z.string().optional()
  }),
  chatResponse: z.string()
});

export class MainAgentOrchestratorService {
  constructor(
    private readonly repository: WorkspaceProjectRepository,
    private readonly stageAgentService: {
      generateCurrentStageTaskPlan(
        bundle: WorkspaceBundle,
        options?: {
          signal?: AbortSignal;
          onLlmDelta?: (delta: string) => void | Promise<void>;
        }
      ): Promise<WorkspaceStageTaskPlan>;
    }
  ) {}

  async buildWorkspaceView(
    projectId: string,
    options?: {
      signal?: AbortSignal;
      onStatus?: (status: string) => void | Promise<void>;
      onLlmDelta?: (payload: { source: "stage-plan" | "main-agent"; delta: string }) => void | Promise<void>;
    }
  ): Promise<WorkspaceBundle> {
    await options?.onStatus?.("正在读取项目空间");
    const bundle = await this.repository.buildBundle(projectId);
    throwIfAborted(options?.signal);
    await options?.onStatus?.("正在生成当前阶段任务计划");
    const currentStageTaskPlan = await this.stageAgentService.generateCurrentStageTaskPlan(bundle, {
      signal: options?.signal,
      onLlmDelta: (delta: string) => options?.onLlmDelta?.({ source: "stage-plan", delta })
    });
    throwIfAborted(options?.signal);
    await options?.onStatus?.("正在生成主 Agent 阶段审视结论");
    const mainAgentDecision = await this.generateDecision(bundle, currentStageTaskPlan, {
      signal: options?.signal,
      onLlmDelta: (delta) => options?.onLlmDelta?.({ source: "main-agent", delta })
    });
    throwIfAborted(options?.signal);
    await options?.onStatus?.("正在写入主 Agent 审视日志");
    await this.repository.saveMainAgentRun(projectId, mainAgentDecision, currentStageTaskPlan);
    await options?.onStatus?.("当前阶段结果已准备完成");
    return {
      ...bundle,
      currentStageTaskPlan,
      mainAgentDecision
    };
  }

  async generateDecision(
    bundle: WorkspaceBundle,
    plan: WorkspaceStageTaskPlan,
    options?: {
      signal?: AbortSignal;
      onLlmDelta?: (delta: string) => void | Promise<void>;
    }
  ): Promise<WorkspaceMainAgentDecision> {
    const llm = await this.createProjectLlm(bundle.project.id, plan.stage === "requirement-structure" ? "structure" : "capture");
    const fallback = buildFallbackDecision(bundle, plan);

    if (!llm) {
      return fallback;
    }

    try {
      const baseArgs = {
        systemPrompt: `${bundle.project.systemPrompt ?? "你是资深产品负责人。"}\n你是 AIPM 的主编排 Agent。请判断当前阶段是否满足进入条件，并给出推进建议。responseCard 必须面向用户表达，像一个持续跟进的产品专家，不要写成系统日志。`,
        userPrompt: JSON.stringify({
          project: {
            id: bundle.project.id,
            name: bundle.project.name,
            currentStage: bundle.project.currentStage
          },
          currentStageTaskPlan: plan
        }, null, 2),
        temperature: 0.2
      };
      const result = options?.onLlmDelta
        ? await llm.generateJsonStream(decisionSchema, {
            ...baseArgs,
            signal: options.signal,
            onToken: options.onLlmDelta
          })
        : await llm.generateJson(decisionSchema, baseArgs);

      return {
        ...fallback,
        orchestrationStatus: result.orchestrationStatus,
        stageGoal: result.stageGoal,
        shouldRunStageAgent: result.shouldRunStageAgent,
        shouldRunReview: result.shouldRunReview,
        canAdvance: result.canAdvance && plan.advanceGate.canAdvance,
        userConfirmationRequired: result.userConfirmationRequired,
        blockers: result.blockers.length > 0 ? result.blockers : fallback.blockers,
        warnings: result.warnings.length > 0 ? result.warnings : fallback.warnings,
        suggestedActions: result.suggestedActions.length > 0 ? result.suggestedActions : fallback.suggestedActions,
        responseCard: {
          status: result.responseCard.status,
          headline: result.responseCard.headline,
          summary: result.responseCard.summary,
          bullets: result.responseCard.bullets.length > 0 ? result.responseCard.bullets : fallback.responseCard.bullets,
          ctaLabel: result.responseCard.ctaLabel ?? fallback.responseCard.ctaLabel
        },
        chatResponse: result.chatResponse,
        suggestedNextStage: plan.advanceGate.nextStage
      };
    } catch {
      return fallback;
    }
  }

  private async createProjectLlm(projectId: string, stage: "capture" | "structure") {
    const settings = await this.repository.getLlmSettings(projectId);
    if (settings.provider !== "openai" && settings.provider !== "openai-compatible") {
      return null;
    }
    const apiKey = await this.repository.getStoredApiKey(projectId) ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return null;
    }
    const model = settings.stageModelRouting[stage] ?? process.env.OPENAI_MODEL ?? (stage === "capture" ? "gpt-5-mini" : "gpt-5.2");
    return new OpenAIClient(
      apiKey,
      settings.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      model
    );
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    const reason = signal.reason instanceof Error ? signal.reason : new Error("Bundle stream aborted");
    throw reason;
  }
}

function buildFallbackDecision(bundle: WorkspaceBundle, plan: WorkspaceStageTaskPlan): WorkspaceMainAgentDecision {
  const hasBlockers = plan.advanceGate.blockingIssues.length > 0;
  const canAdvance = plan.advanceGate.canAdvance;
  const responseCard = hasBlockers
    ? {
        status: "blocked" as const,
        headline: "当前还不建议进入下一阶段",
        summary: "我已经审视过当前阶段，先把阻塞项补齐，再推进会更稳。",
        bullets: [
          ...plan.advanceGate.blockingIssues.slice(0, 3),
          ...plan.advanceGate.warnings.slice(0, 2)
        ],
        ctaLabel: undefined
      }
    : canAdvance
    ? {
        status: "ready" as const,
        headline: "当前阶段已经具备推进条件",
        summary: "需求点文档已经达到当前门禁要求，可以进入下一阶段，但建议先由你确认。",
        bullets: [
          `当前阶段目标：${plan.stageGoal}`,
          ...plan.recommendedUserActions.slice(0, 2)
        ],
        ctaLabel: plan.advanceGate.nextStage ? `进入${labelStage(plan.advanceGate.nextStage)}` : "进入下一阶段"
      }
    : {
        status: "working" as const,
        headline: "当前阶段还在收敛中",
        summary: "我建议继续补充来源或重新整理文档，等当前阶段更清晰后再推进。",
        bullets: [
          ...plan.recommendedUserActions.slice(0, 3),
          ...plan.advanceGate.warnings.slice(0, 2)
        ],
        ctaLabel: undefined
      };

  return {
    runId: `orchestrator-${bundle.project.id}-${bundle.project.currentStage}-${Date.now()}`,
    currentStage: bundle.project.currentStage,
    orchestrationStatus: hasBlockers
      ? "blocked"
      : canAdvance
      ? "awaiting_user_confirmation"
      : plan.status === "running"
      ? "executing"
      : "reviewing",
    stageGoal: plan.stageGoal,
    shouldRunStageAgent: !canAdvance,
    stageAgentType: plan.agentType,
    shouldRunReview: true,
    canAdvance,
    suggestedNextStage: plan.advanceGate.nextStage,
    userConfirmationRequired: plan.advanceGate.requiresUserConfirmation,
    blockers: plan.advanceGate.blockingIssues,
    warnings: plan.advanceGate.warnings,
    suggestedActions: plan.recommendedUserActions,
    responseCard,
    chatResponse: hasBlockers
      ? `当前阶段还有 ${plan.advanceGate.blockingIssues.length} 个阻塞项，建议先补齐后再继续推进。`
      : canAdvance
      ? `当前阶段已满足进入条件，是否进入下一阶段${plan.advanceGate.nextStage ? `：${plan.advanceGate.nextStage}` : ""}？`
      : `当前阶段正在推进中，建议先完成任务计划里的剩余项。`
  };
}

function labelStage(stage: WorkspaceMainAgentDecision["suggestedNextStage"]) {
  const labels = {
    "requirement-collection": "需求采集",
    "requirement-structure": "需求结构化",
    "requirement-clarification": "需求澄清",
    "product-model": "产品模型",
    "prd": "PRD",
    "prototype": "原型",
    "prototype-annotation": "原型标注",
    "ui-draft": "UI 稿",
    "review": "Review / 导出"
  } as const;

  return stage ? labels[stage] : "下一阶段";
}
