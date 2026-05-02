import type { RequirementStore } from "../../domain/requirement/requirement-store.js";
import type { ArtifactStore } from "../../domain/artifact/artifact-store.js";
import {
  type ClarifyQuestionPack,
  competitorAnalysisSchema,
  prdDocumentSchema,
  prdValidationSchema,
  type CompetitorAnalysis,
  type PrdDocument,
  type PrdValidation,
  type UiDesign,
  type WireframeAnnotationsDocument,
  type WireframeSpec,
  uiDesignSchema,
  wireframeAnnotationsDocumentSchema,
  wireframeSpecSchema
} from "../../shared/types/artifacts.js";
import { productModelSchema, type ProductModel } from "../../shared/types/product-model.js";
import { nowIso } from "../../shared/utils/time.js";
import { OpenAIClient } from "../../infrastructure/llm/openai-client.js";
import { loadAiRuntimeConfig, type AiRuntimeConfig } from "../../infrastructure/llm/ai-config.js";
import { PromptCatalog } from "../../infrastructure/llm/prompt-catalog.js";
import { renderPrdMarkdown, renderUiHtml, renderWireframeHtml } from "../../infrastructure/renderer/html-renderer.js";
import type { Requirement, ScoreRecord } from "../../shared/types/models.js";
import { ProjectContext } from "../../infrastructure/files/project-context.js";
import { ClarifyService } from "../clarify/clarify-service.js";

export class GenerationService {
  private readonly llm: OpenAIClient;
  private readonly prompts: PromptCatalog;
  private readonly context: ProjectContext;
  private aiConfig?: AiRuntimeConfig;
  private readonly clarify: ClarifyService;

  constructor(
    private readonly requirements: RequirementStore,
    private readonly artifacts: ArtifactStore,
    context: ProjectContext,
    llm?: OpenAIClient,
    clarifyService?: ClarifyService
  ) {
    this.llm = llm ?? new OpenAIClient();
    this.context = context;
    this.prompts = new PromptCatalog(context);
    this.clarify = clarifyService ?? new ClarifyService(requirements, artifacts);
  }

  async generateProductModel(requirementId: string) {
    const { requirement, score } = await this.loadRequirementContext(requirementId);
    const clarifyPack = await this.clarify.assertGateSatisfied(requirementId, "product_model");
    const generatedAt = nowIso();
    const model = this.llm.enabled
      ? await this.generateProductModelWithAi(requirement, score, clarifyPack, generatedAt)
      : buildProductModelTemplate(requirement, score, clarifyPack, generatedAt);

    await this.artifacts.saveProductModel(requirementId, model);
    await this.requirements.appendChangelog({
      type: "generation.product_model",
      requirementId,
      at: generatedAt
    });

    return { productModel: model };
  }

  async generatePrd(requirementId: string) {
    const { requirement, score } = await this.loadRequirementContext(requirementId);
    const clarifyPack = await this.clarify.assertGateSatisfied(requirementId, "prd");
    const productModel = await this.ensureProductModel(requirementId, requirement, score);
    const generatedAt = nowIso();
    const prdDocument = this.llm.enabled
      ? await this.generatePrdWithAi(requirement, score, productModel, clarifyPack, generatedAt)
      : buildPrdTemplate(requirement, score, productModel, clarifyPack, generatedAt);
    const prdMarkdown = renderPrdMarkdown(prdDocument);

    await this.artifacts.savePrdDocument(requirementId, prdDocument);
    await this.artifacts.savePrdMarkdown(requirementId, prdMarkdown);
    await this.requirements.appendChangelog({
      type: "generation.prd",
      requirementId,
      at: generatedAt
    });

    return { productModel, prdDocument, prdMarkdown };
  }

  async validatePrd(requirementId: string) {
    const { requirement, score } = await this.loadRequirementContext(requirementId);
    const productModel = await this.ensureProductModel(requirementId, requirement, score);
    const prdDocument = await this.ensurePrdDocument(requirementId, requirement, score, productModel);
    const generatedAt = nowIso();
    const validation = this.llm.enabled
      ? await this.validatePrdWithAi(requirement, score, productModel, prdDocument, generatedAt)
      : buildPrdValidationTemplate(requirement, prdDocument, generatedAt);

    await this.artifacts.savePrdValidation(requirementId, validation);
    await this.requirements.appendChangelog({
      type: "generation.prd_validation",
      requirementId,
      at: generatedAt
    });

    return validation;
  }

  async comparePrd(requirementId: string, competitors: string[]) {
    if (competitors.length === 0) {
      throw new Error("At least one competitor is required");
    }

    const { requirement, score } = await this.loadRequirementContext(requirementId);
    const productModel = await this.ensureProductModel(requirementId, requirement, score);
    const prdDocument = await this.ensurePrdDocument(requirementId, requirement, score, productModel);
    const generatedAt = nowIso();
    const analysis = this.llm.enabled
      ? await this.comparePrdWithAi(requirement, productModel, prdDocument, competitors, generatedAt)
      : buildCompetitorAnalysisTemplate(requirement, productModel, competitors, generatedAt);

    await this.artifacts.saveCompetitorAnalysis(requirementId, analysis);
    await this.requirements.appendChangelog({
      type: "generation.prd_competitor_analysis",
      requirementId,
      at: generatedAt
    });

    return analysis;
  }

