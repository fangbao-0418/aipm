import { extname } from "node:path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import XLSX from "xlsx";
// @ts-expect-error no bundled types
import WordExtractor from "word-extractor";
import { z } from "zod";
import { OpenAIClient, StructuredOutputParseError, type LlmConnectionValidationResult } from "../../infrastructure/llm/openai-client.js";
import { WorkspaceProjectRepository } from "../../infrastructure/files/workspace-project-repository.js";
import { buildFallbackChatDecision, type ChatDecision } from "./chat-rules.js";
import { MainAgentOrchestratorService } from "./main-agent-orchestrator-service.js";
import type {
  WorkspaceBundle,
  WorkspaceLlmSettings,
  WorkspaceRequirementPointSection,
  WorkspaceProject,
  WorkspaceRequirementCollection,
  WorkspaceRequirementCollectionVersion,
  WorkspaceRequirementSourceRecord,
  WorkspaceRequirementSourceSummary,
  WorkspaceRequirementStructure,
  WorkspaceRequirementStructureVersion,
  WorkspaceStageDocument,
  WorkspaceStageDocumentVersion,
  WorkspaceSourceFileRecord,
  WorkspaceStageStateRecord,
  WorkspaceStageType
} from "../../shared/types/workspace.js";
import { nowIso } from "../../shared/utils/time.js";

const captureSchema = z.object({
  aiSummary: z.string(),
  structuredSnapshot: z.object({
    userGoals: z.array(z.string()).default([]),
    coreScenarios: z.array(z.string()).default([]),
    coreFunctions: z.array(z.string()).default([]),
    constraints: z.array(z.string()).default([])
  }),
  followupQuestions: z.array(z.string()).default([]),
  requirementsDocument: z.string().optional()
});

const captureChatSchema = z.object({
  mode: z.enum(["capture", "suggestion", "clarify", "answer"]),
  shouldCapture: z.boolean(),
  reply: z.string(),
  guidance: z.array(z.string()).default([])
});
type LlmChatDecision = z.infer<typeof captureChatSchema>;
type RuntimeChatDecision = ChatDecision & { model?: string };
type LlmSettingsSaveResult = {
  bundle: WorkspaceBundle;
  validation: {
    ok: boolean;
    model: string;
    baseUrl: string;
    message: string;
  };
};

const structureSchema = z.object({
  userGoals: z.array(z.string()).default([]),
  coreScenarios: z.array(z.string()).default([]),
  coreFunctions: z.array(z.string()).default([]),
  scope: z.object({
    inScope: z.array(z.string()).default([]),
    outOfScope: z.array(z.string()).default([])
  }),
  risks: z.array(z.string()).default([]),
  clarificationNeeded: z.array(z.string()).default([])
});

