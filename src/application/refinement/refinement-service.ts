import type { RequirementStore } from "../../domain/requirement/requirement-store.js";
import type { ArtifactStore } from "../../domain/artifact/artifact-store.js";
import {
  patchDocumentSchema,
  refineChatSessionSchema,
  refineResponseSchema,
  wireframeAnnotationsDocumentSchema,
  type PatchDocument,
  type PrdDocument,
  type RefineChatSession,
  type RefineResponse,
  type UiDesign,
  type WireframeSpec
} from "../../shared/types/artifacts.js";
import { nowIso } from "../../shared/utils/time.js";
import { OpenAIClient } from "../../infrastructure/llm/openai-client.js";
import { PromptCatalog } from "../../infrastructure/llm/prompt-catalog.js";
import { loadAiRuntimeConfig, type AiRuntimeConfig } from "../../infrastructure/llm/ai-config.js";
import { ProjectContext } from "../../infrastructure/files/project-context.js";
import { TaskService } from "../task/task-service.js";
import type { PriorityLevel } from "../../shared/types/models.js";
import type { TaskType } from "../../shared/types/tasks.js";
import { PatchService } from "../patch/patch-service.js";

type RefineStage = "analysis" | "prd" | "wireframe" | "ui";

export class RefinementService {
  private readonly llm: OpenAIClient;
  private readonly prompts: PromptCatalog;
  private aiConfig?: AiRuntimeConfig;

  constructor(
    private readonly requirements: RequirementStore,
    private readonly artifacts: ArtifactStore,
    private readonly tasks: TaskService,
    private readonly patches: PatchService,
    private readonly context: ProjectContext,
    llm?: OpenAIClient
  ) {
    this.llm = llm ?? new OpenAIClient();
    this.prompts = new PromptCatalog(context);
  }

  async getChatSession(requirementId: string) {
    try {
      return await this.artifacts.getChatSession(requirementId);
    } catch {
      return refineChatSessionSchema.parse({
        requirementId,
        updatedAt: nowIso(),
        messages: []
      });
    }
  }

  async chat(
    requirementId: string,
    message: string,
    options?: { currentStage?: RefineStage; currentPageId?: string }
  ) {
    if (!message.trim()) {
      throw new Error("Chat message is required");
    }

    const requirement = await this.requirements.getRequirement(requirementId);
    const session = await this.getChatSession(requirementId);
    let bundle = await this.loadBundle(requirementId);
    const createdAt = nowIso();
    const userMessage = {
      id: `msg-${Date.now()}-user`,
      role: "user" as const,
      content: message.trim(),
      createdAt
    };

    const nextMessages = [...session.messages, userMessage];
    const appliedPatches = await this.applyStagePatches(
      requirementId,
      userMessage.id,
      options?.currentStage,
      options?.currentPageId,
      message.trim(),
      bundle
    );
    if (appliedPatches.length > 0) {
      bundle = await this.loadBundle(requirementId);
    }

    const response = this.llm.enabled
      ? await this.chatWithAi(requirementId, nextMessages, bundle, options?.currentStage, appliedPatches)
      : buildRefineTemplateResponse(requirement.title, message, bundle, options?.currentStage, appliedPatches);
    const assistantMessage = {
      id: `msg-${Date.now()}-assistant`,
      role: "assistant" as const,
      content: response.reply,
      createdAt: nowIso()
    };

    const nextSession: RefineChatSession = refineChatSessionSchema.parse({
      requirementId,
      updatedAt: assistantMessage.createdAt,
      messages: [...nextMessages, assistantMessage],
      lastAssistantResponse: response
    });

    await this.artifacts.saveChatSession(requirementId, nextSession);
    await this.requirements.appendChangelog({
      type: "refine.chat",
      requirementId,
      stage: options?.currentStage,
      patchIds: appliedPatches.map((item) => item.patch.id),
      at: assistantMessage.createdAt
    });

    return {
      session: nextSession,
      appliedPatches: appliedPatches.map((item) => ({
        patchId: item.patch.id,
        artifactType: item.artifactType,
        summary: item.patch.summary ?? ""
      }))
    };
  }