  async generateWireframe(requirementId: string) {
    const { requirement, score } = await this.loadRequirementContext(requirementId);
    const productModel = await this.ensureProductModel(requirementId, requirement, score);
    const generatedAt = nowIso();
    const spec = this.llm.enabled
      ? await this.generateWireframeWithAi(requirement, productModel, generatedAt)
      : buildWireframeTemplate(requirement, productModel, generatedAt);

    await this.artifacts.saveWireframeSpec(requirementId, spec);
    for (const page of spec.pages) {
      await this.artifacts.saveWireframePage(requirementId, page.id, renderWireframeHtml(spec, page.id));
    }

    await this.requirements.appendChangelog({
      type: "generation.wireframe",
      requirementId,
      at: generatedAt
    });

    return spec;
  }

  async annotateWireframe(requirementId: string) {
    const { requirement, score } = await this.loadRequirementContext(requirementId);
    const productModel = await this.ensureProductModel(requirementId, requirement, score);
    const spec = await this.ensureWireframeSpec(requirementId, requirement, productModel);
    const generatedAt = nowIso();
    const annotations = this.llm.enabled
      ? await this.annotateWireframeWithAi(requirement, productModel, spec, generatedAt)
      : buildWireframeAnnotationsTemplate(requirement, spec, generatedAt);

    await this.artifacts.saveWireframeAnnotations(requirementId, annotations);
    await this.requirements.appendChangelog({
      type: "generation.wireframe_annotations",
      requirementId,
      at: generatedAt
    });

    return annotations;
  }

  async generateUi(requirementId: string) {
    const { requirement, score } = await this.loadRequirementContext(requirementId);
    const productModel = await this.ensureProductModel(requirementId, requirement, score);
    const spec = await this.ensureWireframeSpec(requirementId, requirement, productModel);
    const annotations = await this.ensureWireframeAnnotations(requirementId, requirement, productModel, spec);
    const generatedAt = nowIso();
    const design = this.llm.enabled
      ? await this.generateUiWithAi(requirement, productModel, spec, annotations, generatedAt)
      : buildUiDesignTemplate(requirement, productModel, spec, generatedAt);

    await this.artifacts.saveUiDesign(requirementId, design);
    for (const page of spec.pages) {
      await this.artifacts.saveUiPage(requirementId, page.id, renderUiHtml(spec, design, annotations, page.id));
    }
    await this.requirements.appendChangelog({
      type: "generation.ui",
      requirementId,
      at: generatedAt
    });

    return design;
  }

  private async loadRequirementContext(requirementId: string) {
    const requirement = await this.requirements.getRequirement(requirementId);
    let score: ScoreRecord | null = null;

    try {
      score = await this.requirements.getScore(requirementId);
    } catch {
      score = null;
    }

    return { requirement, score };
  }

  private async ensureProductModel(requirementId: string, requirement: Requirement, score: ScoreRecord | null) {
    try {
      return await this.artifacts.getProductModel(requirementId);
    } catch {
      const result = await this.generateProductModel(requirementId);
      return result.productModel;
    }
  }

  private async ensurePrdDocument(
    requirementId: string,
    requirement: Requirement,
    score: ScoreRecord | null,
    productModel: ProductModel
  ) {
    try {
      return await this.artifacts.getPrdDocument(requirementId);
    } catch {
      const result = await this.generatePrd(requirementId);
      return result.prdDocument;
    }
  }

  private async ensureWireframeSpec(requirementId: string, requirement: Requirement, productModel: ProductModel) {
    try {
      return await this.artifacts.getWireframeSpec(requirementId);
    } catch {
      return this.generateWireframe(requirementId);
    }
  }

  private async ensureWireframeAnnotations(
    requirementId: string,
    requirement: Requirement,
    productModel: ProductModel,
    spec: WireframeSpec
  ) {
    try {
      return await this.artifacts.getWireframeAnnotations(requirementId);
    } catch {
      return this.annotateWireframe(requirementId);
    }
  }

  private async generateProductModelWithAi(
    requirement: Requirement,
    score: ScoreRecord | null,
    clarifyPack: ClarifyQuestionPack,
    generatedAt: string
  ) {
    const systemPrompt = await this.prompts.getSystemPrompt(
      "product-model.system",
      "你是一名资深产品负责人，需要把模糊需求整理成结构化 product model，输出必须务实、可落地、能直接驱动后续 PRD / 原型 / UI 生成。"
    );
    return this.llm.generateJson(productModelSchema, {
      systemPrompt,
      temperature: await this.temperature("productModel"),
      userPrompt: [
        "请根据以下需求与评分信息生成 product model。",
        "要求：目标用户、功能、流程、页面都要具体；避免空泛表述；输出中文。",
        `generatedAt: ${generatedAt}`,
        `model: ${this.llm.model}`,
        `requirement:\n${JSON.stringify(requirement, null, 2)}`,
        `score:\n${JSON.stringify(score, null, 2)}`,
        `clarify:\n${JSON.stringify(clarifyPack.answeredFieldMap, null, 2)}`,
        `outputExample:\n${JSON.stringify(productModelExample(requirement.id, generatedAt, this.llm.model, clarifyPack), null, 2)}`
      ].join("\n\n")
    });
  }