const stageOrder: WorkspaceStageType[] = [
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

interface SourceMaterial {
  id: string;
  title: string;
  sourceType: "record" | "file";
  text: string;
  note?: string;
}

export class WorkspaceProjectService {
  constructor(
    private readonly repository: WorkspaceProjectRepository,
    private readonly orchestrator: MainAgentOrchestratorService
  ) {}

  async createProject(input: {
    id: string;
    name: string;
    description: string;
    industry?: string;
    systemPrompt?: string;
    llmSettings?: Partial<WorkspaceLlmSettings>;
    apiKey?: string;
  }) {
    const project = this.repository.createDefaultProject(input);
    await this.repository.saveProject(project);
    await this.repository.saveStageState(project.id, this.repository.createDefaultStageState());
    await this.repository.saveLlmSettings(project.id, project.llmSettings, input.apiKey);
    return this.getBundle(project.id);
  }

  async getBundle(
    projectId: string,
    options?: {
      signal?: AbortSignal;
      onStatus?: (status: string) => void | Promise<void>;
      onLlmDelta?: (payload: { source: "stage-plan" | "main-agent"; delta: string }) => void | Promise<void>;
    }
  ) {
    return this.orchestrator.buildWorkspaceView(projectId, options);
  }

  async deleteProject(projectId: string) {
    await this.repository.deleteProject(projectId);
  }

  async saveLlmSettings(projectId: string, input: {
    provider: WorkspaceLlmSettings["provider"];
    baseUrl?: string;
    modelProfile: WorkspaceLlmSettings["modelProfile"];
    stageModelRouting?: WorkspaceLlmSettings["stageModelRouting"];
    apiKey?: string;
  }): Promise<LlmSettingsSaveResult> {
    const project = await this.repository.getProject(projectId);
    const settings: WorkspaceLlmSettings = {
      ...project.llmSettings,
      provider: input.provider,
      baseUrl: input.baseUrl,
      modelProfile: input.modelProfile,
      apiKeyConfigured: input.apiKey ? true : project.llmSettings.apiKeyConfigured,
      stageModelRouting: {
        ...project.llmSettings.stageModelRouting,
        ...(input.stageModelRouting ?? {})
      }
    };

    project.llmSettings = settings;
    project.updatedAt = nowIso();

    await this.repository.saveProject(project);
    await this.repository.saveLlmSettings(projectId, settings, input.apiKey);
    const validation = await this.validateProjectLlm(projectId, settings, input.apiKey);
    const bundle = await this.repository.buildBundle(projectId);
    return { bundle, validation };
  }

  async appendRequirementInput(projectId: string, message: string) {
    const project = await this.repository.getProject(projectId);
    const currentCollection = normalizeCollection(await this.getOrCreateCollection(project));
    const nextRecords = [...currentCollection.sourceRecords, createSourceRecord(message.trim())].filter((item) => item.content);
    const organized = await this.organizeCollection(project, nextRecords, currentCollection.uploadedFiles);
    return this.persistCollectionAndBundle(project, organized, "pending-review");
  }

  async chat(projectId: string, input: {
    message: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
  }, options?: {
    signal?: AbortSignal;
    onStatus?: (status: string) => void | Promise<void>;
    onLlmDelta?: (payload: { source: "chat-decision" | "source-summary" | "collection-organize"; delta: string }) => void | Promise<void>;
    onAssistantReady?: (assistant: {
      role: "assistant";
      type: "question" | "review" | "suggestion" | "normal";
      mode: "capture" | "suggestion" | "clarify" | "answer";
      captured: boolean;
      reply: string;
      guidance: string[];
    }) => void | Promise<void>;
  }) {
    await options?.onStatus?.("正在读取当前阶段上下文");
    const project = await this.repository.getProject(projectId);
    throwIfAborted(options?.signal);
    const collection = normalizeCollection(await this.getOrCreateCollection(project));
    await options?.onStatus?.("思考中...");
    const decision = await this.decideChatAction(project, collection, input.message, input.history ?? [], {
      signal: options?.signal,
      onLlmDelta: options?.onLlmDelta
    });
    throwIfAborted(options?.signal);

    const assistantReply = this.composeAssistantReply(decision.reply);
    await options?.onAssistantReady?.({
      role: "assistant",
      type: decision.mode === "capture" ? "question" : decision.mode === "suggestion" ? "suggestion" : "normal",
      mode: decision.mode,
      captured: decision.shouldCapture,
      reply: assistantReply,
      guidance: decision.guidance
    });

    let nextBundle = await this.repository.buildBundle(projectId);
    let nextCollection = collection;
    if (decision.shouldCapture) {
      await options?.onStatus?.("正在把这条输入收录进需求采集文档");
      const nextRecords = [...collection.sourceRecords, createSourceRecord(input.message.trim())].filter((item) => item.content);
      nextCollection = await this.organizeCollection(project, nextRecords, collection.uploadedFiles, collection.requirementsDocument, undefined, {
        signal: options?.signal,
        onLlmDelta: options?.onLlmDelta
      });
      throwIfAborted(options?.signal);
      await options?.onStatus?.("正在重新整理需求采集结果");
      nextBundle = await this.persistCollectionAndBundle(project, nextCollection, "pending-review", "ai");
    } else {
      await options?.onStatus?.("当前问题已回答");
      nextBundle = await this.repository.buildBundle(projectId);
    }
    throwIfAborted(options?.signal);
    await options?.onStatus?.("回复已准备完成");

    return {
      bundle: nextBundle,
      assistant: {
        role: "assistant" as const,
        type: decision.mode === "capture" ? "question" as const : decision.mode === "suggestion" ? "suggestion" as const : "normal" as const,
        mode: decision.mode,
        captured: decision.shouldCapture,
        reply: assistantReply,
        guidance: decision.guidance,
        modelOutput: {
          source: decision.decisionSource,
          model: decision.model,
          details: {
            currentStage: project.currentStage,
            chatDecision: {
              mode: decision.mode,
              shouldCapture: decision.shouldCapture,
              reply: decision.reply,
              guidance: decision.guidance
            },
            collectionSummary: {
              aiSummary: nextCollection.aiSummary,
              followupQuestions: nextCollection.followupQuestions,
              structuredSnapshot: nextCollection.structuredSnapshot
            },
            mainAgentDecision: nextBundle.mainAgentDecision ?? null,
            currentStageTaskPlan: nextBundle.currentStageTaskPlan ?? null
          }
        },
        collection: nextCollection
      }
    };
  }

  async getSourceFile(projectId: string, fileId: string) {
    const collection = await this.repository.getRequirementCollection(projectId);
    const file = collection.uploadedFiles.find((item) => item.id === fileId);
    if (!file?.storedFilename) {
      throw new Error("Source file not found");
    }

    const bytes = await this.repository.readSourceFile(projectId, file.storedFilename);
    return {
      file,
      bytes
    };
  }

  async uploadRequirementFiles(
    projectId: string,
    files: Array<{
      filename: string;
      mimeType: string;
      bytes: Buffer;
    }>
  ) {
    const project = await this.repository.getProject(projectId);
    const currentCollection = normalizeCollection(await this.getOrCreateCollection(project));
    const parsedFiles: WorkspaceSourceFileRecord[] = [];

    for (const file of files) {
      const stored = await this.repository.saveSourceFile(projectId, file.filename, file.bytes);
      const parsed = await parseWorkspaceFile({
        filename: file.filename,
        mimeType: file.mimeType,
        bytes: file.bytes,
        storedFilename: stored.storedFilename,
        relativePath: stored.relativePath,
        fullPath: stored.fullPath
      });
      parsedFiles.push(parsed);
    }

    const organized = await this.organizeCollection(
      project,
      currentCollection.sourceRecords,
      [...currentCollection.uploadedFiles, ...parsedFiles]
    );

    return this.persistCollectionAndBundle(project, organized, currentCollection.sourceRecords.length > 0 ? "pending-review" : "in-progress");
  }

  async updateRequirementDocument(projectId: string, document: string) {
    const project = await this.repository.getProject(projectId);
    const collection = normalizeCollection(await this.getOrCreateCollection(project));
    const normalizedHtml = normalizeRichTextHtml(document);
    const nextCollection: WorkspaceRequirementCollection = {
      ...collection,
      requirementsDocument: richTextHtmlToText(normalizedHtml),
      requirementsDocumentHtml: normalizedHtml,
      lastEditedAt: nowIso()
    };
    return this.persistCollectionAndBundle(project, nextCollection, "pending-review", "manual");
  }

  async listRequirementDocumentVersions(projectId: string) {
    return this.repository.listRequirementCollectionVersions(projectId);
  }

  async rollbackRequirementDocumentVersion(projectId: string, versionId: string) {
    const project = await this.repository.getProject(projectId);
    const current = normalizeCollection(await this.getOrCreateCollection(project));
    const version = await this.repository.getRequirementCollectionVersion(projectId, versionId);
    const nextCollection: WorkspaceRequirementCollection = {
      ...current,
      aiSummary: `已回滚到 ${new Date(version.createdAt).toLocaleString("zh-CN")} 的历史版本。`,
      requirementsDocument: version.requirementsDocument,
      requirementsDocumentHtml: version.requirementsDocumentHtml,
      lastEditedAt: nowIso()
    };
    return this.persistCollectionAndBundle(project, nextCollection, "pending-review", "rollback");
  }

  async organizeRequirementDocument(projectId: string, instruction?: string) {
    const project = await this.repository.getProject(projectId);
    const collection = normalizeCollection(await this.getOrCreateCollection(project));
    const fragments = splitFragments(collection.requirementsDocument);
    const organized = await this.organizeCollection(
      project,
      fragments.length > 0 ? fragments.map((item) => createSourceRecord(item)) : collection.sourceRecords,
      collection.uploadedFiles,
      collection.requirementsDocument,
      instruction
    );
    return this.persistCollectionAndBundle(project, organized, "pending-review", "ai");
  }

  async createRequirementSourceRecord(projectId: string, input: { content: string; parentId?: string }) {
    const project = await this.repository.getProject(projectId);
    const collection = normalizeCollection(await this.getOrCreateCollection(project));
    const nextRecords = [...collection.sourceRecords, createSourceRecord(input.content, input.parentId)].filter((item) => item.content);
    return this.persistSourceRecordsOnly(project, collection, nextRecords);
  }

  async updateRequirementSourceRecord(projectId: string, recordId: string, content: string) {
    const project = await this.repository.getProject(projectId);
    const collection = normalizeCollection(await this.getOrCreateCollection(project));
    const nextRecords = collection.sourceRecords.map((record) =>
      record.id === recordId
        ? { ...record, content: content.trim(), updatedAt: nowIso() }
        : record
    );
    return this.persistSourceRecordsOnly(project, collection, nextRecords);
  }

  async deleteRequirementSourceRecord(projectId: string, recordId: string) {
    const project = await this.repository.getProject(projectId);
    const collection = normalizeCollection(await this.getOrCreateCollection(project));
    const nextRecords = removeSourceRecordTree(collection.sourceRecords, recordId);
    return this.persistSourceRecordsOnly(project, collection, nextRecords);
  }

  async updateRequirementStructureDocument(projectId: string, documentHtml: string) {
    const bundle = await this.ensureBundle(projectId);
    const structure = await this.repository.getRequirementStructure(projectId);
    const normalizedHtml = normalizeRichTextHtml(documentHtml);
    const nextStructure: WorkspaceRequirementStructure = {
      ...structure,
      documentHtml: normalizedHtml,
      documentMarkdown: richTextHtmlToText(normalizedHtml),
      lastEditedAt: nowIso()
    };
    await this.repository.saveRequirementStructure(projectId, nextStructure, "manual");
    return this.getBundle(projectId);
  }

  async generateStageDocument(
    projectId: string,
    stage: "requirement-clarification" | "product-model" | "prd" | "prototype"
  ) {
    const bundle = await this.ensureBundle(projectId);
    const collection = normalizeCollection(await this.getOrCreateCollection(bundle.project));
    const structure = await this.repository.getRequirementStructure(projectId).catch(() => null);

    if (!structure && ["requirement-clarification", "product-model", "prd", "prototype"].includes(stage)) {
      throw new Error("请先完成需求结构化阶段");
    }

    const document = await this.buildStageDocument(bundle.project, stage, {
      collection,
      structure: structure ?? undefined,
      clarification: await this.repository.getStageDocument(projectId, "requirement-clarification").catch(() => undefined),
      productModel: await this.repository.getStageDocument(projectId, "product-model").catch(() => undefined),
      prd: await this.repository.getStageDocument(projectId, "prd").catch(() => undefined)
    });

    await this.repository.saveStageDocument(projectId, stage, document, "ai");
    await this.advanceProjectToStage(projectId, stage);
    return this.getBundle(projectId);
  }

  async updateStageDocument(
    projectId: string,
    stage: "requirement-clarification" | "product-model" | "prd" | "prototype",
    documentHtml: string
  ) {
    const existing = await this.repository.getStageDocument(projectId, stage);
    const normalizedHtml = normalizeRichTextHtml(documentHtml);
    const nextDocument: WorkspaceStageDocument = {
      ...existing,
      documentHtml: normalizedHtml,
      documentMarkdown: richTextHtmlToText(normalizedHtml),
      lastEditedAt: nowIso()
    };
    await this.repository.saveStageDocument(projectId, stage, nextDocument, "manual");
    return this.getBundle(projectId);
  }

  async listStageDocumentVersions(
    projectId: string,
    stage: "requirement-clarification" | "product-model" | "prd" | "prototype"
  ) {
    return this.repository.listStageDocumentVersions(projectId, stage);
  }

  async rollbackStageDocumentVersion(
    projectId: string,
    stage: "requirement-clarification" | "product-model" | "prd" | "prototype",
    versionId: string
  ) {
    const existing = await this.repository.getStageDocument(projectId, stage);
    const version = await this.repository.getStageDocumentVersion(projectId, stage, versionId);
    const nextDocument: WorkspaceStageDocument = {
      ...existing,
      summary: version.summary,
      documentMarkdown: version.documentMarkdown,
      documentHtml: version.documentHtml,
      lastEditedAt: nowIso()
    };
    await this.repository.saveStageDocument(projectId, stage, nextDocument, "rollback");
    return this.getBundle(projectId);
  }

  async listRequirementStructureVersions(projectId: string) {
    return this.repository.listRequirementStructureVersions(projectId);
  }

  async rollbackRequirementStructureVersion(projectId: string, versionId: string) {
    const structure = await this.repository.getRequirementStructure(projectId);
    const version = await this.repository.getRequirementStructureVersion(projectId, versionId);
    const nextStructure: WorkspaceRequirementStructure = {
      ...structure,
      documentMarkdown: version.documentMarkdown,
      documentHtml: version.documentHtml,
      lastEditedAt: nowIso()
    };
    await this.repository.saveRequirementStructure(projectId, nextStructure, "rollback");
    return this.getBundle(projectId);
  }

  async rollbackStage(projectId: string, targetStage: WorkspaceStageType) {
    const bundle = await this.ensureBundle(projectId);
    const nextStates = this.rollbackStates(bundle.project.currentStage, targetStage);
    const nextProject: WorkspaceProject = {
      ...bundle.project,
      currentStage: targetStage,
      updatedAt: nowIso()
    };
    await this.repository.saveProject(nextProject);
    await this.repository.saveStageState(projectId, nextStates);
    return this.getBundle(projectId);
  }

  async generateRequirementStructure(projectId: string) {
    const bundle = await this.ensureBundle(projectId);
    const collection = normalizeCollection(await this.getOrCreateCollection(bundle.project));
    const structure = await this.buildRequirementStructure(bundle.project, collection);
    await this.repository.saveRequirementStructure(projectId, structure, "ai");

    const nextProject: WorkspaceProject = {
      ...bundle.project,
      currentStage: "requirement-structure",
      updatedAt: nowIso()
    };
    await this.repository.saveProject(nextProject);
    const nextStates = this.advanceToStructure();
    await this.repository.saveStageState(projectId, nextStates);
    return this.getBundle(projectId);
  }

  private async ensureBundle(projectId: string) {
    return this.getBundle(projectId);
  }

  private composeAssistantReply(primary: string) {
    return primary.trim();
  }

  private async validateProjectLlm(
    projectId: string,
    settings: WorkspaceLlmSettings,
    apiKey?: string
  ): Promise<LlmConnectionValidationResult> {
    if (settings.provider !== "openai" && settings.provider !== "openai-compatible") {
      return {
        ok: false,
        model: settings.stageModelRouting.capture ?? process.env.OPENAI_MODEL ?? "gpt-5-mini",
        baseUrl: settings.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
        message: `当前 provider ${settings.provider} 暂不支持轻量连接校验。`
      };
    }

    const resolvedApiKey = apiKey?.trim()
      || await this.repository.getStoredApiKey(projectId)
      || process.env.OPENAI_API_KEY;
    const model = settings.stageModelRouting.capture ?? process.env.OPENAI_MODEL ?? "gpt-5-mini";
    const client = new OpenAIClient(
      resolvedApiKey,
      settings.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      model
    );

    return client.validateConnection();
  }

  private async getOrCreateCollection(project: WorkspaceProject) {
    try {
      return normalizeCollection(await this.repository.getRequirementCollection(project.id));
    } catch {
      return {
        projectName: project.name,
        rawInputs: [],
        sourceRecords: [],
        uploadedFiles: [],
        extractedHighlights: [],
        aiSummary: "尚未整理需求采集信息。",
        requirementsDocument: `# ${project.name} 需求采集文档\n\n## 当前状态\n- 尚未输入需求点\n`,
        requirementsDocumentHtml: markdownLikeToHtml(`# ${project.name} 需求采集文档\n\n## 当前状态\n- 尚未输入需求点\n`),
        structuredSnapshot: {
          userGoals: [],
          coreScenarios: [],
          coreFunctions: [],
          constraints: []
        },
        sourceDirty: false,
        lastSourceUpdatedAt: undefined,
        lastOrganizedSourceUpdatedAt: undefined,
        followupQuestions: ["请先补充一句话需求或上传文档。"],
        lastOrganizedAt: nowIso()
      } satisfies WorkspaceRequirementCollection;
    }
  }

  private async persistCollectionAndBundle(
    project: WorkspaceProject,
    collection: WorkspaceRequirementCollection,
    status: WorkspaceStageStateRecord["status"],
    source: WorkspaceRequirementCollectionVersion["source"] = "ai"
  ) {
    const normalized = normalizeCollection(collection);
    const nextProject: WorkspaceProject = {
      ...project,
      currentStage: "requirement-collection",
      updatedAt: nowIso()
    };
    await this.repository.saveProject(nextProject);
    await this.repository.saveRequirementCollection(project.id, normalized, source);
    await this.repository.saveStageState(project.id, this.createStageStatesForCollection(status));
    return this.repository.buildBundle(project.id);
  }

  private async persistSourceRecordsOnly(
    project: WorkspaceProject,
    collection: WorkspaceRequirementCollection,
    sourceRecords: WorkspaceRequirementSourceRecord[]
  ) {
    const latestSourceUpdatedAt = getLatestSourceUpdatedAt(sourceRecords, collection.uploadedFiles);
    const nextCollection: WorkspaceRequirementCollection = {
      ...collection,
      sourceRecords,
      rawInputs: sourceRecordsToRawInputs(sourceRecords),
      sourceDirty: sourceRecords.length > 0 || collection.uploadedFiles.length > 0,
      lastSourceUpdatedAt: latestSourceUpdatedAt,
      lastEditedAt: nowIso()
    };
    return this.persistCollectionAndBundle(project, nextCollection, "pending-review", "manual");
  }

  async confirmAdvanceToNextStage(projectId: string) {
    const bundle = await this.getBundle(projectId);
    const decision = bundle.mainAgentDecision;
    const nextStage = decision?.suggestedNextStage;

    if (!decision || !decision.canAdvance || !nextStage) {
      const error = new Error("Current stage is not ready to advance");
      (error as Error & { statusCode?: number }).statusCode = 409;
      throw error;
    }

    if (bundle.project.currentStage === "requirement-collection" && nextStage === "requirement-structure") {
      return this.generateRequirementStructure(projectId);
    }

    const stages = await this.repository.getStageState(projectId);
    const nextStates = stages.map((state) => {
      if (state.stage === bundle.project.currentStage) {
        return { ...state, status: "completed" as const, updatedAt: nowIso() };
      }
      if (state.stage === nextStage) {
        return { ...state, status: "in-progress" as const, updatedAt: nowIso() };
      }
      return state;
    });

    await this.repository.saveStageState(projectId, nextStates);
    await this.repository.saveProject({
      ...bundle.project,
      currentStage: nextStage,
      updatedAt: nowIso()
    });
    return this.getBundle(projectId);
  }

  private createStageStatesForCollection(status: WorkspaceStageStateRecord["status"]) {
    const now = nowIso();
    return stageOrder.map((stage, index) => ({
      stage,
      status: index === 0 ? status : "not-started",
      updatedAt: now
    })) satisfies WorkspaceStageStateRecord[];
  }

  private advanceToStructure() {
    const now = nowIso();
    return stageOrder.map((stage, index) => {
      if (index === 0) {
        return { stage, status: "completed", updatedAt: now } as const;
      }
      if (index === 1) {
        return { stage, status: "in-progress", updatedAt: now } as const;
      }
      return { stage, status: "not-started", updatedAt: now } as const;
    });
  }

  private rollbackStates(currentStage: WorkspaceStageType, targetStage: WorkspaceStageType) {
    const now = nowIso();
    const targetIndex = stageOrder.indexOf(targetStage);
    return stageOrder.map((stage, index) => {
      if (index < targetIndex) {
        return { stage, status: "completed", updatedAt: now } as const;
      }
      if (index === targetIndex) {
        return { stage, status: "in-progress", updatedAt: now } as const;
      }
      return { stage, status: "pending-review", updatedAt: now } as const;
    });
  }

  private async organizeCollection(
    project: WorkspaceProject,
    sourceRecords: WorkspaceRequirementSourceRecord[],
    uploadedFiles: WorkspaceSourceFileRecord[],
    currentDocument?: string,
    instruction?: string,
    options?: {
      signal?: AbortSignal;
      onLlmDelta?: (payload: { source: "source-summary" | "collection-organize"; delta: string }) => void | Promise<void>;
    }
  ): Promise<WorkspaceRequirementCollection> {
    const rawInputs = sourceRecordsToRawInputs(sourceRecords);
    const llm = await this.createProjectLlm(project, "capture");
    const materials = await this.buildSourceMaterials(project.id, sourceRecords, uploadedFiles);
    const extractedHighlights = materials
      .flatMap((material) => splitFragments(material.text))
      .slice(0, 80);
    const fallback = heuristicCollection(project.name, rawInputs, sourceRecords, uploadedFiles, extractedHighlights, materials);

    console.info("[AIPM][Capture] organize:start", {
      projectId: project.id,
      sourceRecordCount: sourceRecords.length,
      uploadedFileCount: uploadedFiles.length,
      materialCount: materials.length,
      extractedHighlightCount: extractedHighlights.length,
      hasCurrentDocument: Boolean(currentDocument?.trim()),
      hasInstruction: Boolean(instruction?.trim())
    });

    if (!llm) {
      console.warn("[AIPM][Capture] organize:fallback-heuristic", {
        projectId: project.id,
        sourceRecordCount: sourceRecords.length,
        uploadedFileCount: uploadedFiles.length
      });
      return fallback;
    }

    const sourceSummaries = this.buildSinglePassSourceSummaries(materials);
    const sourceContext = this.buildSinglePassSourceContext(materials);
    const organizeSystemPrompt = `${project.systemPrompt ?? "你是资深产品经理。"}\n请基于全部来源内容，一次性整理需求采集结果。重点是保留全部需求点，做去重、合并、轻度润色和层级整理，不要把内容过度压缩成少量摘要。不要遗漏后面的来源。requirementsDocument 应该是一份完整、可继续编辑的需求点文档。`;
    const organizeUserPrompt = JSON.stringify({
      projectName: project.name,
      rawInputs,
      sourceRecords,
      currentDocument,
      instruction,
      sourceContext,
      sourceSummaries,
      uploadedFiles: uploadedFiles.map((file) => ({
        name: file.name,
        extractedTextExcerpt: file.extractedTextExcerpt,
        note: file.note
      })),
      extractedHighlights
    }, null, 2);

    try {
      console.info("[AIPM][Capture] source-summaries:built", {
        projectId: project.id,
        summaryCount: sourceSummaries.length
      });
      const promptArgs = {
        systemPrompt: organizeSystemPrompt,
        userPrompt: organizeUserPrompt,
        temperature: 0.3,
        signal: options?.signal
      } as const;
      const result = options?.onLlmDelta
        ? await llm.generateJsonStream(captureSchema, {
            ...promptArgs,
            onToken: async (delta) => {
              await options.onLlmDelta?.({ source: "collection-organize", delta });
            }
          })
        : await llm.generateJson(captureSchema, promptArgs);
      await this.repository.saveLlmLog(project.id, {
        stage: "requirement-collection",
        step: "collection-organize",
        model: llm.model,
        baseUrl: llm.resolvedBaseUrl,
        systemPrompt: organizeSystemPrompt,
        userPrompt: organizeUserPrompt,
        parsedOutput: result
      });

      const requirementPointSections = buildRequirementPointSections({
        sourceRecords,
        uploadedFiles,
        materials,
        extractedHighlights,
        currentDocument
      });
      const requirementsDocument = renderCollectionDocument({
        projectName: project.name,
        summary: result.aiSummary,
        requirementPointSections,
        userGoals: result.structuredSnapshot.userGoals,
        coreScenarios: result.structuredSnapshot.coreScenarios,
        coreFunctions: result.structuredSnapshot.coreFunctions,
        constraints: result.structuredSnapshot.constraints,
        followupQuestions: result.followupQuestions.length > 0 ? result.followupQuestions : fallback.followupQuestions
      });

      return {
        ...fallback,
        aiSummary: result.aiSummary,
        requirementPointSections,
        requirementsDocument,
        requirementsDocumentHtml: markdownLikeToHtml(requirementsDocument),
        sourceSummaries,
        structuredSnapshot: result.structuredSnapshot,
        sourceDirty: false,
        lastSourceUpdatedAt: getLatestSourceUpdatedAt(sourceRecords, uploadedFiles),
        lastOrganizedSourceUpdatedAt: nowIso(),
        followupQuestions: result.followupQuestions.length > 0 ? result.followupQuestions : fallback.followupQuestions,
        lastOrganizedAt: nowIso()
      };
    } catch (error) {
      await this.repository.saveLlmLog(project.id, {
        stage: "requirement-collection",
        step: "collection-organize-error",
        model: llm.model,
        baseUrl: llm.resolvedBaseUrl,
        systemPrompt: organizeSystemPrompt,
        userPrompt: organizeUserPrompt,
        outputText: error instanceof StructuredOutputParseError ? error.rawText : undefined,
        parsedOutput: error instanceof StructuredOutputParseError ? { extractedJson: error.extractedJson } : undefined,
        error: error instanceof Error ? error.message : "Unknown organizeCollection error"
      });
      console.error("[AIPM][Capture] organize:error-fallback", {
        projectId: project.id
      });
      return fallback;
    }
  }

  private async buildRequirementStructure(
    project: WorkspaceProject,
    collection: WorkspaceRequirementCollection
  ): Promise<WorkspaceRequirementStructure> {
    const llm = await this.createProjectLlm(project, "structure");
    const fallback = heuristicStructure(collection);

    if (!llm) {
      return fallback;
    }

    try {
      const systemPrompt = `${project.systemPrompt ?? "你是资深产品经理。"}\n请基于需求采集文档输出结构化需求。`;
      const userPrompt = collection.requirementsDocument;
      const result = await llm.generateJson(structureSchema, {
        systemPrompt,
        userPrompt,
        temperature: 0.25
      });
      await this.repository.saveLlmLog(project.id, {
        stage: "requirement-structure",
        step: "requirement-structure",
        model: llm.model,
        baseUrl: llm.resolvedBaseUrl,
        systemPrompt,
        userPrompt,
        parsedOutput: result
      });
      const structure: WorkspaceRequirementStructure = {
        ...result,
        documentMarkdown: "",
        documentHtml: "",
        lastGeneratedAt: nowIso()
      };
      structure.documentMarkdown = renderRequirementStructureMarkdown(structure);
      structure.documentHtml = markdownLikeToHtml(structure.documentMarkdown);
      return structure;
    } catch (error) {
      await this.repository.saveLlmLog(project.id, {
        stage: "requirement-structure",
        step: "requirement-structure-error",
        model: llm.model,
        baseUrl: llm.resolvedBaseUrl,
        systemPrompt: `${project.systemPrompt ?? "你是资深产品经理。"}\n请基于需求采集文档输出结构化需求。`,
        userPrompt: collection.requirementsDocument,
        outputText: error instanceof StructuredOutputParseError ? error.rawText : undefined,
        parsedOutput: error instanceof StructuredOutputParseError ? { extractedJson: error.extractedJson } : undefined,
        error: error instanceof Error ? error.message : "Unknown buildRequirementStructure error"
      });
      return fallback;
    }
  }

  private async buildStageDocument(
    project: WorkspaceProject,
    stage: "requirement-clarification" | "product-model" | "prd" | "prototype",
    context: {
      collection: WorkspaceRequirementCollection;
      structure?: WorkspaceRequirementStructure;
      clarification?: WorkspaceStageDocument;
      productModel?: WorkspaceStageDocument;
      prd?: WorkspaceStageDocument;
    }
  ): Promise<WorkspaceStageDocument> {
    const llm = await this.createProjectLlm(project, "structure");
    const fallback = buildFallbackStageDocument(project.name, stage, context);

    if (!llm) {
      return fallback;
    }

    try {
      const systemPrompt = `${project.systemPrompt ?? "你是资深产品经理。"}\n请输出${labelStageForPrompt(stage)}的正式文档草案。要求：1）自然、专业；2）使用清晰标题和列表；3）只输出 Markdown 文档正文；4）不要输出 JSON。`;
      const userPrompt = JSON.stringify({
          project: {
            name: project.name,
            description: project.description,
            currentStage: project.currentStage
          },
          stage,
          requirementCollection: {
            aiSummary: context.collection.aiSummary,
            requirementsDocument: context.collection.requirementsDocument,
            structuredSnapshot: context.collection.structuredSnapshot,
            followupQuestions: context.collection.followupQuestions
          },
          requirementStructure: context.structure ?? null,
          clarification: context.clarification?.documentMarkdown ?? null,
          productModel: context.productModel?.documentMarkdown ?? null,
          prd: context.prd?.documentMarkdown ?? null
        }, null, 2);
      const markdown = await llm.generateText({
        systemPrompt,
        userPrompt,
        temperature: 0.25
      });
      await this.repository.saveLlmLog(project.id, {
        stage,
        step: `${stage}-document`,
        model: llm.model,
        baseUrl: llm.resolvedBaseUrl,
        systemPrompt,
        userPrompt,
        outputText: markdown
      });

      return {
        ...fallback,
        summary: firstNonEmptyLine(markdown) ?? fallback.summary,
        documentMarkdown: markdown.trim(),
        documentHtml: markdownLikeToHtml(markdown),
        sections: buildStageDocumentSections(stage, markdown),
        lastGeneratedAt: nowIso()
      };
    } catch (error) {
      await this.repository.saveLlmLog(project.id, {
        stage,
        step: `${stage}-document-error`,
        model: llm.model,
        baseUrl: llm.resolvedBaseUrl,
        systemPrompt: `${project.systemPrompt ?? "你是资深产品经理。"}\n请输出${labelStageForPrompt(stage)}的正式文档草案。要求：1）自然、专业；2）使用清晰标题和列表；3）只输出 Markdown 文档正文；4）不要输出 JSON。`,
        userPrompt: JSON.stringify({
          project: {
            name: project.name,
            description: project.description,
            currentStage: project.currentStage
          },
          stage
        }, null, 2),
        outputText: error instanceof StructuredOutputParseError ? error.rawText : undefined,
        parsedOutput: error instanceof StructuredOutputParseError ? { extractedJson: error.extractedJson } : undefined,
        error: error instanceof Error ? error.message : "Unknown buildStageDocument error"
      });
      return fallback;
    }
  }

  private async advanceProjectToStage(projectId: string, targetStage: WorkspaceStageType) {
    const bundle = await this.ensureBundle(projectId);
    const currentIndex = stageOrder.indexOf(bundle.project.currentStage);
    const targetIndex = stageOrder.indexOf(targetStage);
    const now = nowIso();
    const nextStates = stageOrder.map((stage, index) => {
      if (index < targetIndex) {
        return { stage, status: "completed" as const, updatedAt: now };
      }
      if (index === targetIndex) {
        return { stage, status: "in-progress" as const, updatedAt: now };
      }
      if (index > targetIndex && index <= currentIndex) {
        return { stage, status: "pending-review" as const, updatedAt: now };
      }
      return { stage, status: "not-started" as const, updatedAt: now };
    });

    await this.repository.saveStageState(projectId, nextStates);
    await this.repository.saveProject({
      ...bundle.project,
      currentStage: targetStage,
      updatedAt: now
    });
  }

  private async buildSourceMaterials(
    projectId: string,
    sourceRecords: WorkspaceRequirementSourceRecord[],
    uploadedFiles: WorkspaceSourceFileRecord[]
  ) {
    const recordMaterials = buildSourceRecordMaterials(sourceRecords);
    const fileMaterials = await Promise.all(
      uploadedFiles.map(async (file) => {
        const text = await this.readFullUploadedFileText(projectId, file);
        return {
          id: file.id,
          title: file.name,
          sourceType: "file" as const,
          text: text?.trim() || file.extractedTextExcerpt?.trim() || file.note || "",
          note: file.note
        };
      })
    );

    const materials = [...recordMaterials, ...fileMaterials].filter((material) => material.text.trim().length > 0);
    console.info("[AIPM][Capture] source-materials", {
      projectId,
      recordMaterials: recordMaterials.length,
      fileMaterials: fileMaterials.length,
      totalMaterials: materials.length,
      materialChars: materials.reduce((sum, item) => sum + item.text.length, 0)
    });
    return materials;
  }

  private async readFullUploadedFileText(projectId: string, file: WorkspaceSourceFileRecord) {
    if (!file.storedFilename || file.extractionStatus !== "parsed") {
      return file.extractedTextExcerpt;
    }

    try {
      const bytes = await this.repository.readSourceFile(projectId, file.storedFilename);
      const parsed = await extractWorkspaceFileText({
        filename: file.name,
        mimeType: file.mimeType,
        bytes,
        fullPath: this.repository.projectSourceFilePath(projectId, file.storedFilename)
      });
      return parsed.text?.trim() || file.extractedTextExcerpt;
    } catch {
      return file.extractedTextExcerpt;
    }
  }

  private async createProjectLlm(project: WorkspaceProject, stage: "capture" | "structure") {
    const settings = await this.repository.getLlmSettings(project.id);
    if (settings.provider !== "openai" && settings.provider !== "openai-compatible") {
      console.warn("[AIPM][LLM] disabled:unsupported-provider", {
        projectId: project.id,
        stage,
        provider: settings.provider
      });
      return null;
    }

    const apiKey = await this.repository.getStoredApiKey(project.id) ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.warn("[AIPM][LLM] disabled:missing-api-key", {
        projectId: project.id,
        stage,
        provider: settings.provider,
        baseUrl: settings.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"
      });
      return null;
    }

    const model = settings.stageModelRouting[stage] ?? process.env.OPENAI_MODEL ?? (stage === "capture" ? "gpt-5-mini" : "gpt-5.2");
    console.info("[AIPM][LLM] enabled", {
      projectId: project.id,
      stage,
      provider: settings.provider,
      model,
      baseUrl: settings.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"
    });

    return new OpenAIClient(
      apiKey,
      settings.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      model
    );
  }

  private buildSinglePassSourceSummaries(materials: SourceMaterial[]): WorkspaceRequirementSourceSummary[] {
    return materials.map((material) => {
      const fragments = splitFragments(material.text);
      return {
        id: material.id,
        title: material.title,
        sourceType: material.sourceType,
        summary: summarizeText(material.text, 240),
        keyPoints: fragments.slice(0, 8),
        candidateUserGoals: classify(fragments, ["目标", "提升", "效率", "增长", "希望", "价值", "帮助"]).slice(0, 4),
        candidateScenarios: classify(fragments, ["场景", "流程", "使用", "协作", "聊天", "上传", "跟踪"]).slice(0, 4),
        candidateFunctions: classify(fragments, ["支持", "功能", "编辑", "上传", "预览", "导出", "回滚", "管理"]).slice(0, 5),
        candidateConstraints: classify(fragments, ["本地", "安全", "版本", "约束", "必须", "限制"]).slice(0, 4),
        openQuestions: classify(fragments, ["待确认", "不清楚", "问题", "风险", "建议"]).slice(0, 4)
      };
    });
  }

  private buildSinglePassSourceContext(materials: SourceMaterial[], maxChars = 18000) {
    const blocks: string[] = [];
    let usedChars = 0;

    for (const material of materials) {
      const content = material.text.trim();
      if (!content) {
        continue;
      }

      const remaining = maxChars - usedChars;
      if (remaining <= 0) {
        break;
      }

      const truncated = content.length > remaining ? `${content.slice(0, Math.max(0, remaining - 20))}\n...[内容过长，已截断]` : content;
      const block = [
        `来源标题：${material.title}`,
        `来源类型：${material.sourceType}`,
        material.note ? `备注：${material.note}` : undefined,
        "来源内容：",
        truncated
      ].filter(Boolean).join("\n");

      blocks.push(block);
      usedChars += block.length + 2;
    }

    return blocks.join("\n\n---\n\n");
  }

  private async decideChatAction(
    project: WorkspaceProject,
    collection: WorkspaceRequirementCollection,
    message: string,
    history: Array<{ role: "user" | "assistant"; content: string }>,
    options?: {
      signal?: AbortSignal;
      onLlmDelta?: (payload: { source: "chat-decision"; delta: string }) => void | Promise<void>;
    }
  ): Promise<RuntimeChatDecision> {
    const llm = await this.createProjectLlm(project, "capture");
    const fallback = buildFallbackChatDecision(message, collection);

    if (!llm) {
      return fallback;
    }

    try {
      const systemPrompt = `${project.systemPrompt ?? "你是资深产品经理。"}\n你正在和用户一起做需求采集。你的任务是判断用户当前输入应该：1) 收录进需求采集文档；2) 仅给建议；3) 追问澄清；4) 直接回答问题。reply 要自然、像协作中的产品专家。如果用户输入本身是在描述需求、诉求、评论、补充说明，默认 shouldCapture=true，不要先反问用户是否确认收录。完成当前阶段整理后，应停留在当前阶段供真人 review，而不是主动催促进入下一阶段。`;
      const userPrompt = JSON.stringify({
        message,
        history: history.slice(-8),
        currentSummary: collection.aiSummary,
        currentFollowupQuestions: collection.followupQuestions,
        currentStructuredSnapshot: collection.structuredSnapshot
      }, null, 2);
      const result = options?.onLlmDelta
        ? await llm.generateJsonStream(captureChatSchema, {
            systemPrompt,
            userPrompt,
            temperature: 0.2,
            signal: options?.signal,
            onToken: async (delta) => {
              await options.onLlmDelta?.({ source: "chat-decision", delta });
            }
          })
        : await llm.generateJson(captureChatSchema, {
            systemPrompt,
            userPrompt,
            temperature: 0.2
          });
      await this.repository.saveLlmLog(project.id, {
        stage: "chat",
        step: "chat-decision",
        model: llm.model,
        baseUrl: llm.resolvedBaseUrl,
        systemPrompt,
        userPrompt,
        parsedOutput: result
      });
      const resultDecision: RuntimeChatDecision = {
        ...result,
        decisionSource: "llm",
        model: llm.model
      };
      return resultDecision;
    } catch (error) {
      await this.repository.saveLlmLog(project.id, {
        stage: "chat",
        step: "chat-decision-error",
        model: llm.model,
        baseUrl: llm.resolvedBaseUrl,
        systemPrompt: `${project.systemPrompt ?? "你是资深产品经理。"}\n你正在和用户一起做需求采集。你的任务是判断用户当前输入应该：1) 收录进需求采集文档；2) 仅给建议；3) 追问澄清；4) 直接回答问题。reply 要自然、像协作中的产品专家。如果用户输入本身是在描述需求、诉求、评论、补充说明，默认 shouldCapture=true，不要先反问用户是否确认收录。完成当前阶段整理后，应停留在当前阶段供真人 review，而不是主动催促进入下一阶段。`,
        userPrompt: JSON.stringify({
          message,
          history: history.slice(-8),
          currentSummary: collection.aiSummary,
          currentFollowupQuestions: collection.followupQuestions,
          currentStructuredSnapshot: collection.structuredSnapshot
        }, null, 2),
        outputText: error instanceof StructuredOutputParseError ? error.rawText : undefined,
        parsedOutput: error instanceof StructuredOutputParseError ? { extractedJson: error.extractedJson } : undefined,
        error: error instanceof Error ? error.message : "Unknown decideChatAction error"
      });
      console.log(error);
      return fallback;
    }
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    const reason = signal.reason instanceof Error ? signal.reason : new Error("Chat stream aborted");
    throw reason;
  }
}

