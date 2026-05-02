import { z } from "zod";
import { OpenAIClient } from "../../infrastructure/llm/openai-client.js";
import { WorkspaceProjectRepository } from "../../infrastructure/files/workspace-project-repository.js";
import type {
  WorkspaceAdvanceGate,
  WorkspaceBundle,
  WorkspaceLlmSettings,
  WorkspaceRequirementCollection,
  WorkspaceRequirementStructure,
  WorkspaceStage,
  WorkspaceStagePlanInput,
  WorkspaceStagePlanTask,
  WorkspaceStageReviewItem,
  WorkspaceStageTaskPlan,
  WorkspaceStageType
} from "../../shared/types/workspace.js";
import { nowIso } from "../../shared/utils/time.js";

const taskPlanSchema = z.object({
  stageGoal: z.string(),
  tasks: z.array(z.object({
    title: z.string(),
    description: z.string(),
    taskType: z.enum(["analyze", "extract", "summarize", "clarify", "model", "draft", "annotate", "review", "patch", "export"]),
    status: z.enum(["pending", "running", "completed", "blocked"]),
    outputTargets: z.array(z.string()).default([]),
    doneWhen: z.array(z.string()).default([]),
    blockerReason: z.string().optional()
  })).default([]),
  reviewChecklist: z.array(z.object({
    label: z.string(),
    required: z.boolean(),
    passed: z.boolean(),
    message: z.string().optional()
  })).default([]),
  recommendedUserActions: z.array(z.string()).default([])
});

export class StageAgentService {
  constructor(private readonly repository: WorkspaceProjectRepository) {}