  private async generatePrdWithAi(
    requirement: Requirement,
    score: ScoreRecord | null,
    productModel: ProductModel,
    clarifyPack: ClarifyQuestionPack,
    generatedAt: string
  ) {
    const systemPrompt = await this.prompts.getSystemPrompt(
      "prd.system",
      "你是一名能够把需求转成落地 PRD 的高级产品经理。输出结构化 PRD JSON，内容要可执行、可评审、可拆任务。"
    );
    return this.llm.generateJson(prdDocumentSchema, {
      systemPrompt,
      temperature: await this.temperature("prd"),
      userPrompt: [
        "请基于以下 requirement、score、productModel 生成 PRD 文档。",
        "要求：功能范围、验收标准、成功指标、风险和待确认项都要完整；输出中文。",
        `generatedAt: ${generatedAt}`,
        `model: ${this.llm.model}`,
        `requirement:\n${JSON.stringify(requirement, null, 2)}`,
        `score:\n${JSON.stringify(score, null, 2)}`,
        `clarify:\n${JSON.stringify(clarifyPack.answeredFieldMap, null, 2)}`,
        `productModel:\n${JSON.stringify(productModel, null, 2)}`,
        `outputExample:\n${JSON.stringify(prdExample(requirement.id, generatedAt, this.llm.model, productModel, clarifyPack), null, 2)}`
      ].join("\n\n")
    });
  }

  private async validatePrdWithAi(
    requirement: Requirement,
    score: ScoreRecord | null,
    productModel: ProductModel,
    prdDocument: PrdDocument,
    generatedAt: string
  ) {
    const systemPrompt = await this.prompts.getSystemPrompt(
      "prd-validate.system",
      "你是一名 PRD 评审助手，请从需求覆盖、逻辑闭环、验收标准、风险与落地性角度做严格验证。"
    );
    return this.llm.generateJson(prdValidationSchema, {
      systemPrompt,
      temperature: await this.temperature("prdValidate"),
      userPrompt: [
        "请验证以下 PRD，给出 readinessScore、问题列表和修正建议。",
        "要求：问题要具体，严重级别分为 critical/major/minor；输出中文。",
        `generatedAt: ${generatedAt}`,
        `model: ${this.llm.model}`,
        `requirement:\n${JSON.stringify(requirement, null, 2)}`,
        `score:\n${JSON.stringify(score, null, 2)}`,
        `productModel:\n${JSON.stringify(productModel, null, 2)}`,
        `prd:\n${JSON.stringify(prdDocument, null, 2)}`,
        `outputExample:\n${JSON.stringify(prdValidationExample(requirement.id, generatedAt, this.llm.model), null, 2)}`
      ].join("\n\n")
    });
  }

  private async comparePrdWithAi(
    requirement: Requirement,
    productModel: ProductModel,
    prdDocument: PrdDocument,
    competitors: string[],
    generatedAt: string
  ) {
    const systemPrompt = await this.prompts.getSystemPrompt(
      "prd-compare.system",
      "你是一名产品策略分析师，请基于给定竞品名称做结构化对比，不要编造精确事实，要聚焦通用产品策略、能力差异和机会点。"
    );
    return this.llm.generateJson(competitorAnalysisSchema, {
      systemPrompt,
      temperature: await this.temperature("prdCompare"),
      userPrompt: [
        "请对以下 PRD 做竞品对比分析。",
        "要求：每个竞品给出定位、优势、短板和对当前方案的启发；输出中文。",
        `generatedAt: ${generatedAt}`,
        `model: ${this.llm.model}`,
        `competitors:\n${JSON.stringify(competitors, null, 2)}`,
        `requirement:\n${JSON.stringify(requirement, null, 2)}`,
        `productModel:\n${JSON.stringify(productModel, null, 2)}`,
        `prd:\n${JSON.stringify(prdDocument, null, 2)}`,
        `outputExample:\n${JSON.stringify(competitorAnalysisExample(requirement.id, generatedAt, this.llm.model, competitors), null, 2)}`
      ].join("\n\n")
    });
  }

  private async generateWireframeWithAi(requirement: Requirement, productModel: ProductModel, generatedAt: string) {
    const systemPrompt = await this.prompts.getSystemPrompt(
      "wireframe.system",
      "你是一名交互设计师，需要把产品模型转成低保真线框结构。输出必须聚焦布局、区块职责与主操作，不要输出视觉风格描述。"
    );
    return this.llm.generateJson(wireframeSpecSchema, {
      systemPrompt,
      temperature: await this.temperature("wireframe"),
      userPrompt: [
        "请根据以下 requirement 和 productModel 生成 wireframe spec。",
        "要求：每个页面给出 layout 和 sections；输出中文。",
        `generatedAt: ${generatedAt}`,
        `model: ${this.llm.model}`,
        `requirement:\n${JSON.stringify(requirement, null, 2)}`,
        `productModel:\n${JSON.stringify(productModel, null, 2)}`,
        `outputExample:\n${JSON.stringify(wireframeExample(requirement.id, generatedAt, this.llm.model, productModel), null, 2)}`
      ].join("\n\n")
    });
  }