async function parseWorkspaceFile(input: {
  filename: string;
  mimeType: string;
  bytes: Buffer;
  storedFilename: string;
  relativePath: string;
  fullPath: string;
}): Promise<WorkspaceSourceFileRecord> {
  const uploadedAt = nowIso();
  const parsed = await extractWorkspaceFileText(input);
  return buildSourceRecord(input, uploadedAt, parsed.status, parsed.text, parsed.note);
}

function buildSourceRecord(
  input: {
    filename: string;
    mimeType: string;
    bytes: Buffer;
    storedFilename: string;
    relativePath: string;
    fullPath: string;
  },
  uploadedAt: string,
  extractionStatus: WorkspaceSourceFileRecord["extractionStatus"],
  extractedText?: string,
  note?: string
): WorkspaceSourceFileRecord {
  return {
    id: `${Date.now()}-${input.storedFilename}`,
    name: input.filename,
    storedFilename: input.storedFilename,
    relativePath: input.relativePath,
    mimeType: input.mimeType || "application/octet-stream",
    size: input.bytes.byteLength,
    uploadedAt,
    extractionStatus,
    extractedTextExcerpt: extractedText ? extractedText.slice(0, 4000) : undefined,
    note
  };
}

async function extractWorkspaceFileText(input: {
  filename: string;
  mimeType: string;
  bytes: Buffer;
  fullPath: string;
}) {
  const extension = extname(input.filename).toLowerCase();

  try {
    if (isTextLike(extension, input.mimeType)) {
      return {
        status: "parsed" as const,
        text: input.bytes.toString("utf-8").trim(),
        note: "已提取文本内容。"
      };
    }

    if (extension === ".pdf") {
      const parser = new PDFParse({ data: input.bytes });
      try {
        const parsed = await parser.getText();
        return {
          status: "parsed" as const,
          text: parsed.text.trim(),
          note: "已解析 PDF 文本。"
        };
      } finally {
        await parser.destroy();
      }
    }

    if (extension === ".docx") {
      const parsed = await mammoth.extractRawText({ buffer: input.bytes });
      return {
        status: "parsed" as const,
        text: parsed.value.trim(),
        note: "已解析 DOCX 文本。"
      };
    }

    if (extension === ".doc") {
      const extractor = new WordExtractor();
      const doc = await extractor.extract(input.fullPath);
      const body = doc.getBody?.() ?? "";
      if (body.trim()) {
        return {
          status: "parsed" as const,
          text: body.trim(),
          note: "已解析 DOC 文本。"
        };
      }
    }

    if (extension === ".xls" || extension === ".xlsx") {
      const workbook = XLSX.read(input.bytes, { type: "buffer" });
      const sheetTexts = workbook.SheetNames.map((sheetName) => {
        const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(workbook.Sheets[sheetName], {
          header: 1,
          blankrows: false
        });
        return [`# ${sheetName}`, ...rows.map((row) => row.filter(Boolean).join(" | "))].join("\n");
      }).join("\n\n");
      return {
        status: "parsed" as const,
        text: sheetTexts.trim(),
        note: "已解析 Excel 工作表内容。"
      };
    }
  } catch (error) {
    return {
      status: "metadata-only" as const,
      text: undefined,
      note: `文件已保存，但解析失败：${error instanceof Error ? error.message : "unknown error"}`
    };
  }

  return {
    status: "metadata-only" as const,
    text: undefined,
    note: "文件已保存，当前类型先保留元数据。"
  };
}