  async createTaskFromAnnotation(
    requirementId: string,
    annotationId: string,
    input?: {
      title?: string;
      type?: TaskType;
      priority?: PriorityLevel;
    }
  ) {
    const annotationsDocument = await this.artifacts.getWireframeAnnotations(requirementId);
    const annotation = annotationsDocument.annotations.find((item) => item.id === annotationId);
    if (!annotation) {
      throw new Error(`Annotation not found: ${annotationId}`);
    }

    const task = await this.tasks.create({
      title: input?.title ?? annotation.title,
      type: input?.type ?? "product",
      priority: input?.priority ?? "P1",
      description: annotation.description,
      sourceRequirementIds: [requirementId],
      linkedAnnotationIds: [annotationId],
      acceptanceCriteria: [
        "完成标注对应的问题收敛",
        "更新原型或文档后与标注保持一致"
      ]
    });

    const updatedAnnotations = wireframeAnnotationsDocumentSchema.parse({
      ...annotationsDocument,
      generatedAt: nowIso(),
      annotations: annotationsDocument.annotations.map((item) =>
        item.id === annotationId
          ? { ...item, linkedTaskIds: Array.from(new Set([...item.linkedTaskIds, task.id])) }
          : item
      )
    });

    await this.artifacts.saveWireframeAnnotations(requirementId, updatedAnnotations);
    await this.requirements.appendChangelog({
      type: "annotation.task_created",
      requirementId,
      annotationId,
      taskId: task.id,
      at: nowIso()
    });

    return { task, annotations: updatedAnnotations };
  }

  async linkExistingTaskToAnnotation(requirementId: string, annotationId: string, taskId: string) {
    const [annotationsDocument, task] = await Promise.all([
      this.artifacts.getWireframeAnnotations(requirementId),
      this.tasks.get(taskId)
    ]);
    const annotation = annotationsDocument.annotations.find((item) => item.id === annotationId);
    if (!annotation) {
      throw new Error(`Annotation not found: ${annotationId}`);
    }

    await this.tasks.update(taskId, {
      addLinkedAnnotationId: [annotationId]
    });

    const updatedAnnotations = wireframeAnnotationsDocumentSchema.parse({
      ...annotationsDocument,
      generatedAt: nowIso(),
      annotations: annotationsDocument.annotations.map((item) =>
        item.id === annotationId
          ? { ...item, linkedTaskIds: Array.from(new Set([...item.linkedTaskIds, task.id])) }
          : item
      )
    });

    await this.artifacts.saveWireframeAnnotations(requirementId, updatedAnnotations);
    return { task, annotations: updatedAnnotations };
  }

  private async chatWithAi(
    requirementId: string,
    messages: RefineChatSession["messages"],
    bundle: Record<string, unknown>,
    currentStage?: RefineStage,
    appliedPatches: Array<{ patch: PatchDocument; artifactType: string }> = []
  ) {
    const systemPrompt = await this.prompts.getSystemPrompt(
      "refine.system",
      "你是一名产品落地协作助手，需要根据当前 requirement 和产物状态，给出下一步 refine 建议、推荐动作、任务拆分建议和必要的原型标注建议。输出必须结构化、务实、中文。"
    );

    return this.llm.generateJson(refineResponseSchema, {
      systemPrompt,
      temperature: await this.temperature("refine"),
      userPrompt: [
        "请根据以下 requirement 产物 bundle 与聊天上下文，生成一条 assistant 回复。",
        "要求：reply 要像团队协作消息，不要空话；recommendedActions 最多 4 个；task seeds 要偏执行；annotation suggestions 只在必要时给出；如果已经应用 patch，要明确告诉用户已改到哪一层。",
        `requirementId: ${requirementId}`,
        `currentStage: ${currentStage ?? "unknown"}`,
        `appliedPatches:\n${JSON.stringify(appliedPatches, null, 2)}`,
        `bundle:\n${JSON.stringify(bundle, null, 2)}`,
        `messages:\n${JSON.stringify(messages.slice(-8), null, 2)}`
      ].join("\n\n")
    });
  }