  private async annotateWireframeWithAi(
    requirement: Requirement,
    productModel: ProductModel,
    spec: WireframeSpec,
    generatedAt: string
  ) {
    const systemPrompt = await this.prompts.getSystemPrompt(
      "wireframe-annotate.system",
      "你是一名产品评审助手，需要对原型稿补充可执行标注，覆盖交互、业务、数据、评审和落地视角。"
    );
    return this.llm.generateJson(wireframeAnnotationsDocumentSchema, {
      systemPrompt,
      temperature: await this.temperature("wireframeAnnotate"),
      userPrompt: [
        "请根据以下需求、productModel 和 wireframe 生成标注文档。",
        "要求：标注要对评审和交付有帮助；输出中文。",
        `generatedAt: ${generatedAt}`,
        `model: ${this.llm.model}`,
        `requirement:\n${JSON.stringify(requirement, null, 2)}`,
        `productModel:\n${JSON.stringify(productModel, null, 2)}`,
        `wireframe:\n${JSON.stringify(spec, null, 2)}`,
        `outputExample:\n${JSON.stringify(wireframeAnnotationsExample(requirement.id, generatedAt, this.llm.model, spec), null, 2)}`
      ].join("\n\n")
    });
  }

  private async generateUiWithAi(
    requirement: Requirement,
    productModel: ProductModel,
    spec: WireframeSpec,
    annotations: WireframeAnnotationsDocument,
    generatedAt: string
  ) {
    const systemPrompt = await this.prompts.getSystemPrompt(
      "ui.system",
      "你是一名高级产品设计师，需要把原型稿转成可实现的 UI 设计说明。输出要包含视觉方向、颜色、字体和页面说明，风格要克制、有辨识度。"
    );
    return this.llm.generateJson(uiDesignSchema, {
      systemPrompt,
      temperature: await this.temperature("ui"),
      userPrompt: [
        "请根据以下 requirement、productModel、wireframe 和 annotations 生成 UI design spec。",
        "要求：输出中文，视觉方向明确，不要做成通用后台卡片风。",
        `generatedAt: ${generatedAt}`,
        `model: ${this.llm.model}`,
        `requirement:\n${JSON.stringify(requirement, null, 2)}`,
        `productModel:\n${JSON.stringify(productModel, null, 2)}`,
        `wireframe:\n${JSON.stringify(spec, null, 2)}`,
        `annotations:\n${JSON.stringify(annotations, null, 2)}`,
        `outputExample:\n${JSON.stringify(uiDesignExample(requirement.id, generatedAt, this.llm.model, spec), null, 2)}`
      ].join("\n\n")
    });
  }

  private async temperature(key: keyof AiRuntimeConfig["temperature"]) {
    if (!this.aiConfig) {
      this.aiConfig = await loadAiRuntimeConfig(this.context);
    }
    return this.aiConfig.temperature[key];
  }
}

function buildFeatures(
  title: string,
  raw: string,
  tags: string[],
  clarify?: ClarifyQuestionPack
) {
  const coreScenario = answerText(clarify, "coreScenario");
  const matchingMode = answerText(clarify, "matchingMode");
  const monetization = answerList(clarify, "monetization");
  const base = [
    {
      id: "feature-001",
      name: coreScenario ? `${coreScenario} 主流程` : `${title} 核心入口`,
      description: coreScenario
        ? `围绕“${coreScenario}”设计首页、发现、匹配与进入聊天的关键动作。`
        : `围绕需求“${raw}”提供统一入口和关键动作触发。`
    },
    {
      id: "feature-002",
      name: matchingMode ? `${matchingMode} 与推荐策略` : "状态与提醒",
      description: matchingMode
        ? `明确 ${matchingMode} 的触发条件、推荐结果展示和状态反馈。`
        : "对关键节点、变化和例外情况提供清晰反馈。"
    },
    {
      id: "feature-003",
      name: "安全与治理",
      description: "覆盖认证、举报、封禁、审核和异常场景处理。"
    }
  ];

  if (monetization.length > 0) {
    base.push({
      id: "feature-004",
      name: "变现与会员体系",
      description: `围绕 ${monetization.join("、")} 设计付费点、权益与转化路径。`
    });
  }

  if (tags.includes("billing")) {
    base.push({
      id: `feature-${String(base.length + 1).padStart(3, "0")}`,
      name: "账单与扣费透明化",
      description: "展示订阅状态、续费时间和取消路径。"
    });
  }

  return base;
}

function buildFlows(title: string, raw: string, clarify?: ClarifyQuestionPack) {
  const matchingMode = answerText(clarify, "matchingMode");
  const launchScope = answerText(clarify, "launchScope");
  return [
    {
      id: "flow-001",
      name: matchingMode ? `${title} 首次配对流程` : `${title} 首次使用流程`,
      steps: [
        "进入产品并完成必要的注册与基础资料填写",
        matchingMode ? `完成 ${matchingMode} 所需的偏好设置与候选浏览` : `完成与“${raw}”相关的首次设置`,
        "看到首个可执行的主行动或推荐结果"
      ]
    },
    {
      id: "flow-002",
      name: launchScope ? "首发版本主闭环" : "日常使用闭环",
      steps: [
        "查看当前状态与推荐结果",
        "处理关键提醒、审核反馈或待办",
        launchScope ? `在“${launchScope}”定义的范围内完成主任务并返回结果页` : "执行主任务并返回结果页"
      ]
    }
  ];
}