function isTextLike(extension: string, mimeType: string) {
  return mimeType.startsWith("text/") || [".txt", ".md", ".markdown", ".json", ".csv", ".tsv"].includes(extension);
}

function splitFragments(input: string) {
  return input
    .split(/[\n。！？；;•·]/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length >= 6);
}

function heuristicCollection(
  projectName: string,
  rawInputs: string[],
  sourceRecords: WorkspaceRequirementSourceRecord[],
  uploadedFiles: WorkspaceSourceFileRecord[],
  extractedHighlights: string[],
  materials: SourceMaterial[] = []
): WorkspaceRequirementCollection {
  const fragments = [...rawInputs.flatMap((item) => splitFragments(item)), ...extractedHighlights];
  const userGoals = classify(fragments, ["目标", "提升", "减少", "效率", "体验", "增长", "希望", "解决", "价值", "收益"]).slice(0, 4);
  const coreScenarios = classify(fragments, ["场景", "使用", "流程", "入口", "协作", "查看", "聊天", "上传", "编辑", "回退"]).slice(0, 4);
  const coreFunctions = classify(fragments, ["功能", "支持", "上传", "编辑", "导出", "生成", "管理", "通知", "保存", "预览", "回滚", "标注"]).slice(0, 5);
  const constraints = classify(fragments, ["本地", "导出", "版本", "安全", "必须", "需要", "限制", "约束", "阶段", "模型"]).slice(0, 4);
  const followupQuestions = buildFollowupQuestions({
    hasFiles: uploadedFiles.length > 0,
    userGoalsCount: userGoals.length,
    scenarioCount: coreScenarios.length,
    functionCount: coreFunctions.length,
    constraintCount: constraints.length
  });
  const summary = [
    rawInputs.length > 0 ? `已接收 ${rawInputs.length} 条散落需求点` : "当前主要来自上传文档",
    uploadedFiles.length > 0 ? `并记录 ${uploadedFiles.length} 份上传文件` : "暂未上传文档",
    "已整理为需求点文档。"
  ].join("，");

  const sourceSummaries = materials
    .map((material) => ({
      id: material.id,
      title: material.title,
      sourceType: material.sourceType,
      summary: summarizeText(material.text),
      keyPoints: splitFragments(material.text).slice(0, 5),
      candidateUserGoals: classify(splitFragments(material.text), ["目标", "提升", "效率", "增长", "希望", "价值"]).slice(0, 3),
      candidateScenarios: classify(splitFragments(material.text), ["场景", "流程", "使用", "协作", "聊天", "上传"]).slice(0, 3),
      candidateFunctions: classify(splitFragments(material.text), ["支持", "功能", "编辑", "上传", "预览", "导出", "回滚"]).slice(0, 4),
      candidateConstraints: classify(splitFragments(material.text), ["本地", "安全", "版本", "约束", "必须", "发布时间"]).slice(0, 3),
      openQuestions: []
    }))
    .filter((item) => item.summary || item.keyPoints.length > 0);

  const requirementPointSections = buildRequirementPointSections({
    sourceRecords,
    uploadedFiles,
    materials,
    extractedHighlights
  });

  const requirementsDocument = renderCollectionDocument({
    projectName,
    summary,
    requirementPointSections,
    userGoals,
    coreScenarios,
    coreFunctions,
    constraints,
    followupQuestions
  });

  return {
    projectName,
    rawInputs,
    sourceRecords,
    uploadedFiles,
    sourceSummaries,
    requirementPointSections,
    extractedHighlights,
    aiSummary: summary,
    requirementsDocument,
    requirementsDocumentHtml: markdownLikeToHtml(requirementsDocument),
    structuredSnapshot: {
      userGoals,
      coreScenarios,
      coreFunctions,
      constraints
    },
    sourceDirty: false,
    lastSourceUpdatedAt: getLatestSourceUpdatedAt(sourceRecords, uploadedFiles),
    lastOrganizedSourceUpdatedAt: nowIso(),
    followupQuestions,
    lastOrganizedAt: nowIso()
  };
}