  async generateCurrentStageTaskPlan(
    bundle: WorkspaceBundle,
    options?: {
      signal?: AbortSignal;
      onLlmDelta?: (delta: string) => void | Promise<void>;
    }
  ): Promise<WorkspaceStageTaskPlan> {
    const currentStage = bundle.stages.find((stage) => stage.type === bundle.project.currentStage) ?? bundle.stages[0]!;
    const collection = getRequirementCollection(bundle);
    const structure = getRequirementStructure(bundle);
    const fallback = buildFallbackTaskPlan(bundle, currentStage, collection, structure);
    const llm = await this.createProjectLlm(bundle.project.id, "capture");

    if (!llm || !["requirement-collection", "requirement-structure"].includes(currentStage.type)) {
      return fallback;
    }

    try {
      const baseArgs = {
        systemPrompt: `你是 AIPM 的 ${getStageAgentType(currentStage.type)}。请为当前阶段输出结构化任务计划，要求任务可执行、可检查，并且聚焦当前阶段。`,
        userPrompt: JSON.stringify({
          project: {
            id: bundle.project.id,
            name: bundle.project.name,
            currentStage: bundle.project.currentStage
          },
          currentStage: {
            type: currentStage.type,
            name: currentStage.name,
            status: currentStage.status
          },
          requirementCollection: collection
            ? {
                aiSummary: collection.aiSummary,
                sourceRecordCount: collection.sourceRecords.length,
                uploadedFileCount: collection.uploadedFiles.length,
                userGoals: collection.structuredSnapshot.userGoals,
                coreScenarios: collection.structuredSnapshot.coreScenarios,
                coreFunctions: collection.structuredSnapshot.coreFunctions,
                constraints: collection.structuredSnapshot.constraints,
                followupQuestions: collection.followupQuestions
              }
            : null,
          requirementStructure: structure
            ? {
                userGoals: structure.userGoals,
                coreScenarios: structure.coreScenarios,
                coreFunctions: structure.coreFunctions,
                clarificationNeeded: structure.clarificationNeeded
              }
            : null
        }, null, 2),
        temperature: 0.2
      };
      const result = options?.onLlmDelta
        ? await llm.generateJsonStream(taskPlanSchema, {
            ...baseArgs,
            signal: options.signal,
            onToken: options.onLlmDelta
          })
        : await llm.generateJson(taskPlanSchema, baseArgs);

      const advanceGate = buildAdvanceGate(currentStage.type, currentStage, collection, structure);
      return {
        ...fallback,
        stageGoal: result.stageGoal,
        tasks: result.tasks.map((task, index) => ({
          taskId: `${currentStage.type}-task-${index + 1}`,
          title: task.title,
          description: task.description,
          taskType: task.taskType,
          status: task.status,
          outputTargets: task.outputTargets,
          doneWhen: task.doneWhen,
          blockerReason: task.blockerReason
        })),
        reviewChecklist: result.reviewChecklist.map((item, index) => ({
          id: `${currentStage.type}-review-${index + 1}`,
          label: item.label,
          required: item.required,
          passed: item.passed,
          message: item.message
        })),
        advanceGate,
        recommendedUserActions: result.recommendedUserActions.length > 0 ? result.recommendedUserActions : fallback.recommendedUserActions,
        status: advanceGate.blockingIssues.length > 0
          ? "blocked"
          : currentStage.status === "completed"
          ? "completed"
          : currentStage.status === "in-progress"
          ? "running"
          : "planned"
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

function getRequirementCollection(bundle: WorkspaceBundle) {
  return bundle.stages
    .find((stage) => stage.type === "requirement-collection")
    ?.artifacts.find((artifact) => artifact.type === "requirement-input")?.content as WorkspaceRequirementCollection | undefined;
}

function getRequirementStructure(bundle: WorkspaceBundle) {
  return bundle.stages
    .find((stage) => stage.type === "requirement-structure")
    ?.artifacts.find((artifact) => artifact.type === "requirement-structure")?.content as WorkspaceRequirementStructure | undefined;
}

function buildFallbackTaskPlan(
  bundle: WorkspaceBundle,
  currentStage: WorkspaceStage,
  collection?: WorkspaceRequirementCollection,
  structure?: WorkspaceRequirementStructure
): WorkspaceStageTaskPlan {
  const advanceGate = buildAdvanceGate(currentStage.type, currentStage, collection, structure);
  return {
    planId: `plan-${bundle.project.id}-${currentStage.type}`,
    projectId: bundle.project.id,
    stage: currentStage.type,
    agentType: getStageAgentType(currentStage.type),
    generatedAt: nowIso(),
    status: currentStage.status === "completed"
      ? "completed"
      : advanceGate.blockingIssues.length > 0
      ? "blocked"
      : currentStage.status === "in-progress"
      ? "running"
      : "planned",
    stageGoal: getStageGoal(currentStage.type),
    inputs: buildStageInputs(currentStage.type, collection, structure),
    tasks: buildStageTasks(currentStage.type, currentStage, collection, structure),
    reviewChecklist: buildStageReviewChecklist(currentStage.type, collection, structure),
    advanceGate,
    recommendedUserActions: [
      ...advanceGate.blockingIssues.slice(0, 2),
      ...advanceGate.warnings.slice(0, 2)
    ]
  };
}

function buildStageInputs(
  stage: WorkspaceStageType,
  collection?: WorkspaceRequirementCollection,
  structure?: WorkspaceRequirementStructure
): WorkspaceStagePlanInput[] {
  if (stage === "requirement-collection") {
    return [
      {
        sourceType: "source_record",
        sourceId: "source-records",
        label: "来源记录",
        required: true,
        satisfied: (collection?.sourceRecords.length ?? 0) > 0,
        note: `当前 ${collection?.sourceRecords.length ?? 0} 条`
      },
      {
        sourceType: "uploaded_file",
        sourceId: "uploaded-files",
        label: "上传文件",
        required: false,
        satisfied: (collection?.uploadedFiles.length ?? 0) > 0,
        note: `当前 ${collection?.uploadedFiles.length ?? 0} 份`
      }
    ];
  }

  if (stage === "requirement-structure") {
    return [
      {
        sourceType: "artifact",
        sourceId: "requirement-input",
        label: "需求采集文档",
        required: true,
        satisfied: Boolean(collection?.requirementsDocument?.trim()),
        note: collection?.lastOrganizedAt ? `最近整理于 ${collection.lastOrganizedAt}` : undefined
      }
    ];
  }

  return [{
    sourceType: "artifact",
    sourceId: stage,
    label: `${getStageLabel(stage)}输入`,
    required: true,
    satisfied: Boolean(structure || collection)
  }];
}

function buildStageTasks(
  stage: WorkspaceStageType,
  currentStage: WorkspaceStage,
  collection?: WorkspaceRequirementCollection,
  structure?: WorkspaceRequirementStructure
): WorkspaceStagePlanTask[] {
  if (stage === "requirement-collection") {
    const hasSources = (collection?.sourceRecords.length ?? 0) > 0 || (collection?.uploadedFiles.length ?? 0) > 0;
    const hasSummary = Boolean(collection?.aiSummary?.trim());
    const hasDocument = Boolean(collection?.requirementsDocument?.trim());
    return [
      {
        taskId: "capture-read-sources",
        title: "读取全部来源",
        description: "汇总来源记录和上传文件，形成完整输入上下文。",
        taskType: "extract",
        status: hasSources ? "completed" : currentStage.status === "in-progress" ? "running" : "pending",
        outputTargets: ["source-records", "source-files"],
        doneWhen: ["所有来源已纳入当前阶段上下文"]
      },
      {
        taskId: "capture-summarize",
        title: "生成来源摘要",
        description: "对多条来源记录和长文档做汇总分析。",
        taskType: "summarize",
        status: hasSummary ? "completed" : hasSources ? "running" : "pending",
        outputTargets: ["source-summary.json"],
        doneWhen: ["已能看到完整的来源摘要和关键点"]
      },
      {
        taskId: "capture-draft",
        title: "形成需求采集文档",
        description: "把来源汇总成可继续编辑的需求点文档。",
        taskType: "draft",
        status: hasDocument ? "completed" : hasSummary ? "running" : "pending",
        outputTargets: ["requirement-collection/requirements.md"],
        doneWhen: ["需求采集文档可读且覆盖主要需求点"]
      }
    ];
  }

  if (stage === "requirement-structure") {
    const hasStructure = Boolean(structure?.documentMarkdown?.trim());
    const hasGoals = (structure?.userGoals.length ?? 0) > 0;
    const hasFunctions = (structure?.coreFunctions.length ?? 0) > 0;
    return [
      {
        taskId: "structure-read-input",
        title: "读取需求采集文档",
        description: "读取需求采集阶段的文档与来源摘要。",
        taskType: "analyze",
        status: Boolean(collection?.requirementsDocument?.trim()) ? "completed" : "pending",
        outputTargets: ["requirement-collection/requirements.md"],
        doneWhen: ["需求采集文档已可用于结构化"]
      },
      {
        taskId: "structure-build",
        title: "整理结构化需求",
        description: "抽取用户目标、场景、功能、范围和风险。",
        taskType: "model",
        status: hasStructure ? "completed" : currentStage.status === "in-progress" ? "running" : "pending",
        outputTargets: ["requirement-structure/requirement-structure.md"],
        doneWhen: ["结构化需求文档已生成"]
      },
      {
        taskId: "structure-review",
        title: "检查是否可进入澄清",
        description: "检查核心目标、场景、功能是否已覆盖。",
        taskType: "review",
        status: hasGoals && hasFunctions ? "completed" : hasStructure ? "running" : "pending",
        outputTargets: ["requirement-structure/review.json"],
        doneWhen: ["结构化结果可进入需求澄清"]
      }
    ];
  }

  return [{
    taskId: `${stage}-plan`,
    title: `准备${getStageLabel(stage)}阶段`,
    description: "当前阶段的详细自动执行能力还在继续接入。",
    taskType: "analyze",
    status: currentStage.status === "completed" ? "completed" : "pending",
    outputTargets: [stage],
    doneWhen: ["阶段能力已接入"]
  }];
}

function buildStageReviewChecklist(
  stage: WorkspaceStageType,
  collection?: WorkspaceRequirementCollection,
  structure?: WorkspaceRequirementStructure
): WorkspaceStageReviewItem[] {
  if (stage === "requirement-collection") {
    return [
      {
        id: "capture-review-coverage",
        label: "来源是否已完整收录",
        required: true,
        passed: (collection?.sourceRecords.length ?? 0) > 0 || (collection?.uploadedFiles.length ?? 0) > 0,
        message: "至少需要一条来源记录或一份上传文件"
      },
      {
        id: "capture-review-goals",
        label: "是否已识别用户目标",
        required: true,
        passed: (collection?.structuredSnapshot.userGoals.length ?? 0) > 0
      },
      {
        id: "capture-review-functions",
        label: "是否已识别核心功能",
        required: true,
        passed: (collection?.structuredSnapshot.coreFunctions.length ?? 0) > 0
      },
      {
        id: "capture-review-dirty",
        label: "来源变更后是否已重新整理文档",
        required: true,
        passed: !collection?.sourceDirty,
        message: "来源记录或上传文件有更新，需先重新 AI 整理"
      }
    ];
  }

  if (stage === "requirement-structure") {
    return [
      {
        id: "structure-review-goals",
        label: "结构化文档包含用户目标",
        required: true,
        passed: (structure?.userGoals.length ?? 0) > 0
      },
      {
        id: "structure-review-scenarios",
        label: "结构化文档包含核心场景",
        required: true,
        passed: (structure?.coreScenarios.length ?? 0) > 0
      },
      {
        id: "structure-review-functions",
        label: "结构化文档包含核心功能",
        required: true,
        passed: (structure?.coreFunctions.length ?? 0) > 0
      }
    ];
  }

  return [{
    id: `${stage}-review`,
    label: `${getStageLabel(stage)}阶段已接入`,
    required: true,
    passed: false,
    message: "后续继续补齐该阶段的执行与审视规则"
  }];
}

function buildAdvanceGate(
  stage: WorkspaceStageType,
  currentStage: WorkspaceStage,
  collection?: WorkspaceRequirementCollection,
  structure?: WorkspaceRequirementStructure
): WorkspaceAdvanceGate {
  const nextStage = getNextStage(stage);
  const blockingIssues: string[] = [];
  const warnings: string[] = [];

  if (stage === "requirement-collection") {
    if ((collection?.sourceRecords.length ?? 0) === 0 && (collection?.uploadedFiles.length ?? 0) === 0) {
      blockingIssues.push("还没有任何来源记录或上传文件。");
    }
    if (collection?.sourceDirty) {
      blockingIssues.push("来源有新的变更，需求点文档还未重新整理。");
    }
    if ((collection?.structuredSnapshot.userGoals.length ?? 0) === 0) {
      blockingIssues.push("还没有识别出明确的用户目标。");
    }
    if ((collection?.structuredSnapshot.coreFunctions.length ?? 0) === 0) {
      blockingIssues.push("还没有识别出明确的核心功能。");
    }
    if ((collection?.followupQuestions.length ?? 0) > 0) {
      warnings.push(`还有 ${collection?.followupQuestions.length ?? 0} 个待补充问题。`);
    }
  } else if (stage === "requirement-structure") {
    if (!structure?.documentMarkdown?.trim()) {
      blockingIssues.push("结构化需求文档还未生成。");
    }
    if ((structure?.userGoals.length ?? 0) === 0) {
      blockingIssues.push("结构化结果缺少用户目标。");
    }
    if ((structure?.coreFunctions.length ?? 0) === 0) {
      blockingIssues.push("结构化结果缺少核心功能。");
    }
    if ((structure?.clarificationNeeded.length ?? 0) > 0) {
      warnings.push(`还有 ${structure?.clarificationNeeded.length ?? 0} 个待澄清项。`);
    }
  } else if (currentStage.status !== "completed") {
    warnings.push("当前阶段详细门禁还在持续接入。");
  }

  return {
    nextStage,
    canAdvance: blockingIssues.length === 0 && Boolean(nextStage),
    blockingIssues,
    warnings,
    requiresUserConfirmation: Boolean(nextStage)
  };
}

function getStageGoal(stage: WorkspaceStageType) {
  const goals: Record<WorkspaceStageType, string> = {
    "requirement-collection": "汇总全部来源，形成一版完整可编辑的需求采集文档。",
    "requirement-structure": "把需求采集文档整理成结构化需求点、范围、风险和待澄清项。",
    "requirement-clarification": "针对缺口信息发起澄清，形成可建模的完整需求。",
    "product-model": "基于完整需求建立统一产品模型。",
    "prd": "形成一版可评审的正式 PRD。",
    "prototype": "把 PRD 转成页面结构和交互骨架。",
    "prototype-annotation": "给原型补充交互、业务和数据标注。",
    "ui-draft": "在原型基础上生成图形化 UI 初稿。",
    "review": "对当前产物做审视、留痕和导出准备。"
  };
  return goals[stage];
}

function getStageAgentType(stage: WorkspaceStageType) {
  const types: Record<WorkspaceStageType, string> = {
    "requirement-collection": "capture-agent",
    "requirement-structure": "structuring-agent",
    "requirement-clarification": "clarify-agent",
    "product-model": "modeling-agent",
    "prd": "prd-agent",
    "prototype": "wireframe-agent",
    "prototype-annotation": "annotation-agent",
    "ui-draft": "ui-agent",
    "review": "review-agent"
  };
  return types[stage];
}

function getStageLabel(stage: WorkspaceStageType) {
  const labels: Record<WorkspaceStageType, string> = {
    "requirement-collection": "需求采集",
    "requirement-structure": "需求结构化",
    "requirement-clarification": "需求澄清",
    "product-model": "产品模型",
    "prd": "PRD",
    "prototype": "原型",
    "prototype-annotation": "原型标注",
    "ui-draft": "UI Draft",
    "review": "Review / 导出"
  };
  return labels[stage];
}

function getNextStage(stage: WorkspaceStageType): WorkspaceStageType | undefined {
  const order: WorkspaceStageType[] = [
    "requirement-collection",
    "requirement-structure",
    "requirement-clarification",
    "product-model",
    "prd",
    "prototype",
    "prototype-annotation",
    "ui-draft",
    "review"
  ];
  const index = order.indexOf(stage);
  return index >= 0 ? order[index + 1] : undefined;
}