function buildPages(title: string, features: Array<{ name: string }>, clarify?: ClarifyQuestionPack) {
  const coreScenario = answerText(clarify, "coreScenario");
  const matchingMode = answerText(clarify, "matchingMode");
  return [
    {
      id: "page-home",
      name: coreScenario ? "发现页" : "首页",
      purpose: coreScenario
        ? `帮助用户快速进入 ${coreScenario} 的主工作流。`
        : `帮助用户快速进入 ${title} 的主工作流。`,
      modules: matchingMode ? ["候选推荐", "筛选条件", "主行动入口"] : ["页面摘要", "主行动入口", "状态提示"]
    },
    {
      id: "page-match",
      name: matchingMode ? "匹配页" : "详情页",
      purpose: matchingMode ? "承接匹配结果、破冰动作和状态反馈。" : "展示核心对象详情、状态和操作历史。",
      modules: matchingMode ? ["匹配结果", "破冰操作", "状态反馈"] : ["详情信息", "状态区", "操作区"]
    },
    {
      id: "page-safety",
      name: "安全与设置",
      purpose: "承接认证、举报封禁、审核和例外处理。",
      modules: features.slice(0, 3).map((item) => item.name)
    }
  ];
}

function buildProductModelTemplate(
  requirement: Requirement,
  score: ScoreRecord | null,
  clarifyPack: ClarifyQuestionPack,
  generatedAt: string
) {
  const title = requirement.title;
  const raw = requirement.rawContent;
  const clarifiedTargetUsers = answerList(clarifyPack, "targetUsers");
  const primaryUser = clarifiedTargetUsers[0] ?? requirement.targetUsers[0] ?? "待补充目标用户";
  const features = buildFeatures(title, raw, requirement.tags, clarifyPack);
  const flows = buildFlows(title, raw, clarifyPack);
  const pages = buildPages(title, features, clarifyPack);
  const coreScenario = answerText(clarifyPack, "coreScenario");
  const safetyRules = answerText(clarifyPack, "safetyRules");

  return productModelSchema.parse({
    meta: {
      requirementId: requirement.id,
      generatedAt,
      version: "0.2.0",
      generator: "template"
    },
    positioning: {
      title,
      summary: `${title} 的结构化产品模型，已结合 clarify 阶段确认的用户、场景和规则。`,
      targetUsers: clarifiedTargetUsers.length > 0 ? clarifiedTargetUsers : [primaryUser],
      problem: coreScenario ? `当前要解决的核心场景是：${coreScenario}。原始需求：${raw}` : raw,
      valueProposition: coreScenario
        ? `帮助目标用户围绕“${coreScenario}”完成关键匹配与互动闭环，并减少规则遗漏。`
        : `帮助用户围绕“${title}”完成核心任务，并减少流程阻塞与信息流失。`
    },
    goals: [
      `明确 ${title} 的核心用户价值`,
      `支撑当前优先级 ${score?.priorityLevel ?? requirement.priorityLevel ?? "未评分"} 的功能范围判断`,
      "为后续 PRD、原型和 UI 提供结构化输入"
    ],
    assumptions: [
      safetyRules ? `已纳入安全规则基线：${safetyRules}` : "当前需求未覆盖所有边界条件，默认以最小可落地方案建模。",
      "如评分、评审或竞品分析变化，应重新生成产物链路。"
    ],
    features,
    flows,
    pages,
    designStyle: {
      tone: "calm, precise, editorial-product",
      keywords: ["clarity", "structure", "follow-through"]
    },
    openQuestions: [
      answerText(clarifyPack, "regionAndCompliance") || "是否存在必须优先保障的业务指标或时间窗口？",
      answerText(clarifyPack, "launchScope") || "是否有明确对标产品、已有流程或组织约束？"
    ]
  });
}