function heuristicStructure(collection: WorkspaceRequirementCollection): WorkspaceRequirementStructure {
  const structure: WorkspaceRequirementStructure = {
    userGoals: collection.structuredSnapshot.userGoals,
    coreScenarios: collection.structuredSnapshot.coreScenarios,
    coreFunctions: collection.structuredSnapshot.coreFunctions,
    scope: {
      inScope: collection.structuredSnapshot.coreFunctions.slice(0, 4),
      outOfScope: [
        "高级自动化",
        "复杂权限系统",
        "深度第三方集成"
      ]
    },
    risks: collection.structuredSnapshot.constraints.length > 0
      ? collection.structuredSnapshot.constraints
      : ["部分业务边界仍需继续澄清。"],
    clarificationNeeded: collection.followupQuestions,
    documentMarkdown: "",
    documentHtml: "",
    lastGeneratedAt: nowIso()
  };
  structure.documentMarkdown = renderRequirementStructureMarkdown(structure);
  structure.documentHtml = markdownLikeToHtml(structure.documentMarkdown);
  return structure;
}

function buildFallbackStageDocument(
  projectName: string,
  stage: "requirement-clarification" | "product-model" | "prd" | "prototype",
  context: {
    collection: WorkspaceRequirementCollection;
    structure?: WorkspaceRequirementStructure;
    clarification?: WorkspaceStageDocument;
    productModel?: WorkspaceStageDocument;
    prd?: WorkspaceStageDocument;
  }
): WorkspaceStageDocument {
  const markdown = renderFallbackStageMarkdown(projectName, stage, context);
  return {
    stage,
    title: `${projectName} ${labelStageForPrompt(stage)}`,
    summary: firstNonEmptyLine(markdown) ?? `${projectName} ${labelStageForPrompt(stage)}`,
    documentMarkdown: markdown,
    documentHtml: markdownLikeToHtml(markdown),
    sections: buildStageDocumentSections(stage, markdown),
    lastGeneratedAt: nowIso()
  };
}