  private async applyStagePatches(
    requirementId: string,
    sourceChatMessageId: string,
    currentStage: RefineStage | undefined,
    currentPageId: string | undefined,
    message: string,
    bundle: Awaited<ReturnType<RefinementService["loadBundle"]>>
  ) {
    if (!currentStage || currentStage === "analysis") {
      return [];
    }

    const stagePatches = await this.buildStagePatches(
      requirementId,
      sourceChatMessageId,
      currentStage,
      currentPageId,
      message,
      bundle
    );
    const applied: Array<{ patch: PatchDocument; artifactType: string }> = [];

    for (const patch of stagePatches) {
      await this.artifacts.savePatchDocument(requirementId, patch);
      const result = await this.patches.apply(requirementId, patch.id);
      applied.push({
        patch,
        artifactType: String(result.artifactType)
      });
    }

    return applied;
  }

  private async buildStagePatches(
    requirementId: string,
    sourceChatMessageId: string,
    currentStage: Exclude<RefineStage, "analysis">,
    currentPageId: string | undefined,
    message: string,
    bundle: Awaited<ReturnType<RefinementService["loadBundle"]>>
  ) {
    if (currentStage === "prd" && bundle.prd) {
      return [await this.buildPrdPatch(requirementId, sourceChatMessageId, message, bundle.prd)];
    }

    if (currentStage === "wireframe" && bundle.wireframe) {
      return [await this.buildWireframePatch(requirementId, sourceChatMessageId, message, bundle.wireframe, currentPageId)];
    }

    if (currentStage === "ui" && bundle.ui) {
      return [await this.buildUiPatch(requirementId, sourceChatMessageId, message, bundle.ui)];
    }

    return [];
  }

  private async buildPrdPatch(requirementId: string, sourceChatMessageId: string, message: string, prd: PrdDocument) {
    const operations: PatchDocument["operations"] = [
      {
        op: "replace",
        path: "/overview/summary",
        value: mergeNarrative(prd.overview.summary, message),
        reason: "把当前聊天里的修改意见直接回写到 PRD 摘要。"
      }
    ];

    if (looksLikeMetricInstruction(message)) {
      operations.push({
        op: "add",
        path: "/overview/successMetrics/-",
        value: compactLine(message),
        reason: "把聊天里提到的指标导向补进成功指标。"
      });
    } else if (looksLikeRiskInstruction(message)) {
      operations.push({
        op: "add",
        path: "/risks/-",
        value: compactLine(message),
        reason: "把聊天里提到的风险或约束补进 PRD 风险项。"
      });
    } else if (looksLikeFeatureInstruction(message)) {
      operations.push({
        op: "add",
        path: "/functionalRequirements/-",
        value: {
          id: nextFunctionalRequirementId(prd.functionalRequirements),
          title: summarizeTitle(message, "新增需求点"),
          description: compactLine(message),
          acceptanceCriteria: [
            "该需求点已落进 PRD 并能被后续原型引用",
            "交互和边界条件已在评审中可见"
          ]
        },
        reason: "把当前聊天中的新增能力要求补成一条 PRD 功能需求。"
      });
    } else {
      operations.push({
        op: "add",
        path: "/openQuestions/-",
        value: `待确认：${compactLine(message)}`,
        reason: "先把当前聊天变成待确认项，避免修改意图在下一轮丢失。"
      });
    }

    return this.createPatchDocument(requirementId, sourceChatMessageId, "prd", operations, "聊天回写 PRD");
  }