function buildPrdTemplate(
  requirement: Requirement,
  score: ScoreRecord | null,
  productModel: ProductModel,
  clarifyPack: ClarifyQuestionPack,
  generatedAt: string
) {
  const targetUsers = answerList(clarifyPack, "targetUsers");
  const coreScenario = answerText(clarifyPack, "coreScenario");
  const monetization = answerList(clarifyPack, "monetization");
  const safetyRules = answerText(clarifyPack, "safetyRules");
  const launchScope = answerText(clarifyPack, "launchScope");
  return prdDocumentSchema.parse({
    meta: {
      requirementId: requirement.id,
      generatedAt,
      version: "0.2.0",
      generator: "template"
    },
    overview: {
      title: requirement.title,
      summary: coreScenario
        ? `${requirement.title} 面向 ${targetUsers.join("、")}，首发聚焦“${coreScenario}”主闭环。`
        : productModel.positioning.summary,
      background: `${requirement.rawContent}${launchScope ? `；首发范围：${launchScope}` : ""}`,
      businessGoal: monetization.length > 0
        ? `围绕 ${requirement.title} 建立 ${monetization.join("、")} 的转化路径，并提升关键流程完成率。`
        : `围绕 ${requirement.title} 提升流程效率、需求转化质量和跨角色协同稳定性。`,
      successMetrics: [
        coreScenario ? `${coreScenario} 主流程完成率提升` : "关键流程完成率提升",
        "有效互动或转化次数提升",
        "安全相关投诉率受控"
      ]
    },
    targetUsers: (targetUsers.length > 0 ? targetUsers : productModel.positioning.targetUsers).map((item) => ({
      name: item,
      needs: coreScenario
        ? [`希望更顺畅完成${coreScenario}相关的匹配与互动`, "希望平台有明确的安全与反馈机制"]
        : [`希望更快把“${requirement.title}”相关需求转成可执行方案`],
      scenarios: coreScenario
        ? [`在 ${requirement.title} 中完成首轮匹配`, "在安全规则明确的前提下继续互动"]
        : ["录入需求后自动生成结构化方案", "在评审时快速对齐范围与差异"]
    })),
    scope: {
      inScope: productModel.features.map((feature) => `${feature.name}：${feature.description}`),
      outOfScope: [
        "复杂组织权限体系",
        "跨团队流程审批自动化",
        "深度第三方业务系统对接"
      ]
    },
    functionalRequirements: productModel.features.map((feature, index) => ({
      id: `FR-${index + 1}`,
      title: feature.name,
      description: feature.description,
      acceptanceCriteria: [
        `用户可在 ${feature.name} 中完成关键操作`,
        "状态变化可见且有明确反馈",
        "异常场景有兜底路径"
      ]
    })),
    userFlows: productModel.flows.map((flow) => ({
      id: flow.id,
      name: flow.name,
      steps: flow.steps
    })),
    pages: productModel.pages.map((page) => ({
      id: page.id,
      name: page.name,
      purpose: page.purpose,
      keyModules: page.modules
    })),
    risks: [
      `当前优先级为 ${score?.priorityLevel ?? requirement.priorityLevel ?? "未评分"}，若资源受限需进一步收缩范围。`,
      safetyRules ? `安全规则需要进一步落到流程与审核策略：${safetyRules}` : "部分业务规则仍依赖补充澄清。",
      monetization.length > 0 ? `变现路径 ${monetization.join("、")} 需要与主流程平衡，避免过早打扰用户。` : "若竞品差异化不明确，UI 和交互容易趋同。"
    ],
    openQuestions: Array.from(new Set([...productModel.openQuestions, ...(launchScope ? [] : ["首发版本的明确范围是什么？"])]))
  });
}

function buildPrdValidationTemplate(requirement: Requirement, prdDocument: PrdDocument, generatedAt: string) {
  const findings: PrdValidation["findings"] = [];

  if (prdDocument.openQuestions.length > 2) {
    findings.push({
      id: "finding-open-questions",
      severity: "major",
      title: "待确认项偏多",
      detail: "PRD 中仍保留较多待确认项，说明需求边界尚未完全收敛。",
      suggestion: "先补齐关键规则和例外流程，再进入高保真设计或开发拆解。"
    });
  }

  if (prdDocument.functionalRequirements.some((item) => item.acceptanceCriteria.length < 2)) {
    findings.push({
      id: "finding-acceptance",
      severity: "major",
      title: "验收标准不足",
      detail: "部分功能点没有足够清晰的验收标准，后续任务拆解会出现理解偏差。",
      suggestion: "为每项功能补充主流程、异常流程和状态反馈要求。"
    });
  }

  if (prdDocument.scope.outOfScope.length === 0) {
    findings.push({
      id: "finding-scope",
      severity: "minor",
      title: "范围边界未显式声明",
      detail: "PRD 缺少 out-of-scope 内容，评审阶段容易默认扩大范围。",
      suggestion: "明确当前版本不做的能力，保护节奏。"
    });
  }

  const readinessScore = Math.max(55, 92 - findings.length * 12);

  return prdValidationSchema.parse({
    requirementId: requirement.id,
    generatedAt,
    generator: "template",
    status: findings.some((item) => item.severity === "critical")
      ? "fail"
      : findings.length > 0
        ? "warning"
        : "pass",
    readinessScore,
    summary: findings.length > 0
      ? `PRD 基本成型，但仍有 ${findings.length} 个需要继续收敛的问题。`
      : "PRD 结构完整，可进入原型和任务拆解阶段。",
    findings,
    recommendedNextActions: findings.length > 0
      ? findings.map((item) => item.suggestion)
      : ["进入 wireframe 生成", "开始拆分执行任务"]
  });
}

function buildCompetitorAnalysisTemplate(
  requirement: Requirement,
  productModel: ProductModel,
  competitors: string[],
  generatedAt: string
) {
  return competitorAnalysisSchema.parse({
    requirementId: requirement.id,
    generatedAt,
    generator: "template",
    summary: `${requirement.title} 更适合走“结构化需求到落地产物流水线”路线，竞品分析重点应放在协同深度、交付一致性和迭代效率。`,
    competitors: competitors.map((name) => ({
      name,
      positioning: `${name} 更偏向通用协作/设计/文档能力，需要通过组合能力支持完整产品落地链路。`,
      strengths: ["已有成熟工作流心智", "用户熟悉度较高"],
      gaps: ["从需求到 PRD、原型、UI 的闭环一致性通常不足", "版本化需求追溯可能需要额外配置"],
      implications: [`${requirement.title} 应强化从单条需求到多产物链路的一致性优势。`]
    })),
    opportunities: [
      "把 requirement -> product model -> PRD -> wireframe -> UI 作为主线心智。",
      "突出版本化、标注和任务回溯能力。",
      "用本地优先和可审计的产物管理建立差异点。"
    ],
    differentiation: [
      "以结构化中间模型做多产物派生，减少信息漂移。",
      "把原型标注、PRD 校验和竞品分析直接串到流水线。"
    ],
    recommendations: [
      "默认在 PRD 后强制做自动验证。",
      "在 wireframe 与 UI 页面中保留需求与标注回链。",
      "把评审问题沉淀成任务而不是散落评论。"
    ]
  });
}