function renderRequirementStructureMarkdown(structure: WorkspaceRequirementStructure) {
  return [
    "# 结构化需求文档",
    "",
    "## 用户目标",
    ...bullet(structure.userGoals),
    "",
    "## 核心场景",
    ...bullet(structure.coreScenarios),
    "",
    "## 核心功能",
    ...bullet(structure.coreFunctions),
    "",
    "## 范围",
    "### 包含范围",
    ...bullet(structure.scope.inScope),
    "",
    "### 不包含",
    ...bullet(structure.scope.outOfScope),
    "",
    "## 风险",
    ...bullet(structure.risks),
    "",
    "## 待澄清",
    ...bullet(structure.clarificationNeeded)
  ].join("\n");
}

function renderFallbackStageMarkdown(
  projectName: string,
  stage: "requirement-clarification" | "product-model" | "prd" | "prototype",
  context: {
    collection: WorkspaceRequirementCollection;
    structure?: WorkspaceRequirementStructure;
    clarification?: WorkspaceStageDocument;
    productModel?: WorkspaceStageDocument;
    prd?: WorkspaceStageDocument;
  }
) {
  if (stage === "requirement-clarification") {
    return [
      `# ${projectName} 需求澄清文档`,
      "",
      "## 已确认项",
      ...bullet(context.structure?.coreFunctions ?? []),
      "",
      "## 待确认项",
      ...bullet(context.structure?.clarificationNeeded ?? context.collection.followupQuestions),
      "",
      "## 当前假设",
      "- 第一版围绕当前核心功能先做 MVP。",
      "- 结构化结果中的目标用户和场景暂作为当前假设继续推进。",
      "",
      "## Blocker",
      ...bullet((context.structure?.clarificationNeeded ?? []).length > 0 ? ["仍有关键待确认项需要继续澄清。"] : ["当前未发现明显 blocker。"])
    ].join("\n");
  }

  if (stage === "product-model") {
    return [
      `# ${projectName} 产品模型`,
      "",
      "## 功能模块",
      ...bullet(context.structure?.coreFunctions ?? []),
      "",
      "## 页面列表",
      ...bullet(buildDefaultPages(context.structure?.coreFunctions ?? [])),
      "",
      "## 用户流程",
      ...bullet(buildDefaultFlows(context.structure?.coreScenarios ?? [])),
      "",
      "## 信息架构说明",
      "- 首页承接核心入口与当前状态概览。",
      "- 列表页承接对象管理与筛选。",
      "- 详情页承接单个对象的查看与操作。"
    ].join("\n");
  }

  if (stage === "prd") {
    return [
      `# ${projectName} PRD`,
      "",
      "## 背景",
      context.collection.aiSummary,
      "",
      "## 目标用户",
      ...bullet(context.structure?.userGoals ?? []),
      "",
      "## 核心场景",
      ...bullet(context.structure?.coreScenarios ?? []),
      "",
      "## 功能需求",
      ...bullet(context.structure?.coreFunctions ?? []),
      "",
      "## 页面说明",
      ...bullet(buildDefaultPages(context.structure?.coreFunctions ?? [])),
      "",
      "## 风险与开放问题",
      ...bullet(context.structure?.risks ?? ["部分业务边界仍需继续明确。"])
    ].join("\n");
  }

  return [
    `# ${projectName} 原型稿`,
    "",
    "## 页面列表",
    ...bullet(buildDefaultPages(context.structure?.coreFunctions ?? [])),
    "",
    "## 页面流转",
    ...bullet(buildDefaultFlows(context.structure?.coreScenarios ?? [])),
    "",
    "## 原型说明",
    "- 当前原型以页面结构和关键交互为主。",
    "- 重点验证页面承接关系、主流程和关键信息布局。",
    "",
    "## 标注建议",
    "- 补充每个页面的关键交互说明。",
    "- 标注待确认规则和异常状态。"
  ].join("\n");
}