  private async buildWireframePatch(
    requirementId: string,
    sourceChatMessageId: string,
    message: string,
    wireframe: WireframeSpec,
    currentPageId?: string
  ) {
    const pageIndex = Math.max(
      0,
      wireframe.pages.findIndex((page) => page.id === currentPageId)
    );
    const page = wireframe.pages[pageIndex];
    const operations: PatchDocument["operations"] = [
      {
        op: "replace",
        path: `/pages/${pageIndex}/purpose`,
        value: mergeNarrative(page.purpose, message),
        reason: "把当前聊天里的原型调整方向回写到当前页面目的。"
      }
    ];

    if (page.sections.length > 0) {
      operations.push({
        op: "replace",
        path: `/pages/${pageIndex}/sections/0/objective`,
        value: mergeNarrative(page.sections[0].objective, message),
        reason: "同步更新当前页面首个区块的目标描述。"
      });
      operations.push({
        op: "add",
        path: `/pages/${pageIndex}/sections/0/notes/-`,
        value: compactLine(message),
        reason: "保留这次聊天对原型布局和内容的直接说明。"
      });
    }

    return this.createPatchDocument(requirementId, sourceChatMessageId, "wireframe", operations, `聊天回写原型页 ${page.name}`);
  }

  private async buildUiPatch(requirementId: string, sourceChatMessageId: string, message: string, ui: UiDesign) {
    const operations: PatchDocument["operations"] = [
      {
        op: "replace",
        path: "/visualThesis",
        value: mergeNarrative(ui.visualThesis, message),
        reason: "把当前聊天里的视觉方向直接回写到 UI 设计命题。"
      }
    ];

    if (ui.interactionThesis.length > 0) {
      operations.push({
        op: "replace",
        path: "/interactionThesis/0",
        value: compactLine(message),
        reason: "更新当前 UI 的首要交互原则。"
      });
    } else {
      operations.push({
        op: "add",
        path: "/interactionThesis/-",
        value: compactLine(message),
        reason: "把聊天要求补成一条新的交互原则。"
      });
    }

    operations.push({
      op: "replace",
      path: "/designStyle/tone",
      value: summarizeTone(ui.designStyle.tone, message),
      reason: "同步 UI 整体语气和风格走向。"
    });

    return this.createPatchDocument(requirementId, sourceChatMessageId, "ui", operations, "聊天回写 UI Draft");
  }

  private async createPatchDocument(
    requirementId: string,
    sourceChatMessageId: string,
    artifactType: PatchDocument["target"]["artifactType"],
    operations: PatchDocument["operations"],
    summary: string
  ) {
    const patchId = await this.artifacts.nextPatchId(requirementId);
    return patchDocumentSchema.parse({
      id: patchId,
      requirementId,
      sourceChatMessageId,
      target: { artifactType },
      summary,
      generator: "rule_engine",
      generatedAt: nowIso(),
      operations
    });
  }

  private async loadBundle(requirementId: string) {
    const requirement = await this.requirements.getRequirement(requirementId);

    let score = null;
    let productModel = null;
    let prd = null;
    let validation = null;
    let competitorAnalysis = null;
    let wireframe = null;
    let annotations = null;
    let ui = null;

    try { score = await this.requirements.getScore(requirementId); } catch {}
    try { productModel = await this.artifacts.getProductModel(requirementId); } catch {}
    try { prd = await this.artifacts.getPrdDocument(requirementId); } catch {}
    try { validation = await this.artifacts.getPrdValidation(requirementId); } catch {}
    try { competitorAnalysis = await this.artifacts.getCompetitorAnalysis(requirementId); } catch {}
    try { wireframe = await this.artifacts.getWireframeSpec(requirementId); } catch {}
    try { annotations = await this.artifacts.getWireframeAnnotations(requirementId); } catch {}
    try { ui = await this.artifacts.getUiDesign(requirementId); } catch {}

    return { requirement, score, productModel, prd, validation, competitorAnalysis, wireframe, annotations, ui };
  }

  private async temperature(key: keyof AiRuntimeConfig["temperature"]) {
    if (!this.aiConfig) {
      this.aiConfig = await loadAiRuntimeConfig(this.context);
    }
    return this.aiConfig.temperature[key];
  }
}