function buildWireframeTemplate(requirement: Requirement, productModel: ProductModel, generatedAt: string) {
  return wireframeSpecSchema.parse({
    requirementId: requirement.id,
    generatedAt,
    generator: "template",
    pages: productModel.pages.map((page) => ({
      id: page.id,
      name: page.name,
      purpose: page.purpose,
      layout: page.id === "page-home" ? "hero + overview + action rail" : "two-column workspace + inspector",
      sections: page.modules.map((module, index) => ({
        id: `${page.id}-section-${index + 1}`,
        title: module,
        objective: `承接 ${module} 相关信息与动作`,
        notes: [
          `突出 ${module} 的核心信息层级`,
          "保留清晰的状态反馈与下一步动作",
          "避免一次性展示过多字段"
        ],
        primaryAction: index === 0 ? "继续" : undefined
      }))
    })),
    userFlows: productModel.flows.map((flow) => ({
      id: flow.id,
      name: flow.name,
      steps: flow.steps
    }))
  });
}

function buildWireframeAnnotationsTemplate(requirement: Requirement, spec: WireframeSpec, generatedAt: string) {
  const annotations = spec.pages.flatMap((page) => page.sections.slice(0, 2).map((section, index) => ({
    id: `${page.id}-annotation-${index + 1}`,
    pageId: page.id,
    sectionId: section.id,
    kind: index === 0 ? "interaction" : "business",
    status: "open" as const,
    title: index === 0 ? "主流程动作需要可回退" : "业务规则需要补充边界",
    description: index === 0
      ? `${section.title} 区块需要明确主操作后的状态变化与返回路径。`
      : `${section.title} 区块应补充角色限制、数据来源或异常处理规则。`,
    linkedRequirementIds: [requirement.id],
    linkedTaskIds: []
  })));

  return wireframeAnnotationsDocumentSchema.parse({
    requirementId: requirement.id,
    generatedAt,
    generator: "template",
    annotations
  });
}

function buildUiDesignTemplate(
  requirement: Requirement,
  productModel: ProductModel,
  spec: WireframeSpec,
  generatedAt: string
) {
  return uiDesignSchema.parse({
    requirementId: requirement.id,
    generatedAt,
    generator: "template",
    visualThesis: "把产品工作台做成带有编辑室气质的决策界面，温和但不平淡，强调产物流转与上下文集中感。",
    interactionThesis: [
      "当前页面用大标题和留白建立主次",
      "关键操作只保留一个高饱和强调色",
      "标注信息嵌入页面局部而不是堆到边栏"
    ],
    designStyle: {
      themeName: "Editorial Workbench",
      tone: productModel.designStyle.tone,
      colorTokens: {
        background: "#f4efe6",
        surface: "#fdf8ef",
        surfaceStrong: "#efe3d2",
        text: "#171411",
        muted: "#645d55",
        accent: "#b85c38",
        line: "rgba(23,20,17,0.12)"
      },
      fontFamily: "\"Instrument Serif\", \"Iowan Old Style\", serif",
      accentStyle: "burnt-orange highlights on warm neutral surfaces"
    },
    pages: spec.pages.map((page) => ({
      pageId: page.id,
      name: page.name,
      notes: [
        `${page.name} 需要突出主任务和当前状态。`,
        "避免后台列表页风格，保持版面呼吸感。"
      ],
      htmlPath: `artifacts/${requirement.id}/ui/pages/${page.id}.html`
    }))
  });
}

function answerText(clarify: ClarifyQuestionPack | undefined, fieldKey: string) {
  const value = clarify?.answeredFieldMap[fieldKey];
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value.map(String).join("、");
  }
  return "";
}