function renderCollectionDocument(params: {
  projectName: string;
  summary: string;
  requirementPointSections: WorkspaceRequirementPointSection[];
  userGoals: string[];
  coreScenarios: string[];
  coreFunctions: string[];
  constraints: string[];
  followupQuestions: string[];
}) {
  return [
    `# ${params.projectName} 需求点文档`,
    "",
    "## 文档说明",
    params.summary,
    "",
    "## 需求内容",
    "",
    ...params.requirementPointSections.flatMap((section) => [
      `### ${section.title}`,
      ...bullet(section.items),
      ""
    ]),
    "## 当前可提炼出的重点",
    "",
    "### 用户目标",
    ...bullet(params.userGoals),
    "",
    "### 核心场景",
    ...bullet(params.coreScenarios),
    "",
    "### 核心功能",
    ...bullet(params.coreFunctions),
    "",
    "### 约束条件",
    ...bullet(params.constraints.length > 0 ? params.constraints : ["暂未明确约束条件"]),
    "",
    "## 待补充问题",
    ...bullet(params.followupQuestions)
  ].join("\n");
}

function buildDefaultPages(coreFunctions: string[]) {
  const defaults = [
    "首页：展示当前状态、关键入口和最近进展",
    "列表页：承接对象浏览、筛选和批量操作",
    "详情页：展示单个对象详情和关联操作",
    "设置页：承接配置、偏好与系统选项"
  ];
  return coreFunctions.length > 0 ? coreFunctions.map((item) => `${item} 页面承接`) : defaults;
}

function buildDefaultFlows(coreScenarios: string[]) {
  return coreScenarios.length > 0
    ? coreScenarios.map((item) => `${item} -> 查看信息 -> 执行动作 -> 返回结果`)
    : ["进入产品 -> 查看当前状态 -> 执行核心动作 -> 获得结果反馈"];
}

function labelStageForPrompt(stage: "requirement-clarification" | "product-model" | "prd" | "prototype") {
  return ({
    "requirement-clarification": "需求澄清文档",
    "product-model": "产品模型",
    "prd": "PRD 文档",
    "prototype": "原型稿"
  })[stage];
}

function firstNonEmptyLine(markdown: string) {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .find((line) => Boolean(line && !line.startsWith("#")));
}

function buildStageDocumentSections(
  stage: "requirement-clarification" | "product-model" | "prd" | "prototype",
  markdown: string
) {
  const blocks = markdown.split(/\n##\s+/).filter(Boolean);
  const sections = blocks.slice(1).map((block, index) => {
    const [titleLine, ...rest] = block.split("\n");
    const body = rest.join("\n").trim();
    const items = rest
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2));
    return {
      id: `${stage}-section-${index + 1}`,
      title: titleLine?.trim() ?? `Section ${index + 1}`,
      body,
      items
    };
  });

  return sections;
}

function buildRequirementPointSections(params: {
  sourceRecords: WorkspaceRequirementSourceRecord[];
  uploadedFiles: WorkspaceSourceFileRecord[];
  materials: SourceMaterial[];
  extractedHighlights: string[];
  currentDocument?: string;
}): WorkspaceRequirementPointSection[] {
  const allPoints = dedupeStrings([
    ...params.materials.flatMap((material) => splitFragments(material.text)),
    ...params.extractedHighlights,
    ...splitFragments(params.currentDocument ?? "")
  ]);

  const groups: Array<{ id: string; title: string; keywords: string[] }> = [
    { id: "goals", title: "目标与价值", keywords: ["目标", "价值", "提升", "减少", "效率", "增长", "解决", "收益", "帮助"] },
    { id: "users", title: "用户与角色", keywords: ["用户", "团队", "角色", "管理员", "成员", "老板", "客户", "负责人"] },
    { id: "scenarios", title: "场景与流程", keywords: ["场景", "流程", "阶段", "使用", "协作", "跟踪", "查看", "推进"] },
    { id: "functions", title: "功能与交互", keywords: ["功能", "支持", "上传", "编辑", "生成", "导出", "预览", "保存", "回复", "版本", "回滚"] },
    { id: "data", title: "数据与内容", keywords: ["数据", "文档", "记录", "需求点", "内容", "文件", "说明"] },
    { id: "constraints", title: "规则与约束", keywords: ["必须", "约束", "限制", "本地", "安全", "模型", "版本化"] },
    { id: "issues", title: "问题、评论与待确认", keywords: ["问题", "评论", "担心", "不清楚", "待确认", "风险", "建议"] }
  ];

  const assigned = new Set<string>();
  const sections: WorkspaceRequirementPointSection[] = groups
    .map((group) => {
      const items = allPoints.filter((point) => {
        if (assigned.has(point)) {
          return false;
        }
        const matched = group.keywords.some((keyword) => point.includes(keyword));
        if (matched) {
          assigned.add(point);
        }
        return matched;
      });

      return {
        id: group.id,
        title: group.title,
        items
      };
    })
    .filter((section) => section.items.length > 0);

  const remaining = allPoints.filter((point) => !assigned.has(point));
  if (remaining.length > 0) {
    sections.push({
      id: "others",
      title: "其他需求点",
      items: remaining
    });
  }

  return sections.length > 0
    ? sections
    : [{
        id: "empty",
        title: "当前需求点",
        items: ["暂未整理出明确需求点"]
      }];
}