function buildRefineTemplateResponse(
  title: string,
  message: string,
  bundle: Record<string, unknown>,
  currentStage?: RefineStage,
  appliedPatches: Array<{ patch: PatchDocument; artifactType: string }> = []
): RefineResponse {
  const hasPrd = Boolean(bundle.prd);
  const hasWireframe = Boolean(bundle.wireframe);
  const hasUi = Boolean(bundle.ui);

  const recommendedActions = [];
  if (!bundle.productModel) {
    recommendedActions.push({ label: "先补 product model", action: "generate_product_model" as const, reason: "还没有统一中间模型。" });
  }
  if (!hasPrd) {
    recommendedActions.push({ label: "生成 PRD", action: "generate_prd" as const, reason: "需求还没有落到结构化 PRD。" });
  }
  if (hasPrd && !bundle.validation) {
    recommendedActions.push({ label: "验证 PRD", action: "validate_prd" as const, reason: "先确认文档完整度再往下走。" });
  }
  if (hasPrd && !hasWireframe) {
    recommendedActions.push({ label: "生成原型", action: "generate_wireframe" as const, reason: "需要把文档转成页面结构。" });
  }
  if (hasWireframe && !hasUi) {
    recommendedActions.push({ label: "生成 UI", action: "generate_ui" as const, reason: "已有线框，可以推进到视觉层。" });
  }

  return refineResponseSchema.parse({
    reply: appliedPatches.length > 0
      ? `我已经把你刚才的要求直接回写到 ${stageName(currentStage)} 里了：${appliedPatches.map((item) => item.patch.summary ?? item.patch.id).join("；")}。左侧内容现在应该已经是更新后的版本，你可以继续在这一阶段细改。`
      : `围绕“${title}”，我先根据你刚才这句“${message.trim()}”做了收敛。当前更适合优先处理缺口最大的阶段，再把结果回写到原型标注和执行任务里。`,
    recommendedActions: recommendedActions.slice(0, 4),
    suggestedTaskSeeds: [
      {
        title: `补齐 ${title} 的关键评审点`,
        type: "product",
        priority: "P1",
        description: "根据当前 refine 结果补充 PRD、原型或标注中缺失的规则与边界。",
        linkedAnnotationIds: [],
        acceptanceCriteria: ["缺失规则补齐", "评审问题有明确去向"]
      }
    ],
    annotationSuggestions: hasWireframe
      ? [{
          pageId: "page-home",
          kind: "review",
          title: "补充主路径决策说明",
          description: "如果这次 refine 会改变首页主流程，建议在首页主区块增加一条评审标注。"
        }]
      : []
  });
}

function mergeNarrative(current: string, message: string) {
  const cleaned = compactLine(message);
  if (!current.trim()) {
    return cleaned;
  }
  return `${current.trim()} 本轮补充：${cleaned}`;
}

function compactLine(message: string) {
  return message.trim().replace(/\s+/g, " ");
}

function looksLikeMetricInstruction(message: string) {
  return /(指标|转化|留存|完成率|点击率|付费|增长|metric)/i.test(message);
}

function looksLikeRiskInstruction(message: string) {
  return /(风险|安全|审核|举报|封禁|合规|约束)/i.test(message);
}

function looksLikeFeatureInstruction(message: string) {
  return /(新增|增加|支持|功能|模块|流程|能力)/i.test(message);
}

function nextFunctionalRequirementId(functionalRequirements: PrdDocument["functionalRequirements"]) {
  return `FR-${functionalRequirements.length + 1}`;
}

function summarizeTitle(message: string, fallback: string) {
  const cleaned = compactLine(message);
  return cleaned.length > 18 ? `${cleaned.slice(0, 18)}...` : cleaned || fallback;
}

function summarizeTone(currentTone: string, message: string) {
  const cleaned = compactLine(message);
  if (!cleaned) {
    return currentTone;
  }
  return cleaned.length > 42 ? cleaned.slice(0, 42) : cleaned;
}

function stageName(stage?: RefineStage) {
  switch (stage) {
    case "prd":
      return "PRD";
    case "wireframe":
      return "原型稿";
    case "ui":
      return "UI Draft";
    case "analysis":
      return "Requirement Analysis";
    default:
      return "当前阶段";
  }
}