function answerList(clarify: ClarifyQuestionPack | undefined, fieldKey: string) {
  const value = clarify?.answeredFieldMap[fieldKey];
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function productModelExample(
  requirementId: string,
  generatedAt: string,
  model: string,
  clarify?: ClarifyQuestionPack
) {
  return {
    meta: {
      requirementId,
      generatedAt,
      version: "0.2.0",
      generator: "ai",
      model
    },
    positioning: {
      title: "交友产品首发模型",
      summary: "把一句话交友需求转成结构化产品方案与设计产物。",
      targetUsers: answerList(clarify, "targetUsers").length > 0 ? answerList(clarify, "targetUsers") : ["18-28 岁单身用户"],
      problem: answerText(clarify, "coreScenario") || "用户需要高效完成匹配与互动，但安全和规则容易缺失。",
      valueProposition: "通过统一中间模型减少信息丢失，并把安全和商业规则前置。"
    },
    goals: ["提升方案产出效率", "降低产物不一致", "让后续 PRD 可直接落地"],
    assumptions: ["clarify 关键问题已回答"],
    features: [{ id: "feature-001", name: "匹配主流程", description: "把用户从候选浏览推进到配对与互动" }],
    flows: [{ id: "flow-001", name: "匹配主流程", steps: ["进入发现页", "浏览候选", "完成匹配", "进入互动"] }],
    pages: [{ id: "page-home", name: "发现页", purpose: "进入主流程", modules: ["候选流", "筛选区"] }],
    designStyle: { tone: "calm, precise", keywords: ["clarity"] },
    openQuestions: ["是否需要真人认证与实名机制"]
  };
}

function prdExample(
  requirementId: string,
  generatedAt: string,
  model: string,
  productModel: ProductModel,
  clarify?: ClarifyQuestionPack
) {
  return {
    meta: {
      requirementId,
      generatedAt,
      version: "0.2.0",
      generator: "ai",
      model
    },
    overview: {
      title: productModel.positioning.title,
      summary: productModel.positioning.summary,
      background: productModel.positioning.problem,
      businessGoal: answerList(clarify, "monetization").length > 0 ? `建立 ${answerList(clarify, "monetization").join("、")} 的转化路径` : "提升产物生成与协同效率",
      successMetrics: ["主流程完成率提升", "有效互动率提升"]
    },
    targetUsers: productModel.positioning.targetUsers.map((item) => ({
      name: item,
      needs: ["减少重复沟通"],
      scenarios: ["需求评审"]
    })),
    scope: { inScope: ["结构化建模"], outOfScope: ["复杂组织权限"] },
    functionalRequirements: productModel.features.map((feature, index) => ({
      id: `FR-${index + 1}`,
      title: feature.name,
      description: feature.description,
      acceptanceCriteria: ["支持主流程", "支持异常提示"]
    })),
    userFlows: productModel.flows,
    pages: productModel.pages.map((page) => ({
      id: page.id,
      name: page.name,
      purpose: page.purpose,
      keyModules: page.modules
    })),
    risks: ["需求边界不清"],
    openQuestions: ["是否需要对接外部系统"]
  };
}

function prdValidationExample(requirementId: string, generatedAt: string, model: string) {
  return {
    requirementId,
    generatedAt,
    generator: "ai",
    model,
    status: "warning",
    readinessScore: 78,
    summary: "PRD 结构完整，但仍有边界和验收标准需要加强。",
    findings: [
      {
        id: "finding-001",
        severity: "major",
        title: "验收标准不完整",
        detail: "部分功能缺少失败态描述。",
        suggestion: "补充异常路径和回退策略。"
      }
    ],
    recommendedNextActions: ["补充验收标准", "再进入原型阶段"]
  };
}

function competitorAnalysisExample(requirementId: string, generatedAt: string, model: string, competitors: string[]) {
  return {
    requirementId,
    generatedAt,
    generator: "ai",
    model,
    summary: "当前方案需要把一致性和版本可追溯作为核心差异化。",
    competitors: competitors.map((name) => ({
      name,
      positioning: `${name} 的典型产品定位`,
      strengths: ["成熟能力"],
      gaps: ["链路一致性不足"],
      implications: ["强调结构化流水线"]
    })),
    opportunities: ["打通完整链路"],
    differentiation: ["版本化需求到设计"],
    recommendations: ["加强评审闭环"]
  };
}

function wireframeExample(requirementId: string, generatedAt: string, model: string, productModel: ProductModel) {
  return {
    requirementId,
    generatedAt,
    generator: "ai",
    model,
    pages: productModel.pages.map((page) => ({
      id: page.id,
      name: page.name,
      purpose: page.purpose,
      layout: "hero + workspace",
      sections: page.modules.map((module, index) => ({
        id: `${page.id}-section-${index + 1}`,
        title: module,
        objective: `承接 ${module}`,
        notes: ["信息层级清晰"],
        primaryAction: index === 0 ? "继续" : undefined
      }))
    })),
    userFlows: productModel.flows
  };
}

function wireframeAnnotationsExample(requirementId: string, generatedAt: string, model: string, spec: WireframeSpec) {
  return {
    requirementId,
    generatedAt,
    generator: "ai",
    model,
    annotations: spec.pages.flatMap((page) => page.sections.slice(0, 1).map((section) => ({
      id: `${page.id}-annotation-001`,
      pageId: page.id,
      sectionId: section.id,
      kind: "interaction",
      status: "open",
      title: "需要明确主操作反馈",
      description: "点击后的状态和回退路径需要补清楚。",
      linkedRequirementIds: [requirementId],
      linkedTaskIds: []
    })))
  };
}

function uiDesignExample(requirementId: string, generatedAt: string, model: string, spec: WireframeSpec) {
  return {
    requirementId,
    generatedAt,
    generator: "ai",
    model,
    visualThesis: "温暖中性色上的编辑式工作台。",
    interactionThesis: ["一个主强调色", "版式驱动而不是卡片驱动"],
    designStyle: {
      themeName: "Editorial Workbench",
      tone: "calm, structured",
      colorTokens: {
        background: "#f4efe6",
        surface: "#fdf8ef",
        surfaceStrong: "#efe3d2",
        text: "#171411",
        muted: "#645d55",
        accent: "#b85c38",
        line: "rgba(23,20,17,0.12)"
      },
      fontFamily: "\"Instrument Serif\", serif",
      accentStyle: "burnt-orange accents"
    },
    pages: spec.pages.map((page) => ({
      pageId: page.id,
      name: page.name,
      notes: ["突出主操作"],
      htmlPath: `artifacts/${requirementId}/ui/pages/${page.id}.html`
    }))
  };
}