function bullet(items: string[]) {
  return items.length > 0 ? items.map((item) => `- ${item}`) : ["- 暂无"];
}

function classify(fragments: string[], keywords: string[]) {
  return Array.from(new Set(fragments.filter((fragment) => keywords.some((keyword) => fragment.includes(keyword)))));
}

function buildFollowupQuestions(params: {
  hasFiles: boolean;
  userGoalsCount: number;
  scenarioCount: number;
  functionCount: number;
  constraintCount: number;
}) {
  const questions: string[] = [];
  if (params.userGoalsCount < 1) {
    questions.push("最优先要解决的业务目标是什么？");
  }
  if (params.scenarioCount < 1) {
    questions.push("目标用户会在什么具体场景下使用这个产品？");
  }
  if (params.functionCount < 2) {
    questions.push("第一版必须包含的 3 个核心功能分别是什么？");
  }
  if (params.constraintCount < 1) {
    questions.push("有没有必须遵守的约束，比如本地存储、导出、安全或发布时间？");
  }
  if (!params.hasFiles) {
    questions.push("如果你手上有会议纪要、需求文档或竞品材料，可以继续上传帮助我补齐上下文。");
  }
  return questions.slice(0, 4);
}

function buildSourceRecordMaterials(sourceRecords: WorkspaceRequirementSourceRecord[]): SourceMaterial[] {
  const byId = new Map(sourceRecords.map((record) => [record.id, record]));
  const sortByCreated = (left: WorkspaceRequirementSourceRecord, right: WorkspaceRequirementSourceRecord) =>
    new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();

  const serialize = (record: WorkspaceRequirementSourceRecord, depth = 0): string[] => {
    const prefix = depth > 0 ? `${"  ".repeat(depth)}回复：` : "记录：";
    const children = sourceRecords
      .filter((item) => item.parentId === record.id)
      .sort(sortByCreated)
      .flatMap((item) => serialize(item, depth + 1));
    return [`${prefix} ${record.content}`.trim(), ...children];
  };

  return sourceRecords
    .filter((record) => !record.parentId || !byId.has(record.parentId))
    .sort(sortByCreated)
    .map((record, index) => ({
      id: record.id,
      title: `需求点记录 ${index + 1}`,
      sourceType: "record" as const,
      text: serialize(record).join("\n")
    }));
}

function chunkText(input: string, maxChars = 3500) {
  const normalized = input.trim();
  if (!normalized) {
    return [];
  }

  const paragraphs = normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (!current) {
      if (paragraph.length <= maxChars) {
        current = paragraph;
        continue;
      }
      for (let index = 0; index < paragraph.length; index += maxChars) {
        chunks.push(paragraph.slice(index, index + maxChars));
      }
      continue;
    }

    const candidate = `${current}\n\n${paragraph}`;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      chunks.push(current);
      if (paragraph.length <= maxChars) {
        current = paragraph;
      } else {
        for (let index = 0; index < paragraph.length; index += maxChars) {
          chunks.push(paragraph.slice(index, index + maxChars));
        }
        current = "";
      }
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function summarizeText(input: string, maxLength = 180) {
  const normalized = input.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

function dedupeStrings(items: string[]) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function createSourceRecord(content: string, parentId?: string): WorkspaceRequirementSourceRecord {
  const now = nowIso();
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    content: content.trim(),
    parentId,
    createdAt: now,
    updatedAt: now
  };
}

function normalizeCollection(collection: WorkspaceRequirementCollection): WorkspaceRequirementCollection {
  const sourceRecords = collection.sourceRecords?.length
    ? collection.sourceRecords
    : collection.rawInputs.map((content, index) => {
        const now = collection.lastEditedAt ?? collection.lastOrganizedAt ?? nowIso();
        return {
          id: `${Date.now()}-legacy-${index}`,
          content,
          createdAt: now,
          updatedAt: now
        } satisfies WorkspaceRequirementSourceRecord;
      });

  return {
    ...collection,
    sourceRecords,
    rawInputs: sourceRecordsToRawInputs(sourceRecords),
    sourceDirty: collection.sourceDirty ?? isSourceDirty(collection.lastSourceUpdatedAt, collection.lastOrganizedSourceUpdatedAt),
    lastSourceUpdatedAt: collection.lastSourceUpdatedAt ?? getLatestSourceUpdatedAt(sourceRecords, collection.uploadedFiles),
    lastOrganizedSourceUpdatedAt: collection.lastOrganizedSourceUpdatedAt ?? collection.lastOrganizedAt
  };
}

function getLatestSourceUpdatedAt(
  sourceRecords: WorkspaceRequirementSourceRecord[],
  uploadedFiles: WorkspaceSourceFileRecord[]
) {
  const timestamps = [
    ...sourceRecords.map((record) => record.updatedAt || record.createdAt),
    ...uploadedFiles.map((file) => file.uploadedAt)
  ].filter(Boolean);

  if (timestamps.length === 0) {
    return undefined;
  }

  return timestamps.sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];
}

function isSourceDirty(lastSourceUpdatedAt?: string, lastOrganizedSourceUpdatedAt?: string) {
  if (!lastSourceUpdatedAt) {
    return false;
  }

  if (!lastOrganizedSourceUpdatedAt) {
    return true;
  }

  return new Date(lastSourceUpdatedAt).getTime() > new Date(lastOrganizedSourceUpdatedAt).getTime();
}

function sourceRecordsToRawInputs(records: WorkspaceRequirementSourceRecord[]) {
  const byId = new Map(records.map((record) => [record.id, record]));
  const sortByCreated = (left: WorkspaceRequirementSourceRecord, right: WorkspaceRequirementSourceRecord) =>
    new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();

  const serialize = (record: WorkspaceRequirementSourceRecord, depth = 0): string[] => {
    const prefix = depth > 0 ? `${"  ".repeat(depth)}回复：` : "";
    const children = records
      .filter((item) => item.parentId === record.id)
      .sort(sortByCreated)
      .flatMap((item) => serialize(item, depth + 1));
    return [`${prefix}${record.content}`.trim(), ...children];
  };

  return records
    .filter((record) => !record.parentId || !byId.has(record.parentId))
    .sort(sortByCreated)
    .flatMap((record) => serialize(record))
    .filter(Boolean);
}

function removeSourceRecordTree(records: WorkspaceRequirementSourceRecord[], recordId: string) {
  const deletedIds = new Set<string>([recordId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of records) {
      if (record.parentId && deletedIds.has(record.parentId) && !deletedIds.has(record.id)) {
        deletedIds.add(record.id);
        changed = true;
      }
    }
  }
  return records.filter((record) => !deletedIds.has(record.id));
}

function markdownLikeToHtml(input: string) {
  return input
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      if (lines.length === 0) {
        return "";
      }
      if (lines.every((line) => line.startsWith("- "))) {
        return `<ul>${lines.map((line) => `<li>${escapeHtml(line.slice(2))}</li>`).join("")}</ul>`;
      }
      const first = lines[0] ?? "";
      if (first.startsWith("# ")) {
        return `<h1>${escapeHtml(first.slice(2))}</h1>${lines.slice(1).map((line) => `<p>${escapeHtml(line)}</p>`).join("")}`;
      }
      if (first.startsWith("## ")) {
        return `<h2>${escapeHtml(first.slice(3))}</h2>${lines.slice(1).map((line) => `<p>${escapeHtml(line)}</p>`).join("")}`;
      }
      if (first.startsWith("### ")) {
        return `<h3>${escapeHtml(first.slice(4))}</h3>${lines.slice(1).map((line) => `<p>${escapeHtml(line)}</p>`).join("")}`;
      }
      return lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
    })
    .join("");
}

function normalizeRichTextHtml(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    return "<p></p>";
  }
  return trimmed;
}

function richTextHtmlToText(input: string) {
  return input
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h1|h2|h3|li|ul|ol)>/gi, "\n")
    .replace(/<li>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
